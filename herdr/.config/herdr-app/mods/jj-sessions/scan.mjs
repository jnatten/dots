// Past Claude Code sessions as JSON [{id, cwd, title, prompt, at, branches, prs, refs}], newest
// first: cwd, title and prompt from each transcript's head and tail; branches (jj bookmarks pushed
// or set, git's branch unless HEAD), PRs (pr-link records) and refs (GitHub PR and issue and Trello
// card links in your prompts, Claude's replies and its tool calls, not in tool output) from all of
// it, read once and then only what was added since.

import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const ROOT = join(homedir(), ".claude", "projects");
const CACHE = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "herdr-jj-sessions.json");
const VERSION = 2;
const HEAD = 131072;
const TAIL = 65536;
const CHUNK = 4 << 20;
const KEEP = 20;
const COMMAND = /<command-name>([\s\S]*?)<\/command-name>/;
const NAME = String.raw`([A-Za-z0-9._/][A-Za-z0-9._/-]*)`;
const FLAGS = String.raw`(?:(?:-r|--revision|--to|--from|-t|-f)[ =][^ "\\]+ |-B |--allow-backwards )*`;
const BOOKMARK = new RegExp(String.raw`\bjj (?:git push[^"]*?(?:-b|--bookmark|--named)[ =]|bookmark (?:create|set|move|c|s|m) ${FLAGS})${NAME}|\bgh pr create[^"]*?--head[ =]${NAME}`, "g");
const BRANCH = /"gitBranch":"([^"]+)"/;
const LINK = /https:\/\/(?:github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|issues)\/\d+|trello\.com\/c\/[\w-]+)/g;

function* records(text) {
  for (const line of text.split(/\r?\n/)) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record && typeof record === "object" && !Array.isArray(record)) yield record;
  }
}

function texts(record) {
  const content = record.message?.content;
  if (typeof content === "string") return [content];
  return (Array.isArray(content) ? content : []).filter((c) => c && typeof c === "object" && c.type === "text").map((c) => c.text || "");
}

const said = (record) => [...texts(record), ...(Array.isArray(record.message?.content) ? record.message.content : []).filter((c) => c?.type === "tool_use").map((c) => JSON.stringify(c.input ?? {}))];

function chunk(fd, at, length) {
  const buffer = Buffer.alloc(length);
  return buffer.subarray(0, readSync(fd, buffer, 0, length, at)).toString("utf8");
}

function read(path, size) {
  const fd = openSync(path, "r");
  try {
    if (size <= HEAD + TAIL) {
      const data = chunk(fd, 0, size);
      return [data, data];
    }
    const tail = chunk(fd, size - TAIL, TAIL);
    return [chunk(fd, 0, HEAD), tail.slice(tail.indexOf("\n") + 1)];
  } finally {
    closeSync(fd);
  }
}

function scan(path, size) {
  const [head, tail] = read(path, size);
  let cwd = null, prompt = null, command = null;
  for (const r of records(head)) {
    cwd ||= r.cwd || null;
    if (prompt || r.type !== "user" || r.isMeta || r.isSidechain) continue;
    for (let text of texts(r)) {
      text = text.trim();
      const match = text.match(COMMAND);
      if (match) command ||= match[1].trim();
      else if (text && !text.startsWith("<")) {
        prompt = text.split(/\s+/).filter(Boolean).join(" ").slice(0, 300);
        break;
      }
    }
  }
  let custom = null, ai = null, relocated = null;
  for (const r of records(tail)) {
    if (r.type === "custom-title" && (r.customTitle || "").trim()) custom = r.customTitle.trim();
    else if (r.type === "ai-title" && (r.aiTitle || "").trim()) ai = r.aiTitle.trim();
    else if (r.type === "relocated" && r.relocatedCwd) relocated = r.relocatedCwd;
  }
  if (!custom) {
    try {
      custom = (JSON.parse(readFileSync(join(path.slice(0, -".jsonl".length), "custom-title.json"), "utf8")).customTitle || "").trim() || null;
    } catch {}
  }
  const title = custom || ai || prompt;
  cwd = relocated || cwd;
  if (!title || !cwd) return null;
  return { id: basename(path, ".jsonl"), cwd, title: title.slice(0, 200), prompt: prompt || command || "" };
}

