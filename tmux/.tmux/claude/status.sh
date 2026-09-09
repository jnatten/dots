#!/usr/bin/env bash
# Renders the Claude Code dots for status-right: one dot per state, lit while
# that state holds a session, each a clickable mouse range. A state holding a
# session that has changed state since you last looked at its pane becomes a
# lit pill, and stays lit until you visit the pane. Prints nothing when no
# session runs here.
set -u
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

read -r working waiting idle waiting_unseen idle_unseen <<<"$("$here/sessions.sh" | awk -F'\t' '
  { n[$2]++; if ($3 == 1) u[$2]++ }
  END { printf "%d %d %d %d %d\n", n["working"] + 0, n["waiting"] + 0, n["idle"] + 0,
                                   u["waiting"] + 0, u["idle"] + 0 }')"
[ $((working + waiting + idle)) -gt 0 ] || exit 0

# A state with no sessions keeps its slot, dimmed, so the dots never shift
# about. The picker behind prefix+u is where the sessions are counted.
#
# A dot is one cell, so its gap is folded into the mouse range to click at.
# tmux runs a range one cell past its #[norange] though, so the last space
# always stays outside: the range covers the dot and its gap without reaching
# the cell of the next dot, which would answer for it on every click.
dot() { # range colour count unseen
  if [ "${4:-0}" -gt 0 ]; then
    printf '#[range=user|%s]#[fg=%s,bg=#{@c-bg}]#{@pill-l}#[fg=#{@c-deep},bg=%s,bold]●#[fg=%s,bg=#{@c-bg},nobold]#{@pill-r}#[norange]#[default] ' \
      "$1" "$2" "$2" "$2"
  elif [ "$3" -gt 0 ]; then
    printf '#[range=user|%s]#[fg=%s,bold]●#[default] #[norange] ' "$1" "$2"
  else
    printf '#[range=user|%s]#[fg=#{@c-dim}]●#[default] #[norange] ' "$1"
  fi
}

dot cc-work '#{@c-orange}' "$working"
dot cc-wait '#{@c-blue}' "$waiting" "$waiting_unseen"
dot cc-idle '#{@c-green}' "$idle" "$idle_unseen"
printf '#[fg=#{@c-line}]│#[default] '
