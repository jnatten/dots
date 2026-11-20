// The keybind list (prefix+?, cmd-/): Herdr's help, with what each binding does in words.
// Reads keys.json through keys(); edit keys.json to change any of them, and DESCRIBE when
// adding one (a binding it doesn't know falls back to Herdr's own words for its command).
// Keys bound to one action share a row; numbered ones (tab 1–9, space 1–9) fold into one.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { keys, commands, props, closeOverlay, theme } from "herdr";

const CLAUDE = "Claude, tasks and links";
const SPACES = "Spaces";
const TABS = "Tabs";
const PANES = "Panes and layouts";
const TERMINAL = "Terminal";
const FIND = "Go to and open";
const APP = "App";
const IN_TERMINAL = "In a terminal";
const IN_OPEN = "In the open dialog (⌘O)";
const ORDER = [CLAUDE, SPACES, TABS, PANES, TERMINAL, FIND, APP, IN_TERMINAL, IN_OPEN];

// By action, or by "section|action" where a section gives it another meaning.
const DESCRIBE = {
  '{"command":"tab.new","args":{"name":"Claude","argv":["claude"]}}': [CLAUDE, "New tab with a Claude session"],
  '{"command":"tab.new","args":{"name":"Claude","argv":["claude","--worktree"]}}': [CLAUDE, "New tab with a Claude session in a worktree of its own"],
  "mod.open:jj-sessions": [CLAUDE, "Search sessions: running, spaces, Waiting and history"],
  "jj-spaces.tasks": [CLAUDE, "Tasks: every PR, issue and card Claude sessions had, with those sessions"],
  "jj-spaces.board": [CLAUDE, "Board: PRs, issues and Trello boards, with their sessions and links"],
  "jj-spaces.describe": [CLAUDE, "Describe the focused agent"],
  "jj-spaces.link": [CLAUDE, "Link a PR, issue or card to the focused agent"],
  "jj-spaces.link-space": [CLAUDE, "Link a PR, issue or card to the space"],
  "jj-tabs.agent-next": [CLAUDE, "Next agent, in the agents list's order"],
  "jj-tabs.agent-prev": [CLAUDE, "Previous agent"],
  "jj-tabs.waiting": [CLAUDE, "Show or hide the Waiting section"],
  "jj-tabs.wait": [CLAUDE, "Move the space into or out of Waiting"],

  "space.new": [SPACES, "New space"],
  "space.rename": [SPACES, "Rename the space"],
  "space.close": [SPACES, "Close the space and end its terminals (asks first)"],
  "jj-tabs.space-next": [SPACES, "Next space, as the sidebar lists them"],
  "jj-tabs.space-prev": [SPACES, "Previous space"],
  "jj-tabs.space-#": [SPACES, "Show space 1–9"],
  "jj-tabs.new-window": [SPACES, "New window onto the same spaces"],

  "tab.new": [TABS, "New tab"],
  "tab.close": [TABS, "Close the tab"],
  "tab.next": [TABS, "Next tab"],
  "tab.prev": [TABS, "Previous tab"],
  "tab.rename": [TABS, "Rename the tab"],
  "tab.select:#": [TABS, "Show tab 1–9"],

  "pane.split:right": [PANES, "Split the pane to the right"],
  "pane.split:down": [PANES, "Split the pane downwards"],
  "pane.close": [PANES, "Close the pane"],
  "pane.zoom": [PANES, "Zoom the pane, or show them all again"],
  "pane.go:left": [PANES, "Focus the pane to the left"],
  "pane.go:right": [PANES, "Focus the pane to the right"],
  "pane.go:up": [PANES, "Focus the pane above"],
  "pane.go:down": [PANES, "Focus the pane below"],
  "pane.swap:left": [PANES, "Swap the pane with the one to the left"],
  "pane.swap:right": [PANES, "Swap the pane with the one to the right"],
  "pane.swap:up": [PANES, "Swap the pane with the one above"],
  "pane.swap:down": [PANES, "Swap the pane with the one below"],
  "jj-tabs.rotate-up": [PANES, "Rotate the tab's panes up (tmux rotate-window)"],
  "jj-tabs.rotate-down": [PANES, "Rotate the tab's panes down"],
  "jj-tabs.pane-tab": [PANES, "Move the pane to a new tab (tmux break-pane)"],
  "jj-tabs.pane-space": [PANES, "Move the pane to another space"],
  "jj-tabs.layout-even-horizontal": [PANES, "Layout: panes side by side"],
  "jj-tabs.layout-even-vertical": [PANES, "Layout: panes stacked"],
  "jj-tabs.layout-main-horizontal": [PANES, "Layout: the pane on top, the rest below"],
  "jj-tabs.layout-main-vertical": [PANES, "Layout: the pane on the left, the rest beside it"],
  "jj-tabs.layout-tiled": [PANES, "Layout: tiled"],
  "layout.switch": [PANES, "Switch to the next layout"],
  "layout.toggle:sidebar": [PANES, "Show or hide the sidebar"],

  "send:\u0001": [TERMINAL, "Send ctrl-a to the program"],
  "jj-tabs.copy-mode": [TERMINAL, "Copy mode: vim keys over the screen and history"],
  "jj-tabs.fingers": [TERMINAL, "Hints: copy a hash, path, URL… from the screen"],
  "jj-tabs.capture": [TERMINAL, "Open the screen and history in Neovim"],
  "jj-tabs.capture-colors": [TERMINAL, "Open the screen and history in Neovim, with colours"],
  "mod.open:jj-scroll": [TERMINAL, "Scroll mode: vim keys scroll the terminal"],

  "mod.open:jj-picker": [FIND, "Go to a tab"],
  "mod.open:jj-open": [FIND, "Open a recent folder as a space, tab or pane"],

  "app.palette": [APP, "Command palette"],
  "app.settings": [APP, "Settings"],
  "app.help": [APP, "Herdr's own keybind list"],
  "mod.open:jj-help": [APP, "Keybinds (this list)"],
  "app.zoom_in": [APP, "Zoom in"],
  "app.zoom_out": [APP, "Zoom out"],
  "app.zoom_reset": [APP, "Reset zoom"],
  "app.quit": [APP, "Quit Herdr"],
  "app.hide": [APP, "Hide Herdr"],
  "app.hide_others": [APP, "Hide the other apps"],
  "app.reset": [APP, "Escape hatch: put the layout and keys aside, back to Herdr's defaults"],

  "terminal|terminal.search": [IN_TERMINAL, "Find in the terminal"],
  "terminal|terminal.copy": [IN_TERMINAL, "Copy the selection"],
  "terminal|terminal.paste": [IN_TERMINAL, "Paste"],
  "terminal|terminal.paste_image": [IN_TERMINAL, "Paste the clipboard's image as a file"],
  "terminal|send:\u001bb": [IN_TERMINAL, "Word left"],
  "terminal|send:\u001bf": [IN_TERMINAL, "Word right"],
  "terminal|send:\u0017": [IN_TERMINAL, "Delete the word to the left"],
  "terminal|send:\u0001": [IN_TERMINAL, "Start of the line"],
  "terminal|send:\u0005": [IN_TERMINAL, "End of the line"],
  "terminal|send:\u0015": [IN_TERMINAL, "Delete to the start of the line"],

  "mod:jj-open|jj-open.claude": [IN_OPEN, "Start Claude in the chosen folder, in a new space"],
  "mod:jj-open|jj-open.claude-worktree": [IN_OPEN, "Start Claude in a worktree of the chosen folder"],
};