function add(list, value, same = (a) => a === value) {
  if (!value || list.some(same)) return;
  list.push(value);
  if (list.length > KEEP) list.shift();
}

function collect(text, found) {
  for (const line of text.split("\n")) {
    if (line.includes('"type":"pr-link"')) {
      try {
        const r = JSON.parse(line);
        if (r.prUrl) add(found.prs, { number: r.prNumber, url: r.prUrl, repo: r.prRepository || "" }, (p) => p.url === r.prUrl);
      } catch {}
    }
    if (line.includes('"gitBranch":"') && !line.includes('"gitBranch":"HEAD"')) add(found.branches, line.match(BRANCH)?.[1]);
    if (line.includes('"command":"') && (line.includes("jj ") || line.includes("gh pr create"))) for (const m of line.matchAll(BOOKMARK)) add(found.branches, m[1] ?? m[2]);
    if ((line.includes("github.com/") || line.includes("trello.com/c/")) && (line.includes('"type":"assistant"') || (line.includes('"type":"user"') && !line.includes('"tool_result"')))) {
      try {
        const r = JSON.parse(line);
        if ((r.type === "user" || r.type === "assistant") && !r.isMeta && !r.isSidechain) for (const t of said(r)) for (const m of t.matchAll(LINK)) add(found.refs, m[0]);
      } catch {}
    }
  }
}

// Reads `path` from byte `from` to `size`, collecting from its whole lines; returns where the
// next read starts (after the last newline).
function grow(path, from, size, found) {
  const fd = openSync(path, "r");
  try {
    let at = from;
    let rest = Buffer.alloc(0);
    while (at < size) {
      const buffer = Buffer.alloc(Math.min(CHUNK, size - at));
      const n = readSync(fd, buffer, 0, buffer.length, at);
      if (!n) break;
      at += n;
      const data = rest.length ? Buffer.concat([rest, buffer.subarray(0, n)]) : buffer.subarray(0, n);
      const end = data.lastIndexOf(10);
      if (end < 0) {
        rest = data;
        continue;
      }
      collect(data.subarray(0, end).toString("utf8"), found);
      rest = data.subarray(end + 1);
    }
    return at - rest.length;
  } finally {
    closeSync(fd);
  }
}

let cache = {};
try {
  const saved = JSON.parse(readFileSync(CACHE, "utf8"));
  if (saved?.v === VERSION) cache = saved.files ?? {};
} catch {}
const fresh = {};
const out = [];
let dirs = [];
try {
  dirs = readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory());
} catch {}
for (const dir of dirs) {
  let files = [];
  try {
    files = readdirSync(join(ROOT, dir.name)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    continue;
  }
  for (const file of files) {
    const path = join(ROOT, dir.name, file);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    const key = [st.mtimeMs / 1000, st.size];
    const hit = cache[path];
    let entry = null;
    let offset = 0;
    let found = { branches: [], prs: [], refs: [] };
    if (hit && hit.key?.[0] === key[0] && hit.key?.[1] === key[1]) ({ entry, offset, found } = hit);
    else {
      if (hit?.found && hit.offset <= st.size) ({ offset, found } = hit);
      try {
        entry = scan(path, st.size);
        offset = grow(path, offset, st.size, found);
      } catch {}
    }
    fresh[path] = { key, entry, offset, found };
    if (entry) out.push({ ...entry, at: Math.floor(st.mtimeMs / 1000), ...found });
  }
}
try {
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(`${CACHE}.tmp`, JSON.stringify({ v: VERSION, files: fresh }));
  renameSync(`${CACHE}.tmp`, CACHE);
} catch {}
out.sort((a, b) => b.at - a.at);
process.stdout.write(JSON.stringify(out));
