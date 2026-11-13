// The link dialog: a space's GitHub PRs and issues, those linked by hand beside
// its branch's PR and its Claude sessions', then its repo's open PRs to link.
// Typing filters both (a number picks that one; a URL or owner/repo#12 is looked
// up). ^D (or the row's button) unlinks one linked by hand, and hides the others
// from the space and its agents (shared("github.hidden")) until ^D shows them
// again. A jj-spaces overlay with props { link: spaceId }.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { props, closeOverlay, theme, spaces, panes, agents, exec, shared, setShared } from "herdr";
import { badges, githubRepo, openPrs, resolve } from "./github.js";

const spaceOf = () => spaces().find((s) => s.id === props()?.link);
const open = (url, cx) => cx.spawn(async () => { await exec("open", [url]).catch(() => null); });

export function linkInit(view, cx) {
  view.resolved = {}; // url -> item, until the sidebar has asked GitHub itself
  view.error = "";
  view.busy = false;
  view.repo = undefined;
  view.open = undefined; // the repo's open PRs; null when there are none to list
  view.at = 0;
  view.rows = [];
  view.childOf = [];
  view.scroll = ScrollHandle.new();
  view.handle = cx.focus_handle();
  view.input = InputState.new({ placeholder: "Filter open PRs, or paste a URL, owner/repo#12 or #12" });
  view.input.on("change", (_e, cx) => { view.error = ""; view.at = 0; cx.notify(); });
  view.input.on("submit", (_e, cx) => enter(view, cx));
  view.input.focus();
  const s = spaceOf();
  if (!s) return;
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  const folder = panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
  cx.spawn(async (cx) => {
    const r = await exec("git", ["remote", "get-url", "origin"], { cwd: folder, on: s.machine }).catch(() => null);
    view.repo = r?.code === 0 ? githubRepo(r.stdout) : null;
    cx.notify();
    if (!view.repo) return (view.open = null);
    try {
      view.open = await openPrs(view.repo);
    } catch (e) {
      view.open = null;
      view.error = String(e?.message ?? e);
    }
    cx.notify();
  });
}

function link(view, it) {
  const id = props()?.link;
  if (!id) return;
  view.resolved[it.url] = it;
  const links = shared("github.links") ?? {};
  const mine = links[id] ?? [];
  if (!mine.includes(it.url)) setShared("github.links", { ...links, [id]: [...mine, it.url] });
  view.input.set_value("");
}

// ↵: links the chosen open PR, opens the chosen linked one, or looks up what's typed.
function enter(view, cx) {
  const sel = view.rows[view.at];
  if (sel?.pr) return link(view, sel.pr);
  if (sel) return open(sel.url, cx);
  const text = view.input.value();
  if (view.busy || !text.trim()) return;
  view.busy = true;
  view.error = "";
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      link(view, await resolve(text, view.repo));
    } catch (e) {
      view.error = String(e?.message ?? e);
    }
    view.busy = false;
    cx.notify();
  });
}

// Unlinks a row linked by hand; hides or shows again one from the branch or Claude.
function drop(id, r) {
  if (!r || r.pr) return;
  const key = r.own ? "github.links" : "github.hidden";
  const all = shared(key) ?? {};
  const mine = all[id] ?? [];
  setShared(key, { ...all, [id]: r.own || r.hidden ? mine.filter((u) => u !== r.url) : [...mine, r.url] });
}

