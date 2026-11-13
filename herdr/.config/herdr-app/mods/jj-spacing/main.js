// Spacing dialog: the gap between panes (and around them), the terminals' padding
// and the panes' title bars, written into the shown layout with layout.set as they change.
// ↑/↓ pick a row, ←/→ or the buttons change it. Its Hints tab picks what hint
// mode (ctrl-a f, jj-copy/patterns.json) highlights, kept as shared("jj-copy.hints").

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { layout, run, theme, props, closeOverlay, appHome, readTextFile, shared, setShared } from "herdr";

const DEFAULT = { gap: 6, padX: 14, padY: 12 };
const ROWS = [
  { key: "gap", label: "Pane gap", max: 16 },
  { key: "padX", label: "Terminal padding, sides", max: 32 },
  { key: "padY", label: "Terminal padding, top and bottom", max: 32 },
];
const STEP = 2;
const BARS = [["always", "Shown"], ["hover", "On hover"], ["none", "Hidden"]];
const HEADER = { content: { mod: "pane" }, height: 26, position: "top" };
const HINTS = "jj-copy.hints";
const TABS = [["spacing", "Spacing"], ["hints", "Hints"]];

function find(node, test) {
  if (!node) return null;
  if (test(node)) return node;
  for (const child of node.children ?? []) {
    const found = find(child, test);
    if (found) return found;
  }
  return null;
}

// The tab block's pane frame, and the row around it whose padding is the margin.
const frameOf = (root) => find(root, (n) => n.content?.pane)?.content.pane ?? null;
const areaOf = (root) => find(root, (n) => (n.children ?? []).some((c) => c.content?.pane));

function current() {
  const root = layout();
  const [padX, padY] = root?.terminal_padding ?? [DEFAULT.padX, DEFAULT.padY];
  const header = frameOf(root)?.header;
  return { gap: frameOf(root)?.gap ?? DEFAULT.gap, padX, padY, bars: !header ? "none" : header.reveal === "hover" ? "hover" : "always" };
}

function edit(change) {
  const root = JSON.parse(JSON.stringify(layout()));
  change(root);
  run("layout.set", { layout: root });
}

function spacing(root, values) {
  const frame = frameOf(root);
  const area = areaOf(root);
  if (frame) {
    frame.gap = values.gap;
    frame.radius = values.gap > 0 ? 8 : 0;
  }
  if (area) {
    area.padding = values.gap;
    area.gap = values.gap;
  }
  root.terminal_padding = [values.padX, values.padY];
}

// A hidden header is kept in localStorage, so showing it again brings back its mod and size.
function bars(root, mode) {
  const frame = frameOf(root);
  if (!frame) return;
  if (mode === "none") {
    if (frame.header) localStorage.setItem("header", JSON.stringify(frame.header));
    delete frame.header;
    return;
  }
  let kept = null;
  try {
    kept = JSON.parse(localStorage.getItem("header") ?? "null");
  } catch {}
  frame.header = { ...(frame.header ?? kept ?? HEADER), reveal: mode };
}

const isOn = (p) => shared(HINTS)?.[p.id] ?? p.on;

function toggle(p) {
  const { [p.id]: _, ...rest } = shared(HINTS) ?? {};
  setShared(HINTS, isOn(p) === p.on ? { ...rest, [p.id]: !p.on } : rest);
}

