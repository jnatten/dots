// jj workspace dialog: { space, action: "new" | "open" | "remove" } or
// { folder, machine } for a repo without a space; optional { name, tab, argv }.
// A folder in a git repo without jj goes to the worktree dialog instead.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, spaces, panes, exec, home, readTextFile, shared } from "herdr";

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s, all = panes()) {
  if (!s) return null;
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

// New workspaces come from Claude Code's WorktreeCreate hook, as `claude --worktree`
// and Claude desktop make theirs: <main workspace>/.claude/worktrees/<name>.
const HOOK = (home) => `${home}/.claude/hooks/jj-workspace.sh`;
// Home as ~ (git says C:/Users/x where Windows says C:\Users\x).
const tilde = (path, userHome) => {
  const [p, h] = [path, userHome].map((s) => s.replace(/\\/g, "/"));
  return p.startsWith(h) ? `~${p.slice(h.length)}` : path;
};
const slug = (name) => name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
const ago = (s) => {
  const d = Date.now() / 1000 - s;
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86400 ? `${Math.round(d / 3600)}h` : d < 86400 * 60 ? `${Math.round(d / 86400)}d` : `${Math.round(d / 86400 / 30)}mo`;
};
const normalize = (path) =>
  path
    .split("/")
    .reduce((out, part) => (part === ".." ? out.slice(0, -1) : part === "." || (part === "" && out.length) ? out : [...out, part]), [])
    .join("/");

const LIST = String.raw`name ++ "\t" ++ if(root, root.absolute()) ++ "\t" ++ if(target.current_working_copy(), "*") ++ "\t" ++ target.committer().timestamp().format("%s") ++ "\t" ++ target.description().first_line() ++ "\n"`;

// Every workspace of a repo, the main one first, then the most recently
// snapshotted: { name, path, main, current, at, about }.
async function workspaces(repo, on) {
  const r = await jj(repo.top, ["--ignore-working-copy", "workspace", "list", "-T", LIST], on);
  if (!r.ok) return [];
  return r.out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, path, current, at, ...about] = line.split("\t");
      return { name, path, main: path === repo.main, current: current === "*", at: Number(at) || 0, about: about.join("\t") };
    })
    .sort((a, b) => b.main - a.main || b.at - a.at);
}

// The space showing a workspace: its first terminal is in it (the deepest workspace wins).
function spaceOf(path, all, on, spaceList, paneList) {
  const inside = (p, dir) => p === dir || p.startsWith(dir + "/");
  return spaceList.find((s) => (s.machine ?? null) === (on ?? null) && (() => {
    const at = place(s, paneList)?.replace(/\\/g, "/");
    if (!at || !inside(at, path)) return false;
    return !all.some((c) => c.path !== path && c.path.length > path.length && inside(at, c.path));
  })());
}

async function jj(cwd, args, on, timeout) {
  const r = await exec("jj", ["--color=never", "--no-pager", ...args], { cwd, on, ...(timeout === undefined ? {} : { timeout }) });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr || r.stdout || "").trim() };
}

const ok = async (cmd, args, on) => (await exec(cmd, args, { on })).code === 0;

// The repo a folder belongs to: its workspace's root, the main workspace's
// root and name, and whether the folder is in another workspace. null outside jj.
async function repoOf(folder, on) {
  const top = await jj(folder, ["--ignore-working-copy", "workspace", "root"], on);
  if (!top.ok) return null;
  // Another workspace's .jj/repo is a file naming the main one's, relative to its .jj.
  const store = (await ok("test", ["-f", `${top.out}/.jj/repo`], on)) ? (await readTextFile(`${top.out}/.jj/repo`, { on }).catch(() => null))?.trim() : null;
  const main = store ? normalize(store.startsWith("/") ? store : `${top.out}/.jj/${store}`).replace(/\/\.jj\/repo$/, "") : top.out;
  return { top: top.out, main, name: main.split("/").pop(), linked: main !== top.out };
}

