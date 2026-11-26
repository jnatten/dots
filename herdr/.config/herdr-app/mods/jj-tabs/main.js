import { View, div, svg, image } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, setShared, layout, settings, focused, nextCommand, exec, home, notify } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// tmux's rotate-window: each pane of the focused tab moves one place up (the
// first to the end) or down (the last to the start), as a run of swaps.
function rotate(up) {
  const tab = focused()?.tab;
  const order = panes().filter((p) => p.tab === tab);
  if (order.length < 2 || order.some((p) => p.zoomed)) return;
  const ids = order.map((p) => p.pane);
  const moving = up ? ids[0] : ids.at(-1);
  for (const target of up ? ids.slice(1) : ids.slice(0, -1).reverse()) run("pane.swap", { pane: moving, target });
}

// Space and agent next/prev, as the sidebar lists them (shared("spaces.order"): folders'
// spaces, but those folded away, and Waiting's only while its section is open); agents
// in jj-agents' order (shared("agents.order")).
function spaceOrder() {
  const ids = spaces().map((s) => s.id);
  const listed = shared("spaces.order");
  if (Array.isArray(listed) && listed.length) return listed.filter((id) => ids.includes(id));
  const parked = new Set(shared("spaces.waiting") ?? []);
  return [...ids.filter((id) => !parked.has(id)), ...(shared("waiting.open") ? ids.filter((id) => parked.has(id)) : [])];
}

function step(order, current, by) {
  if (!order.length) return null;
  const i = order.indexOf(current);
  return i === -1 ? (by > 0 ? order[0] : order.at(-1)) : order[(i + by + order.length) % order.length];
}

// Moves a space in or out of Waiting: shown at once, and kept on its machine by jj-spaces.
function askWaiting(id, waiting) {
  const now = shared("spaces.waiting") ?? [];
  setShared("spaces.waiting", waiting ? [...new Set([...now, id])] : now.filter((x) => x !== id));
  setShared("spaces.waiting.ask", [...(shared("spaces.waiting.ask") ?? []), { id, waiting }]);
}

