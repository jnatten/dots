// Quick Look at a Claude session (⌃space in the session search): its title, branches, PRs and
// issues, folder and age, then its conversation (peek.mjs, run where the session ran) a block at
// a time: your prompts, Claude's replies, and each run of tool calls as one line (t lists them).
// j/k pick a block, ↵ resumes the session (goes to it while it runs), space or esc close.
// A jj-sessions overlay with props { peek, query, parent }: peek is the search's row, query what
// was searched (the newest block with all of it is picked first, else the last one), parent the
// search, closed too once ↵ has resumed.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle, TextView } from "gpui-base";
import { props, closeOverlay, settings, shared, exec, run } from "herdr";
import { ago, label, facts, keyOf, script } from "./sessions.js";
import { GH } from "./tasks.js";

const ICON = (name) => `mods/workspace-chrome/${name}.svg`;
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const LIST = 30;

// What peek.mjs said, by session, for the next opening while the new one loads.
const memory = {};

const open = (url, cx) => url && cx.spawn(async () => { await exec("open", [url]).catch(() => null); });

async function read(s) {
  const r = await script("peek.mjs", [s.id], s.machine ?? null);
  if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || "Couldn't read its transcript.");
  const data = JSON.parse(r.stdout);
  if (data.error) throw new Error(data.error);
  return data;
}

// Every block j/k can pick, each one child of the scrolled column.
function blocksOf(data) {
  const first = data.total - data.turns.length;
  return data.turns.flatMap((turn, i) => [
    ...(turn.prompt ? [{ key: `${first + i}`, kind: "prompt", at: turn.at, text: turn.prompt }] : []),
    ...turn.steps.map((step, j) => (step.md ? { key: `${first + i}-${j}`, kind: "md", text: step.md, lead: !turn.steps.slice(0, j).some((s) => s.md) } : { key: `${first + i}-${j}`, kind: "tools", tools: step.tools })),
  ]);
}

const textOf = (b) => (b.kind === "tools" ? b.tools.map((c) => `${c.name} ${c.what}`).join(" ") : b.text).toLowerCase();

// The newest block with every word of the search, else the last one.
function startAt(blocks) {
  const words = (props()?.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  for (let i = blocks.length - 1; words.length && i >= 0; i--) if (words.every((w) => textOf(blocks[i]).includes(w))) return i;
  return Math.max(0, blocks.length - 1);
}

function place(view, data) {
  if (view.placed || !data) return;
  view.placed = true;
  view.at = startAt(blocksOf(data));
  view.scroll.scroll_to_item(view.at);
}

function load(view, cx) {
  const s = props().peek;
  if (view.loading) return;
  view.loading = true;
  view.error = "";
  cx.spawn(async (cx) => {
    try {
      memory[keyOf(s)] = await read(s);
    } catch (e) {
      view.error = String(e?.message ?? e);
    }
    view.loading = false;
    place(view, memory[keyOf(s)]);
    cx.notify();
  });
}

export function peekInit(view, cx) {
  view.at = 0;
  view.tools = false;
  view.placed = false;
  view.scroll = ScrollHandle.new();
  place(view, memory[keyOf(props().peek)]);
  load(view, cx);
}

// ↵: goes to a running session, else resumes it where it ran (here: in its repo when its folder
// is gone), or (bringIt) brings it from another machine; the search goes too.
function go(view, cx, here, bringIt) {
  const s = props().peek;
  const done = () => {
    if (props()?.parent) closeOverlay(props().parent);
    view.hide();
  };
  if (s.kind === "open") {
    done();
    return run("pane.focus", { pane: s.pane });
  }
  view.start(s, here, cx, done, bringIt);
}

function toolsLine(view, b, on, t) {
  const counts = {};
  for (const c of b.tools) counts[c.name] = (counts[c.name] ?? 0) + 1;
  const summary = Object.entries(counts).sort((a, z) => z[1] - a[1]).map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(" · ");
  const mono = settings()?.font_family ?? "Menlo";
  return v_flex()
    .id(`pk-${b.key}`)
    .flex_none()
    .px(10)
    .py(6)
    .gap(4)
    .rounded(6)
    .when(on, (el) => el.bg(t.selected))
    .child(h_flex().gap(8).items_center().text_size(12).text_color(t.dim)
      .child(svg(ICON(view.tools ? "chevron-down" : "chevron-right")).flex_none().size(11).text_color(t.dim))
      .child(div().flex_none().child(`${b.tools.length} tool call${b.tools.length === 1 ? "" : "s"}`))
      .child(div().flex_1().min_w(0).truncate().child(summary)))
    .when(view.tools, (el) => el.children([
      ...b.tools.slice(0, LIST).map((c) => h_flex().pl(19).gap(8).text_size(11.5).text_color(t.muted)
        .child(div().flex_none().font_family(mono).child(c.name))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(c.what))),
      ...(b.tools.length > LIST ? [div().pl(19).text_size(11.5).text_color(t.dim).child(`${b.tools.length - LIST} more`)] : []),
    ]));
}

