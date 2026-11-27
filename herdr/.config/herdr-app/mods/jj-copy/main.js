// A terminal pane's screen and history, with the keyboard. Opened as an overlay
// with props { action, terminal }: "copy" ({ pane }: a vim-style copy mode, drawn by
// copy.mjs), "fingers" ({ pane, cwd }: hints on the screen's hashes, paths, URLs...,
// drawn by fingers.mjs), each in a terminal shown in the pane for now, or "nvim" (opens
// the text in Neovim as a peek over the tab, then closes; { colors } keeps colours).

import { View, div } from "gpui-kit";
import { props, terminals, panes, run, exec, hc, appHome, home, notify, closeOverlay, shared, setShared, readTextFile } from "herdr";

const HISTORY = "100000";
const sleep = (cx, ms) => new Promise((resolve) => cx.timer.after(ms, () => resolve()));

// Neovim and Node, found once through the login shell's PATH.
let nvim = null;
const neovim = async () => (nvim ??= (await exec("sh", ["-lc", "command -v nvim"])).stdout.trim() || "nvim");
let node = null;
const nodejs = async () => (node ??= (await exec("sh", ["-lc", "command -v node"])).stdout.trim() || "node");

// The temp file each way of reading the pane writes, and how Neovim shows it. Plain
// is `hc read`'s text, read-only. Coloured is capture.mjs's output through
// `:terminal cat`, as tmux's capture-and-edit did, ending at the last line of output.
const WAYS = {
  plain: {
    write: 'hc read "$1" --lines "$3" --json | jq -r .text >"$f"',
    show: '"$2" -R -n "+normal G" "+call search(\'\\S\', \'bcW\')" "$1"; rm -f "$1"',
  },
  colors: {
    write: '"$4" "$2" "$1" "$f" "$3"',
    show: '"$2" -n -c "autocmd TermClose * ++once execute \'normal! G\' | call search(\'^\\[Process exited\', \'bW\') | call search(\'\\S\', \'bW\') | normal! 0" -c "terminal cat $1"; rm -f "$1"',
  },
};

// The pane's text in a temp file, open in Neovim in the pane's folder as a peek over
// the tab. The peek closes when Neovim quits, and the temp file goes with it.
async function capture(cx, terminal, cwd, colors) {
  const way = WAYS[colors ? "colors" : "plain"];
  const helper = `${appHome()}/mods/jj-copy/capture.mjs`;
  const file = await exec("sh", ["-c", `f=$(mktemp "\${TMPDIR:-/tmp}/herdr-capture.XXXXXX") && ${way.write} && printf %s "$f"`, "sh", terminal, helper, HISTORY, await nodejs()], { timeout: 60000 });
  const path = (file.stdout ?? "").trim();
  if (file.code !== 0 || !path) throw new Error((file.stderr || "couldn't read the pane").trim());
  const here = cwd && (await exec("test", ["-d", cwd])).code === 0 ? ["--cwd", cwd] : [];
  const r = await exec("hc", ["run", "--json", "--bg", "--rm", "--no-parent", ...here, "--", "sh", "-c", way.show, "sh", path, await neovim()]);
  let address = null;
  try {
    address = r.code === 0 ? JSON.parse(r.stdout).address : null;
  } catch {}
  if (!address) throw new Error((r.stderr || r.stdout || "hc run failed").trim());
  for (let waited = 0; waited < 3000 && !terminals().some((x) => x.address === address); waited += 25) await sleep(cx, 25);
  run("terminal.peek", { terminal: address });
}

const RUNNING = "jj-copy.running";
const githubRepo = (remote) => (remote ?? "").trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/)?.slice(1).join("/") ?? null;
const short = (text) => (text.length > 80 ? `${text.slice(0, 79)}…` : text);

