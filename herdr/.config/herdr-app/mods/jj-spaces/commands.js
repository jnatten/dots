// Commands in front of a shell, for the marks on space rows, the rail and the tab bar
// (jj-tabs, through shared("commands.tabs")) and the session search's Running and Finished
// commands (jj-sessions, through shared("commands.running") and shared("commands.done")):
// running, and finished while its pane wasn't
// focused in this window (on screen), until it is. A command is a program that's neither a shell nor
// an agent (agents report a status) nor on the skip list (the spacing dialog's Commands tab,
// shared("jj-commands")); only one going back to its shell finishes, so an agent ending never
// does. Each window keeps its own; the one that focuses it sets jj.seen on the terminal, so the
// others let go too. fish's postexec puts the exit code there as jj.exit=<code>:<epoch s>, and
// the command line as jj.cmd.

import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { terminals, window, focused, hc, run, shared, setShared } from "herdr";
import { duration, icon, machineIcon, pref as agentPref, treeLines } from "./agent-parts.js";

// jj-spacing/commands-tab.js's SKIP.
export const SKIP = ["nvim", "vim", "vi", "hx", "emacs", "nano", "less", "man", "lazygit", "jjui", "tig", "gitui", "htop", "btop", "top", "k9s", "yazi", "ranger", "lf", "ssh", "mosh", "tmux", "zellij"];
const SHOW = 2000;
const LONG = 3000;
// Back at the shell this long before it counts: a script's own shell can come to the front between its programs.
const SETTLE = 600;
const SEEN = 20;
const RANK = { failed: 4, ok: 3, unknown: 2, running: 1 };

export const programId = (program) => (program.key === "program" ? program.name : program.key).toLowerCase();

function skipped() {
  const cfg = shared("jj-commands") ?? {};
  const keep = new Set((cfg.keep ?? []).map((p) => p.toLowerCase()));
  return new Set([...SKIP.filter((p) => !keep.has(p)), ...(cfg.skip ?? []).map((p) => p.toLowerCase())]);
}

function front(p, skip) {
  if (p.status || p.program?.agent) return "agent";
  if (!p.program || p.program.shell) return "shell";
  return skip.has(p.program.key.toLowerCase()) || skip.has(p.program.name.toLowerCase()) ? "skip" : "command";
}

// Whether this window has the pane focused, on screen. A focused layout terminal block has no pane.
function focus() {
  const f = window()?.visible ? focused() : null;
  return (pane, terminal) => Boolean(f) && (f.pane ? f.pane === pane : f.terminal === terminal);
}

// fish's title while a command runs: the command, then the folder.
const bare = (title) => title.replace(/\s+[~/]\S*$/, "");

// What ran, from the titles its terminal had: fish's title is the command and the folder, and
// turns back into the folder alone (`prompt`) a moment before the shell is seen in front again.
function titleOf(run, prompt) {
  const title = [...run.titles].reverse().find((t) => t && t !== prompt) ?? run.name;
  return prompt && title.endsWith(` ${prompt}`) ? title.slice(0, -prompt.length).trim() : title;
}

const seen = (terminal) => hc(["label", terminal, `jj.seen=${Date.now()}`]).catch(() => null);

export function commandsInit(view) {
  view.cmdRunning = {}; // pane -> { since, tab, terminal, title, titles, name, shown, shellAt }
  view.cmdDone = {}; // pane -> { since, at, tab, terminal, title, name, exit }
  view.cmdTabs = {}; // tab -> its most urgent mark
  view.cmdPrograms = shared("commands.seen") ?? [];
  setShared("commands.tabs", {});
  setShared("commands.done", []);
  setShared("commands.running", []);
}

