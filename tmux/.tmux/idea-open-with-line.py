#!/usr/bin/env python3

import os
import subprocess
import sys
import tempfile

f = open("/home/jonas/test.log", "a")


def log(x):
    f.write(f"{x}\n")


log("------------------")

this_script, cwd, pane_id, marked_path = sys.argv


basename = os.path.basename(marked_path)
dirname = os.path.dirname(marked_path)
marked_is_absolute = os.path.isabs(marked_path)

line = None
column = None

if ":" in basename:
    s = basename.split(":")
    if len(s) == 3 and s[1].isnumeric() and s[2].isnumeric():
        basename = s[0]
        line = s[1]
        column = s[2]
    elif len(s) == 2 and s[1].isnumeric():
        basename = s[0]
        line = s[1]


log(f"basename: {basename}")
log(f"dirname: {dirname}")
log(f"abs: {marked_is_absolute}")


def get_possible_files():
    if marked_is_absolute:
        return [marked_is_absolute]

    query = f"^{basename}$"

    if dirname and basename:
        cmd = ["fd", query, dirname]
    else:
        cmd = ["fd", query]
    out = str(subprocess.check_output(cmd, cwd=cwd), "utf-8")
    lines = list(out.splitlines())
    return lines


files = get_possible_files()


def open_file(filename):
    log(f"opening: {filename}")

    if line is not None and column is not None:
        os.system(f"idea --line {line} --column {column} {filename}")
        return

    if line is not None:
        os.system(f"idea --line {line} {filename}")
        return

    os.system(f"idea {filename}")


def choose_files(files):
    selections = "\n".join(files)
    out = str(
        subprocess.check_output(["fzf", "--tmux"], input=bytes(selections, "utf-8")),
        "utf-8",
    )
    log(f"selected {out}")
    return out


def warn_no_file():
    subprocess.call(["tmux", "display-message", f"Could not find '{marked_path}'"])


if len(files) == 1:
    open_file(files[0])
elif len(files) == 0:
    warn_no_file()
    sys.exit(1)
else:
    chosen = choose_files(files)
    open_file(chosen)

f.close()
