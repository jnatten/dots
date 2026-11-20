// The board (ctrl-a T): the open PRs in its repos and those involving you, grouped as
// GitHub's inbox does; the open issues in its repos, by repo; and each Trello board turned
// on in the spacing dialog's Board tab, as its columns. Each item shows how many Claude
// sessions, PRs, issues and cards it's linked to: GitHub's own links, the cards and PRs in
// descriptions (both ways), and the other links of the sessions that had it.
// hjkl moves (in the lists ^D/^U half a page, ^J/^K five); ↵ picks one of its sessions or
// starts one in its repo (jj-sessions' tasks list for that item), ⌃↵ opens
// it, ⌥↵ lists what it's linked to, space previews it (preview.js). What was fetched is kept for the next opening.
// A jj-spaces overlay with props { board: true }.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { props, closeOverlay, openOverlay, theme, settings, shared, setShared, terminals, exec } from "herdr";
import { GH, FINAL, isCard, markRead, prKey, unknown } from "./github.js";
import { OpError, fetchBoard, linkSettings } from "./trello.js";
import { boardRepos, boardSettings, fetchIssues, fetchPrs } from "./board-data.js";

const FRESH = 2 * 60000;
const ICON = (name) => `mods/workspace-chrome/${name}.svg`;
const GREEN = ["#1a7f37", "#3fb950"], RED = ["#cf222e", "#f85149"], YELLOW = ["#9a6700", "#d29922"];
const CHECKS = { SUCCESS: ["check", GREEN, "Checks passed"], FAILURE: ["x", RED, "Checks failed"], ERROR: ["x", RED, "Checks failed"], PENDING: [null, YELLOW, "Checks running"], EXPECTED: [null, YELLOW, "Checks expected"] };
const REVIEW = { APPROVED: ["check", GREEN, "Approved"], CHANGES_REQUESTED: ["mods/jj-spaces/file-diff.svg", RED, "Changes requested"] };
// Trello's label colors, each shade by its hue.
const TRELLO = { green: "#4bce97", yellow: "#f5cd47", orange: "#fea362", red: "#f87168", purple: "#9f8fef", blue: "#579dff", sky: "#6cc3e0", lime: "#94c748", pink: "#e774bb", black: "#8590a2" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KIND_ORDER = { pr: 0, issue: 1, trello: 2 };

const PR_GROUPS = [
  ["Needs your review", (p) => p.rr && !p.mine],
  ["Changes requested", (p) => p.mine && p.review === "CHANGES_REQUESTED"],
  ["Ready to merge", (p) => p.mine && (p.review === "APPROVED" || p.state === "queued")],
  ["Waiting for review", (p) => p.mine && p.state !== "draft"],
  ["Drafts", (p) => p.mine],
  ["Involving you", (p) => p.inv],
  ["Everything else in your repos", () => true],
];

// What was fetched, the tab shown and each tab's selection ({ url, i } or { url, col, row }),
// kept between openings (copies share this module).
const memory = { tab: "prs", sel: {}, data: {}, at: {}, errors: {}, stamps: {}, blocked: false };

const ago = (ms) => {
  const d = (Date.now() - ms) / 1000;
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86400 ? `${Math.round(d / 3600)}h` : d < 86400 * 60 ? `${Math.round(d / 86400)}d` : `${Math.round(d / 86400 / 30)}mo`;
};
const kindOf = (url, items) => items[url]?.kind ?? (isCard(url) ? "trello" : /\/issues\/\d+/.test(url) ? "issue" : "pr");
const refOf = (it) => (it.kind === "trello" ? `${it.list || it.repo || "Card"}${it.number ? ` #${it.number}` : ""}` : `${it.repo.split("/").pop()}#${it.number ?? "?"}`);

function tabsOf() {
  const names = Object.fromEntries((shared("trello.boards") ?? []).map((b) => [b.id, b.name]));
  return [
    { id: "prs", name: "Pull requests", list: true },
    { id: "issues", name: "Issues", list: true },
    ...boardSettings().boards.map((id) => ({ id: `trello:${id}`, board: id, name: memory.data[`trello:${id}`]?.name || names[id] || "Trello" })),
  ];
}

export function boardInit(view, cx) {
  view.handle = cx.focus_handle();
  view.handle.focus();
  // It's the open board, for ctrl-a T to close (in shared(): copies of another build of this
  // mod don't share its module). The session picker over it gives the keyboard back when it
  // closes (shared("board.focus")).
  const me = props()?.overlay ?? null;
  setShared("board.open", me);
  const asks = () => `${shared("board.focus")} ${shared("preview.closed")}`;
  view.focusAsk = asks();
  cx.timer.every(150, () => {
    if (shared("board.open") !== me) setShared("board.open", me);
    if (asks() === view.focusAsk) return;
    view.focusAsk = asks();
    view.handle.focus();
  });
  view.busy = {};
  view.note = "";
  view.picker = null;
  view.reveal = true;
  view.listScroll = ScrollHandle.new();
  view.pickScroll = ScrollHandle.new();
  view.colScroll = ScrollHandle.new();
  view.cardScroll = Array.from({ length: 40 }, () => ScrollHandle.new());
  refresh(view, cx, false);
}

function load(view, cx, key, stamp, work) {
  if (view.busy[key]) return;
  view.busy[key] = true;
  cx.spawn(async (cx) => {
    try {
      memory.data[key] = await work();
      memory.at[key] = Date.now();
      memory.stamps[key] = stamp;
      delete memory.errors[key];
      if (key.startsWith("trello:")) memory.blocked = false;
    } catch (e) {
      memory.errors[key] = String(e?.message ?? e);
      if (e instanceof OpError) memory.blocked = true;
    }
    view.busy[key] = false;
    cx.notify();
  });
}

// What's old (or asked for again: force), or was fetched for other repos. After 1Password
// said no, Trello only on r.
function refresh(view, cx, force) {
  const now = Date.now();
  const repos = boardRepos();
  const stamp = JSON.stringify(repos);
  const due = (key, s) => force || !memory.data[key] || memory.stamps[key] !== s || now - (memory.at[key] ?? 0) > FRESH;
  if (due("prs", stamp)) load(view, cx, "prs", stamp, () => fetchPrs(repos));
  if (due("issues", stamp)) load(view, cx, "issues", stamp, () => fetchIssues(repos));
  if (memory.blocked && !force) return;
  const cfg = linkSettings(shared("jj-links"));
  for (const tab of tabsOf().filter((t) => t.board)) if (due(tab.id, "")) load(view, cx, tab.id, "", () => fetchBoard(tab.board, cfg));
}

// Every item the board knows: the sidebar's, then its own.
function known() {
  const items = { ...(shared("github")?.items ?? {}) };
  for (const p of memory.data.prs?.prs ?? []) items[p.url] = p;
  for (const i of memory.data.issues?.issues ?? []) items[i.url] = i;
  for (const tab of tabsOf().filter((t) => t.board)) for (const l of memory.data[tab.id]?.lists ?? []) for (const c of l.cards) items[c.url] = c;
  return items;
}

// Each Claude session's links (as the tasks list has them): those jj-tasks kept, and the
// running ones' now.
function sessionLinks() {
  const out = new Map();
  const put = (key, url) => (out.get(key) ?? out.set(key, new Set()).get(key)).add(url);
  for (const [id, e] of Object.entries(shared("tasks.sessions") ?? {})) for (const u of e.links ?? []) put(id, u);
  const direct = shared("github")?.shown?.direct ?? {};
  for (const t of terminals()) {
    const sid = t.state === "live" && t.labels?.["claude.session"];
    if (!sid) continue;
    const machine = t.address.includes("/") ? t.address.split("/")[0] : null;
    for (const u of direct[t.address] ?? []) put(machine ? `${machine}/${sid}` : sid, u);
  }
  return out;
}

// links: url -> Map(url -> why it's linked); sessions: url -> how many sessions had it.
function graphOf(items) {
  const links = new Map();
  const add = (a, b, why) => {
    if (!a || !b || a === b) return;
    const m = links.get(a) ?? links.set(a, new Map()).get(a);
    if (!m.has(b)) m.set(b, why);
  };
  for (const it of Object.values(items)) {
    for (const l of it.links ?? []) {
      add(it.url, l, it.kind === "pr" ? "closes" : "closed by");
      add(l, it.url, it.kind === "pr" ? "closed by" : "closes");
    }
    for (const u of [...(it.trello ?? []), ...(it.github ?? [])]) {
      add(it.url, u, "in its description");
      add(u, it.url, "mentions it");
    }
  }
  const sessions = new Map();
  for (const urls of sessionLinks().values()) {
    for (const a of urls) {
      sessions.set(a, (sessions.get(a) ?? 0) + 1);
      for (const b of urls) add(a, b, "same session");
    }
  }
  return { links, sessions };
}

function sectionsOf(tab) {
  if (tab.id === "prs") {
    const groups = PR_GROUPS.map(([name]) => ({ name, items: [] }));
    for (const p of memory.data.prs?.prs ?? []) groups[PR_GROUPS.findIndex(([, test]) => test(p))].items.push(p);
    for (const g of groups) g.items.sort((a, b) => b.updated - a.updated);
    return groups.filter((g) => g.items.length);
  }
  const by = new Map();
  for (const i of memory.data.issues?.issues ?? []) by.set(i.repo, [...(by.get(i.repo) ?? []), i]);
  return [...by]
    .map(([name, items]) => ({ name, items: items.sort((a, b) => b.updated - a.updated) }))
    .sort((a, b) => b.items[0].updated - a.items[0].updated);
}

const columnsOf = (tab) => {
  const lists = memory.data[tab.id]?.lists ?? [];
  return boardSettings().hideEmpty ? lists.filter((l) => l.cards.length) : lists;
};

function listAt(tab, rows) {
  const s = memory.sel[tab.id] ?? {};
  const i = rows.findIndex((it) => it.url === s.url);
  return i >= 0 ? i : Math.max(0, Math.min(s.i ?? 0, rows.length - 1));
}

function boardAt(tab, cols) {
  const s = memory.sel[tab.id] ?? {};
  for (let c = 0; c < cols.length; c++) {
    const r = cols[c].cards.findIndex((x) => x.url === s.url);
    if (r >= 0) return { col: c, row: r };
  }
  const col = s.col == null ? Math.max(0, cols.findIndex((l) => l.cards.length)) : Math.max(0, Math.min(s.col, cols.length - 1));
  return { col, row: Math.max(0, Math.min(s.row ?? 0, (cols[col]?.cards.length ?? 0) - 1)) };
}

function showTab(view, id) {
  memory.tab = id;
  view.reveal = true;
}

function move(view, dir, by = 1) {
  const md = view.model;
  if (md.tab.list) {
    const n = md.rows.length;
    if (!n) return;
    let i = md.at;
    if (dir === "down") i = Math.min(n - 1, i + by);
    else if (dir === "up") i = Math.max(0, i - by);
    else {
      const cur = md.starts.filter((s) => s <= i).length - 1;
      i = dir === "right" ? (md.starts[cur + 1] ?? i) : i > md.starts[cur] ? md.starts[cur] : md.starts[Math.max(0, cur - 1)];
    }
    memory.sel[md.tab.id] = { url: md.rows[i].url, i };
  } else {
    const cols = md.cols;
    if (!cols.length) return;
    let { col, row } = md.at;
    if (dir === "left") col = Math.max(0, col - 1);
    else if (dir === "right") col = Math.min(cols.length - 1, col + 1);
    else row += dir === "down" ? 1 : -1;
    row = Math.max(0, Math.min(row, cols[col].cards.length - 1));
    memory.sel[md.tab.id] = { url: cols[col].cards[row]?.url ?? null, col, row };
  }
  view.reveal = true;
}

function edge(view, last) {
  const md = view.model;
  if (md.tab.list) {
    const i = last ? md.rows.length - 1 : 0;
    if (md.rows[i]) memory.sel[md.tab.id] = { url: md.rows[i].url, i };
  } else {
    const cards = md.cols[md.at.col]?.cards ?? [];
    const row = last ? Math.max(0, cards.length - 1) : 0;
    memory.sel[md.tab.id] = { url: cards[row]?.url ?? null, col: md.at.col, row };
  }
  view.reveal = true;
}

function openUrl(it, cx) {
  markRead([it]);
  cx.spawn(async () => { await exec("open", [it.url]).catch(() => null); });
}

const slug = (text) => (text ?? "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");

// What a new session for `it` would start in: its repo (a card's: those of the PRs and
// issues it's linked to, then any other), a PR's branch, and a worktree's name.
function startOf(view, it) {
  const { graph, items } = view.model;
  const linked = [...(graph.links.get(it.url)?.keys() ?? [])].map((u) => items[u]).filter((x) => x && x.kind !== "trello" && x.repo);
  const repos = new Map((it.kind === "trello" ? linked : [it]).map((x) => [x.repo.toLowerCase(), x.repo]));
  const branch = it.kind === "pr" && !it.fork ? it.branch : null;
  const name = it.kind === "pr" ? it.branch?.replaceAll("/", "-") || `pr-${it.number}` : it.kind === "issue" ? `issue-${it.number}` : `card-${slug(it.title) || it.url.split("/").pop()}`;
  return { repos: [...repos.values()], others: it.kind === "trello", branch, name };
}

// ↵: the item's sessions, in jj-sessions' tasks list for it, with new ones to start in its
// repo; picking one closes the board too.
function sessions(view, it) {
  if (!it) return;
  openOverlay({ mod: "jj-sessions", kind: "dialog", width: 680, height: 440, props: { tasks: true, url: it.url, parent: props().overlay, start: startOf(view, it), item: { kind: it.kind, repo: it.repo, list: it.list, number: it.number, title: it.title, state: it.state } } });
}

function linkedRows(view, url) {
  const { graph, items } = view.model;
  return [...(graph.links.get(url) ?? new Map())]
    .map(([u, why]) => ({ url: u, why, it: items[u] ?? unknown(u, 0) }))
    .sort((a, b) => KIND_ORDER[a.it.kind] - KIND_ORDER[b.it.kind] || FINAL.has(a.it.state) - FINAL.has(b.it.state));
}

// ⌥↵: what the item is linked to.
function linked(view, it) {
  if (!it) return;
  if (!linkedRows(view, it.url).length) return (view.note = "Nothing is linked to this.");
  view.picker = { it, at: 0 };
}

// The tab and selection that show `url`, or null when the board doesn't have it.
function find(url) {
  if ((memory.data.prs?.prs ?? []).some((p) => p.url === url)) return { tab: "prs", sel: { url } };
  if ((memory.data.issues?.issues ?? []).some((i) => i.url === url)) return { tab: "issues", sel: { url } };
  for (const tab of tabsOf().filter((t) => t.board)) if ((memory.data[tab.id]?.lists ?? []).some((l) => l.cards.some((c) => c.url === url))) return { tab: tab.id, sel: { url } };
  return null;
}

// Space: Quick Look at it (preview.js), over the board.
export function preview(it) {
  if (!it?.url) return;
  openOverlay({ mod: "jj-spaces", kind: "dialog", width: 0.72, height: 0.88, props: { preview: it.url, item: { kind: it.kind, repo: it.repo, list: it.list, number: it.number, title: it.title, state: it.state } } });
}

function pickerKey(view, e, cx) {
  const rows = linkedRows(view, view.picker.it.url);
  const m = e.modifiers;
  if (e.key === "escape") view.picker = null;
  else if (e.key === "space") preview(rows[view.picker.at]?.it);
  else if (e.key === "j" || e.key === "down") view.picker.at = Math.min(rows.length - 1, view.picker.at + 1);
  else if (e.key === "k" || e.key === "up") view.picker.at = Math.max(0, view.picker.at - 1);
  else if (e.key === "enter") {
    const row = rows[view.picker.at];
    if (!row) return true;
    const at = !m.control && find(row.url);
    if (!at) return openUrl(row.it, cx), true;
    memory.sel[at.tab] = at.sel;
    showTab(view, at.tab);
    view.picker = null;
  } else return false;
  view.pickScroll.scroll_to_item(view.picker?.at ?? 0);
  return true;
}

function key(view, e, cx) {
  if (view.picker) return pickerKey(view, e, cx);
  const m = e.modifiers;
  const plain = !m.control && !m.alt && !m.platform;
  const tabs = tabsOf();
  const it = view.model.item;
  view.note = "";
  if (e.key === "escape") return closeOverlay(props().overlay), true;
  if (e.key === "space" && !m.control && !m.alt && !m.platform) return preview(it), true;
  if (e.key === "enter") {
    if (m.control) it && openUrl(it, cx);
    else if (m.alt) linked(view, it);
    else sessions(view, it);
    return true;
  }
  if (e.key === "tab") {
    const i = tabs.findIndex((t) => t.id === view.model.tab.id);
    return showTab(view, tabs[(i + (m.shift ? tabs.length - 1 : 1)) % tabs.length].id), true;
  }
  if (m.control && !m.alt && !m.platform && view.model.tab.list) {
    const half = Math.max(1, Math.floor((view.listHeight ?? 340) / 2 / 34));
    const by = { d: half, u: half, j: 5, k: 5 }[e.key];
    if (by) return move(view, e.key === "d" || e.key === "j" ? "down" : "up", by), true;
  }
  if (!plain) return false;
  if (/^[1-9]$/.test(e.key) && tabs[Number(e.key) - 1]) return showTab(view, tabs[Number(e.key) - 1].id), true;
  if (e.key === "r") return refresh(view, cx, true), true;
  if (e.key === "e" && !view.model.tab.list) {
    const { hideEmpty, ...rest } = shared("jj-board") ?? {};
    setShared("jj-board", hideEmpty ? rest : { ...rest, hideEmpty: true });
    return (view.reveal = true);
  }
  if (e.key === "g" || e.key === "G") return edge(view, m.shift || e.key === "G"), true;
  const dir = { h: "left", left: "left", j: "down", down: "down", k: "up", up: "up", l: "right", right: "right" }[e.key];
  if (!dir) return false;
  move(view, dir);
  return true;
}

function counts(url, view, t) {
  const { graph, items } = view.model;
  const k = { pr: 0, issue: 0, trello: 0 };
  for (const u of graph.links.get(url)?.keys() ?? []) k[kindOf(u, items)]++;
  const chip = (icon, n) => (n ? [h_flex().flex_none().gap(3).items_center().child(svg(icon).size(11)).child(String(n))] : []);
  return h_flex()
    .flex_none()
    .gap(8)
    .items_center()
    .text_size(11)
    .text_color(t.dim)
    .children([...chip(ICON("terminal"), graph.sessions.get(url) ?? 0), ...chip(GH.open.icon, k.pr), ...chip(GH["issue-open"].icon, k.issue), ...chip(GH["trello-open"].icon, k.trello)]);
}

const pick = (c, dark) => c[dark ? 1 : 0];
const stateIcon = (it, dark, t, size = 13) => {
  const s = GH[it.state];
  const fallback = it.kind === "issue" ? GH["issue-open"].icon : it.kind === "trello" ? GH["trello-open"].icon : GH.open.icon;
  return svg(s?.icon ?? fallback).size(size).text_color(s ? pick(s.color, dark) : t.dim);
};

function select(view, tabId, sel, e, cx, it) {
  memory.sel[tabId] = sel;
  view.note = "";
  if (e.modifiers.control) openUrl(it, cx);
  else if (e.click_count >= 2) sessions(view, it);
  cx.notify();
}

function rowBase(id, on, t) {
  return h_flex()
    .id(id)
    .h(34)
    .flex_none()
    .px(10)
    .gap(10)
    .items_center()
    .rounded(7)
    .cursor_pointer()
    .when(on, (el) => el.bg(t.selected))
    .when(!on, (el) => el.hover((s) => s.bg(t.hover)));
}

function prRow(view, p, i, on, t, dark) {
  const unread = shared("github")?.unread?.[prKey(p)];
  const check = CHECKS[p.checks];
  const review = p.state !== "draft" ? REVIEW[p.review] : null;
  return rowBase(`pr-${p.url}`, on, t)
    .on_click((e, cx) => select(view, "prs", { url: p.url, i }, e, cx, p))
    .child(div().relative().w(14).flex_none().flex().justify_center().child(stateIcon(p, dark, t))
      .when(Boolean(unread), (el) => el.child(div().absolute().top(-2).right(-3).size(6).rounded(3).bg(pick(["#0969da", "#4493f8"], dark)))))
    .child(div().w(150).flex_none().truncate().text_size(11.5).text_color(t.dim).child(`${p.repo.split("/").pop()}#${p.number}`))
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).when(p.state === "draft", (el) => el.text_color(t.muted)).child(p.title))
    .child(div().flex_none().max_w(130).truncate().text_size(11.5).text_color(t.dim).child(p.mine ? "you" : p.author))
    .child(h_flex().w(14).flex_none().justify_center().child(
      !check ? div() : check[0] ? svg(ICON(check[0])).size(12).text_color(pick(check[1], dark)) : div().size(7).rounded(4).bg(pick(check[1], dark))))
    .child(h_flex().w(14).flex_none().justify_center().child(review ? svg(review[0].includes("/") ? review[0] : ICON(review[0])).size(12).text_color(pick(review[1], dark)) : div()))
    .child(counts(p.url, view, t))
    .child(div().w(30).flex_none().text_right().text_size(11).text_color(t.dim).child(ago(p.updated)));
}

