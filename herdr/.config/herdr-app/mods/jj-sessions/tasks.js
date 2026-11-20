// The tasks list (ctrl-a t): every PR, issue and Trello card a Claude session had linked
// (by hand, through its space, or found by jj-spaces), on any machine, each with those
// sessions under it. jj-spaces keeps them in each machine's jj-tasks document and shares
// them as shared("tasks.sessions"); running ones add their links now. ↵ opens a task, goes
// to a running session or resumes an ended one where it ran; ⌘↵ brings one from another
// machine here first; ^D forgets an ended one's link; ⌃space previews a task (jj-spaces' preview).
// A jj-sessions overlay with props { tasks: true }. With { url, parent?, start?, item? } it's that
// task's sessions only, the board's (ctrl-a T) session picker, and new ones to start in its
// repos (start: { repos, others, branch, name }, where shared("board.places") has them);
// picking one closes `parent` too.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { agents, terminals, theme, settings, shared, setShared, props, run, exec, closeOverlay, openOverlay } from "herdr";
import { ago, base, bring, label, missing, resume, startNew, worktree } from "./sessions.js";

const ICON = (name) => `mods/workspace-chrome/${name}.svg`;
// jj-spaces/github.js's: GitHub's colors, [light, dark], and Trello's blue.
const GREEN = ["#1a7f37", "#3fb950"], PURPLE = ["#8250df", "#a371f7"], GRAY = ["#59636e", "#9198a1"], BLUE = ["#0c66e4", "#579dff"];
const GH = {
  open: { icon: "mods/jj-spaces/git-pull-request.svg", color: GREEN, label: "Open" },
  draft: { icon: "mods/jj-spaces/git-pull-request-draft.svg", color: GRAY, label: "Draft" },
  queued: { icon: "mods/jj-spaces/git-pull-request.svg", color: ["#9a6700", "#d29922"], label: "Merge queued" },
  merged: { icon: "mods/jj-spaces/git-merge.svg", color: PURPLE, label: "Merged" },
  closed: { icon: "mods/jj-spaces/git-pull-request-closed.svg", color: ["#cf222e", "#f85149"], label: "Closed" },
  "issue-open": { icon: "mods/jj-spaces/circle-dot.svg", color: GREEN, label: "Open" },
  "issue-done": { icon: "mods/workspace-chrome/circle-check.svg", color: PURPLE, label: "Closed" },
  "issue-skip": { icon: "mods/jj-spaces/circle-slash.svg", color: GRAY, label: "Not planned" },
  "trello-open": { icon: "mods/jj-spaces/trello.svg", color: BLUE, label: "" },
  "trello-done": { icon: "mods/jj-spaces/trello.svg", color: PURPLE, label: "Done" },
  "trello-archived": { icon: "mods/jj-spaces/trello.svg", color: GRAY, label: "Archived" },
};
const FINAL = new Set(["merged", "closed", "issue-done", "issue-skip", "trello-done", "trello-archived"]);
const FALLBACK = { pr: GH.open.icon, issue: GH["issue-open"].icon, trello: GH["trello-open"].icon };

const machineOf = (id) => (id.includes("/") ? id.split("/")[0] : null);
const keyOf = (s) => (s.machine ? `${s.machine}/${s.id}` : s.id);

// What a URL jj-spaces hasn't looked up shows: its kind, repo and number.
function guess(url) {
  if (/trello\.com\/c\//.test(url)) return { kind: "trello", url, repo: "", title: "" };
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/(pull|issues)\/(\d+)/);
  return { kind: m?.[2] === "issues" ? "issue" : "pr", url, repo: m?.[1] ?? "", number: Number(m?.[3]) || null, title: "" };
}

const refOf = (it) => (it.kind === "trello" ? it.repo || "Trello" : `${it.repo.split("/").pop()}#${it.number ?? "?"}`);

