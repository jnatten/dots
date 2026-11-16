#!/usr/bin/env bash
# `jj workspace remove`, but the folder is renamed into .jj/trash and deleted in the
# background, so removing a workspace with node_modules doesn't wait on ~100k unlinks
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: jj ws-rm <workspace>..." >&2
  exit 2
fi

main=${JJ_WORKSPACE_ROOT:-$(jj workspace root)}
if [ -f "$main/.jj/repo" ]; then
  main=$(cd "$main/.jj" && cd "$(dirname "$(cat repo)")/.." && pwd -P)
fi
main=$(cd "$main" && pwd -P)

dirs=()
for name in "$@"; do
  dir=$(jj -R "$main" --ignore-working-copy workspace root --name "$name" 2>/dev/null) || continue
  [ -d "$dir" ] || continue
  dir=$(cd "$dir" && pwd -P)
  if [ "$dir" = "$main" ]; then
    echo "ws-rm: $name is the main workspace" >&2
    exit 1
  fi
  jj -R "$dir" --quiet workspace update-stale
  jj -R "$dir" --quiet util snapshot
  dirs+=("$dir")
done

jj -R "$main" workspace forget "$@"

trash="$main/.jj/trash"
for dir in ${dirs[@]+"${dirs[@]}"}; do
  mkdir -p "$trash"
  mv "$dir" "$(mktemp -d "$trash/XXXXXX")/" || rm -rf "$dir"
done

[ ! -e "$main/.git" ] || git -C "$main" worktree prune

if [ -d "$trash" ]; then
  nohup rm -rf -- "$trash" </dev/null >/dev/null 2>&1 3>&- &
fi
