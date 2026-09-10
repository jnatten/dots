#!/usr/bin/env bash
# Lists the Claude Code sessions running in panes of this tmux server, ordered
# by session, window and pane, as tab-separated:
#   pane_id  state  unseen  session  window_index  pane_index  window_id
#   window_name  pid  changed  name  detail  cwd
# where state is working, waiting or idle, unseen is 1 when the pane has not
# been on screen since the session last changed state, changed is when it last
# did so in epoch milliseconds, detail is what the session waits for or the
# basename of its directory, and cwd that directory in full.
#
# Claude Code registers every running session in
# $CLAUDE_CONFIG_DIR/sessions/<pid>.json with the pane it occupies and a live
# status. Those files outlive the process, so a session only counts when its
# pid is still a claude and its pane still exists.
#
# Listing also stamps every pane that is on screen right now as seen, keeping
# the stamps in the @cc-seen server option, so whatever calls this keeps the
# dots honest. On screen means on screen to the window server too, when the
# menu bar item is running to publish @cc-front.
set -u

# tmux swaps the tabs in -F output for underscores unless the client's locale
# looks UTF-8, and a launchd agent inherits no locale at all
export LC_CTYPE="${LC_CTYPE:-UTF-8}"

registry="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sessions"
[ -d "$registry" ] || exit 0

shopt -s nullglob
files=("$registry"/*.json)
[ "${#files[@]}" -gt 0 ] || exit 0

# Matching on the process name rejects a dead pid whose number has been reused
# as well. -a keeps pgrep's own ancestors, or the claude this very job runs
# under would be left out; on Linux it also prefixes the command, hence the read.
live_pids=" "
while read -r pid _; do live_pids+="$pid "; done < <(pgrep -ax claude 2>/dev/null)

# date only resolves seconds, so round up: a state change later in the current
# second still counts as seen rather than flagging the pane you are looking at
now=$((($(date +%s) + 1) * 1000))

awk -F'\t' -v pids="$live_pids" -v now="$now" -v stamps="$(tmux show -gqv @cc-seen 2>/dev/null)" \
    -v frontstamp="$(tmux show -gqv @cc-front 2>/dev/null)" '
  BEGIN {
    split(stamps, s, " ")
    for (i in s) { n = index(s[i], ":"); if (n) seen[substr(s[i], 1, n - 1)] = substr(s[i], n + 1) }

    # @cc-front is "<heartbeat> <last second the terminal was the front app>",
    # published by the menu bar item. Without a live heartbeat nothing is
    # watching the window server, so fall back to trusting tmux alone rather
    # than latching every dot on for good
    split(frontstamp, f, " ")
    front = (f[1] == "" || now / 1000 - f[1] > 6) ? 1 : (now / 1000 - f[2] <= 4)
  }
  # Each input tags its own lines: NR == FNR would read the first session as a
  # pane when tmux hands back no panes at all
  $1 == "p" { pane[$2] = $3 "\t" $4 "\t" $5 "\t" $6 "\t" $7; onscreen[$2] = $8; panes = 1; next }
  {
    pid = $2; status = $3; id = $4; changed = $7
    if (!(id in pane)) next
    if (index(pids, " " pid " ") == 0) next
    state = (status == "waiting") ? "waiting" : (status == "idle") ? "idle" : "working"

    # A pane with no stamp yet is taken as seen, so a fresh server or a new
    # session does not open with everything demanding attention
    at = (id in seen) ? seen[id] + 0 : now
    if (onscreen[id] && front) at = now
    kept = kept id ":" at " "

    print id "\t" state "\t" (changed + 0 > at ? 1 : 0) "\t" pane[id] "\t" pid "\t" \
          (changed + 0) "\t" $5 "\t" $6 "\t" $8
  }
  END { if (panes) system("tmux set -g @cc-seen \"" kept "\"") }
' \
  <(tmux list-panes -a -F 'p	#{pane_id}	#{session_name}	#{window_index}	#{pane_index}	#{window_id}	#{window_name}	#{&&:#{session_attached},#{&&:#{window_active},#{||:#{pane_active},#{!=:#{window_zoomed_flag},1}}}}' 2>/dev/null) \
  <(jq -r 'select(.tmux != null and (.kind == "interactive" or .kind == "bg"))
           | [ "s",
               .pid,
               .status,
               (.tmux | sub("^.*\\."; "")),
               (.name // ""),
               (.waitingFor // ((.cwd // "") | split("/") | last)),
               (.statusUpdatedAt // .updatedAt // 0),
               (.cwd // "")
             ] | @tsv' "${files[@]}" 2>/dev/null) \
| sort -t'	' -k4,4 -k5,5n -k6,6n