export function commandsDue(view, now, ps, cx) {
  const skip = skipped();
  const looks = focus();
  const tabOf = {};
  let changed = false;
  for (const p of ps) {
    if (!p.terminal) continue;
    tabOf[p.pane] = p.tab;
    const kind = front(p, skip);
    const run = view.cmdRunning[p.pane];
    if (kind === "command") {
      if (!run) {
        view.cmdRunning[p.pane] = { since: now, tab: p.tab, terminal: p.terminal, title: p.title, titles: [p.title], name: p.program.name, shown: false, shellAt: null };
        continue;
      }
      Object.assign(run, { tab: p.tab, shellAt: null });
      if (p.title && p.title !== run.title) {
        run.title = p.title;
        run.titles = [...run.titles, p.title].slice(-5);
        changed ||= run.shown;
      }
      if (!run.shown && now - run.since >= SHOW) {
        run.shown = true;
        changed = true;
        noteProgram(view, p.program);
      }
      continue;
    }
    if (!run) continue;
    if (kind === "shell") {
      run.shellAt ??= now;
      if (now - run.shellAt < SETTLE) continue;
    }
    delete view.cmdRunning[p.pane];
    changed ||= run.shown;
    if (kind !== "shell" || run.shellAt - run.since < LONG) continue;
    if (looks(p.pane, p.terminal)) seen(p.terminal);
    else {
      view.cmdDone[p.pane] = { since: run.since, at: run.shellAt, tab: p.tab, terminal: p.terminal, title: titleOf(run, p.title), name: run.name, exit: null };
      changed = true;
    }
  }
  for (const pane of Object.keys(view.cmdRunning)) {
    if (pane in tabOf) continue;
    delete view.cmdRunning[pane];
    changed = true;
  }
  const done = Object.entries(view.cmdDone);
  const labels = done.length ? new Map(terminals().map((t) => [t.address, t.labels ?? {}])) : null;
  for (const [pane, d] of done) {
    const l = labels.get(d.terminal) ?? {};
    if (!(pane in tabOf) || Number(l["jj.seen"]) >= d.since) {
      delete view.cmdDone[pane];
      changed = true;
      continue;
    }
    d.tab = tabOf[pane];
    if (looks(pane, d.terminal)) {
      delete view.cmdDone[pane];
      seen(d.terminal);
      changed = true;
      continue;
    }
    const m = /^(\d+):(\d+)$/.exec(l["jj.exit"] ?? "");
    if (d.exit === null && m && m[2] * 1000 >= d.since - 1000 && m[2] * 1000 <= d.at + 5000) {
      d.exit = Number(m[1]);
      d.title = l["jj.cmd"] || d.title;
      changed = true;
    }
  }
  if (changed) publish(view, cx);
}

function noteProgram(view, program) {
  const id = programId(program);
  view.cmdPrograms = [{ id, name: program.name }, ...view.cmdPrograms.filter((p) => p.id !== id)].slice(0, SEEN);
  setShared("commands.seen", view.cmdPrograms);
}

const markOf = (c) => {
  if (!c.at) return { state: "running", rank: RANK.running, tip: `${c.title || c.name} · running`, title: c.title || c.name, since: c.since };
  const state = c.exit === null ? "unknown" : c.exit === 0 ? "ok" : "failed";
  return { state, rank: RANK[state], tip: `${c.title || c.name} · ${state === "failed" ? `failed (exit ${c.exit})` : "finished"}`, title: c.title || c.name, at: c.at };
};

function publish(view, cx) {
  const tabs = {};
  for (const c of [...Object.values(view.cmdRunning).filter((r) => r.shown), ...Object.values(view.cmdDone)]) {
    const m = markOf(c);
    if (!tabs[c.tab] || tabs[c.tab].rank < m.rank) tabs[c.tab] = m;
  }
  view.cmdTabs = tabs;
  if (JSON.stringify(tabs) !== JSON.stringify(shared("commands.tabs") ?? {})) setShared("commands.tabs", tabs);
  const done = Object.entries(view.cmdDone).map(([pane, d]) => ({ pane, terminal: d.terminal, tab: d.tab, title: d.title || d.name, exit: d.exit, at: d.at }));
  if (JSON.stringify(done) !== JSON.stringify(shared("commands.done") ?? [])) setShared("commands.done", done);
  const running = Object.entries(view.cmdRunning).filter(([, r]) => r.shown).map(([pane, r]) => ({ pane, terminal: r.terminal, tab: r.tab, title: bare(r.title ?? "") || r.name, since: r.since }));
  if (JSON.stringify(running) !== JSON.stringify(shared("commands.running") ?? [])) setShared("commands.running", running);
  cx.notify();
}