function navigate(command) {
  const by = command.endsWith("-next") ? 1 : -1;
  const space = focused()?.space ?? spaces().find((s) => s.active)?.id;
  if (command.startsWith("space-")) {
    const id = step(spaceOrder(), space, by);
    if (id) run("space.select", { id });
  } else {
    const terminal = step(shared("agents.order") ?? [], focused()?.terminal, by);
    if (terminal) run("agent.focus", { terminal });
  }
}

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.hovered = null;
    this.scroll = ScrollHandle.new();
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    // Pane keys (keys.json "jj-tabs.<command>") act on the focused terminal through jj-panes and jj-copy.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        const go = command.match(/^go-(left|right|up|down)$/);
        if (go) {
          await this.goOrHop(go[1], cx);
          continue;
        }
        if (/^(space|agent)-(next|prev)$/.test(command)) {
          navigate(command);
          continue;
        }
        // ctrl-1..9: the Nth space as the sidebar shows them.
        const nth = command.match(/^space-([1-9])$/);
        if (nth) {
          const id = spaceOrder()[Number(nth[1]) - 1];
          if (id) run("space.select", { id });
          continue;
        }
        if (command === "waiting") {
          setShared("waiting.open", !shared("waiting.open"));
          continue;
        }
        // Another window onto the same spaces (new-window.sh, in the main app home).
        if (command === "new-window") {
          exec("sh", [`${home()}/.config/herdr-app/new-window.sh`])
            .then((r) => r.code === 0 || notify({ title: "Couldn't open a window", body: (r.stderr || r.stdout).trim(), level: "error" }))
            .catch((e) => notify({ title: "Couldn't open a window", body: String(e?.message ?? e), level: "error" }));
          continue;
        }
        if (command === "wait") {
          const space = focused()?.space;
          if (space) askWaiting(space, !(shared("spaces.waiting") ?? []).includes(space));
          continue;
        }
        const terminal = focused()?.terminal;
        if (!terminal) continue;
        if (command === "rotate-up" || command === "rotate-down") rotate(command === "rotate-up");
        else if (command === "pane-space") openOverlay({ mod: "jj-panes", kind: "dialog", width: 420, height: 360, props: { action: "space", terminal } });
        else if (command === "pane-tab") openOverlay({ mod: "jj-panes", kind: "window", frame: "none", width: 1, height: 1, at: { x: 0, y: 0 }, props: { action: "tab", terminal } });
        else if (command.startsWith("layout-")) openOverlay({ mod: "jj-panes", kind: "window", frame: "none", width: 1, height: 1, at: { x: 0, y: 0 }, props: { action: "layout", layout: command.slice(7), terminal } });
        else if (command === "copy-mode") openOverlay({ mod: "jj-copy", kind: "dialog", width: 0.92, height: 0.88, props: { action: "copy", terminal } });
        else if (command === "fingers" && focused()?.pane) setShared("jj-scroll.keep", Date.now()), openOverlay({ mod: "jj-copy", kind: "window", frame: "none", width: 2, height: 2, at: { x: 0, y: 0 }, props: { action: "fingers", terminal, pane: focused().pane, cwd: focused().cwd } });
        else if (command === "capture" || command === "capture-colors") openOverlay({ mod: "jj-copy", kind: "window", frame: "none", width: 1, height: 1, at: { x: 0, y: 0 }, props: { action: "nvim", terminal, cwd: focused()?.cwd, colors: command === "capture-colors" } });
      }
    });
  }

  // opt+h/j/k/l: the pane that way, or at the window's edge the Herdr window beside this
  // one (window-go.sh, in the main app home). A key held through a hop doesn't start another.
  async goOrHop(direction, cx) {
    if (this.hopping) return;
    const before = focused()?.pane;
    run("pane.go", { direction });
    await cx.sleep(30);
    if (!before || focused()?.pane !== before) return;
    this.hopping = true;
    const failed = (body) => notify({ title: "Couldn't move to the window there", body, level: "error" });
    exec("sh", [`${home()}/.config/herdr-app/window-go.sh`, direction])
      .then((r) => r.code === 0 || failed((r.stderr || r.stdout).trim()))
      .catch((e) => failed(String(e?.message ?? e)))
      .finally(() => { this.hopping = false; });
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const active = shown.findIndex(tab => tab.active);
    const selected = shown[active]?.id;
    if (selected !== this.selected || active !== this.selectedIndex) {
      this.selected = selected;
      this.selectedIndex = active;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    const stop = (_e, cx) => cx.stop_propagation();
    // A command running in the tab, or finished while it wasn't shown: drawn as jj-spaces' commands.js does.
    const commands = shared("commands.tabs") ?? {};
    const commandMark = (id, m, size = 14) => {
      const color = { running: t.ansi6, ok: t.ansi2, failed: t.blocked, unknown: t.done }[m.state];
      const box = div().id(id).relative().size(size).flex_none().flex().items_center().justify_center().tooltip(m.tip)
        .child(svg("mods/workspace-chrome/terminal.svg").size(Math.round(size * 0.55)).text_color(color));
      return m.state === "running"
        ? box.child(div().absolute().top(0).left(0).size(size).child(svg("mods/workspace-chrome/spinner.svg").size(size).text_color(color).spin(900)))
        : box.rounded(4).bg(color + "2e");
    };
    const button = (id, label, action) => div().id(id).size(22).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).h(22).px(8).gap(5).rounded(5).items_center().flex_none().text_size(12.5)
        // A rename or status dot on this or an earlier tab can push the active one out.
        .when(i <= active, el => el.on_size_change((_size, cx) => { this.scroll.scroll_to_item(active); cx.notify(); }))
        .bg(c.active ? t.selected : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_hover((on, cx) => { if (on) this.hovered = c.id; else if (this.hovered === c.id) this.hovered = null; cx.notify(); })
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(12).text_color(t.muted) : image(program.icon).size(12)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(Boolean(commands[c.id]), el => el.child(commandMark(`cmd-${c.id}`, commands[c.id])))
        .when(this.hovered === c.id, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(10))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(22).px(7).gap(5).flex_none().items_center().rounded(5)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(13)).child(label);
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().track_scroll(this.scroll)
        .on_size_change((_size, cx) => { if (active >= 0) { this.scroll.scroll_to_item(active); cx.notify(); } })
        .children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "jj-new-menu", kind: "popup", width: 250, height: 512 })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/jj-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/jj-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/jj-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
