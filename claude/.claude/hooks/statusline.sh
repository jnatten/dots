#!/usr/bin/env bash
# Claude Code status line that prints nothing. It hands Herdr what Claude passes
# it: the plan's rate limits as a cache file, and this session's context use as
# labels on its herdr-core terminal.
set -u
PATH="$HOME/.local/bin:$PATH:/usr/bin:/opt/homebrew/bin"

input=$(cat)
dir="${XDG_CACHE_HOME:-$HOME/.cache}/herdr-claude"
mkdir -p "$dir"

fields=$(jq -r '
  (.rate_limits // null | tojson),
  ([.context_window.used_percentage, .context_window.context_window_size] | map(. // "" | tostring) | join(" "))
' <<<"$input" 2>/dev/null) || exit 0
limits=$(sed -n 1p <<<"$fields")
context=$(sed -n 2p <<<"$fields")

if [ "$limits" != null ] && [ "$limits" != "$(cat "$dir/limits.json" 2>/dev/null)" ]; then
  printf '%s' "$limits" >"$dir/limits.json.$$" && mv "$dir/limits.json.$$" "$dir/limits.json"
fi

if [ -n "${HC_TERMINAL_ID:-}" ] && [ "$context" != "$(cat "$dir/$HC_TERMINAL_ID.context" 2>/dev/null)" ]; then
  read -r used size <<<"$context"
  hc label "$HC_TERMINAL_ID" "claude.context=${used:-}" "claude.context_size=${size:-}" >/dev/null 2>&1 &&
    printf '%s' "$context" >"$dir/$HC_TERMINAL_ID.context"
fi
