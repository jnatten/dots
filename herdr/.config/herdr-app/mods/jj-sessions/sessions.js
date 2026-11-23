// Claude sessions by folder, and resuming one: on the machine it ran on, in its space
// or one for its folder there, the folder made again when it's gone; or moved to another
// machine (move: its transcript copied there and resumed there, the running one here
// closed; bring: one from another machine to this one). And starting a new one in a repo,
// in a worktree or not, on a PR's branch (startNew).

import { spaces, panes, terminals, agents, shared, setShared, run, exec, home } from "herdr";

export const inside = (p, dir) => p === dir || p.startsWith(dir + "/");
export const base = (path) => path.replace(/\/+$/, "").split("/").pop();
export const tilde = (path) => (path.startsWith(home()) ? `~${path.slice(home().length)}` : path);
export const ago = (s) => {
  const d = Date.now() / 1000 - s;
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86400 ? `${Math.round(d / 3600)}h` : d < 86400 * 60 ? `${Math.round(d / 86400)}d` : `${Math.round(d / 86400 / 30)}mo`;
};

// A workspace Claude Code's WorktreeCreate hook makes: <repo>/.claude/worktrees/<name>.
export function worktree(cwd) {
  const m = cwd.match(/^(.*)\/\.claude\/worktrees\/([^/]+)/);
  return m ? { repo: m[1], name: m[2], root: m[0] } : null;
}

// "rekkert › guest-limits" for a workspace kept inside or beside its repo, else the folder's name.
export function label(cwd) {
  const claude = worktree(cwd);
  if (claude) return `${base(claude.repo)} › ${claude.name}`;
  const herdr = cwd.match(/\/\.herdr\/workspaces\/([^/]+)\/([^/]+)/);
  if (herdr) return `${herdr[1]} › ${herdr[2]}`;
  return base(cwd) || cwd;
}

export function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

async function root(dir, on) {
  const r = await exec("jj", ["--ignore-working-copy", "workspace", "root"], { cwd: dir, on }).catch(() => null);
  return r?.code === 0 ? r.stdout.trim() : dir;
}

async function spaceFor(cwd, on) {
  const target = await root(cwd, on);
  const ps = panes();
  for (const s of spaces()) {
    const at = (s.machine ?? null) === on && place(s, ps);
    if (at && inside(at, target) && (await root(at, on)) === target) return s;
  }
  return null;
}

const jj = (cwd, args, on) => exec("jj", ["--color=never", "--no-pager", ...args], { cwd, on, timeout: 600_000 });

// The folders among dirs that don't exist (on that machine).
export async function missing(dirs, on = null) {
  if (!dirs.length) return new Set();
  const r = await exec("sh", ["-c", 'for d; do [ -d "$d" ] || printf "%s\\n" "$d"; done', "sh", ...dirs], { on });
  return new Set(r.stdout.split("\n").filter(Boolean));
}

// The commit a removed workspace was on, as of the operation before jj forgot it.
async function lastCommit(repo, name, on) {
  const ops = await jj(repo, ["--ignore-working-copy", "op", "log", "--no-graph", "-T", 'id ++ "\\t" ++ description.first_line() ++ "\\n"'], on);
  const op = ops.stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .find(([, d]) => d?.match(/^(?:forget|remove) workspaces? (.+)$/)?.[1].split(", ").includes(name))?.[0];
  if (!op) return null;
  const r = await jj(repo, ["--ignore-working-copy", "--at-op", `${op}-`, "log", "--no-graph", "-r", `${name}@`, "-T", 'change_id ++ "\\t" ++ empty ++ "\\t" ++ parents.map(|p| p.change_id()).join(" ")'], on);
  const [change, empty, parents = ""] = r.stdout.trim().split("\t");
  return r.code === 0 && change ? { change, empty: empty === "true", parents: parents.split(" ").filter(Boolean) } : null;
}

