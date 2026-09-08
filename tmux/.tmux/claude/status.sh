#!/usr/bin/env bash
# Renders the Claude Code dots for status-right: one dot per state with its
# count, each a clickable mouse range. Prints nothing when no session runs here.
set -u
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

read -r working waiting idle <<<"$("$here/sessions.sh" | awk -F'\t' '
  { n[$2]++ }
  END { printf "%d %d %d\n", n["working"] + 0, n["waiting"] + 0, n["idle"] + 0 }')"
[ $((working + waiting + idle)) -gt 0 ] || exit 0

# A state with no sessions keeps its slot, dimmed, so the dots never shift about
dot() { # range colour count
  if [ "$3" -gt 0 ]; then
    printf '#[range=user|%s]#[fg=%s,bold]●%d#[norange]#[default] ' "$1" "$2" "$3"
  else
    printf '#[range=user|%s]#[fg=#{@c-dim}]●%d#[norange]#[default] ' "$1" "$3"
  fi
}

printf '#[fg=#{@c-dim}]✻ '
dot cc-work '#{@c-orange}' "$working"
dot cc-wait '#{@c-blue}' "$waiting"
dot cc-idle '#{@c-green}' "$idle"
printf '#[fg=#{@c-line}]│#[default] '
