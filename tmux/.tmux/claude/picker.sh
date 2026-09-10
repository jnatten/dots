#!/usr/bin/env bash
# An fzf overlay over the Claude Code sessions on this tmux server, opened with
# prefix + u. Rows are ordered by what wants attention: the ones you have not
# seen since they changed state first, then waiting, idle and working, longest
# since the change first. Type to filter, enter jumps to the pane, ctrl-x asks
# the session to quit. The list reloads itself, so it keeps up with the dots.
#
# Subcommands exist for the fzf bindings to call back into:
#   list, preview <pane>, stop <pid>
set -u
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

cmd_list() {
  local out
  out=$("$here/sessions.sh" | awk -F'\t' \
    -v now="$(date +%s)" \
    -v blue="$(tmux show -gqv @c-blue)" \
    -v green="$(tmux show -gqv @c-green)" \
    -v orange="$(tmux show -gqv @c-orange)" \
    -v dim="$(tmux show -gqv @c-dim)" '
    function rgb(hex,   i, v, digits, out) {
      digits = "0123456789abcdef"
      sub(/^#/, "", hex); hex = tolower(hex)
      for (i = 0; i < 3; i++) {
        v = (index(digits, substr(hex, i * 2 + 1, 1)) - 1) * 16 \
          + index(digits, substr(hex, i * 2 + 2, 1)) - 1
        out = out (i ? ";" : "") v
      }
      return out
    }
    function fit(s, w) { return length(s) > w ? substr(s, 1, w - 1) "…" : sprintf("%-*s", w, s) }
    function ago(ms,   s) {
      if (ms <= 0) return "?"
      s = now - int(ms / 1000)
      if (s < 0) s = 0
      if (s < 3600) return int(s / 60) "m"
      if (s < 86400) return int(s / 3600) "h"
      return int(s / 86400) "d"
    }
    BEGIN {
      colour["waiting"] = rgb(blue); colour["idle"] = rgb(green); colour["working"] = rgb(orange)
      rank["waiting"] = 0; rank["idle"] = 1; rank["working"] = 2
      off = "\033[0m"
    }
    {
      pane = $1; state = $2; unseen = $3; session = $4; window = $5; index_ = $6
      winname = $8; pid = $9; changed = $10; name = $11; detail = $12
      c = colour[state]

      # Working never counts as unseen: it is the one state that asks nothing of
      # you, so it would only ever be noise up at the top
      if (state == "working") unseen = 0

      dot = sprintf("\033[38;2;%sm●" off, c)
      label = unseen ? sprintf("\033[1;7;38;2;%sm %-7s " off, c, state) : sprintf("%-9s", state)
      row = sprintf("%s %s %4s  %s %s %s %s", dot, label, ago(changed), \
        fit(session ":" window "." index_, 12), fit(winname, 18), fit(name, 20), detail)

      printf "%d\t%d\t%d\t%s\t%s\t%s\n", unseen ? 0 : 1, rank[state], changed, row, pane, pid
    }' | sort -t"$(printf '\t')" -k1,1n -k2,2n -k3,3n | cut -f4-)

  if [ -z "$out" ]; then
    printf '  no live Claude sessions\n'
  else
    printf '%s\n' "$out"
  fi
}

cmd_preview() {
  [ -n "${1:-}" ] || exit 0
  tmux capture-pane -p -e -t "$1" 2>/dev/null
}

# Asks a session to quit, leaving its pane alone. Only pids the listing still
# vouches for are signalled, so a stale row cannot take an unrelated process out
cmd_stop() {
  local pid="${1:-}"
  case "$pid" in '' | *[!0-9]*) exit 0 ;; esac
  "$here/sessions.sh" | awk -F'\t' -v p="$pid" '$9 == p { hit = 1 } END { exit !hit }' || exit 0
  kill "$pid" 2>/dev/null
}

cmd_launch() {
  local client
  client=$(tmux display-message -p '#{client_tty}')
  fzf --ansi --no-sort --track \
    --delimiter="$(printf '\t')" --with-nth=1 \
    --layout=reverse --info=inline --border=none \
    --prompt='claude: ' \
    --header='enter: jump — ctrl-x: stop — shift-up/down: scroll preview' \
    --preview "$here/picker.sh preview {2}" \
    --preview-window=right:60% \
    --bind 'shift-up:preview-up,shift-down:preview-down' \
    --bind "start:reload($here/picker.sh list)" \
    --bind "load:refresh-preview+reload(sleep 2; $here/picker.sh list)" \
    --bind "ctrl-x:execute-silent($here/picker.sh stop {3})+reload($here/picker.sh list)" \
    --bind "enter:become($here/goto.sh {2} $client)" \
    </dev/null
}

case "${1:-}" in
  list) cmd_list ;;
  preview) shift; cmd_preview "$@" ;;
  stop) shift; cmd_stop "$@" ;;
  '') cmd_launch ;;
  *) echo "usage: picker.sh [list|preview <pane>|stop <pid>]" >&2; exit 2 ;;
esac
