// Agents in grouped or priority views; parents take their most urgent sub-agent's place.

import { View, div, image, svg, PathBuilder } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, exec, hc, home, readTextFile, settings } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((l?.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

const circle = (b, r) => b.move_to("50%", `${50 - r}%`).arc_to(`${r}%`, `${r}%`, 0, false, true, "50%", `${50 + r}%`).arc_to(`${r}%`, `${r}%`, 0, false, true, "50%", `${50 - r}%`);

// herdr's window() shadows the global window, whose paint_path draws.
function pie(fraction, size, fill, track) {
  const f = Math.max(0, Math.min(1, fraction));
  const r = 32;
  const at = (v) => `${(50 + v * r).toFixed(3)}%`;
  const a = f * 2 * Math.PI;
  const wedge =
    f >= 0.999
      ? circle(PathBuilder.fill(), r).close().build()
      : PathBuilder.fill().move_to("50%", "50%").line_to("50%", `${50 - r}%`).arc_to(`${r}%`, `${r}%`, 0, f > 0.5, true, at(Math.sin(a)), at(-Math.cos(a))).close().build();
  return div()
    .relative()
    .size(size)
    .flex_none()
    .child(globalThis.window.paint_path(circle(PathBuilder.stroke(1.2), 46).build(), track).absolute().inset_0())
    .when(f > 0, (el) => el.child(globalThis.window.paint_path(wedge, fill).absolute().inset_0()));
}

const tokens = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`);

// Context breakdown colors, handed out in the report's order; Messages, usually the most, stays neutral.
const PALETTE = ["ansi4", "ansi5", "ansi6", "ansi2", "ansi3", "ansi1", "ansi12", "ansi14", "ansi11", "ansi13"];

// Claude's `/context` report: the totals line and its "Estimated usage by category" table.
function parseContext(md) {
  const num = (v) => {
    const m = String(v).trim().toLowerCase().match(/^([\d.]+)\s*([km]?)$/);
    return m ? Number(m[1]) * (m[2] === "m" ? 1e6 : m[2] === "k" ? 1e3 : 1) : 0;
  };
  const total = md.match(/\*\*Tokens:\*\*\s*([\d.]+[km]?)\s*\/\s*([\d.]+[km]?)/i);
  const rows = [];
  let table = false;
  for (const line of (md.split("### Estimated usage by category")[1] ?? "").split("\n")) {
    if (!line.startsWith("|")) {
      if (table) break;
      continue;
    }
    table = true;
    const [name, count, pct] = line.split("|").slice(1, -1).map((c) => c.trim());
    if (name === "Category" || /^-+$/.test(name)) continue;
    rows.push({ name, tokens: num(count), pct: parseFloat(pct) || 0 });
  }
  return { used: total ? num(total[1]) : null, size: total ? num(total[2]) : null, rows };
}

// A terminal's Claude session from ~/.claude/sessions/<pid>.json: its
// foreground process's, or a child's when a shell launched it.
async function sessionOf(address) {
  try {
    const pid = JSON.parse((await hc(["get", address, "--json"])).stdout).foreground?.pid;
    const kids = pid ? (await exec("pgrep", ["-P", String(pid)])).stdout.split(/\s+/).filter(Boolean) : [];
    for (const p of pid ? [pid, ...kids] : []) {
      const s = JSON.parse((await readTextFile(`${home()}/.claude/sessions/${p}.json`).catch(() => null)) ?? "null");
      if (s?.sessionId) return { sid: s.sessionId, cwd: s.cwd };
    }
  } catch {}
  return null;
}

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// The PRs an agent's Claude session opened, as jj-spaces finds them (shared("github")),
// drawn as jj-spaces/github.js draws them: GitHub's colors, [light, dark].
const GREEN = ["#1a7f37", "#3fb950"], PURPLE = ["#8250df", "#a371f7"], GRAY = ["#59636e", "#9198a1"];
const GH = {
  open: { icon: "mods/jj-spaces/git-pull-request.svg", color: GREEN, label: "Open" },
  draft: { icon: "mods/jj-spaces/git-pull-request-draft.svg", color: GRAY, label: "Draft" },
  queued: { icon: "mods/jj-spaces/git-pull-request.svg", color: ["#9a6700", "#d29922"], label: "Merge queued" },
  merged: { icon: "mods/jj-spaces/git-merge.svg", color: PURPLE, label: "Merged" },
  closed: { icon: "mods/jj-spaces/git-pull-request-closed.svg", color: ["#cf222e", "#f85149"], label: "Closed" },
};

function prBadges(urls, items, t, id, max) {
  const dark = Boolean(settings()?.dark);
  const badge = (url) => {
    const it = items[url];
    const s = GH[it?.state];
    const number = it?.number ?? url.match(/\/(\d+)\/?$/)?.[1] ?? "?";
    return h_flex()
      .id(`${id}-${url}`)
      .flex_none()
      .gap(2)
      .items_center()
      .text_size(11)
      .text_color(s ? s.color[dark ? 1 : 0] : t.dim)
      .cursor_pointer()
      .tooltip([`${it?.repo ?? ""}#${number}`, s?.label, it?.title].filter(Boolean).join(" · "))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        cx.spawn(async () => { await exec("open", [url]).catch(() => null); });
      })
      .child(div().flex_none().child(svg(s?.icon ?? GH.open.icon).size(11)))
      .child(String(number));
  };
  const rest = urls.length - max;
  return h_flex()
    .flex_none()
    .gap(6)
    .items_center()
    .children(urls.slice(0, max).map(badge))
    .when(rest > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`+${rest}`)));
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    this.folded = new Set();
    this.breakdown = new Map(); // address -> { key, loading, data, error }: its last /context
    this.ctxOpen = null; // the agent whose context breakdown shows
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    cx.timer.every(30000, (cx) => cx.notify());
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  rank(a) {
    return RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => (this.listed.has(k.address) ? run("pane.focus", { terminal: k.address }) : this.peek(k.address)))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  // Runs Claude's own /context on a throwaway, unsaved fork of the session.
  measure(a, mine, machine, cx) {
    const key = `${mine["claude.session"] ?? ""} ${mine["claude.context"] ?? ""}`;
    const prev = this.breakdown.get(a.address);
    if (prev?.loading || (prev?.key === key && prev.data)) return;
    this.breakdown.set(a.address, { ...prev, key, loading: true, error: "" });
    cx.spawn(async (cx) => {
      let sid = mine["claude.session"], cwd = mine["claude.cwd"];
      if (!sid && !machine) ({ sid, cwd } = (await sessionOf(a.address)) ?? {});
      let data = prev?.data ?? null, error = "";
      if (!sid || !cwd) error = "its session isn't known yet";
      else {
        try {
          const r = await exec("claude", ["-p", "--resume", sid, "--fork-session", "--no-session-persistence", "/context"], { cwd, on: machine, timeout: 120000 });
          const parsed = r.code === 0 ? parseContext(r.stdout) : null;
          if (parsed?.rows.length) data = parsed;
          else error = (r.stderr || r.stdout || "").trim().split("\n")[0] || "no breakdown";
        } catch (e) {
          error = String(e);
        }
      }
      this.breakdown.set(a.address, { key, loading: false, data, error });
      cx.notify();
    });
  }

  contextPanel(t, a, context, size) {
    const b = this.breakdown.get(a.address);
    const d = b?.data;
    const rows = d?.rows ?? [];
    const used = rows.filter((r) => !/deferred/i.test(r.name) && !/buffer/i.test(r.name) && r.name !== "Free space" && r.tokens > 0);
    const free = rows.find((r) => r.name === "Free space");
    const buffer = rows.find((r) => /buffer/i.test(r.name));
    const deferred = rows.filter((r) => /deferred/i.test(r.name) && r.tokens > 0);
    const shades = used.filter((r) => r.name !== "Messages").map((r) => r.name);
    const color = (name) => (name === "Messages" ? t.muted : t[PALETTE[shades.indexOf(name) % PALETTE.length]] ?? t.muted);
    const swatch = (bg, border) => div().size(8).flex_none().rounded(2).bg(bg).when(Boolean(border), (el) => el.border_1().border_color(border));
    const entry = (dot, name, count, pct, quiet) =>
      h_flex()
        .gap(7)
        .items_center()
        .child(dot)
        .child(div().flex_1().min_w(0).truncate().text_color(quiet ? t.dim : t.foreground).child(name))
        .child(div().flex_none().text_color(t.dim).child(tokens(count)))
        .child(h_flex().w(42).flex_none().justify_end().text_color(t.dim).child(`${pct.toFixed(1)}%`));
    const summary = d?.used != null ? `${tokens(d.used)} / ${tokens(d.size)} \u00b7 ${Math.round(context)}%` : `${Math.round(context)}% of ${size ? tokens(size) : "the window"}`;
    return v_flex()
      .mx(4)
      .mt(2)
      .mb(8)
      .p(10)
      .gap(5)
      .rounded(8)
      .bg(t.raised)
      .border_1()
      .border_color(t.border)
      .text_size(11.5)
      .child(h_flex().justify_between().items_center().child(div().font_medium().text_color(t.foreground).child("Context")).child(div().text_color(t.dim).child(summary)))
      .child(
        h_flex()
          .w_full()
          .h(8)
          .mb(3)
          .rounded(4)
          .overflow_hidden()
          .bg(t.hover)
          .children(used.map((r) => div().h_full().flex_none().w(`${Math.max(r.pct, 0.6)}%`).bg(color(r.name))))
          .child(div().h_full().flex_1())
          .when(Boolean(buffer), (el) => el.child(div().h_full().flex_none().w(`${buffer.pct}%`).bg(t.dim))),
      )
      .when(!d, (el) => el.child(div().text_color(t.dim).child(b?.error ? `Couldn't measure: ${b.error}` : "Measuring\u2026")))
      .children(used.map((r) => entry(swatch(color(r.name)), r.name, r.tokens, r.pct)))
      .when(Boolean(free), (el) => el.child(entry(swatch(t.hover, t.dim), free.name, free.tokens, free.pct, true)))
      .when(Boolean(buffer), (el) => el.child(entry(swatch(t.dim), buffer.name, buffer.tokens, buffer.pct, true)))
      .when(deferred.length > 0, (el) => el.child(div().text_size(10.5).text_color(t.dim).child(`Not loaded: ${deferred.map((r) => `${r.name.replace(/ \(deferred\)/i, "")} ${tokens(r.tokens)}`).join(" \u00b7 ")}`)))
      .when(Boolean(d && b?.loading), (el) => el.child(div().text_size(10.5).text_color(t.dim).child("Updating\u2026")))
      .when(Boolean(d && b?.error), (el) => el.child(div().text_size(10.5).text_color(t.blocked).child(`Couldn't update: ${b.error}`)));
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    const termLabels = new Map(all.map((x) => [x.address, x.labels ?? {}]));
    const gh = shared("github") ?? {};
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    // A kept sub-agent (one with a pane) is in agents() too: where a tree shows
    // it, it gets no row of its own, unless it's pinned.
    const nested = new Set(collapsed ? [] : list.flatMap((a) => this.tree(all, a.address).map((s) => s.t.address)));
    list = list.filter((a) => a.pinned || !nested.has(a.address));
    const tabCounts = new Map();
    for (const a of list) tabCounts.set(a.tab, (tabCounts.get(a.tab) ?? 0) + 1);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    // Read the pane snapshot once: every host read copies the whole list into JS.
    const leads = leadPanes(panes());
    const tabs = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, tab]));
    const labels = new Map(list.map(a => {
      const tab = tabs.get(a.tab);
      const many = tabCounts.get(a.tab) > 1;
      return [a.address, tab ? title(many ? { ...tab, named: false } : tab, many ? a : leads.get(a.tab)) : (a.title || a.program?.name || "")];
    }));
    const label = (a) => labels.get(a.address);
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    const row = (a, i, subs = []) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const mine = termLabels.get(a.address) ?? {};
      const context = mine["claude.context"] !== undefined && mine["claude.context"] !== "" && !Number.isNaN(Number(mine["claude.context"])) ? Number(mine["claude.context"]) : null;
      const size = Number(mine["claude.context_size"]) || 0;
      const off = shared("github.hidden")?.[a.space] ?? [];
      const prs = (gh.agents?.[a.address] ?? []).filter((u) => !off.includes(u));
      const isPinned = a.pinned;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || isPinned;
      const name = full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      const line = h_flex()
        .id(`ag-${a.address}`)
        .px(8)
        .h(30)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(9)
        .when(a.focused, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(h_flex().flex_1().min_w(0).gap(5).items_center()
          .child(div().min_w(0).max_w(full && more ? 120 : 200).truncate().text_color(idle ? t.muted : t.foreground).child(name))
          .when(full && Boolean(more), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${more}`))))
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address, el => el.child(pin))
        .when(prs.length > 0, el => el.child(prBadges(prs, gh.items ?? {}, t, `gh-${a.address}`, 2)))
        .when(context !== null, el => el.child(div().id(`ctx-${a.address}`).flex_none()
          .on_hover((on, cx) => {
            if (!on) return;
            this.ctxOpen = a.address;
            this.measure(a, mine, machine, cx);
            cx.notify();
          })
          .child(pie(context / 100, 12, context >= 80 ? t.blocked : context >= 60 ? t.ansi3 : t.muted, t.dim))))
        .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, a, byPriority && !isPinned));
      return v_flex()
        .id(`ag-wrap-${a.address}`)
        .flex_none()
        .on_hover((on, cx) => {
          if (on || this.ctxOpen !== a.address) return;
          this.ctxOpen = null;
          cx.notify();
        })
        .child(line)
        .when(this.ctxOpen === a.address && context !== null, el => {
          this.measure(a, mine, machine, cx);
          return el.child(this.contextPanel(t, a, context, size));
        });
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    const rows = collapsed
      ? list.flatMap(withKids)
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))]);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "jj-agents", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
                .tooltip(`Sort agents: ${sort.label}`)
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
