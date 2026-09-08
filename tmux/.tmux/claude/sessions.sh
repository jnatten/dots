#!/usr/bin/env bash
# Lists the Claude Code sessions running in panes of this tmux server, ordered
# by session, window and pane, as tab-separated:
#   pane_id  state  session  window_index  pane_index  window_id  name  detail
# where state is working, waiting or idle.
#
# Claude Code registers every running session in
# $CLAUDE_CONFIG_DIR/sessions/<pid>.json with the pane it occupies and a live
# status. Those files outlive the process, so a session only counts when its
# pid is still a claude and its pane still exists.
set -u

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

awk -F'\t' -v pids="$live_pids" '
  NR == FNR { pane[$1] = $2 "\t" $3 "\t" $4 "\t" $5; next }
  {
    pid = $1; status = $2; id = $3
    if (!(id in pane)) next
    if (index(pids, " " pid " ") == 0) next
    state = (status == "waiting") ? "waiting" : (status == "idle") ? "idle" : "working"
    print id "\t" state "\t" pane[id] "\t" $4 "\t" $5
  }
' \
  <(tmux list-panes -a -F '#{pane_id}	#{session_name}	#{window_index}	#{pane_index}	#{window_id}' 2>/dev/null) \
  <(jq -r 'select(.tmux != null and (.kind == "interactive" or .kind == "bg"))
           | [ .pid,
               .status,
               (.tmux | sub("^.*\\."; "")),
               (.name // ""),
               (.waitingFor // ((.cwd // "") | split("/") | last))
             ] | @tsv' "${files[@]}" 2>/dev/null) \
| sort -t'	' -k3,3 -k4,4n -k5,5n
