// Claude Code sessions: the sidebar's Archived block, the session search (as
// the overlay, mod.open; spaces in Waiting and their sessions in a section of their
// own), and the archive confirmation ({ action: "archive", terminals? | space? }).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { agents, spaces, panes, layout, focused, theme, shared, setShared, props, run, exec, hc, home, appHome, readTextFile, openOverlay, closeOverlay, nextCommand } from "herdr";

const ARCHIVE = "jj-sessions.archived";
const FOLDED = 41;
const LIST = 440;
const ICON = (name) => `mods/workspace-chrome/${name}.svg`;
// Space avatar colors, as the jj-spaces sidebar draws them.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

const archived = () => shared(ARCHIVE) ?? [];
const forget = (id) => setShared(ARCHIVE, archived().filter((r) => r.id !== id));

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
const inside = (p, dir) => p === dir || p.startsWith(dir + "/");
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
const tilde = (path) => (path.startsWith(home()) ? `~${path.slice(home().length)}` : path);
const ago = (s) => {
  const d = Date.now() / 1000 - s;
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86400 ? `${Math.round(d / 3600)}h` : d < 86400 * 60 ? `${Math.round(d / 86400)}d` : `${Math.round(d / 86400 / 30)}mo`;
};

// A workspace Claude Code's WorktreeCreate hook makes: <repo>/.claude/worktrees/<name>.
function worktree(cwd) {
  const m = cwd.match(/^(.*)\/\.claude\/worktrees\/([^/]+)/);
  return m ? { repo: m[1], name: m[2], root: m[0] } : null;
}

// "rekkert › guest-limits" for a workspace kept inside or beside its repo, else the folder's name.
function label(cwd) {
  const claude = worktree(cwd);
  if (claude) return `${base(claude.repo)} › ${claude.name}`;
  const herdr = cwd.match(/\/\.herdr\/workspaces\/([^/]+)\/([^/]+)/);
  if (herdr) return `${herdr[1]} › ${herdr[2]}`;
  return base(cwd) || cwd;
}

function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

const claude = (a) => !a.address.includes("/") && (a.app === "claude-code" || a.program?.key === "claude");

async function sessionOf(pid) {
  const s = JSON.parse((await readTextFile(`${home()}/.claude/sessions/${pid}.json`).catch(() => null)) ?? "null");
  return s?.sessionId ? s : null;
}

// The Claude sessions running here: ~/.claude/sessions/<pid>.json describes
// the terminal's foreground process, or its child when a shell launched it.
async function live() {
  const found = await Promise.all(
    agents()
      .filter(claude)
      .map(async (a) => {
        try {
          const pid = JSON.parse((await hc(["get", a.address, "--json"])).stdout).foreground?.pid;
          if (!pid) return null;
          let s = await sessionOf(pid);
          for (const kid of s ? [] : (await exec("pgrep", ["-P", String(pid)])).stdout.split(/\s+/).filter(Boolean)) s ??= await sessionOf(kid);
          return s ? { address: a.address, pane: a.pane, tab: a.tab, space: a.space, id: s.sessionId, cwd: s.cwd, title: a.title || s.name || "Claude", status: a.status } : null;
        } catch {
          return null;
        }
      }),
  );
  return found.filter(Boolean);
}

let node = null;
const nodejs = async () => (node ??= (await exec("sh", ["-lc", "command -v node"])).stdout.trim() || "node");

async function history() {
  const r = await exec(await nodejs(), [`${appHome()}/mods/jj-sessions/scan.mjs`], { timeout: 60000 });
  return r.code === 0 ? JSON.parse(r.stdout) : [];
}

async function root(dir) {
  const r = await exec("jj", ["--ignore-working-copy", "workspace", "root"], { cwd: dir }).catch(() => null);
  return r?.code === 0 ? r.stdout.trim() : dir;
}

async function spaceFor(cwd) {
  const target = await root(cwd);
  const ps = panes();
  for (const s of spaces()) {
    const at = !s.machine && place(s, ps);
    if (at && inside(at, target) && (await root(at)) === target) return s;
  }
  return null;
}