// Every session with links: those jj-tasks kept, and the running ones as they are now.
function sessionsNow() {
  const out = {};
  for (const [id, e] of Object.entries(shared("tasks.sessions") ?? {})) {
    const machine = machineOf(id);
    const sid = machine ? id.slice(machine.length + 1) : id;
    out[id] = { id: sid, machine, cwd: e.cwd ?? "", title: e.title || "Claude", space: e.space ? (machine ? `${machine}/${e.space}` : e.space) : null, spaceName: e.spaceName ?? "", links: e.links ?? [], at: e.at ?? 0 };
  }
  const direct = shared("github")?.shown?.direct ?? {};
  const as = agents();
  const now = Math.floor(Date.now() / 1000);
  for (const t of terminals()) {
    const sid = t.state === "live" && t.labels?.["claude.session"];
    if (!sid) continue;
    const machine = machineOf(t.address);
    const s = { id: sid, machine };
    const was = out[keyOf(s)];
    const links = [...new Set([...(was?.links ?? []), ...(direct[t.address] ?? [])])];
    if (!links.length) continue;
    const a = as.find((a) => a.address === t.address);
    out[keyOf(s)] = {
      ...s,
      cwd: t.labels["claude.cwd"] || was?.cwd || "",
      title: t.labels["jj.description"] || a?.title || was?.title || "Claude",
      space: a?.space ?? was?.space ?? null,
      spaceName: a?.space_name ?? was?.spaceName ?? "",
      links,
      at: now,
      running: { address: t.address, status: a?.status ?? "idle" },
    };
  }
  return out;
}

export function taskInit(view, cx) {
  // The ctrl-a t list is the open one, for ctrl-a t to close (in shared(): copies of another
  // build of this mod don't share its module).
  if (!props()?.url) {
    const me = props()?.overlay ?? null;
    setShared("tasks.open", me);
    cx.timer.every(150, () => {
      if (shared("tasks.open") !== me) setShared("tasks.open", me);
    });
  }
  view.text = "";
  view.at = 0;
  view.childOf = [];
  view.gone = {};
  view.scroll = ScrollHandle.new();
  view.input = InputState.new({ placeholder: props()?.url ? "Search its sessions…" : "Search tasks and their sessions…" });
  view.input.on("change", (_e, cx) => {
    view.text = view.input.value();
    view.at = 0;
    view.error = "";
    cx.notify();
  });
  view.input.on("submit", (e, cx) => go(view, view.rows[view.at], cx, Boolean(e?.shift), Boolean(e?.secondary)));
  view.input.focus();
  // A preview over it gives the keyboard back when it closes (shared("preview.closed")).
  view.previewed = shared("preview.closed");
  cx.timer.every(150, () => {
    if (shared("preview.closed") === view.previewed) return;
    view.previewed = shared("preview.closed");
    view.input.focus();
  });
  // Which ended sessions' folders are gone, on each machine.
  const byMachine = {};
  for (const s of Object.values(sessionsNow())) if (!s.running && s.cwd) (byMachine[s.machine ?? ""] ??= new Set()).add(s.cwd);
  for (const [m, dirs] of Object.entries(byMachine)) {
    cx.spawn(async (cx) => {
      const gone = await missing([...dirs], m || null).catch(() => new Set());
      for (const d of dirs) view.gone[`${m}\0${d}`] = gone.has(d);
      cx.notify();
    });
  }
}

const goneOf = (view, s) => view.gone[`${s.machine ?? ""}\0${s.cwd}`];

