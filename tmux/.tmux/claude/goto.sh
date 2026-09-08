#!/usr/bin/env bash
# Focuses a pane: attaches the client to its session, then selects the window
# and the pane itself. $1 = pane id, $2 = target client (optional)
set -u
pane="${1:-}"
client="${2:-}"
[ -n "$pane" ] || exit 0

read -r session window <<<"$(tmux display-message -p -t "$pane" '#{session_name} #{window_id}' 2>/dev/null)"
[ -n "${session:-}" ] || exit 0

if [ -n "$client" ]; then
  tmux switch-client -c "$client" -t "$session"
else
  tmux switch-client -t "$session"
fi
tmux select-window -t "$window"
tmux select-pane -t "$pane"
