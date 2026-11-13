// Past Claude Code sessions as JSON [{id, cwd, title, prompt, at}], newest first,
// from each transcript's head and tail.

import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const ROOT = join(homedir(), ".claude", "projects");
const CACHE = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "herdr-jj-sessions.json");
const HEAD = 131072;
const TAIL = 65536;
const COMMAND = /<command-name>([\s\S]*?)<\/command-name>/;

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

let cache = {};
try {
  cache = JSON.parse(readFileSync(CACHE, "utf8"));
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
    if (hit && hit.key?.[0] === key[0] && hit.key?.[1] === key[1]) entry = hit.entry;
    else {
      try {
        entry = scan(path, st.size);
      } catch {}
    }
    fresh[path] = { key, entry };
    if (entry) out.push({ ...entry, at: Math.floor(st.mtimeMs / 1000) });
  }
}
try {
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(`${CACHE}.tmp`, JSON.stringify(fresh));
  renameSync(`${CACHE}.tmp`, CACHE);
} catch {}
out.sort((a, b) => b.at - a.at);
process.stdout.write(JSON.stringify(out));