// Where Ctrl+hint goes: { target } to `open`, or { why } it can't.
async function openable({ text, kind }, cwd, on) {
  if (kind === "url") {
    const ssh = text.match(/^(?:git@|ssh:\/\/(?:[^@/]+@)?)([^:/]+)[:/](.+?)(?:\.git)?$/);
    return { target: ssh ? `https://${ssh[1]}/${ssh[2]}` : text.replace(/^git:\/\//, "https://") };
  }
  if (["sha", "jj", "github"].includes(kind)) {
    const remote = cwd ? await exec("git", ["remote", "get-url", "origin"], { cwd, on }).catch(() => null) : null;
    const repo = remote?.code === 0 ? githubRepo(remote.stdout) : null;
    if (!repo) return { why: "this folder has no GitHub remote" };
    if (kind === "github") return { target: `https://github.com/${repo}/issues/${text.slice(1)}` };
    let sha = text;
    if (kind === "jj") {
      const r = await exec("jj", ["--ignore-working-copy", "log", "-r", text, "--no-graph", "-T", "commit_id"], { cwd, on }).catch(() => null);
      if (r?.code !== 0 || !r.stdout.trim()) return { why: `jj doesn't know ${text} here` };
      sha = r.stdout.trim();
    }
    return { target: `https://github.com/${repo}/commit/${sha}` };
  }
  if (on) return { why: `it's a path on ${on}` };
  let path = text.replace(/(:\d+){1,2}$/, "").replace(/^~(?=\/|$)/, home());
  if (!path.startsWith("/")) path = `${cwd || home()}/${path}`;
  if ((await exec("test", ["-e", path]).catch(() => null))?.code !== 0) return { why: `${path} doesn't exist` };
  return { target: path };
}

// Runs one of this mod's helpers in the pane's place with the arguments `args(tmp, size,
// view)` gives once it has put what the pane shows in the temp folder `tmp`, until it ends;
// then the pane gets its own view back as it was, history and scroll position included.
// The helper's result (tmp/result.json), or null.
// Pressed again while one runs, it ends that one.
async function inPane(cx, { terminal, pane }, helper, args) {
  if (!terminal || !pane) return null;
  const running = shared(RUNNING);
  if (running && terminals().some((x) => x.address === running && x.state === "live")) {
    run("terminal.kill", { terminal: running });
    return null;
  }
  const scroll = panes().find((p) => p.pane === pane)?.scroll;
  const view = scroll && { ...scroll };
  const dir = await exec("sh", ["-c", 'mktemp -d "${TMPDIR:-/tmp}/herdr-jj-copy.XXXXXX"']);
  const tmp = (dir.stdout ?? "").trim();
  if (dir.code !== 0 || !tmp) throw new Error((dir.stderr || "couldn't make a temp folder").trim());
  try {
    const size = JSON.parse((await hc(["get", terminal, "--json"])).stdout);
    const r = await hc(["run", "--json", "--bg", "--rm", "--no-parent", "--", await nodejs(), `${appHome()}/mods/jj-copy/${helper}`, ...(await args(tmp, size, view))]);
    let address = null;
    try {
      address = r.code === 0 ? JSON.parse(r.stdout).address : null;
    } catch {}
    if (!address) throw new Error((r.stderr || r.stdout || "hc run failed").trim());
    setShared(RUNNING, address);
    const live = () => terminals().some((x) => x.address === address && x.state === "live");
    for (let waited = 0; waited < 3000 && !live(); waited += 25) await sleep(cx, 25);
    if (live()) run("pane.focus", { pane }), run("terminal.show", { terminal: address, pane });
    for (let waited = 0; waited < 600000 && live(); waited += 50) await sleep(cx, 50);
    if (live()) run("terminal.kill", { terminal: address });
    run("terminal.show", { pane });
    if (view?.from_bottom > 0) {
      await sleep(cx, 100);
      const now = panes().find((p) => p.pane === pane)?.scroll;
      if (now && now.offset !== view.offset) run("terminal.scroll", { terminal, lines: view.offset - now.offset });
    }
    if (shared(RUNNING) === address) setShared(RUNNING, null);
    return JSON.parse((await readTextFile(`${tmp}/result.json`).catch(() => null)) ?? "null");
  } finally {
    exec("rm", ["-rf", tmp]).catch(() => null);
  }
}

// Hint mode on a pane, until a hint is typed or Esc; scrolled up, the hints go on the lines shown.
async function fingers(cx, { terminal, pane, cwd }) {
  const result = await inPane(cx, { terminal, pane }, "fingers.mjs", async (tmp, size, view) => {
    const read = await exec("sh", ["-c", 'hc read "$1" --lines "$2" --json >"$3"', "sh", terminal, String(view?.from_bottom ?? 0), `${tmp}/screen.json`]);
    if (read.code !== 0) throw new Error((read.stderr || "couldn't read the pane").trim());
    if (view?.from_bottom > 0) {
      // The lines the view shows: `up` lines of history above the screen, then the screen's top.
      const read = JSON.parse((await readTextFile(`${tmp}/screen.json`)) ?? "{}");
      const shown = (read.text ?? "").split("\n").slice(0, view.len).join("\n");
      await exec("sh", ["-c", 'printf %s "$2" >"$1"', "sh", `${tmp}/screen.json`, JSON.stringify({ ...read, text: shown })]);
    }
    const every = JSON.parse((await readTextFile(`${appHome()}/mods/jj-copy/patterns.json`)) ?? "[]");
    const chosen = shared("jj-copy.hints") ?? {};
    const ids = every.filter((p) => chosen[p.id] ?? p.on).map((p) => p.id);
    return [`${tmp}/screen.json`, `${tmp}/result.json`, JSON.stringify(ids), String(size.cols), String(view?.len ?? size.rows)];
  });
  if (!result) return;
  if (result.none) return notify({ title: "Nothing to hint", body: "No hashes, paths or links on the screen." });
  const on = terminal.includes("/") ? terminal.split("/")[0] : null;
  if (result.action === "open") {
    const o = await openable(result, cwd, on);
    if (o.target) {
      await exec("open", [o.target]);
      return;
    }
    cx.write_to_clipboard(result.text);
    return notify({ title: "Copied instead", body: `Can't open ${short(result.text)}: ${o.why}.`, level: "warning" });
  }
  cx.write_to_clipboard(result.text);
  if (result.action === "paste") {
    run("pane.focus", { pane });
    run("terminal.paste");
    return;
  }
  notify({ title: "Copied", body: short(result.text) });
}

// Copy mode on a pane's screen and history in their colours, starting on what the view
// shows. A fullscreen program (no view) has its screen alone, as it has no history of its own.
async function copy(cx, { terminal, pane }) {
  const result = await inPane(cx, { terminal, pane }, "copy.mjs", async (tmp, size, view) => {
    const read = await exec(await nodejs(), [`${appHome()}/mods/jj-copy/capture.mjs`, "--rows", terminal, `${tmp}/screen.json`, view ? HISTORY : "0"], { timeout: 60000 });
    if (read.code !== 0) throw new Error((read.stderr || "couldn't read the pane").trim());
    return [`${tmp}/screen.json`, `${tmp}/result.json`, String(view?.from_bottom ?? 0), String(size.rows), String(size.cols), String(view?.len ?? size.rows)];
  });
  if (typeof result?.text !== "string") return;
  cx.write_to_clipboard(result.text);
  const n = result.text.split("\n").length;
  notify({ title: "Copied", body: n > 1 ? `${n} lines` : `${result.text.length} characters` });
}

export default class Copy extends View {
  init(_props, cx) {
    const p = props() ?? {};
    const [work, failed] = {
      copy: [(cx) => copy(cx, p), "Copy mode failed"],
      fingers: [(cx) => fingers(cx, p), "Hint mode failed"],
      nvim: [(cx) => capture(cx, p.terminal, p.cwd, Boolean(p.colors)), "Couldn't open the pane in Neovim"],
    }[p.action ?? "copy"] ?? [];
    if (!work) return closeOverlay(p.overlay);
    cx.spawn(async (cx) => {
      try {
        await work(cx);
      } catch (error) {
        notify({ title: failed, body: String(error?.message ?? error), level: "error" });
      }
      closeOverlay(p.overlay);
    });
  }

  render() {
    return div();
  }
}
