// The folder dialog: a folder's name, color and where it is on each machine. A
// jj-spaces overlay with props { folder: { id? (an existing one), from? (a space whose
// repo to start a new one from) } }. Saving asks the sidebar to keep it
// (shared("space-folders.ask")); what it shows comes from shared("space-folders").

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme, spaces, panes, exec, shared, setShared, pickFolder } from "herdr";
import { MARK, base, expand, tilde, trim } from "./folders.js";

const COLORS = [null, ...Object.keys(MARK)];
const info = () => shared("space-folders") ?? {};
const label = (key) => key || "This computer";
const ask = (op) => setShared("space-folders.ask", [...(shared("space-folders.ask") ?? []), op]);

export function folderInit(view, cx) {
  const p = props()?.folder ?? {};
  const sf = info();
  const homes = sf.homes ?? {};
  const f = p.id ? (sf.folders ?? []).find((x) => x.id === p.id) : null;
  view.id = f?.id ?? null;
  view.color = f?.color ?? null;
  view.error = "";
  view.busy = false;
  view.name = InputState.new({ placeholder: "Name", value: f?.name ?? "" });
  view.name.on("submit", (_e, cx) => save(view, cx));
  view.rows = ["", ...(sf.machines ?? []).map((m) => m.name)].map((key) => {
    const at = f?.paths?.[key];
    const own = at?.own ? at.path : "";
    const placeholder = at && !at.own ? `${tilde(at.path, homes[key])} (from another machine)` : f ? "Not here" : key ? "As on this computer" : "~/dev/project";
    const input = InputState.new({ placeholder, value: own ? tilde(own, homes[key]) : "" });
    input.on("submit", (_e, cx) => save(view, cx));
    return { key, input, was: own };
  });
  view.name.focus();
  if (p.from) prefill(view, p.from, cx);
}

// A new folder for a space: its repo (the main checkout, for a worktree), on its machine.
function prefill(view, id, cx) {
  const s = spaces().find((x) => x.id === id);
  if (!s) return;
  const key = s.machine ?? "";
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  const cwd = panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
  cx.spawn(async (cx) => {
    const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on: s.machine }).catch(() => null);
    const common = r?.code === 0 ? trim(r.stdout.replace(/\n$/, "")) : null;
    const root = common?.endsWith("/.git") ? common.slice(0, -5) : cwd;
    if (!root) return;
    const row = view.rows.find((r) => r.key === key);
    if (row && !row.input.value()) row.input.set_value(tilde(root, info().homes?.[key]));
    if (!view.name.value()) view.name.set_value(base(root));
    cx.notify();
  });
}

function fail(view, error, cx) {
  view.error = error;
  view.busy = false;
  cx.notify();
}

function save(view, cx) {
  if (view.busy) return;
  const homes = info().homes ?? {};
  const paths = {};
  for (const r of view.rows) {
    if (!r.editable) continue;
    const text = r.input.value().trim();
    const path = text ? expand(text, homes[r.key]) : "";
    if (path === null) return fail(view, `${label(r.key)}: its home isn't known yet, give the whole path.`, cx);
    if (text && !path.startsWith("/")) return fail(view, `${label(r.key)}: give a path from / or ~.`, cx);
    if (path !== r.was) paths[r.key] = path || null;
  }
  const first = view.rows.map((r) => r.input.value().trim()).find(Boolean);
  const name = view.name.value().trim() || (first ? base(first) : "");
  if (!name) return fail(view, "Give it a name or a path.", cx);
  view.busy = true;
  view.error = "";
  cx.notify();
  cx.spawn(async (cx) => {
    for (const [key, path] of Object.entries(paths)) {
      if (!path) continue;
      const r = await exec("test", ["-d", path], { on: key || null }).catch(() => null);
      if (!r) return fail(view, `Couldn't reach ${label(key)}.`, cx);
      if (r.code !== 0) return fail(view, `${path} isn't a folder on ${key || "this computer"}.`, cx);
    }
    ask({ op: "save", id: view.id, name, color: view.color, paths });
    closeOverlay(props().overlay);
  });
}

function choose(view, row, cx) {
  cx.spawn(async (cx) => {
    const path = await pickFolder({ prompt: "Choose" });
    if (!path) return;
    row.input.set_value(tilde(trim(path), info().homes?.[row.key]));
    cx.notify();
  });
}

export function folderRender(view) {
  const t = theme();
  const states = new Map((info().machines ?? []).map((m) => [m.name, m.state]));
  const field = (state) => Input.new(state).h(30).px(9).flex_1().min_w(0).items_center().rounded(6).border(1).border_color(t.input).bg(t.background).text_color(t.foreground);
  const button = (id, text, primary, click) => div().id(id).flex_none().px(12).py(5).rounded(6).cursor_pointer()
    .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
    .when(!primary, (el) => el.hover((s) => s.bg(t.hover))).on_click(click).child(text);
  const pathRow = (r) => {
    r.editable = !r.key || states.get(r.key) === "connected";
    return h_flex().id(`folder-path-${r.key || "local"}`).gap(8).items_center().flex_none()
      .child(h_flex().w(118).flex_none().gap(6).items_center().text_color(t.muted)
        .child(svg(`mods/workspace-chrome/${r.key ? "server" : "monitor"}.svg`).size(12).flex_none())
        .child(div().min_w(0).truncate().child(label(r.key))))
      .when(r.editable, (el) => el.child(field(r.input)))
      .when(!r.editable, (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim)
        .child(`${r.was ? `${r.was} · ` : ""}${(states.get(r.key) ?? "asleep").replace(/_/g, " ")}, can't change it now`)))
      .when(!r.key, (el) => el.child(button("folder-choose", "Choose…", false, (_e, cx) => choose(view, r, cx))));
  };
  const dots = h_flex().gap(6).flex_none().items_center().children(COLORS.map((c) => div().id(`folder-color-${c ?? "none"}`).size(16).rounded(8).cursor_pointer()
    .bg(c ? MARK[c] : t.dim)
    .when(view.color === c, (el) => el.border_2().border_color(t.foreground))
    .on_click((_e, cx) => { view.color = c; cx.notify(); })));

  return v_flex()
    .id("folder-dialog")
    .size_full()
    .p(16)
    .gap(12)
    .bg(t.popover)
    .text_size(13)
    .child(div().flex_none().font_semibold().text_color(t.foreground).child(view.id ? "Edit folder" : "New folder"))
    .child(h_flex().gap(10).items_center().flex_none().child(field(view.name)).child(dots))
    .child(v_flex().gap(6).flex_none()
      .child(div().text_size(11).text_color(t.dim).child("Where it is"))
      .children(view.rows.map(pathRow)))
    .child(div().flex_none().text_size(11).text_color(t.dim)
      .child("Spaces in a folder's path go in it, worktrees nested there too. A machine left empty uses another's path, moved to its own home."))
    .when(Boolean(view.error), (el) => el.child(div().flex_none().text_color(t.blocked).child(view.error)))
    .child(div().flex_1())
    .child(h_flex().gap(8).items_center().flex_none()
      .when(Boolean(view.id), (el) => el.child(button("folder-delete", "Delete", false, () => {
        ask({ op: "delete", id: view.id });
        closeOverlay(props().overlay);
      })))
      .child(div().flex_1())
      .child(button("folder-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
      .child(button("folder-save", view.busy ? "Saving…" : "Save", true, (_e, cx) => save(view, cx))));
}
