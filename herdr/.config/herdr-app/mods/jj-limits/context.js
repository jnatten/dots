// The shown Claude session's context, from the labels its status line sets on its
// terminal (claude/.claude/hooks/statusline.sh in dots), and its breakdown by
// category from Claude's own /context, run on a throwaway fork of the session.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { terminals, panes, focused, exec, hc, home, readTextFile } from "herdr";

export const tokens = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`);

// Context breakdown colors, handed out in the report's order; Messages, usually the most, stays neutral.
const PALETTE = ["ansi4", "ansi5", "ansi6", "ansi2", "ansi3", "ansi1", "ansi12", "ansi14", "ansi11", "ansi13"];

const percentOf = (labels) => {
  const v = labels?.["claude.context"];
  return v !== undefined && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null;
};

const lastIn = new Map(); // tab -> the Claude terminal focused last there

// The Claude session the shown tab shows: the focused pane's, else the one
// focused last in that tab, else its first.
export function shownSession() {
  const f = focused();
  if (!f?.tab) return null;
  const labels = new Map(terminals().map((x) => [x.address, x.labels ?? {}]));
  const here = panes()
    .filter((p) => p.tab === f.tab && p.terminal)
    .map((p) => (p.focused && f.shown) || p.terminal)
    .filter((address) => percentOf(labels.get(address)) !== null);
  const now = f.shown ?? f.terminal;
  if (here.includes(now)) lastIn.set(f.tab, now);
  const address = here.includes(lastIn.get(f.tab)) ? lastIn.get(f.tab) : here[0];
  if (!address) return null;
  const mine = labels.get(address);
  return {
    address,
    labels: mine,
    context: percentOf(mine),
    size: Number(mine["claude.context_size"]) || 0,
    machine: address.includes("/") ? address.split("/")[0] : null,
  };
}

// Claude's `/context` report: the totals line and its "Estimated usage by category" table.
function parseContext(md) {
  const num = (v) => {
    const m = String(v).trim().toLowerCase().match(/^([\d.]+)\s*([km]?)$/);
    return m ? Number(m[1]) * (m[2] === "m" ? 1e6 : m[2] === "k" ? 1e3 : 1) : 0;
  };
  const total = md.match(/\*\*Tokens:\*\*\s*([\d.]+[km]?)\s*\/\s*([\d.]+[km]?)/i);
  const rows = [];
  let table = false;
  for (const line of (md.split("### Estimated usage by category")[1] ?? "").split("\n")) {
    if (!line.startsWith("|")) {
      if (table) break;
      continue;
    }
    table = true;
    const [name, count, pct] = line.split("|").slice(1, -1).map((c) => c.trim());
    if (name === "Category" || /^-+$/.test(name)) continue;
    rows.push({ name, tokens: num(count), pct: parseFloat(pct) || 0 });
  }
  return { used: total ? num(total[1]) : null, size: total ? num(total[2]) : null, rows };
}

// A terminal's Claude session from ~/.claude/sessions/<pid>.json: its
// foreground process's, or a child's when a shell launched it.
async function sessionOf(address) {
  try {
    const pid = JSON.parse((await hc(["get", address, "--json"])).stdout).foreground?.pid;
    const kids = pid ? (await exec("pgrep", ["-P", String(pid)])).stdout.split(/\s+/).filter(Boolean) : [];
    for (const p of pid ? [pid, ...kids] : []) {
      const s = JSON.parse((await readTextFile(`${home()}/.claude/sessions/${p}.json`).catch(() => null)) ?? "null");
      if (s?.sessionId) return { sid: s.sessionId, cwd: s.cwd };
    }
  } catch {}
  return null;
}

const breakdown = new Map(); // address -> { key, loading, data, error }: its last /context

// Runs Claude's own /context on a throwaway, unsaved fork of the session.
export function measure(s, cx) {
  const key = `${s.labels["claude.session"] ?? ""} ${s.labels["claude.context"] ?? ""}`;
  const prev = breakdown.get(s.address);
  if (prev?.loading || (prev?.key === key && prev.data)) return;
  breakdown.set(s.address, { ...prev, key, loading: true, error: "" });
  cx.spawn(async (cx) => {
    let sid = s.labels["claude.session"], cwd = s.labels["claude.cwd"];
    if (!sid && !s.machine) ({ sid, cwd } = (await sessionOf(s.address)) ?? {});
    let data = prev?.data ?? null, error = "";
    if (!sid || !cwd) error = "its session isn't known yet";
    else {
      try {
        const r = await exec("claude", ["-p", "--resume", sid, "--fork-session", "--no-session-persistence", "/context"], { cwd, on: s.machine, timeout: 120000 });
        const parsed = r.code === 0 ? parseContext(r.stdout) : null;
        if (parsed?.rows.length) data = parsed;
        else error = (r.stderr || r.stdout || "").trim().split("\n")[0] || "no breakdown";
      } catch (e) {
        error = String(e);
      }
    }
    breakdown.set(s.address, { key, loading: false, data, error });
    cx.notify();
  });
}

export function contextPanel(t, s) {
  const b = breakdown.get(s.address);
  const d = b?.data;
  const rows = d?.rows ?? [];
  const used = rows.filter((r) => !/deferred/i.test(r.name) && !/buffer/i.test(r.name) && r.name !== "Free space" && r.tokens > 0);
  const free = rows.find((r) => r.name === "Free space");
  const buffer = rows.find((r) => /buffer/i.test(r.name));
  const deferred = rows.filter((r) => /deferred/i.test(r.name) && r.tokens > 0);
  const shades = used.filter((r) => r.name !== "Messages").map((r) => r.name);
  const color = (name) => (name === "Messages" ? t.muted : t[PALETTE[shades.indexOf(name) % PALETTE.length]] ?? t.muted);
  const swatch = (bg, border) => div().size(8).flex_none().rounded(2).bg(bg).when(Boolean(border), (el) => el.border_1().border_color(border));
  const entry = (dot, name, count, pct, quiet) =>
    h_flex()
      .gap(7)
      .items_center()
      .child(dot)
      .child(div().flex_1().min_w(0).truncate().text_color(quiet ? t.dim : t.foreground).child(name))
      .child(div().flex_none().text_color(t.dim).child(tokens(count)))
      .child(h_flex().w(42).flex_none().justify_end().text_color(t.dim).child(`${pct.toFixed(1)}%`));
  const summary = d?.used != null ? `${tokens(d.used)} / ${tokens(d.size)} · ${Math.round(s.context)}%` : `${Math.round(s.context)}% of ${s.size ? tokens(s.size) : "the window"}`;
  return v_flex()
    .w(280)
    .p(10)
    .gap(5)
    .rounded(8)
    .bg(t.raised)
    .border_1()
    .border_color(t.border)
    .shadow_md()
    .text_size(11.5)
    .child(h_flex().justify_between().items_center().child(div().font_medium().text_color(t.foreground).child("Context")).child(div().text_color(t.dim).child(summary)))
    .child(
      h_flex()
        .w_full()
        .h(8)
        .mb(3)
        .rounded(4)
        .overflow_hidden()
        .bg(t.hover)
        .children(used.map((r) => div().h_full().flex_none().w(`${Math.max(r.pct, 0.6)}%`).bg(color(r.name))))
        .child(div().h_full().flex_1())
        .when(Boolean(buffer), (el) => el.child(div().h_full().flex_none().w(`${buffer.pct}%`).bg(t.dim))),
    )
    .when(!d, (el) => el.child(div().text_color(t.dim).child(b?.error ? `Couldn't measure: ${b.error}` : "Measuring…")))
    .children(used.map((r) => entry(swatch(color(r.name)), r.name, r.tokens, r.pct)))
    .when(Boolean(free), (el) => el.child(entry(swatch(t.hover, t.dim), free.name, free.tokens, free.pct, true)))
    .when(Boolean(buffer), (el) => el.child(entry(swatch(t.dim), buffer.name, buffer.tokens, buffer.pct, true)))
    .when(deferred.length > 0, (el) => el.child(div().text_size(10.5).text_color(t.dim).child(`Not loaded: ${deferred.map((r) => `${r.name.replace(/ \(deferred\)/i, "")} ${tokens(r.tokens)}`).join(" · ")}`)))
    .when(Boolean(d && b?.loading), (el) => el.child(div().text_size(10.5).text_color(t.dim).child("Updating…")))
    .when(Boolean(d && b?.error), (el) => el.child(div().text_size(10.5).text_color(t.blocked).child(`Couldn't update: ${b.error}`)));
}
