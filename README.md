# Mathbench desktop

Equation solver and graphing calculator that lives in your system tray.
Press the hotkey and a Game Bar style overlay (blue and white) opens over your screen with a top bar and floating Solver and Graph widgets. Press Capture (or C), drag across a math problem anywhere on screen, and Mathbench reads it and solves it. Esc closes the overlay.

## Download
Get the Windows installer, **Mathbench Setup.exe**, from the [Releases page](https://github.com/meowskers101/mathbench/releases/latest). Run it, pick a folder and click Install. If Windows says "Windows protected your PC" (the installer is not code-signed), click More info, then Run anyway.

## Build it yourself
1. Install Node.js (https://nodejs.org), LTS version.
2. In this folder run `npm install`, then `npx electron .` to start it from the source.
3. `npm run dist` makes the installer (`Mathbench Setup.exe`) in `dist/`.

## Use it
- Hotkey: Ctrl + Alt + M (change it in Settings, from the tray icon).
- The screen dims and a white and blue bar appears at the top: Math problem, Copy image, Save image, whole screen, settings.
- Pick a mode (or press 1, 2, 3), then drag across the area. Esc or right-click cancels. Enter captures the whole screen.
- Math problem: the crop is read on your computer, then solved in Mathbench. Check what was read before trusting the answer.

## Do it for me (Ctrl + Alt + P)
- Press it on a page with problems. Mathbench numbers the problems it finds and outlines the answer boxes.
- Type what to do and press Enter: "do 3", "#2 and #5", "1-4", "all", "the last two", "this one", "#3 in the box below", "box 2", "here", "as a decimal", "round to the nearest tenth", or a problem of your own ("solve 3x-4=11 and put it here"). A line shows where each answer will go before you press Enter.
- Clicked into an answer box first? Just press Enter: it solves the problem that box belongs to.
- Two separate choices under the directions box (both remembered):
  - Words (Ctrl + 1 to 4): Without words "6", Less words "x = 6", With words "The answer is x = 6.", More words "To solve 2x+5=17: 2x = 12; x = 12 ÷ 2, so the answer is x = 6."
  - Work (Ctrl + 5 steps through them): Off, Few (only the key step, "2x = 12"), Some (the main steps: "2x + 5 = 17, 2x = 12, x = 12 ÷ 2") and All steps (every small step: what is done to both sides, each bit of arithmetic one operation at a time, the two numbers that factor a quadratic or the formula worked out, the multiples for a common denominator, inside-out for function problems with letter answers multiplied out, and a check at the end).
  - They combine: Without words + All steps gives every step as plain maths ("2x + 5 − 5 = 17 − 5; 2x = 12; 2x ÷ 2 = 12 ÷ 2; x = 6; 2(6) + 5 = 17 ✓"); With words adds the explaining lines ("Subtract 5 from both sides"); More words also says the plan first and ends in a sentence.
  - You can also say it in the directions: "just the answer", "less words", "in a sentence", "show your work", "few steps", "all steps", "step by step". A direction about steps changes only the work; one about words changes only the words. In OneNote and documents each step goes on its own line; in web answer boxes the steps are joined with semicolons, so nothing presses Enter on the page.
- OneNote mode (turns on by itself in OneNote): each answer is typed in a new note box in a clear spot, then dragged beside its problem. Mathbench never presses Ctrl + A in OneNote.
- Small print: if the page's text is very small, Mathbench says so; zooming in (Ctrl and +) makes reading more reliable.
- On a busy page (OneNote, notes, a long document), drag a box around the problem you want and press Enter. It only counts lines that look like maths, so sentences, dates and to-do lists are skipped.
- Handwriting works too (a OneNote page you wrote on, a photo of your worksheet on screen). Windows' text reader cannot read handwriting, so Mathbench finds the handwritten lines from the ink itself and Formula AI reads them.
- You can also click a problem (Shift-click for more) and then a box. "Answers only" (Alt + Enter) shows the answers without typing them.
- Everything runs on your PC: Windows' own text reader and accessibility find the problems and boxes, Formula AI reads the maths, answers are typed as keystrokes, and the mouse is put back afterwards.

## No key, no account
Problems are read on your computer by Formula AI, a maths recognition model that reads printed and handwritten formulas, including stacked fractions, roots, powers and multi-line systems. It is the only reader: no choice to make, no key, and no internet needed. It reads a formula in about one second. If some symbols were hard to make out it says so. Check the text it fills in before solving.

## What it touches on your PC
- Takes a screenshot only when you press a hotkey (or click Capture). Do it for me also moves the mouse to click answer boxes and types the answers, then puts the mouse back.
- Saves settings in your user profile (`%APPDATA%\mathbench-desktop`).
- "Save image" writes PNGs to Pictures\Mathbench captures.
- Downloads Mathbench AI (about 1.8 GB, from Mathbench's GitHub releases) only when you click Download on a word problem.
- It does not install services, change system settings, or start with Windows.

## Notes
- Everything runs on the computer it is installed on, with no account, key or server: the solver, the formula reader and Do it for me all work offline. Only the page fonts are fetched from the internet when available (without them it falls back to system fonts).
- Windows Win-key shortcuts (like Win + G, Game Bar's own) cannot be used as hotkeys by other apps.

## Word problems: Mathbench AI
Type a word problem ("Ben has $5 more than Carl. Together they have $45. How much does Carl have?") and press Solve. Mathbench AI reads it, writes the equation (x + x + 5 = 45, where x is Carl's money) and the solver finishes it. The card shows the equation it wrote, so you can check it matches the problem. In Do it for me, numbered word problems on a page are picked up too.
- Mathbench AI is Qwen2.5 1.5B Instruct (Apache 2.0), a small language model run on your PC with Transformers.js, on the graphics card when it can (a few seconds per problem) and otherwise on the processor (slower).
- It is not in the installer. The first time you solve a word problem, Mathbench asks before downloading it once (about 1.8 GB, into `%APPDATA%\mathbench-desktop\ai`); after that it works offline. A cancelled or broken download carries on where it stopped, and every piece is checked before it is kept.
- On 24 school word problems it wrote a correct equation for 21. Check the equation before trusting the answer.

## About Formula AI
Formula AI is pix2text-mfr 1.5 by breezedeus (MIT licence, https://huggingface.co/breezedeus/pix2text-mfr-1.5), a TrOCR encoder-decoder trained on images of printed and handwritten formulas. Mathbench ships an 8-bit copy (about 32 MB, in `renderer/mfr` as base64 text) and runs it with ONNX Runtime Web (`renderer/ort`), in a background worker so the window stays responsive. Two adjustments on top of the model: the picture is cropped with a white margin a fifth of the formula's size, and when the model is about to write a Greek letter that looks like a Latin one (chi for x, eta for y), it writes the Latin letter instead. The app serves its pages from `mathbench://app/` so the reader can load these files.

## Training data and licences
Formula AI has been fine-tuned (Mathbench 1.8.0) only on data that allows commercial use: real student worksheets from WindyVerse/Handwritten-Latex-Datasets (Apache 2.0) and practice problems Mathbench generates itself, drawn with openly licensed fonts (Google Fonts, DejaVu, STIX, Computer Modern). Google's MathWriting (CC BY-NC-SA, non-commercial) is not used. On 1,985 hand-checked worksheet formulas it reads 98.0% exactly right. Full licence texts are in `renderer/NOTICES.txt`, which is also linked from Settings.


## Licence
Mathbench is open source under the Apache License 2.0 (see `LICENSE`). The parts it is built on keep their own licences, listed in `renderer/NOTICES.txt`.