function issueRow(view, it, i, on, t, dark, login) {
  const who = it.assignees.length ? it.assignees : [it.author];
  const me = who.includes(login);
  return rowBase(`is-${it.url}`, on, t)
    .on_click((e, cx) => select(view, "issues", { url: it.url, i }, e, cx, it))
    .child(h_flex().w(14).flex_none().justify_center().child(stateIcon(it, dark, t)))
    .child(div().w(52).flex_none().text_size(11.5).text_color(t.dim).child(`#${it.number}`))
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(it.title))
    .children(it.labels.slice(0, 2).map((l) => h_flex().flex_none().max_w(140).gap(4).items_center().text_size(11).text_color(t.muted)
      .child(div().size(8).flex_none().rounded(4).bg(`#${l.color}`))
      .child(div().truncate().child(l.name))))
    .child(div().flex_none().max_w(130).truncate().text_size(11.5).text_color(me ? t.foreground : t.dim).when(me, (el) => el.font_semibold()).child(me ? "you" : who.join(", ")))
    .child(counts(it.url, view, t))
    .child(div().w(30).flex_none().text_right().text_size(11).text_color(t.dim).child(ago(it.updated)));
}

function listBody(view, t, dark) {
  const { tab, sections } = view.model;
  const children = [];
  const childOf = [];
  const login = memory.data[tab.id]?.login ?? "";
  let n = 0;
  for (const sec of sections) {
    children.push(h_flex().h(28).px(10).pt(8).flex_none().items_center().text_size(11).text_color(t.dim).child(`${sec.name} · ${sec.items.length}`));
    for (const it of sec.items) {
      childOf[n] = children.length;
      const on = n === view.model.at;
      children.push(tab.id === "prs" ? prRow(view, it, n, on, t, dark) : issueRow(view, it, n, on, t, dark, login));
      n++;
    }
  }
  view.model.childOf = childOf;
  const none = !boardRepos().length
    ? "No repos yet: put repos in a sidebar folder, or add them in the spacing dialog's Board tab."
    : tab.id === "prs" ? "No open PRs." : "No open issues.";
  return v_flex()
    .id(`list-${tab.id}`)
    .on_size_change((size) => (view.listHeight = size.height))
    .flex_1()
    .min_h(0)
    .overflow_y_scrollbar()
    .track_scroll(view.listScroll)
    .children(children)
    .when(!n, (el) => el.child(div().p(10).text_color(t.dim).child(memory.data[tab.id] ? none : view.busy[tab.id] ? "Asking GitHub…" : "")));
}

