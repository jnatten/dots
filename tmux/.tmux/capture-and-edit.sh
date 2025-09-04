#!/usr/bin/env bash
tmpfile="/tmp/tmux-output-$(date +%s).txt"
tmux capture-pane -p -e -S - | awk 'NF {line=$0; print line}' > "$tmpfile"
tmux new-window -n "Pane Capture" "nvim -c 'terminal cat \"$tmpfile\"' -c 'normal G'"