// What's typed: nothing (everything), a number (that one), a reference elsewhere
// (nothing here: ↵ looks it up), or words every one of which must appear.
function filter(text) {
  const s = text.trim().toLowerCase();
  const n = s.match(/^#?(\d+)$/);
  if (!s) return () => true;
  if (n) return (it) => it?.number === Number(n[1]);
  if (/github\.com\/|^[\w.-]+\/[\w.-]+#\d+$/.test(s)) return () => false;
  const words = s.split(/\s+/);
  return (it, url) => words.every((w) => `#${it?.number ?? ""} ${it?.title ?? ""} ${it?.branch ?? ""} ${it?.author ?? ""} ${url}`.toLowerCase().includes(w));
}

export function linkRender(view) {
  const t = theme();
  const s = spaceOf();
  const id = props()?.link;
  const gh = shared("github") ?? {};
  const items = { ...view.resolved, ...(gh.items ?? {}) };
  const hidden = new Set(shared("github.hidden")?.[id] ?? []);
  const text = view.input.value().trim();
  const wanted = filter(text);
  const linked = [];
  const seen = new Set();
  const push = (url, from, own) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    linked.push({ url, from, own, hidden: !own && hidden.has(url) });
  };
  for (const url of shared("github.links")?.[id] ?? []) push(url, "linked", true);
  push(gh.branches?.[id], "branch");
  for (const a of agents().filter((a) => a.space === id)) for (const url of gh.agents?.[a.address] ?? []) push(url, `Claude · ${a.tab_name || a.title || a.address}`);
  const mine = linked.filter((r) => wanted(items[r.url], r.url));
  const candidates = (view.open ?? []).filter((p) => !seen.has(p.url));
  const others = candidates.filter((p) => wanted(p, p.url)).map((p) => ({ url: p.url, pr: p }));
  view.rows = [...mine, ...others];
  view.at = Math.min(view.at, Math.max(0, view.rows.length - 1));
  const selected = view.rows[view.at];
  const verb = (r) => (r.own ? "unlink" : r.hidden ? "show" : "hide");

  const base = (r, i) => h_flex()
    .id(`${r.pr ? "open" : "link"}-${r.url}`)
    .h(30)
    .px(8)
    .gap(8)
    .flex_none()
    .items_center()
    .rounded(7)
    .cursor_pointer()
    .when(i === view.at, (el) => el.bg(t.selected))
    .when(i !== view.at, (el) => el.hover((el) => el.bg(t.hover)));
  const linkedRow = (r, i) => base(r, i)
    .when(r.hidden, (el) => el.opacity(0.5))
    .on_click((_e, cx) => open(r.url, cx))
    .child(div().w(52).flex_none().child(badges([r.url], items, t, `link-badge-${r.url}`, 1)))
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(items[r.url]?.title || r.url.replace(/^https:\/\/github\.com\//, "")))
    .child(div().flex_none().max_w(160).truncate().text_size(11).text_color(t.dim).child(r.hidden ? `hidden · ${r.from}` : r.from))
    .child(div().id(`drop-${r.url}`).flex_none().p(2).rounded(4).text_color(t.dim)
      .hover((el) => el.bg(t.selected).text_color(t.foreground))
      .tooltip(r.own ? "Unlink" : r.hidden ? "Show in the sidebar" : "Hide from the sidebar")
      .on_click((_e, cx) => { cx.stop_propagation(); drop(id, r); })
      .child(svg(`mods/workspace-chrome/${r.hidden ? "plus" : "x"}.svg`).size(12)));
  const openRow = (r, i) => base(r, i)
    .on_click((_e, cx) => { link(view, r.pr); cx.notify(); })
    .child(div().w(52).flex_none().child(badges([r.url], { [r.url]: r.pr }, t, `open-badge-${r.url}`, 1)))
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(r.pr.title))
    .child(div().flex_none().max_w(200).truncate().text_size(11).text_color(t.dim).child(r.pr.mine ? r.pr.branch : `${r.pr.author} · ${r.pr.branch}`));
  const header = (label) => h_flex().h(26).px(8).pt(6).flex_none().items_center().text_size(11).text_color(t.dim).child(label);

  const children = [];
  view.childOf = [];
  let n = 0;
  if (mine.length) children.push(header("Linked"));
  for (const r of mine) { view.childOf[n] = children.length; children.push(linkedRow(r, n++)); }
  if (view.repo) {
    const count = others.length === candidates.length ? `${candidates.length}` : `${others.length} of ${candidates.length}`;
    children.push(header(view.open === undefined ? `Open in ${view.repo} · loading…` : `Open in ${view.repo} · ${count}`));
  }
  for (const r of others) { view.childOf[n] = children.length; children.push(openRow(r, n++)); }
  const empty = !view.rows.length && view.open !== undefined;
  const why = !text
    ? "Nothing linked yet. Its branch's PR and PRs its Claude sessions open show up here too."
    : /github\.com\/|^[\w.-]+\/[\w.-]+#\d+$/.test(text) ? "↵ looks it up on GitHub."
    : /^#?\d+$/.test(text) ? `${text.replace(/^#?/, "#")} isn't here: ↵ looks it up on GitHub.`
    : "Nothing matches.";

  const hint = view.busy ? "looking it up…" : [
    view.rows.length > 1 ? "↑↓ choose" : "",
    selected?.pr ? "↵ link" : selected ? "↵ open" : text ? "↵ look up" : "",
    selected && !selected.pr ? `^D ${verb(selected)}` : "",
    "esc close",
  ].filter(Boolean).join(" · ");

  return v_flex()
    .id("links")
    .track_focus(view.handle)
    .on_key_down((e, cx) => {
      const ctrl = e.modifiers.control && !e.modifiers.platform && !e.modifiers.alt && !e.modifiers.shift;
      const count = view.rows.length;
      if (e.key === "escape") return closeOverlay(props().overlay);
      if ((e.key === "down" || (ctrl && (e.key === "j" || e.key === "n"))) && count) view.at = (view.at + 1) % count;
      else if ((e.key === "up" || (ctrl && (e.key === "k" || e.key === "p"))) && count) view.at = (view.at + count - 1) % count;
      else if (ctrl && e.key === "d") drop(id, selected);
      else return;
      view.scroll.scroll_to_item(view.childOf[view.at] ?? 0);
      cx.stop_propagation();
      cx.notify();
    })
    .size_full()
    .p(16)
    .gap(10)
    .bg(t.popover)
    .text_size(13)
    .child(div().flex_none().truncate().font_semibold().text_color(t.foreground).child(`GitHub links${s ? ` of ${s.name}` : ""}`))
    .child(Input.new(view.input).h(32).px(10).flex_none().items_center().rounded(6).border(1).border_color(t.accent).bg(t.background).text_color(t.foreground))
    .when(Boolean(view.error), (el) => el.child(div().flex_none().text_color(t.blocked).child(view.error)))
    .child(v_flex().id("link-list").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(view.scroll)
      .children(children)
      .when(empty, (el) => el.child(div().p(8).text_color(t.dim).child(why))))
    .child(h_flex().flex_none().justify_end().gap(6).text_size(11).text_color(t.dim)
      .when(view.busy, (el) => el.child(div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)))
      .child(hint));
}
