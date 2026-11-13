#!/usr/bin/env python3
"""Hint mode, as tmux-fingers: draws a pane's screen with the matches of
patterns.json highlighted and a hint on each, reads the hint typed and writes
{text, kind, action} to the result file ("copy"; Ctrl: "open"; Shift: "paste"),
or {none: true} when nothing matched. Run in a terminal shown in the pane.

usage: fingers.py <hc read --json file> <result file> <pattern ids json> <cols> <rows>
"""
import json
import os
import re
import select
import sys
import termios
import time
import tty

ALPHABET = "sdfjklghqwertyuopzxbn"
DIM, MATCH, HINT, TYPED, RESET = "\x1b[0;2m", "\x1b[0;33m", "\x1b[0;1;32m", "\x1b[0;1;34m", "\x1b[0m"


def patterns(ids):
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "patterns.json")) as f:
        every = json.load(f)
    return [dict(p, rx=re.compile(p["regex"])) for p in every if p["id"] in ids]


# Trailing punctuation off a match, and closing brackets it didn't open.
def tidy(text, chars):
    while text:
        last = text[-1]
        if last in chars or last in "([{" or (last in ")]}" and text.count("([{"[")]}".index(last)]) < text.count(last)):
            text = text[:-1]
        else:
            break
    return text


def find(lines, pats):
    taken = [[] for _ in lines]
    found = []
    for p in pats:
        for row, line in enumerate(lines):
            for m in p["rx"].finditer(line):
                group = next((i + 1 for i, g in enumerate(m.groups()) if g is not None), 0)
                start, end = m.span(group)
                text = line[start:end]
                if p.get("trim"):
                    kept = tidy(text, p["trim"])
                    end -= len(text) - len(kept)
                    text = kept
                if not text or any(not re.search(q, text) for q in p.get("require", [])):
                    continue
                if any(start < e and s < end for s, e in taken[row]):
                    continue
                taken[row].append((start, end))
                found.append({"row": row, "start": start, "end": end, "text": text, "kind": p["id"]})
    return found


def hints(found):
    texts = []
    for m in sorted(found, key=lambda m: (-m["row"], m["start"])):
        if m["text"] not in texts:
            texts.append(m["text"])
    k, prefixes = len(ALPHABET), 0
    while k - prefixes + prefixes * k < len(texts):
        prefixes += 1
    labels = list(ALPHABET[: k - prefixes]) + [a + b for a in ALPHABET[k - prefixes :] for b in ALPHABET]
    return dict(zip(texts, labels))


def draw(lines, found, labels, typed):
    rows = {}
    for m in found:
        if m["text"] in labels:
            rows.setdefault(m["row"], []).append(m)
    out = ["\x1b[H\x1b[2J"]
    for r, line in enumerate(lines):
        out.append(f"\x1b[{r + 1};1H{DIM}")
        pos = 0
        for m in sorted(rows.get(r, []), key=lambda m: m["start"]):
            label = labels[m["text"]]
            out.append(DIM + line[pos:m["start"]])
            if label.startswith(typed):
                out.append(TYPED + typed + HINT + label[len(typed):] + MATCH + line[m["start"] + len(label):m["end"]])
            else:
                out.append(DIM + line[m["start"]:m["end"]])
            pos = m["end"]
        out.append(DIM + line[pos:])
    sys.stdout.write("".join(out) + RESET)
    sys.stdout.flush()


def main():
    screen, result, ids, cols, rows = sys.argv[1], sys.argv[2], json.loads(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
    with open(screen) as f:
        text = json.load(f).get("text", "")
    lines = (text.split("\n") + [""] * rows)[:rows]
    found = find(lines, patterns(ids))
    labels = hints(found)
    if not labels:
        with open(result, "w") as f:
            json.dump({"none": True}, f)
        return

    fd = sys.stdin.fileno()
    saved = termios.tcgetattr(fd)
    tty.setraw(fd)
    sys.stdout.write("\x1b[?1049h\x1b[?25l\x1b[?7l")
    try:
        deadline = time.time() + 1.5
        while time.time() < deadline and tuple(os.get_terminal_size(fd)) != (cols, rows):
            time.sleep(0.02)
        size = tuple(os.get_terminal_size(fd))
        typed, mods, chosen = "", set(), None
        draw(lines, found, labels, typed)
        while chosen is None:
            if not select.select([fd], [], [], 0.1)[0]:
                if tuple(os.get_terminal_size(fd)) != size:
                    size = tuple(os.get_terminal_size(fd))
                    draw(lines, found, labels, typed)
                continue
            data = os.read(fd, 64)
            if data == b"\x1b" or data[:1] == b"\x03":
                break
            if data[:1] == b"\x1b":
                continue
            for c in data:
                if c == 0x7F:
                    typed = typed[:-1]
                    continue
                if 0x01 <= c <= 0x1A:
                    ch, mod = chr(c + 96), "open"
                elif 0x41 <= c <= 0x5A:
                    ch, mod = chr(c + 32), "paste"
                elif 0x61 <= c <= 0x7A:
                    ch, mod = chr(c), None
                else:
                    continue
                typed += ch
                if mod:
                    mods.add(mod)
                hit = next((t for t, label in labels.items() if label == typed), None)
                if hit is not None:
                    kind = next(m["kind"] for m in found if m["text"] == hit)
                    action = "open" if "open" in mods else "paste" if "paste" in mods else "copy"
                    chosen = {"text": hit, "kind": kind, "action": action}
                    break
                if not any(label.startswith(typed) for label in labels.values()):
                    typed, mods = "", set()
            draw(lines, found, labels, typed)
        if chosen:
            with open(result, "w") as f:
                json.dump(chosen, f)
    finally:
        sys.stdout.write("\x1b[?7h\x1b[?25h\x1b[?1049l")
        sys.stdout.flush()
        termios.tcsetattr(fd, termios.TCSADRAIN, saved)


if __name__ == "__main__":
    main()