// A removed .claude/worktrees workspace made again by the WorktreeCreate hook, on the
// commit it had. null when cwd wasn't one or its repo is gone too.
async function revive(cwd, on) {
  const w = worktree(cwd);
  if (!w || (await missing([w.repo], on)).size) return null;
  const input = JSON.stringify({ hook_event_name: "WorktreeCreate", cwd: w.repo, name: w.name });
  const r = await exec("sh", ["-c", 'printf %s "$1" | "$HOME/.claude/hooks/jj-workspace.sh"', "sh", input], { cwd: w.repo, on, timeout: 600_000 });
  const root = (r.stdout ?? "").trim().split("\n").pop();
  if (r.code !== 0 || !root) throw new Error((r.stderr || r.stdout || "").trim().split("\n").pop() || "The WorktreeCreate hook failed.");
  const at = await lastCommit(w.repo, w.name, on);
  if (at && (at.empty || (await jj(root, ["edit", at.change], on)).code !== 0) && at.parents.length) await jj(root, ["new", ...at.parents], on);
  const inner = root + cwd.slice(w.root.length);
  return (await missing([inner], on)).size ? root : inner;
}

// The repo a removed workspace was in, else the nearest folder above cwd that exists.
async function nearest(cwd, on) {
  let dir = worktree(cwd)?.repo ?? cwd;
  while (dir && (await missing([dir], on)).size) dir = dir.slice(0, dir.lastIndexOf("/"));
  return dir || null;
}

// The live terminal running session id on any machine (one brought here is the same session).
export const runningIn = (id) => terminals().find((t) => t.state === "live" && t.labels?.["claude.session"] === id);

// Resumes { id, cwd, machine?, space? } on its machine (null: this one), in its space
// while that's open, or goes to it wherever it's running. here: when the session's folder
// is gone, resume in its repo rather than remaking it. "" or what went wrong.
export async function resume(rec, here = false) {
  const on = rec.machine ?? null;
  const running = runningIn(rec.id);
  if (running) {
    run("agent.focus", { terminal: running.address });
    return "";
  }
  let cwd = rec.cwd;
  if ((await missing([cwd], on)).size) {
    try {
      cwd = (!here && (await revive(cwd, on))) || (await nearest(cwd, on));
    } catch (error) {
      return error.message;
    }
    if (!cwd) return `${tilde(rec.cwd)} no longer exists${on ? ` on ${on}` : ""}.`;
  }
  await resumeAt(rec.id, cwd, on, rec.space);
  return "";
}

// claude --resume id in cwd on machine on: in that space, else one for its folder there, else a new one.
async function resumeAt(id, cwd, on, space = null) {
  const argv = ["claude", "--resume", id];
  const s = spaces().find((s) => s.id === space) ?? (await spaceFor(cwd, on));
  if (s) {
    run("space.select", { id: s.id });
    run("tab.new", { space: s.id, folder: cwd, argv });
  } else run("space.new", { folder: cwd, machine: on ?? "", argv });
}

