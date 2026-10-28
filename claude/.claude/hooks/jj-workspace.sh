#!/usr/bin/env bash
# WorktreeCreate/WorktreeRemove hook for Claude Code and Claude Desktop: backs
# their worktrees with jj workspaces, so they show up in `jj workspace list` and
# `jj log`. The hook replaces Claude's git logic everywhere, so outside a jj repo
# it makes the plain git worktree Claude would have made.
set -euo pipefail
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

# Claude reads the worktree path from stdout, so everything else goes to stderr
exec 3>&1 1>&2

input=$(cat)
field() { jq -r --arg k "$1" '.[$k] // empty' <<<"$input"; }

# The checkout that owns the repo, even when called from inside a workspace
jj_main_root() {
  local root
  root=$(cd "$1" && jj --ignore-working-copy workspace root 2>/dev/null) || return 1
  if [ -f "$root/.jj/repo" ]; then
    root=$(cd "$root/.jj" && cd "$(dirname "$(cat repo)")/.." && pwd -P)
  fi
  echo "$root"
}

git_main_root() {
  dirname "$(git -C "$1" rev-parse --path-format=absolute --git-common-dir)"
}

# Claude skips .worktreeinclude when a hook makes the worktree
copy_includes() {
  [ -f "$1/.worktreeinclude" ] || return 0
  git -C "$1" rev-parse --git-dir >/dev/null 2>&1 || return 0
  git -C "$1" ls-files -z --others --ignored --exclude-from=.worktreeinclude \
    | git -C "$1" check-ignore -z --stdin \
    | while IFS= read -r -d '' f; do
        case $f in .claude/worktrees/*) continue ;; esac
        mkdir -p "$2/$(dirname "$f")"
        cp -p "$1/$f" "$2/$f"
      done || true
}

create() {
  local cwd name slug root dir colocate
  cwd=$(field cwd)
  cwd=${cwd:-$PWD}
  name=$(field name)
  [ -n "$name" ] || { echo "WorktreeCreate input has no name"; exit 1; }
  slug=${name//\//-}

  if root=$(jj_main_root "$cwd"); then
    dir="$root/.claude/worktrees/$slug"
    if [ ! -d "$dir/.jj" ]; then
      colocate=--no-colocate
      [ -e "$root/.git" ] && colocate=--colocate
      mkdir -p "$root/.claude/worktrees"
      (cd "$root" && jj workspace add "$colocate" --name "$slug" "$dir")
      copy_includes "$root" "$dir"
    fi
  else
    root=$(git_main_root "$cwd")
    dir="$root/.claude/worktrees/$slug"
    if [ ! -e "$dir/.git" ]; then
      if git -C "$root" show-ref --verify --quiet "refs/heads/$name"; then
        git -C "$root" worktree add "$dir" "$name"
      else
        git -C "$root" worktree add -b "$name" "$dir" HEAD
      fi
      copy_includes "$root" "$dir"
    fi
  fi

  echo "$dir" >&3
}

remove() {
  local path root ws branch
  path=$(field worktree_path)
  [ -d "$path" ] || exit 0
  path=$(cd "$path" && pwd -P)

  if [ -d "$path/.jj" ] && root=$(jj_main_root "$path"); then
    ws=$(cd "$root" && jj --ignore-working-copy workspace list -T 'name ++ "\t" ++ root ++ "\n"' \
      | awk -F'\t' -v p="$path" '$2 == p { print $1 }')
    [ -n "$ws" ] || { echo "no jj workspace at $path"; exit 1; }
    # snapshots the workspace first, so its changes stay in `jj log`
    (cd "$root" && jj workspace remove "$ws")
  else
    root=$(git_main_root "$path")
    branch=$(git -C "$path" branch --show-current)
    git -C "$root" worktree remove --force "$path"
    [ -z "$branch" ] || git -C "$root" branch -d "$branch" || true
  fi
}

case $(field hook_event_name) in
  WorktreeCreate) create ;;
  WorktreeRemove) remove ;;
  *) echo "unexpected hook event"; exit 1 ;;
esac