// [{ name, rows }]: open tasks, then finished ones, each newest first, with their sessions
// running first; filtered by words every one of which is in the task or the session.
function sections(view) {
  const only = props()?.url;
  const items = shared("github")?.items ?? {};
  const words = view.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const by = new Map();
  for (const s of Object.values(sessionsNow())) for (const url of s.links) by.set(url, [...(by.get(url) ?? []), s]);
  const tasks = [...by].map(([url, list]) => {
    const it = items[url] ?? guess(url);
    const text = `${refOf(it)} ${it.repo ?? ""} ${it.list ?? ""} ${it.title ?? ""} ${url} ${GH[it.state]?.label ?? ""}`.toLowerCase();
    const has = (s) => words.every((w) => `${text} ${s.title} ${label(s.cwd)} ${s.cwd} ${s.machine ?? ""} ${s.spaceName}`.toLowerCase().includes(w));
    const shown = words.every((w) => text.includes(w)) ? list : list.filter(has);
    shown.sort((a, b) => Boolean(b.running) - Boolean(a.running) || b.at - a.at);
    return { url, it, sessions: shown, at: Math.max(...list.map((s) => s.at)), done: FINAL.has(it.state) };
  });
  const rowsOf = (list) => list.sort((a, b) => b.at - a.at).flatMap((task) => [...(only ? [] : [{ kind: "task", task }]), ...task.sessions.map((s) => ({ kind: "session", task, s }))]);
  const matching = tasks.filter((t) => t.sessions.length && (!only || t.url === only));
  if (only) return [{ name: "Sessions", rows: rowsOf(matching) }, { name: "New session", rows: newRows(words) }].filter((sec) => sec.rows.length || sec.name === "Sessions");
  return [
    { name: "Open", rows: rowsOf(matching.filter((t) => !t.done)) },
    { name: "Done", rows: rowsOf(matching.filter((t) => t.done)) },
  ].filter((sec) => sec.rows.length);
}

// The new sessions the board's picker offers: in each place the item's repos are checked
// out (a card's, then every other repo's), in the checkout or in a new worktree.
function newRows(words) {
  const start = props()?.start;
  if (!start) return [];
  const places = shared("board.places") ?? {};
  const wanted = start.repos.map((r) => r.toLowerCase());
  const keys = [...wanted, ...(start.others ? Object.keys(places).filter((k) => !wanted.includes(k)).sort() : [])];
  return keys.flatMap((key) =>
    (places[key] ?? []).flatMap((place) =>
      [false, true].map((own) => ({ kind: "new", key: `new:${key}:${place.machine ?? ""}:${place.path}:${own}`, repo: key, place, worktree: own, branch: start.branch, name: start.name })),
    ),
  ).filter((r) => words.every((w) => `new session ${r.worktree ? "worktree" : "checkout"} ${r.repo} ${r.place.path} ${r.place.machine ?? ""} ${r.branch ?? ""}`.toLowerCase().includes(w)));
}

function hide() {
  closeOverlay(props().overlay);
}

// Done: the board this picked a session for goes too.
function done() {
  hide();
  if (props()?.parent) closeOverlay(props().parent);
}

function start(view, s, work, cx) {
  if (view.busy) return;
  view.busy = keyOf(s);
  view.error = "";
  cx.notify();
  cx.spawn(async (cx) => {
    view.error = await work().catch((e) => String(e?.message ?? e));
    view.busy = null;
    if (!view.error) done();
    cx.notify();
  });
}

// ↵: opens a task; goes to a running session, else resumes it where it ran, or (bring)
// copies one from another machine here first; here: in its repo when its folder is gone.
function go(view, row, cx, here = false, bringIt = false) {
  if (!row) return;
  if (row.kind === "new") return start(view, { id: row.key }, () => startNew({ path: row.place.path, machine: row.place.machine, worktree: row.worktree, name: row.name, branch: row.branch, url: props().url }), cx);
  if (row.kind === "task") {
    hide();
    return cx.spawn(async () => { await exec("open", [row.task.url]).catch(() => null); });
  }
  const s = row.s;
  if (s.running) {
    done();
    return run("agent.focus", { terminal: s.running.address });
  }
  if (bringIt && s.machine) return start(view, s, () => bring(s, here), cx);
  start(view, s, () => resume(s, here), cx);
}

// ^D: an ended session no longer had the task (kept on its machine by jj-spaces).
function forgetLink(row) {
  if (row?.kind !== "session" || row.s.running) return;
  const id = keyOf(row.s);
  const all = shared("tasks.sessions") ?? {};
  if (all[id]) {
    const links = (all[id].links ?? []).filter((u) => u !== row.task.url);
    const { [id]: _, ...rest } = all;
    setShared("tasks.sessions", links.length ? { ...rest, [id]: { ...all[id], links } } : rest);
  }
  setShared("tasks.forget.ask", [...(shared("tasks.forget.ask") ?? []), { id, url: row.task.url }]);
}

