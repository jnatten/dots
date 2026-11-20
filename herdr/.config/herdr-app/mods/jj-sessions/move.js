// Moving a Claude session to another machine (ctrl-a m, or an agent's menu): the machines it
// could go to, each with the folder it would land in there (sessions.js' mapPath), and on ↵
// sessions.js' move. Its code isn't moved: push and fetch that yourself.
// A jj-sessions overlay with props { move: terminalAddress }.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, shared, props, closeOverlay } from "herdr";
import { mapPath, move } from "./sessions.js";

const ICON = (name) => `mods/workspace-chrome/${name}.svg`;

// The session in the terminal: { id, cwd, machine, title }, or null when it isn't a Claude one (yet).
function sessionOf() {
  const address = props()?.move ?? "";
  const t = terminals().find((t) => t.address === address);
  const id = t?.labels?.["claude.session"];
  if (!id) return null;
  const a = agents().find((a) => a.address === address);
  return { id, cwd: t.labels["claude.cwd"] || t.cwd || "", machine: address.includes("/") ? address.split("/")[0] : null, title: t.labels["jj.description"] || a?.title || "Claude" };
}

// Where it could go: every other machine, connected ones first, with its folder there.
function targetsOf(s) {
  const sf = shared("space-folders") ?? {};
  const machines = [{ name: null, state: "connected" }, ...(sf.machines ?? [])].filter((m) => (m.name ?? "") !== (s.machine ?? ""));
  const homeOf = (m) => sf.homes?.[m ?? ""];
  return machines
    .map((m) => {
      const path = mapPath(s.cwd, s.machine, m.name);
      const home = homeOf(m.name);
      return { name: m.name, connected: m.state === "connected", path, shown: path && home && path.startsWith(home) ? `~${path.slice(home.length)}` : path };
    })
    .sort((a, b) => Boolean(b.connected && b.path) - Boolean(a.connected && a.path));
}

export function moveInit(view) {
  view.at = 0;
  view.busy = false;
  view.error = "";
}

function go(view, s, target, cx) {
  if (view.busy || !target?.connected || !target.path) return;
  view.busy = true;
  view.error = "";
  cx.notify();
  cx.spawn(async (cx) => {
    view.error = await move(s, target.name).catch((e) => String(e?.message ?? e));
    view.busy = false;
    if (!view.error) closeOverlay(props().overlay);
    cx.notify();
  });
}

export function moveRender(view, t) {
  const s = sessionOf();
  const targets = s ? targetsOf(s) : [];
  view.at = Math.max(0, Math.min(view.at, targets.length - 1));
  const row = (m, i) => {
    const usable = m.connected && m.path;
    return h_flex()
      .id(`mv-${m.name ?? "here"}`)
      .h(34)
      .flex_none()
      .px(10)
      .gap(9)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .when(i === view.at, (el) => el.bg(t.selected))
      .when(i !== view.at, (el) => el.hover((st) => st.bg(t.hover)))
      .on_click((_e, cx) => {
        view.at = i;
        go(view, s, m, cx);
      })
      .child(svg(ICON(m.name ? "server" : "monitor")).size(14).flex_none().text_color(usable ? t.foreground : t.dim))
      .child(div().flex_none().text_color(usable ? t.foreground : t.dim).child(m.name ?? "This computer"))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim)
        .child(!m.connected ? "not connected" : m.path ? m.shown : "no folder there: give its sidebar folder a path on it"));
  };
  const hint = view.busy ? "copying and starting it there…" : targets.length ? "↑↓ choose · ↵ move · esc cancel" : "esc close";
  return v_flex()
    .id("move")
    .track_focus(view.handle)
    .on_key_down((e, cx) => {
      if (e.key === "escape") return closeOverlay(props().overlay);
      if (view.busy) return;
      const n = targets.length;
      if ((e.key === "down" || e.key === "j") && n) view.at = (view.at + 1) % n;
      else if ((e.key === "up" || e.key === "k") && n) view.at = (view.at + n - 1) % n;
      else if (e.key === "enter") go(view, s, targets[view.at], cx);
      else return;
      cx.stop_propagation();
      cx.notify();
    })
    .size_full()
    .p(16)
    .gap(10)
    .bg(t.popover)
    .text_size(13)
    .child(div().flex_none().truncate().font_semibold().text_color(t.foreground).child(s ? `Move ${s.title} to…` : "Move session"))
    .child(div().flex_none().text_size(12).text_color(t.dim)
      .child(s ? "Its conversation goes along and resumes there. Push its code changes yourself." : "This isn't a Claude session, or it hasn't said its session yet."))
    .child(v_flex().flex_1().min_h(0).gap(2).children(targets.map(row))
      .when(Boolean(s) && !targets.length, (el) => el.child(div().p(10).text_color(t.dim).child("No other machine. Add one with hc machine add."))))
    .when(Boolean(view.error), (el) => el.child(div().flex_none().text_color(t.blocked).child(view.error)))
    .child(h_flex().flex_none().justify_end().text_size(11).text_color(t.dim).child(hint));
}
