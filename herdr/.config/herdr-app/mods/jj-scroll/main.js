// Scroll mode, like tmux's copy mode: vim keys scroll the focused terminal until
// q or Esc, which goes back to the bottom. Claude Code (fullscreen) scrolls itself,
// so it gets the keys it scrolls on through `hc keys`; its line keys are
// shift+pageup/pagedown, which ~/.claude/keybindings.json binds to
// scroll:lineUp/lineDown. Other terminals scroll Herdr's view of their history.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, focused, terminals, theme, run, hc, closeOverlay } from "herdr";

// Each move: [the keys Claude gets, terminal.scroll's args for the rest].
const MOVES = {
  down: [["shift+pagedown"], { lines: 1 }],
  up: [["shift+pageup"], { lines: -1 }],
  halfDown: [["pagedown"], { pages: 0.5 }],
  halfUp: [["pageup"], { pages: -0.5 }],
  pageDown: [["pagedown", "pagedown"], { pages: 1 }],
  pageUp: [["pageup", "pageup"], { pages: -1 }],
  top: [["ctrl+home"], { to: "top" }],
  bottom: [["ctrl+end"], { to: "bottom" }],
};

function moveOf(key, ctrl, shift) {
  if (ctrl) return { d: "halfDown", u: "halfUp", f: "pageDown", b: "pageUp", e: "down", y: "up", n: "down", p: "up" }[key];
  if (key === "G" || (shift && key === "g")) return "bottom";
  if (shift) return null;
  return { j: "down", down: "down", k: "up", up: "up", space: "pageDown", b: "pageUp", pagedown: "halfDown", pageup: "halfUp", g: "top", home: "top", end: "bottom" }[key];
}

export default class Scroll extends View {
  init(_props, cx) {
    this.terminal = focused()?.terminal ?? null;
    const t = terminals().find((x) => x.address === this.terminal);
    this.claude = t?.program?.key === "claude" || t?.agent === "claude-code";
    this.moved = false;
    this.queue = Promise.resolve();
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  go(name, cx) {
    const [keys, args] = MOVES[name];
    if (!this.terminal) return;
    this.moved = true;
    if (!this.claude) return run("terminal.scroll", { terminal: this.terminal, ...args });
    cx.spawn(async () => {
      this.queue = this.queue.then(() => hc(["keys", this.terminal, ...keys])).catch(() => null);
      await this.queue;
    });
  }

  async close() {
    if (!this.terminal || !this.moved) return;
    if (this.claude) await hc(["keys", this.terminal, ...MOVES.bottom[0]]).catch(() => null);
    else run("terminal.scroll", { terminal: this.terminal, ...MOVES.bottom[1] });
  }

  render() {
    const t = theme();
    return h_flex()
      .id("scroll")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        const m = e.modifiers;
        if (m.platform || m.alt) return;
        if (e.key === "escape" || (e.key === "q" && !m.control)) return closeOverlay(props().overlay);
        const name = moveOf(e.key, m.control && !m.shift, m.shift);
        if (!name) return;
        this.go(name, cx);
        cx.stop_propagation();
      })
      .size_full()
      .px(10)
      .gap(10)
      .items_center()
      .rounded(8)
      .bg(t.popover)
      .border_1()
      .border_color(t.accent)
      .text_size(12)
      .child(div().flex_none().px(6).rounded(4).bg(t.accent).text_size(11).font_semibold().text_color(t.accent_foreground).child("SCROLL"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted)
        .child(this.terminal ? "j/k line · ^U/^D half page · ^B/^F page · g/G top/bottom · q quit" : "No terminal in focus · q quit"));
  }
}
