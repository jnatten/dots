// The link dialog: a space's GitHub PRs and issues, those linked by hand (added
// here) beside its branch's PR and its Claude sessions'. ^D (or the row's button)
// unlinks one linked by hand, and hides the others from the space and its agents
// (shared("github.hidden")) until ^D shows them again. A jj-spaces overlay with
// props { link: spaceId }.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme, spaces, panes, agents, exec, shared, setShared } from "herdr";
import { badges, githubRepo, resolve } from "./github.js";

const spaceOf = () => spaces().find((s) => s.id === props()?.link);
const open = (url, cx) => cx.spawn(async () => { await exec("open", [url]).catch(() => null); });

export function linkInit(view, cx) {
  view.resolved = {}; // url -> item, until the sidebar has asked GitHub itself
  view.error = "";
  view.busy = false;
  view.repo = undefined;
  view.at = 0;
  view.rows = [];
  view.handle = cx.focus_handle();
  view.input = InputState.new({ placeholder: "PR or issue: URL, owner/repo#12 or #12" });
  view.input.on("change", (_e, cx) => { view.error = ""; cx.notify(); });
  view.input.on("submit", (_e, cx) => add(view, cx));
  view.input.focus();
  const s = spaceOf();
  if (!s) return;
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  const folder = panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
  cx.spawn(async (cx) => {
    const r = await exec("git", ["remote", "get-url", "origin"], { cwd: folder, on: s.machine }).catch(() => null);
    view.repo = r?.code === 0 ? githubRepo(r.stdout) : null;
    cx.notify();
  });
}

// ↵ links what's typed; with nothing typed, opens the chosen row.
function add(view, cx) {
  const text = view.input.value();
  const id = props()?.link;
  if (view.busy || !id) return;
  if (!text.trim()) {
    if (view.rows[view.at]) open(view.rows[view.at].url, cx);
    return;
  }
  view.busy = true;
  view.error = "";
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      const it = await resolve(text, view.repo);
      view.resolved[it.url] = it;
      const links = shared("github.links") ?? {};
      const mine = links[id] ?? [];
      if (!mine.includes(it.url)) setShared("github.links", { ...links, [id]: [...mine, it.url] });
      view.input.set_value("");
    } catch (e) {
      view.error = String(e?.message ?? e);
    }
    view.busy = false;
    cx.notify();
  });
}

// Unlinks a row linked by hand; hides or shows again one from the branch or Claude.
function drop(id, r) {
  if (!r) return;
  const key = r.own ? "github.links" : "github.hidden";
  const all = shared(key) ?? {};
  const mine = all[id] ?? [];
  setShared(key, { ...all, [id]: r.own || r.hidden ? mine.filter((u) => u !== r.url) : [...mine, r.url] });
}

export function linkRender(view) {
  const t = theme();
  const s = spaceOf();
  const id = props()?.link;
  const gh = shared("github") ?? {};
  const items = { ...view.resolved, ...(gh.items ?? {}) };
  const hidden = new Set(shared("github.hidden")?.[id] ?? []);
  const rows = [];
  const seen = new Set();
  const push = (url, from, own) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    rows.push({ url, from, own, hidden: !own && hidden.has(url) });
  };
  for (const url of shared("github.links")?.[id] ?? []) push(url, "linked", true);
  push(gh.branches?.[id], "branch");
  for (const a of agents().filter((a) => a.space === id)) for (const url of gh.agents?.[a.address] ?? []) push(url, `Claude · ${a.tab_name || a.title || a.address}`);
  view.rows = rows;
  view.at = Math.min(view.at, Math.max(0, rows.length - 1));
  const selected = rows[view.at];
  const verb = (r) => (r.own ? "unlink" : r.hidden ? "show" : "hide");
  const row = (r, i) => {
    const it = items[r.url];
    return h_flex()
      .id(`link-${r.url}`)
      .h(30)
      .px(8)
      .gap(8)
      .flex_none()
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .when(i === view.at, (el) => el.bg(t.selected))
      .when(i !== view.at, (el) => el.hover((el) => el.bg(t.hover)))
      .when(r.hidden, (el) => el.opacity(0.5))
      .on_click((_e, cx) => open(r.url, cx))
      .child(badges([r.url], items, t, `link-badge-${r.url}`, 1))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(it?.title || r.url.replace(/^https:\/\/github\.com\//, "")))
      .child(div().flex_none().max_w(140).truncate().text_size(11).text_color(t.dim).child(r.hidden ? `hidden · ${r.from}` : r.from))
      .child(div().id(`drop-${r.url}`).flex_none().p(2).rounded(4).text_color(t.dim)
        .hover((el) => el.bg(t.selected).text_color(t.foreground))
        .tooltip(r.own ? "Unlink" : r.hidden ? "Show in the sidebar" : "Hide from the sidebar")
        .on_click((_e, cx) => { cx.stop_propagation(); drop(id, r); })
        .child(svg(`mods/workspace-chrome/${r.hidden ? "plus" : "x"}.svg`).size(12)));
  };
  const hint = view.busy ? "looking it up…" : [rows.length > 1 ? "↑↓ choose" : "", selected ? `^D ${verb(selected)}` : "", view.input.value().trim() ? "↵ link" : selected ? "↵ open" : "", "esc close"].filter(Boolean).join(" · ");
  return v_flex()
    .id("links")
    .track_focus(view.handle)
    .on_key_down((e, cx) => {
      const ctrl = e.modifiers.control && !e.modifiers.platform && !e.modifiers.alt && !e.modifiers.shift;
      const count = rows.length;
      if (e.key === "escape") return closeOverlay(props().overlay);
      if ((e.key === "down" || (ctrl && (e.key === "j" || e.key === "n"))) && count) view.at = (view.at + 1) % count;
      else if ((e.key === "up" || (ctrl && (e.key === "k" || e.key === "p"))) && count) view.at = (view.at + count - 1) % count;
      else if (ctrl && e.key === "d") drop(id, selected);
      else return;
      cx.stop_propagation();
      cx.notify();
    })
    .size_full()
    .p(16)
    .gap(10)
    .bg(t.popover)
    .text_size(13)
    .child(h_flex().gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).child(`GitHub links${s ? ` of ${s.name}` : ""}`))
      .when(Boolean(view.repo), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(view.repo))))
    .child(Input.new(view.input).h(32).px(10).items_center().rounded(6).border(1).border_color(t.accent).bg(t.background).text_color(t.foreground))
    .when(Boolean(view.error), (el) => el.child(div().text_color(t.blocked).child(view.error)))
    .child(v_flex().id("link-list").flex_1().min_h(0).overflow_y_scroll()
      .children(rows.map(row))
      .when(rows.length === 0, (el) => el.child(div().p(8).text_color(t.dim).child("Nothing linked yet. Its branch's PR and PRs its Claude sessions open show up here too."))))
    .child(h_flex().justify_end().gap(6).text_size(11).text_color(t.dim)
      .when(view.busy, (el) => el.child(div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)))
      .child(hint));
}
