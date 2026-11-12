// Open a recent location (zoxide's ranked folders and open panes', per machine) as a new
// space (↵), a tab in the shown space (⌘↵) or a pane beside the focused one (⇧↵); or
// start Claude Code there in a new space (jj-open.claude, jj-open.claude-worktree).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { spaces, panes, machines, theme, props, run, exec, closeOverlay, nextCommand } from "herdr";

const LIST = 440;
const CAP = 100;
const ICON = (name) => `mods/workspace-chrome/${name}.svg`;
const CLAUDE = { claude: ["claude"], "claude-worktree": ["claude", "--worktree"] };
const RESOLVE = 'p=$1; case $p in "~"*) p="$HOME${p#"~"}";; esac; cd "$p" 2>/dev/null && pwd';

const base = (path) => path.replace(/\/+$/, "").split("/").pop();
const tilde = (path) => path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
const parent = (path) => tilde(path.replace(/\/+$/, "").replace(/\/[^/]*$/, "") || "/");
const zoxide = (args, on) => exec("zoxide", args, { on, timeout: 8000 });

// "rekkert › guest-limits" for a workspace kept inside or beside its repo, else the folder's name.
function label(cwd) {
  const claude = cwd.match(/^(.*)\/\.claude\/worktrees\/([^/]+)/);
  if (claude) return `${base(claude[1])} › ${claude[2]}`;
  const herdr = cwd.match(/\/\.herdr\/workspaces\/([^/]+)\/([^/]+)/);
  if (herdr) return `${herdr[1]} › ${herdr[2]}`;
  return base(cwd) || cwd;
}

const shown = () => spaces().find((s) => s.active);

