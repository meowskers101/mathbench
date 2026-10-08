'use strict';
const { app, BrowserWindow, Tray, Menu, globalShortcut, screen, desktopCapturer, ipcMain, nativeImage, clipboard, shell, dialog, protocol, Notification } = require('electron');
const { execFile, spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

/* ---------- mathbench://app/ serves the app's own pages ---------- */
/* the formula reader fetches its model files, runs a worker and imports a module, none of which file:// pages may do */
protocol.registerSchemesAsPrivileged([{ scheme: 'mathbench', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const APP_URL = 'mathbench://app/';
const SERVED = ['renderer', 'assets', 'overlay.html', 'assist.js'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.txt': 'text/plain', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.css': 'text/css' };
function serveApp() {
  protocol.handle('mathbench', async req => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(__dirname, rel));
    const allowed = SERVED.some(s => file === path.join(__dirname, s) || file.startsWith(path.join(__dirname, s) + path.sep));
    if (!allowed) return new Response('Not found', { status: 404 });
    try {
      const body = await fs.promises.readFile(file);
      return new Response(body, { headers: { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
    } catch (e) { return new Response('Not found', { status: 404 }); }
  });
}

const DEFAULTS = { hotkey: 'Control+Alt+M', mode: 'math', pasteHotkey: 'Control+Alt+P' };
const MODES = ['math', 'copy', 'save', 'paste'];
let cfg = Object.assign({}, DEFAULTS);
let mainWin = null, overlayWin = null, settingsWin = null, tray = null, quitting = false;
let shot = null; // { img: NativeImage, display }

const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
function loadCfg() {
  try {
    const raw = JSON.parse(fs.readFileSync(cfgFile(), 'utf8'));
    cfg = Object.assign({}, DEFAULTS, { hotkey: raw.hotkey, mode: raw.mode, pasteHotkey: raw.pasteHotkey === undefined ? DEFAULTS.pasteHotkey : raw.pasteHotkey });
  } catch (e) { /* first run or unreadable file: use defaults */ }
  if (!cfg.hotkey) cfg.hotkey = DEFAULTS.hotkey;
  if (!MODES.includes(cfg.mode)) cfg.mode = 'math';
}
function saveCfg() {
  try { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify({ hotkey: cfg.hotkey, mode: cfg.mode, pasteHotkey: cfg.pasteHotkey })); } catch (e) { /* ignore */ }
}

/* ---------- windows ---------- */
function ensureMain() {
  if (!mainWin || mainWin.isDestroyed()) {
    mainWin = new BrowserWindow({
      width: 1280, height: 860, minWidth: 420, minHeight: 560, title: 'Mathbench', backgroundColor: '#ffffff', show: false,
      icon: path.join(__dirname, 'assets', 'icon.png'), autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload-main.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    mainWin.loadURL(APP_URL + 'renderer/index.html');
    if (process.env.MATHBENCH_DEBUG) mainWin.webContents.on('console-message', (_e, level, msg, line, src) => { try { fs.appendFileSync(path.join(os.tmpdir(), 'mathbench-debug.log'), new Date().toISOString() + ' [' + level + '] ' + msg + ' (' + src + ':' + line + ')\n'); } catch (e) { /* ignore */ } });
    mainWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    mainWin.on('close', e => { if (!quitting) { e.preventDefault(); mainWin.hide(); } });
  }
  return mainWin;
}
function showMain() {
  ensureMain();
  mainWin.show(); mainWin.focus();
  return mainWin;
}
/* "Mathbench" written out and erased in a small window of its own (smooth, as the heavy page loads hidden meanwhile),
   then the main window. Plays at start and whenever the window is opened again (search, tray, shortcut) while hidden.
   A click or a key on it skips ahead */
let splashing = false;
function openMain() {
  if (mainWin && !mainWin.isDestroyed() && mainWin.isVisible() && !mainWin.isMinimized()) { mainWin.focus(); return; }   /* already in front */
  showSplashThenMain();
}
function showSplashThenMain() {
  if (splashing) return;
  splashing = true;
  ensureMain();
  let sp = null, mainReady = !mainWin.webContents.isLoading(), splashDone = false, shown = false;
  const finish = () => {
    if (shown || !mainReady || !splashDone) return;
    shown = true; splashing = false;
    showMain();
    if (sp && !sp.isDestroyed()) sp.destroy();
  };
  mainWin.webContents.once('did-finish-load', () => { mainReady = true; finish(); });
  setTimeout(() => { mainReady = true; finish(); }, 12000);   /* never wait on the page for ever */
  try {
    sp = new BrowserWindow({ width: 880, height: 520, frame: false, resizable: false, movable: true, center: true, show: false, backgroundColor: '#1f4fd8', title: 'Mathbench',
      icon: path.join(__dirname, 'assets', 'icon.png'), webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    sp.loadURL(APP_URL + 'renderer/splash.html');
    sp.once('ready-to-show', () => { if (!shown) sp.show(); });
    sp.on('closed', () => { splashDone = true; finish(); });
    setTimeout(() => { splashDone = true; finish(); }, 3900);
  } catch (e) { splashDone = true; finish(); }
}

function showSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 520, height: 720, resizable: false, minimizable: false, maximizable: false, title: 'Mathbench settings', backgroundColor: '#ffffff', autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload-main.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
}

/* ---------- the Game Bar style overlay ---------- */
async function toggleOverlay(autoCapture, forceMode) {
  if (overlayWin && !overlayWin.isDestroyed()) { overlayWin.close(); return; }
  const cursor = screen.getCursorScreenPoint();
  const target = forceMode === 'assist' ? helperForeground() : foregroundWindow();   /* where a solve & paste answer goes */
  if (forceMode === 'assist') await target;   /* know the window before the overlay covers it */
  const display = screen.getDisplayNearestPoint(cursor);
  const w = Math.round(display.size.width * display.scaleFactor), h = Math.round(display.size.height * display.scaleFactor);
  let sources;
  try { sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } }); } catch (e) { sources = []; }
  const src = sources.find(s => String(s.display_id) === String(display.id)) || sources[0];
  if (!src || src.thumbnail.isEmpty()) {
    dialog.showErrorBox('Mathbench', 'The screen could not be captured. On some systems you need to allow screen recording for apps.');
    return;
  }
  shot = { img: src.thumbnail, display: display, auto: !!autoCapture, forceMode: forceMode || null, target: target, cursor: cursor };
  if (forceMode === 'assist') shot.scan = startScan(shot);
  overlayWin = new BrowserWindow({
    x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height,
    frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, show: false, hasShadow: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload-overlay.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.loadURL(APP_URL + 'overlay.html');
  overlayWin.on('closed', () => { overlayWin = null; shot = null; });
}
function closeOverlay() { if (overlayWin && !overlayWin.isDestroyed()) overlayWin.close(); }

ipcMain.handle('overlay:init', () => {
  if (!shot) return null;
  const size = shot.img.getSize();
  const b = shot.display.bounds;
  return { image: shot.img.toDataURL(), mode: shot.forceMode === 'assist' ? 'paste' : (shot.forceMode || cfg.mode), pasteOnly: shot.forceMode === 'paste', assist: shot.forceMode === 'assist', hotkey: cfg.hotkey, pasteHotkey: cfg.pasteHotkey, autoCapture: shot.auto, x: b.x, y: b.y, width: b.width, height: b.height, ratio: size.width / b.width, cursor: { x: (shot.cursor.x - b.x) * size.width / b.width, y: (shot.cursor.y - b.y) * size.width / b.width } };
});
ipcMain.on('overlay:shown', () => {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  overlayWin.setBounds(shot.display.bounds); overlayWin.show(); overlayWin.focus();
  /* the directions box needs the keyboard: make sure Windows really puts the overlay in front */
  if (shot.forceMode === 'assist') {
    try { const b = overlayWin.getNativeWindowHandle(); helperCall('focus', { hwnd: Number(b.length >= 8 ? b.readBigUInt64LE(0) : b.readUInt32LE(0)) }, 4000).then(() => { if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.focus(); }); } catch (e) { /* ignore */ }
  }
});
ipcMain.on('overlay:cancel', closeOverlay);
ipcMain.on('overlay:mode', (_e, m) => { if (MODES.includes(m)) { cfg.mode = m; saveCfg(); } });
ipcMain.on('overlay:solvepaste', (_e, d) => {
  const target = shot ? shot.target : Promise.resolve('');
  closeOverlay();
  solveAndPaste(d, target);
});

/* ---------- solve & paste: read the selection, solve it in the (hidden) main window, paste the answer where you were typing ---------- */
function ps(script) {
  return new Promise(res => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
    { windowsHide: true, timeout: 15000 }, (err, out) => res(err ? '' : String(out).trim())));
}
const WIN32 = "Add-Type -Name W -Namespace MB -MemberDefinition '[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h);';";
function foregroundWindow() { return ps(WIN32 + ' [MB.W]::GetForegroundWindow().ToInt64()'); }
function pasteInto(hwnd) {
  const focus = /^[1-9]\d*$/.test(hwnd || '') ? '[void][MB.W]::SetForegroundWindow([IntPtr]' + hwnd + '); Start-Sleep -Milliseconds 150; ' : '';
  return ps(WIN32 + ' Add-Type -AssemblyName System.Windows.Forms; ' + focus + "[System.Windows.Forms.SendKeys]::SendWait('^v')");
}
function notify(title, body) { try { new Notification({ title: title, body: body || '', silent: true, icon: path.join(__dirname, 'assets', 'icon.png') }).show(); } catch (e) { /* ignore */ } }
let solveSeq = 0;
function dbg(m) { if (process.env.MATHBENCH_DEBUG) try { fs.appendFileSync(path.join(os.tmpdir(), 'mathbench-debug.log'), new Date().toISOString() + ' main: ' + m + '\n'); } catch (e) { /* ignore */ } }
async function solveInMain(image, opts) {
  dbg('solve ' + JSON.stringify(opts) + ' image ' + (image ? image.length : 0));
  if (process.env.MATHBENCH_DEBUG && image) try { fs.writeFileSync(path.join(os.tmpdir(), 'mathbench-crop-' + (solveSeq + 1) + '.png'), Buffer.from(image.split(',')[1], 'base64')); ((opts && opts.images) || []).forEach((u, i) => fs.writeFileSync(path.join(os.tmpdir(), 'mathbench-crop-' + (solveSeq + 1) + '-line' + i + '.png'), Buffer.from(u.split(',')[1], 'base64'))); } catch (e) { /* ignore */ }
  const w = ensureMain();
  if (w.webContents.isLoading()) await new Promise(r => w.webContents.once('did-finish-load', r));
  const id = ++solveSeq, channel = 'desktop:solved:' + id;
  return new Promise(res => {
    const t = setTimeout(() => { ipcMain.removeAllListeners(channel); res({ ok: false, error: 'Reading took too long. Try again with just the problem selected.' }); }, 45000);
    ipcMain.once(channel, (_e, r) => { clearTimeout(t); res(r); });
    w.webContents.send('desktop:solve', { id: id, image: image, opts: opts ? Object.assign({ debug: !!process.env.MATHBENCH_DEBUG }, opts) : null });
  });
}
async function solveAndPaste(image, targetPromise) {
  const result = await solveInMain(image);
  if (!result || !result.ok || !result.answer) { notify('Mathbench could not solve that', (result && result.error) || 'Try selecting just the problem.'); return; }
  const target = await targetPromise;
  const saved = { text: clipboard.readText(), html: clipboard.readHTML(), image: clipboard.readImage() };
  clipboard.writeText(result.answer);
  await pasteInto(target);
  setTimeout(() => {   /* put back what was on the clipboard */
    try {
      if (!saved.image.isEmpty()) clipboard.writeImage(saved.image);
      else if (saved.html) clipboard.write({ text: saved.text, html: saved.html });
      else clipboard.writeText(saved.text || '');
    } catch (e) { /* ignore */ }
  }, 1500);
  notify('Pasted ' + result.answer, result.problem ? 'Solved ' + result.problem : '');
}
const imgFrom = d => (typeof d === 'string' && d.indexOf('data:image/png;base64,') === 0) ? nativeImage.createFromDataURL(d) : null;
ipcMain.on('overlay:copy', (_e, d) => { const i = imgFrom(d); if (i && !i.isEmpty()) clipboard.writeImage(i); });
ipcMain.on('overlay:save', (_e, d) => {
  const i = imgFrom(d); if (!i || i.isEmpty()) return;
  const dir = path.join(app.getPath('pictures'), 'Mathbench captures');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'capture-' + new Date().toISOString().replace(/[:.]/g, '-') + '.png');
    fs.writeFileSync(f, i.toPNG());
  } catch (e) { dialog.showErrorBox('Mathbench', 'The image could not be saved.'); }
});

/* ---------- "Do it for me": read the whole screen, follow typed directions, type each answer into its box ---------- */
/* a small PowerShell helper (Windows' own text reader, accessibility and mouse) starts on demand and quits when idle */
let helper = null, helperBuf = '', helperWait = new Map(), helperSeq = 0, helperIdle = null;
function helperScript() {
  const f = path.join(app.getPath('userData'), 'helper-' + app.getVersion() + '.ps1');
  try { fs.writeFileSync(f, fs.readFileSync(path.join(__dirname, 'helper.ps1'), 'utf8')); } catch (e) { /* ignore */ }
  return f;
}
function ensureHelper() {
  if (helper && helper.exitCode === null && !helper.killed) return helper;
  helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', helperScript()], { windowsHide: true });
  helperBuf = '';
  helper.stdout.setEncoding('utf8');
  helper.stdout.on('data', d => {
    helperBuf += d;
    let k;
    while ((k = helperBuf.indexOf('\n')) >= 0) {
      const line = helperBuf.slice(0, k).trim(); helperBuf = helperBuf.slice(k + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch (e) { continue; }
      const w = helperWait.get(msg.id);
      if (w) { helperWait.delete(msg.id); w(msg); }
    }
  });
  const me = helper;
  const fail = () => { if (helper !== me) return; helperWait.forEach(w => w({ error: 'helper stopped' })); helperWait.clear(); helper = null; };
  helper.on('exit', fail); helper.on('error', fail);
  return helper;
}
function helperCall(op, args, timeout) {
  const h = ensureHelper(), id = ++helperSeq;
  clearTimeout(helperIdle);
  helperIdle = setTimeout(() => { try { if (helper) helper.stdin.write(JSON.stringify({ op: 'quit' }) + '\n'); } catch (e) { /* ignore */ } }, 5 * 60 * 1000);
  return new Promise(res => {
    const t = setTimeout(() => { helperWait.delete(id); res({ error: 'timeout' }); }, timeout || 20000);
    helperWait.set(id, m => { clearTimeout(t); res(m); });
    try { h.stdin.write(JSON.stringify(Object.assign({ op: op, id: id }, args)) + '\n'); } catch (e) { clearTimeout(t); helperWait.delete(id); res({ error: 'helper unavailable' }); }
  });
}
async function helperForeground() {
  const r = await helperCall('fg', {}, 8000);
  return r && r.hwnd ? String(r.hwnd) : await foregroundWindow();
}
/* where the picture's pixel (0, 0) is, in the screen's physical pixels */
function physOrigin(display) {
  try { return screen.dipToScreenPoint({ x: display.bounds.x, y: display.bounds.y }); } catch (e) { return { x: Math.round(display.bounds.x * display.scaleFactor), y: Math.round(display.bounds.y * display.scaleFactor) }; }
}
async function startScan(s) {
  const size = s.img.getSize();
  const hwnd = await s.target;
  /* first the window's boxes and size, then its text */
  const r = await helperCall('scan', { hwnd: /^[1-9]\d*$/.test(hwnd || '') ? Number(hwnd) : 0 }, 25000);
  const o = physOrigin(s.display), px = size.width / (s.display.size.width * s.display.scaleFactor);
  let win = r.win && r.win.w > 50 ? { x: (r.win.x - o.x) * px, y: (r.win.y - o.y) * px, w: r.win.w * px, h: r.win.h * px } : null;
  const toImg = f => ({ x: (f.x - o.x) * px, y: (f.y - o.y) * px, w: f.w * px, h: f.h * px });
  /* the page itself (a web page, a OneNote page, a document): its largest document area, or a text area taller than any answer box.
     Reading only that leaves out the app's ribbon, tabs, sidebars and page lists */
  const isPage = f => f && (f.kind === 'doc' || (f.kind === 'edit' && f.h * px > 300 && f.w * px > 300));
  const pages = (r.controls || []).filter(isPage).map(toImg).filter(f => f.w > 200 && f.h > 150).sort((a, b) => b.w * b.h - a.w * a.h);
  if (pages.length && (!win || pages[0].w * pages[0].h > 0.15 * win.w * win.h)) {
    const d = pages[0], x = Math.max(d.x, win ? win.x : 0), y = Math.max(d.y, win ? win.y : 0);
    win = { x: x, y: y, w: Math.min(d.x + d.w, win ? win.x + win.w : size.width) - x, h: Math.min(d.y + d.h, win ? win.y + win.h : size.height) - y };
  }
  /* Windows' text reader misses small maths text, and takes at most 2600 pixels a side: read the window in tiles, each enlarged 2x */
  const K = 2, T = Math.floor(2560 / K), PAD = 48;
  const rx0 = Math.max(0, Math.round(win ? win.x : 0)), ry0 = Math.max(0, Math.round(win ? win.y : 0));
  const rx1 = Math.min(size.width, Math.round(win ? win.x + win.w : size.width)), ry1 = Math.min(size.height, Math.round(win ? win.y + win.h : size.height));
  const lines = [];
  let note = r.error || null;
  for (let ty = ry0; ty < ry1; ty += T - PAD) {
    for (let tx = rx0; tx < rx1; tx += T - PAD) {
      const w = Math.min(T, rx1 - tx), h = Math.min(T, ry1 - ty);
      if (w < 40 || h < 20) continue;
      const file = path.join(os.tmpdir(), 'mathbench-screen-' + process.pid + '.png');
      try { fs.writeFileSync(file, s.img.crop({ x: tx, y: ty, width: w, height: h }).resize({ width: w * K, height: h * K, quality: 'best' }).toPNG()); } catch (e) { continue; }
      const t = await helperCall('ocr', { path: file }, 20000);
      try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
      if (t.ocrErr) note = t.ocrErr;
      (t.lines || []).forEach(l => lines.push({ t: l.t, words: (l.words || []).map(q => ({ t: q.t, x: tx + q.x / K, y: ty + q.y / K, w: q.w / K, h: q.h / K })) }));
      if (tx + T >= rx1) break;
    }
    if (ty + T >= ry1) break;
  }
  const fields = (r.controls || []).filter(f => f && (f.kind === 'edit' || f.kind === 'combo') && !isPage(f)).map(f => ({ name: f.name, value: f.value, focus: f.focus, x: (f.x - o.x) * px, y: (f.y - o.y) * px, w: f.w * px, h: f.h * px }))
    .filter(f => f.x + f.w > 0 && f.y + f.h > 0 && f.x < size.width && f.y < size.height);
  dbg('scan ' + JSON.stringify({ lines: lines, fields: fields, win: win, err: note || r.boxErr || null }));
  /* debug: the screen and everything read from it, to replay a scan off screen */
  if (process.env.MATHBENCH_DEBUG) try {
    fs.writeFileSync(path.join(os.tmpdir(), 'mathbench-shot.png'), s.img.toPNG());
    fs.writeFileSync(path.join(os.tmpdir(), 'mathbench-scan.json'), JSON.stringify({ lines: lines, fields: fields, win: win, app: r.app || '', controls: (r.controls || []).map(f => Object.assign({}, f, toImg(f))), W: size.width, H: size.height }));
  } catch (e) { /* ignore */ }
  /* pictures on the page (a worksheet pasted into OneNote) and note boxes: OneNote mode types beside a problem without clicking on them */
  const images = (r.controls || []).filter(f => f && f.kind === 'image' && f.w > 120 && f.h > 120).map(toImg);
  const notes = (r.controls || []).filter(f => f && (f.kind === 'doc' || f.kind === 'edit')).map(toImg);
  return { lines: lines, fields: fields, win: win, note: note, app: r.app || '', images: images, notes: notes };
}
ipcMain.handle('assist:scan', async () => (shot && shot.scan) ? await shot.scan : { lines: [], fields: [] });
ipcMain.handle('assist:solve', async (_e, task) => solveInMain(task.image, task.opts));
ipcMain.on('assist:place', async (_e, steps) => {
  if (!shot) return;
  const s = shot, hwnd = await s.target;
  closeOverlay();
  if (!Array.isArray(steps) || !steps.length) return;
  const o = physOrigin(s.display), size = s.img.getSize(), px = (s.display.size.width * s.display.scaleFactor) / size.width;
  const saved = { text: clipboard.readText(), html: clipboard.readHTML(), image: clipboard.readImage() };
  await new Promise(r => setTimeout(r, 180));   /* let the overlay disappear */
  const P = v => Math.round(v * px), wnd = /^[1-9]\d*$/.test(hwnd || '') ? Number(hwnd) : 0;
  /* each answer: click its box (unless it goes where you were typing), clear it if asked, then type it as real keystrokes.
     OneNote mode: click a clear spot, type (OneNote makes a note box there), then drag the note box by its handle to beside the problem */
  let r = null;
  for (const st of steps) {
    if (st.onenote) {
      const cx = o.x + P(st.x), cy = o.y + P(st.y);
      r = await helperCall('act', { hwnd: wnd, keepMouse: true, steps: [{ do: 'key', key: 'ESC' }, { do: 'click', x: cx, y: cy }, { do: 'wait', ms: 250 }, { do: 'text', text: String(st.text) }, { do: 'wait', ms: 350 }] }, 30000);
      const h = await helperCall('handle', { x: cx, y: cy }, 8000);
      if (h && h.x != null) {
        const tx = o.x + P(st.tx), ty = o.y + P(st.ty);
        r = await helperCall('act', { hwnd: wnd, steps: [{ do: 'hover', x: h.x, y: h.y }, { do: 'drag', x: h.x, y: h.y, x2: h.x + (tx - cx), y2: h.y + (ty - cy) }, { do: 'key', key: 'ESC' }] }, 30000);
      }
      continue;
    }
    const acts = [];
    if (st.x != null && st.y != null) acts.push({ do: 'click', x: o.x + P(st.x), y: o.y + P(st.y), double: !!st.double });
    if (st.replace) acts.push({ do: 'key', key: 'A', ctrl: true });
    acts.push({ do: 'text', text: String(st.text) });
    r = await helperCall('act', { hwnd: wnd, steps: acts }, 30000);
  }
  setTimeout(() => {
    try {
      if (!saved.image.isEmpty()) clipboard.writeImage(saved.image);
      else if (saved.html) clipboard.write({ text: saved.text, html: saved.html });
      else clipboard.writeText(saved.text || '');
    } catch (e) { /* ignore */ }
  }, 800);
  if (r && r.error) notify('Mathbench could not type the answer', 'Click the box and try again.');
  else notify(steps.length === 1 ? 'Put ' + steps[0].text : 'Answered ' + steps.length + ' problems', steps.map(x => (x.label ? x.label + ': ' : '') + x.text).join('   '));
});

/* ---------- settings ---------- */
ipcMain.handle('settings:get', () => ({ hotkey: cfg.hotkey, mode: cfg.mode, pasteHotkey: cfg.pasteHotkey }));
ipcMain.handle('settings:save', (_e, s) => {
  const out = { ok: true, notes: [] };
  if (MODES.includes(s.mode)) cfg.mode = s.mode;
  if (typeof s.pasteHotkey === 'string' && s.pasteHotkey !== cfg.pasteHotkey) {
    const prev = cfg.pasteHotkey;
    if (prev) globalShortcut.unregister(prev);
    if (!s.pasteHotkey || registerPasteHotkey(s.pasteHotkey)) cfg.pasteHotkey = s.pasteHotkey;
    else { if (prev) registerPasteHotkey(prev); out.ok = false; out.notes.push('That solve & paste hotkey could not be used. It may be taken by another app.'); }
  }
  if (typeof s.hotkey === 'string' && s.hotkey.trim() && s.hotkey.trim() !== cfg.hotkey) {
    const prev = cfg.hotkey;
    globalShortcut.unregister(prev);
    if (registerHotkey(s.hotkey.trim())) cfg.hotkey = s.hotkey.trim();
    else { registerHotkey(prev); out.ok = false; out.notes.push('That hotkey could not be used. It may be taken by another app, or the format is wrong. Example: Control+Alt+M.'); }
  }
  saveCfg();
  buildTrayMenu();
  return out;
});
ipcMain.on('settings:open', showSettings);
/* "Capture part of screen" in the window: Mathbench steps aside so the screen behind it is what gets captured, then the overlay opens ready to drag */
ipcMain.on('capture:start', () => { if (mainWin && !mainWin.isDestroyed() && mainWin.isVisible()) mainWin.minimize(); setTimeout(() => toggleOverlay(true), 450); });
/* the button in the window: hide Mathbench first so the page you want done is the one in front */
ipcMain.on('assist:start', () => { if (mainWin && !mainWin.isDestroyed()) mainWin.minimize(); setTimeout(() => toggleOverlay(false, 'assist'), 450); });

/* ---------- hotkey and tray ---------- */
function registerHotkey(acc) {
  try { return globalShortcut.register(acc, () => { toggleOverlay(false); }); } catch (e) { return false; }
}
function registerPasteHotkey(acc) {
  try { return globalShortcut.register(acc, () => { toggleOverlay(false, 'assist'); }); } catch (e) { return false; }
}
function buildTrayMenu() {
  if (!tray) return;
  tray.setToolTip('Mathbench: ' + cfg.hotkey.replace(/Control/g, 'Ctrl') + ' to open the overlay');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open the overlay ('  + cfg.hotkey.replace(/Control/g, 'Ctrl') + ')', click: () => setTimeout(() => toggleOverlay(false), 150) },
    ...(cfg.pasteHotkey ? [{ label: 'Do it for me (' + cfg.pasteHotkey.replace(/Control/g, 'Ctrl') + ')', click: () => setTimeout(() => toggleOverlay(false, 'assist'), 150) }] : []),
    { label: 'Open Mathbench', click: openMain },
    { label: 'Settings', click: showSettings },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } }
  ]));
}