function blockEl(view, b, on, t) {
  if (b.kind === "tools") return toolsLine(view, b, on, t);
  const card = v_flex().id(`pk-${b.key}`).flex_none().p(12).gap(6).rounded(8).border_1().border_color(on ? t.accent : t.border);
  if (b.kind === "prompt")
    return card.bg(t.raised)
      .child(h_flex().gap(6).text_size(11.5).text_color(t.dim).child(div().font_semibold().text_color(t.foreground).child("You")).child(div().child(b.at ? `${ago(b.at)} ago` : "")))
      .child(div().text_color(t.foreground).child(b.text));
  return card.bg(t.background)
    .when(b.lead, (el) => el.child(div().text_size(11.5).font_semibold().text_color(t.foreground).child("Claude")))
    .child(TextView.markdown(`pk-md-${b.key}`, b.text).selectable(true).text_size(13).text_color(t.foreground));
}

function header(view, s, data, t) {
  const dark = Boolean(settings()?.dark);
  const more = facts(s, shared("github")?.items ?? {}, shared("tasks.sessions") ?? {});
  const shown = data ? data.turns.length : 0;
  const line = [
    s.machine,
    `${label(s.cwd)}${s.gone ? " · gone" : ""}`,
    s.kind === "open" ? s.status : s.at ? `${ago(s.at)} ago` : null,
    data && `${data.total} turn${data.total === 1 ? "" : "s"}${data.total > shown ? `, the last ${shown} here` : ""}`,
    data?.started && `started ${ago(data.started)} ago`,
  ].filter(Boolean);
  return v_flex().flex_none().gap(6)
    .child(h_flex().gap(8).items_center()
      .child(s.kind === "open" ? div().flex_none().size(8).rounded(4).bg(t[s.status] ?? t.idle) : svg(ICON("clock")).flex_none().size(14).text_color(t.dim))
      .child(div().min_w(0).truncate().text_size(16).font_semibold().text_color(t.foreground).child(s.title || "Claude")))
    .when(more.length > 0, (el) => el.child(h_flex().flex_wrap().gap_x(12).gap_y(4).items_center().text_size(12)
      .children(more.map((m, i) => {
        const state = GH[m.state];
        return h_flex().id(`pk-fact-${i}`).max_w(360).gap(5).items_center().text_color(t.muted)
          .when(Boolean(m.url), (el) => el.cursor_pointer().hover((st) => st.text_color(t.foreground)).on_click((_e, cx) => open(m.url, cx)))
          .child(svg(state?.icon ?? m.icon).flex_none().size(12).text_color(state ? state.color[dark ? 1 : 0] : t.dim))
          .child(div().min_w(0).truncate().child(m.text));
      }))))
    .child(h_flex().flex_wrap().gap_x(12).gap_y(4).text_size(12).text_color(t.dim).children(line.map((f) => div().child(f))));
}

export function peekRender(view, t) {
  const s = props()?.peek ?? {};
  const data = memory[keyOf(s)] ?? null;
  const blocks = data ? blocksOf(data) : [];
  view.at = Math.max(0, Math.min(view.at, blocks.length - 1));
  const pick = (i) => {
    view.at = Math.max(0, Math.min(blocks.length - 1, i));
    view.scroll.scroll_to_item(view.at);
  };
  const resuming = s.kind === "open" ? "↵ go to" : s.gone ? view.goneHint(s, "↵", "⇧↵") : `↵ resume${s.machine ? ` on ${s.machine}` : ""}`;
  const hint = [view.busy ? "resuming…" : resuming, s.kind !== "open" && s.machine && "⌘↵ bring here", "j/k move", `t ${view.tools ? "hide" : "show"} tool calls`, "space close"].filter(Boolean).join(" · ");
  return v_flex()
    .id("peek")
    .track_focus(view.handle)
    .on_key_down((e, cx) => {
      const m = e.modifiers;
      if (e.key === "escape" || (e.key === "space" && !m.alt && !m.platform)) return view.hide();
      if (e.key === "enter") go(view, cx, m.shift, m.platform);
      else if (m.control && e.key === "d") pick(view.at + 4);
      else if (m.control && e.key === "u") pick(view.at - 4);
      else if (m.control || m.alt || m.platform) return;
      else if (e.key === "j" || e.key === "down") pick(view.at + 1);
      else if (e.key === "k" || e.key === "up") pick(view.at - 1);
      else if (e.key === "g" && !m.shift) pick(0);
      else if (e.key === "g" || e.key === "G") pick(blocks.length - 1);
      else if (e.key === "t") view.tools = !view.tools;
      else if (e.key === "r") load(view, cx);
      else return;
      cx.stop_propagation();
      cx.notify();
    })
    .size_full()
    .min_h(0)
    .p(18)
    .gap(12)
    .bg(t.popover)
    .text_size(13)
    .child(header(view, s, data, t))
    .child(v_flex().id("pk-list").flex_1().min_h(0).gap(8).overflow_y_scrollbar().track_scroll(view.scroll)
      .children(blocks.map((b, i) => blockEl(view, b, i === view.at, t).cursor_pointer().on_click((_e, cx) => {
        view.at = i;
        if (b.kind === "tools") view.tools = !view.tools;
        cx.notify();
      })))
      .when(!data && !view.error, (el) => el.child(h_flex().gap(6).p(10).text_color(t.dim).child(div().frames(SPIN, 90)).child("Reading its transcript…"))))
    .when(Boolean(view.error), (el) => el.child(div().flex_none().text_color(t.blocked).child(view.error)))
    .child(h_flex().flex_none().gap(12).items_center().text_size(11).text_color(t.dim)
      .child(div().flex_1().min_w(0).truncate().child(view.loading && data ? "refreshing…" : ""))
      .child(div().flex_none().child(hint)));
}