// Rows go in DESCRIBE's order within their group.
const RANK = Object.fromEntries(Object.keys(DESCRIBE).map((k, i) => [k, i]));

// Object actions come as JSON; compared without spaces.
const norm = (action) => (action.startsWith("{") ? JSON.stringify(JSON.parse(action)) : action);
// tab.select:3 and jj-tabs.space-3 are one row each for 1–9.
const numbered = (action) => action.replace(/^(tab\.select:|jj-tabs\.space-)[1-9]$/, "$1#");

function words(action, about) {
  if (action.startsWith("send:")) return `Type ${JSON.stringify(action.slice(5))}`;
  const [name, arg] = action.split(":");
  const said = about[name]?.split(/(?<=\.)\s|\s\(/)[0]?.replace(/\.$/, "");
  return said ? (arg ? `${said}: ${arg}` : said) : `${name.replace(/[._-]/g, " ")}${arg ? ` ${arg}` : ""}`;
}

function describe(section, action, about) {
  const key = numbered(norm(action));
  const known = DESCRIBE[`${section}|${key}`] ?? (section === "global" ? DESCRIBE[key] : null);
  if (known) return known;
  const group = section === "terminal" ? IN_TERMINAL : section.startsWith("mod:") ? `In ${section.slice(4)}` : APP;
  return [group, words(action, about)];
}

const MODS = { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘" };
const NAMES = { left: "←", right: "→", up: "↑", down: "↓", enter: "↵", tab: "⇥", backspace: "⌫", escape: "esc", space: "space" };

// "cmd-shift-]" as ⌘⇧], modifiers in the order macOS writes them.
function chord(text) {
  const parts = text.split("-");
  const key = parts.length > 1 && parts.at(-1) === "" ? "-" : parts.pop();
  const held = parts.filter(Boolean);
  const mods = ["ctrl", "alt", "shift", "cmd"].filter((m) => held.includes(m)).map((m) => MODS[m]).join("");
  return mods + (NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key.replace(/^f(\d+)$/, "F$1")));
}

// A row's keys: each binding's chords, numbered ones as their first and last.
function bindings(list) {
  const pretty = list.map((k) => k.keys.split(" ").map(chord));
  const nums = pretty.filter((p) => /[1-9]$/.test(p.at(-1)));
  if (nums.length < 9 || list.length !== nums.length) return pretty;
  return [[...nums[0].slice(0, -1), nums[0].at(-1).replace(/1$/, "1…9")]];
}

export default class Help extends View {
  init(_props, cx) {
    this.filter = "";
    this.input = InputState.new({ placeholder: "Type to filter keys or what they do…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
    this.about = Object.fromEntries(commands().map((c) => [c.name, c.about]));
  }

  rows() {
    const by = new Map();
    for (const k of keys()) {
      const [group, text] = describe(k.section, k.action, this.about);
      const id = `${k.section}|${numbered(norm(k.action))}`;
      const key = numbered(norm(k.action));
      const rank = RANK[`${k.section}|${key}`] ?? (k.section === "global" ? RANK[key] : undefined) ?? Infinity;
      const row = by.get(id) ?? by.set(id, { id, group, text, rank, list: [] }).get(id);
      row.list.push(k);
    }
    const f = this.filter.trim().toLowerCase();
    return [...by.values()]
      .sort((a, b) => a.rank - b.rank)
      .map((r) => ({ ...r, keys: bindings(r.list) }))
      .filter((r) => !f || `${r.text} ${r.group} ${r.list.map((k) => `${k.keys} ${k.action}`).join(" ")} ${r.keys.flat().join(" ")}`.toLowerCase().includes(f));
  }

  render(cx) {
    const t = theme();
    const rows = this.rows();
    const groups = [...new Set([...ORDER, ...rows.map((r) => r.group)])]
      .map((name) => [name, rows.filter((r) => r.group === name)])
      .filter(([, list]) => list.length > 0);
    const cap = (text) => div().px(5).h(20).flex().items_center().rounded(4).border_1().border_color(t.border).bg(t.raised).text_size(11.5).text_color(t.foreground).child(text);
    const keysOf = (r) => h_flex().w(230).flex_none().flex_wrap().gap_x(10).gap_y(4).items_center()
      .children(r.keys.map((seq) => h_flex().gap(3).items_center().children(seq.map(cap))));
    return v_flex()
      .id("help")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") return closeOverlay(props().overlay);
      })
      .size_full()
      .min_h(0)
      .p(18)
      .gap(14)
      .bg(t.popover)
      .text_size(12)
      .child(
        h_flex()
          .h(22)
          .items_center()
          .justify_between()
          .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Keybinds"))
          .child(div().id("help-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => closeOverlay(props().overlay)).child("Esc")),
      )
      .child(Input.new(this.input).h(36).flex_none().px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(
        v_flex()
          .id("help-list")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .py(2)
          .gap(10)
          .when(!rows.length, (el) => el.child(div().px(8).text_color(t.dim).child("No key does that.")))
          .children(
            groups.map(([name, list]) =>
              v_flex()
                .gap(2)
                .child(div().text_size(11.5).font_medium().text_color(t.dim).child(name))
                .children(
                  list.map((r) =>
                    h_flex()
                      .min_h(32)
                      .py(4)
                      .px(8)
                      .gap(12)
                      .rounded(7)
                      .items_center()
                      .child(keysOf(r))
                      .child(div().flex_1().min_w(0).text_color(t.foreground).child(r.text)),
                  ),
                ),
            ),
          ),
      );
  }
}