// ⌃space: Quick Look at the row's task (jj-spaces' preview, over this list).
function preview(row) {
  const url = row?.task?.url ?? props()?.url;
  if (!url) return;
  const it = row?.task?.it ?? props()?.item ?? guess(url);
  openOverlay({ mod: "jj-spaces", kind: "dialog", width: 0.72, height: 0.88, props: { preview: url, item: { kind: it.kind, repo: it.repo, list: it.list, number: it.number, title: it.title, state: it.state } } });
}

function hintOf(view, row) {
  if (view.busy) return view.busy.startsWith("new:") ? "starting…" : "resuming…";
  if (!row) return "";
  if (row.kind === "task") return "↵ open";
  if (row.kind === "new") return `↵ start${row.branch ? ` on ${row.branch}` : ""}`;
  const s = row.s;
  if (s.running) return "↵ go to";
  const w = goneOf(view, s) && worktree(s.cwd);
  const resuming = goneOf(view, s) ? (w ? `↵ recreate workspace · ⇧↵ resume in ${base(w.repo)}` : "↵ resume in a parent folder") : `↵ resume${s.machine ? ` on ${s.machine}` : ""}`;
  return [resuming, s.machine && "⌘↵ bring here", "^D forget"].filter(Boolean).join(" · ");
}

