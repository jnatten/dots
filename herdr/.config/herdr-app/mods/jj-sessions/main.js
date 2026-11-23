// Claude Code sessions: the session search (the overlay, mod.open; spaces in Waiting and
// their sessions in a section of their own; running ones by what they need and by their
// description, as the agents list has them; ended ones in History) and the tasks list
// ({ tasks: true }, or one task's sessions with { url }, tasks.js), and moving a session to
// another machine ({ move: terminalAddress }, move.js), and starting a review in a space of its
// own ({ review: true, folder, machine }, review.js).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { agents, terminals, spaces, panes, theme, shared, setShared, props, run, exec, hc, home, appHome, readTextFile, closeOverlay } from "herdr";
import { base, ago, worktree, label, place, missing, resume } from "./sessions.js";
import { taskInit, taskRender } from "./tasks.js";
import { moveInit, moveRender } from "./move.js";
import { reviewInit, reviewRender } from "./review.js";

const LIST = 440;
const ICON = (name) => `mods/workspace-chrome/${name}.svg`;
// Running sessions by what they need, as the agents list's priority sections.
const URGENCY = [["blocked", "Needs you"], ["done", "Done"], ["working", "Working"], ["idle", "Idle"]];
// Space avatar colors, as the jj-spaces sidebar draws them.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

const claude = (a) => !a.address.includes("/") && (a.app === "claude-code" || a.program?.key === "claude");

async function sessionOf(pid) {
  const s = JSON.parse((await readTextFile(`${home()}/.claude/sessions/${pid}.json`).catch(() => null)) ?? "null");
  return s?.sessionId ? s : null;
}

// A running session as the agents list (jj-agents) leads its row: the words given in its
// Description dialog (ctrl-a d, desc), else the agent's own title (own: Claude's /rename or
// AI title), else what the terminal or the session calls itself (raw).
function described(s) {
  const a = agents().find((a) => a.address === s.address);
  const text = a?.title ?? "";
  const live = text.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  const path = /^[~/]/.test(text.replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const own = live && live !== a?.program?.name && !path && !live.includes("@") && live.toLowerCase() !== a?.program?.key ? live : null;
  const desc = terminals().find((t) => t.address === s.address)?.labels?.["jj.description"]?.trim() || null;
  return { ...s, desc, own, title: desc || own || s.raw, status: a?.status ?? s.status };
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
          return s ? described({ address: a.address, pane: a.pane, tab: a.tab, space: a.space, id: s.sessionId, cwd: s.cwd, raw: a.title || s.name || "Claude", status: a.status }) : null;
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

export default class Sessions extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.mode = p.tasks ? "tasks" : p.move ? "move" : p.review ? "review" : "search";
    this.error = "";
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (this.mode === "tasks") return taskInit(this, cx);
    if (this.mode === "move") return moveInit(this, cx);
    if (this.mode === "review") return reviewInit(this, cx);
    this.initSearch(cx);
  }

  hide() {
    closeOverlay(props().overlay);
  }

  close() {
    if (this.mode === "tasks" && !props()?.url && shared("tasks.open") === props()?.overlay) setShared("tasks.open", null);
    // The board it was opened over takes the keyboard back.
    if (this.mode === "tasks" && props()?.parent) setShared("board.focus", Date.now());
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

  initSearch(cx) {
    this.text = "";
    this.at = 0;
    this.open = undefined;
    this.history = undefined;
    this.gone = {};
    this.childOf = [];
    this.scroll = ScrollHandle.new();
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
      const gone = await missing([...new Set(this.history.map((s) => s.cwd).filter(Boolean))]).catch(() => new Set());
      this.gone = Object.fromEntries([...gone].map((c) => [c, true]));
      cx.notify();
    });
  }

  sections() {
    const f = this.text.trim().toLowerCase();
    const match = (s) => !f || `${s.title} ${s.desc ?? ""} ${s.own ?? ""} ${label(s.cwd)} ${s.cwd} ${s.machine ?? ""} ${s.prompt ?? ""}`.toLowerCase().includes(f);
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
    const skip = new Set((this.open ?? []).map((s) => s.id));
    const past = (this.history ?? []).filter((s) => !skip.has(s.id) && match(s));
    // Spaces in Waiting (jj-spaces' shared("spaces.waiting")) and their open sessions
    // have a section of their own: each space, then its sessions.
    const parked = new Set(shared("spaces.waiting") ?? []);
    const open = (this.open ?? []).map(described);
    const waiting = all.filter((w) => parked.has(w.id)).flatMap((w) => {
      const mine = open.filter((s) => s.space === w.id && match(s)).map((s) => ({ ...s, kind: "open" }));
      return match(w) || mine.length ? [{ ...w, kind: "space" }, ...mine] : [];
    });
    return [
      ...(this.open === undefined
        ? [{ name: "Open", kind: "open", list: [], loading: true }]
        : URGENCY.map(([status, name]) => ({
            name,
            kind: "open",
            list: open.filter((s) => !parked.has(s.space) && match(s) && (URGENCY.some(([u]) => u === s.status) ? s.status : "idle") === status),
            loading: false,
          }))),
      { name: "Spaces", kind: "space", list: all.filter((w) => !parked.has(w.id) && match(w)), loading: false },
      { name: "Waiting", kind: "waiting", list: waiting, loading: false },
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

  render() {
    const t = theme();
    if (this.mode === "tasks") return taskRender(this, t);
    if (this.mode === "move") return moveRender(this, t);
    if (this.mode === "review") return reviewRender(this, t);
    return this.renderSearch(t);
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
            : svg(ICON("clock")).size(13).text_color(t.dim);
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
        .child(h_flex().flex_1().min_w(0).gap(6).items_center()
          .child(div().min_w(0).truncate().text_color(t.foreground).child(s.title))
          .when(kind === "open" && Boolean(s.desc && s.own && s.own !== s.desc), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(s.own))))
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
    const hint = this.busy ? "resuming…" : ({ open: "↵ go to", space: "↵ go to", history: resuming }[selected?.kind] ?? "");
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
