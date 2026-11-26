// Claude Code sessions: the session search (the overlay, mod.open; spaces in Waiting and
// their sessions in a section of their own; running ones on every machine by what they need
// and by their description, as the agents list has them; ended ones on every machine in
// History, ⌘↵ bringing one from another machine here) and the tasks list
// ({ tasks: true }, or one task's sessions with { url }, tasks.js), and moving a session to
// another machine ({ move: terminalAddress }, move.js), and starting a review in a space of its
// own ({ review: true, folder, machine }, review.js). The search also finds a session by its
// branches, PRs and issues (scan.mjs', and its links in shared("tasks.sessions")), and ⌃space
// previews one ({ peek }, peek.js). Commands running in a terminal (jj-spaces'
// shared("commands.running")) have a section after Working, and those that finished in a pane
// you haven't focused since (shared("commands.done")) one after Done, and the other terminals
// (no agent in them) one above Spaces; ↵ focuses the pane.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { agents, terminals, spaces, panes, machines, theme, shared, setShared, props, run, exec, hc, home, readTextFile, closeOverlay, openOverlay } from "herdr";
import { base, ago, worktree, label, place, missing, resume, bring, facts, script } from "./sessions.js";
import { taskInit, taskRender } from "./tasks.js";
import { moveInit, moveRender } from "./move.js";
import { reviewInit, reviewRender } from "./review.js";
import { peekInit, peekRender } from "./peek.js";

const LIST = 440;
const ICON = (name) => `mods/workspace-chrome/${name}.svg`;
// Running sessions by what they need, as the agents list's priority sections.
const URGENCY = [["blocked", "Needs you"], ["done", "Done"], ["working", "Working"], ["idle", "Idle"]];
// Space avatar colors, as the jj-spaces sidebar draws them.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

const claude = (a) => a.app === "claude-code" || a.program?.key === "claude";
const machineOf = (address) => (address.includes("/") ? address.split("/")[0] : null);

