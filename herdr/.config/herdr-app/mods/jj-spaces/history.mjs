// The PRs, issues and Trello cards this machine's Claude sessions had, from their
// transcripts, as JSON [{ id, cwd, title, at, links }] for sessions with any: URLs typed
// or pasted into a prompt (a slash command's arguments too), linked with jj-review's
// herdr-link.mjs, opened with `gh pr create` / `gh issue create`, or recorded by Claude
// as a pr-link. Not those that only showed up in a tool's output. Read whole, once per
// version of a transcript (cached). jj-spaces runs it on each machine with `node -e`,
// to fill that machine's jj-tasks.

import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const ROOT = join(homedir(), ".claude", "projects");
const CACHE = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "herdr-jj-tasks.json");
const URL = /https:\/\/(?:www\.)?(?:github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|issues)\/\d+|trello\.com\/c\/[A-Za-z0-9]{8})/g;
const NEEDLES = ["github.com/", "trello.com/c/"].map((s) => Buffer.from(s));
const CREATE = /\bgh\s+(?:pr|issue)\s+create\b/;
const MAX = 20;
const HEAD = 131072;
const TAIL = 65536;

const urlsIn = (text) => (typeof text === "string" ? text.match(URL) ?? [] : []).map((u) => u.replace("://www.", "://"));

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

const blocks = (record) => {
  const content = record.message?.content;
  return typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content.filter((c) => c && typeof c === "object") : [];
};

function linksOf(text) {
  const links = new Set();
  const creating = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("github.com/") && !line.includes("trello.com/c/") && !CREATE.test(line) && !line.includes('"pr-link"')) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.isSidechain) continue;
    if (r.type === "pr-link") urlsIn(r.prUrl).forEach((u) => links.add(u));
    else if (r.type === "user" && !r.isMeta && !r.isCompactSummary) {
      for (const b of blocks(r)) {
        if (b.type === "text" && !/^\s*<(?:local-command|bash-|system-reminder|task-notification)/.test(b.text ?? "")) urlsIn(b.text).forEach((u) => links.add(u));
        else if (b.type === "tool_result" && creating.has(b.tool_use_id)) urlsIn(JSON.stringify(b.content)).slice(0, 1).forEach((u) => links.add(u));
      }
    } else if (r.type === "assistant") {
      for (const b of blocks(r)) {
        if (b.type !== "tool_use") continue;
        const input = JSON.stringify(b.input ?? {});
        if (input.includes("herdr-link.mjs")) urlsIn(input).forEach((u) => links.add(u));
        else if (CREATE.test(input)) creating.add(b.id);
      }
    }
  }
  return [...links].slice(0, MAX);
}

function chunk(fd, at, length) {
  const buffer = Buffer.alloc(length);
  return buffer.subarray(0, readSync(fd, buffer, 0, length, at)).toString("utf8");
}

// Where it ran and what it's called, as jj-sessions' scan.mjs reads them.
function about(path, size) {
  const fd = openSync(path, "r");
  let head, tail;
  try {
    head = chunk(fd, 0, Math.min(size, HEAD));
    tail = size <= HEAD + TAIL ? head : chunk(fd, size - TAIL, TAIL);
  } finally {
    closeSync(fd);
  }
  let cwd = null, prompt = null;
  for (const r of records(head)) {
    cwd ||= r.cwd || null;
    if (prompt || r.type !== "user" || r.isMeta || r.isSidechain) continue;
    const text = blocks(r).find((b) => b.type === "text" && b.text?.trim() && !b.text.trim().startsWith("<"))?.text;
    if (text) prompt = text.trim().split(/\s+/).join(" ").slice(0, 200);
  }
  let custom = null, ai = null, relocated = null;
  for (const r of records(tail)) {
    if (r.type === "custom-title" && (r.customTitle || "").trim()) custom = r.customTitle.trim();
    else if (r.type === "ai-title" && (r.aiTitle || "").trim()) ai = r.aiTitle.trim();
    else if (r.type === "relocated" && r.relocatedCwd) relocated = r.relocatedCwd;
  }
  return { cwd: relocated || cwd || "", title: (custom || ai || prompt || "").slice(0, 200) };
}

function scan(path, size) {
  const data = readFileSync(path);
  if (!NEEDLES.some((n) => data.includes(n))) return null;
  const links = linksOf(data.toString("utf8"));
  return links.length ? { id: basename(path, ".jsonl"), ...about(path, size), links } : null;
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
process.stdout.write(JSON.stringify(out));
