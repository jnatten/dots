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

# TODO: Handle lines and columns at the end of basename
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
else:
    chosen = choose_files(files)


# path = full_path.removeprefix("[error] ").strip()
# os.chdir(cwd)

# log("hei" + str(out))

# splits = path.split(":")

# os.system("tmux display-popup echo hei")
# if len(splits) == 3 and splits[-1].isnumeric() and splits[-2].isnumeric():
#     os.system(f"idea --line {splits[1]} --column {splits[2]} {splits[0]}")
#
# if len(splits) == 2 and splits[-1].isnumeric():
#     os.system(f"idea --line {splits[1]} {splits[0]}")
#
# if len(splits) == 1:
#     os.system(f"idea {splits[0]}")


# os.system(f'code -g {path}')

f.close()
