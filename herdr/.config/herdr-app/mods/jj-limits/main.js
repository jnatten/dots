// Claude Code plan limits as pies at the bottom of the sidebar, from the file the
// Claude status line writes (claude/.claude/hooks/statusline.sh in dots).

import { View, div, PathBuilder } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, home, readTextFile, watchFolder, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

const DIR = () => `${home()}/.cache/herdr-claude`;
const WINDOWS = [
  ["five_hour", "5h", "5-hour limit"],
  ["seven_day", "7d", "Weekly limit"],
];

const circle = (b, r) => b.move_to("50%", `${50 - r}%`).arc_to(`${r}%`, `${r}%`, 0, false, true, "50%", `${50 + r}%`).arc_to(`${r}%`, `${r}%`, 0, false, true, "50%", `${50 - r}%`);

function pie(fraction, size, fill, track) {
  const f = Math.max(0, Math.min(1, fraction));
  const r = 32;
  const at = (v) => `${(50 + v * r).toFixed(3)}%`;
  const a = f * 2 * Math.PI;
  const wedge =
    f >= 0.999
      ? circle(PathBuilder.fill(), r).close().build()
      : PathBuilder.fill().move_to("50%", "50%").line_to("50%", `${50 - r}%`).arc_to(`${r}%`, `${r}%`, 0, f > 0.5, true, at(Math.sin(a)), at(-Math.cos(a))).close().build();
  return div()
    .relative()
    .size(size)
    .flex_none()
    .child(window.paint_path(circle(PathBuilder.stroke(1.2), 46).build(), track).absolute().inset_0())
    .when(f > 0, (el) => el.child(window.paint_path(wedge, fill).absolute().inset_0()));
}

const until = (s) => {
  const d = Math.max(0, s - Date.now() / 1000);
  const h = Math.floor(d / 3600), m = Math.round((d % 3600) / 60);
  return d >= 86400 ? `${Math.floor(d / 86400)}d ${Math.floor((d % 86400) / 3600)}h` : h ? `${h}h ${m}m` : `${m}m`;
};

export default class Limits extends View {
  init(_props, cx) {
    this.limits = null;
    this.read(cx);
    cx.timer.every(60000, (cx) => this.read(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        try {
          await watchFolder(DIR());
        } catch {
          return;
        }
        this.read(cx);
      }
    });
  }

  read(cx) {
    cx.spawn(async (cx) => {
      const text = await readTextFile(`${DIR()}/limits.json`).catch(() => null);
      try {
        this.limits = text ? JSON.parse(text) : null;
      } catch {}
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const now = Date.now() / 1000;
    const shown = WINDOWS.map(([key, short, long]) => ({ key, short, long, w: this.limits?.[key] })).filter((x) => x.w);
    const collapsed = narrow();
    return h_flex()
      .size_full()
      .px(collapsed ? 0 : 16)
      .gap(collapsed ? 8 : 14)
      .items_center()
      .when(collapsed, (el) => el.justify_center())
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(11.8)
      .text_color(t.muted)
      .children(
        shown.map(({ key, short, long, w }) => {
          const stale = w.resets_at && w.resets_at < now;
          const pct = stale ? 0 : Math.round(w.used_percentage ?? 0);
          const fill = pct >= 90 ? t.blocked : pct >= 75 ? t.ansi3 : t.muted;
          return h_flex()
            .id(`limit-${key}`)
            .gap(6)
            .items_center()
            .tooltip(stale ? `${long}: reset since Claude last reported` : `${long}: ${pct}% used, resets in ${until(w.resets_at)}`)
            .child(pie(pct / 100, 13, fill, t.dim))
            .when(!collapsed, (el) => el.child(div().text_color(pct >= 75 ? fill : t.muted).child(`${short} ${pct}%`)));
        }),
      );
  }
}
