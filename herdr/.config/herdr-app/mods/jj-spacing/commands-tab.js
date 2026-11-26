// The spacing dialog's Commands tab: which programs in front of a shell don't count as a
// running command (no mark on their space or tab, jj-spaces/commands.js). The defaults, on
// unless turned off (`keep`), those added here (`skip`), and those that ran lately
// (shared("commands.seen")) to tick. Kept as shared("jj-commands").

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { shared, setShared } from "herdr";

// jj-spaces/commands.js's SKIP.
const SKIP = ["nvim", "vim", "vi", "hx", "emacs", "nano", "less", "man", "lazygit", "jjui", "tig", "gitui", "htop", "btop", "top", "k9s", "yazi", "ranger", "lf", "ssh", "mosh", "tmux", "zellij"];
const KEY = "jj-commands";
const DEFAULTS = { skip: [], keep: [] };
const value = () => ({ ...DEFAULTS, ...(shared(KEY) ?? {}) });

function save(change) {
  const next = change(value());
  setShared(KEY, Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(DEFAULTS[k]))));
}

function rows() {
  const cfg = value();
  const keep = new Set(cfg.keep);
  const listed = new Set([...SKIP, ...cfg.skip]);
  const named = new Map((shared("commands.seen") ?? []).map((p) => [p.id, p.name]));
  const about = (id, kind) => (named.has(id) && named.get(id).toLowerCase() !== id ? `${named.get(id)} · ${kind}` : kind);
  return [
    ...SKIP.map((id) => ({ kind: "default", id, about: about(id, "default"), on: !keep.has(id) })),
    ...cfg.skip.filter((id) => !SKIP.includes(id)).map((id) => ({ kind: "added", id, about: about(id, "added"), on: true })),
    ...[...named.keys()].filter((id) => !listed.has(id)).map((id) => ({ kind: "seen", id, about: about(id, "ran lately"), on: false })),
  ];
}

function toggle(row) {
  if (row.kind === "default") save((c) => ({ ...c, keep: row.on ? [...c.keep, row.id] : c.keep.filter((p) => p !== row.id) }));
  else save((c) => ({ ...c, skip: row.on ? c.skip.filter((p) => p !== row.id) : [...c.skip, row.id] }));
}

export function commandsTabInit(view) {
  view.command = 0;
  view.addProgram = InputState.new({ placeholder: "Add a program: its process name, e.g. k9s" });
  view.addProgram.on("focus", (_e, cx) => { view.editing = "add-program"; cx.notify(); });
  view.addProgram.on("blur", (_e, cx) => { view.editing = null; cx.notify(); });
  view.addProgram.on("submit", (_e, cx) => {
    const id = view.addProgram.value().trim().toLowerCase();
    if (id) save((c) => (SKIP.includes(id) ? { ...c, keep: c.keep.filter((p) => p !== id) } : { ...c, skip: [...c.skip.filter((p) => p !== id), id] }));
    view.addProgram.set_value("");
    view.handle.focus();
    cx.notify();
  });
}

export function commandsKey(view, e) {
  const list = rows();
  const n = list.length;
  if (e.key === "up" || e.key === "k") view.command = (view.command + n - 1) % n;
  else if (e.key === "down" || e.key === "j") view.command = (view.command + 1) % n;
  else if (e.key === "space" || e.key === "enter") toggle(list[Math.min(view.command, n - 1)]);
  else if (e.key === "a") view.addProgram.focus();
  else return false;
  return true;
}

export function commandsTab(view, t) {
  const list = rows();
  view.command = Math.min(view.command, list.length - 1);
  const check = (on) => div().size(14).flex_none().flex().items_center().justify_center().rounded(4).border_1()
    .border_color(on ? t.accent : t.input).when(on, (el) => el.bg(t.accent).text_color(t.accent_foreground))
    .when(on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(10)));
  const row = (r, i) => h_flex()
    .id(`command-${r.id}`)
    .h(30)
    .px(8)
    .gap(10)
    .flex_none()
    .items_center()
    .rounded(7)
    .cursor_pointer()
    .when(i === view.command, (el) => el.bg(t.selected))
    .when(i !== view.command, (el) => el.hover((s) => s.bg(t.hover)))
    .on_click((_e, cx) => { view.command = i; toggle(r); cx.notify(); })
    .child(check(r.on))
    .child(div().flex_1().min_w(0).truncate().text_color(r.on ? t.foreground : t.muted).child(r.id))
    .child(div().flex_none().text_size(11.5).text_color(t.dim).child(r.about));
  const section = (label) => div().px(8).pt(8).pb(2).flex_none().text_size(11).text_color(t.dim).child(label);
  const children = [
    section("Not counted as running: ticked programs never mark their space or tab"),
    h_flex().px(8).py(2).flex_none()
      .child(Input.new(view.addProgram).flex_1().min_w(0).h(28).px(8).items_center().rounded(6).border(1)
        .border_color(view.editing === "add-program" ? t.accent : t.input).bg(t.background).text_color(t.foreground)),
  ];
  list.forEach((r, i) => {
    if (r.kind === "seen" && list[i - 1]?.kind !== "seen") children.push(section("Ran lately"));
    children.push(row(r, i));
  });
  return {
    body: v_flex().id("command-list").flex_1().min_h(0).gap(2).overflow_y_scrollbar().children(children),
    reset: Object.keys(shared(KEY) ?? {}).length ? () => setShared(KEY, {}) : null,
    resetLabel: "Reset to defaults",
    hint: view.editing === "add-program" ? "↵ add · esc close" : "↑↓ choose · space toggle · a add program · tab spacing · esc close",
  };
}
