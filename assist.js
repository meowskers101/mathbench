/* assist.js: "Do it for me" planning. Finds the problems and answer boxes on a screenshot and turns typed directions into a plan:
   which problem to read, how to answer it, and where to put the answer. Everything is in screenshot pixels. No DOM needed except for
   findInkBoxes/inkBands, which take a grey-level array, so the logic can be tested in Node. */
(function (root) {
'use strict';

const INSTR = /^(solve|simplify|evaluate|calculate|compute|find|factor|factorise|factorize|expand|differentiate|derive|integrate|write|express|reduce|what|is|the|value|of|for|and|then|answer|determine|work|out|show|use|each|problem|question)$/i;
const FUNCS = /^(sin|cos|tan|cot|sec|csc|log|ln|sqrt|exp|lim|abs|arcsin|arccos|arctan)$/i;
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const PLACES = { whole: 0, 'whole number': 0, integer: 0, one: 0, ones: 0, tenth: 1, tenths: 1, hundredth: 2, hundredths: 2, thousandth: 3, thousandths: 3 };

const rect = (x, y, w, h) => ({ x: x, y: y, w: w, h: h });
const right = r => r.x + r.w, bottom = r => r.y + r.h;
const cx = r => r.x + r.w / 2, cy = r => r.y + r.h / 2;
const union = (a, b) => { if (!a) return b; if (!b) return a; const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return rect(x, y, Math.max(right(a), right(b)) - x, Math.max(bottom(a), bottom(b)) - y); };
const yOverlap = (a, b) => Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y));
const xOverlap = (a, b) => Math.max(0, Math.min(right(a), right(b)) - Math.max(a.x, b.x));
const inter = (a, b) => xOverlap(a, b) * yOverlap(a, b);
const iou = (a, b) => { const i = inter(a, b); return i / (a.w * a.h + b.w * b.h - i || 1); };

/* ---------- reading the page ---------- */

