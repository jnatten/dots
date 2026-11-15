#!/usr/bin/env bash
# Claude Code hook that tells Herdr what this session is running, as labels on its
# herdr-core terminal: claude.subagents and claude.shells, how many subagents and shells
# (foreground or background) run now. One empty file per running thing keeps the count,
# so hooks fired at once for parallel tool calls need no lock; Stop's background_tasks
# corrects what an interrupt left behind. Prints nothing: as a PreToolUse hook it must
# not answer for the tool call.
set -u
[ -n "${HC_TERMINAL_ID:-}" ] || exit 0
PATH="$HOME/.local/bin:$PATH:/usr/bin:/opt/homebrew/bin"

input=$(cat)
run="${XDG_CACHE_HOME:-$HOME/.cache}/herdr-claude/$HC_TERMINAL_ID.activity"
mkdir -p "$run"

fields=$(jq -r '
  def safe: gsub("[^A-Za-z0-9_-]"; "");
  def live: (.status // "") | test("^(completed|failed|killed|stopped|cancelled|done|error)$") | not;
  (.hook_event_name // ""),
  (.agent_id // .tool_use_id // "" | safe),
  (.tool_input.run_in_background // false | tostring),
  ([.background_tasks[]? | select(.type == "shell" and live) | .id | safe] | join(" ")),
  ([.background_tasks[]? | select(.type == "subagent" and live)] | length | tostring)
' <<<"$input" 2>/dev/null) || exit 0
{ read -r event; read -r id; read -r background; read -r shells; read -r agents; } <<<"$fields"

case "$event" in
SubagentStart) [ -n "$id" ] && : >"$run/agent.$id" ;;
SubagentStop) rm -f "$run/agent.$id" ;;
PreToolUse) [ -n "$id" ] && : >"$run/shell.$id" ;;
PostToolUse | PostToolUseFailure)
  rm -f "$run/shell.$id"
  [ "$event" = PostToolUse ] && [ "$background" = true ] && [ -n "$id" ] && : >"$run/bg.$id"
  ;;
Stop)
  rm -f "$run"/shell.* "$run"/bg.*
  for s in $shells; do : >"$run/bg.$s"; done
  [ "$agents" = 0 ] && rm -f "$run"/agent.*
  ;;
SessionStart) rm -f "$run"/* ;;
esac

n() { ls "$run" | grep -c "^$1\."; }
subagents=$(n agent)
shells=$(($(n shell) + $(n bg)))
[ "$subagents" = 0 ] && subagents=""
[ "$shells" = 0 ] && shells=""

state="$subagents $shells"
if [ "$state" != "$(cat "$run.labels" 2>/dev/null)" ]; then
  hc label "$HC_TERMINAL_ID" "claude.subagents=$subagents" "claude.shells=$shells" >/dev/null 2>&1 &&
    printf '%s' "$state" >"$run.labels"
fi
exit 0
