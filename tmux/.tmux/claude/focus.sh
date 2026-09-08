#!/usr/bin/env bash
# Focuses the next Claude Code session in one state, cycling on repeated clicks.
# $1 = cc-work|cc-wait|cc-idle, $2 = target client (optional)
set -u
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$here/bucket.sh"

panes=$("$here/sessions.sh" | awk -F'\t' -v s="$state" '$2 == s { print $1 }')
if [ -z "$panes" ]; then
  tmux display-message ${client:+-c "$client"} "no $state Claude sessions"
  exit 0
fi

# The pane last jumped to is remembered per state, so clicking again moves on
last=$(tmux show -gqv "@cc-last-$state")
next=$(printf '%s\n' "$panes" | awk -v last="$last" '
  { p[NR] = $0; if ($0 == last) at = NR }
  END { print p[(at % NR) + 1] }')

tmux set -g "@cc-last-$state" "$next"
exec "$here/goto.sh" "$next" "$client"