/* a problem number at the start of a line: "3.", "3)", "(3)", "#3", "Q3", "Problem 3", "Question 3:" */
function markerOf(words) {
  if (!words.length) return null;
  const fix = t => t.replace(/^\(?[lI|!]([.):])$/, '1$1').replace(/^[lI|]$/, '1').replace(/^O([.):])$/, '0$1');
  const a = fix(words[0].t), b = words[1] && fix(words[1].t);
  let m = /^\(?#?(\d{1,3})[.):]$/.exec(a) || /^#(\d{1,3})$/.exec(a) || /^Q(\d{1,3})[.):]?$/i.exec(a);
  if (m) return { n: +m[1], words: 1 };
  if (/^(problem|question|exercise|no\.?)$/i.test(a) && b && (m = /^#?(\d{1,3})[.):]?$/.exec(b))) return { n: +m[1], words: 2 };
  return null;
}
/* does a line hold maths? an equation, an operator between numbers or letters, a fraction, a power, f(x) …
   Prose, dates, times, page numbers and headings with a number in them do not count. */
const VERBS = /^(solve|simplify|evaluate|calculate|compute|find|factor|factorise|factorize|expand|differentiate|integrate|graph|plot|write|show|given|let|if|then|for|and|the|of|is|what|when|where|each|problem|question|answer|round|nearest|tenth|hundredth|exact|value|values|express|determine)$/i;
function isMathLine(text) {
  let t = ' ' + String(text || '') + ' ';
  t = t.replace(/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/g, ' ').replace(/\b\d{1,2}:\d{2}(\s*[AaPp][Mm])?\b/g, ' ')   /* dates, times */
    .replace(/\b(page|unit|chapter|lesson|section|week|day|period|grade|room|class|part|level|step)\s+\d+\b/gi, ' ')   /* "Unit 3" */
    .replace(/^\s*\(?#?\d{1,3}[.):]\s/, ' ')   /* the problem's own number */
    .replace(/\S*[\/\\]\S*[\/\\]\S*|\S+\.(com|org|net|edu|gov|io|html?|pdf|docx?)\b\S*|\b(https?|file|www)\S*/gi, ' ');   /* web addresses and file paths */
  const toks = t.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return false;
  const prose = toks.filter(w => /^[A-Za-z']{3,}[.,:;!?)]*$/.test(w) && !FUNCS.test(w.replace(/[^A-Za-z]/g, '')) && !VERBS.test(w.replace(/[^A-Za-z]/g, ''))).length;
  const relation = /[=<>≤≥≠]/.test(t);
  /* an operator between two operands: numbers, single letters (x, y), 2x, brackets, π, √ */
  const op = /(?:\d|\b[a-z]\b|[a-z]\d|\d[a-z]|\)|\]|π|√)\s*[+\-−–*×·÷/^]\s*(?:\d|\b[a-z]\b|\(|\[|π|√|-)/i.test(t);
  const fn = /\b[a-zA-Z]\s*\(\s*[^()\s]{1,12}\s*\)/.test(t) && /[0-9=+\-^]|\b[a-z]\b/.test(t.replace(/\b[a-zA-Z]\s*\(/g, ''));
  const power = /[A-Za-z0-9)]\s*(\^|[²³⁴⁵⁶⁷⁸⁹])/.test(t) || /√|π|∫|Σ|∑/.test(t) || /\b(sin|cos|tan|cot|sec|csc|log|ln|sqrt|exp|lim)\s*\(?\s*[a-z0-9(]/i.test(t);
  const mathy = relation || op || fn || power;
  if (!mathy) return false;
  const mathToks = toks.filter(w => /[0-9=+\-−*×÷/^()√π²³<>]/.test(w) || /^[a-z]$/i.test(w)).length;
  return prose <= Math.max(2, mathToks);
}
/* a line the text reader read as ordinary words ("Read chapter 3 before Friday"), as opposed to maths it may have garbled */
function isProse(text) {
  const t = String(text || '').replace(/^\s*\(?#?\d{1,3}[.):]\s*/, '');
  if (isMathLine(t)) return false;
  const words = t.split(/\s+/).filter(w => /^[A-Za-z']{3,}[.,:;!?)]*$/.test(w) && !FUNCS.test(w.replace(/[^A-Za-z]/g, '')) && !VERBS.test(w.replace(/[^A-Za-z]/g, '')));
  return words.length >= 2;
}
/* a word problem: a sentence or two with numbers in it that asks for something ("How many tickets…?", "Find the width.") */
function isWordProblem(text) {
  const t = String(text || '');
  return /\d/.test(t) && (t.match(/[A-Za-z']{3,}/g) || []).length >= 6 &&
    (/\?/.test(t) || /\b(how\s+(many|much|long|far|old|fast|tall)|what\s+(is|was|are|were)|find|calculate|determine|work\s+out)\b/i.test(t));
}
const isWordy = t => /^[A-Za-z]{2,}[:,.]?$/.test(t) && !FUNCS.test(t.replace(/[:,.]$/, ''));
const isVarColon = t => /^[a-z]:$/i.test(t);

/* lines rebuilt from the text reader's words: it can join words across two columns, and the screen is read in
   overlapping tiles, so the same word can come twice and a line can be cut at a tile edge */
function prepLines(lines) {
  /* 1. the reader's own lines, split where a gap is as wide as a column gutter */
  let segs = [];
  (lines || []).forEach(l => {
    const ws = (l.words || []).filter(w => w.w > 0 && w.h > 0 && String(w.t).trim()).map(w => ({ t: String(w.t), r: rect(w.x, w.y, w.w, w.h) })).sort((a, b) => a.r.x - b.r.x);
    if (!ws.length) return;
    const H = median(ws.map(w => w.r.h));
    let cur = [ws[0]];
    for (let i = 1; i < ws.length; i++) { if (ws[i].r.x - right(ws[i - 1].r) > 5 * H) { segs.push(cur); cur = []; } cur.push(ws[i]); }
    segs.push(cur);
  });
  /* 2. the same words read twice by overlapping tiles: keep one */
  const seen = [];
  segs = segs.map(sg => sg.filter(w => { if (seen.some(q => inter(q.r, w.r) > 0.6 * Math.min(q.r.w * q.r.h, w.r.w * w.r.h))) return false; seen.push(w); return true; })).filter(sg => sg.length);
  /* 3. pieces of one line cut at a tile edge: join pieces on the same row that nearly touch */
  const box = sg => sg.reduce((u, w) => union(u, w.r), null);
  segs.sort((a, b) => box(a).x - box(b).x);
  const out = [];
  segs.forEach(sg => {
    const r = box(sg), H = median(sg.map(w => w.r.h));
    const hit = out.find(o => { const R = box(o); return yOverlap(R, r) > 0.5 * Math.min(R.h, r.h) && r.x - right(R) < 1.5 * H && r.x - right(R) > -0.5 * H; });
    if (hit) hit.push.apply(hit, sg); else out.push(sg.slice());
  });
  return out.map(ws => ({ words: ws })).map(l => {
    let box = null; l.words.forEach(w => { box = union(box, w.r); });
    return { t: l.words.map(w => w.t).join(' '), words: l.words, r: box };
  }).sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
}

/* rows of ink inside a column of the picture: [{y0, y1, x0, x1}] (grey: Uint8Array w*h) */
function inkBands(grey, W, H, x0, x1, y0, y1, bg) {
  x0 = Math.max(0, x0 | 0); x1 = Math.min(W, x1 | 0); y0 = Math.max(0, y0 | 0); y1 = Math.min(H, y1 | 0);
  const out = []; let cur = null;
  for (let y = y0; y < y1; y++) {
    let n = 0, lo = -1, hi = -1;
    for (let x = x0, i = y * W + x0; x < x1; x++, i++) if (Math.abs(grey[i] - bg) > 70) { n++; if (lo < 0) lo = x; hi = x; }
    if (n >= 2) { if (!cur) cur = { y0: y, y1: y + 1, x0: lo, x1: hi + 1 }; else { cur.y1 = y + 1; cur.x0 = Math.min(cur.x0, lo); cur.x1 = Math.max(cur.x1, hi + 1); } }
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.filter(b => b.y1 - b.y0 >= 6);
}

/* a band two lines tall (lines packed with no blank row between): split it at its thinnest row, so each line is read on its own */
function splitTall(bands, grey, W, bg, lh) {
  const out = [];
  const go = b => {
    if (b.y1 - b.y0 <= 1.4 * lh) { out.push(b); return; }
    const rowInk = y => { let n = 0; for (let x = b.x0, i = y * W + b.x0; x < b.x1; x++, i++) if (Math.abs(grey[i] - bg) > 70) n++; return n; };
    const ink = []; for (let y = b.y0; y < b.y1; y++) ink.push(rowInk(y));
    const on = ink.filter(n => n > 0).sort((p, q) => p - q), typical = on[Math.floor(on.length * 0.75)] || 0;   /* a row through the body of the text */
    /* the emptiest row away from the edges */
    let best = -1, bn = 1e9;
    for (let k = Math.round(0.4 * lh); k < ink.length - 0.4 * lh; k++) if (ink[k] < bn) { bn = ink[k]; best = k; }
    /* a gap between lines is far emptier than a row through a line (a stacked fraction has ink all the way down),
       and leaves a whole line on each side (a raised power above a line is only a few faint rows) */
    const body = (a, z) => ink.slice(a, z).filter(n => n >= 0.3 * typical).length;
    if (best < 0 || bn > Math.max(2, 0.3 * typical) || body(0, best) < 0.2 * lh || body(best + 1, ink.length) < 0.2 * lh) { out.push(b); return; }
    best += b.y0;
    go({ x0: b.x0, x1: b.x1, y0: b.y0, y1: best }); go({ x0: b.x0, x1: b.x1, y0: best + 1, y1: b.y1 });
  };
  bands.forEach(go);
  return out;
}

function pageBackground(grey) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < grey.length; i += 7) hist[grey[i]]++;
  let best = 255; for (let v = 0; v < 256; v++) if (hist[v] > hist[best]) best = v;
  return best;
}

/* rectangles drawn on the page that look like empty answer boxes, and ____ blanks */
function findInkBoxes(grey, W, H, bg) {
  const diff = (x, y) => Math.abs(grey[y * W + x] - bg);
  const segs = [];
  for (let y = 1; y < H - 1; y++) {
    let x = 0;
    while (x < W) {
      if (diff(x, y) > 28) {
        const s = x; while (x < W && diff(x, y) > 28) x++;
        const len = x - s;
        if (len >= 36 && len < W * 0.6) segs.push({ y: y, x0: s, x1: x });
      } else x++;
    }
  }
  /* merge the rows of a thick line */
  const lines = [];
  segs.forEach(s => {
    const l = lines.find(q => s.y - q.y1 <= 1 && Math.abs(q.x0 - s.x0) <= 2 && Math.abs(q.x1 - s.x1) <= 2);
    if (l) l.y1 = s.y; else lines.push({ y0: s.y, y1: s.y, x0: s.x0, x1: s.x1 });
  });
  const thin = lines.filter(l => l.y1 - l.y0 <= 4);
  const boxes = [], used = new Set();
  const colInk = (x, ya, yb) => { let n = 0; for (let y = ya; y <= yb; y++) if (diff(x, y) > 28) n++; return n / Math.max(1, yb - ya + 1); };
  for (let i = 0; i < thin.length; i++) {
    const t = thin[i];
    for (let j = i + 1; j < thin.length; j++) {
      const b = thin[j], gap = b.y0 - t.y1;
      if (gap > 140) break;
      if (gap < 12 || Math.abs(b.x0 - t.x0) > 3 || Math.abs(b.x1 - t.x1) > 3) continue;
      /* the sides: rounded corners keep the top and bottom lines a few pixels short of them */
      let xl = Math.min(t.x0, b.x0), xr = Math.max(t.x1, b.x1) - 1, edge = 0, edgeR = 0;
      const ya = t.y1 + 2, yb = b.y0 - 2;
      for (let x = Math.max(0, xl - 7); x <= xl + 2; x++) { const v = colInk(x, ya, yb); if (v > edge) { edge = v; if (v >= 0.8) { xl = x; break; } } }
      for (let x = Math.min(W - 1, xr + 7); x >= xr - 2; x--) { const v = colInk(x, ya, yb); if (v > edgeR) { edgeR = v; if (v >= 0.8) { xr = x; break; } } }
      if (edge < 0.8 || edgeR < 0.8) continue;
      /* inside: page-coloured or white, with at most a little text (a placeholder) */
      let n = 0, ink = 0, sum = 0;
      for (let y = t.y1 + 3; y < b.y0 - 2; y += 2) for (let x = xl + 4; x < xr - 3; x += 2) { const g = grey[y * W + x]; sum += g; n++; if (Math.abs(g - bg) > 60) ink++; }
      if (!n) continue;
      const mean = sum / n;
      if (ink / n > 0.12 || (Math.abs(mean - bg) > 40 && mean < 225)) continue;
      boxes.push({ r: rect(xl, t.y0, xr - xl + 1, b.y1 - t.y0 + 1), kind: 'drawn' });
      used.add(i); used.add(j);
      break;
    }
  }
  /* ____ blanks: a lone thin line with empty space above it */
  thin.forEach((l, i) => {
    if (used.has(i) || l.x1 - l.x0 < 50 || l.x1 - l.x0 > 500) return;
    /* the top or bottom edge of a box has sides running down or up from its ends */
    const side = (x, ya, yb) => { let n = 0; for (let y = ya; y <= yb; y++) if (y > 0 && y < H && diff(x, y) > 28) n++; return n >= (yb - ya) * 0.7; };
    for (let d = -7; d <= 3; d++) for (const x of [l.x0 + d, l.x1 - 1 - d]) if (x > 0 && x < W && (side(x, l.y1 + 3, l.y1 + 11) || side(x, l.y0 - 11, l.y0 - 3))) return;
    if (boxes.some(b => l.y0 >= b.r.y - 2 && l.y0 <= bottom(b.r) + 2 && l.x0 >= b.r.x - 2 && l.x1 <= right(b.r) + 2)) return;
    let ink = 0, n = 0;
    for (let y = Math.max(0, l.y0 - 22); y < l.y0 - 2; y += 2) for (let x = l.x0; x < l.x1; x += 3) { n++; if (diff(x, y) > 60) ink++; }
    if (n && ink / n < 0.02 && l.y0 > 22) boxes.push({ r: rect(l.x0, l.y0 - 24, l.x1 - l.x0, 26), kind: 'blank' });
  });
  return dedupe(boxes);
}

function dedupe(boxes) {
  const out = [];
  boxes.forEach(b => {
    const o = out.find(q => iou(q.r, b.r) > 0.5 || (inter(q.r, b.r) > 0.8 * Math.min(q.r.w * q.r.h, b.r.w * b.r.h)));
    if (!o) out.push(b);
    else if (b.kind === 'field' && o.kind !== 'field') Object.assign(o, b);   /* a real text field beats a drawn one */
  });
  return out;
}

/* page = { lines (text reader), fields (text boxes from Windows accessibility), choices (radio buttons), grey, W, H } */
function analyse(page) {
  const win = page.win ? rect(Math.max(0, page.win.x), Math.max(0, page.win.y), page.win.w, page.win.h) : null;
  const inWin = r => !win || inter(win, r) > 0.6 * r.w * r.h;
  /* answer spots you wrote yourself: "1 here", "#2 here", "answer 3", "ans 4" mark where that problem's answer goes */
  const spots = [], worths = [];
  const lines = prepLines(page.lines).filter(l => inWin(l.r)).filter(l => {
    const t = l.t.trim();
    /* a question's worth ("1 pts", "2 points", "(3 marks)") is not maths */
    if (/^\(?\d+(?:\.\d+)?\s*(?:pts?|points?|marks?)\)?\.?$/i.test(t)) { worths.push(l); return false; }
    const m = /^(?:#|no\.?\s*|q)?(\d{1,3})[.):]?\s*(?:-|:|=|→)?\s*(here|answer here|ans here)\s*[.:!]*$/i.exec(t) || /^(?:answer|ans)\s*(?:#|no\.?\s*)?(\d{1,3})\s*[:=]?\s*(here)?\s*$/i.exec(t);
    if (!m) return true;
    const word = l.words.find(w => /^here[.:!]*$/i.test(w.t));
    spots.push({ n: +m[1], kind: 'spot', r: word ? word.r : rect(right(l.r) + 4, l.r.y, Math.max(20, l.r.h), l.r.h), word: !!word, name: t });
    return false;
  });
  const bg = page.grey ? pageBackground(page.grey) : 255;
  /* what Windows accessibility lists: text boxes, buttons and links, radio buttons and check boxes */
  const ctl = (page.controls || []).filter(c => c && c.w > 0 && inWin(rect(c.x, c.y, c.w, c.h))).map(c => Object.assign({}, c, { r: rect(c.x, c.y, c.w, c.h), name: String(c.name || '').trim() }));
  const fields = (page.fields || []).concat(ctl.filter(c => c.kind === 'edit' || c.kind === 'combo'));
  const buttons = ctl.filter(c => /^(button|link|menu|tab|item)$/.test(c.kind) && c.name);
  const radios = ctl.filter(c => c.kind === 'radio' || c.kind === 'check');
  /* a text box that already holds a sentence or more (a block of notes in OneNote, a document) is not an answer box */
  let boxes = fields.filter(f => !/address|search|url|location/i.test(f.name || '') && String(f.value || '').trim().length <= 40 && !/\n/.test(String(f.value || '').trim())).map(f => ({ r: f.r || rect(f.x, f.y, f.w, f.h), kind: 'field', name: f.name || '', value: f.value || '', focus: !!f.focus, combo: f.kind === 'combo' }));
  if (page.grey) boxes = dedupe(boxes.concat(findInkBoxes(page.grey, page.W, page.H, bg)));
  /* a drawn rectangle that is really a button or a choice is not an answer box */
  boxes = boxes.filter(b => inWin(b.r) && (b.kind === 'field' || !buttons.concat(radios).some(c => inter(c.r, b.r) > 0.4 * Math.min(c.r.w * c.r.h, b.r.w * b.r.h))));
  lines.forEach(l => l.words.forEach(w => { if (/^_{3,}$/.test(w.t)) boxes = dedupe(boxes.concat([{ r: rect(w.r.x, w.r.y - 6, w.r.w, w.r.h + 6), kind: 'blank' }])); }));
  /* the spots you marked win over any box they sit in (OneNote reports each block of text as a text box) */
  boxes = boxes.filter(b => !spots.some(s => inter(s.r, b.r) > 0.3 * s.r.w * s.r.h)).concat(spots);
  /* boxes sitting on a line split that line's words: text inside a box is not part of the problem */
  const inBox = r => boxes.some(b => inter(b.r, r) > 0.5 * r.w * r.h);

  /* problems: lines that start with a number marker; a problem runs down its own column until the next number there */
  let marks = [];
  /* a numbered line of ordinary words ("1. Read chapter 3 before Friday") is a to-do list in notes, not a problem */
  /* with Mathbench AI installed, a numbered item of words can be a word problem (kept below only if it reads like one) */
  lines.forEach((l, i) => { const m = markerOf(l.words); if (m && (!isProse(l.t) || page.ai)) marks.push({ line: i, n: m.n, words: m.words, x: l.words[0].r.x, y: l.r.y }); });
  /* columns of numbers (worksheets often have two): numbers whose left edges line up */
  const columnsOf = ms => {
    const cols = [];
    ms.slice().sort((p, q) => p.x - q.x).forEach(m => { const c = cols.find(c => Math.abs(c.x - m.x) <= 20); if (c) { c.ms.push(m); c.x = c.ms.reduce((t, q) => t + q.x, 0) / c.ms.length; } else cols.push({ x: m.x, ms: [m] }); });
    return cols;
  };
  let cols = columnsOf(marks);
  /* a number glued to its problem ("1.2x+5=17"): trust it only in a column of other numbers, when that number is missing */
  if (marks.length >= 2) {
    lines.forEach((l, i) => {
      if (marks.some(m => m.line === i)) return;
      const w = l.words[0], g = /^\(?(\d{1,3})[.)](?=\S)/.exec(w.t);
      if (!g || !cols.some(c => c.ms.length >= 1 && Math.abs(w.r.x - c.x) <= 14)) return;
      const n = +g[1];
      if (marks.some(m => m.n === n) || n > Math.max.apply(null, marks.map(m => m.n)) + cols.length) return;
      marks.push({ line: i, n: n, words: 1, x: w.r.x, y: l.r.y, glued: w.r.x + w.r.w * g[0].length / w.t.length });
    });
  }
  /* a whole column read glued ("4.x/4=3", "5.5x=2x+9", "6.10-2x=4"): numbers lined up that count 4, 5, 6 down the page */
  {
    const cands = [];
    lines.forEach((l, i) => {
      if (marks.some(m => m.line === i)) return;
      const w = l.words[0], g = /^\(?(\d{1,3})[.)](?=\S)/.exec(w.t);
      if (g && !marks.some(m => m.n === +g[1])) cands.push({ line: i, n: +g[1], words: 1, x: w.r.x, y: l.r.y, glued: w.r.x + w.r.w * g[0].length / w.t.length });
    });
    columnsOf(cands).forEach(c => {
      const run = c.ms.slice().sort((a, b) => a.y - b.y);
      if (run.length >= 2 && run.every((m, k) => k === 0 || m.n === run[k - 1].n + 1)) run.forEach(m => marks.push(m));
    });
  }
  /* a lone number far from the others (a page number, a date) is not a problem number when there are columns of them */
  if (marks.length > 2) { cols = columnsOf(marks); const big = Math.max.apply(null, cols.map(c => c.ms.length)); if (big >= 2) marks = marks.filter(m => cols.find(c => c.ms.includes(m)).ms.length >= 2 || !marks.some(o => o !== m && o.n === m.n)); }
  /* the same number twice: keep the one in the bigger column */
  cols = columnsOf(marks);
  marks = marks.filter(m => !marks.some(o => o !== m && o.n === m.n && cols.find(c => c.ms.includes(o)).ms.length > cols.find(c => c.ms.includes(m)).ms.length));
  cols = columnsOf(marks).sort((p, q) => p.x - q.x);
  /* the text size of the problems themselves (menus and tabs use smaller text) */
  const lh = marks.length ? median(marks.map(m => lines[m.line].r.h)) : lines.length ? median(lines.map(l => l.r.h)) : 20;
  const W0 = win ? win.x : 0, W1 = win ? right(win) : (page.W || 1e5);
  cols.forEach((c, k) => { c.x0 = c.x - 0.6 * lh; c.x1 = k + 1 < cols.length ? cols[k + 1].x - 0.6 * lh : W1; });
  const colOf = x => cols.find(c => x >= c.x0 && x < c.x1) || null;
  const problems = [];
  marks.forEach(m => {
    const l = lines[m.line];
    let mr = m.glued != null ? m.glued : right(l.words[m.words - 1].r);
    /* the reader's box can stop short of the number's ink ("10)" boxed as "10"): when ink runs on from the box edge, the number ends where that ink stops */
    if (page.grey && m.glued == null) {
      const g = page.grey, W = page.W, y0 = Math.max(0, Math.round(l.r.y)), y1 = Math.min(page.H, Math.round(bottom(l.r)));
      const inkCol = x => { for (let y = y0; y < y1; y++) if (Math.abs(g[y * W + x] - bg) > 70) return true; return false; };
      /* the number's own ink: the first group of ink near where the reader put it (its box can be shifted or short), up to a clear gap.
         A group wider than a number ran into the maths ("11)h(x)" with little space): then keep the reader's edge */
      const w0 = l.words[0].r.x;
      let x = Math.max(0, Math.round(w0 - 0.5 * lh)), s0 = -1, last = -1, gap = 0;
      for (; x < Math.min(W, w0 + 4 * lh); x++) {
        if (inkCol(x)) { if (s0 < 0) s0 = x; last = x; gap = 0; }
        else if (s0 >= 0 && ++gap >= 0.3 * lh) break;
      }
      if (s0 >= 0 && last - s0 < 1.6 * lh && last > mr - 0.5 * lh && gap >= 0.3 * lh) mr = Math.max(mr, last);
    }
    problems.push({ n: m.n, line: l, markerRight: mr, glued: m.glued != null, x: l.r.x, y: l.r.y, r: l.r, col: colOf(m.x) });
  });
  /* a whole column the text reader missed (it skips lines and glues "6." onto "10"): beside the problems already found, on the same rows,
     ink that starts with a narrow number-shaped mark at one shared left edge. Numbered on from the column we know:
     1, 2, 3 down the first column means 4, 5, 6 down this one; 1, 3, 5 means 2, 4, 6 */
  if (page.grey && problems.length >= 2 && cols.length === 1) {
    const g = page.grey, W = page.W, H = page.H;
    const inkAt = (x, y0, y1) => { for (let y = Math.max(0, y0 | 0); y < Math.min(H, y1 | 0); y++) if (Math.abs(g[y * W + x] - bg) > 70) return true; return false; };
    const xEnd = win ? right(win) : W;
    const starts = [];
    problems.slice().sort((a, b) => a.y - b.y).forEach(p => {
      const y0 = p.r.y - 0.2 * lh, y1 = bottom(p.r) + 0.2 * lh;
      /* the problem's own ink ends at a wide gap; the next ink after it starts the neighbour */
      let x = Math.round(right(p.r)), blank = 0;
      while (x < xEnd - 1 && blank < 3 * lh) { if (inkAt(x, y0, y1)) blank = 0; else blank++; x++; }
      while (x < xEnd - 1 && !inkAt(x, y0, y1)) x++;
      if (x >= xEnd - 1) return;
      /* the edge of an answer box is not a number */
      if (boxes.some(b => x >= b.r.x - 6 && x <= right(b.r) + 6 && y0 < bottom(b.r) && y1 > b.r.y)) return;
      /* a number-shaped mark: narrow, one line tall, then a gap */
      let xe = x, gap = 0;
      for (let k = x; k < Math.min(xEnd, x + 3 * lh); k++) { if (inkAt(k, y0, y1)) { xe = k; gap = 0; } else if (++gap >= 0.35 * lh) break; }
      /* a question's worth at the far right ("1 pts") also starts with a narrow number */
      const worth = worths.some(l => l.r.x <= x + 4 && right(l.r) >= x && l.r.y < y1 && bottom(l.r) > y0);
      if (!worth && xe - x < 1.6 * lh && gap >= 0.35 * lh) starts.push({ p: p, x: x, xe: xe, y0: y0, y1: y1 });
    });
    const groups = [];
    starts.forEach(s => { const gp = groups.find(gq => Math.abs(gq.x - s.x) <= 8); if (gp) gp.items.push(s); else groups.push({ x: s.x, items: [s] }); });
    const gp = groups.filter(gq => gq.items.length >= 2).sort((a, b) => b.items.length - a.items.length)[0];
    if (gp) {
      const left = problems.slice().sort((a, b) => a.y - b.y), maxN = Math.max.apply(null, left.map(p => p.n));
      const down = left.every((p, k) => k === 0 || p.n === left[k - 1].n + 1);
      const col = { x: gp.x, ms: [], x0: gp.x - 0.6 * lh, x1: cols[0].x1 };
      cols[0].x1 = col.x0; cols.push(col);
      gp.items.forEach(s => {
        const k = left.indexOf(s.p);
        const n = down ? maxN + 1 + gp.items.filter(o => o.y0 < s.y0).length : s.p.n + 1;
        if (problems.some(p => p.n === n)) return;
        problems.push({ n: n, line: null, markerRight: null, x: s.x, y: s.p.r.y, r: rect(s.x, s.y0, xEnd - s.x, s.y1 - s.y0), col: col, guessed: true });
      });
    }
  }
  /* the worksheet's grid, from the ink: when the text reader missed most numbers (small print), each problem still starts
     with a narrow number-shaped mark after a blank gap. Blocks are lined up in rows and columns and numbered from the numbers
     that were read ("10)" bottom right of a 2 x 3 grid means 5, 6 / 7, 8 / 9, 10, numbered across the rows) */
  if (page.grey && problems.length >= 1) {
    const g = page.grey, W = page.W, H = page.H, X0 = Math.max(0, W0), X1 = Math.min(W, W1);
    const Y0 = win ? Math.max(0, win.y) : 0, Y1 = win ? Math.min(H, bottom(win)) : H;
    /* ink, without ruled lines: the border of a pasted worksheet picture or a long underline is not text */
    const ink = new Uint8Array(W * H);
    for (let y = Y0; y < Y1; y++) for (let x = X0, i = y * W + X0; x < X1; x++, i++) if (Math.abs(g[i] - bg) > 70) ink[i] = 1;
    const longV = 4 * lh, longH = 12 * lh;
    for (let x = X0; x < X1; x++) { let s = -1; for (let y = Y0; y <= Y1; y++) { const on = y < Y1 && ink[y * W + x]; if (on && s < 0) s = y; else if (!on && s >= 0) { if (y - s > longV) for (let k = s; k < y; k++) ink[k * W + x] = 2; s = -1; } } }
    for (let y = Y0; y < Y1; y++) { let s = -1; for (let x = X0; x <= X1; x++) { const on = x < X1 && ink[y * W + x] === 1; if (on && s < 0) s = x; else if (!on && s >= 0) { if (x - s > longH) for (let k = s; k < x; k++) ink[y * W + k] = 2; s = -1; } } }
    const colInk = (x, y0, y1) => { for (let y = y0; y < y1; y++) if (ink[y * W + x] === 1) return true; return false; };
    const rowsAll = [];
    { let cur = null;
      for (let y = Y0; y < Y1; y++) {
        let lo = -1, hi = -1, n = 0;
        for (let x = X0, i = y * W + X0; x < X1; x++, i++) if (ink[i] === 1) { n++; if (lo < 0) lo = x; hi = x; }
        if (n >= 2) { if (!cur) cur = { y0: y, y1: y + 1, x0: lo, x1: hi + 1 }; else { cur.y1 = y + 1; cur.x0 = Math.min(cur.x0, lo); cur.x1 = Math.max(cur.x1, hi + 1); } }
        else if (cur) { rowsAll.push(cur); cur = null; }
      }
      if (cur) rowsAll.push(cur); }
    for (let k = rowsAll.length - 1; k >= 0; k--) { const h = rowsAll[k].y1 - rowsAll[k].y0; if (h < 0.4 * lh || h > 2.5 * lh) rowsAll.splice(k, 1); }
    /* each row split into pieces at wide gaps (the columns) */
    const segs = [];
    rowsAll.forEach(b => {
      let s = -1, e = -1, blank = 0;
      for (let x = b.x0; x <= b.x1; x++) {
        const ink = x < b.x1 && colInk(x, b.y0, b.y1);
        if (ink) { if (s < 0) s = x; e = x; blank = 0; }
        else if (s >= 0 && (++blank >= 2.5 * lh || x === b.x1)) { segs.push({ x0: s, x1: e + 1, y0: b.y0, y1: b.y1 }); s = -1; blank = 0; }
      }
    });
    /* a piece two lines tall (a problem's lines packed with no gap, "f(x) = x³ + 5x²" over "g(x) = …"): one piece per line */
    for (let k = segs.length - 1; k >= 0; k--) if (segs[k].y1 - segs[k].y0 > 1.3 * lh) { const parts = splitTall([segs[k]], g, W, bg, lh); if (parts.length > 1) segs.splice(k, 1, ...parts); }
    const numberShaped = sg => {
      let xe = sg.x0, gap = 0;
      for (let x = sg.x0; x < Math.min(sg.x1, sg.x0 + 3 * lh); x++) { if (colInk(x, sg.y0, sg.y1)) { xe = x; gap = 0; } else if (++gap >= 0.35 * lh) break; }
      return xe - sg.x0 < 1.6 * lh && gap >= 0.35 * lh && sg.x1 - sg.x0 > 3 * lh;
    };
    const sr = sg => rect(sg.x0, sg.y0, sg.x1 - sg.x0, sg.y1 - sg.y0);
    const starts = segs.filter(sg => numberShaped(sg) && !inBox(sr(sg)) &&
      /* the first line of a block: nothing just above it in that column (a sentence of instructions above the first problem does not count) */
      !segs.some(o => o !== sg && o.y1 <= sg.y0 && sg.y0 - o.y1 < 1.5 * lh && o.x0 < sg.x1 && o.x1 > sg.x0 && !lines.some(l => yOverlap(l.r, sr(o)) > 0.5 * (o.y1 - o.y0) && xOverlap(l.r, sr(o)) > 0 && isProse(l.t))) &&
      !lines.some(l => yOverlap(l.r, sr(sg)) > 0.5 * (sg.y1 - sg.y0) && xOverlap(l.r, sr(sg)) > 0 && isProse(l.t)) &&
      !worths.some(l => inter(l.r, sr(sg)) > 0));
    /* a problem's first line is about one text line tall and not page-wide (a ribbon, a search box and a page list are not problems) */
    for (let k = starts.length - 1; k >= 0; k--) { const s = starts[k], h = s.y1 - s.y0; if (h < 0.6 * lh || h > 1.3 * lh || s.x1 - s.x0 > 14 * lh) starts.splice(k, 1); }
    {   /* and it lines up with other problems: a column of one, beside columns of several, is something else */
      const cl = [];
      starts.forEach(s => { const c = cl.find(c => Math.abs(c.x - s.x0) < 1.5 * lh); if (c) c.ss.push(s); else cl.push({ x: s.x0, ss: [s] }); });
      if (cl.some(c => c.ss.length >= 2)) cl.filter(c => c.ss.length < 2).forEach(c => c.ss.forEach(s => starts.splice(starts.indexOf(s), 1)));
    }
    if (starts.length >= 2) {
      const gcols = [], grows = [];
      starts.slice().sort((a, b) => a.x0 - b.x0).forEach(s => { const c = gcols.find(c => Math.abs(c.x - s.x0) < 1.5 * lh); if (c) c.ss.push(s); else gcols.push({ x: s.x0, ss: [s] }); });
      starts.slice().sort((a, b) => a.y0 - b.y0).forEach(s => { const r = grows.find(r => Math.abs(r.y - s.y0) < lh); if (r) r.ss.push(s); else grows.push({ y: s.y0, ss: [s] }); });
      const C = gcols.length, R = grows.length;
      const at = s => ({ c: gcols.findIndex(c => c.ss.includes(s)), r: grows.findIndex(r => r.ss.includes(s)) });
      /* which read number sits on which block */
      const anchors = [];
      problems.forEach(p => { const s = starts.find(s => Math.abs(s.y0 - p.y) < lh && Math.abs(p.x - s.x0) < 2 * lh); if (s) anchors.push({ s: s, n: p.n }); });
      const schemes = [(c, r) => r * C + c, (c, r) => c * R + r];
      let best = null;
      schemes.forEach((f, k) => {
        if (k === 1 && C === 1) return;
        const bases = anchors.map(a => { const q = at(a.s); return a.n - f(q.c, q.r); });
        const base = anchors.length ? bases[0] : 1;
        if (bases.every(b => b === base) && base >= 1 && (!best || anchors.length > best.agree)) best = { f: f, base: base, agree: anchors.length };
      });
      if (best && best.agree >= 1) {
        /* the grid's columns become the page's columns */
        if (C > cols.length) {
          cols = gcols.map(c => ({ x: c.x, ms: [] }));
          /* the last column ends a little past its own text, not at the window's edge (a page list or sidebar may be there) */
          cols.forEach((c, k) => { c.x0 = c.x - 0.6 * lh; c.x1 = k + 1 < cols.length ? cols[k + 1].x - 0.6 * lh : Math.min(W1, Math.max.apply(null, gcols[k].ss.map(s => s.x1)) + 8 * lh); });
          problems.forEach(p => { p.col = cols.slice().sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0]; });   /* nearest: "10)" sticks out left of its column */
        }
        /* whatever columns there are, the last ends a little past its own problems' text, not at the window's edge (a page list may be there) */
        { const last = cols.slice().sort((a, b) => b.x - a.x)[0], gl = gcols.slice().sort((a, b) => b.x - a.x)[0];
          if (last && gl && Math.abs(last.x - gl.x) < 3 * lh) last.x1 = Math.min(last.x1, Math.max.apply(null, gl.ss.map(s => s.x1)) + 8 * lh); }
        starts.forEach(s => {
          const q = at(s), n = best.base + best.f(q.c, q.r);
          if (problems.some(p => p.n === n) || problems.some(p => Math.abs(p.y - s.y0) < lh && Math.abs(p.x - s.x0) < 2 * lh)) return;
          const col = cols.find(c => s.x0 >= c.x0 && s.x0 < c.x1) || cols[0];
          problems.push({ n: n, line: null, markerRight: null, x: s.x0, y: s.y0, r: sr(s), col: col, guessed: true });
        });
      }
    }
  }
  /* numbers the text reader missed: a gap in 1, 2, 3 … filled from ink where that number should be, in its column */
  if (page.grey && problems.length && cols.length) {
    const C = cols.length, maxFound = Math.max.apply(null, problems.map(p => p.n));
    /* numbered across the rows (1 left, 2 right) or down each column (1, 2 left; 3, 4 right) */
    const acrossRows = C > 1 && problems.every(p => cols.indexOf(p.col) === (p.n - 1) % C);
    const columnFor = n => {
      if (C === 1) return cols[0];
      if (acrossRows) return cols[(n - 1) % C];
      let best = cols[0], bd = Infinity;
      cols.forEach(c => { const ns = problems.filter(p => p.col === c).map(p => p.n); if (!ns.length) return; const lo = Math.min.apply(null, ns), hi = Math.max.apply(null, ns); const d = n < lo ? lo - n : n > hi ? n - hi : 0; if (d < bd) { bd = d; best = c; } });
      return best;
    };
    const rows = (c, yA, yB) => inkBands(page.grey, page.W, page.H, Math.max(0, c.x - 0.6 * lh), Math.min(page.W, c.x1), yA, yB, bg)
      .filter(b => b.y1 - b.y0 >= 0.4 * lh && Math.abs(b.x0 - c.x) < 1.2 * lh && !inBox(rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0)) &&
        !lines.some(l => yOverlap(l.r, rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0)) > 0.5 * (b.y1 - b.y0) && xOverlap(l.r, rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0)) > 0 && isProse(l.t)));   /* not a sentence */
    const numberShaped = b => {
      const g = page.grey, W = page.W, ink = x => { for (let y = b.y0; y < b.y1; y++) if (Math.abs(g[y * W + x] - bg) > 70) return true; return false; };
      let xe = b.x0, gap = 0;
      for (let x = b.x0; x < Math.min(W, b.x0 + 3 * lh); x++) { if (ink(x)) { xe = x; gap = 0; } else if (++gap >= 0.35 * lh) break; }
      return xe - b.x0 < 1.6 * lh && gap >= 0.35 * lh;
    };
    for (let n = 1; n <= maxFound + 12; n++) {
      if (problems.some(p => p.n === n)) continue;
      const c = columnFor(n);
      const mine = problems.filter(p => p.col === c).sort((p, q) => p.y - q.y);
      const before = mine.filter(p => p.n < n).pop(), after = mine.find(p => p.n > n);
      if (n > maxFound && !before) break;
      const yA = before ? bottom(before.r) + 0.3 * lh : Math.max(win ? win.y : 0, (after ? after.y : 0) - 40 * lh);
      const yB = after ? after.y - 0.3 * lh : Math.min(page.H, win ? bottom(win) : page.H, n > maxFound ? bottom(before.r) + 14 * lh : page.H);
      if (yB - yA < lh) { if (n > maxFound) break; continue; }
      const bands = rows(c, yA, yB);
      /* the number starts a block: after a clear gap below the problem above (or the last block before the one below) */
      let pick = null;
      if (before) { let prevEnd = bottom(before.r); for (const b of bands) { if (b.y0 - prevEnd > 1.2 * lh) { pick = b; break; } prevEnd = b.y1; } }
      else if (after && n !== after.n - (acrossRows ? C : 1)) continue;   /* above the first number found, only the slot right above it (a page that starts at 5 is not 1, 2, 3 …) */
      else if (after) pick = bands.filter(b => after.y - b.y1 > 0.3 * lh).filter((b, i, arr) => i === 0 || b.y0 - arr[i - 1].y1 > 1.2 * lh).pop() || null;
      if (!pick) { if (n > maxFound) break; continue; }
      const br = rect(pick.x0, pick.y0, pick.x1 - pick.x0, pick.y1 - pick.y0);
      /* filling the slot above a problem: its ink starts where that problem's starts (not a ribbon or a heading) */
      if (!before && after && (Math.abs(pick.x0 - after.x) > 0.6 * lh || !numberShaped(pick))) continue;
      /* and about as far above it as the problems in that column are apart (not a toolbar far above the page) */
      if (!before && after) { const ys = mine.map(p => p.y), gaps = ys.slice(1).map((y, i) => y - ys[i]).sort((a, b) => a - b); if (gaps.length && Math.abs(after.y - pick.y0 - gaps[gaps.length >> 1]) > 0.15 * gaps[gaps.length >> 1]) continue; }
      /* after a "Question 3" header the next block is that question's own text: a new problem there needs ink like "4." */
      /* past the last number, a new problem starts where the numbers above it start (not indented like an answer written under one) */
      if (n > maxFound && before && Math.abs(pick.x0 - before.x) > 0.5 * lh) break;
      if (n > maxFound && before && before.line && /^(?:question|problem|exercise|item|task|q)\s*#?\d{1,3}\s*[.:)]?$/i.test(before.line.t.trim()) && !numberShaped(pick)) break;
      if (lines.some(l => yOverlap(l.r, br) > 0.3 * br.h && markerOf(l.words) && colOf(l.r.x) === c)) continue;
      problems.push({ n: n, line: null, markerRight: null, x: pick.x0, y: pick.y0, r: br, col: c, guessed: true });
    }
  }
  /* a guessed problem that is just a question's worth ("1 pts" in a header) is not one */
  for (let k = problems.length - 1; k >= 0; k--) if (problems[k].guessed && worths.some(l => inter(l.r, problems[k].r) > 0.3 * Math.min(l.r.w * l.r.h, problems[k].r.w * problems[k].r.h))) problems.splice(k, 1);
  problems.sort((p, q) => p.n - q.n);
  /* with two or more columns, the last is no wider than the one before it: past that is the app (a page list, a sidebar), not the worksheet */
  { const cs = cols.slice().sort((a, b) => a.x - b.x);
    if (cs.length >= 2) { const L = cs[cs.length - 1], P = cs[cs.length - 2]; L.x1 = Math.min(L.x1, L.x + (L.x - P.x)); } }
  settle(problems);
  /* numbered items with no maths (a list in notes: "1. Read chapter 3") are not problems */
  for (let i = problems.length - 1; i >= 0; i--) {
    const p = problems[i];
    if (p.hasMath !== false) continue;
    /* a word problem for Mathbench AI: words with numbers in them that ask for something */
    /* its words run down to the next number in its column (evenly spaced lines can put the question past its zone) */
    const next = problems.filter(q => q !== p && q.col === p.col && q.y > p.y + 0.5 * lh).sort((q, r) => q.y - r.y)[0];
    const text = p.line ? lines.filter(l => l.r.y >= p.line.r.y - 0.3 * lh && (!next || l.r.y < next.y - 0.3 * lh) && l.r.x >= p.zoneLeft - 2 && l.r.x < p.zoneRight)
      .sort((q, r) => q.r.y - r.r.y).filter((l, k, arr) => !arr.slice(1, k + 1).some(q => markerOf(q.words)) && (!k || l.r.y - bottom(arr[k - 1].r) < 2 * lh)).map(l => l.t) : [];
    if (page.ai && isWordProblem(text.join(' '))) { p.wordy = true; p.ocrLines = text; } else problems.splice(i, 1);
  }
  /* no numbered problems: each line with maths is a problem, numbered from the top (notes, a page of equations) */
  if (!problems.length) {
    const found = lines.filter(l => isMathLine(l.t)).map(l => ({ line: l, r: l.r }));
    /* maths the text reader could not read at all (it often skips a line of symbols): ink rows lined up with the maths lines it did read */
    if (page.grey && found.length) {
      const xs = found.map(f => f.r.x), top = Math.min.apply(null, found.map(f => f.r.y)) - 6 * lh, bot = Math.max.apply(null, found.map(f => bottom(f.r))) + 6 * lh;
      const x0 = Math.max(0, Math.min.apply(null, xs) - 2 * lh), x1 = Math.min(page.W, Math.max.apply(null, found.map(f => right(f.r))) + 6 * lh);
      inkBands(page.grey, page.W, page.H, x0, x1, Math.max(0, top), Math.min(page.H, bot), bg).forEach(b => {
        const br = rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
        if (br.h < 0.5 * lh || br.h > 3 * lh || br.w < 1.2 * lh || inBox(br)) return;
        if (lines.some(l => yOverlap(l.r, br) > 0.4 * br.h)) return;   /* the reader read something on this row */
        if (!xs.some(x => Math.abs(x - br.x) < 1.5 * lh)) return;
        found.push({ line: null, r: br });
      });
    }
    /* handwriting: the text reader reads none of it, so the page seems to hold no maths at all. Rows of ink where it read
       nothing, taller than the page's text and wider than tall, are problems for the formula reader (Formula AI reads handwriting) */
    if (page.grey && !found.length) inkProblems(page, lines, bg, lh, win, inBox).forEach(r => found.push({ line: null, r: r }));
    /* functions defined on their own lines, then the question ("f(x) = 2x + 1", "g(x) = x²", "Find (f∘g)(3)"): one problem.
       The text reader garbles names ("fix) ="), so a definition is any short name, a letter in brackets, then "=" */
    const isDef = t => /^\s*[A-Za-z]{1,2}\s*[(\[{|]?\s*[A-Za-z]\s*[)\]}|1l]?\s*=/.test(t);
    const isAsk = t => /\b(find|evaluate|what\s+is|calculate|compute|work\s+out)\b/i.test(t) || /[A-Za-z]\s*[(\[]\s*[A-Za-z]\s*[(\[]/.test(t) ||
      /\(\s*[A-Za-z]\s*(?:o|∘|°|\+|-|−|\*|\/|·)?\s*[A-Za-z]\s*\)\s*[(\[]/.test(t) || /^\s*[A-Za-z]\s*(?:o|∘|°)\s*[A-Za-z]\s*[(\[]/.test(t) || /^\s*[A-Za-z]\s*[(\[]\s*[-−]?[\d.]+\s*[)\]]\s*=?\s*\??\s*$/.test(t);
    lines.forEach(l => { if (!found.some(f => f.line === l) && isAsk(l.t) && !isDef(l.t)) found.push({ line: l, r: l.r }); });
    found.sort((a, b) => a.r.y - b.r.y);
    const groups = [];
    for (let i = 0; i < found.length; i++) {
      const f = found[i];
      /* a definition starts a group; so does a line the reader could not read at all (often a definition in maths italics) */
      const opens = q => !q.line || isDef(q.line.t);
      if (!opens(f)) { groups.push([f]); continue; }
      const g = [f];
      let end = i;
      for (let k = i + 1; k < found.length; k++) {
        const q = found[k], prev = g[g.length - 1];
        if (q.r.y - bottom(prev.r) > 1.8 * lh || Math.abs(q.r.x - f.r.x) > 6 * lh) break;
        g.push(q); end = k;
        if (!opens(q)) break;   /* the question ends it */
      }
      /* a group needs a question that asks for a function's value after a definition (read, or ink the reader skipped),
         or ends on a line the reader skipped (the question, in maths italics) after definitions it did read */
      const last = g[g.length - 1];
      const ok = g.length > 1 && (last.line ? !isDef(last.line.t) && isAsk(last.line.t) : g.some(q => q.line && isDef(q.line.t)));
      if (ok) { groups.push(g); i = end; }
      else groups.push([f]);
    }
    groups.forEach((g, k) => {
      const r = g.reduce((u, q) => union(u, q.r), null);
      problems.push({ n: k + 1, line: g[0].line, markerRight: null, x: r.x, y: r.y, r: g.length > 1 ? r : g[0].r, col: null, unnumbered: true, guessed: !g[0].line, group: g.length > 1 ? g : null });
    });
    settle(problems);
  }
  /* a problem running off the bottom of the window is only partly on screen: solving the visible half would give a wrong answer */
  const edge = Math.min(win ? bottom(win) : 1e9, page.H || 1e9), cutOff = [];
  for (let k = problems.length - 1; k >= 0; k--) { const c = problems[k].crop || problems[k].r; if (c && bottom(c) >= edge - 0.5 * lh) { cutOff.unshift(problems[k].n); problems.splice(k, 1); } }
  /* an answer box belongs to a problem: one outside every problem's area is part of the app (a font box, a search box, a toolbar button) */
  if (problems.length) {
    const near = (b, p) => p.zoneTop != null && b.r.y < p.zoneBottom + lh && bottom(b.r) > p.zoneTop - lh && b.r.x < (p.zoneRight != null ? p.zoneRight : 1e9) + 4 * lh && right(b.r) > (p.zoneLeft != null ? p.zoneLeft : 0) - lh;
    boxes = boxes.filter(b => b.kind === 'spot' || b.focus || problems.some(p => near(b, p)));
  }
  return { problems: problems, boxes: boxes, lines: lines, lineHeight: lh, bg: bg, cutOff: cutOff };

  /* each problem's zone and reading */
  function settle(problems) {
  /* each problem's zone: its column, down to the next problem in that column (or a wide gap) */
  /* a number can sit beside the middle of its lines, so a problem may start a little above its number:
     the border between two problems in a column is the widest blank gap between them.
     A maths line on its own (no number) keeps to that line, so text beside it (a sidebar, a note) stays out */
  problems.forEach(p => {
    p.zoneLeft = p.col ? p.col.x0 : p.unnumbered ? p.r.x - 6 * lh : 0;   /* the text reader often drops the start of a maths line ("5(") */
    p.zoneRight = p.col ? p.col.x1 : p.unnumbered ? right(p.r) + 4 * lh : (page.W || 1e5);
    p.zoneTop = p.y - (p.unnumbered ? 0.4 : 1.5) * lh;
    /* a line of handwriting can be two or three text lines tall: its zone reaches its own bottom */
    p.zoneBottom = p.group ? bottom(p.r) + 0.6 * lh : p.unnumbered ? Math.max(p.y + 1.2 * lh, bottom(p.r) + 0.2 * lh) : p.y + 10 * lh;
  });
  problems.forEach(p => {
    const next = problems.filter(q => q !== p && q.col === p.col && q.y > p.y + 0.5 * lh).sort((a, b) => a.y - b.y)[0];
    if (!next) return;
    let cut = next.y - 0.2 * lh;
    if (page.grey && !p.unnumbered) {
      const bands = inkBands(page.grey, page.W, page.H, Math.max(0, p.zoneLeft), Math.min(page.W, p.zoneRight), p.y, next.y + 0.5 * lh, bg);
      let best = -1;
      for (let i = 1; i < bands.length; i++) { const gap = bands[i].y0 - bands[i - 1].y1; if (gap > best && bands[i - 1].y1 > p.y + 0.5 * lh) { best = gap; cut = (bands[i].y0 + bands[i - 1].y1) / 2; } }
      if (best < 0.5 * lh) cut = next.y - 0.2 * lh;
      cut = Math.min(cut, next.y - 0.2 * lh);
    }
    p.zoneBottom = cut;
    next.zoneTop = Math.max(Math.min(next.zoneTop, cut), cut);
  });
  problems.forEach(p => Object.assign(p, readProblem(p, lines, boxes, lh, page, worths)));
  }
}

function median(a) { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; }

/* lines of handwriting on the page, found from the ink alone: [rect] */
function inkProblems(page, lines, bg, lh, win, inBox) {
  const g = page.grey, W = page.W, H = page.H;
  const X0 = win ? Math.max(0, win.x | 0) : 0, X1 = win ? Math.min(W, right(win) | 0) : W;
  const Y0 = win ? Math.max(0, win.y | 0) : 0, Y1 = win ? Math.min(H, bottom(win) | 0) : H;
  const on = (x, y) => Math.abs(g[y * W + x] - bg) > 70;
  /* each row of ink split into pieces at wide blank gaps (columns, or a note beside the maths) */
  const pieces = [];
  inkBands(g, W, H, X0, X1, Y0, Y1, bg).forEach(b => {
    let s = -1, e = -1, blank = 0;
    for (let x = b.x0; x <= b.x1; x++) {
      let ink = false;
      if (x < b.x1) for (let y = b.y0; y < b.y1; y++) if (on(x, y)) { ink = true; break; }
      if (ink) { if (s < 0) s = x; e = x; blank = 0; }
      else if (s >= 0 && (++blank >= 3 * lh || x === b.x1)) { pieces.push(rect(s, b.y0, e + 1 - s, b.y1 - b.y0)); s = -1; blank = 0; }
    }
  });
  /* the parts of one formula stacked up (a fraction's top, its bar and its bottom; a raised power): one piece */
  pieces.sort((a, b) => a.y - b.y);
  const groups = [];
  pieces.forEach(p => {
    const q = groups.find(q => xOverlap(q, p) > 0.3 * Math.min(q.w, p.w) && p.y - bottom(q) < 0.4 * Math.max(lh, Math.min(q.h, p.h)));
    if (q) Object.assign(q, union(q, p)); else groups.push(rect(p.x, p.y, p.w, p.h));
  });
  /* what the text reader did read as words (a ribbon, a title, instructions) is not handwriting */
  const read = r => lines.some(l => yOverlap(l.r, r) > 0.3 * Math.min(l.r.h, r.h) && xOverlap(l.r, r) > 0 && (isProse(l.t) || l.t.replace(/[^A-Za-z]/g, '').length >= 4));
  const pictures = (page.images || []).map(im => rect(im.x, im.y, im.w, im.h));
  const density = r => { let n = 0, k = 0; for (let y = r.y; y < bottom(r); y += 2) for (let x = r.x; x < right(r); x += 2) { k++; if (on(x, y)) n++; } return n / Math.max(1, k); };
  return groups.filter(r => r.h >= 0.8 * lh && r.h <= 8 * lh && r.w >= 2 * lh && r.w >= 1.2 * r.h &&
    !read(r) && !inBox(r) && !pictures.some(p => inter(p, r) > 0.3 * r.w * r.h) && density(r) < 0.35).slice(0, 30);
}

/* where the maths of a problem is (one crop per line to read), what the instructions say, and what it asks for */
function readProblem(p, lines, boxes, lh, page, worths) {
  const isWorth = r => (worths || []).some(l => inter(l.r, r) > 0.3 * Math.min(l.r.w * l.r.h, r.w * r.h));
  /* the problem's text stops before any answer box in its zone */
  const textRight = x0 => Math.min.apply(null, [p.zoneRight - 2].concat(boxes.filter(b => cy(b.r) > p.zoneTop && cy(b.r) < p.zoneBottom && b.r.x > x0 + lh).map(b => b.r.x - 4)));
  const out = { crop: null, crops: [], hint: {}, words: '' };
  const inCol = l => l.r.x >= p.zoneLeft - 2 && l.r.x < p.zoneRight;
  let zoneLines = lines.filter(l => cy(l.r) >= p.zoneTop && cy(l.r) < p.zoneBottom && inCol(l));
  /* stop at a wide gap: what follows is something else on the page */
  zoneLines = zoneLines.filter((l, i, arr) => { for (let k = 1; k <= i; k++) if (arr[k].r.y - bottom(arr[k - 1].r) > 3 * lh) return false; return true; });
  out.words = (p.group ? p.group.filter(q => q.line).map(q => q.line) : p.unnumbered && p.line ? [p.line] : zoneLines).map(l => l.t).join(' ');
  out.hint = hintsFrom(out.words);
  delete out.hint.words;   /* how much to write is your choice (the bar or your directions), not the worksheet's "Show your work" */
  const grey = !!page.grey;
  const fit = r => pad(r, 6, page);
  /* the text reader's line sitting on each picture, if any */
  const cropText = crops => crops.map(c => { const l = lines.find(q => yOverlap(q.r, c) > 0.5 * Math.min(q.r.h, c.h) && xOverlap(q.r, c) > 0.3 * Math.min(q.r.w, c.w)); return l ? l.t : null; });
  /* a picture two lines tall (a line the text reader skipped got joined to the one above, or lines packed with no gap): one picture per line */
  const oneLineEach = crops => {
    if (!grey) return crops;
    const split = [];
    crops.forEach(c => {
      if (c.h - 12 <= 1.4 * lh) { split.push(c); return; }   /* its text, without the picture's margins */
      const parts = splitTall([{ x0: Math.max(0, Math.round(c.x)), x1: Math.min(page.W, Math.round(right(c))), y0: Math.max(0, Math.round(c.y + 4)), y1: Math.min(page.H, Math.round(bottom(c) - 4)) }], page.grey, page.W, pageBackground(page.grey), lh);
      if (parts.length > 1) parts.forEach(b => split.push(fit(rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0)))); else split.push(c);   /* one line after all: as it was */
    });
    return split;
  };
  if (!p.line) {
    /* rows the text reader skipped: the ink bands of this block, one crop per row */
    let r = p.r;
    const stopAt = boxes.filter(b => yOverlap(b.r, r) > 0.3 * Math.min(r.h, b.r.h) && b.r.x > r.x + 10).map(b => b.r.x);
    const xEnd = Math.min(stopAt.length ? Math.min.apply(null, stopAt) - 4 : 1e9, textRight(r.x));
    if (grey) {
      const bgv = pageBackground(page.grey), g = page.grey, W = page.W;
      /* the number's own ink ("1.", "3)") at the start of the row: a narrow cluster, then a clear gap. Leave it out, so a
         number centred beside two lines does not join them into one block */
      let x0 = Math.max(0, Math.round(p.zoneLeft));
      const colInk = x => { for (let y = Math.max(0, Math.round(r.y)); y < Math.min(page.H, Math.round(bottom(r))); y++) if (Math.abs(g[y * W + x] - bgv) > 70) return true; return false; };
      let xs = -1, xe = -1, blank = 0;
      for (let x = x0; x < Math.min(W, x0 + 4 * lh); x++) {
        if (colInk(x)) { if (xs < 0) xs = x; xe = x; blank = 0; }
        else if (xs >= 0 && ++blank >= 0.35 * lh) break;
      }
      /* a number is narrow and one line tall; anything wider or taller (a stacked fraction right after "4.") is maths */
      let top = 1e9, bot = -1;
      if (xs >= 0) for (let y = Math.max(0, Math.round(r.y)); y < Math.min(page.H, Math.round(bottom(r))); y++) for (let x = xs; x <= xe; x++) if (Math.abs(g[y * W + x] - bgv) > 70) { if (y < top) top = y; if (y > bot) bot = y; }
      if (xs >= 0 && xe - xs < 1.6 * lh && bot - top < 1.3 * lh && blank >= 0.35 * lh) { x0 = xe + 2; p.markerRight = xe; p.markerRow = rect(xs, top, xe - xs + 1, bot - top + 1); }
      const bands = splitTall(inkBands(page.grey, page.W, page.H, x0, Math.min(page.W, xEnd), Math.max(0, p.zoneTop), p.zoneBottom, bgv), page.grey, page.W, bgv, lh);
      const rows = []; let last = null;
      for (const b of bands) { if (b.y1 - b.y0 < 0.4 * lh || b.y1 < r.y - 1.6 * lh || isWorth(rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0))) continue; if (lines.some(l => yOverlap(l.r, rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0)) > 0.5 * (b.y1 - b.y0) && xOverlap(l.r, rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0)) > 0 && isProse(l.t))) continue;   /* a heading or a sentence of instructions */ if (last && b.y0 - last.y1 > 3 * lh) break; rows.push(b); last = b; }
      rows.forEach(b => out.crops.push(fit(rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0))));
      if (p.markerRight != null) out.stripNumber = false;
    }
    if (!out.crops.length) out.crops.push(fit(r));
    out.crops = splitClose(clearMarker(oneLineEach(out.crops), p));
    out.cropOcr = cropText(out.crops);
    out.crop = out.crops.reduce((u, c) => union(u, c), null);
    if (out.stripNumber !== false) out.stripNumber = true;
    return out;
  }
  /* a maths line found without a number is just that line; a numbered problem takes every line in its zone */
  const content = p.group ? p.group.filter(q => q.line).map(q => q.line) : p.unnumbered ? [p.line] : [p.line].concat(zoneLines.filter(l => l !== p.line && l.r.y > p.line.r.y - 0.3 * lh));
  content.forEach((line, li) => {
    const ws = line.words.filter(w => !boxes.some(b => inter(b.r, w.r) > 0.5 * w.r.w * w.r.h));
    let i = 0;
    if (li === 0 && p.markerRight != null) while (i < ws.length && (right(ws[i].r) <= p.markerRight + 1 || (i === 0 && /^\(?[\dlI|]{1,3}[.):]?$/.test(ws[i].t) && ws[i].r.x < p.markerRight))) i++;
    /* a word right before "=" or a sign is maths the reader misspelt ("11x = 22" read as "Ilx = 22"), not an instruction */
    while (i < ws.length && ((isWordy(ws[i].t) && !(ws[i + 1] && /^[=<>+\-−–≤≥]/.test(ws[i + 1].t))) || isVarColon(ws[i].t))) i++;
    let j = ws.length;
    while (j > i && isWordy(ws[j - 1].t) && !/=$/.test(ws[j - 1].t)) j--;
    let r = null;
    for (let k = i; k < j; k++) r = union(r, ws[k].r);
    let leftStop = i > 0 && i <= ws.length ? right(ws[i - 1].r) + 2 : (li === 0 ? null : p.zoneLeft);
    if (li === 0 && p.glued && r) {   /* the number is inside the first word: start after it */
      const x0 = Math.max(r.x, p.markerRight + 1);
      r = rect(x0, r.y, Math.max(4, right(r) - x0), r.h); leftStop = x0; out.stripNumber = true;
    }
    if (!r) return;   /* a line of words only ("Simplify each expression."): its words are hints, not maths */
    const gapTo = boxes.filter(b => yOverlap(b.r, r) > 0.3 * r.h && b.r.x > r.x).map(b => b.r.x).concat([p.zoneRight - 2]);
    const stop = Math.min.apply(null, gapTo) - 4;
    /* grow no further than halfway to the lines above and below, so tightly packed lines stay apart */
    const above = content.filter(o => o !== line && bottom(o.r) <= cy(line.r)).sort((a, b) => bottom(b.r) - bottom(a.r))[0];
    const below = content.filter(o => o !== line && o.r.y >= cy(line.r)).sort((a, b) => a.r.y - b.r.y)[0];
    const zt = Math.max(line.r.y - 0.6 * lh, above ? (bottom(above.r) + line.r.y) / 2 : -1e9);
    const zb = Math.min(bottom(line.r) + 0.6 * lh, below ? (bottom(line.r) + below.r.y) / 2 : 1e9);
    if (grey) r = growInk(r, page, lh, stop, Object.assign({}, p, { zoneTop: zt, zoneBottom: zb, markerRight: li === 0 || (p.line && yOverlap(line.r, p.line.r) > 0.3 * line.r.h) ? p.markerRight : null }), leftStop);
    else if (right(r) > stop) r = rect(r.x, r.y, stop - r.x, r.h);
    out.crops.push(fit(r));
  });
  /* rows the text reader skipped inside this problem (a "Find …" line in maths italics): add them from the ink */
  if (grey && !p.unnumbered) {
    const cx0 = out.crops.length ? Math.min.apply(null, out.crops.map(c => c.x)) : (p.markerRight != null ? p.markerRight + 4 : p.r.x);
    /* never left of the problem's own number (a number centred beside its lines is not a line) */
    /* a skipped line starts right after the number, not where the next line's maths starts ("Find (h∘h)(x)" is cropped after its "Find") */
    const x0 = p.markerRight != null ? Math.max(0, Math.min(cx0, p.markerRight + 2)) : Math.max(0, cx0), x1 = Math.min(page.W, textRight(cx0));
    const yEnd = Math.min(page.H, p.zoneBottom);
    let last = out.crops.length ? Math.min.apply(null, out.crops.map(c => c.y)) : p.r.y;
    splitTall(inkBands(page.grey, page.W, page.H, x0, x1, Math.max(0, p.zoneTop), yEnd, pageBackground(page.grey)), page.grey, page.W, pageBackground(page.grey), lh).forEach(b => {
      const br = rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      if (br.h < 0.4 * lh || b.y0 - last > 1.6 * lh || isWorth(br) || boxes.some(q => inter(q.r, br) > 0.5 * br.w * br.h)) return;
      /* already read, or a line of ordinary words (notes, a sentence of instructions): not part of the maths */
      if (out.crops.some(c => yOverlap(c, br) > 0.5 * br.h) || lines.some(l => yOverlap(l.r, br) > 0.5 * br.h && xOverlap(l.r, br) > 0.3 * br.w && isProse(l.t))) { last = Math.max(last, b.y1); return; }
      out.crops.push(fit(br)); last = b.y1;
    });
    out.crops.sort((a, b) => a.y - b.y);
  }
  /* grouped lines the text reader could not read (only their ink was seen): their own pictures */
  if (p.group) { p.group.filter(q => !q.line).forEach(q => out.crops.push(fit(q.r))); out.crops.sort((a, b) => a.y - b.y); }
  if (!out.crops.length) out.crops.push(fit(rect(p.markerRight != null ? p.markerRight + 4 : p.r.x, p.r.y, Math.max(40, right(p.r) - p.r.x), p.r.h)));
  /* what the text reader saw on each line: it spells letters like g and h better than a maths reader on italic fonts */
  out.ocrLines = content.map(l => l.t);
  /* a numbered item is a problem unless every line of it reads as ordinary words */
  out.hasMath = !content.every(l => isProse(l.t)) || out.crops.some(c => !lines.some(l => inter(l.r, c) > 0.3 * c.w * c.h));
  /* overlapping crops (a tall fraction caught by two lines): keep the bigger */
  out.crops = out.crops.filter((c, i, arr) => !arr.some((o, k) => k !== i && inter(o, c) > 0.6 * c.w * c.h && (o.w * o.h > c.w * c.h || (o.w * o.h === c.w * c.h && k < i))));
  out.crops = splitClose(clearMarker(oneLineEach(out.crops), p));
  out.cropOcr = cropText(out.crops);
  out.crop = out.crops.reduce((u, c) => union(u, c), null);
  return out;
}

/* no line's picture may start on the problem's own number ("1." beside the first line): cut it off right of the number */
function clearMarker(crops, p) {
  const row = p.markerRow || (p.line ? p.line.r : null);
  if (p.markerRight == null || !row) return crops;
  const x = p.markerRight + 3;
  return crops.map(c => c.x < x && right(c) > x + 8 && yOverlap(c, row) > 0.3 * Math.min(c.h, row.h) ? rect(x, c.y, right(c) - x, c.h) : c);
}

/* lines packed close together (small print): split neighbouring lines halfway between them, so no line's picture holds a strip of the next */
function splitClose(crops) {
  const out = crops.slice().sort((a, b) => a.y - b.y);
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i], b = out[i + 1];
    if (bottom(a) <= b.y || xOverlap(a, b) <= 0) continue;
    const cut = Math.round((bottom(a) - 6 + b.y + 6) / 2);   /* halfway between the two lines' ink (each picture has 6 px of margin) */
    if (cut <= a.y + 4 || cut >= bottom(b) - 4) continue;
    out[i] = rect(a.x, a.y, a.w, cut - a.y);
    out[i + 1] = rect(b.x, cut, b.w, bottom(b) - cut);
  }
  return out;
}

/* grow a crop to the surrounding ink: up/down for stacked fractions and powers, sideways for symbols the text reader dropped */
function growInk(r, page, lh, stop, p, leftStop) {
  const g = page.grey, W = page.W, bg = pageBackground(g);
  const ink = (x, y) => x >= 0 && y >= 0 && x < W && y < page.H && Math.abs(g[y * W + x] - bg) > 70;
  const rowHas = (y, x0, x1) => { for (let x = x0; x < x1; x++) if (ink(x, y)) return true; return false; };
  const colHas = (x, y0, y1) => { for (let y = y0; y < y1; y++) if (ink(x, y)) return true; return false; };
  let x0 = r.x | 0, x1 = right(r) | 0, y0 = r.y | 0, y1 = bottom(r) | 0;
  const left = leftStop != null ? leftStop : p.markerRight != null ? p.markerRight + 2 : Math.max(p.zoneLeft != null ? p.zoneLeft : -1e9, x0 - 6 * lh);
  const maxR = stop != null ? stop : x1 + 6 * lh;
  /* sideways: continue while the gap to the next ink is small */
  const gapMax = Math.max(8, 0.9 * lh);
  for (let k = 0; k < 4; k++) {
    let gx = 0, x = x1;
    while (x < maxR && gx < gapMax) { if (colHas(x, y0, y1)) { gx = 0; x1 = x + 1; } else gx++; x++; }
    gx = 0; x = x0 - 1;
    while (x > left && gx < gapMax * 1.4) { if (colHas(x, y0, y1)) { gx = 0; x0 = x; } else gx++; x--; }
    let grew = false;
    const topLimit = Math.max(p.zoneTop | 0, y0 - 2 * lh), botLimit = Math.min(p.zoneBottom | 0, y1 + 2 * lh);
    while (y0 > topLimit && rowHas(y0 - 1, x0, x1)) { y0--; grew = true; }
    while (y1 < botLimit && rowHas(y1, x0, x1)) { y1++; grew = true; }
    if (!grew) break;
  }
  return rect(x0, y0, Math.max(4, x1 - x0), Math.max(4, y1 - y0));
}
function pad(r, k, page) {
  const x = Math.max(0, r.x - k), y = Math.max(0, r.y - k);
  const W = page.W || 1e9, H = page.H || 1e9;
  return rect(x, y, Math.min(W, right(r) + k) - x, Math.min(H, bottom(r) + k) - y);
}

/* what the text around a problem (or the directions) asks for */
function hintsFrom(text) {
  const t = ' ' + String(text || '').toLowerCase().replace(/[’']/g, "'") + ' ';
  const h = {};
  if (/\bfactor(i[sz]e)?\b|\bfactori[sz]ed\b/.test(t)) h.mode = 'factor';
  else if (/\bexpand\b|\bmultiply out\b/.test(t)) h.mode = 'expand';
  else if (/\bderivative\b|\bdifferentiate\b|\bd\/dx\b/.test(t)) h.mode = 'diff';
  else if (/\bintegra(l|te)\b|\bantiderivative\b/.test(t)) h.mode = 'integrate';
  else if (/\blimit\b/.test(t)) h.mode = 'limit';
  else if (/\bsimplif(y|ied)\b/.test(t)) h.mode = 'simplify';
  else if (/\bsolve\b/.test(t)) h.mode = 'solve';
  else if (/\b(evaluate|calculate|compute|work out)\b/.test(t)) h.mode = 'auto';
  let m;
  if ((m = /\bround(?:ed)?\s*(?:it\s*|your answer\s*|answers?\s*)?(?:to|off to)\s*(?:the\s*)?(?:nearest\s*)?(\d+|one|two|three|four)?\s*(decimal places?|dp|places?|whole number|whole|integer|tenths?|hundredths?|thousandths?|ones?)\b/.exec(t))) {
    const unit = m[2];
    if (/decimal|dp|place/.test(unit)) h.places = m[1] ? (NUMW[m[1]] != null ? NUMW[m[1]] : +m[1]) : 2;
    else h.places = PLACES[unit] != null ? PLACES[unit] : PLACES[unit.replace(/s$/, '')];
    h.format = 'number';
  } else if ((m = /\b(\d+)\s*(?:decimal places?|dp)\b/.exec(t))) { h.places = +m[1]; h.format = 'number'; }
  else if ((m = /\bnearest\s+(whole number|whole|integer|tenth|hundredth|thousandth)\b/.exec(t))) { h.places = PLACES[m[1]]; h.format = 'number'; }
  else if (/\b(as a |in )?decimals?\b/.test(t)) h.format = 'number';
  if (/\b(as a |in )?(simplest )?fractions?\b|\bsimplest form\b|\bexact\b/.test(t) && !h.format) h.format = 'exact';
  if (/\bfactored form\b/.test(t)) h.format = 'factor';
  if ((m = /\bfor\s+([a-z])\b/.exec(t)) && m[1] !== 'a') h.variable = m[1];
  /* how much to write */
  /* show work, at three levels: few steps (the key one), some (the usual), all (every move written out) */
  if (/\b(all (?:the )?steps|every step|each step|full (?:work|working)|all (?:the )?work(?:ing)?|in full|step by step)\b/.test(t)) h.words = 'work-all';
  else if (/\b(few(?:er)? steps|little steps|key steps?|main steps?|short work(?:ing)?|brief(?:ly)? (?:work|working|steps)|some work)\b/.test(t)) h.words = 'work-few';
  else if (/\b(show (?:your |the )?(?:work|working|steps?)|with (?:the )?(?:work|working|steps))\b/.test(t)) h.words = 'work';
  else if (/\b(more words|explain|in detail)\b/.test(t)) h.words = 'more';
  else if (/\b(less words|fewer words|short(?:er)?|brief(?:ly)?|with the (?:letter|variable)|x ?= ?form)\b/.test(t)) h.words = 'less';
  else if (/\b(without words|no words|just (?:the )?(?:answer|number|value)|only (?:the )?(?:answer|number|value)|answer only)\b/.test(t)) h.words = 'none';
  else if (/\b(with words|in words|in a sentence|full sentences?|as a sentence)\b/.test(t)) h.words = 'with';
  return h;
}

/* ---------- directions ---------- */

/* "do 3", "#2 and #5", "1-4", "all", "this one", "the last two", "problem 3 in the box below", "here", "as a decimal" */
function parseDirections(text) {
  const raw = String(text || '').trim();
  const t = ' ' + raw.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ') + ' ';
  const d = { which: null, nums: [], where: 'auto', boxN: null, hint: hintsFrom(raw), replace: /\b(replace|overwrite|clear|instead)\b/.test(t), typed: null, raw: raw };
  /* a problem typed into the directions: "solve 2x+3=7" */
  const mathy = /([0-9a-z)\]]\s*[=+\-*/^]\s*[0-9a-z(√]|\\frac|√|\d\s*[a-z]\b)/i;
  const stripped = t.replace(/\b(solve|simplify|factor|expand|evaluate|calculate|differentiate|integrate|compute|work out|find|and|put|it|the|answer|in|into|box|blank|here|there|then|type|write|paste|please|for me|do|this|that|one|question|problem|number|below|under|above|beneath|next to|to the right|right of|left of|beside|cursor|field|as a|decimal|fraction|round|to|nearest|places?|exact|of|with respect to|for [a-z]|with|show|your|all|every|each|few|fewer|some|little|key|main|brief|short|full|steps?|work|working|by)\b/g, ' ');
  if (mathy.test(stripped) && /[=+\-*/^√]/.test(stripped) && !/^\s*[#\d\s,&\-–to and]*$/.test(stripped)) {
    const m = /(?:^|\s)((?:[-\d(√a-z][^,;]*?[=+\-*/^][^,;]*?))(?:\s+(?:and|then|in|into|put|with|showing|show|,)\b|$)/i.exec(raw.replace(/^(solve|simplify|factor|expand|evaluate|calculate|differentiate|integrate|compute|work out|find)\s+/i, ''));
    if (m) d.typed = m[1].trim();
  }
  /* which problems */
  /* "all steps", "every step", "each step" are about the working, not which problems */
  const tw = t.replace(/\b(all|every|each)\s+(the\s+)?(steps?|work|working)\b/g, ' ');
  if (/\b(all|every|each|everything|whole (page|sheet|quiz|test|worksheet))\b/.test(tw)) d.which = 'all';
  else if (/\b(this|that|it|here|the one (i'm|im|i am) on|my cursor|where i am|selected)\b/.test(t) && !/\b(problem|question|number|#)\s*\d/.test(t) && !/#\d|\b\d+\b/.test(t.replace(/\b\d+\s*(decimal|dp|places?)\b/g, ''))) d.which = 'cursor';
  let m;
  const lastN = /\b(?:the\s+)?last\s+(\d+|two|three|four|five)\b/.exec(t);
  const firstN = /\b(?:the\s+)?first\s+(\d+|two|three|four|five)\b/.exec(t);
  if (lastN) { d.which = 'last'; d.count = NUMW[lastN[1]] || +lastN[1]; }
  else if (firstN) { d.which = 'first'; d.count = NUMW[firstN[1]] || +firstN[1]; }
  else if (/\b(the\s+)?last( one| problem| question)?\b/.test(t) && d.which !== 'all') { d.which = 'last'; d.count = 1; }
  Object.keys(ORD).forEach(w => { if (new RegExp('\\b(the )?' + w + '( one| problem| question)?\\b').test(t) && !new RegExp('\\bnearest\\s+' + w).test(t) && !firstN && !lastN) d.nums.push(ORD[w]); });
  /* numbers that name problems, not places or box numbers */
  const clean = t.replace(/\b(?:round(?:ed)?[^.]*?)?\d+\s*(decimal places?|dp|places?|digits?)\b/g, ' ')
    .replace(/\b(box|field|blank)\s*#?\d+\b/g, ' ').replace(/\b(first|last)\s+\d+\b/g, ' ');
  if (d.typed) { /* the numbers belong to the typed problem */ }
  else {
    const rng = /(?:#|\bproblems?\s*|\bquestions?\s*|\bnumbers?\s*|\bq|\b)(\d{1,3})\s*(?:-|–|to|through|thru)\s*#?(\d{1,3})\b/g;
    while ((m = rng.exec(clean))) for (let k = +m[1]; k <= +m[2] && k - +m[1] < 100; k++) d.nums.push(k);
    const rest = clean.replace(rng, ' ');
    const one = /(?:#\s*|\bproblem\s*|\bquestion\s*|\bnumber\s*|\bno\.?\s*|\bq)(\d{1,3})\b|(?:^|[\s,&])(\d{1,3})(?=[\s,&.]|$)/g;
    while ((m = one.exec(rest))) d.nums.push(+(m[1] || m[2]));
    Object.keys(NUMW).forEach(w => { if (new RegExp('\\b(problem|question|number|#) ?' + w + '\\b').test(t)) d.nums.push(NUMW[w]); });
  }
  d.nums = Array.from(new Set(d.nums)).sort((a, b) => a - b);
  if (d.nums.length && d.which !== 'all') d.which = 'nums';
  /* where the answer goes */
  if ((m = /\b(box|field|blank)\s*#?(\d{1,2})\b/.exec(t))) { d.where = 'boxN'; d.boxN = +m[2]; }
  else if (/\b(below|under(neath)?|beneath|underneath)\b/.test(t)) d.where = 'below';
  else if (/\b(above|over it)\b/.test(t)) d.where = 'above';
  else if (/\b(to the right|right of|right side|next to|beside|after it)\b/.test(t)) d.where = 'right';
  else if (/\b(to the left|left of|before it)\b/.test(t)) d.where = 'left';
  else if (/\b(here|where (i'm|im|i am|i was) typing|my cursor|where the cursor is|where i clicked|current (box|field)|selected (box|field)|just (paste|type) it)\b/.test(t)) d.where = 'here';
  return d;
}

/* ---------- the plan ---------- */

/* returns { tasks: [{problem, box|null, here, hint}], notes: [] } */
function plan(page, A, dirs, cursor) {
  const notes = [], tasks = [];
  const P = A.problems, B = A.boxes;
  const focusBox = B.find(b => b.focus) || null;
  const boxAt = pt => pt && B.find(b => pt.x >= b.r.x - 4 && pt.x <= right(b.r) + 4 && pt.y >= b.r.y - 4 && pt.y <= bottom(b.r) + 4);
  const nearestProblem = pt => {
    if (!pt || !P.length) return P[0] || null;
    const inZone = P.find(p => pt.y >= p.zoneTop && pt.y < p.zoneBottom);
    if (inZone) return inZone;
    let best = null, bd = Infinity;
    P.forEach(p => { const d = Math.hypot(Math.max(0, p.r.x - pt.x, pt.x - right(p.r)), Math.max(0, p.r.y - pt.y, pt.y - bottom(p.r))); if (d < bd) { bd = d; best = p; } });
    return best;
  };
  /* a problem typed into the directions */
  if (dirs.typed) {
    const target = dirs.where === 'here' || dirs.where === 'auto' ? (focusBox ? { box: focusBox } : { here: true }) : { box: pickBox(null, B, dirs, new Set(), cursor) };
    tasks.push(Object.assign({ problem: null, text: dirs.typed, hint: dirs.hint }, target));
    return { tasks: tasks, notes: notes };
  }
  /* which problems */
  let chosen = [];
  const hereBox = focusBox || boxAt(cursor);
  if (dirs.which === 'all') chosen = P.slice();
  else if (dirs.which === 'nums') { chosen = dirs.nums.map(n => P.find(p => p.n === n)).filter(Boolean); dirs.nums.forEach(n => { if (!P.some(p => p.n === n)) notes.push('Problem ' + n + ' was not found on the screen.'); }); }
  else if (dirs.which === 'first') chosen = P.slice(0, dirs.count);
  else if (dirs.which === 'last') chosen = P.slice(-dirs.count);
  else if (dirs.which === 'cursor') chosen = [nearestProblem(cursor)].filter(Boolean);
  else {
    /* nothing said: the problem by the box you are typing in, or the one under the mouse */
    if (hereBox) chosen = [problemForBox(hereBox, P) || nearestProblem(cursor)].filter(Boolean);
    else chosen = [nearestProblem(cursor)].filter(Boolean);
  }
  if (!chosen.length) { notes.push(P.length ? 'Say which problem, for example "do 3" or "all".' : 'No problems were found on the screen.'); return { tasks: tasks, notes: notes }; }
  /* where each answer goes */
  const used = new Set();
  chosen.forEach(p => {
    const hint = Object.assign({}, p.hint, stripEmpty(dirs.hint));
    if (dirs.where === 'here') { tasks.push(hereBox ? { problem: p, box: hereBox, hint: hint } : { problem: p, here: true, hint: hint }); return; }
    if (!dirs.which && hereBox && chosen.length === 1 && dirs.where === 'auto') { tasks.push({ problem: p, box: hereBox, hint: hint }); return; }
    const b = pickBox(p, B, dirs, used, cursor, P);
    if (b) { used.add(b); tasks.push({ problem: p, box: b, hint: hint }); }
    else { tasks.push({ problem: p, box: null, hint: hint }); notes.push('No answer box was found for problem ' + p.n + '.'); }
  });
  return { tasks: tasks, notes: notes };
}
function stripEmpty(h) { const o = {}; Object.keys(h || {}).forEach(k => { if (h[k] != null && h[k] !== '') o[k] = h[k]; }); return o; }

function problemForBox(b, P) {
  const z = P.find(p => cy(b.r) >= p.zoneTop && cy(b.r) < p.zoneBottom);
  if (z) return z;
  const above = P.filter(p => p.y <= b.r.y + b.r.h).pop();
  return above || null;
}

function pickBox(p, B, dirs, used, cursor, P) {
  /* a spot you labelled with this problem's number ("2 here") */
  if (p && typeof p.n === 'number' && dirs.where !== 'boxN') { const s = B.find(b => b.kind === 'spot' && b.n === p.n && !used.has(b)); if (s) return s; }
  const free = B.filter(b => !used.has(b) && !(b.kind === 'spot' && p && b.n !== p.n));
  if (!free.length) return null;
  if (dirs.where === 'boxN') {
    const order = B.slice().sort((a, b) => (Math.abs(a.r.y - b.r.y) < 10 ? a.r.x - b.r.x : a.r.y - b.r.y));
    return order[dirs.boxN - 1] || null;
  }
  if (!p) return free.slice().sort((a, b) => dist(a, cursor) - dist(b, cursor))[0];
  const pr = p.crop || p.r;
  const mine = free.filter(b => cy(b.r) >= p.zoneTop && cy(b.r) < p.zoneBottom);
  const dirOK = b => {
    if (dirs.where === 'below') return b.r.y >= bottom(pr) - 4;
    if (dirs.where === 'above') return bottom(b.r) <= pr.y + 4;
    if (dirs.where === 'right') return b.r.x >= right(pr) - 8 && yOverlap(b.r, pr) > 0;
    if (dirs.where === 'left') return right(b.r) <= pr.x + 8 && yOverlap(b.r, pr) > 0;
    return true;
  };
  let cands = mine.filter(dirOK);
  if (!cands.length && dirs.where !== 'auto') cands = free.filter(dirOK).filter(b => Math.abs(cy(b.r) - cy(pr)) < 6 * (pr.h + 10));
  if (!cands.length) return null;
  /* prefer the box on the same line to the right, then the nearest below */
  const score = b => {
    const sameLine = yOverlap(b.r, pr) > 0.3 * Math.min(b.r.h, pr.h) && b.r.x >= pr.x;
    return (sameLine ? 0 : 1000) + Math.abs(cy(b.r) - cy(pr)) + 0.25 * Math.abs(b.r.x - right(pr));
  };
  return cands.sort((a, b) => score(a) - score(b))[0];
}
function dist(b, pt) { if (!pt) return 0; return Math.hypot(cx(b.r) - pt.x, cy(b.r) - pt.y); }

/* how to read and answer one task: the answer style, rounding, the problem's number to drop, and whether to read it line by line.
   A problem over several real lines is read one line picture at a time (on small print the lines sit too close to split later);
   a thin row (the bar of a stacked fraction) means the rows are one formula, read as a whole */
/* the style chosen in the bar ("with+work-all") with what the directions say: "all steps" changes only the working,
   "in a sentence" only the words, "just the answer" means no working either */
function mergeStyle(ui, hint) {
  if (!hint) return ui;
  const [uw, uk] = String(ui || 'none').split('+');
  if (/^work/.test(hint)) return (/^work/.test(uw) ? 'with' : uw) + '+' + hint;
  if (hint === 'none') return 'none';
  return hint + (uk ? '+' + uk : '');
}
function solveOptions(t, A, words, oneNote) {
  const h = t.hint || {}, p = t.problem, lh = A.lineHeight || 16;
  const o = {
    mode: h.mode, format: h.format, places: h.places, words: mergeStyle(words, h.words),
    newlines: !!oneNote && !(t.box && t.box.kind === 'field'),
    stripNumber: !!(p && p.stripNumber),
    lines: !!(p && ((p.crops && p.crops.length > 1) || (p.manual && p.r.h > 2.2 * lh))),
    ocr: (p && p.ocrLines) || null, text: t.text || null,
    /* a page about composition ("Evaluate each composition", "composite functions", "f ∘ g"): a dot between two function names is the ring */
    compose: (A.lines || []).filter(l => { const ps = A.problems || []; if (!ps.length) return true; const lo = Math.min.apply(null, ps.map(q => (q.crop || q.r).x)), hi = Math.max.apply(null, ps.map(q => (q.crop || q.r).x + (q.crop || q.r).w)); return l.r.x >= lo - 4 * lh && l.r.x <= hi + 8 * lh; }).some(l => /composit|∘|\b[a-z]\s?o\s?[a-z]\s*\(|\(\s*[a-z]\s+o\b/i.test(l.t))
  };
  /* real lines, read one by one: each at least most of a line tall and all about the same height (half of a stacked fraction is much shorter) */
  if (p && p.cropOcr) o.cropOcr = p.cropOcr;
  if (p && !p.manual && p.crops && p.crops.length > 1 && p.crops.every(c => c.h >= 0.65 * lh) && !p.crops.some(c => c.h < 0.65 * Math.max.apply(null, p.crops.map(q => q.h)) && c.w < 0.75 * Math.max.apply(null, p.crops.map(q => q.w)))) {   /* half a stacked fraction is both shorter and narrower */ o.lineCrops = p.crops; o.lines = false; }
  if (p && typeof p.n === 'number') o.number = p.n;
  if (p && p.wordy) o.wordProblem = (p.ocrLines || []).join(' ').replace(/^\s*\(?#?\d{1,3}[.):]\s*/, '');
  return o;
}

const api = { solveOptions: solveOptions, pickBox: pickBox, isMathLine: isMathLine, analyse: analyse, parseDirections: parseDirections, plan: plan, hintsFrom: hintsFrom, findInkBoxes: findInkBoxes, inkBands: inkBands, pageBackground: pageBackground, markerOf: markerOf };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.Assist = api;
})(typeof window !== 'undefined' ? window : globalThis);