const jj = (cwd, args) => exec("jj", ["--color=never", "--no-pager", ...args], { cwd, timeout: 600_000 });

// The folders among dirs that don't exist.
async function missing(dirs) {
  if (!dirs.length) return new Set();
  const r = await exec("sh", ["-c", 'for d; do [ -d "$d" ] || printf "%s\\n" "$d"; done', "sh", ...dirs]);
  return new Set(r.stdout.split("\n").filter(Boolean));
}

// The commit a removed workspace was on, as of the operation before jj forgot it.
async function lastCommit(repo, name) {
  const ops = await jj(repo, ["--ignore-working-copy", "op", "log", "--no-graph", "-T", 'id ++ "\\t" ++ description.first_line() ++ "\\n"']);
  const op = ops.stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .find(([, d]) => d?.match(/^(?:forget|remove) workspaces? (.+)$/)?.[1].split(", ").includes(name))?.[0];
  if (!op) return null;
  const r = await jj(repo, ["--ignore-working-copy", "--at-op", `${op}-`, "log", "--no-graph", "-r", `${name}@`, "-T", 'change_id ++ "\\t" ++ empty ++ "\\t" ++ parents.map(|p| p.change_id()).join(" ")']);
  const [change, empty, parents = ""] = r.stdout.trim().split("\t");
  return r.code === 0 && change ? { change, empty: empty === "true", parents: parents.split(" ").filter(Boolean) } : null;
}

// A removed .claude/worktrees workspace made again by the WorktreeCreate hook, on the
// commit it had. null when cwd wasn't one or its repo is gone too.
async function revive(cwd) {
  const w = worktree(cwd);
  if (!w || (await missing([w.repo])).size) return null;
  const input = JSON.stringify({ hook_event_name: "WorktreeCreate", cwd: w.repo, name: w.name });
  const r = await exec("sh", ["-c", 'printf %s "$1" | "$2"', "sh", input, `${home()}/.claude/hooks/jj-workspace.sh`], { cwd: w.repo, timeout: 600_000 });
  const root = (r.stdout ?? "").trim().split("\n").pop();
  if (r.code !== 0 || !root) throw new Error((r.stderr || r.stdout || "").trim().split("\n").pop() || "The WorktreeCreate hook failed.");
  const at = await lastCommit(w.repo, w.name);
  if (at && (at.empty || (await jj(root, ["edit", at.change])).code !== 0) && at.parents.length) await jj(root, ["new", ...at.parents]);
  const inner = root + cwd.slice(w.root.length);
  return (await missing([inner])).size ? root : inner;
}

// The repo a removed workspace was in, else the nearest folder above cwd that exists.
async function nearest(cwd) {
  let dir = worktree(cwd)?.repo ?? cwd;
  while (dir && (await missing([dir])).size) dir = dir.slice(0, dir.lastIndexOf("/"));
  return dir || null;
}

// here: when the session's folder is gone, resume in its repo rather than remaking it.
async function resume(rec, here = false) {
  let cwd = rec.cwd;
  if ((await missing([cwd])).size) {
    try {
      cwd = (!here && (await revive(cwd))) || (await nearest(cwd));
    } catch (error) {
      return error.message;
    }
    if (!cwd) return `${tilde(rec.cwd)} no longer exists.`;
  }
  const argv = ["claude", "--resume", rec.id];
  const s = await spaceFor(cwd);
  if (s) {
    run("space.select", { id: s.id });
    run("tab.new", { space: s.id, folder: cwd, argv });
  } else run("space.new", { folder: cwd, machine: "", argv });
  forget(rec.id);
  return "";
}

function archive(targets, space) {
  const at = Math.floor(Date.now() / 1000);
  const ids = new Set(targets.map((s) => s.id));
  setShared(ARCHIVE, [...targets.map((s) => ({ id: s.id, cwd: s.cwd, title: s.title, at })), ...archived().filter((r) => !ids.has(r.id))]);
  if (space) return run("space.close", { id: space, confirmed: true });
  const ps = panes();
  for (const s of targets) {
    if (ps.filter((p) => p.tab === s.tab).length > 1) run("pane.close", { pane: s.pane });
    else run("tab.close", { id: s.tab, confirmed: true });
  }
}