function dateOf(ms) {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ""}`;
}

function card(view, tab, c, col, row, on, t, dark) {
  const overdue = c.due && !c.dueComplete && c.due < Date.now();
  const dueColor = c.dueComplete ? pick(GREEN, dark) : overdue ? pick(RED, dark) : t.dim;
  const named = c.labels.filter((l) => l.name);
  const bare = c.labels.filter((l) => !l.name);
  const colorOf = (l) => TRELLO[(l.color ?? "").replace(/_(light|dark)$/, "")] ?? t.dim;
  return v_flex()
    .id(`card-${c.url}`)
    .flex_none()
    .p(8)
    .gap(6)
    .rounded(8)
    .bg(t.popover)
    .border_1()
    .border_color(on ? t.accent : t.border)
    .cursor_pointer()
    .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
    .on_click((e, cx) => select(view, tab.id, { url: c.url, col, row }, e, cx, c))
    .when(c.labels.length > 0, (el) => el.child(h_flex().gap(4).flex_wrap()
      .children(named.map((l) => div().px(6).h(16).flex().items_center().rounded(4).bg(colorOf(l)).text_size(10.5).text_color("#1d2125").child(l.name)))
      .children(bare.map((l) => div().h(8).w(32).rounded(4).bg(colorOf(l))))))
    .child(div().text_size(12.5).text_color(t.foreground).child(c.title))
    .child(h_flex().gap(8).items_center().text_size(11).text_color(t.dim)
      .when(Boolean(c.due), (el) => el.child(h_flex().flex_none().gap(3).items_center().text_color(dueColor).child(svg(ICON(c.dueComplete ? "circle-check" : "clock")).size(11)).child(dateOf(c.due))))
      .child(div().flex_1())
      .child(counts(c.url, view, t))
      .children(c.members.slice(0, 3).map((m) => div().size(18).flex_none().flex().items_center().justify_center().rounded(9).bg(t.raised).text_size(8.5).font_semibold().text_color(t.muted).child(m.initials))));
}

function boardBody(view, t, dark) {
  const { tab, cols } = view.model;
  const b = memory.data[tab.id];
  if (!b) return div().flex_1().p(10).text_color(memory.errors[tab.id] ? t.blocked : t.dim).child(memory.errors[tab.id] ? `${memory.errors[tab.id]} r tries again.` : view.busy[tab.id] ? "Asking Trello…" : "");
  if (!cols.length) return div().flex_1().p(10).text_color(t.dim).child(b.lists.length ? "No cards. e shows the empty columns." : "This board has no lists.");
  return h_flex()
    .id(`cols-${tab.id}`)
    .flex_1()
    .min_h(0)
    .gap(10)
    .overflow_x_scrollbar()
    .track_scroll(view.colScroll)
    .children(cols.map((l, c) => v_flex()
      .id(`col-${l.id}`)
      .w(272)
      .flex_none()
      .h_full()
      .p(8)
      .gap(8)
      .rounded(10)
      .bg(t.canvas)
      .child(h_flex().px(4).gap(6).flex_none().items_center()
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).child(l.name))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(String(l.cards.length))))
      .child(v_flex()
        .id(`cards-${l.id}`)
        .flex_1()
        .min_h(0)
        .gap(6)
        .overflow_y_scrollbar()
        .when(Boolean(view.cardScroll[c]), (el) => el.track_scroll(view.cardScroll[c]))
        .children(l.cards.map((x, r) => card(view, tab, x, c, r, c === view.model.at.col && r === view.model.at.row, t, dark)))
        .when(!l.cards.length, (el) => el.child(div().px(4).py(6).text_size(12).text_color(t.dim).child("No cards"))))));
}

function pickerPanel(view, t, dark) {
  const { it, at } = view.picker;
  const rows = linkedRows(view, it.url);
  return div()
    .absolute()
    .top(0)
    .left(0)
    .right(0)
    .bottom(0)
    .flex()
    .items_center()
    .justify_center()
    .bg("#00000055")
    .child(v_flex()
      .id("linked")
      .w(620)
      .p(14)
      .gap(8)
      .rounded(10)
      .border_1()
      .border_color(t.border)
      .bg(t.popover)
      .shadow_lg()
      .child(div().flex_none().truncate().font_semibold().text_color(t.foreground).child(`Linked to ${refOf(it)} ${it.title ?? ""}`))
      .child(v_flex().id("linked-list").h(Math.min(360, rows.length * 34)).flex_none().overflow_y_scrollbar().track_scroll(view.pickScroll)
        .children(rows.map((r, i) => rowBase(`ln-${r.url}`, i === at, t)
          .on_click((e, cx) => {
            view.picker.at = i;
            if (e.modifiers.control) openUrl(r.it, cx);
            else if (e.click_count >= 2) pickerKey(view, { key: "enter", modifiers: e.modifiers }, cx);
            cx.notify();
          })
          .child(h_flex().w(14).flex_none().justify_center().child(stateIcon(r.it, dark, t)))
          .child(div().w(150).flex_none().truncate().text_size(11.5).text_color(t.dim).child(refOf(r.it)))
          .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(r.it.title || r.url))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(r.why)))))
      .child(h_flex().flex_none().justify_end().text_size(11).text_color(t.dim).child("space preview · ↵ go to · ⌃↵ open · esc back")));
}

export function boardRender(view) {
  const t = theme();
  const dark = Boolean(settings()?.dark);
  const tabs = tabsOf();
  const tab = tabs.find((x) => x.id === memory.tab) ?? tabs[0];
  memory.tab = tab.id;
  const items = known();
  const model = { tab, items, graph: graphOf(items) };
  if (tab.list) {
    model.sections = sectionsOf(tab);
    model.rows = model.sections.flatMap((s) => s.items);
    let n = 0;
    model.starts = model.sections.map((s) => ((n += s.items.length), n - s.items.length));
    model.at = listAt(tab, model.rows);
    model.item = model.rows[model.at] ?? null;
  } else {
    model.cols = columnsOf(tab);
    model.at = boardAt(tab, model.cols);
    model.item = model.cols[model.at.col]?.cards[model.at.row] ?? null;
  }
  view.model = model;
  const body = tab.list ? listBody(view, t, dark) : boardBody(view, t, dark);
  if (view.reveal) {
    view.reveal = false;
    if (tab.list) view.listScroll.scroll_to_item(model.childOf?.[model.at] ?? 0);
    else {
      view.colScroll.scroll_to_item(model.at.col);
      view.cardScroll[model.at.col]?.scroll_to_item(model.at.row);
    }
  }
  const countOf = (x) => (x.id === "prs" ? memory.data.prs?.prs.length : x.id === "issues" ? memory.data.issues?.issues.length : memory.data[x.id]?.lists.reduce((s, l) => s + l.cards.length, 0));
  const tabEl = (x, i) => h_flex().id(`tab-${x.id}`).flex_none().gap(6).px(10).py(4).rounded(6).cursor_pointer()
    .text_color(x.id === tab.id ? t.foreground : t.muted)
    .when(x.id === tab.id, (el) => el.bg(t.selected))
    .when(x.id !== tab.id, (el) => el.hover((s) => s.bg(t.hover)))
    .on_click((_e, cx) => { showTab(view, x.id); view.note = ""; cx.notify(); })
    .when(x.board, (el) => el.child(svg(GH["trello-open"].icon).size(12).text_color(pick(GH["trello-open"].color, dark))))
    .child(x.name)
    .when(countOf(x) != null, (el) => el.child(div().text_size(11).text_color(t.dim).child(String(countOf(x)))))
    .tooltip(i < 9 ? `${i + 1} · tab` : "tab");
  const error = memory.errors[tab.id];
  const status = view.busy[tab.id]
    ? h_flex().gap(6).items_center().child(div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)).child("refreshing")
    : error ? div().max_w(360).truncate().text_color(t.blocked).child(error)
    : memory.at[tab.id] ? div().child(Date.now() - memory.at[tab.id] < 60000 ? "updated now" : `updated ${ago(memory.at[tab.id])} ago`) : div();
  const gh = tab.list ? memory.data[tab.id] : null;
  const notes = [
    view.note,
    gh?.missing?.length ? `Not on GitHub, or gh can't see: ${gh.missing.join(", ")}` : "",
    gh?.partial ? "Some repos couldn't be asked." : "",
  ].filter(Boolean);
  const site = tab.list ? "GitHub" : "Trello";
  const hint = view.picker ? "" : ["hjkl move", tab.list && "^D ^U half page", tab.list && "^J ^K 5 rows", "space preview", "↵ sessions", `⌃↵ open on ${site}`, "⌥↵ linked", !tab.list && (boardSettings().hideEmpty ? "e show empty" : "e hide empty"), "tab next", "r refresh", "esc close"].filter(Boolean).join(" · ");
  return v_flex()
    .id("board")
    .relative()
    .track_focus(view.handle)
    .on_key_down((e, cx) => {
      if (!key(view, e, cx)) return;
      cx.stop_propagation();
      cx.notify();
    })
    .size_full()
    .min_h(0)
    .p(16)
    .gap(10)
    .bg(t.popover)
    .text_size(13)
    .child(h_flex().flex_none().gap(4).items_center()
      .child(h_flex().flex_1().min_w(0).gap(4).items_center().overflow_hidden().children(tabs.map(tabEl)))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(status)))
    .child(body)
    .child(h_flex().flex_none().gap(12).items_center().text_size(11).text_color(t.dim)
      .child(div().flex_1().min_w(0).truncate().text_color(view.note ? t.muted : t.dim).child(notes.join(" · ")))
      .child(div().flex_none().child(hint)))
    .when(Boolean(view.picker), (el) => el.child(pickerPanel(view, t, dark)));
}