// A space's most urgent mark over its tabs, or null.
export function spaceCommand(view, space) {
  return (space.tabs ?? []).map((t) => view.cmdTabs[t.id]).filter(Boolean).reduce((a, b) => (a && a.rank >= b.rank ? a : b), null);
}

export const commandTone = (t, m) => ({ running: t.ansi6, ok: t.ansi2, failed: t.blocked, unknown: t.done })[m.state];

// Running: the agents' ring spinner around the glyph, in a color of its own; finished: the glyph on a tinted tile.
export function commandMark(id, m, t, size = 16) {
  const tip = m.at ? `${m.tip} ${duration(Date.now() - m.at)} ago` : `${m.tip} ${duration(Date.now() - m.since)}`;
  const color = commandTone(t, m);
  const box = div().id(id).relative().size(size).flex_none().flex().items_center().justify_center().tooltip(tip)
    .child(svg("mods/workspace-chrome/terminal.svg").size(Math.round(size * 0.55)).text_color(color));
  return m.state === "running"
    ? box.child(div().absolute().top(0).left(0).size(size).child(svg("mods/workspace-chrome/spinner.svg").size(size).text_color(color).spin(900)))
    : box.rounded(4).bg(color + "2e");
}

// A pane's command mark: finished unseen, else running (after SHOW), else null.
function paneMark(view, pane) {
  const c = view.cmdDone[pane] ?? (view.cmdRunning[pane]?.shown ? view.cmdRunning[pane] : null);
  return c ? markOf(c) : null;
}

// A space's terminals for the tree (its Terminals pref, from the spacing dialog's Sidebar tab):
// none, those with a mark, or all; agents aren't terminals here.
export function terminalList(view, w, ps) {
  const mode = shared("jj-spaces")?.terminals ?? "off";
  if (mode === "off") return [];
  const tabs = new Set((w.tabs ?? []).map((tab) => tab.id));
  return ps
    .filter((p) => p.terminal && tabs.has(p.tab) && !p.status && !p.program?.agent)
    .map((p) => ({ p, m: paneMark(view, p.pane) }))
    .filter(({ m }) => mode === "all" || m);
}

// Drawn as the tree's agent rows: its program's icon, what runs or ran (fish's title without its
// folder), how long ago and the mark; a terminal at its prompt shows its title, muted.
export function terminalRows(list, t, now, lead = []) {
  const shown = focused()?.pane;
  return list.map(({ p, m }, i) => {
    const name = m?.state === "running" ? bare(p.title) || m.title : m ? m.title : p.name ?? p.title ?? p.program?.name ?? "";
    const when = m ? duration(now - (m.at ?? m.since)) : null;
    const pic = agentPref("icon") === "hidden" ? null : icon(p.program, 14, t.foreground);
    return h_flex()
      .id(`tree-term-${p.pane}`)
      .pl(16)
      .pr(8)
      .h(26)
      .flex_none()
      .items_center()
      .rounded(8)
      .text_size(12.5)
      .cursor_pointer()
      .when(shown === p.pane, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("pane.focus", { pane: p.pane }))
      .children(treeLines(t, [...lead, i === list.length - 1 ? "└" : "├"]))
      .when(Boolean(pic), (el) => el.child(h_flex().flex_none().h(20).mr(8).items_center().child(pic)))
      .when(agentPref("machine") === "icon", (el) => el.child(machineIcon(t, p.terminal).mr(8)))
      .child(h_flex().flex_1().min_w(0).h(20).gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_color(m ? t.foreground : t.muted).child(name))
        .when(Boolean(when), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(when)))
        .when(Boolean(m), (el) => el.child(commandMark(`tree-cmd-${p.pane}`, m, t, 14))));
  });
}