// Starting Claude in a new worktree, run as the new space's terminal so the space shows at
// once: fetches what it's started on, makes the worktree with the WorktreeCreate hook, moves
// it there, then becomes Claude (--worktree takes the worktree over). A text (a branch name or
// revision) is looked for as a local bookmark, one on origin, then a revision (a revset's
// head); not found, Claude gets the raw prompt instead. Failing, it says so and waits.
// args: repo name branch pull rev text prompt raw-prompt
const BOOT = String.raw`repo=$1 name=$2 branch=$3 pull=$4 rev=$5 text=$6 task=$7 raw=$8
dim() { printf '\033[2m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\nPress enter to close. ' "$*"; read -r _; exit 1; }
count() { printf '%s' "$1" | grep -c .; }
cd "$repo" || fail "$repo isn't there."
jjr=; [ -e .jj ] && jjr=1
gb=
if [ -n "$branch" ]; then
  dim "Fetching $branch""…"
  if [ -n "$jjr" ]; then jj git fetch -b "$branch" || fail "Couldn't fetch $branch."; rev="\"$branch\"@origin"
  else git fetch -q origin "$branch" || fail "Couldn't fetch $branch."; git branch -q --track "$branch" "origin/$branch" 2>/dev/null; gb=$branch; fi
elif [ -n "$pull" ]; then
  dim "Fetching PR #$pull""…"
  if [ -n "$jjr" ]; then { git fetch -q origin "+refs/pull/$pull/head:refs/remotes/origin/pr/$pull" && jj git import; } || fail "Couldn't fetch PR #$pull."; rev="\"pr/$pull\"@origin"
  else git fetch -q origin "+refs/pull/$pull/head:refs/heads/pr/$pull" || fail "Couldn't fetch PR #$pull."; gb="pr/$pull"; fi
elif [ -z "$rev" ] && [ -n "$text" ]; then
  dim "Finding $text""…"
  if [ -n "$jjr" ]; then
    one() { jj --ignore-working-copy log --no-graph -r "$1" -T 'change_id ++ "\n"' 2>/dev/null; }
    q=$(printf '%s' "$text" | sed 's/["\\]/\\&/g')
    ids=$(one "bookmarks(exact:\"$q\")")
    if [ "$(count "$ids")" != 1 ]; then jj git fetch -b "$text" >/dev/null 2>&1; ids=$(one "remote_bookmarks(exact:\"$q\", exact:\"origin\")"); fi
    if [ "$(count "$ids")" != 1 ]; then ids=$(one "$text"); [ "$(count "$ids")" -gt 1 ] && ids=$(one "heads($text)"); fi
    [ "$(count "$ids")" = 1 ] && rev=$ids
  elif git rev-parse -q --verify "refs/heads/$text^{commit}" >/dev/null; then rev=$text
  else
    git fetch -q origin "$text" 2>/dev/null
    if git rev-parse -q --verify "refs/remotes/origin/$text^{commit}" >/dev/null; then rev="origin/$text"
    elif git rev-parse -q --verify "$text^{commit}" >/dev/null; then rev=$text; fi
  fi
  [ -n "$rev" ] || { dim "No branch or revision $text here: starting on the repo as it is."; task=$raw; }
fi
dim "Making the worktree…"
hn=$name; [ -n "$gb" ] && hn=$gb
dir=$(printf '{"hook_event_name":"WorktreeCreate","cwd":"%s","name":"%s"}' "$repo" "$hn" | "$HOME/.claude/hooks/jj-workspace.sh" | tail -n 1)
[ -n "$dir" ] && [ -d "$dir" ] || fail "Couldn't make the worktree."
if [ -n "$rev" ]; then
  what=$branch; [ -n "$what" ] || what=$text; [ -n "$what" ] || what="PR #$pull"
  dim "Moving it to $what""…"
  if [ -n "$jjr" ]; then (cd "$dir" && jj new "$rev") || fail "Couldn't move to $what."
  else git -C "$dir" checkout -q --detach "$rev" || fail "Couldn't move to $what."; fi
fi
cd "$dir" || fail "$dir isn't there."
if [ -n "$task" ]; then exec claude --worktree "$(basename "$dir")" "$task"; fi
exec claude --worktree "$(basename "$dir")"`;