// Open search overlays: cmd-shift-a archives their selection rather than the focused pane's session.
let searching = 0;

const confirmArchive = (args) => openOverlay({ mod: "jj-sessions", kind: "dialog", width: 440, height: 220, props: { action: "archive", ...args } });

export default class Sessions extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.mode = p.action === "archive" ? "confirm" : p.overlay ? "search" : "block";
    this.error = "";
    this.handle = cx.focus_handle();
    if (this.mode === "block") return this.initBlock(cx);
    this.handle.focus();
    if (this.mode === "confirm") return this.initConfirm(cx, p);
    this.initSearch(cx);
  }

  hide() {
    closeOverlay(props().overlay);
  }

  close() {
    if (this.mode === "search") searching--;
  }

  initBlock(cx) {
    this.gone = {};
    this.hovered = null;
    cx.timer.every(3000, (cx) => this.checkGone(cx, false));
    cx.timer.every(60000, (cx) => this.checkGone(cx, true));
    this.checkGone(cx, true);
    cx.spawn(async () => {
      for (;;) {
        if ((await nextCommand()) !== "archive" || searching > 0) continue;
        const terminal = focused()?.terminal;
        confirmArchive({ terminals: terminal ? [terminal] : [] });
      }
    });
  }

  checkGone(cx, all) {
    const folders = [...new Set(archived().map((r) => r.cwd))].filter((c) => all || !(c in this.gone));
    if (!folders.length || this.checking) return;
    this.checking = true;
    cx.spawn(async (cx) => {
      const gone = await missing(folders).catch(() => new Set());
      for (const c of folders) this.gone[c] = gone.has(c);
      this.checking = false;
      cx.notify();
    });
  }

  // Resumes a session, its folder made again or (here) its repo used when it's gone.
  start(s, here, cx, done) {
    if (this.busy) return;
    this.busy = s.id;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      this.error = await resume(s, here);
      this.busy = null;
      if (!this.error) done?.();
      cx.notify();
    });
  }

  // What resuming s does when its folder is gone: ↵ makes its workspace again, ⇧ uses the repo.
  goneHint(s, enter, shift) {
    const w = worktree(s.cwd);
    return w ? `${enter} recreate workspace · ${shift} resume in ${base(w.repo)}` : `${enter} resume in a parent folder`;
  }

  initConfirm(cx, p) {
    this.targets = undefined;
    cx.spawn(async (cx) => {
      const all = await live();
      this.targets = p.space ? all.filter((s) => s.space === p.space) : all.filter((s) => (p.terminals ?? []).includes(s.address));
      cx.notify();
    });
  }

  initSearch(cx) {
    this.text = "";
    this.at = 0;
    this.open = undefined;
    this.history = undefined;
    this.gone = {};
    this.childOf = [];
    this.scroll = ScrollHandle.new();
    searching++;
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) !== "archive") continue;
        const it = this.items()[this.at];
        if (it?.kind === "open") this.dismiss(it);
        cx.notify();
      }
    });
    this.input = InputState.new({ placeholder: "Search sessions…" });
    this.input.on("change", (_e, cx) => {
      this.text = this.input.value();
      this.at = 0;
      this.error = "";
      cx.notify();
    });
    this.input.on("submit", (e, cx) => this.go(this.items()[this.at], cx, Boolean(e?.shift)));
    this.input.focus();
    cx.spawn(async (cx) => {
      this.open = await live();
      cx.notify();
    });
    cx.spawn(async (cx) => {
      this.history = await history().catch(() => []);
      cx.notify();
      const gone = await missing([...new Set([...archived(), ...this.history].map((s) => s.cwd).filter(Boolean))]).catch(() => new Set());
      this.gone = Object.fromEntries([...gone].map((c) => [c, true]));
      cx.notify();
    });
  }

  sections() {
    const f = this.text.trim().toLowerCase();
    const match = (s) => !f || `${s.title} ${label(s.cwd)} ${s.cwd} ${s.machine ?? ""} ${s.prompt ?? ""}`.toLowerCase().includes(f);
    const ps = panes();
    const colors = shared("space.colors") ?? {};
    const all = spaces().map((w) => ({
      id: w.id,
      title: w.name,
      cwd: place(w, ps) ?? "",
      machine: w.machine,
      color: colors[w.id] ?? "ansi6",
      meta: ["blocked", "done", "working"].includes(w.status) ? w.status : `${w.tabs.length} tab${w.tabs.length === 1 ? "" : "s"}`,
    }));
    const skip = new Set([...(this.open ?? []), ...archived()].map((s) => s.id));
    const past = (this.history ?? []).filter((s) => !skip.has(s.id) && match(s));
    // Spaces in Waiting (jj-spaces' shared("spaces.waiting")) and their open sessions
    // have a section of their own: each space, then its sessions.
    const parked = new Set(shared("spaces.waiting") ?? []);
    const open = this.open ?? [];
    const waiting = all.filter((w) => parked.has(w.id)).flatMap((w) => {
      const mine = open.filter((s) => s.space === w.id && match(s)).map((s) => ({ ...s, kind: "open" }));
      return match(w) || mine.length ? [{ ...w, kind: "space" }, ...mine] : [];
    });
    return [
      { name: "Open", kind: "open", list: open.filter((s) => !parked.has(s.space) && match(s)), loading: this.open === undefined },
      { name: "Spaces", kind: "space", list: all.filter((w) => !parked.has(w.id) && match(w)), loading: false },
      { name: "Waiting", kind: "waiting", list: waiting, loading: false },
      { name: "Archived", kind: "archived", list: archived().filter(match), loading: false },
      { name: "History", kind: "history", list: past.slice(0, 100), total: past.length, loading: this.history === undefined },
    ];
  }

  items() {
    return this.sections().flatMap(({ kind, list }) => list.map((s) => ({ kind: kind === "waiting" ? s.kind : kind, s })));
  }

  go(it, cx, here = false) {
    if (!it) return;
    if (it.kind === "open" || it.kind === "space") {
      this.hide();
      return it.kind === "open" ? run("pane.focus", { pane: it.s.pane }) : run("space.select", { id: it.s.id });
    }
    this.start(it.s, here, cx, () => this.hide());
  }

  dismiss(it) {
    if (it?.kind === "archived") forget(it.s.id);
    else if (it?.kind === "open") {
      this.hide();
      confirmArchive({ terminals: [it.s.address] });
    }
  }

  confirm() {
    if (!this.targets?.length) return;
    this.hide();
    archive(this.targets, props()?.space);
  }

  render() {
    const t = theme();
    return this.mode === "block" ? this.renderBlock(t) : this.mode === "confirm" ? this.renderConfirm(t) : this.renderSearch(t);
  }

  renderBlock(t) {
    const list = archived();
    const rail = narrow();
    const folded = (find(layout(), "archived")?.size?.px ?? Infinity) <= FOLDED;
    const search = () => run("mod.open", { name: "jj-sessions" });
    const fold = () => run("layout.resize", folded ? { id: "archived", weight: 0.5 } : { id: "archived", px: FOLDED });
    const button = (id, icon, action) =>
      div().id(id).size(22).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim).hover((s) => s.text_color(t.foreground)).on_click(action).child(svg(ICON(icon)).size(14));
    const row = (r) => {
      const gone = this.gone[r.cwd];
      const hovered = this.hovered === r.id;
      return h_flex()
        .id(`arch-${r.id}`)
        .h(30)
        .px(8)
        .gap(8)
        .flex_none()
        .items_center()
        .rounded(8)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          this.hovered = on ? r.id : hovered ? null : this.hovered;
          cx.notify();
        })
        .on_click((e, cx) => this.start(r, e.modifiers.shift, cx))
        .when(Boolean(gone), (el) => el.tooltip(this.goneHint(r, "click", "⇧-click")))
        .child(svg(ICON("archive")).size(13).flex_none().text_color(t.dim))
        .child(div().flex_1().min_w(0).truncate().text_color(gone ? t.dim : t.foreground).child(r.title))
        .child(div().flex_none().max_w(96).truncate().text_size(11.5).text_color(t.dim).child(this.busy === r.id ? "resuming…" : gone ? "gone" : label(r.cwd)))
        .child(
          h_flex()
            .w(22)
            .flex_none()
            .justify_end()
            .text_size(11)
            .text_color(t.dim)
            .child(
              hovered
                ? div()
                    .id(`arch-x-${r.id}`)
                    .size(18)
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(4)
                    .hover((s) => s.bg(t.raised).text_color(t.foreground))
                    .on_click((_e, cx) => {
                      cx.stop_propagation();
                      forget(r.id);
                    })
                    .tooltip("Forget")
                    .child(svg(ICON("x")).size(11))
                : div().child(ago(r.at)),
            ),
        );
    };
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .child(
        h_flex()
          .h(FOLDED)
          .pt(14)
          .pb(5)
          .px(16)
          .gap(4)
          .flex_none()
          .items_center()
          .when(rail, (el) => el.px(0).justify_center().child(button("arch-search", "archive", search)))
          .when(!rail, (el) =>
            el
              .child(div().id("arch-title").flex_1().text_size(11.5).font_medium().text_color(t.dim).cursor_pointer().on_click(fold).child(list.length ? `Archived · ${list.length}` : "Archived"))
              .child(button("arch-search", "search", search))
              .child(button("arch-fold", folded ? "chevron-right" : "chevron-down", fold)),
          ),
      )
      .when(!rail && !folded, (el) =>
        el.child(
          v_flex()
            .id("arch-list")
            .flex_1()
            .min_h(0)
            .px(8)
            .pb(8)
            .overflow_y_scrollbar()
            .when(list.length === 0, (el) => el.child(div().px(4).text_size(12).text_color(t.dim).child("Nothing archived. Right-click a Claude pane to archive its session.")))
            .children(list.map(row))
            .when(Boolean(this.error), (el) => el.child(div().px(4).pt(4).text_size(12).text_color(t.blocked).child(this.error))),
        ),
      );
  }

  renderConfirm(t) {
    const p = props() ?? {};
    const list = this.targets;
    const space = p.space ? spaces().find((s) => s.id === p.space) : null;
    const working = (list ?? []).filter((s) => s.status === "working").length;
    const detail =
      list === undefined
        ? "…"
        : !list.length
          ? "No Claude session here."
          : space
            ? `Stops ${list.length === 1 ? "its Claude session" : `its ${list.length} Claude sessions`} and closes the space. Resume from Archived in the sidebar.`
            : "Stops Claude and closes its pane. Resume it from Archived in the sidebar.";
    return v_flex()
      .id("arch-confirm")
      .track_focus(this.handle)
      .on_key_down((e) => {
        if (e.key === "escape") this.hide();
        else if (e.key === "enter") this.confirm();
      })
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(div().font_semibold().text_color(t.foreground).child(space ? `Archive ${space.name}?` : "Archive session?"))
      .child(div().text_color(t.muted).child(detail))
      .children(
        (list ?? []).slice(0, 4).map((s) =>
          h_flex()
            .gap(8)
            .items_center()
            .child(svg(ICON("archive")).size(13).flex_none().text_color(t.dim))
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(s.title))
            .child(div().flex_none().text_size(11.5).text_color(t.dim).child(label(s.cwd))),
        ),
      )
      .when(working > 0, (el) => el.child(div().text_color(t.blocked).child(working === 1 ? "Claude is still working: its current turn will be cut off." : `${working} are still working: their current turns will be cut off.`)))
      .child(div().flex_1())
      .child(h_flex().justify_end().text_size(11).text_color(t.dim).child(list?.length ? "↵ archive · esc cancel" : "esc close"));
  }

  renderSearch(t) {
    const sections = this.sections();
    const items = this.items();
    this.at = Math.min(this.at, Math.max(0, items.length - 1));
    const selected = items[this.at];
    const row = (kind, s, i) => {
      const on = i === this.at;
      const icon =
        kind === "open"
          ? div().size(7).rounded(4).bg(t[s.status] ?? t.idle)
          : kind === "space"
            ? h_flex().size(14).rounded(4).bg(s.color.startsWith("#") ? s.color : (MARK[s.color] ?? t[s.color])).items_center().justify_center().text_size(8.5).font_bold().text_color("#ffffff").child([...s.title][0]?.toUpperCase() ?? "?")
            : svg(ICON(kind === "archived" ? "archive" : "clock")).size(13).text_color(t.dim);
      return h_flex()
        .id(`ss-${kind}-${s.id}`)
        .h(32)
        .flex_none()
        .px(10)
        .gap(9)
        .items_center()
        .rounded(7)
        .cursor_pointer()
        .when(on, (el) => el.bg(t.selected))
        .when(!on, (el) => el.hover((st) => st.bg(t.hover)))
        .on_click((e, cx) => this.go({ kind, s }, cx, e.modifiers.shift))
        .child(h_flex().w(14).flex_none().justify_center().child(icon))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(s.title))
        .child(div().flex_none().max_w(220).truncate().text_size(11.5).text_color(t.dim).child(this.busy === s.id ? "resuming…" : `${s.machine ? `${s.machine} · ` : ""}${label(s.cwd)}${this.gone[s.cwd] && kind !== "open" ? " · gone" : ""}`))
        .child(h_flex().flex_none().w(52).justify_end().text_size(11).text_color(t.dim).child(kind === "open" ? s.status : kind === "space" ? s.meta : ago(s.at)));
    };
    const children = [];
    this.childOf = [];
    let n = 0;
    for (const { name, kind, list, total, loading } of sections) {
      if (!list.length && !loading) continue;
      children.push(h_flex().h(26).px(10).pt(6).flex_none().items_center().text_size(11).text_color(t.dim).child(loading ? `${name} · loading…` : `${name} · ${total > list.length ? `${list.length} of ${total}` : list.length}`));
      for (const s of list) {
        this.childOf[n] = children.length;
        children.push(row(kind === "waiting" ? s.kind : kind, s, n++));
      }
    }
    const empty = items.length === 0 && !sections.some((s) => s.loading);
    const height = Math.min(LIST, empty ? 40 : sections.filter((s) => s.list.length || s.loading).length * 26 + items.length * 32);
    const resuming = selected && this.gone[selected.s.cwd] ? this.goneHint(selected.s, "↵", "⇧↵") : "↵ resume";
    const hint = this.busy ? "resuming…" : ({ open: "↵ go to · ⌘⇧A archive", space: "↵ go to", archived: `${resuming} · ^D forget`, history: resuming }[selected?.kind] ?? "");
    return v_flex()
      .id("sessions")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        const count = items.length;
        const ctrl = e.modifiers.control && !e.modifiers.platform && !e.modifiers.alt && !e.modifiers.shift;
        const down = e.key === "down" || (ctrl && (e.key === "j" || e.key === "n"));
        const up = e.key === "up" || (ctrl && (e.key === "k" || e.key === "p"));
        if (e.key === "escape") return this.hide();
        if (down && count) this.at = (this.at + 1) % count;
        else if (up && count) this.at = (this.at + count - 1) % count;
        else if (e.key === "d" && e.modifiers.control) this.dismiss(selected);
        else return;
        this.scroll.scroll_to_item(this.childOf[this.at] ?? 0);
        cx.stop_propagation();
        cx.notify();
      })
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Sessions"))
      .child(
        h_flex()
          .h(36)
          .flex_none()
          .px(10)
          .gap(8)
          .items_center()
          .rounded(9)
          .border_1()
          .border_color(t.accent)
          .bg(t.background)
          .child(svg(ICON("search")).size(15).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      )
      .child(
        v_flex()
          .id("ss-list")
          .h(height)
          .flex_none()
          .overflow_y_scrollbar()
          .track_scroll(this.scroll)
          .children(children)
          .when(empty, (el) => el.child(div().p(10).text_color(t.dim).child("No matching sessions."))),
      )
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(h_flex().justify_end().text_size(11).text_color(t.dim).child([hint, "esc close"].filter(Boolean).join(" · ")));
  }
}
