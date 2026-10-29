#!/bin/sh
# tmux refreshes a session's environment only when a client attaches to it, so
# sessions reached with switch-client keep the SSH_* values from an earlier ssh
# login. Mark them removed globally and in every session; shells re-syncing in
# conf.d/tmux-env.fish then drop them on their next prompt.
# SSH_AUTH_SOCK is pointed back at the local 1Password agent instead.

vars="SSH_CONNECTION SSH_CLIENT SSH_TTY"
sock="$HOME/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"

for var in $vars; do
    tmux set-environment -gr "$var"
done
tmux set-environment -g SSH_AUTH_SOCK "$sock"

tmux list-sessions -F '#{session_name}' | while read -r session; do
    for var in $vars; do
        tmux set-environment -t "$session" -r "$var"
    done
    tmux set-environment -t "$session" SSH_AUTH_SOCK "$sock"
done

tmux display-message "cleared $vars, reset SSH_AUTH_SOCK"
