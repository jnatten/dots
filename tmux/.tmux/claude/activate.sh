#!/usr/bin/env bash
# Focuses a pane from outside tmux, for the menu bar item: raises the terminal
# app, then hands it the pane. $1 = pane id
set -u
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
pane="${1:-}"
[ -n "$pane" ] || exit 0

open -a "${CC_TERMINAL:-Ghostty}"

# switch-client moves a client rather than a window, and the newest client is
# the window you were last in, which is the one the app just raised
client=$(tmux list-clients -F '#{client_activity} #{client_tty}' 2>/dev/null \
  | sort -rn | head -1 | cut -d' ' -f2)

exec "$here/goto.sh" "$pane" "$client"
