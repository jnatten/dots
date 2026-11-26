// Commands in front of a shell, for the marks on space rows, the rail and the tab bar
// (jj-tabs, through shared("commands.tabs")): running, and finished while this window
// wasn't showing their tab, until it does. A command is a program that's neither a shell nor
// an agent (agents report a status) nor on the skip list (the spacing dialog's Commands tab,
// shared("jj-commands")); only one going back to its shell finishes, so an agent ending never
// does. Each window keeps its own; the one that looks sets jj.seen on the terminal, so the
// others let go too. fish's postexec puts the exit code there as jj.exit=<code>:<epoch s>.

import { div, svg } from "gpui-kit";
import { terminals, window, hc, shared, setShared } from "herdr";
import { duration } from "./agent-parts.js";

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

// The tabs this window shows now: none while it's off screen.
function looking(sp) {
  if (!window()?.visible) return new Set();
  return new Set((sp.find((s) => s.active)?.tabs ?? []).filter((t) => t.active).map((t) => t.id));
}

const seen = (terminal) => hc(["label", terminal, `jj.seen=${Date.now()}`]).catch(() => null);

export function commandsInit(view) {
  view.cmdRunning = {}; // pane -> { since, tab, terminal, title, name, shown, shellAt }
  view.cmdDone = {}; // pane -> { since, at, tab, terminal, title, name, exit }
  view.cmdTabs = {}; // tab -> its most urgent mark
  view.cmdPrograms = shared("commands.seen") ?? [];
  setShared("commands.tabs", {});
}

export function commandsDue(view, now, sp, ps, cx) {
  const skip = skipped();
  const shown = looking(sp);
  const tabOf = {};
  let changed = false;
  for (const p of ps) {
    if (!p.terminal) continue;
    tabOf[p.pane] = p.tab;
    const kind = front(p, skip);
    const run = view.cmdRunning[p.pane];
    if (kind === "command") {
      if (!run) {
        view.cmdRunning[p.pane] = { since: now, tab: p.tab, terminal: p.terminal, title: p.title, name: p.program.name, shown: false, shellAt: null };
        continue;
      }
      Object.assign(run, { tab: p.tab, title: p.title || run.title, shellAt: null });
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
    if (shown.has(p.tab)) seen(p.terminal);
    else {
      view.cmdDone[p.pane] = { since: run.since, at: run.shellAt, tab: p.tab, terminal: p.terminal, title: run.title, name: run.name, exit: null };
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
    if (shown.has(d.tab)) {
      delete view.cmdDone[pane];
      seen(d.terminal);
      changed = true;
      continue;
    }
    const m = /^(\d+):(\d+)$/.exec(l["jj.exit"] ?? "");
    if (d.exit === null && m && m[2] * 1000 >= d.since - 1000 && m[2] * 1000 <= d.at + 5000) {
      d.exit = Number(m[1]);
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
  if (!c.at) return { state: "running", rank: RANK.running, tip: `${c.title || c.name} · running`, since: c.since };
  const state = c.exit === null ? "unknown" : c.exit === 0 ? "ok" : "failed";
  return { state, rank: RANK[state], tip: `${c.title || c.name} · ${state === "failed" ? `failed (exit ${c.exit})` : "finished"}`, at: c.at };
};

function publish(view, cx) {
  const tabs = {};
  for (const c of [...Object.values(view.cmdRunning).filter((r) => r.shown), ...Object.values(view.cmdDone)]) {
    const m = markOf(c);
    if (!tabs[c.tab] || tabs[c.tab].rank < m.rank) tabs[c.tab] = m;
  }
  view.cmdTabs = tabs;
  if (JSON.stringify(tabs) !== JSON.stringify(shared("commands.tabs") ?? {})) setShared("commands.tabs", tabs);
  cx.notify();
}

// A space's most urgent mark over its tabs, or null.
export function spaceCommand(view, space) {
  return (space.tabs ?? []).map((t) => view.cmdTabs[t.id]).filter(Boolean).reduce((a, b) => (a && a.rank >= b.rank ? a : b), null);
}

export const commandTone = (t, m) => ({ running: t.muted, ok: t.ansi2, failed: t.blocked, unknown: t.done })[m.state];

export function commandMark(id, m, t, size = 12) {
  const tip = m.at ? `${m.tip} ${duration(Date.now() - m.at)} ago` : `${m.tip} ${duration(Date.now() - m.since)}`;
  return div().id(id).flex_none().flex().items_center().tooltip(tip)
    .child(svg("mods/workspace-chrome/terminal.svg").size(size).text_color(commandTone(t, m)));
}
