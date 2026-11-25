// One Claude Code session's conversation as JSON, for the Quick Look (peek.js):
// { turns: [{ at, prompt, steps: [{ md } | { tools: [{ name, what }] }] }], total, started, ended },
// the last LAST turns of its main thread, each a prompt you typed and what Claude wrote and ran
// after it, in order, a run of tool calls one step.
// `node peek.mjs <session id>`, or its source through `node --input-type=module -e "$src" <id>`.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const ROOT = join(homedir(), ".claude", "projects");
const LAST = 80;
const CAP = 6000;
const BUDGET = 3_000_000;
const SKIP = /^(?:<(?:task-notification|local-command-stdout|local-command-stderr|local-command-caveat|bash-stdout|bash-stderr)[\s>]|\[Request interrupted)/;

const cap = (text) => (text.length > CAP ? `${text.slice(0, CAP)}…` : text);
const tag = (text, name) => text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? null;
const atOf = (r) => Math.floor((Date.parse(r.timestamp ?? "") || 0) / 1000);

function find(id) {
  let path = null;
  let newest = 0;
  for (const d of readdirSync(ROOT, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = join(ROOT, d.name, `${id}.jsonl`);
    try {
      const st = statSync(p);
      if (st.mtimeMs > newest) [path, newest] = [p, st.mtimeMs];
    } catch {}
  }
  return path;
}

// What you typed in a user record: its text (a slash command as `/name args`, a ! command as
// `! cmd`), without system reminders; null for what Claude Code wrote there itself.
function prompt(r) {
  const content = r.message?.content;
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
  if (blocks.some((b) => b?.type === "tool_result")) return null;
  const out = [];
  for (const b of blocks) {
    if (b?.type === "image") out.push("[image]");
    if (b?.type !== "text") continue;
    const text = (b.text ?? "").replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
    if (!text || SKIP.test(text)) continue;
    const command = tag(text, "command-name");
    const bash = tag(text, "bash-input");
    if (command) out.push([command.startsWith("/") ? command : `/${command}`, tag(text, "command-args")].filter(Boolean).join(" "));
    else if (bash) out.push(`! ${bash}`);
    else out.push(text);
  }
  return out.length ? cap(out.join("\n\n")) : null;
}

function what(name, input = {}) {
  const line = (s) => String(s ?? "").split("\n")[0].slice(0, 140);
  if (name === "Bash") return line(input.description || input.command);
  if (input.file_path || input.notebook_path) return basename(input.file_path || input.notebook_path);
  if (name === "Grep" || name === "Glob") return line(input.pattern);
  if (name === "WebFetch") return line(input.url);
  if (name === "WebSearch") return line(input.query);
  if (name === "Skill") return line(input.skill);
  return line(input.description ?? "");
}

const id = process.argv.at(-1);
const path = /^[\w-]+$/.test(id ?? "") ? find(id) : null;
if (!path) {
  process.stdout.write(JSON.stringify({ error: "Its transcript isn't on this machine." }));
  process.exit(0);
}
const turns = [];
let started = 0;
let ended = 0;
for (const line of readFileSync(path, "utf8").split("\n")) {
  if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
  let r;
  try {
    r = JSON.parse(line);
  } catch {
    continue;
  }
  if ((r.type !== "user" && r.type !== "assistant") || r.isSidechain || r.isMeta || r.isCompactSummary) continue;
  const at = atOf(r);
  started ||= at;
  ended = at || ended;
  if (r.type === "user") {
    const text = prompt(r);
    if (text) turns.push({ at, prompt: text, steps: [] });
    continue;
  }
  if (!turns.length) turns.push({ at, prompt: null, steps: [] });
  const steps = turns[turns.length - 1].steps;
  for (const b of Array.isArray(r.message?.content) ? r.message.content : []) {
    if (b?.type === "text" && b.text?.trim()) steps.push({ md: cap(b.text.trim()) });
    else if (b?.type === "tool_use") {
      const call = { name: b.name ?? "?", what: what(b.name, b.input) };
      if (steps.at(-1)?.tools) steps.at(-1).tools.push(call);
      else steps.push({ tools: [call] });
    }
  }
}
const shown = turns.slice(-LAST);
let size = shown.reduce((n, turn) => n + JSON.stringify(turn).length, 0);
while (shown.length > 1 && size > BUDGET) size -= JSON.stringify(shown.shift()).length;
process.stdout.write(JSON.stringify({ turns: shown, total: turns.length, started, ended }));
