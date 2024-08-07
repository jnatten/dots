#!/usr/bin/env python3
import os
import sys
import json
import subprocess
from i3ipc import Connection


TMP_DIR = "/tmp/workspace_cycle/"
TMP_FILE = os.path.join(TMP_DIR, "workspaces.json")


def get_config():
    if not os.path.exists(TMP_DIR):
        os.mkdir(TMP_DIR)
    obj = {}
    if not os.path.exists(TMP_FILE):
        with open(TMP_FILE, 'w') as fo:
            json.dump({}, fo)
    else:
        with open(TMP_FILE, 'r') as fo:
            obj = json.load(fo)
    # print(f"Loaded config: {obj}")
    return obj


def save_config(obj):
    if not os.path.exists(TMP_DIR):
        os.mkdir(TMP_DIR)
    # print(f"Saving config: {obj}")
    with open(TMP_FILE, 'w') as fo:
        json.dump(obj, fo)


if len(sys.argv) == 2 and sys.argv[1] == "tag":
    obj = get_config()
    i3 = Connection()
    focused = i3.get_tree().find_focused()
    workspace_name = focused.workspace().name
    tw = obj.get('tagged_workspaces', [])
    if workspace_name not in tw:
        tw.append(workspace_name)
        obj['tagged_workspaces'] = tw
        save_config(obj)
        subprocess.Popen(['notify-send', f'Tagged "{workspace_name}"'])
    else:
        tw.append(workspace_name)
        obj['tagged_workspaces'] = [x for x in tw if x != workspace_name]
        save_config(obj)
        subprocess.Popen(['notify-send', f'Untagged "{workspace_name}"'])



if len(sys.argv) == 2 and sys.argv[1] == "untag":
    obj = get_config()
    i3 = Connection()
    focused = i3.get_tree().find_focused()
    workspace_name = focused.workspace().name
    tw = obj.get('tagged_workspaces', [])
    if workspace_name in tw:
        tw.append(workspace_name)
        obj['tagged_workspaces'] = [x for x in tw if x != workspace_name]
        save_config(obj)

if len(sys.argv) == 2 and sys.argv[1] == "cycle":
    obj = get_config()
    i3 = Connection()
    focused = i3.get_tree().find_focused()
    workspace_name = focused.workspace().name
    tw = obj.get('tagged_workspaces', [])

    # TODO: Filter workspaces that are tagged but does not exist

    try:
        workspace_index = tw.index(workspace_name)
    except ValueError:
        workspace_index = -1

    if workspace_index >= (len(tw) - 1):
        cycle_to_index = 0
    else:
        cycle_to_index = workspace_index + 1

    # print(f"Cycling to index {cycle_to_index}")

    workspaces = i3.get_workspaces()
    workspace_to_focus = tw[cycle_to_index]
    for workspace in workspaces:
        if workspace.name == workspace_to_focus:
            # print(f"Focusing workspace: '{workspace.name}'")
            i3.command(f"workspace {workspace.name}")

    



