// The spaces sidebar as a tree (its Agents pref "tree", from the spacing dialog's Sidebar
// tab): each space's agents under it, and their sub-agents under them. The agents list's
// block (jj-agents) is hidden meanwhile, except on the rail, and the agent order next/prev
// go by is this tree's. Drawn with jj-agents' own pieces (agent-parts.js, a copy of its parts.js).
// Its Tabs pref puts a space's agents and terminals under a header per tab: always, or when
// they're in more than one ("several").

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, spaces, focused, run, setAgentOrder, shared, setShared } from "herdr";
import { activity, clean, describe, duration, icon, machineIcon, menu, pref as agentPref, since, statusMark, subRow, subTree, telling, trackChanges, treeLines } from "./agent-parts.js";
import { terminalRows } from "./commands.js";

// What every space's agents are drawn from, read once per render.
export function treeContext() {
  const list = agents();
  const all = terminals();
  const now = Date.now();
  trackChanges(list, now);
  // A kept sub-agent (one with a pane) is in agents() too: it goes under its parent, unless pinned.
  const nested = new Set(list.flatMap((a) => subTree(all, a.address).map((s) => s.t.address)));
  const by = new Map();
  for (const a of [...list].sort((x, y) => x.seq - y.seq)) {
    if (!a.pinned && nested.has(a.address)) continue;
    if (!by.has(a.space)) by.set(a.space, []);
    by.get(a.space).push(a);
  }
  return {
    by,
    all,
    now,
    listed: new Map(list.map((a) => [a.address, a.status])),
    terms: new Map(all.map((k) => [k.address, k])),
    tabs: new Map(spaces().flatMap((s) => s.tabs).map((tab) => [tab.id, tab])),
    shown: focused()?.agent,
    order: [],
  };
}

// The agent order (agent.next/prev, jj-tabs) as the tree shows it.
export function publishOrder(ctx) {
  setAgentOrder(ctx.order);
  if (JSON.stringify(ctx.order) !== JSON.stringify(shared("agents.order") ?? [])) setShared("agents.order", ctx.order);
}

// What goes under a space: its agents (in the tree, `ctx`), then its terminals (`terms`, from
// terminalList), under a header per tab when `tabs` is "always", or "several" and they're in more than one.
export function spaceRows(view, w, t, ctx, terms, now, tabs) {
  const members = ctx?.by.get(w.id) ?? [];
  const groups = (w.tabs ?? [])
    .map((tab) => ({ tab, agents: members.filter((a) => a.tab === tab.id), terms: terms.filter((x) => x.p.tab === tab.id) }))
    .filter((g) => g.agents.length || g.terms.length);
  if (!(tabs === "always" ? groups.length : tabs === "several" && groups.length > 1)) {
    return [...(ctx ? agentRows(view, members, t, ctx, terms.length) : []), ...terminalRows(terms, t, now)];
  }
  return groups.flatMap((g, i) => {
    const last = i === groups.length - 1;
    const lead = [last ? "" : "│"];
    return [tabRow(w, g.tab, last, t), ...(ctx ? agentRows(view, g.agents, t, ctx, g.terms.length, lead) : []), ...terminalRows(g.terms, t, now, lead)];
  });
}

// A tab's header in the tree: its name, else its automatic one (names.js), else "Tab 2"; brighter
// when it's the space's shown tab; a click shows it.
function tabRow(w, tab, last, t) {
  return h_flex()
    .id(`tree-tab-${tab.id}`)
    .pl(16)
    .pr(8)
    .h(20)
    .flex_none()
    .items_center()
    .rounded(6)
    .text_size(11)
    .text_color(tab.active ? t.muted : t.dim)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click(() => {
      run("space.select", { id: w.id });
      run("tab.select", { id: tab.id });
    })
    .children(treeLines(t, [last ? "└" : "├"], 20))
    .child(div().flex_1().min_w(0).truncate().child(tab.named ? tab.name : (shared("names")?.tabs?.[tab.id] ?? `Tab ${tab.index}`)));
}