export default class Open extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.text = "";
    this.at = 0;
    this.error = "";
    this.ranked = {};
    this.childOf = [];
    this.scroll = ScrollHandle.new();
    this.hosts = [null, ...machines().filter((m) => m.name && m.layout !== "unavailable").map((m) => m.name)];
    this.input = InputState.new({ placeholder: "Open a folder…" });
    this.input.on("change", (_e, cx) => {
      this.text = this.input.value();
      this.at = 0;
      this.error = "";
      cx.notify();
    });
    this.input.on("submit", (e, cx) => this.go(this.items()[this.at], e.secondary ? "tab" : e.shift ? "pane" : "space", cx));
    this.input.focus();
    cx.spawn(async (cx) => {
      for (;;) {
        const argv = CLAUDE[await nextCommand()];
        if (argv) this.go(this.items()[this.at], "space", cx, argv);
      }
    });
    for (const m of this.hosts)
      cx.spawn(async (cx) => {
        const r = await zoxide(["query", "--list"], m).catch(() => null);
        this.ranked[m ?? ""] = r?.code === 0 ? r.stdout.split("\n").filter(Boolean) : [];
        cx.notify();
      });
  }

  hide() {
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }

  opened() {
    const machineOf = new Map(spaces().flatMap((s) => s.tabs.map((tb) => [tb.id, s.machine ?? ""])));
    const out = new Map();
    for (const p of panes()) {
      const k = machineOf.get(p.tab);
      if (!p.cwd || k === undefined) continue;
      if (!out.has(k)) out.set(k, new Set());
      out.get(k).add(p.cwd);
    }
    return out;
  }

  sections() {
    const text = this.text.trim();
    const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
    const open = this.opened();
    const out = [];
    if (/^[~/]/.test(text)) out.push({ name: null, list: [{ path: text, machine: shown()?.machine ?? null, typed: true }], loading: false });
    for (const m of this.hosts) {
      const k = m ?? "";
      const ranked = this.ranked[k];
      const here = open.get(k) ?? new Set();
      const all = [...new Set([...(ranked ?? []), ...here])].map((path) => ({ path, machine: m, open: here.has(path) }));
      const hits = all.filter((r) => tokens.every((t) => `${tilde(r.path)} ${k}`.toLowerCase().includes(t)));
      out.push({ name: m ?? "This computer", list: hits.slice(0, CAP), total: hits.length, loading: ranked === undefined });
    }
    return out;
  }

  items() {
    return this.sections().flatMap((s) => s.list);
  }

  go(it, how, cx, argv) {
    if (!it) return;
    const cur = shown();
    if (how !== "space" && cur && (cur.machine ?? null) !== it.machine) {
      this.error = `This space is on ${cur.machine ?? "this computer"}: ↵ opens it as a new space.`;
      return cx.notify();
    }
    cx.spawn(async (cx) => {
      const folder = it.typed ? await this.resolve(it) : it.path;
      if (!folder) {
        this.error = `No such folder: ${it.path}`;
        return cx.notify();
      }
      if (how === "space" || !cur) run("space.new", { folder, machine: it.machine ?? "", ...(argv && { tab: "Claude", argv }) });
      else if (how === "tab") run("tab.new", { space: cur.id, folder });
      else run("terminal.open", { folder, place: "right" });
      zoxide(["add", folder], it.machine).catch(() => {});
      this.hide();
    });
  }

  async resolve(it) {
    const r = await exec("sh", ["-c", RESOLVE, "sh", it.path], { on: it.machine }).catch(() => null);
    return r?.code === 0 ? r.stdout.trim() : "";
  }

  forget(it) {
    if (!it || it.typed) return;
    const k = it.machine ?? "";
    this.ranked[k] = (this.ranked[k] ?? []).filter((p) => p !== it.path);
    zoxide(["remove", it.path], it.machine).catch(() => {});
  }

  render() {
    const t = theme();
    const sections = this.sections();
    const items = sections.flatMap((s) => s.list);
    this.at = Math.min(this.at, Math.max(0, items.length - 1));
    const selected = items[this.at];
    const cur = shown();
    const row = (r, i) => {
      const on = i === this.at;
      return h_flex()
        .id(r.typed ? "loc-typed" : `loc-${r.machine ?? ""}:${r.path}`)
        .h(32)
        .flex_none()
        .px(10)
        .gap(9)
        .items_center()
        .rounded(7)
        .cursor_pointer()
        .when(on, (el) => el.bg(t.selected))
        .when(!on, (el) => el.hover((st) => st.bg(t.hover)))
        .on_click((_e, cx) => this.go(r, "space", cx))
        .child(h_flex().w(14).flex_none().justify_center().child(svg(ICON(r.typed ? "folder-plus" : "folder")).size(13).text_color(t.dim)))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(r.typed ? `Open ${r.path}` : label(r.path)))
        .child(div().flex_none().max_w(280).truncate().text_size(11.5).text_color(t.dim).child(r.typed ? (r.machine ? `on ${r.machine}` : "") : parent(r.path)))
        .child(h_flex().flex_none().w(36).justify_end().text_size(11).text_color(t.dim).child(r.open ? "open" : ""));
    };
    const children = [];
    this.childOf = [];
    let n = 0;
    let headers = 0;
    for (const { name, list, total, loading } of sections) {
      if (!list.length && !loading) continue;
      if (name) {
        headers++;
        children.push(h_flex().h(26).px(10).pt(6).flex_none().items_center().text_size(11).text_color(t.dim).child(loading ? `${name} · loading…` : `${name} · ${total > list.length ? `${list.length} of ${total}` : list.length}`));
      }
      for (const r of list) {
        this.childOf[n] = children.length;
        children.push(row(r, n++));
      }
    }
    const empty = items.length === 0 && !sections.some((s) => s.loading);
    const height = Math.min(LIST, empty ? 40 : headers * 26 + items.length * 32);
    const here = selected && (!cur || (cur.machine ?? null) === selected.machine);
    const hint = !selected ? "" : [here ? "↵ space · ⌘↵ tab · ⇧↵ pane" : "↵ space", "⌘⇧C claude · ⌥⇧C worktree", selected.typed ? "" : "^D forget"].filter(Boolean).join(" · ");
    return v_flex()
      .id("open")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        const count = items.length;
        const ctrl = e.modifiers.control && !e.modifiers.platform && !e.modifiers.alt && !e.modifiers.shift;
        const down = e.key === "down" || (ctrl && (e.key === "j" || e.key === "n"));
        const up = e.key === "up" || (ctrl && (e.key === "k" || e.key === "p"));
        if (e.key === "escape") return this.hide();
        if (down && count) this.at = (this.at + 1) % count;
        else if (up && count) this.at = (this.at + count - 1) % count;
        else if (ctrl && e.key === "d") this.forget(selected);
        else return;
        this.scroll.scroll_to_item(this.childOf[this.at] ?? 0);
        cx.stop_propagation();
        cx.notify();
      })
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Open location"))
      .child(
        h_flex()
          .h(36)
          .flex_none()
          .px(10)
          .gap(8)
          .items_center()
          .rounded(9)
          .border_1()
          .border_color(t.accent)
          .bg(t.background)
          .child(svg(ICON("search")).size(15).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      )
      .child(
        v_flex()
          .id("open-list")
          .h(height)
          .flex_none()
          .overflow_y_scrollbar()
          .track_scroll(this.scroll)
          .children(children)
          .when(empty, (el) => el.child(div().p(10).text_color(t.dim).child("No matching folders."))),
      )
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(h_flex().justify_end().text_size(11).text_color(t.dim).child([hint, "esc close"].filter(Boolean).join(" · ")));
  }
}
