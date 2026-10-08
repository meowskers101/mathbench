# Mathbench screen helper: reads the screen with Windows' own text reader, lists the page's boxes, buttons and choices through
# Windows accessibility, and clicks, types, presses keys and scrolls for "Do it for me".
# Runs while Mathbench is busy, one JSON command per line on stdin, one JSON reply per line on stdout.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# Mathbench sends UTF-8; without this, answers with ² √ π ± would arrive garbled
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime, UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type -Name U -Namespace MBH -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
[DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, IntPtr e);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool on);
[StructLayout(LayoutKind.Sequential)] public struct P { public int X; public int Y; }
[DllImport("user32.dll")] public static extern bool GetCursorPos(out P p);

[StructLayout(LayoutKind.Sequential)] public struct MI { public int dx; public int dy; public uint data; public uint flags; public uint time; public IntPtr extra; }
[StructLayout(LayoutKind.Sequential)] public struct KI { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
[StructLayout(LayoutKind.Explicit)] public struct IU { [FieldOffset(0)] public MI mi; [FieldOffset(0)] public KI ki; }
[StructLayout(LayoutKind.Sequential)] public struct IN { public uint type; public IU u; }
[DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, IN[] inputs, int size);

public static bool Front(IntPtr h) {
  IntPtr fg = GetForegroundWindow(); if (fg == h) return true;
  uint a = GetCurrentThreadId(), b = GetWindowThreadProcessId(fg, IntPtr.Zero), c = GetWindowThreadProcessId(h, IntPtr.Zero);
  keybd_event(0x12, 0, 0, IntPtr.Zero); keybd_event(0x12, 0, 2, IntPtr.Zero);
  AttachThreadInput(a, b, true); AttachThreadInput(c, b, true);
  BringWindowToTop(h); bool ok = SetForegroundWindow(h);
  AttachThreadInput(c, b, false); AttachThreadInput(a, b, false);
  return ok || GetForegroundWindow() == h;
}
static void Send(IN i) { SendInput(1, new IN[] { i }, System.Runtime.InteropServices.Marshal.SizeOf(typeof(IN))); }
static IN Mouse(uint flags, uint data) { IN i = new IN(); i.type = 0; i.u.mi.flags = flags; i.u.mi.data = data; return i; }
static IN Kbd(ushort vk, ushort scan, uint flags) { IN i = new IN(); i.type = 1; i.u.ki.vk = vk; i.u.ki.scan = scan; i.u.ki.flags = flags; return i; }
public static void Click(int x, int y, bool dbl) {
  SetCursorPos(x, y); System.Threading.Thread.Sleep(40);
  for (int k = 0; k < (dbl ? 2 : 1); k++) { Send(Mouse(0x2, 0)); Send(Mouse(0x4, 0)); System.Threading.Thread.Sleep(30); }
}
public static void Wheel(int x, int y, int notches) { SetCursorPos(x, y); System.Threading.Thread.Sleep(30); Send(Mouse(0x800, (uint)(notches * 120))); }
/* press at one point, move there in small steps, let go: moves a note box by its handle in OneNote */
public static void Drag(int x0, int y0, int x1, int y1) {
  SetCursorPos(x0, y0); System.Threading.Thread.Sleep(120); Send(Mouse(0x2, 0)); System.Threading.Thread.Sleep(150);
  for (int k = 1; k <= 20; k++) { SetCursorPos(x0 + (x1 - x0) * k / 20, y0 + (y1 - y0) * k / 20); System.Threading.Thread.Sleep(20); }
  System.Threading.Thread.Sleep(120); Send(Mouse(0x4, 0)); System.Threading.Thread.Sleep(150);
}
public static void Hover(int x, int y) { SetCursorPos(x, y); }
/* type any text as real keystrokes: works in boxes that ignore pasting (maths editors, some quiz sites) */
public static void Type(string s) {
  foreach (char ch in s) {
    if (ch == '\n') { Key(0x0D, false, false); continue; }
    Send(Kbd(0, ch, 0x4)); Send(Kbd(0, ch, 0x4 | 0x2)); System.Threading.Thread.Sleep(12);
  }
}
public static void Key(ushort vk, bool ctrl, bool shift) {
  if (ctrl) Send(Kbd(0x11, 0, 0)); if (shift) Send(Kbd(0x10, 0, 0));
  uint ext = (vk >= 0x21 && vk <= 0x2E) ? 1u : 0u;
  Send(Kbd(vk, 0, ext)); Send(Kbd(vk, 0, ext | 0x2));
  if (shift) Send(Kbd(0x10, 0, 0x2)); if (ctrl) Send(Kbd(0x11, 0, 0x2));
  System.Threading.Thread.Sleep(20);
}
'@
[void][MBH.U]::SetProcessDPIAware()
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Drawing;
public static class MBHandle {
  /* a OneNote note box shows a light grey strip along its top (its handle). Look above (x, y) for the lowest such strip */
  public static int[] Find(int x, int y) {
    int L = x - 120, T = y - 70, W = 420, H = 80;
    using (var bmp = new Bitmap(W, H)) {
      using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(L, T, 0, 0, new Size(W, H));
      for (int r = H - 1; r >= 0; r--) {
        int run = 0, start = -1, best = 0, bestStart = -1;
        for (int c = 0; c < W; c++) {
          Color p = bmp.GetPixel(c, r);
          bool grey = Math.Abs(p.R - p.G) < 8 && Math.Abs(p.G - p.B) < 8 && p.R >= 195 && p.R <= 238;
          if (grey) { if (run == 0) start = c; run++; if (run > best) { best = run; bestStart = start; } } else run = 0;
        }
        if (best >= 60) return new int[] { L + bestStart + best / 2, T + r };
      }
    }
    return null;
  }
}
'@

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$t) { $task = $asTaskGeneric.MakeGenericMethod($t).Invoke($null, @($op)); [void]$task.Wait(-1); $task.Result }
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $ocr) { $ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'en-US')) }