/* one Mathbench at a time; a newer version opened later takes over from an older one still running in the tray */
const ME = { version: app.getVersion() };
function isNewer(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}
function start() {
  app.on('second-instance', (_e, _argv, _cwd, other) => {
    if (other && isNewer(other.version, ME.version)) {
      quitting = true;
      globalShortcut.unregisterAll();
      if (tray) tray.destroy();
      app.quit();
    } else openMain();
  });
  app.whenReady().then(() => {
    serveApp();
    loadCfg();
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
    tray.on('click', openMain);
    if (!registerHotkey(cfg.hotkey)) {
      cfg.hotkey = DEFAULTS.hotkey;
      if (!registerHotkey(cfg.hotkey)) dialog.showErrorBox('Mathbench', 'The capture hotkey is already used by another app. Open Settings from the tray icon and pick a different one.');
    }
    if (cfg.pasteHotkey && !registerPasteHotkey(cfg.pasteHotkey)) notify('Mathbench', 'The solve & paste hotkey ' + cfg.pasteHotkey + ' is used by another app. Pick another in Settings.');
    buildTrayMenu();
    showSplashThenMain();
  });
  app.on('window-all-closed', e => { if (!quitting) e.preventDefault(); });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); try { if (helper) helper.kill(); } catch (e) { /* ignore */ } });
}
/* which version holds the lock, so a second copy knows whether to wait for it to close or simply hand over */
const runningFile = () => path.join(app.getPath('userData'), 'running.json');
const claim = () => { try { fs.mkdirSync(path.dirname(runningFile()), { recursive: true }); fs.writeFileSync(runningFile(), JSON.stringify({ version: ME.version, pid: process.pid })); } catch (e) { /* ignore */ } start(); };
if (app.requestSingleInstanceLock(ME)) claim();
else {
  let running = null;
  try { running = JSON.parse(fs.readFileSync(runningFile(), 'utf8')); } catch (e) { /* unknown */ }
  if (running && isNewer(ME.version, running.version)) {
    /* an older copy is running: it is closing now to make way, so try again for a few seconds */
    let tries = 0;
    const retry = () => {
      if (app.requestSingleInstanceLock(ME)) claim();
      else if (++tries < 8) setTimeout(retry, 600);
      else app.quit();
    };
    setTimeout(retry, 600);
  } else app.quit();   /* the same or a newer copy is running and has just shown its window: asking again would keep reopening it */
}
