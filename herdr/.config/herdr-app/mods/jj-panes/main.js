// Moves and arranges terminal panes. Opened as an overlay with props
// { action, terminal }: "tab" (a new tab in its space), "space" (a picker: one of
// the space's machine's other spaces, or a new one), or "layout" with
// { layout } (tmux's even-horizontal, even-vertical, main-horizontal,
// main-vertical or tiled, the given terminal as main).
//
// A pane moves by parking its terminal and labelling it with the space and tab
// it should show in; Herdr makes a space or tab for ids it doesn't know.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, shared, props, run, hc, theme, notify, closeOverlay } from "herdr";

const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

const hex = () => Array.from({ length: 32 }, () => ((Math.random() * 16) | 0).toString(16)).join("");
const machineOf = (id) => (id.includes("/") ? id.split("/")[0] : null);
const local = (id) => id.split("/").pop();
const sleep = (cx, ms) => new Promise((resolve) => cx.timer.after(ms, () => resolve()));

async function waitFor(cx, done, ms = 4000) {
  for (let waited = 0; waited < ms; waited += 50) {
    if (done()) return true;
    await sleep(cx, 50);
  }
  return done();
}

const paneOf = (terminal) => panes().find((p) => p.terminal === terminal);
const tabOf = (terminal) => spaces().flatMap((s) => s.tabs.map((t) => ({ s, t }))).find(({ t }) => t.id === paneOf(terminal)?.tab);

async function park(cx, terminal) {
  run("terminal.park", { terminal });
  if (!(await waitFor(cx, () => !paneOf(terminal)))) throw new Error(`couldn't take ${terminal}'s pane away`);
}

// Shows a parked terminal in a space and tab, new ones when Herdr doesn't know the ids.
async function place(cx, terminal, space, tab) {
  const r = await hc(["label", terminal, `herdr.space=${local(space)}`, `herdr.tab=${local(tab)}`]);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || "hc label failed").trim());
  if (!(await waitFor(cx, () => Boolean(paneOf(terminal))))) throw new Error(`${terminal} didn't come back`);
}

async function toTab(cx, terminal) {
  const from = tabOf(terminal);
  if (!from) throw new Error("no pane to move");
  if (from.s.tabs.length === 1 && panes().filter((p) => p.tab === from.t.id).length === 1) return;
  const tab = `tb${hex()}`;
  await park(cx, terminal);
  await place(cx, terminal, from.s.id, tab);
  run("tab.select", { id: paneOf(terminal).tab });
  run("pane.focus", { terminal });
}

async function toSpace(cx, terminal, target, name) {
  const machine = machineOf(terminal);
  const space = target ?? `${machine ? `${machine}/` : ""}sp${hex()}`;
  await park(cx, terminal);
  await place(cx, terminal, space, `tb${hex()}`);
  const s = spaces().find((x) => x.tabs.some((t) => t.id === paneOf(terminal).tab));
  if (!target && name && s) run("space.rename", { id: s.id, name });
  if (s) run("space.select", { id: s.id });
  run("pane.focus", { terminal });
}

// A balanced split of `list` along `dir`: halves of halves, since every split is an even one.
function line(list, dir) {
  if (list.length === 1) return list[0];
  const half = Math.ceil(list.length / 2);
  return { dir, a: line(list.slice(0, half), dir), b: line(list.slice(half), dir) };
}

function plan(layout, order, main) {
  const rest = order.filter((t) => t !== main);
  switch (layout) {
    case "even-vertical":
      return line(order, "down");
    case "main-horizontal":
      return rest.length ? { dir: "down", a: main, b: line(rest, "right") } : main;
    case "main-vertical":
      return rest.length ? { dir: "right", a: main, b: line(rest, "down") } : main;
    case "tiled": {
      const cols = Math.ceil(Math.sqrt(order.length));
      const rows = [];
      for (let i = 0; i < order.length; i += cols) rows.push(line(order.slice(i, i + cols), "right"));
      return line(rows, "down");
    }
    default:
      return line(order, "right");
  }
}

const first = (node) => (typeof node === "string" ? node : first(node.a));

// The region `first(node)` fills becomes `node`: each split gives the second half to its first terminal.
async function build(cx, node) {
  if (typeof node === "string") return;
  const owner = first(node.a);
  const next = first(node.b);
  run("pane.focus", { terminal: owner });
  await waitFor(cx, () => paneOf(owner)?.focused);
  run("terminal.keep", { terminal: next, place: node.dir });
  if (!(await waitFor(cx, () => Boolean(paneOf(next))))) throw new Error(`${next} didn't come back`);
  await build(cx, node.a);
  await build(cx, node.b);
}