# words with their boxes, grouped in lines, in the picture's pixels
function Read-Text($path) {
  if (-not $ocr) { return @() }
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  try {
    $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bmp = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $res = Await ($ocr.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
  } finally { $stream.Dispose() }
  $lines = @()
  foreach ($l in $res.Lines) {
    $words = @()
    foreach ($w in $l.Words) { $r = $w.BoundingRect; $words += , @{ t = $w.Text; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height } }
    $lines += , @{ t = $l.Text; words = $words }
  }
  return $lines
}

# what you can type in or click in the window that was in front (web pages in Chrome and Edge included), in screen pixels
$CT = [System.Windows.Automation.ControlType]
$KINDS = @{ $CT::Image.Id = 'image'; $CT::Document.Id = 'doc'; $CT::Edit.Id = 'edit'; $CT::ComboBox.Id = 'combo'; $CT::Button.Id = 'button'; $CT::Hyperlink.Id = 'link'; $CT::RadioButton.Id = 'radio'; $CT::CheckBox.Id = 'check'; $CT::ListItem.Id = 'item'; $CT::MenuItem.Id = 'menu'; $CT::TabItem.Id = 'tab' }
function Find-Controls([Int64]$hwnd) {
  $out = @()
  if ($hwnd -eq 0) { return $out }
  $A = [System.Windows.Automation.AutomationElement]
  $root = $A::FromHandle([IntPtr]$hwnd)
  $conds = @(); foreach ($t in @($CT::Image, $CT::Document, $CT::Edit, $CT::ComboBox, $CT::Button, $CT::Hyperlink, $CT::RadioButton, $CT::CheckBox, $CT::ListItem, $CT::MenuItem, $CT::TabItem)) { $conds += New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, $t) }
  $cond = New-Object System.Windows.Automation.OrCondition(, [System.Windows.Automation.Condition[]]$conds)
  # Chrome and Edge build a page's accessibility only once something asks, so the first look can see just the browser's own buttons
  $found = $null
  for ($try = 0; $try -lt 4; $try++) {
    $found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if ($root.Current.ClassName -ne 'Chrome_WidgetWin_1') { break }
    $doc = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, $CT::Document)))
    if ($doc -and $doc.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)) { $found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond); break }
    Start-Sleep -Milliseconds 350
  }
  foreach ($e in $found) {
    if ($out.Count -ge 400) { break }
    try {
      $c = $e.Current
      if ($c.IsOffscreen -or -not $c.IsEnabled) { continue }
      $r = $c.BoundingRectangle
      $kind = $KINDS[$c.ControlType.Id]
      if ($r.IsEmpty -or $r.Width -lt 6 -or $r.Height -lt 6 -or ($r.Height -gt 400 -and $kind -ne 'doc' -and $kind -ne 'edit' -and $kind -ne 'image')) { continue }
      $o = @{ kind = $kind; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height; name = [string]$c.Name; focus = [bool]$c.HasKeyboardFocus }
      if ($kind -eq 'edit' -or $kind -eq 'combo') {
        try { $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $o.value = [string]$vp.Current.Value; if ($vp.Current.IsReadOnly -and $kind -eq 'edit') { continue } } catch { $o.value = '' }
      }
      if ($kind -eq 'radio' -or $kind -eq 'check') {
        try { $o.on = [bool]($e.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected) } catch { try { $o.on = ($e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState -eq 'On') } catch { } }
      }
      $out += , $o
    } catch { }
  }
  return $out
}

