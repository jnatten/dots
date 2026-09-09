#!/usr/bin/env bash
# Lists the Claude Code sessions in one state as a menu; picking one focuses it.
# A dot marks the ones you have not seen since they changed state.
# $1 = cc-work|cc-wait|cc-idle, $2 = target client, $3 = mouse column
set -u
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$here/bucket.sh"

items=()
count=0
while IFS=$'\t' read -r pane _ unseen session window_index pane_index _ _ _ name detail _; do
  count=$((count + 1))
  label="$([ "$unseen" = 1 ] && printf '●' || printf ' ') $session:$window_index.$pane_index  $name"
  [ -n "$detail" ] && label="$label — $detail"
  items+=("${label//\#/\#\#}" "$([ "$count" -le 9 ] && printf '%d' "$count")" \
    "run-shell \"$here/goto.sh $pane $client\"")
done < <("$here/sessions.sh" | awk -F'\t' -v s="$state" '$2 == s')

if [ "$count" -eq 0 ]; then
  tmux display-message ${client:+-c "$client"} "no $state Claude sessions"
  exit 0
fi

tmux display-menu ${client:+-c "$client"} -T "#[align=centre] $state ($count) " \
  -x "$mouse_x" -y S "${items[@]}"
