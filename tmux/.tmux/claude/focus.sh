#!/usr/bin/env bash
# Focuses the next Claude Code session in one state, cycling on repeated clicks.
# Sessions you have not looked at since they changed state come first, so
# clicking a lit dot works through exactly what is asking for attention.
# $1 = cc-work|cc-wait|cc-idle, $2 = target client (optional)
set -u
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$here/bucket.sh"

rows=$("$here/sessions.sh" | awk -F'\t' -v s="$state" '$2 == s { print $1 "\t" $7 }')
if [ -z "$rows" ]; then
  tmux display-message ${client:+-c "$client"} "no $state Claude sessions"
  exit 0
fi

panes=$(printf '%s\n' "$rows" | awk -F'\t' '$2 == 1 { print $1 }')
[ -n "$panes" ] || panes=$(printf '%s\n' "$rows" | cut -f1)

# The pane last jumped to is remembered per state, so clicking again moves on
last=$(tmux show -gqv "@cc-last-$state")
next=$(printf '%s\n' "$panes" | awk -v last="$last" '
  { p[NR] = $0; if ($0 == last) at = NR }
  END { print p[(at % NR) + 1] }')

tmux set -g "@cc-last-$state" "$next"
exec "$here/goto.sh" "$next" "$client"
