// Spacing dialog: the gap between panes (and around them) and the terminals'
// padding, written into the shown layout with layout.set as they change.
// ↑/↓ pick a row, ←/→ or the buttons change it.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { layout, run, theme, props, closeOverlay } from "herdr";

const DEFAULT = { gap: 6, padX: 14, padY: 12 };
const ROWS = [
  { key: "gap", label: "Pane gap", max: 16 },
  { key: "padX", label: "Terminal padding, sides", max: 32 },
  { key: "padY", label: "Terminal padding, top and bottom", max: 32 },
];
const STEP = 2;

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
  return { gap: frameOf(root)?.gap ?? DEFAULT.gap, padX, padY };
}

function apply(values) {
  const root = JSON.parse(JSON.stringify(layout()));
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
  run("layout.set", { layout: root });
}

export default class Spacing extends View {
  init(_props, cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  change(key, delta) {
    const row = ROWS.find((r) => r.key === key);
    const values = current();
    const next = Math.max(0, Math.min(row.max, values[key] + delta));
    if (next !== values[key]) apply({ ...values, [key]: next });
  }

  render() {
    const t = theme();
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
      .items_center()
      .rounded(7)
      .when(i === this.at, (el) => el.bg(t.selected))
      .on_click((_e, cx) => { this.at = i; cx.notify(); })
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(r.label))
      .child(button(`less-${r.key}`, "minus", () => this.change(r.key, -STEP)))
      .child(div().w(44).flex_none().text_center().text_color(t.foreground).child(`${values[r.key]} px`))
      .child(button(`more-${r.key}`, "plus", () => this.change(r.key, STEP)));
    const changed = ROWS.some((r) => values[r.key] !== DEFAULT[r.key]);
    return v_flex()
      .id("spacing")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        const key = ROWS[this.at].key;
        if (e.key === "escape") return closeOverlay(props().overlay);
        if (e.key === "up" || e.key === "k") this.at = (this.at + ROWS.length - 1) % ROWS.length;
        else if (e.key === "down" || e.key === "j") this.at = (this.at + 1) % ROWS.length;
        else if (e.key === "left" || e.key === "h" || e.key === "-") this.change(key, -STEP);
        else if (e.key === "right" || e.key === "l" || e.key === "+" || e.key === "=") this.change(key, STEP);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .size_full()
      .p(16)
      .gap(4)
      .bg(t.popover)
      .text_size(13)
      .child(div().pb(6).font_semibold().text_color(t.foreground).child("Spacing"))
      .children(ROWS.map(row))
      .child(div().flex_1())
      .child(h_flex().gap(8).items_center().text_size(11).text_color(t.dim)
        .child(div().id("reset").px(8).py(3).rounded(5).text_color(changed ? t.muted : t.dim)
          .when(changed, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { apply(DEFAULT); cx.notify(); }))
          .child(`Reset to ${DEFAULT.gap} / ${DEFAULT.padX} / ${DEFAULT.padY}`))
        .child(div().flex_1())
        .child("↑↓ choose · ←→ change · esc close"));
  }
}
