// Copy mode, as tmux's: a pane's screen and history in their colours, with a cursor that
// vim keys move, v and V to select, / and ? to search, y or Enter to copy (the line when
// nothing is selected), q or Esc to leave. Writes {text} to the result file when something
// is copied. Run in a terminal shown in the pane, starting on the lines it showed.
// A row as wide as the pane is taken to go on in the next one (a wrapped line), outside
// the alternate screen, so copying joins them.
//
// usage: node copy.mjs <capture.mjs --rows file> <result file> <lines scrolled up> <screen rows> <cols> <rows>

import { readFileSync, writeFileSync } from "node:fs";
import * as vim from "./vim.js";

const [MATCH, REVERSE, BAR, RESET] = ["\x1b[30;43m", "\x1b[7m", "\x1b[0;30;43m", "\x1b[0m"];
const CSI = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end", "1~": "home", "7~": "home", "4~": "end", "8~": "end", "5~": "pageup", "6~": "pagedown" };

const [screen, result, up, screenRows, cols0, rows0] = process.argv.slice(2);
const capture = JSON.parse(readFileSync(screen, "utf8"));
const plain = (sgr) => !sgr || /^\x1b\[0?m$/.test(sgr);

// Each row's text, the SGR codes each of its characters is drawn with, and whether it wraps.
const lines = [];
const styles = [];
const wrapped = [];
let sgr = "";
for (const row of [...capture.lines, ...Array(Math.max(0, capture.history + Number(screenRows) - capture.lines.length)).fill("")]) {
  let text = "";
  const style = [];
  for (const part of row.split(/(\x1b\[[0-9;:]*m)/)) {
    if (part.startsWith("\x1b[")) sgr = /^\x1b\[0?[;m]/.test(part) ? part : sgr + part;
    else (text += part), style.push(...Array(part.length).fill(sgr));
  }
  const full = !capture.alt && text.length >= Number(cols0);
  while (!full && text.endsWith(" ") && plain(style.at(-1))) (text = text.slice(0, -1)), style.pop();
  lines.push(text);
  styles.push(style);
  wrapped.push(full);
}
let last = lines.length - 1;
while (last > 0 && !lines[last]) last--;

let rows = Number(rows0);
let cols = Number(cols0);
let top = Math.max(0, capture.history - Number(up));
let left = 0;
let cur = { row: 0, col: 0 };
let want = 0;
let anchor = null;
let mode = null; // "char" | "line" while selecting
let count = "";
let pending = "";
let query = "";
let dir = 1;
let searching = 0;
let input = "";
let message = "";
let moved = false;

// Until a key moves it, the cursor sits on the last line with text that's shown.
function settle() {
  let r = Math.min(top + rows, lines.length) - 1;
  while (r > top && !lines[r]) r--;
  cur = { row: Math.max(0, r), col: 0 };
  want = 0;
}

function reveal() {
  const { row, col } = cur;
  if (row < top) top = row;
  if (row >= top + rows) top = row - rows + 1;
  top = Math.max(0, Math.min(top, lines.length - rows));
  if (col < left) left = col;
  if (col >= left + cols) left = col - cols + 1;
}

function go(row, col, vertical) {
  const r = Math.max(0, Math.min(row, lines.length - 1));
  cur = vim.clamp(lines, { row: r, col: vertical ? want : col });
  if (!vertical) want = cur.col;
  reveal();
}

function find(d) {
  const hit = vim.search(lines, cur, query, d);
  if (hit) go(hit.row, hit.col, false);
  message = hit ? "" : `Not found: ${query}`;
}

// The columns of row r the selection covers, both ends included; null when none.
function selected(r) {
  if (!anchor) return null;
  const [s, e] = vim.ordered(anchor, cur);
  if (r < s.row || r > e.row) return null;
  const end = vim.lastCol(lines, r);
  if (mode === "line") return [0, end];
  return [r === s.row ? s.col : 0, r === e.row ? e.col : end];
}

// A row in its colours, search matches in yellow and the selection in reverse.
function line(r) {
  if (r >= lines.length) return "";
  const text = lines[r];
  const shown = text.slice(left, left + cols);
  const sel = selected(r);
  const width = Math.min(cols, Math.max(shown.length, sel ? 1 : 0));
  const paint = Array.from({ length: width }, (_, i) => styles[r][left + i] ?? "");
  for (const [s, e] of vim.matches(text, query)) for (let c = Math.max(s, left); c < Math.min(e, left + width); c++) paint[c - left] = MATCH;
  if (sel) for (let c = Math.max(sel[0], left); c <= Math.min(sel[1], left + width - 1); c++) paint[c - left] = (styles[r][c] ?? "") + REVERSE;
  let out = "";
  for (let i = 0; i < width; ) {
    let j = i;
    while (j < width && paint[j] === paint[i]) j++;
    out += RESET + paint[i] + shown.slice(i, j).padEnd(j - i, " ");
    i = j;
  }
  return out;
}

function draw() {
  if (!moved) settle();
  let out = "\x1b[?25l";
  for (let i = 0; i < rows; i++) out += `\x1b[${i + 1};1H${RESET}${line(top + i)}${RESET}\x1b[K`;
  const label = [count + pending, mode === "line" ? "V-LINE" : mode === "char" ? "VISUAL" : "", `[${cur.row + 1}/${last + 1}]`].filter(Boolean).join(" ");
  out += `\x1b[1;${Math.max(1, cols - label.length + 1)}H${BAR}${label}${RESET}`;
  if (searching) out += `\x1b[${rows};1H${RESET}\x1b[K${searching > 0 ? "/" : "?"}${input}`;
  else {
    if (message) out += `\x1b[${rows};1H${BAR}${message.slice(0, cols)}${RESET}`;
    out += `\x1b[${cur.row - top + 1};${cur.col - left + 1}H`;
  }
  process.stdout.write(out + "\x1b[?25h");
}

function* keys(s) {
  for (let i = 0; i < s.length; ) {
    const rest = s.slice(i);
    let m;
    if ((m = rest.match(/^\x1b\[<(\d+);\d+;\d+([Mm])/))) {
      const b = Number(m[1]);
      if (m[2] === "M" && b & 64) yield { key: b & 1 ? "wheeldown" : "wheelup" };
    } else if ((m = rest.match(/^\x1b\[([0-9;]*)([A-Za-z~])/))) {
      const name = CSI[m[2] === "~" ? `${m[1].split(";")[0]}~` : m[2]];
      if (name) yield { key: name };
    } else if ((m = rest.match(/^\x1bO([A-Za-z])/))) {
      if (CSI[m[1]]) yield { key: CSI[m[1]] };
    } else {
      const ch = String.fromCodePoint(rest.codePointAt(0));
      const c = ch.charCodeAt(0);
      m = [ch];
      if (c === 0x1b) yield { key: "escape" };
      else if (c === 0x0d) yield { key: "enter" };
      else if (c === 0x7f || c === 0x08) yield { key: "backspace" };
      else if (c > 0 && c < 0x1b && c !== 0x09) yield { key: String.fromCharCode(c + 96), ctrl: true };
      else if (c >= 0x20) yield { key: ch };
    }
    i += m[0].length;
  }
}

function finish(chosen) {
  if (chosen) writeFileSync(result, JSON.stringify(chosen));
  process.stdout.write("\x1b[?1006l\x1b[?1000l\x1b[?7h\x1b[?25h\x1b[?1049l", () => process.exit(0));
  return true;
}

function search({ key: k, ctrl }) {
  if (k === "escape" || (ctrl && k === "c")) searching = 0;
  else if (k === "enter") {
    searching = 0;
    if (input) query = input;
    if (query) find(dir);
  } else if (k === "backspace") {
    if (input) input = input.slice(0, -1);
    else searching = 0;
  } else if (ctrl && k === "u") input = "";
  else if (!ctrl && [...k].length === 1) input += k;
}

// True once it's done.
function key(e) {
  if (searching) return search(e);
  const { key: k, ctrl } = e;
  if (k === "wheelup" || k === "wheeldown") {
    if (!moved) settle();
    moved = true;
    top = Math.max(0, Math.min(top + (k === "wheelup" ? -3 : 3), lines.length - rows));
    const row = Math.max(top, Math.min(cur.row, top + rows - 1));
    if (row !== cur.row) cur = vim.clamp(lines, { row, col: want });
    return;
  }
  if (!moved) settle();
  moved = true;
  if (!ctrl && /^[0-9]$/.test(k) && (k !== "0" || count)) {
    count += k;
    return;
  }
  const n = Math.max(1, parseInt(count || "1", 10));
  const counted = count !== "";
  const was = pending;
  count = "";
  pending = "";
  message = "";
  const { row, col } = cur;
  const half = Math.max(1, Math.floor(rows / 2));
  const repeat = (f) => {
    let p = cur;
    for (let i = 0; i < n; i++) p = f(lines, p);
    go(p.row, p.col, false);
  };
  const select = (m) => {
    if (mode === m) {
      mode = null;
      anchor = null;
    } else {
      mode = m;
      anchor ??= { ...cur };
    }
  };
  const yank = () => {
    if (anchor) return finish({ text: vim.selection(lines, anchor, cur, mode === "line", (r) => wrapped[r]) });
    let [s, e] = [cur.row, cur.row];
    while (s > 0 && wrapped[s - 1]) s--;
    while (e < last && wrapped[e]) e++;
    return finish({ text: vim.selection(lines, { row: s, col: 0 }, { row: e, col: 0 }, true, (r) => wrapped[r]) });
  };
  if (ctrl) {
    if (k === "d") (top += half), go(row + half, col, true);
    else if (k === "u") (top = Math.max(0, top - half)), go(row - half, col, true);
    else if (k === "f") (top += rows), go(row + rows, col, true);
    else if (k === "b") (top = Math.max(0, top - rows)), go(row - rows, col, true);
    else if (k === "j" || k === "n") go(row + 5 * n, col, true);
    else if (k === "k" || k === "p") go(row - 5 * n, col, true);
    else if (k === "c") return finish(null);
  } else if (k === "j" || k === "down") go(row + n, col, true);
  else if (k === "k" || k === "up") go(row - n, col, true);
  else if (k === "h" || k === "left") go(row, col - n, false);
  else if (k === "l" || k === "right") go(row, col + n, false);
  else if (k === "w") repeat(vim.wordForward);
  else if (k === "b") repeat(vim.wordBackward);
  else if (k === "e") repeat(vim.wordEnd);
  else if (k === "0" || k === "home") go(row, 0, false);
  else if (k === "^") go(row, vim.firstNonBlank(lines[row]), false);
  else if (k === "$" || k === "end") go(row, Infinity, false), (want = Infinity);
  else if (k === "g") {
    if (was !== "g") pending = "g";
    else go(counted ? n - 1 : 0, 0, false);
  } else if (k === "G") go(counted ? n - 1 : last, 0, false);
  else if (k === "H") go(top, col, true);
  else if (k === "M") go(top + Math.floor(Math.min(rows, lines.length - top) / 2), col, true);
  else if (k === "L") go(Math.min(top + rows, lines.length) - 1, col, true);
  else if (k === "pagedown") (top += rows), go(row + rows, col, true);
  else if (k === "pageup") (top = Math.max(0, top - rows)), go(row - rows, col, true);
  else if (k === "v") select("char");
  else if (k === "V") select("line");
  else if (k === "o" && anchor) [anchor, cur] = [cur, anchor];
  else if (k === "y" || k === "enter") return yank();
  else if (k === "/" || k === "?") {
    dir = k === "/" ? 1 : -1;
    searching = dir;
    input = "";
  } else if (k === "n" && query) find(dir);
  else if (k === "N" && query) find(-dir);
  else if (k === "escape") {
    if (!anchor && !was && !counted) return finish(null);
    anchor = null;
    mode = null;
  } else if (k === "q") return finish(null);
}

const { stdin, stdout } = process;
stdin.setRawMode(true);
stdout.write("\x1b[?1049h\x1b[?7l\x1b[?1000h\x1b[?1006h");
let ready = false;
stdin.on("data", (data) => {
  if (!ready) return;
  for (const e of keys(data.toString("utf8"))) if (key(e)) return;
  draw();
});
stdout.on("resize", () => {
  if (!ready) return;
  [rows, cols] = [stdout.rows, stdout.columns];
  if (moved) reveal();
  draw();
});
const deadline = Date.now() + 1500;
const start = () => {
  if (Date.now() < deadline && (stdout.columns !== cols || stdout.rows !== rows)) return setTimeout(start, 20);
  [rows, cols] = [stdout.rows, stdout.columns];
  ready = true;
  draw();
};
start();
