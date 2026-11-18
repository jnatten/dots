// Spacing dialog: the gap between panes (and around them), the terminals' padding
// and the panes' title bars, written into the shown layout with layout.set as they change.
// ↑/↓ pick a row, ←/→ or the buttons change it. Its Hints tab picks what hint
// mode (ctrl-a f, jj-copy/patterns.json) highlights, kept as shared("jj-copy.hints").
// Its Links tab picks what the sidebar's GitHub badges bring along (a PR's issues,
// an issue's PRs, Trello cards) and where 1Password keeps the Trello key and token,
// kept as shared("jj-links"); Connect asks 1Password again (shared("jj-links.connect")).
// Its Sidebar tab picks whether space rows (jj-spaces) show their icon and branch, kept as
// shared("jj-spaces"), and whether the agents list (jj-agents) shows each agent's icon and
// what it says of it: its own title or nothing, and under it its space and tab, its latest
// update or nothing, kept as shared("jj-agents").
// What isn't in the layout is saved in jj-settings.json by jj-limits.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
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
const TABS = [["spacing", "Spacing"], ["hints", "Hints"], ["links", "Links"], ["sidebar", "Sidebar"]];

// jj-spaces/trello.js's DEFAULTS.
const LINKS = "jj-links";
const LINK_DEFAULTS = { related: true, trello: true, account: "my.1password.com", key: "op://Private/Trello/key", token: "op://Private/Trello/token" };
const SWITCHES = [
  { key: "related", label: "Linked issues and PRs", about: "a PR's issues, an issue's PRs" },
  { key: "trello", label: "Trello cards", about: "from their descriptions" },
];
const FIELDS = [
  { key: "account", label: "1Password account" },
  { key: "key", label: "Trello API key" },
  { key: "token", label: "Trello token" },
];
const linkValue = (key) => shared(LINKS)?.[key] ?? LINK_DEFAULTS[key];

// jj-spaces' and jj-agents' PREF_DEFAULTS.
const PREFS = { "jj-spaces": { icon: "shown", branch: "hidden" }, "jj-agents": { icon: "shown", description: "title", line: "space" } };
const SHOWN = [["shown", "Shown"], ["hidden", "Hidden"]];
const SIDEBAR_ROWS = [
  { store: "jj-spaces", key: "icon", label: "Icon", options: SHOWN },
  { store: "jj-spaces", key: "branch", label: "Branch", options: SHOWN },
  { store: "jj-agents", key: "icon", label: "Icon", options: SHOWN },
  { store: "jj-agents", key: "description", label: "Description", options: [["title", "Agent's title"], ["off", "Off"]] },
  { store: "jj-agents", key: "line", label: "Second line", options: [["space", "Space \u00b7 tab"], ["update", "Latest update"], ["off", "Off"]] },
];
const SECTIONS = { "jj-spaces": "Spaces", "jj-agents": "Agents" };
const prefValue = (row) => shared(row.store)?.[row.key] ?? PREFS[row.store][row.key];

function setPref(row, value) {
  const { [row.key]: _, ...rest } = shared(row.store) ?? {};
  setShared(row.store, value === PREFS[row.store][row.key] ? rest : { ...rest, [row.key]: value });
}

function cyclePref(row, delta) {
  const i = row.options.findIndex(([v]) => v === prefValue(row));
  setPref(row, row.options[(i + delta + row.options.length) % row.options.length][0]);
}

// Options side by side, the chosen one raised.
const segmented = (t, id, options, value, pick) => h_flex().flex_none().gap(2).text_size(12).children(options.map(([v, label]) => div()
  .id(`${id}-${v}`).px(8).py(3).rounded(5).cursor_pointer()
  .text_color(value === v ? t.foreground : t.muted)
  .when(value === v, (el) => el.bg(t.hover))
  .when(value !== v, (el) => el.hover((s) => s.text_color(t.foreground)))
  .on_click((_e, cx) => { pick(v); cx.notify(); })
  .child(label)));

