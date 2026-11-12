#!/usr/bin/env bash
# Claude Code status line that prints nothing. It hands Herdr what Claude passes
# it: the plan's rate limits as a cache file, and this session's context use,
# id and folder as labels on its herdr-core terminal.
set -u
PATH="$HOME/.local/bin:$PATH:/usr/bin:/opt/homebrew/bin"

input=$(cat)
dir="${XDG_CACHE_HOME:-$HOME/.cache}/herdr-claude"
mkdir -p "$dir"

fields=$(jq -r '
  (.rate_limits // null | tojson),
  (.context_window.used_percentage // "" | tostring),
  (.context_window.context_window_size // "" | tostring),
  (.session_id // ""),
  (.cwd // "")
' <<<"$input" 2>/dev/null) || exit 0
{ read -r limits; read -r used; read -r size; read -r session; IFS= read -r cwd; } <<<"$fields"

if [ "$limits" != null ] && [ "$limits" != "$(cat "$dir/limits.json" 2>/dev/null)" ]; then
  printf '%s' "$limits" >"$dir/limits.json.$$" && mv "$dir/limits.json.$$" "$dir/limits.json"
fi

state="$used $size $session $cwd"
if [ -n "${HC_TERMINAL_ID:-}" ] && [ "$state" != "$(cat "$dir/$HC_TERMINAL_ID.context" 2>/dev/null)" ]; then
  hc label "$HC_TERMINAL_ID" "claude.context=$used" "claude.context_size=$size" "claude.session=$session" "claude.cwd=$cwd" >/dev/null 2>&1 &&
    printf '%s' "$state" >"$dir/$HC_TERMINAL_ID.context"
fi
