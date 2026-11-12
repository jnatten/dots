#!/usr/bin/env python3
"""Writes a herdr-core terminal's history and screen, colours kept, as lines of
text with SGR codes (what tmux's capture-pane -e gives): the first paint of a
watch-only `hc attach`, without its clears, tab stops and cursor moves.

usage: capture.py <terminal> <file> [history lines]
"""
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time

CLEAR = b"\x1b[H\x1b[2J"


def size(terminal):
    try:
        info = json.loads(subprocess.run(["hc", "get", terminal, "--json"], capture_output=True, text=True, timeout=10).stdout)
        return int(info.get("rows") or 50), int(info.get("cols") or 200)
    except (ValueError, OSError, subprocess.SubprocessError):
        return 50, 200


# hc attach asks the terminal it runs in about itself and paints only once it has
# answers, or after half a second without them.
REPLIES = {
    b"\x1b]10;?": b"\x1b]10;rgb:ffff/ffff/ffff\x1b\\",
    b"\x1b]11;?": b"\x1b]11;rgb:0000/0000/0000\x1b\\",
    b"\x1b]12;?": b"\x1b]12;rgb:ffff/ffff/ffff\x1b\\",
    b"\x1b[16t": b"\x1b[6;20;10t",
    b"\x1b[c": b"\x1b[?62;22c",
}


def first_paint(terminal, history):
    rows, cols = size(terminal)
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp("hc", ["hc", "attach", "--observe", "--history", history, terminal])
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    data = bytearray()
    answered = set()
    start = time.time()
    last = start
    while time.time() - start < 3:
        ready, _, _ = select.select([fd], [], [], 0.02)
        if ready:
            try:
                chunk = os.read(fd, 1 << 16)
            except OSError:
                break
            if not chunk:
                break
            data += chunk
            last = time.time()
            for query, reply in REPLIES.items():
                if query not in answered and query in data:
                    answered.add(query)
                    os.write(fd, reply)
        elif time.time() - last > (0.06 if CLEAR in data else 0.6):
            break
    os.kill(pid, signal.SIGTERM)
    return bytes(data)


# Everything but SGR (colour) codes: string commands (OSC, DCS, APC, PM), other
# CSI sequences, and two-byte escapes.
STRINGS = re.compile(rb"\x1b[\]P_^].*?(?:\x07|\x1b\\)", re.S)
CSI = re.compile(rb"\x1b\[[0-?]*[ -/]*[@-~]")
SGR = re.compile(rb"\x1b\[[0-9;:]*m")
SHORT = re.compile(rb"\x1b[ -/]*[0-~]")


def clean(part):
    part = STRINGS.sub(b"", part)
    part = CSI.sub(lambda m: m.group(0) if SGR.fullmatch(m.group(0)) else b"", part)
    part = SHORT.sub(lambda m: m.group(0) if m.group(0).startswith(b"\x1b[") else b"", part)
    return part.replace(b"\r\n", b"\n").replace(b"\r", b"")


# The paint is: modes, a clear, the history as lines, newlines that push it into
# scrollback, another clear, tab stops, then the screen as lines.
def lines(paint):
    first = paint.find(CLEAR)
    second = paint.find(CLEAR, first + len(CLEAR)) if first != -1 else -1
    history = paint[first + len(CLEAR):second] if second != -1 else b""
    screen = paint[second + len(CLEAR):] if second != -1 else paint[first + len(CLEAR):] if first != -1 else paint
    parts = [p for p in (clean(history).rstrip(b"\n"), clean(screen).strip(b"\n")) if p.strip()]
    return b"\n".join(parts).replace(b"\n", b"\r\n") + b"\x1b[0m\r\n"


def main():
    terminal, path = sys.argv[1], sys.argv[2]
    history = sys.argv[3] if len(sys.argv) > 3 else "100000"
    with open(path, "wb") as f:
        f.write(lines(first_paint(terminal, history)))


if __name__ == "__main__":
    main()