// Agents hanging off the space's avatar (or a tab's header, `lead` in); a click on an agent's icon
// folds its sub-agents. `after`: rows that follow them there (terminals).
function agentRows(view, members, t, ctx, after = 0, lead = []) {
  const pl = 16;
  return members.flatMap((a, i) => {
    ctx.order.push(a.address);
    const last = i === members.length - 1 && !after;
    const subs = subTree(ctx.all, a.address).map((s) => ({ ...s, lines: [...lead, last ? "" : "│", ...s.lines] }));
    const row = agentRow(view, a, [...lead, last ? "└" : "├"], subs, t, ctx, pl);
    if (view.agentFolded.has(a.address)) return [row];
    return [row, ...subs.map((s) => subRow(t, s, { shown: ctx.shown, compact: true, listed: ctx.listed, pl }))];
  });
}

function agentRow(view, a, lines, subs, t, ctx, pl) {
  const term = ctx.terms.get(a.address);
  const tab = ctx.tabs.get(a.tab);
  const desc = describe(a, term?.labels);
  const name = desc ?? (tab?.named ? tab.name : null) ?? telling(a) ?? a.program?.name ?? a.title ?? "";
  const update = clean(term?.report?.msg) || null;
  const line2 = agentPref("line");
  const under = line2 === "update" ? update : line2 === "space" && tab?.named && tab.name !== name ? tab.name : null;
  const tip = [desc, tab?.named && tab.name !== name ? tab.name : null, under !== update ? update : null].filter(Boolean);
  const idle = a.status === "idle" && !a.focused;
  const when = since(a);
  const act = activity(t, a, term?.labels);
  const folded = view.agentFolded.has(a.address);
  const machine = agentPref("machine") === "name" && a.address.includes("/") ? a.address.split("/")[0] : null;
  const pic = agentPref("icon") === "hidden" ? null : icon(a.program, 14, t.foreground);
  const toggle = (_e, cx) => {
    cx.stop_propagation();
    folded ? view.agentFolded.delete(a.address) : view.agentFolded.add(a.address);
    cx.notify();
  };
  const head = h_flex().h(20).gap(6).items_center()
    .child(div().id(`tree-text-${a.address}`).flex_1().min_w(0).truncate().text_color(idle ? t.muted : t.foreground).child(name)
      .when(tip.length > 0, (el) => el.tooltip(tip.join("\n"))))
    .when(folded && subs.length > 0, (el) => el.child(div().id(`tree-fold-${a.address}`).flex_none().text_size(11).text_color(t.dim).cursor_pointer()
      .tooltip("Show sub-agents").on_click(toggle).child(`+${subs.length}`)))
    .when(Boolean(machine), (el) => el.child(div().flex_none().text_size(10).text_color(t.dim).child(machine)))
    .when(Boolean(act), (el) => el.child(act))
    .when(Boolean(when), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(ctx.now - when))))
    .child(statusMark(t, a, true));
  return h_flex()
    .id(`tree-${a.address}`)
    .pl(pl)
    .pr(8)
    .flex_none()
    .rounded(8)
    .text_size(12.5)
    .cursor_pointer()
    .when(Boolean(under), (el) => el.py(3))
    .when(!under, (el) => el.h(26).items_center())
    .when(a.focused, (el) => el.bg(t.raised))
    .hover((s) => s.bg(t.hover))
    .on_click(() => run("pane.focus", { pane: a.pane }))
    .on_mouse_down("right", () => menu(a))
    .children(treeLines(t, lines))
    .when(Boolean(pic), (el) => el.child(h_flex().id(`tree-icon-${a.address}`).flex_none().h(20).mr(8).items_center().when(Boolean(under), (el) => el.self_start())
      .when(subs.length > 0, (el) => el.on_click(toggle))
      .child(pic)))
    .when(agentPref("machine") === "icon", (el) => el.child(machineIcon(t, a.address).mr(8).when(Boolean(under), (el) => el.self_start())))
    .child(v_flex().flex_1().min_w(0)
      .child(head)
      .when(Boolean(under), (el) => el.child(div().h(16).truncate().text_size(11.5).text_color(t.dim).child(under))));
}
