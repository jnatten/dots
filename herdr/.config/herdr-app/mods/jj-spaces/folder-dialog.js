// The folder dialog: a folder's name, color and where it is on each machine (one or
// more paths there). A
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
    const own = at?.own ? at.paths : [];
    const placeholder = at && !at.own ? `${at.paths.map((p) => tilde(p, homes[key])).join(", ")} (from another machine)` : f ? "Not here" : key ? "As on this computer" : "~/dev/project";
    const row = { key, was: own, inputs: [] };
    for (const path of own.length ? own : [""]) add(view, row, tilde(path, homes[key]), placeholder);
    return row;
  });
  view.name.focus();
  if (p.from) prefill(view, p.from, cx);
}

// One more path field for a machine's row.
function add(view, row, value = "", placeholder = "Another path") {
  const input = InputState.new({ placeholder, value });
  input.on("submit", (_e, cx) => save(view, cx));
  row.inputs.push(input);
  return input;
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
    const input = view.rows.find((r) => r.key === key)?.inputs[0];
    if (input && !input.value()) input.set_value(tilde(root, info().homes?.[key]));
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
    const list = [];
    for (const input of r.inputs) {
      const text = input.value().trim();
      if (!text) continue;
      const path = expand(text, homes[r.key]);
      if (path === null) return fail(view, `${label(r.key)}: its home isn't known yet, give the whole path.`, cx);
      if (!path.startsWith("/")) return fail(view, `${label(r.key)}: give a path from / or ~.`, cx);
      if (!list.includes(path)) list.push(path);
    }
    if (JSON.stringify(list) !== JSON.stringify(r.was)) paths[r.key] = list.length ? list : null;
  }
  const first = view.rows.flatMap((r) => r.inputs.map((i) => i.value().trim())).find(Boolean);
  const name = view.name.value().trim() || (first ? base(first) : "");
  if (!name) return fail(view, "Give it a name or a path.", cx);
  view.busy = true;
  view.error = "";
  cx.notify();
  cx.spawn(async (cx) => {
    for (const [key, list] of Object.entries(paths)) {
      for (const path of list ?? []) {
        const r = await exec("test", ["-d", path], { on: key || null }).catch(() => null);
        if (!r) return fail(view, `Couldn't reach ${label(key)}.`, cx);
        if (r.code !== 0) return fail(view, `${path} isn't a folder on ${key || "this computer"}.`, cx);
      }
    }
    ask({ op: "save", id: view.id, name, color: view.color, paths });
    closeOverlay(props().overlay);
  });
}

function choose(input, cx) {
  cx.spawn(async (cx) => {
    const path = await pickFolder({ prompt: "Choose" });
    if (!path) return;
    input.set_value(tilde(trim(path), info().homes?.[""]));
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
  const id = (r) => r.key || "local";
  const pathField = (r, input, i) => h_flex().id(`folder-path-${id(r)}-${i}`).gap(6).items_center().flex_none()
    .child(field(input))
    .when(!r.key, (el) => el.child(button(`folder-choose-${i}`, "Choose…", false, (_e, cx) => choose(input, cx))))
    .when(r.inputs.length > 1, (el) => el.child(div().id(`folder-path-drop-${id(r)}-${i}`).flex_none().p(4).rounded(4).cursor_pointer().text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip("Remove this path")
      .on_click((_e, cx) => { r.inputs.splice(i, 1); cx.notify(); })
      .child(svg("mods/workspace-chrome/x.svg").size(12))));
  const pathRow = (r) => {
    r.editable = !r.key || states.get(r.key) === "connected";
    return h_flex().id(`folder-machine-${id(r)}`).gap(8).items_start().flex_none()
      .child(h_flex().w(118).h(30).flex_none().gap(6).items_center().text_color(t.muted)
        .child(svg(`mods/workspace-chrome/${r.key ? "server" : "monitor"}.svg`).size(12).flex_none())
        .child(div().min_w(0).truncate().child(label(r.key))))
      .when(r.editable, (el) => el.child(v_flex().flex_1().min_w(0).gap(6)
        .children(r.inputs.map((input, i) => pathField(r, input, i)))
        .child(div().id(`folder-path-add-${id(r)}`).flex_none().text_size(11).text_color(t.dim).cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { add(view, r).focus(); cx.notify(); })
          .child("+ Add a path"))))
      .when(!r.editable, (el) => el.child(div().flex_1().min_w(0).h(30).flex().items_center().truncate().text_color(t.dim)
        .child(`${r.was.length ? `${r.was.join(", ")} · ` : ""}${(states.get(r.key) ?? "asleep").replace(/_/g, " ")}, can't change it now`)));
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
    .child(div().flex_none().text_size(11).text_color(t.dim).child("Where it is"))
    .child(v_flex().id("folder-paths").flex_1().min_h(0).gap(10).overflow_y_scrollbar().children(view.rows.map(pathRow)))
    .child(div().flex_none().text_size(11).text_color(t.dim)
      .child("Spaces under one of its paths go in it, worktrees nested there too. A machine left empty uses another's paths, moved to its own home."))
    .when(Boolean(view.error), (el) => el.child(div().flex_none().text_color(t.blocked).child(view.error)))
    .child(h_flex().gap(8).items_center().flex_none()
      .when(Boolean(view.id), (el) => el.child(button("folder-delete", "Delete", false, () => {
        ask({ op: "delete", id: view.id });
        closeOverlay(props().overlay);
      })))
      .child(div().flex_1())
      .child(button("folder-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
      .child(button("folder-save", view.busy ? "Saving…" : "Save", true, (_e, cx) => save(view, cx))));
}