$VK = @{ ENTER = 0x0D; TAB = 0x09; ESC = 0x1B; ESCAPE = 0x1B; SPACE = 0x20; BACKSPACE = 0x08; DELETE = 0x2E; LEFT = 0x25; UP = 0x26; RIGHT = 0x27; DOWN = 0x28; HOME = 0x24; END = 0x23; PAGEDOWN = 0x22; PAGEUP = 0x21; A = 0x41 }

# steps: click {x,y}, text {text}, key {key, ctrl, shift}, scroll {x,y,n}, wait {ms}
function Run-Steps($steps, [Int64]$hwnd) {
  $p = New-Object MBH.U+P; [void][MBH.U]::GetCursorPos([ref]$p)
  if ($hwnd -ne 0) { [void][MBH.U]::Front([IntPtr]$hwnd); Start-Sleep -Milliseconds 150 }
  $n = 0
  foreach ($s in $steps) {
    switch ($s.do) {
      'click' { [MBH.U]::Click([int]$s.x, [int]$s.y, [bool]$s.double); Start-Sleep -Milliseconds 160 }
      'text' { [MBH.U]::Type([string]$s.text); Start-Sleep -Milliseconds 60 }
      'key' { $k = $VK[([string]$s.key).ToUpper()]; if ($k) { [MBH.U]::Key([uint16]$k, [bool]$s.ctrl, [bool]$s.shift) }; Start-Sleep -Milliseconds 60 }
      'scroll' { [MBH.U]::Wheel([int]$s.x, [int]$s.y, [int]$s.n); Start-Sleep -Milliseconds 250 }
      'drag' { [MBH.U]::Drag([int]$s.x, [int]$s.y, [int]$s.x2, [int]$s.y2); Start-Sleep -Milliseconds 200 }
      'hover' { [MBH.U]::Hover([int]$s.x, [int]$s.y); Start-Sleep -Milliseconds 250 }
      'wait' { Start-Sleep -Milliseconds ([int]$s.ms) }
    }
    $n++
  }
  if (-not $cmd.keepMouse) { [void][MBH.U]::SetCursorPos($p.X, $p.Y) }
  return @{ done = $n }
}

Write-Output '{"ready":true}'
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $reply = @{}
  try {
    $cmd = $line | ConvertFrom-Json
    $reply.id = $cmd.id
    switch ($cmd.op) {
      'scan' {
        $reply.controls = @(); $reply.lines = @()
        try { $reply.controls = @(Find-Controls ([Int64]$cmd.hwnd)) } catch { $reply.boxErr = $_.Exception.Message }
        try { if ([Int64]$cmd.hwnd -ne 0) { $we = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][Int64]$cmd.hwnd); $wr = $we.Current.BoundingRectangle; $reply.win = @{ x = [int]$wr.X; y = [int]$wr.Y; w = [int]$wr.Width; h = [int]$wr.Height }; $reply.app = (Get-Process -Id $we.Current.ProcessId).ProcessName } } catch { }
        if ($cmd.path) { try { $reply.lines = @(Read-Text $cmd.path) } catch { $reply.ocrErr = $_.Exception.Message } }
      }
      'ocr' { try { $reply.lines = @(Read-Text $cmd.path) } catch { $reply.ocrErr = $_.Exception.Message; $reply.lines = @() } }
      'handle' { $h = [MBHandle]::Find([int]$cmd.x, [int]$cmd.y); if ($h) { $reply.x = $h[0]; $reply.y = $h[1] - 2 } }
      'fg' { $reply.hwnd = [MBH.U]::GetForegroundWindow().ToInt64() }
      'focus' {
        # Windows only lets the app in front hand over focus; a tap of Alt counts as input and lifts that lock
        $reply.ok = [MBH.U]::Front([IntPtr][Int64]$cmd.hwnd)
      }
      'act' { $reply.result = Run-Steps $cmd.steps ([Int64]$cmd.hwnd) }
      'quit' { exit 0 }
    }
  } catch { $reply.error = $_.Exception.Message }
  [Console]::Out.WriteLine((ConvertTo-Json $reply -Compress -Depth 8)); [Console]::Out.Flush()
}