// Only what differs from the defaults is kept.
function setLink(key, value) {
  const { [key]: _, ...rest } = shared(LINKS) ?? {};
  setShared(LINKS, value === LINK_DEFAULTS[key] || value === "" ? rest : { ...rest, [key]: value });
}

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

// A hidden header is kept as shared("jj-spacing.header"), so showing it again brings back its mod and size.
function bars(root, mode) {
  const frame = frameOf(root);
  if (!frame) return;
  if (mode === "none") {
    if (frame.header) setShared("jj-spacing.header", frame.header);
    delete frame.header;
    return;
  }
  frame.header = { ...(frame.header ?? shared("jj-spacing.header") ?? HEADER), reveal: mode };
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
    this.link = 0;
    this.side = 0;
    this.tab = TABS.find(([id]) => id === localStorage.getItem("tab"))?.[0] ?? "spacing";
    this.patterns = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    // Saved on ↵ or leaving the field: each save may have the sidebar ask 1Password.
    this.editing = null;
    this.fields = {};
    for (const f of FIELDS) {
      const input = InputState.new({ placeholder: LINK_DEFAULTS[f.key], value: linkValue(f.key) });
      const save = () => { const v = input.value().trim(); if (v !== linkValue(f.key)) setLink(f.key, v); };
      input.on("focus", (_e, cx) => { this.editing = f.key; cx.notify(); });
      input.on("blur", (_e, cx) => { this.editing = null; save(); cx.notify(); });
      input.on("submit", (_e, cx) => { save(); this.handle.focus(); cx.notify(); });
      this.fields[f.key] = input;
    }
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
    if (this.editing) return false;
    if (e.key === "tab") return this.show(TABS[(TABS.findIndex(([id]) => id === this.tab) + 1) % TABS.length][0]), true;
    const up = e.key === "up" || e.key === "k";
    const down = e.key === "down" || e.key === "j";
    const step = e.key === "left" || e.key === "h" || e.key === "-" ? -1 : e.key === "right" || e.key === "l" || e.key === "+" || e.key === "=" ? 1 : 0;
    if (this.tab === "sidebar") {
      const n = SIDEBAR_ROWS.length;
      if (up) this.side = (this.side + n - 1) % n;
      else if (down) this.side = (this.side + 1) % n;
      else if (step) cyclePref(SIDEBAR_ROWS[this.side], step);
      else return false;
      return true;
    }
    if (this.tab === "links") {
      const n = SWITCHES.length;
      if (up) this.link = (this.link + n - 1) % n;
      else if (down) this.link = (this.link + 1) % n;
      else if (e.key === "space" || e.key === "enter") setLink(SWITCHES[this.link].key, !linkValue(SWITCHES[this.link].key));
      else return false;
      return true;
    }
    if (this.tab === "hints") {
      const n = this.patterns?.length ?? 0;
      if (up && n) this.hint = (this.hint + n - 1) % n;
      else if (down && n) this.hint = (this.hint + 1) % n;
      else if ((e.key === "space" || e.key === "enter") && n) toggle(this.patterns[this.hint]);
      else return false;
      return true;
    }
    const n = ROWS.length + 1;
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
      .child(segmented(t, "bars", BARS, values.bars, (mode) => { this.at = ROWS.length; edit((root) => bars(root, mode)); }));
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
      hint: "↑↓ choose · space toggle · tab links · esc close",
    };
  }

  links(t) {
    const trello = shared("github")?.trello;
    const on = (key) => Boolean(linkValue(key));
    const row = (sw, i) => h_flex()
      .id(`link-${sw.key}`)
      .h(30)
      .px(8)
      .gap(10)
      .flex_none()
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .when(i === this.link, (el) => el.bg(t.selected))
      .when(i !== this.link, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => { this.link = i; setLink(sw.key, !on(sw.key)); cx.notify(); })
      .child(div().size(14).flex_none().flex().items_center().justify_center().rounded(4).border_1()
        .border_color(on(sw.key) ? t.accent : t.input).when(on(sw.key), (el) => el.bg(t.accent).text_color(t.accent_foreground))
        .when(on(sw.key), (el) => el.child(svg("mods/workspace-chrome/check.svg").size(10))))
      .child(div().flex_none().text_color(on(sw.key) ? t.foreground : t.muted).child(sw.label))
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(11.5).text_color(t.dim).child(sw.about));
    const field = (f) => h_flex()
      .h(34)
      .px(8)
      .gap(10)
      .flex_none()
      .items_center()
      .child(div().w(120).flex_none().text_color(t.muted).child(f.label))
      .child(Input.new(this.fields[f.key]).flex_1().min_w(0).h(28).px(8).items_center().rounded(6).border(1)
        .border_color(this.editing === f.key ? t.accent : t.input).bg(t.background).text_color(t.foreground));
    const cards = trello?.cards ?? 0;
    const status = {
      off: "Trello cards are off.",
      idle: "1Password is asked the first time a card shows.",
      busy: "Asking 1Password and Trello…",
      ok: `Connected · ${cards} card${cards === 1 ? "" : "s"}`,
      error: trello?.error,
    }[on("trello") ? (trello?.state ?? "idle") : "off"];
    const connect = div().id("connect").flex_none().px(8).py(3).rounded(5).bg(t.raised).text_color(t.foreground)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { setShared("jj-links.connect", Date.now()); cx.notify(); })
      .child(trello?.state === "ok" ? "Refresh" : "Connect");
    return {
      body: v_flex().flex_1().min_h(0).gap(4)
        .children(SWITCHES.map(row))
        .child(div().px(8).pt(10).pb(2).flex_none().text_size(11).text_color(t.dim).child("Where 1Password keeps Trello's key and token"))
        .children(FIELDS.map(field))
        .child(h_flex().px(8).pt(6).gap(8).flex_none().items_center()
          .child(div().flex_1().min_w(0).text_size(11.5).text_color(trello?.state === "error" && on("trello") ? t.blocked : t.dim).child(status ?? ""))
          .when(on("trello") && trello?.state !== "busy", (el) => el.child(connect))),
      reset: Object.keys(shared(LINKS) ?? {}).length ? () => {
        setShared(LINKS, {});
        for (const f of FIELDS) this.fields[f.key].set_value(LINK_DEFAULTS[f.key]);
      } : null,
      resetLabel: "Reset to defaults",
      hint: this.editing ? "↵ save · esc close" : "↑↓ choose · space toggle · tab sidebar · esc close",
    };
  }

  sidebar(t) {
    const row = (r, i) => h_flex()
      .id(`side-${r.store}-${r.key}`)
      .h(34)
      .px(8)
      .gap(6)
      .flex_none()
      .items_center()
      .rounded(7)
      .when(i === this.side, (el) => el.bg(t.selected))
      .on_click((_e, cx) => { this.side = i; cx.notify(); })
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(r.label))
      .child(segmented(t, `side-${r.store}-${r.key}`, r.options, prefValue(r), (v) => { this.side = i; setPref(r, v); }));
    const section = (store) => div().px(8).pt(6).flex_none().text_size(11).text_color(t.dim).child(SECTIONS[store]);
    return {
      body: v_flex().flex_1().min_h(0).gap(4)
        .children(SIDEBAR_ROWS.flatMap((r, i) => [...(SIDEBAR_ROWS[i - 1]?.store !== r.store ? [section(r.store)] : []), row(r, i)]))
        .child(div().px(8).pt(10).text_size(11.5).text_color(t.dim)
          .child("The agent's title is Claude's /rename or AI title, or the title another agent sets. The latest update is Claude's summary of its last turn. Right-click an agent to give it a description of its own or hide its description.")),
      reset: Object.keys(PREFS).some((store) => Object.keys(shared(store) ?? {}).length) ? () => { for (const store of Object.keys(PREFS)) setShared(store, {}); } : null,
      resetLabel: "Reset to defaults",
      hint: "↑↓ choose · ←→ change · tab spacing · esc close",
    };
  }

  render() {
    const t = theme();
    const view = this.tab === "hints" ? this.hints(t) : this.tab === "links" ? this.links(t) : this.tab === "sidebar" ? this.sidebar(t) : this.spacing(t);
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