export function taskRender(view, t) {
  const only = props()?.url;
  const dark = Boolean(settings()?.dark);
  const secs = sections(view);
  view.rows = secs.flatMap((sec) => sec.rows);
  view.at = Math.min(view.at, Math.max(0, view.rows.length - 1));
  const selected = view.rows[view.at];
  const line = (id, i, row) =>
    h_flex()
      .id(id)
      .h(32)
      .flex_none()
      .px(10)
      .gap(9)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .when(i === view.at, (el) => el.bg(t.selected))
      .when(i !== view.at, (el) => el.hover((st) => st.bg(t.hover)))
      .on_click((e, cx) => go(view, row, cx, e.modifiers.shift, e.modifiers.platform));
  const taskRow = (task, i, row) => {
    const { it } = task;
    const s = GH[it.state];
    const color = s ? s.color[dark ? 1 : 0] : t.dim;
    return line(`tk-${task.url}`, i, row)
      .child(h_flex().w(14).flex_none().justify_center().child(svg(s?.icon ?? FALLBACK[it.kind] ?? FALLBACK.pr).size(13).text_color(color)))
      .child(div().flex_none().text_size(11.5).text_color(t.dim).child(refOf(it)))
      .child(div().flex_1().min_w(0).truncate().text_color(task.done ? t.muted : t.foreground).child(it.title || (it.kind === "trello" ? "Trello card" : task.url)))
      .child(h_flex().flex_none().justify_end().text_size(11).text_color(color).child(s?.label ?? ""));
  };
  const newRow = (r, i, row) => {
    const where = view.busy === r.key ? "starting…" : `${r.place.machine ? `${r.place.machine} · ` : ""}${label(r.worktree ? `${r.place.path}/.claude/worktrees/${r.name}` : r.place.path)}`;
    return line(r.key, i, row)
      .child(h_flex().w(14).flex_none().justify_center().child(svg(ICON("plus")).size(12).text_color(t.dim)))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(`New session${r.worktree ? " in a new worktree" : ""}${r.branch ? ` on ${r.branch}` : ""}`))
      .child(div().flex_none().max_w(260).truncate().text_size(11.5).text_color(t.dim).child(where))
      .child(h_flex().flex_none().w(52).justify_end().text_size(11).text_color(t.dim).child(r.worktree ? "worktree" : "checkout"));
  };
  const sessionRow = (task, s, i, row) => {
    const gone = goneOf(view, s);
    const where = view.busy === keyOf(s) ? "resuming…" : `${s.machine ? `${s.machine} · ` : ""}${label(s.cwd)}${gone ? " · gone" : ""}`;
    return line(`tk-${task.url}-${keyOf(s)}`, i, row)
      .when(!props()?.url, (el) => el.pl(33))
      .child(h_flex().w(14).flex_none().justify_center().child(s.running ? div().size(7).rounded(4).bg(t[s.running.status] ?? t.idle) : svg(ICON("clock")).size(12).text_color(t.dim)))
      .child(div().flex_1().min_w(0).truncate().text_color(gone ? t.dim : t.foreground).child(s.title))
      .child(div().flex_none().max_w(220).truncate().text_size(11.5).text_color(t.dim).child(where))
      .child(h_flex().flex_none().w(52).justify_end().text_size(11).text_color(t.dim).child(s.running ? s.running.status : ago(s.at)));
  };
  const children = [];
  view.childOf = [];
  let n = 0;
  for (const sec of secs) {
    const head = !only
      ? `${sec.name} · ${sec.rows.filter((r) => r.kind === "task").length}`
      : sec.name !== "Sessions" ? sec.name
      : sec.rows.length ? `Sessions · ${sec.rows.length}`
      : view.text.trim() ? "No matching sessions" : "No Claude session has had this yet";
    children.push(h_flex().h(26).px(10).pt(6).flex_none().items_center().text_size(11).text_color(t.dim).child(head));
    for (const row of sec.rows) {
      view.childOf[n] = children.length;
      children.push(row.kind === "task" ? taskRow(row.task, n, row) : row.kind === "new" ? newRow(row, n, row) : sessionRow(row.task, row.s, n, row));
      n++;
    }
  }
  const empty = !view.rows.length && !only;
  const places = shared("board.places") ?? {};
  const unplaced = (props()?.start?.repos ?? []).filter((r) => !places[r.toLowerCase()]?.length);
  const it = only ? (props()?.item ?? shared("github")?.items?.[only] ?? guess(only)) : null;
  const none = !Object.keys(shared("tasks.sessions") ?? {}).length && !view.text.trim();
  return v_flex()
    .id("tasks")
    .track_focus(view.handle)
    .on_key_down((e, cx) => {
      const count = view.rows.length;
      const ctrl = e.modifiers.control && !e.modifiers.platform && !e.modifiers.alt && !e.modifiers.shift;
      const down = e.key === "down" || (ctrl && (e.key === "j" || e.key === "n"));
      const up = e.key === "up" || (ctrl && (e.key === "k" || e.key === "p"));
      if (e.key === "escape") return hide();
      if (ctrl && e.key === "space") preview(selected);
      else if (down && count) view.at = (view.at + 1) % count;
      else if (up && count) view.at = (view.at + count - 1) % count;
      else if (e.key === "d" && e.modifiers.control) forgetLink(selected);
      else return;
      view.scroll.scroll_to_item(view.childOf[view.at] ?? 0);
      cx.stop_propagation();
      cx.notify();
    })
    .size_full()
    .min_h(0)
    .p(18)
    .gap(10)
    .bg(t.popover)
    .text_size(13)
    .child(div().text_size(15).font_semibold().text_color(t.foreground).truncate().child(it ? `Sessions · ${refOf(it)}${it.title ? ` ${it.title}` : ""}` : "Tasks"))
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
        .child(Input.new(view.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
    )
    .child(
      v_flex()
        .id("tk-list")
        .flex_1()
        .min_h(0)
        .overflow_y_scrollbar()
        .track_scroll(view.scroll)
        .children(children)
        .when(only && unplaced.length > 0, (el) => el.child(div().px(10).pt(8).text_size(12).text_color(t.dim).child(`No checkout of ${unplaced.join(", ")} in the sidebar's folders or spaces to start a session in.`)))
        .when(only && !props()?.start?.repos?.length && !props()?.start?.others, (el) => el.child(div().px(10).pt(8).text_size(12).text_color(t.dim).child("No repo to start a session in.")))
        .when(empty, (el) => el.child(div().p(10).text_color(t.dim).child(none ? "No linked tasks yet. Link a PR, issue or card to an agent with ctrl-a g, or to its space with ctrl-a G." : "No matching tasks."))),
    )
    .when(Boolean(view.error), (el) => el.child(div().text_color(t.blocked).child(view.error)))
    .child(h_flex().justify_end().text_size(11).text_color(t.dim).child([hintOf(view, selected), (selected?.task || props()?.url) && "⌃space preview", "esc close"].filter(Boolean).join(" · ")));
}
