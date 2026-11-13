// Writes a herdr-core terminal's history and screen, colours kept, as lines of
// text with SGR codes (what tmux's capture-pane -e gives): the first paint of a
// watch-only `hc attach`, without its clears, tab stops and cursor moves.
//
// usage: node capture.mjs <terminal> <file> [history lines]

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CLEAR = "\x1b[H\x1b[2J";

// hc attach asks the terminal it runs in about itself and paints only once it has
// answers, or after half a second without them.
const REPLIES = {
  "\x1b]10;?": "\x1b]10;rgb:ffff/ffff/ffff\x1b\\",
  "\x1b]11;?": "\x1b]11;rgb:0000/0000/0000\x1b\\",
  "\x1b]12;?": "\x1b]12;rgb:ffff/ffff/ffff\x1b\\",
  "\x1b[16t": "\x1b[6;20;10t",
  "\x1b[c": "\x1b[?62;22c",
};

// Bytes as a latin1 string, so the patterns below work byte by byte.
function firstPaint(terminal, history) {
  return new Promise((resolve) => {
    const child = spawn("hc", ["attach", "--observe", "--history", history, terminal], { stdio: ["pipe", "pipe", "ignore"] });
    let data = "";
    const answered = new Set();
    const start = Date.now();
    let last = start;
    const done = () => {
      clearInterval(timer);
      child.kill("SIGTERM");
      resolve(data);
    };
    child.stdout.on("data", (chunk) => {
      data += chunk.toString("latin1");
      last = Date.now();
      for (const [query, reply] of Object.entries(REPLIES)) {
        if (!answered.has(query) && data.includes(query)) {
          answered.add(query);
          child.stdin.write(reply);
        }
      }
    });
    child.stdin.on("error", () => {});
    child.on("exit", done);
    const timer = setInterval(() => {
      const now = Date.now();
      if (now - start > 3000 || now - last > (data.includes(CLEAR) ? 60 : 600)) done();
    }, 20);
  });
}

// Everything but SGR (colour) codes: string commands (OSC, DCS, APC, PM), other
// CSI sequences, and two-byte escapes.
const STRINGS = /\x1b[\]P_^][\s\S]*?(?:\x07|\x1b\\)/g;
const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const SGR = /^\x1b\[[0-9;:]*m$/;
const SHORT = /\x1b[ -/]*[0-~]/g;

function clean(part) {
  return part
    .replace(STRINGS, "")
    .replace(CSI, (m) => (SGR.test(m) ? m : ""))
    .replace(SHORT, (m) => (m.startsWith("\x1b[") ? m : ""))
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "");
}

// The paint is: modes, a clear, the history as lines, newlines that push it into
// scrollback, another clear, tab stops, then the screen as lines.
function lines(paint) {
  const first = paint.indexOf(CLEAR);
  const second = first !== -1 ? paint.indexOf(CLEAR, first + CLEAR.length) : -1;
  const history = second !== -1 ? paint.slice(first + CLEAR.length, second) : "";
  const screen = second !== -1 ? paint.slice(second + CLEAR.length) : first !== -1 ? paint.slice(first + CLEAR.length) : paint;
  const parts = [clean(history).replace(/\n+$/, ""), clean(screen).replace(/^\n+|\n+$/g, "")].filter((p) => p.trim());
  return parts.join("\n").replace(/\n/g, "\r\n") + "\x1b[0m\r\n";
}

const [terminal, path, history = "100000"] = process.argv.slice(2);
writeFileSync(path, Buffer.from(lines(await firstPaint(terminal, history)), "latin1"));