export default class Spacing extends View {
  init(_props, cx) {
    this.at = 0;
    this.hint = 0;
    this.tab = localStorage.getItem("tab") === "hints" ? "hints" : "spacing";
    this.patterns = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => {
      try {
        this.patterns = JSON.parse((await readTextFile(`${appHome()}/mods/jj-copy/patterns.json`)) ?? "[]");
      } catch {
        this.patterns = [];
      }
      cx.notify();
    });
  }

  change(key, delta) {
    const row = ROWS.find((r) => r.key === key);
    const values = current();
    const next = Math.max(0, Math.min(row.max, values[key] + delta));
    if (next !== values[key]) edit((root) => spacing(root, { ...values, [key]: next }));
  }

  cycle(delta) {
    const i = BARS.findIndex(([mode]) => mode === current().bars);
    edit((root) => bars(root, BARS[(i + delta + BARS.length) % BARS.length][0]));
  }

  show(tab) {
    this.tab = tab;
    localStorage.setItem("tab", tab);
  }

  key(e) {
    if (e.key === "tab") return this.show(this.tab === "hints" ? "spacing" : "hints"), true;
    const up = e.key === "up" || e.key === "k";
    const down = e.key === "down" || e.key === "j";
    if (this.tab === "hints") {
      const n = this.patterns?.length ?? 0;
      if (up && n) this.hint = (this.hint + n - 1) % n;
      else if (down && n) this.hint = (this.hint + 1) % n;
      else if ((e.key === "space" || e.key === "enter") && n) toggle(this.patterns[this.hint]);
      else return false;
      return true;
    }
    const n = ROWS.length + 1;
    const step = e.key === "left" || e.key === "h" || e.key === "-" ? -1 : e.key === "right" || e.key === "l" || e.key === "+" || e.key === "=" ? 1 : 0;
    if (up) this.at = (this.at + n - 1) % n;
    else if (down) this.at = (this.at + 1) % n;
    else if (step && this.at === ROWS.length) this.cycle(step);
    else if (step) this.change(ROWS[this.at].key, step * STEP);
    else return false;
    return true;
  }

  spacing(t) {
    const values = current();
    const button = (id, icon, on) => div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { on(); cx.notify(); })
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(12));
    const row = (r, i) => h_flex()
      .id(`row-${r.key}`)
      .h(34)
      .px(8)
      .gap(6)
      .flex_none()
      .items_center()
      .rounded(7)
      .when(i === this.at, (el) => el.bg(t.selected))
      .on_click((_e, cx) => { this.at = i; cx.notify(); })
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(r.label))
      .child(button(`less-${r.key}`, "minus", () => this.change(r.key, -STEP)))
      .child(div().w(44).flex_none().text_center().text_color(t.foreground).child(`${values[r.key]} px`))
      .child(button(`more-${r.key}`, "plus", () => this.change(r.key, STEP)));
    const option = ([mode, label]) => div().id(`bars-${mode}`).px(8).py(3).rounded(5).cursor_pointer()
      .text_color(values.bars === mode ? t.foreground : t.muted)
      .when(values.bars === mode, (el) => el.bg(t.hover))
      .when(values.bars !== mode, (el) => el.hover((s) => s.text_color(t.foreground)))
      .on_click((_e, cx) => { this.at = ROWS.length; edit((root) => bars(root, mode)); cx.notify(); })
      .child(label);
    const titleBars = h_flex()
      .id("row-bars")
      .h(34)
      .px(8)
      .gap(6)
      .flex_none()
      .items_center()
      .rounded(7)
      .when(this.at === ROWS.length, (el) => el.bg(t.selected))
      .on_click((_e, cx) => { this.at = ROWS.length; cx.notify(); })
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child("Pane title bars"))
      .child(h_flex().flex_none().gap(2).text_size(12).children(BARS.map(option)));
    const changed = ROWS.some((r) => values[r.key] !== DEFAULT[r.key]) || values.bars !== "always";
    return {
      body: v_flex().flex_1().min_h(0).gap(4).children(ROWS.map(row)).child(titleBars),
      reset: changed ? () => edit((root) => (spacing(root, DEFAULT), bars(root, "always"))) : null,
      resetLabel: "Reset to defaults",
      hint: "↑↓ choose · ←→ change · tab hints · esc close",
    };
  }

  hints(t) {
    const row = (p, i) => {
      const on = isOn(p);
      return h_flex()
        .id(`hint-${p.id}`)
        .h(30)
        .px(8)
        .gap(10)
        .flex_none()
        .items_center()
        .rounded(7)
        .cursor_pointer()
        .when(i === this.hint, (el) => el.bg(t.selected))
        .when(i !== this.hint, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => { this.hint = i; toggle(p); cx.notify(); })
        .child(div().size(14).flex_none().flex().items_center().justify_center().rounded(4).border_1()
          .border_color(on ? t.accent : t.input).when(on, (el) => el.bg(t.accent).text_color(t.accent_foreground))
          .when(on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(10))))
        .child(div().flex_none().text_color(on ? t.foreground : t.muted).child(p.label))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(11.5).text_color(t.dim).child(p.example));
    };
    return {
      body: v_flex().id("hint-list").flex_1().min_h(0).gap(2).overflow_y_scroll()
        .children((this.patterns ?? []).map(row))
        .when(this.patterns?.length === 0, (el) => el.child(div().p(8).text_color(t.dim).child("Couldn't read jj-copy/patterns.json."))),
      reset: Object.keys(shared(HINTS) ?? {}).length ? () => setShared(HINTS, {}) : null,
      resetLabel: "Reset to defaults",
      hint: "↑↓ choose · space toggle · tab spacing · esc close",
    };
  }

  render() {
    const t = theme();
    const view = this.tab === "hints" ? this.hints(t) : this.spacing(t);
    const tab = ([id, label]) => div().id(`tab-${id}`).px(10).py(4).rounded(6).cursor_pointer()
      .text_color(this.tab === id ? t.foreground : t.muted)
      .when(this.tab === id, (el) => el.bg(t.selected))
      .when(this.tab !== id, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => { this.show(id); cx.notify(); })
      .child(label);
    return v_flex()
      .id("spacing")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") return closeOverlay(props().overlay);
        if (!this.key(e)) return;
        cx.stop_propagation();
        cx.notify();
      })
      .size_full()
      .p(16)
      .gap(8)
      .bg(t.popover)
      .text_size(13)
      .child(h_flex().gap(4).items_center().font_semibold().children(TABS.map(tab)))
      .child(view.body)
      .child(h_flex().gap(8).items_center().text_size(11).text_color(t.dim)
        .child(div().id("reset").px(8).py(3).rounded(5).text_color(view.reset ? t.muted : t.dim)
          .when(Boolean(view.reset), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { view.reset(); cx.notify(); }))
          .child(view.resetLabel))
        .child(div().flex_1())
        .child(view.hint));
  }
}
