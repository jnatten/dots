#!/usr/bin/env python3
"""Past Claude Code sessions as JSON [{id, cwd, title, prompt, at}], newest first, from each transcript's head and tail."""
import glob
import json
import os
import re
import sys

ROOT = os.path.expanduser("~/.claude/projects")
CACHE = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"), "herdr-jj-sessions.json")
HEAD = 131072
TAIL = 65536
COMMAND = re.compile(r"<command-name>(.*?)</command-name>", re.S)


def records(text):
    for line in text.splitlines():
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if isinstance(record, dict):
            yield record


def texts(record):
    content = (record.get("message") or {}).get("content")
    if isinstance(content, str):
        return [content]
    return [c.get("text") or "" for c in content or [] if isinstance(c, dict) and c.get("type") == "text"]


def read(path, size):
    with open(path, "rb") as f:
        if size <= HEAD + TAIL:
            data = f.read().decode("utf-8", "replace")
            return data, data
        head = f.read(HEAD).decode("utf-8", "replace")
        f.seek(size - TAIL)
        tail = f.read().decode("utf-8", "replace").split("\n", 1)[-1]
        return head, tail


def scan(path, size):
    head, tail = read(path, size)
    cwd = prompt = command = None
    for r in records(head):
        cwd = cwd or r.get("cwd")
        if prompt or r.get("type") != "user" or r.get("isMeta") or r.get("isSidechain"):
            continue
        for text in texts(r):
            text = text.strip()
            match = COMMAND.search(text)
            if match:
                command = command or match.group(1).strip()
            elif text and not text.startswith("<"):
                prompt = " ".join(text.split())[:300]
                break
    custom = ai = relocated = None
    for r in records(tail):
        kind = r.get("type")
        if kind == "custom-title" and (r.get("customTitle") or "").strip():
            custom = r["customTitle"].strip()
        elif kind == "ai-title" and (r.get("aiTitle") or "").strip():
            ai = r["aiTitle"].strip()
        elif kind == "relocated" and r.get("relocatedCwd"):
            relocated = r["relocatedCwd"]
    if not custom:
        try:
            with open(os.path.join(path[:-len(".jsonl")], "custom-title.json")) as f:
                custom = (json.load(f).get("customTitle") or "").strip() or None
        except (OSError, ValueError, AttributeError):
            pass
    title = custom or ai or prompt
    cwd = relocated or cwd
    if not title or not cwd:
        return None
    return {"id": os.path.basename(path)[:-len(".jsonl")], "cwd": cwd, "title": title[:200], "prompt": prompt or command or ""}


def main():
    try:
        with open(CACHE) as f:
            cache = json.load(f)
    except (OSError, ValueError):
        cache = {}
    fresh = {}
    out = []
    for path in glob.glob(os.path.join(ROOT, "*", "*.jsonl")):
        try:
            st = os.stat(path)
        except OSError:
            continue
        key = [st.st_mtime, st.st_size]
        hit = cache.get(path)
        entry = hit["entry"] if hit and hit.get("key") == key else scan(path, st.st_size)
        fresh[path] = {"key": key, "entry": entry}
        if entry:
            out.append({**entry, "at": int(st.st_mtime)})
    try:
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        with open(CACHE + ".tmp", "w") as f:
            json.dump(fresh, f)
        os.replace(CACHE + ".tmp", CACHE)
    except OSError:
        pass
    out.sort(key=lambda e: e["at"], reverse=True)
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
