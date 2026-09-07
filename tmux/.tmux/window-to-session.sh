#!/usr/bin/env bash
# Move the current window into another session, picked with fzf. Typing a name
# that matches no existing session creates that session.
# Runs inside a tmux popup, which is what lets tmux resolve the window and
# client below without being told which they are.
set -u

src=$(tmux display-message -p '#{window_id}')
client=$(tmux display-message -p '#{client_name}')
current=$(tmux display-message -p '#{session_name}')
window=$(tmux display-message -p '#{window_name}')

result=$(tmux list-sessions -F '#{session_name}' | grep -vxF "$current" | fzf \
  --print-query \
  --layout=reverse \
  --info=inline \
  --border=none \
  --prompt='session: ' \
  --header="move '$window' — enter to pick, or type a new session name")
status=$?

query=$(printf '%s' "$result" | sed -n 1p)
choice=$(printf '%s' "$result" | sed -n 2p)

case $status in
  0) name=$choice ;;
  # No match: treat the query as a session to create. A colon is legal in a
  # session name but makes the session impossible to target afterwards.
  1) name=${query//:/-} ;;
  *) exit 0 ;;
esac

[ -n "$name" ] || exit 0

placeholder=""
if ! tmux has-session -t "=$name" 2>/dev/null; then
  # A session cannot be created empty, so spawn a throwaway window and drop it
  # once the real window has landed.
  placeholder="wts-placeholder-$$"
  tmux new-session -d -s "$name" -n "$placeholder" || exit 1
fi

# Follow the window before moving it: if it is the last one in its session, the
# move destroys that session and would otherwise detach the client outright.
[ -n "$client" ] && tmux switch-client -c "$client" -t "=$name"

tmux move-window -s "$src" -t "=$name:" || exit 1
[ -n "$placeholder" ] && tmux kill-window -t "=$name:$placeholder"
[ -n "$client" ] && tmux select-window -t "$src"

exit 0
