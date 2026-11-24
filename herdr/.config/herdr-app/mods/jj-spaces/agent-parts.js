// What the agents list and the spaces sidebar's tree (jj-spaces, its Agents pref "tree")
// both draw an agent with. jj-spaces/agent-parts.js is a copy: Herdr loads no module from
// outside a mod's folder, symlinked or not. Change this one, then copy it there.

import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { openOverlay, run, shared, setShared } from "herdr";

export const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

// The terminal's title when it says more than the program, a path or user@host.
export function telling(l) {
  const live = clean(l?.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((l?.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  return live && live !== l?.program?.name && !path && !live.includes("@") && live.toLowerCase() !== l?.program?.key ? live : null;
}

export const DESC = "jj.description";
export const MODE = "jj.description.mode";
// jj-spacing's Sidebar tab keeps what differs from these.
export const PREF_DEFAULTS = { icon: "shown", description: "title", line: "space", machine: "name" };
export const pref = (key) => shared("jj-agents")?.[key] ?? PREF_DEFAULTS[key];

// The Machine pref's "icon": a server for an agent on another machine, a monitor for this one's.
export const machineIcon = (t, address) => {
  const machine = address.includes("/") ? address.split("/")[0] : null;
  return h_flex().id(`machine-${address}`).h(20).flex_none().items_center().text_color(t.dim).tooltip(machine ?? "This machine")
    .child(svg(`mods/workspace-chrome/${machine ? "server" : "monitor"}.svg`).size(12));
};

export const modeOf = (labels) => (labels?.[DESC]?.trim() ? "custom" : (labels?.[MODE] || pref("description")) === "off" ? "off" : "title");

export function describe(a, labels) {
  const mode = modeOf(labels);
  return mode === "custom" ? labels[DESC].trim() : mode === "title" ? telling(a) : null;
}

export const describeDialog = (address) => openOverlay({ mod: "jj-agents", kind: "dialog", width: 420, height: 164, props: { describe: address } });

export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
export const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};

// An agent's right-click menu (jj-menu): pin, description, link, Waiting. A popup is as tall as its items.
export const menu = (a) => openOverlay({ mod: "jj-menu", kind: "popup", width: 220, height: 228, props: { tab: "agent", target: { terminal: a.address } } });

export function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
export function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
export function subTree(all, addr, lead = []) {
  const kids = all.filter((k) => k.parent === addr && k.state === "live");
  return kids.flatMap((k, i) => {
    const last = i === kids.length - 1;
    return [
      { t: k, lines: [...lead, last ? "└" : "├"] },
      ...subTree(all, k.address, [...lead, last ? "" : "│"]),
    ];
  });
}

// "├", "└", "│" or "" per level, drawn as rounded elbows in a row `height` tall; "├" and
// "│" run on to the row below.
export const treeLines = (t, lines, height = 26) => lines.map((l) => {
  const line = (el) => el.border_l(1.5).border_color(t.input);
  const elbow = line(div().h(height / 2 + 4)).border_b(1.5).rounded_bl(6);
  const box = v_flex().self_start().mt(-4).w(9).mr(4).flex_none();
  if (l === "└") return box.child(elbow);
  if (l === "├") return box.child(elbow).child(line(div().h(height / 2)));
  if (l === "│") return box.child(line(div().h(height + 4)));
  return box.h(height / 2 + 4);
});

// A sub-agent's row: tree lines `pl` in, its icon, name and state. One with a pane is
// focused, one without peeked at.
export function subRow(t, s, { shown, compact, listed, pl }) {
  const k = s.t;
  const pic = pref("icon") === "hidden" ? null : icon(k.program, 14, t.foreground);
  const on = k.address === shown;
  return h_flex()
    .id(`sub-${k.address}`)
    .pl(pl)
    .pr(8)
    .rounded(8)
    .h(26)
    .flex_none()
    .gap(0)
    .items_center()
    .text_size(12.5)
    .when(on, (el) => el.bg(t.raised))
    .hover((s) => s.bg(t.hover))
    .on_click(() => (listed.has(k.address) ? run("pane.focus", { terminal: k.address }) : run("terminal.peek", { terminal: k.address })))
    .children(treeLines(t, s.lines))
    .when(Boolean(pic), (el) => el.child(div().mr(8).child(pic)))
    .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
    .child(statusMark(t, { status: kidStatus(k, listed) }, compact));
}

// What a Claude agent runs now, as claude/.claude/hooks/herdr-activity.sh in dots labels
// its terminal: subagents and shells, in the working color while it works.
export function activity(t, a, labels) {
  const subagents = Number(labels?.["claude.subagents"]) || 0;
  const shells = Number(labels?.["claude.shells"]) || 0;
  if (!subagents && !shells) return null;
  const color = a.status === "working" ? t.working : t.dim;
  const item = (kind, icon, n, what) => h_flex().id(`act-${kind}-${a.address}`).flex_none().gap(2).items_center().text_size(11).text_color(color)
    .tooltip(`${n} ${what}${n === 1 ? "" : "s"} running`)
    .child(svg(icon).size(12))
    .when(n > 1, (el) => el.child(String(n)));
  return h_flex().flex_none().gap(6).items_center()
    .when(subagents > 0, (el) => el.child(item("sub", "mods/jj-agents/bot.svg", subagents, "subagent")))
    .when(shells > 0, (el) => el.child(item("sh", "mods/workspace-chrome/terminal.svg", shells, "shell")));
}

// compact: a ! for blocked where a header already says "Needs you".
export function statusMark(t, a, compact = false) {
  const color = t[a.status] ?? t.dim;
  if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
  if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
  if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
  // Idle: a ring; done: a dot.
  if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
}

// Each agent's last state and when it changed (ms), in shared("agents.changed"), stamped
// by whichever view draws first. Done and idle count as one: looking at a finished agent
// turns done into idle, and looking isn't the agent doing anything.
export function trackChanges(list, now) {
  const was = shared("agents.changed") ?? {};
  let next = null;
  for (const a of list) {
    const s = a.status === "done" ? "idle" : a.status;
    if (was[a.address]?.s === s) continue;
    next ??= { ...was };
    next[a.address] = { s, at: now };
  }
  if (!next) return;
  // Gone and old: the list alone is empty right after a start.
  const listed = new Set(list.map((a) => a.address));
  for (const [k, c] of Object.entries(next)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete next[k];
  setShared("agents.changed", next);
}

export const since = (a) => shared("agents.changed")?.[a.address]?.at ?? 0;
