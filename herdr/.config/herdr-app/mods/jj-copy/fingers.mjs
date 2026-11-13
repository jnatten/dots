// Hint mode, as tmux-fingers: draws a pane's screen with the matches of
// patterns.json highlighted and a hint on each, reads the hint typed and writes
// {text, kind, action} to the result file ("copy"; Ctrl: "open"; Shift: "paste"),
// or {none: true} when nothing matched. Run in a terminal shown in the pane.
//
// usage: node fingers.mjs <hc read --json file> <result file> <pattern ids json> <cols> <rows>

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ALPHABET = "sdfjklghqwertyuopzxbn";
const [DIM, MATCH, HINT, TYPED, RESET] = ["\x1b[0;2m", "\x1b[0;33m", "\x1b[0;1;32m", "\x1b[0;1;34m", "\x1b[0m"];

export function patterns(ids) {
  const every = JSON.parse(readFileSync(fileURLToPath(new URL("./patterns.json", import.meta.url)), "utf8"));
  return every.filter((p) => ids.includes(p.id)).map((p) => ({ ...p, rx: new RegExp(p.regex, `gd${p.flags ?? ""}`), req: (p.require ?? []).map((q) => new RegExp(q)) }));
}

// Trailing punctuation off a match, and closing brackets it didn't open.
function tidy(text, chars) {
  while (text) {
    const last = text.at(-1);
    const open = "([{"[")]}".indexOf(last)];
    if (chars.includes(last) || "([{".includes(last) || (open && text.split(open).length < text.split(last).length)) text = text.slice(0, -1);
    else break;
  }
  return text;
}

export function find(lines, pats) {
  const taken = lines.map(() => []);
  const found = [];
  for (const p of pats) {
    lines.forEach((line, row) => {
      for (const m of line.matchAll(p.rx)) {
        const group = m.slice(1).findIndex((g) => g !== undefined) + 1;
        const start = m.indices[group][0];
        const text = p.trim ? tidy(m[group], p.trim) : m[group];
        const end = start + text.length;
        if (!text || p.req.some((q) => !q.test(text))) continue;
        if (taken[row].some(([s, e]) => start < e && s < end)) continue;
        taken[row].push([start, end]);
        found.push({ row, start, end, text, kind: p.id });
      }
    });
  }
  return found;
}

export function hints(found) {
  const texts = [];
  for (const m of [...found].sort((a, b) => b.row - a.row || a.start - b.start)) if (!texts.includes(m.text)) texts.push(m.text);
  const k = ALPHABET.length;
  let prefixes = 0;
  while (k - prefixes + prefixes * k < texts.length) prefixes++;
  const labels = [...ALPHABET.slice(0, k - prefixes)];
  for (const a of ALPHABET.slice(k - prefixes)) for (const b of ALPHABET) labels.push(a + b);
  return new Map(texts.map((t, i) => [t, labels[i]]));
}

function draw(lines, found, labels, typed) {
  const rows = new Map();
  for (const m of found) if (labels.has(m.text)) rows.set(m.row, [...(rows.get(m.row) ?? []), m]);
  let out = "\x1b[H\x1b[2J";
  lines.forEach((line, r) => {
    out += `\x1b[${r + 1};1H${DIM}`;
    let pos = 0;
    for (const m of (rows.get(r) ?? []).sort((a, b) => a.start - b.start)) {
      const label = labels.get(m.text);
      out += DIM + line.slice(pos, m.start);
      out += label.startsWith(typed)
        ? TYPED + typed + HINT + label.slice(typed.length) + MATCH + line.slice(m.start + label.length, m.end)
        : DIM + line.slice(m.start, m.end);
      pos = m.end;
    }
    out += DIM + line.slice(pos);
  });
  process.stdout.write(out + RESET);
}

function main() {
  const [screen, result, ids, cols, rows] = process.argv.slice(2);
  const text = JSON.parse(readFileSync(screen, "utf8")).text ?? "";
  const lines = [...text.split("\n"), ...Array(Number(rows)).fill("")].slice(0, Number(rows));
  const found = find(lines, patterns(JSON.parse(ids)));
  const labels = hints(found);
  if (!labels.size) {
    writeFileSync(result, JSON.stringify({ none: true }));
    return;
  }

  const { stdin, stdout } = process;
  stdin.setRawMode(true);
  stdout.write("\x1b[?1049h\x1b[?25l\x1b[?7l");
  const finish = (chosen) => {
    if (chosen) writeFileSync(result, JSON.stringify(chosen));
    stdout.write("\x1b[?7h\x1b[?25h\x1b[?1049l", () => process.exit(0));
  };
  let typed = "";
  let mods = new Set();
  const redraw = () => draw(lines, found, labels, typed);
  stdout.on("resize", redraw);
  stdin.on("data", (data) => {
    const s = data.toString("latin1");
    if (s === "\x1b" || s[0] === "\x03") return finish(null);
    if (s[0] === "\x1b") return;
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      if (c === 0x7f) {
        typed = typed.slice(0, -1);
        continue;
      }
      let letter;
      let mod = null;
      if (c >= 0x01 && c <= 0x1a) (letter = String.fromCharCode(c + 96)), (mod = "open");
      else if (c >= 0x41 && c <= 0x5a) (letter = String.fromCharCode(c + 32)), (mod = "paste");
      else if (c >= 0x61 && c <= 0x7a) letter = ch;
      else continue;
      typed += letter;
      if (mod) mods.add(mod);
      const hit = [...labels].find(([, label]) => label === typed)?.[0];
      if (hit !== undefined) {
        const kind = found.find((m) => m.text === hit).kind;
        return finish({ text: hit, kind, action: mods.has("open") ? "open" : mods.has("paste") ? "paste" : "copy" });
      }
      if (![...labels.values()].some((label) => label.startsWith(typed))) (typed = ""), (mods = new Set());
    }
    redraw();
  });

  const deadline = Date.now() + 1500;
  const ready = () => {
    if (Date.now() < deadline && (stdout.columns !== Number(cols) || stdout.rows !== Number(rows))) return setTimeout(ready, 20);
    redraw();
  };
  ready();
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