// A new Claude session in the repo at `path` on `machine` (null: this computer), in the
// checkout itself or in a worktree of its own named `name`. Started on `branch` (on origin,
// fetched first), `pull` (a fork's PR, by GitHub's pull/<n>/head ref), `rev` (a revision the
// repo has) or `text` (a branch name or revision to look for; `taskRaw` the prompt when it
// isn't found); `task` its first message. In a worktree it's all done by its new space's
// terminal (BOOT), so the space shows at once; in the checkout, before Claude starts. The
// spaces sidebar links it to `url` once it runs (shared("board.link.ask")). "" or what went wrong.
export async function startNew({ path, machine, worktree: own, name, branch, pull, rev, text, url, task, taskRaw }) {
  const on = machine ?? null;
  if ((await missing([path], on)).size) return `${tilde(path)} isn't there${on ? ` on ${on}` : ""}.`;
  const known = terminals().map((t) => t.address);
  const ask = (cwd) => url && setShared("board.link.ask", [...(shared("board.link.ask") ?? []), { url, cwd, machine: on, known, at: Date.now() }]);
  if (own) {
    const args = [path, name, branch ?? "", pull ? String(pull) : "", rev ?? "", text ?? "", task ?? "", taskRaw ?? task ?? ""];
    run("space.new", { folder: path, machine: on ?? "", argv: ["sh", "-c", BOOT, "sh", ...args] });
    // The hook's folder: <repo>/.claude/worktrees/<name, / as ->, git's named after its branch.
    ask(`${path}/.claude/worktrees`);
    return "";
  }
  const why = (r) => (r.stderr || r.stdout || "").trim().split("\n").pop() || `exit ${r.code}`;
  const git = (args) => exec("git", args, { cwd: path, on, timeout: 600_000 });
  const isJj = (await exec("test", ["-e", `${path}/.jj`], { on })).code === 0;
  if (branch) {
    const r = isJj ? await jj(path, ["git", "fetch", "-b", branch], on) : await git(["fetch", "origin", branch]);
    if (r.code !== 0) return `Couldn't fetch ${branch}: ${why(r)}`;
    const m = isJj ? await jj(path, ["new", `${JSON.stringify(branch)}@origin`], on) : await git(["switch", branch]);
    if (m.code !== 0) return `Couldn't move to ${branch}: ${why(m)}`;
  }
  const s = await spaceFor(path, on);
  if (s) {
    run("space.select", { id: s.id });
    run("tab.new", { space: s.id, folder: path, argv: ["claude"], ...(task && { task }) });
  } else run("space.new", { folder: path, machine: on ?? "", argv: ["claude"], ...(task && { task }) });
  ask(path);
  return "";
}

// Where a path on machine `from` is on machine `to` (null: this computer): the same place
// under a space folder's path there (the one named the same, else in the same place) as
// under its path on `from`, else under that machine's home as under this one's. null: nowhere.
export function mapPath(path, from, to) {
  const a = from ?? "";
  const b = to ?? "";
  if (a === b) return path;
  const sf = shared("space-folders") ?? {};
  let best = null;
  for (const f of sf.folders ?? []) {
    const theirs = f.paths?.[a]?.paths ?? [];
    const mine = f.paths?.[b]?.paths ?? [];
    const at = theirs.findIndex((d) => inside(path, d));
    if (at === -1 || !mine.length || theirs[at].length <= (best?.dir.length ?? -1)) continue;
    const dir = theirs[at];
    best = { dir, to: mine.find((d) => base(d) === base(dir)) ?? mine[at] ?? mine[0] };
  }
  if (best) return best.to + path.slice(best.dir.length);
  const [fromHome, toHome] = [sf.homes?.[a] ?? (a ? null : home()), sf.homes?.[b] ?? (b ? null : home())];
  return fromHome && toHome && inside(path, fromHome) ? toHome + path.slice(fromHome.length) : null;
}

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
// A script run here, or on machine `on` through herdr-core (stdin: what's piped in goes to it).
const via = (on, script, args, stdin = false) => `${on ? `hc exec${stdin ? " -i" : ""} --on ${q(on)} --timeout 600 -- ` : ""}sh -c ${q(script)} sh ${args.map(q).join(" ")}`;
const pipe = (src, dst) => exec("sh", ["-c", `PATH="$HOME/.local/bin:$PATH"; ${src} | ${dst}`], { timeout: 600_000 });
const sh = (script, args, on) => exec("sh", ["-c", script, "sh", ...args], { on, timeout: 60_000 });

