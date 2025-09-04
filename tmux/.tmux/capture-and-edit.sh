#!/usr/bin/env bash
# Capture the current tmux pane and open it in $EDITOR in a new tmux window
tmpfile="/tmp/tmux-output-$(date +%s).txt"
tmux capture-pane -pS - | awk 'NF {line=$0; print line}' > "$tmpfile"
tmux new-window -n "Pane Capture" "$EDITOR \"$tmpfile\""