async function arrange(cx, terminal, layout) {
  const where = tabOf(terminal);
  if (!where) throw new Error("no pane to arrange");
  const mine = panes().filter((p) => p.tab === where.t.id);
  if (mine.some((p) => !p.terminal)) throw new Error("this tab has a panel that isn't a terminal");
  if (mine.length < 2) return;
  if (where.t.zoomed) run("pane.zoom", { pane: paneOf(terminal).pane });
  const tree = plan(layout, mine.map((p) => p.terminal), terminal);
  for (const p of mine) if (p.terminal !== first(tree)) await park(cx, p.terminal);
  await build(cx, tree);
  run("pane.focus", { terminal });
}

const fail = (error) => notify({ title: "Couldn't move the pane", body: String(error?.message ?? error), level: "error" });

export default class Panes extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.picking = p.action === "space";
    this.handle = cx.focus_handle();
    if (!this.picking) {
      cx.spawn(async (cx) => {
        try {
          if (p.action === "tab") await toTab(cx, p.terminal);
          else if (p.action === "layout") await arrange(cx, p.terminal, p.layout);
        } catch (error) {
          fail(error);
        }
        closeOverlay(p.overlay);
      });
      return;
    }
    this.text = "";
    this.at = 0;
    this.input = InputState.new({ placeholder: "Space, or a name for a new one" });
    this.input.on("change", (_e, cx) => {
      this.text = this.input.value();
      this.at = 0;
      cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.pick(this.choices()[this.at], cx));
    this.input.focus();
  }

  choices() {
    const p = props() ?? {};
    const from = tabOf(p.terminal)?.s;
    const machine = machineOf(p.terminal);
    const f = this.text.trim();
    const list = spaces()
      .filter((s) => s.id !== from?.id && (s.machine ?? null) === machine && (!f || s.name.toLowerCase().includes(f.toLowerCase())))
      .map((s) => ({ space: s }));
    const exact = list.some(({ space }) => space.name.toLowerCase() === f.toLowerCase());
    return [...list, ...(exact ? [] : [{ name: f }])];
  }

  pick(choice, cx) {
    if (!choice || this.busy) return;
    const p = props();
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        await toSpace(cx, p.terminal, choice.space?.id ?? null, choice.name);
      } catch (error) {
        fail(error);
      }
      closeOverlay(p.overlay);
    });
  }

  render() {
    const t = theme();
    if (!this.picking) return div();
    const choices = this.choices();
    this.at = Math.min(this.at, Math.max(0, choices.length - 1));
    const colors = shared("space.colors") ?? {};
    const avatar = (s) => {
      const c = colors[s.id] ?? "ansi6";
      return h_flex().size(16).flex_none().rounded(4).bg(c.startsWith("#") ? c : (MARK[c] ?? t[c])).items_center().justify_center().text_size(9).font_bold().text_color("#ffffff").child([...s.name][0]?.toUpperCase() ?? "?");
    };
    const row = (choice, i) =>
      h_flex()
        .id(`mv-${i}`)
        .h(30)
        .flex_none()
        .px(10)
        .gap(9)
        .items_center()
        .rounded(7)
        .cursor_pointer()
        .when(i === this.at, (el) => el.bg(t.selected))
        .when(i !== this.at, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => this.pick(choice, cx))
        .child(choice.space ? avatar(choice.space) : div().w(16).flex_none().text_color(t.dim).child("+"))
        .child(div().flex_1().min_w(0).truncate().text_color(choice.space ? t.foreground : t.muted).child(choice.space ? choice.space.name : choice.name ? `New space “${choice.name}”` : "New space"));
    return v_flex()
      .id("move-pane")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        const n = choices.length;
        const ctrl = e.modifiers.control && !e.modifiers.platform && !e.modifiers.alt;
        if (e.key === "escape") return closeOverlay(props().overlay);
        if ((e.key === "down" || (ctrl && (e.key === "j" || e.key === "n"))) && n) this.at = (this.at + 1) % n;
        else if ((e.key === "up" || (ctrl && (e.key === "k" || e.key === "p"))) && n) this.at = (this.at + n - 1) % n;
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(div().font_semibold().text_color(t.foreground).child("Move pane to space"))
      .child(Input.new(this.input).h(32).px(10).items_center().rounded(6).border(1).border_color(t.accent).bg(t.background).text_color(t.foreground))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().children(choices.map(row)))
      .child(h_flex().justify_end().text_size(11).text_color(t.dim).child(this.busy ? "moving…" : "↵ move · esc cancel"));
  }
}
