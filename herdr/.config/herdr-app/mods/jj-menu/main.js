// Context menus (Herdr's items). Opened as a popup with
// props { tab: "pane" | "tab" | "space" | "global", target }.
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args];
// a command "worktree", "jj-workspace", "jj-sessions", "jj-panes", "jj-copy" or "jj-spaces" (its link dialog) opens that mod instead.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes, agents, exec } from "herdr";

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), "jj-main",
// "jj-linked" (a jj workspace), or null.
async function checkout(folder, on) {
  const ws = await exec("jj", ["--ignore-working-copy", "--color=never", "workspace", "root"], { cwd: folder, on });
  if (ws.code === 0) {
    const linked = await exec("test", ["-f", `${ws.stdout.trim()}/.jj/repo`], { on });
    return linked.code === 0 ? "jj-linked" : "jj-main";
  }
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

const claude = (a) => !a.address.includes("/") && (a.app === "claude-code" || a.program?.key === "claude");

function items(p, git) {
  p = p ?? {};
  const tg = p.target ?? {};
  switch (p.tab) {
    case "pane": {
      // A kept sub-agent can go back under its parent, still running.
      const all = terminals();
      const term = all.find((t) => t.address === tg.terminal);
      const parent = term?.parent && all.find((t) => t.address === term.parent);
      // Once they go to the program, Shift+right-click still opens this menu.
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      // A terminal shown outside a tab (a layout terminal block, a window) has
      // no pane to split, zoom or close: its pane is the block's id.
      const inTab = panes().some((pane) => pane.pane === tg.pane);
      return [
        ...(inTab
          ? [
              ["Split right", "pane.split", { direction: "right", pane: tg.pane }],
              ["Split down", "pane.split", { direction: "down", pane: tg.pane }],
              ["Zoom", "pane.zoom", { pane: tg.pane }],
            ]
          : []),
        ...(term
          ? [
              toProgram
                ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
                : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }],
            ]
          : []),
        ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
        ...(inTab && term
          ? [
              ["Move to new tab", "jj-panes", { action: "tab", terminal: term.address }],
              ["Move to space\u2026", "jj-panes", { action: "space", terminal: term.address }],
              ["Copy mode", "jj-copy", { action: "copy", terminal: term.address }],
              ["Open in Neovim", "jj-copy", { action: "nvim", terminal: term.address, cwd: panes().find((pane) => pane.pane === tg.pane)?.cwd }],
              ["Open in Neovim with colours", "jj-copy", { action: "nvim", colors: true, terminal: term.address, cwd: panes().find((pane) => pane.pane === tg.pane)?.cwd }],
            ]
          : []),
        ...(inTab && agents().some((a) => a.address === tg.terminal && claude(a)) ? [["Archive session", "jj-sessions", { action: "archive", terminals: [tg.terminal] }]] : []),
        ...(inTab ? [["Close pane", "pane.close", { pane: tg.pane }]] : []),
      ];
    }
    case "tab":
      return [
        ["Rename", "tab.rename", { id: tg.id }],
        ["New tab", "tab.new", { space: tg.space }],
        ["Close", "tab.close", { id: tg.id }],
      ];
    case "space":
      return [
        ["Rename", "space.rename", { id: tg.id }],
        ...(git?.startsWith("jj")
          ? [
              ["New jj workspace", "jj-workspace", { space: tg.id, action: "new" }],
              ["Open jj workspace", "jj-workspace", { space: tg.id, action: "open" }],
              ...(git === "jj-linked" ? [["Remove jj workspace", "jj-workspace", { space: tg.id, action: "remove" }]] : []),
            ]
          : [
              ...(git ? [["New worktree", "worktree", { space: tg.id, action: "new" }], ["Open worktree", "worktree", { space: tg.id, action: "open" }]] : []),
              ...(git === "linked" ? [["Remove worktree", "worktree", { space: tg.id, action: "remove" }]] : []),
            ]),
        ["Link PR or issue\u2026", "jj-spaces", { link: tg.id }],
        ...(agents().some((a) => a.space === tg.id && claude(a)) ? [["Archive sessions & close", "jj-sessions", { action: "archive", space: tg.id }]] : []),
        ["Close", "space.close", { id: tg.id }],
      ];
    default:
      return [
        ["New space", "space.new", {}],
        ["Keybinds", "app.help", {}],
        ["Theme: graphite", "app.theme", { name: "graphite" }],
        ["Theme: ink", "app.theme", { name: "ink" }],
        ["Theme: moss", "app.theme", { name: "moss" }],
        ["Theme: atom one dark", "app.theme", { name: "atom-one-dark" }],
      ];
  }
}

function menuIcon(command) {
  if (command === "jj-spaces") return "mods/jj-spaces/git-pull-request.svg";
  const name = command.endsWith(".close") ? "x" : command.endsWith(".rename") ? "square-pen" : command.endsWith(".new") ? "plus" : command === "worktree" || command === "jj-workspace" ? "git-branch" : command === "jj-sessions" ? "archive" : command === "jj-panes" ? "layers" : command === "jj-copy" ? "file-text" : command === "app.help" ? "terminal" : command === "app.theme" ? "settings" : command === "pane.split" ? "panel-right" : command === "pane.zoom" ? "square" : "terminal";
  return `mods/workspace-chrome/${name}.svg`;
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

export default class Menu extends View {
  init(_props, cx) {
    this.at = 0;
    this.git = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props();
    const space = p?.tab === "space" && spaces().find((s) => s.id === p.target?.id);
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
  }

  choose(i, cx) {
    const it = items(props(), this.git)[i];
    if (!it) return;
    closeOverlay(props()?.overlay);
    if (it[1] === "worktree" || it[1] === "jj-workspace") openOverlay({ mod: it[1], kind: "dialog", ...(it[2].action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
    else if (it[1] === "jj-spaces") openOverlay({ mod: "jj-spaces", kind: "dialog", width: 560, height: 0.7, props: it[2] });
    else if (it[1] === "jj-sessions") openOverlay({ mod: "jj-sessions", kind: "dialog", width: 440, height: 220, props: it[2] });
    else if (it[1] === "jj-copy" && it[2].action === "copy") openOverlay({ mod: "jj-copy", kind: "dialog", width: 0.92, height: 0.88, props: it[2] });
    else if (it[1] === "jj-copy") openOverlay({ mod: "jj-copy", kind: "window", frame: "none", width: 1, height: 1, at: { x: 0, y: 0 }, props: it[2] });
    else if (it[1] === "jj-panes" && it[2].action === "space") openOverlay({ mod: "jj-panes", kind: "dialog", width: 420, height: 360, props: it[2] });
    else if (it[1] === "jj-panes") openOverlay({ mod: "jj-panes", kind: "window", frame: "none", width: 1, height: 1, at: { x: 0, y: 0 }, props: it[2] });
    else run(it[1], it[2]);
  }

  render(cx) {
    const t = theme();
    const list = items(props(), this.git);
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(i > 0 && (it[1].endsWith(".close") || it[1] === "app.help" || (it[1] === "app.theme" && list[i - 1][1] !== "app.theme")), el => el.child(div().mx(7).my(4).h(1).bg(t.border)))
            .child(h_flex()
            .id(`mi-${i}`)
            .h(31)
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .justify_between()
            .text_color(t.foreground)
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.choose(i, cx))
            .child(svg(menuIcon(it[1])).size(14).flex_none().text_color(t.muted))
            .child(div().flex_1().child(it[0]))
            .child(div().text_size(11).text_color(t.dim).child(shortcut(it[1], it[2])))),
        ),
      );
  }
}