async function sessionOf(pid, on) {
  const text = on
    ? (await exec("sh", ["-c", 'cat "$HOME/.claude/sessions/$1.json" 2>/dev/null', "sh", String(pid)], { on }).catch(() => null))?.stdout
    : await readTextFile(`${home()}/.claude/sessions/${pid}.json`).catch(() => null);
  const s = JSON.parse(text || "null");
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

// The Claude sessions running on every machine: ~/.claude/sessions/<pid>.json there describes
// the terminal's foreground process, or its child when a shell launched it; else the
// terminal's claude.session and claude.cwd labels (the herdr-status mod's) do.
async function live() {
  const found = await Promise.all(
    agents()
      .filter(claude)
      .map(async (a) => {
        const on = machineOf(a.address);
        const labels = terminals().find((t) => t.address === a.address)?.labels ?? {};
        try {
          const pid = JSON.parse((await hc(["get", a.address, "--json"])).stdout).foreground?.pid;
          let s = pid ? await sessionOf(pid, on) : null;
          for (const kid of s || !pid ? [] : (await exec("pgrep", ["-P", String(pid)], { on })).stdout.split(/\s+/).filter(Boolean)) s ??= await sessionOf(kid, on);
          const id = s?.sessionId ?? labels["claude.session"];
          return id ? described({ address: a.address, pane: a.pane, tab: a.tab, space: a.space, machine: on, id, cwd: s?.cwd ?? labels["claude.cwd"] ?? "", raw: a.title || s?.name || "Claude", status: a.status, at: Math.floor((s?.updatedAt ?? s?.startedAt ?? 0) / 1000) }) : null;
        } catch {
          return null;
        }
      }),
  );
  return found.filter(Boolean);
}

// The ended sessions on machine `on` (null: this computer), scan.mjs run there.
async function history(on) {
  const r = await script("scan.mjs", [], on);
  return r.code === 0 ? JSON.parse(r.stdout).map((s) => ({ ...s, machine: on })) : [];
}

export default class Sessions extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.mode = p.peek ? "peek" : p.tasks ? "tasks" : p.move ? "move" : p.review ? "review" : "search";
    this.error = "";
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (this.mode === "peek") return peekInit(this, cx);
    if (this.mode === "tasks") return taskInit(this, cx);
    if (this.mode === "move") return moveInit(this, cx);
    if (this.mode === "review") return reviewInit(this, cx);
    this.initSearch(cx);
  }

  hide() {
    closeOverlay(props().overlay);
  }

  close() {
    // The search it was opened over takes the keyboard back.
    if (this.mode === "peek") setShared("preview.closed", Date.now());
    if (this.mode === "tasks" && !props()?.url && shared("tasks.open") === props()?.overlay) setShared("tasks.open", null);
    // The board it was opened over takes the keyboard back.
    if (this.mode === "tasks" && props()?.parent) setShared("board.focus", Date.now());
  }

  // Resumes a session where it ran, or (bringIt) one from another machine here, its folder
  // made again or (here) its repo used when it's gone.
  start(s, here, cx, done, bringIt = false) {
    if (this.busy) return;
    this.busy = s.id;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      this.error = await (bringIt && s.machine ? bring(s, here) : resume(s, here)).catch((e) => String(e?.message ?? e));
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

  goneOf(s) {
    return this.gone[`${s.machine ?? ""}\0${s.cwd}`];
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
    this.input.on("submit", (e, cx) => this.go(this.items()[this.at], cx, Boolean(e?.shift), Boolean(e?.secondary)));
    this.input.focus();
    this.previewed = shared("preview.closed");
    cx.timer.every(150, () => {
      if (shared("preview.closed") === this.previewed) return;
      this.previewed = shared("preview.closed");
      this.input.focus();
    });
    cx.spawn(async (cx) => {
      this.open = await live();
      cx.notify();
    });
    const where = [null, ...machines().filter((m) => m.name && m.layout !== "unavailable").map((m) => m.name)];
    this.history = [];
    this.scanning = where.length;
    for (const on of where) {
      cx.spawn(async (cx) => {
        const found = await history(on).catch(() => []);
        this.history = [...this.history, ...found];
        this.scanning--;
        cx.notify();
        const gone = await missing([...new Set(found.map((s) => s.cwd).filter(Boolean))], on).catch(() => new Set());
        for (const c of gone) this.gone[`${on ?? ""}\0${c}`] = true;
        cx.notify();
      });
    }
  }

  sections() {
    const f = this.text.trim().toLowerCase();
    const words = f.split(/\s+/).filter(Boolean);
    const items = shared("github")?.items ?? {};
    const tasks = shared("tasks.sessions") ?? {};
    // Every word is in one of its fields; a session also gets `hit`, the branch, PR or issue
    // that has a word its title and folder don't, shown beside its title.
    const look = (s, session = true) => {
      if (!words.length) return s;
      const plain = `${s.title} ${s.desc ?? ""} ${s.own ?? ""} ${s.where ?? ""} ${label(s.cwd)} ${s.cwd} ${s.machine ?? ""} ${s.prompt ?? ""}`.toLowerCase();
      const more = session ? facts(s, items, tasks) : [];
      const all = `${plain} ${more.map((m) => m.search).join(" ")}`;
      if (!words.every((w) => all.includes(w))) return null;
      const hit = more.find((m) => words.some((w) => !plain.includes(w) && m.search.includes(w)));
      return hit ? { ...s, hit } : s;
    };
    const pick = (list, session = true) => list.map((s) => look(s, session)).filter(Boolean);
    // The title's exact, word-start or inner match, then the folder's or a branch's, PR's or
    // issue's, then any other field's; ties most recently updated first.
    const score = (s) => {
      if (!f) return 0;
      const title = (s.title ?? "").toLowerCase();
      const i = title.indexOf(f);
      if (title === f) return 5;
      if (i === 0 || (i > 0 && !/[\p{L}\p{N}]/u.test(title[i - 1]))) return 4;
      if (i > 0 || words.every((w) => title.includes(w))) return 3;
      if (label(s.cwd).toLowerCase().includes(f) || s.hit) return 2;
      return 1;
    };
    const rank = (list) => list.map((s) => [score(s), s]).sort(([a, x], [b, y]) => b - a || (y.at ?? 0) - (x.at ?? 0)).map(([, s]) => s);
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
    // A session on more than one machine (moved) is the one there most recently updated.
    const newest = new Map();
    for (const s of this.history) if (!(newest.get(s.id)?.at >= s.at)) newest.set(s.id, s);
    const skip = new Set((this.open ?? []).map((s) => s.id));
    const past = rank(pick([...newest.values()].filter((s) => !skip.has(s.id))));
    // Spaces in Waiting (jj-spaces' shared("spaces.waiting")) and their open sessions
    // have a section of their own: each space, then its sessions. A running session's
    // branches, PRs and issues are what the scan found in its transcript so far.
    const parked = new Set(shared("spaces.waiting") ?? []);
    const open = (this.open ?? []).map((s) => {
      const seen = newest.get(s.id);
      return described(seen ? { ...s, branches: seen.branches, prs: seen.prs, refs: seen.refs } : s);
    });
    const waiting = all.filter((w) => parked.has(w.id)).flatMap((w) => {
      const mine = rank(pick(open.filter((s) => s.space === w.id))).map((s) => ({ ...s, kind: "open" }));
      return look(w, false) || mine.length ? [{ ...w, kind: "space" }, ...mine] : [];
    });
    const sp = spaces();
    const commands = (key) => (shared(key) ?? []).map((c) => ({
      id: c.pane,
      pane: c.pane,
      title: c.title,
      where: sp.find((w) => w.tabs.some((tab) => tab.id === c.tab))?.name ?? "",
      cwd: ps.find((p) => p.pane === c.pane)?.cwd ?? "",
      machine: machineOf(c.terminal),
      exit: c.exit ?? null,
      at: Math.floor((c.at ?? c.since) / 1000),
    }));
    const opened = this.open === undefined
      ? [{ name: "Open", kind: "open", list: [], loading: true }]
      : URGENCY.map(([status, name]) => ({
          name,
          kind: "open",
          list: rank(pick(open.filter((s) => !parked.has(s.space) && (URGENCY.some(([u]) => u === s.status) ? s.status : "idle") === status))),
          loading: false,
        }));
    const listed = new Set([...(shared("commands.running") ?? []), ...(shared("commands.done") ?? [])].map((c) => c.pane));
    const spaceOf = new Map(sp.flatMap((w) => w.tabs.map((tab) => [tab.id, w])));
    const idle = ps
      .filter((p) => p.terminal && !p.status && !p.program?.agent && !listed.has(p.pane) && spaceOf.has(p.tab))
      .map((p) => ({ id: p.pane, pane: p.pane, title: p.name ?? p.title ?? p.program?.name ?? "Terminal", where: spaceOf.get(p.tab).name, cwd: p.cwd ?? "", machine: machineOf(p.terminal), program: p.program, at: 0 }));
    const finished = { name: "Finished commands", kind: "command", list: rank(pick(commands("commands.done"), false)), loading: false };
    const busy = { name: "Running commands", kind: "running", list: rank(pick(commands("commands.running"), false)), loading: false };
    if (this.open === undefined) opened.splice(1, 0, finished, busy);
    else {
      opened.splice(2, 0, finished);
      opened.splice(4, 0, busy);
    }
    return [
      ...opened,
      { name: "Idle terminals", kind: "terminal", list: rank(pick(idle, false)), loading: false },
      { name: "Spaces", kind: "space", list: rank(pick(all.filter((w) => !parked.has(w.id)), false)), loading: false },
      { name: "Waiting", kind: "waiting", list: waiting, loading: false },
      { name: "History", kind: "history", list: past.slice(0, 100), total: past.length, loading: this.scanning > 0 },
    ];
  }

  items() {
    return this.sections().flatMap(({ kind, list }) => list.map((s) => ({ kind: kind === "waiting" ? s.kind : kind, s })));
  }

  go(it, cx, here = false, bringIt = false) {
    if (!it) return;
    if (["open", "space", "command", "running", "terminal"].includes(it.kind)) {
      this.hide();
      return it.kind === "space" ? run("space.select", { id: it.s.id }) : run("pane.focus", { pane: it.s.pane });
    }
    this.start(it.s, here, cx, () => this.hide(), bringIt);
  }

  // ⌃space: Quick Look at a running or ended session, over this search.
  peek(it) {
    if (it?.kind !== "open" && it?.kind !== "history") return;
    const { id, machine, cwd, title, own, at, pane, status, branches, prs, refs } = it.s;
    const peek = { kind: it.kind, id, machine, cwd, title, own, at, pane, status, branches, prs, refs, gone: Boolean(this.goneOf(it.s)) };
    openOverlay({ mod: "jj-sessions", kind: "dialog", width: 0.72, height: 0.88, props: { peek, query: this.text.trim(), parent: props()?.overlay } });
  }

  render() {
    const t = theme();
    if (this.mode === "peek") return peekRender(this, t);
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
      const tone = kind === "command" ? (s.exit === null ? t.done : s.exit === 0 ? t.ansi2 : t.blocked) : null;
      const icon =
        kind === "open"
          ? div().size(7).rounded(4).bg(t[s.status] ?? t.idle)
          : kind === "command"
            ? h_flex().size(14).rounded(4).bg(tone + "2e").items_center().justify_center().child(svg(ICON("terminal")).size(8).text_color(tone))
          : kind === "terminal"
            ? s.program?.icon ? (s.program.tint ? svg(s.program.icon).size(12).text_color(t.muted) : image(s.program.icon).size(12)) : svg(ICON("terminal")).size(12).text_color(t.dim)
          : kind === "running"
            ? h_flex().relative().size(14).items_center().justify_center().child(svg(ICON("terminal")).size(8).text_color(t.ansi6))
                .child(div().absolute().top(0).left(0).size(14).child(svg(ICON("spinner")).size(14).text_color(t.ansi6).spin(900)))
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
        .on_click((e, cx) => this.go({ kind, s }, cx, e.modifiers.shift, e.modifiers.platform))
        .child(h_flex().w(14).flex_none().justify_center().child(icon))
        .child(h_flex().flex_1().min_w(0).gap(6).items_center()
          .child(div().min_w(0).truncate().text_color(t.foreground).child(s.title))
          .when(kind === "open" && Boolean(s.desc && s.own && s.own !== s.desc), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(s.own)))
          .when(["command", "running", "terminal"].includes(kind) && Boolean(s.where), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(s.where)))
          .when(Boolean(s.hit), (el) => el.child(h_flex().flex_1().min_w(0).gap(4).items_center().text_size(11.5).text_color(t.dim).child(svg(s.hit?.icon ?? "").flex_none().size(11).text_color(t.dim)).child(div().min_w(0).truncate().child(s.hit?.text ?? "")))))
        .child(div().flex_none().max_w(220).truncate().text_size(11.5).text_color(t.dim).child(this.busy === s.id ? "resuming…" : `${s.machine ? `${s.machine} · ` : ""}${label(s.cwd)}${this.goneOf(s) && kind !== "open" ? " · gone" : ""}`))
        .child(h_flex().flex_none().w(52).justify_end().text_size(11).text_color(t.dim).child(kind === "open" ? s.status : kind === "space" ? s.meta : kind === "terminal" ? s.program?.name ?? "" : kind === "command" && s.exit ? `exit ${s.exit}` : ago(s.at)));
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
    const past = selected?.s;
    const resuming = past && [this.goneOf(past) ? this.goneHint(past, "↵", "⇧↵") : `↵ resume${past.machine ? ` on ${past.machine}` : ""}`, past.machine && "⌘↵ bring here"].filter(Boolean).join(" · ");
    const hint = this.busy ? "resuming…" : [{ open: "↵ go to", space: "↵ go to", command: "↵ go to", running: "↵ go to", terminal: "↵ go to", history: resuming }[selected?.kind], (selected?.kind === "open" || selected?.kind === "history") && "⌃space preview"].filter(Boolean).join(" · ");
    return v_flex()
      .id("sessions")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        const count = items.length;
        const ctrl = e.modifiers.control && !e.modifiers.platform && !e.modifiers.alt && !e.modifiers.shift;
        const down = e.key === "down" || (ctrl && (e.key === "j" || e.key === "n"));
        const up = e.key === "up" || (ctrl && (e.key === "k" || e.key === "p"));
        if (e.key === "escape") return this.hide();
        if (ctrl && e.key === "space") {
          this.peek(selected);
          return cx.stop_propagation();
        }
        const page = ctrl && (e.key === "d" || e.key === "u") ? Math.max(1, Math.floor(height / 2 / 32)) * (e.key === "d" ? 1 : -1) : 0;
        if (down && count) this.at = (this.at + 1) % count;
        else if (up && count) this.at = (this.at + count - 1) % count;
        else if (page && count) this.at = Math.max(0, Math.min(count - 1, this.at + page));
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