export default class JjWorkspace extends View {
  init(_props, cx) {
    this.on = this.space()?.machine;
    this.userHome = this.on ? null : home();
    this.opening = props()?.action === "open";
    this.text = props()?.name ?? "";
    this.list = undefined; // open: the workspaces, once read
    this.at = 0;
    this.input = InputState.new({ value: this.text, placeholder: this.opening ? "filter workspaces" : "workspace name" });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = ""; this.at = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.go(cx));
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.handle = cx.focus_handle();
    this.handle.focus(); // the root is mounted from the first frame: keep the keyboard here while loading
    if (props()?.action !== "remove") this.input.focus();
    this.busy = false;
    this.error = "";
    this.repo = undefined; // undefined: looking, null: not in jj
    cx.spawn(async (cx) => {
      try {
        if (this.on) {
          let result;
          try { result = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: this.on }); } catch {}
          if (!result || result.code !== 0 || !result.stdout.trim()) result = await exec("powershell.exe", ["-NoProfile", "-Command", "[Console]::Write($HOME)"], { on: this.on });
          if (result.code !== 0 || !result.stdout.trim()) throw new Error("Could not find the remote home folder.");
          this.userHome = result.stdout.trim().replace(/\\/g, "/");
        }
        this.folder = props()?.folder || place(this.space()) || this.userHome;
        // The repo is set last: Enter does nothing until it is known.
        const repo = await repoOf(this.folder, this.on);
        if (!repo && (await exec("git", ["rev-parse", "--show-toplevel"], { cwd: this.folder, on: this.on })).code === 0) return this.toWorktree();
        if (repo && this.opening) this.list = (await workspaces(repo, this.on)).filter((w) => w.path);
        this.repo = repo;
        cx.notify();
        // The list (and with it the filter input) only mounts once loading is
        // done, so the keyboard must move there now — a focus call made while
        // loading lands on nothing and the dialog stays keyboard-dead.
        this.handle.focus();
        if (props().action !== "remove") cx.timer.after(100, () => this.input.focus());
        if (props().name) await this.work(cx);
      } catch (error) { this.repo = null; this.error = String(error); cx.notify(); }
    });
  }

  space() {
    const p = props() ?? {};
    return spaces().find((s) => s.id === p.space) ?? (p.folder ? { folder: p.folder, machine: p.machine ?? null, name: "" } : undefined);
  }

  close() {
    closeOverlay(props().overlay);
  }

  toWorktree() {
    const { overlay: _, ...rest } = props();
    this.close();
    openOverlay({ mod: "worktree", kind: "dialog", ...(this.opening ? { width: 560, height: 480 } : { width: 460, height: 280 }), props: rest });
  }

  go(cx) {
    if (this.busy || !this.repo) return;
    cx.spawn(async (cx) => this.work(cx));
  }

  async work(cx) {
    if (this.busy || !this.repo) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    try { this.error = props().action === "remove" ? await this.remove() : await this.create(); }
    catch (error) { this.error = String(error); }
    this.busy = false;
    if (!this.error) this.close();
    cx.notify();
  }

  async create() {
    const name = slug(this.text.trim());
    if (!name) return "Type a workspace name.";
    const all = (await workspaces(this.repo, this.on)).filter((w) => w.path);
    const existing = all.find((w) => w.name === name);
    if (existing) {
      this.show(existing, all);
      return "";
    }
    const input = JSON.stringify({ hook_event_name: "WorktreeCreate", cwd: this.repo.top, name });
    const r = await exec("sh", ["-c", 'printf %s "$1" | "$2"', "sh", input, HOOK(this.userHome)], { cwd: this.repo.top, on: this.on, timeout: 600_000 });
    const path = (r.stdout ?? "").trim().split("\n").pop();
    if (r.code !== 0 || !path) return (r.stderr || r.stdout || "").trim().split("\n").pop() || "The WorktreeCreate hook failed.";
    const p = props();
    // Leave spaces unnamed so they follow the workspace folder and nest under the repo.
    run("space.new", { folder: path, machine: this.on ?? "", tab: p.tab, argv: p.argv });
    return "";
  }

  shown() {
    const f = this.text.trim().toLowerCase();
    return (this.list ?? []).filter((c) => !f || `${c.name} ${c.about} ${c.path}`.toLowerCase().includes(f));
  }

  show(c, all) {
    const s = spaceOf(c.path, all, this.on, spaces(), panes());
    if (s) run("space.select", { id: s.id });
    else run("space.new", { folder: c.path, machine: this.on ?? "" });
  }

  open(c) {
    if (!c) return;
    this.close();
    this.show(c, this.list);
  }

  async remove() {
    const s = this.space();
    const current = (await workspaces(this.repo, this.on)).find((w) => w.current);
    if (!current) return "Couldn't find this workspace in jj workspace list.";
    const stale = await jj(this.repo.top, ["--quiet", "workspace", "update-stale"], this.on, 600_000);
    if (!stale.ok) return stale.err || "jj workspace update-stale failed.";
    // Terminals first: a shell sitting in the folder keeps it busy on Windows.
    const top = this.repo.top;
    const ps = panes();
    for (const x of spaces()) {
      const at = (x.machine ?? null) === (this.on ?? null) && place(x, ps)?.replace(/\\/g, "/");
      if (x.id === s?.id || (at && (at === top || at.startsWith(`${top}/`)))) run("space.close", { id: x.id, confirmed: true });
    }
    const r = await jj(this.repo.main, ["workspace", "remove", current.name], this.on, 600_000);
    return r.ok ? "" : r.err || "jj workspace remove failed.";
  }

  key(e, cx) {
    if (e.key === "escape") return this.close();
    if (this.opening) {
      const n = this.shown().length;
      if (e.key === "enter") this.open(this.shown()[this.at]);
      else if ((e.key === "down" || e.key === "up") && n) this.at = (this.at + (e.key === "down" ? 1 : n - 1)) % n;
      else return;
      cx.stop_propagation();
      return cx.notify();
    }
    if (e.key === "enter" && props()?.action === "remove") return this.go(cx);
  }

  renderOpen(t) {
    const r = this.repo;
    const rows = this.shown();
    const all = this.list ?? [];
    const spaceList = spaces();
    const paneList = panes();
    const row = (c, i) => {
      const on = i === this.at;
      const there = spaceOf(c.path, all, this.on, spaceList, paneList);
      const path = tilde(c.path, this.userHome ?? "");
      return v_flex()
        .id(`ws-${i}`)
        .flex_none()
        .h(44)
        .px(10)
        .justify_center()
        .rounded(7)
        .cursor_pointer()
        .when(on, (el) => el.bg(t.selected))
        .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click(() => this.open(c))
        .child(
          h_flex()
            .gap(8)
            .items_center()
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(c.name))
            .when(c.main, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("main workspace")))
            .when(Boolean(there), (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).child("open")))
            .when(!there && c.at > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(ago(c.at)))),
        )
        .child(div().truncate().text_size(11.5).text_color(t.dim).child(c.about ? `${c.about} \u00b7 ${path}` : path));
    };
    const count = rows.length === all.length ? `${all.length} workspaces` : `${rows.length}/${all.length} workspaces`;
    return v_flex()
      .id("workspace")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(h_flex().child(div().flex_1().font_semibold().text_color(t.foreground).child(`Open jj workspace${r ? ` of ${r.name}` : ""}`)).child(div().text_size(11).text_color(t.dim).child(r ? count : "")))
      .when(r === undefined || (r && this.list === undefined), (el) => el.child(div().text_color(t.muted).child("\u2026")))
      .when(r === null, (el) => el.child(div().text_color(t.muted).child(this.error || `${this.folder ? tilde(this.folder, this.userHome ?? "") : "This folder"} is not in a jj repository.`)))
      .when(Boolean(r && this.list), (el) =>
        el
          .child(Input.new(this.input).h(32).px(10).items_center().rounded(6).border(1).border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_color(t.foreground))
          .child(
            div()
              .relative()
              .flex_1()
              .min_h(0)
              .child(
                v_flex()
                  .id("ws-list")
                  .size_full()
                  .overflow_y_scroll()
                  .children(rows.map(row))
                  .when(rows.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child("No matching workspaces."))),
              )
              .child(Scrollbar.vertical("ws-list").absolute().inset_0()),
          ),
      )
      .child(h_flex().justify_end().text_size(11).text_color(t.dim).child("\u2191\u2193 choose \u00b7 \u21b5 open \u00b7 esc close"));
  }

  render(cx) {
    const t = theme();
    if (this.opening) return this.renderOpen(t);
    const remove = props()?.action === "remove";
    const s = this.space();
    const r = this.repo;
    const title = remove ? `Remove jj workspace ${s?.name || (r?.top.split("/").pop() ?? "")}?` : `New jj workspace${r ? ` of ${r.name}` : ""}`;
    const detail =
      r === undefined
        ? "…"
        : r === null
          ? `${this.folder ? tilde(this.folder, this.userHome) : "This folder"} is not in a jj repository.`
          : remove
            ? !r.linked
              ? "This is the repository's main workspace, which jj can't remove."
              : `${s?.id ? "Closes the space and deletes" : "Deletes"} ${tilde(r.top, this.userHome)}. Its working copy is snapshotted first, so its changes stay in jj log.`
            : `A new space on a workspace in ${tilde(r.main, this.userHome)}/.claude/worktrees/, made by Claude Code's WorktreeCreate hook like \`claude --worktree\`. A name already in use opens that workspace.`;
    const blocked = !r || (remove && !r.linked);
    const archived = remove && r?.linked ? (shared("jj-sessions.archived") ?? []).filter((a) => a.cwd === r.top || a.cwd.startsWith(`${r.top}/`)).length : 0;
    return v_flex()
      .id("workspace")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(div().font_semibold().text_color(t.foreground).child(title))
      .child(div().text_color(t.muted).child(detail))
      .when(archived > 0, (el) => el.child(div().text_color(t.blocked).child(`${archived === 1 ? "An archived Claude session lives" : `${archived} archived Claude sessions live`} here and can't be resumed after this.`)))
      .when(!remove && !blocked, (el) =>
        el.child(
          Input.new(this.input)
            .h(32)
            .px(10)
            .items_center()
            .rounded(6)
            .border(1)
            .border_color(this.inputFocused ? t.accent : t.input)
            .bg(t.background)
            .text_color(t.foreground),
        ),
      )
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(
        h_flex()
          .justify_end()
          .text_size(11)
          .text_color(t.dim)
          .gap(6)
          .when(this.busy, (el) => el.child(div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)))
          .child(this.busy ? "working…" : blocked ? "esc close" : remove ? "↵ remove · esc cancel" : "↵ create · esc cancel"),
      );
  }
}