const STAMP = 'f=$(ls -t "$HOME"/.claude/projects/*/"$1".jsonl 2>/dev/null | head -n 1); [ -n "$f" ] && printf "%s\\t%s" "$(date -r "$f" +%s)" "$f"';
const PACK = 'cd "$(dirname "$1")" && tar czf - "$2.jsonl" $(test -d "$2" && echo "$2") | base64';
const UNPACK = 'mkdir -p "$HOME/$1" && base64 -d | tar xzf - -C "$HOME/$1"';
// Its rewind checkpoints and todos, when it has any.
const EXTRAS = 'cd "$HOME/.claude" 2>/dev/null && set -- $(ls -d "file-history/$1" todos/"$1"* 2>/dev/null); if [ $# -gt 0 ]; then tar czf - "$@" | base64; fi';
const UNEXTRAS = 'd=$(cat); if [ -n "$d" ]; then mkdir -p "$HOME/.claude" && printf %s "$d" | base64 -d | tar xzf - -C "$HOME/.claude"; fi';

// A session's transcript and its subagents' from machine `from` to machine `to`, under the
// Claude project folder of cwd there (unless that one's is as new), and its rewind
// checkpoints and todos. "" or what went wrong.
async function copySession(id, from, to, cwd) {
  const rel = `.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, "-")}`;
  const [there, mine] = await Promise.all([sh(STAMP, [id], from), sh('date -r "$HOME/$1/$2.jsonl" +%s 2>/dev/null', [rel, id], to)]);
  const [at, path] = there.stdout.split("\t");
  if (!path) return `${from ?? "This computer"} no longer has this session.`;
  if (Number(mine.stdout.trim()) >= Number(at)) return "";
  const r = await pipe(via(from, PACK, [path, id]), via(to, UNPACK, [rel], true));
  if (r.code !== 0 || (await sh('test -f "$HOME/$1/$2.jsonl"', [rel, id], to)).code !== 0) return `Couldn't copy it to ${to ?? "this computer"}: ${(r.stderr || "").trim().split("\n").pop() || `exit ${r.code}`}`;
  await pipe(via(from, EXTRAS, [id]), via(to, UNEXTRAS, [], true)).catch(() => null);
  return "";
}

// Moves { id, cwd, machine? } to machine `to` (null: this computer): into the folder its own
// maps to there, made there when it's a worktree only `from` has (here: the nearest folder
// instead); its transcript copied, its running Claude here closed (not mid-turn), and resumed
// there. The spaces sidebar moves what jj-tasks knows of it and gives the new terminal its
// hand links and description (shared("sessions.move.ask")). Code isn't moved. "" or what went wrong.
export async function move(rec, to = null, here = false) {
  const from = rec.machine ?? null;
  if ((from ?? "") === (to ?? "")) return resume(rec, here);
  const where = to ?? "this computer";
  const t = runningIn(rec.id);
  const status = t && agents().find((a) => a.address === t.address)?.status;
  if (status === "working") return "Claude is working: move it once its turn is done.";
  if (status === "blocked") return "Claude is waiting for you: answer it first.";
  const mapped = mapPath(rec.cwd, from, to);
  if (!mapped) return `No folder on ${where} for ${rec.cwd}: give its sidebar folder a path there.`;
  let cwd = mapped;
  if ((await missing([mapped], to)).size) {
    try {
      cwd = (!here && (await revive(mapped, to))) || (await nearest(mapped, to));
    } catch (error) {
      return error.message;
    }
    if (!cwd) return `${mapped} isn't on ${where}.`;
  }
  const error = await copySession(rec.id, from, to, cwd);
  if (error) return error;
  const ask = { id: rec.id, from, to, links: t ? (shared("github.agent-links")?.[t.address] ?? []) : [], desc: t?.labels?.["jj.description"] ?? "", at: Date.now() };
  setShared("sessions.move.ask", [...(shared("sessions.move.ask") ?? []), ask]);
  if (t) {
    const pane = panes().find((p) => p.terminal === t.address);
    if (!pane) run("terminal.kill", { terminal: t.address });
    else if (panes().filter((p) => p.tab === pane.tab).length > 1) run("pane.close", { pane: pane.pane });
    else run("tab.close", { id: pane.tab, confirmed: true });
  }
  await resumeAt(rec.id, cwd, to);
  return "";
}

// A session from another machine, resumed here (see move).
export const bring = (rec, here = false) => move(rec, null, here);
