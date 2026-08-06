#!/usr/bin/env bash
set -euo pipefail

# Rebuildable output; skipped wholesale so the scan never descends into them
PRUNE_DIRS=(
  .jj .git
  node_modules .yarn .pnpm-store
  target out .bsp .gradle .stack-work
  dist build es lib
  .next .nx .turbo .vite .parcel-cache .svelte-kit
  .venv venv __pycache__ .mypy_cache .pytest_cache .ruff_cache
  coverage
)
SYMLINK_PATHS=(.claude)
VALUE_OPTS=(--name -r --revision -m --message --sparse-patterns -R --repository --at-operation --at-op --config --config-file --config-toml)

if [ "$#" -lt 1 ]; then
  echo "usage: jj ws-add <destination> [jj workspace add options]" >&2
  exit 2
fi

dest=""
skip=0
for arg in "$@"; do
  if [ "$skip" -eq 1 ]; then
    skip=0
    continue
  fi
  case "$arg" in
    --*=*) ;;
    -*)
      for opt in "${VALUE_OPTS[@]}"; do
        if [ "$arg" = "$opt" ]; then
          skip=1
          break
        fi
      done
      ;;
    *)
      dest=$arg
      break
      ;;
  esac
done

if [ -z "$dest" ]; then
  echo "ws-add: could not determine destination from arguments" >&2
  exit 2
fi

src=${JJ_WORKSPACE_ROOT:-$(jj workspace root)}

jj workspace add "$@"

dest=$(cd "$dest" && pwd)
cd "$src"

prune=()
for dir in "${PRUNE_DIRS[@]}"; do
  if [ "${#prune[@]}" -gt 0 ]; then
    prune+=(-o)
  fi
  prune+=(-name "$dir")
done

present=$(find . -type d \( "${prune[@]}" \) -prune -o \( -type f -o -type l \) -print | sed 's|^\./||' | LC_ALL=C sort)
tracked=$(jj file list | LC_ALL=C sort)
untracked=$(LC_ALL=C comm -23 <(printf '%s\n' "$present") <(printf '%s\n' "$tracked"))

linked=0
for path in "${SYMLINK_PATHS[@]}"; do
  if [ -e "$path" ] && [ ! -e "$dest/$path" ]; then
    untracked=$(printf '%s\n' "$untracked" | grep -v -e "^$path\$" -e "^$path/" || true)
    if [ -d "$path" ] && [ ! -L "$path" ]; then
      mkdir -p "$dest/$path"
      for entry in "$path"/* "$path"/.[!.]*; do
        if [ -e "$entry" ]; then
          ln -s "$src/$entry" "$dest/$entry"
        fi
      done
    else
      mkdir -p "$(dirname "$dest/$path")"
      ln -s "$src/$path" "$dest/$path"
    fi
    linked=$((linked + 1))
  fi
done

pending=()
while IFS= read -r file; do
  [ -n "$file" ] || continue
  [ -e "$dest/$file" ] || pending+=("$file")
done <<<"$untracked"

copied=${#pending[@]}
if [ "$copied" -gt 0 ]; then
  printf '%s\n' "${pending[@]}" | tar -cf - -T - | tar -C "$dest" -xpf -
fi

echo "Copied $copied ignored file(s) and symlinked $linked path(s) into $dest"
