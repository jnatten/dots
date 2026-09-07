#!/usr/bin/env bash
# Move a whole window into a separate session, creating it if it does not exist.
# Usage: window-to-session.sh <src-window-id> <session-name> [client-name]
set -u

src=$1
name=${2//[.: ]/-}
client=${3:-}
placeholder=""

[ -n "$name" ] || exit 0

if ! tmux has-session -t "=$name" 2>/dev/null; then
  # A session cannot be created empty, so spawn a throwaway window and drop it
  # once the real window has landed.
  placeholder="wts-placeholder-$$"
  tmux new-session -d -s "$name" -n "$placeholder"
fi

# Follow the window before moving it: if it is the last one in its session, the
# move destroys that session and would otherwise detach the client outright.
[ -n "$client" ] && tmux switch-client -c "$client" -t "=$name"

tmux move-window -s "$src" -t "=$name:"
[ -n "$placeholder" ] && tmux kill-window -t "=$name:$placeholder"
[ -n "$client" ] && tmux select-window -t "$src"

exit 0
