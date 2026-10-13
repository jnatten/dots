---
name: jj-review
description: Review the jj change stack trunk()..@ and report regressions, risks and nits. Use when asked to review changes, a branch or a PR in a jj repository.
---

# jj review

Review only. Do not commit, push or edit files. No `jj` commands that change the repo (new, edit, describe, squash, rebase, abandon), no `--fix`, no formatter writes, no snapshot updates. Clearing caches in step 2 is the only allowed file change.

If the user names a revision or revset, review that instead of `trunk()..@`. If `trunk()` resolves to the root commit, ask what to compare against.

## 1. Read the change

- `jj log -r 'trunk()..@'` for intent.
- `jj diff -r 'trunk()..@' --stat`, then `jj diff -r 'trunk()..@' --git`.
- Read every changed file in full, not just the hunks.
- Find the consumers of each changed export, type, config key, env var, route or schema, and read the call sites.

## 2. Run the checks

Use the commands the project actually runs: CI workflows first, then package.json scripts, nx.json/project.json, Makefile, justfile, mise.toml, build.mill or build.sbt.

- Run typecheck, lint and tests for the affected projects. With nx in a colocated repo: `pnpm nx affected -t typecheck lint test --base=$(jj log -r 'trunk()' --no-graph -T commit_id)`.
- If results look stale (errors in untouched code, missing types that exist, output contradicting the source), clear caches and rerun: `find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete; pnpm nx reset`.
- A failure is a regression only if the change caused it. When unsure, check whether it fails on trunk too.

## 3. Verify risks

Back every risk with this repo's actual config: tsconfig, eslint, Dockerfiles, helm values, terraform, CI workflows, env files, feature flags. Never assume tool or framework defaults. Drop a claim you can't verify, or mark it unverified.

## 4. Report

```
Checks: typecheck ✓ · lint ✓ · tests ✗

Regressions
- path/to/file.ts:42 — what breaks, and the evidence

Risks
- path:line — what could go wrong and when, verified against <file>

Nits
- path:line — suggestion
```

Write "None" under an empty heading. One or two lines per item. No praise, no diff summary.

A good change can have no findings. Don't invent problems to fill the sections.
