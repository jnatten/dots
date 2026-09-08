#!/bin/sh
# tmux refreshes a session's environment only when a client attaches to it, so
# sessions reached with switch-client keep the SSH_* values from an earlier ssh
# login. Mark them removed globally and in every session; shells re-syncing in
# conf.d/tmux-env.fish then drop them on their next prompt.
# SSH_AUTH_SOCK is left alone, it points at the local agent.

vars="SSH_CONNECTION SSH_CLIENT SSH_TTY"

for var in $vars; do
    tmux set-environment -gr "$var"
done

tmux list-sessions -F '#{session_name}' | while read -r session; do
    for var in $vars; do
        tmux set-environment -t "$session" -r "$var"
    done
done

tmux display-message "cleared $vars"
