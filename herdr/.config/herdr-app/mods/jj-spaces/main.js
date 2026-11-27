// Workspace spaces: stable colored avatars, every machine's in one list, in the
// folders you make (folders.js: by path, or dragged there; the rest in Other), a
// server icon on another machine's. Machines show only while they need you (asleep, a
// login, rebuilt, loading). After a space's name, where its first terminal is now,
// only where unusual: branch, ahead/behind (its folder says the repo). Agent state lives in the agents list, not here;
// a terminal glyph at the end says a command runs in it, or finished unseen (commands.js). Click to
// switch, right-click for its menu, drag to reorder or onto a folder. Spaces put in Waiting (kept on
// their machine, docs.js) go to a section of their own at the bottom, folded at first.
// Then its GitHub PRs and issues: linked from its menu, its branch's PR, and
// those its Claude sessions opened, each with the issues or PRs it's linked to
// and the Trello cards in their descriptions. This copy asks GitHub and Trello
// about all of them and shares what it learns as shared("github") for the agents
// list, the link dialog and the spacing dialog's Links tab. Those linked by hand, to
// the space or to one of its agents, live on its machine (docs.js), copied into
// shared("github.links") and shared("github.agent-links").
// It also finds the GitHub repos in its folders (shared("board.repos")) and where they and
// its spaces' repos are (shared("board.places")), and, once Trello is connected, the Trello
// boards there are (shared("trello.boards")), for the board (ctrl-a T, board.js) and the
// spacing dialog's Board tab; and links the sessions the board starts to their item.
// ctrl-a t opens and closes the tasks list (jj-sessions' tasks.js) from here, and ctrl-a d
// an agent's Description dialog (jj-agents').
// The server button beside + hides other machines' spaces but the shown one, and their
// machines, in every window on this Mac (shared("spaces.hide-remote"), in jj-state.json).
// Its Agents pref "tree" puts each space's agents under it (agent-tree.js) and hides the
// agents list's block, except on the rail. Its Terminals pref lists a space's terminals under
// it too, after its agents: those running or that finished a command, or all (commands.js).
// Its Tabs pref puts them under a header per tab (agent-tree.js).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, terminals, agents, focused, props, nextCommand, run, openOverlay, closeOverlay, exec, hc, home, appHome, readTextFile, theme, shared, setShared, watchFolder, window, layout, notify } from "herdr";
import { FINAL, branchName, expand, fetchGitHub, fetchUnread, githubRepo, isCard, kinds, scanAgent } from "./github.js";
import { OpError, fetchBoardList, fetchCards, linkSettings, refsOf } from "./trello.js";
import { backfillHistory, canon, editLinks, edited, forgetHistory, setWaiting, split, updateHistory, updateLinks } from "./docs.js";
import { linkInit, linkRender } from "./links.js";
import { MARK, applyChange, empty, folderOf, foldersOf, live, matchOf, merge, nextRank, ownPaths, pathsOn, tidy, tilde, updateFolders, writeChange } from "./folders.js";
import { folderInit, folderRender } from "./folder-dialog.js";
import { boardInit, boardRender } from "./board.js";
import { previewInit, previewRender } from "./preview.js";
import { discoverRepos } from "./board-data.js";
import { publishOrder, spaceRows, treeContext } from "./agent-tree.js";
import { describeDialog } from "./agent-parts.js";
import { commandMark, commandsDue, commandsInit, spaceCommand, terminalList } from "./commands.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const RAIL_CELL = 32;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();

// The nearest bookmarks under @, as the starship prompt shows them: "main",
// "main*~2", "2 bookmarks", "?". null outside jj.
async function bookmarkOf(cwd, on) {
  const nearest = "heads(::@ & (bookmarks() | remote_bookmarks()))";
  const log = (revs, template) => exec("jj", ["--ignore-working-copy", "--color=never", "log", "--no-graph", "-r", revs, "-T", template], { cwd, on });
  const heads = await log(nearest, 'bookmarks ++ "\\n"');
  if (heads.code !== 0) return null;
  const lines = heads.stdout.split("\n").filter(Boolean);
  if (!lines.length) return "?";
  const label = lines.length > 1 ? `${lines.length} bookmarks${lines.some((l) => l.includes("*")) ? "*" : ""}` : lines[0];
  const ahead = await log(`${nearest}..@ ~ @`, '"x"');
  return ahead.code === 0 && ahead.stdout.length ? `${label}~${ahead.stdout.length}` : label;
}

// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// GitHub is asked again this often while the window is in front: open PRs and
// issues and branches' PRs, then merged and closed ones; after a failure, not before.
const GH_OPEN = 2 * 60000;
const GH_FINAL = 30 * 60000;
const GH_RETRY = 10 * 60000;
const GH_UNREAD = 60000;
// Each machine's Claude transcripts are read for jj-tasks this often while the window is in front.
const BACKFILL = 15 * 60000;
// The sidebar folders' repos are looked for this often, and Trello's boards listed.
const BOARD_REPOS = 10 * 60000;
const BOARD_LIST = 30 * 60000;
// jj-spacing's Sidebar tab keeps what differs from these.
const PREF_DEFAULTS = { icon: "shown", branch: "hidden", agents: "list", terminals: "off", tabs: "off" };
const pref = (key) => shared("jj-spaces")?.[key] ?? PREF_DEFAULTS[key];
const machineOf = (id) => (id.includes("/") ? id.split("/")[0] : null);

// The links a machine's Claude transcripts show (history.mjs, run there).
const nodes = {};
async function transcriptLinks(on) {
  const script = await readTextFile(`${appHome()}/mods/jj-spaces/history.mjs`);
  nodes[on ?? ""] ??= (await exec("sh", ["-lc", "command -v node"], { on })).stdout.trim() || "node";
  const r = await exec(nodes[on ?? ""], ["--input-type=module", "-e", script], { on, timeout: 300000 });
  return r.code === 0 ? JSON.parse(r.stdout) : [];
}

// A space's repo: the main checkout's folder, for a worktree too.
const rootOf = (g) => {
  if (!g) return null;
  const repo = JSON.parse(g.repo)[1];
  return repo.endsWith("/.git") ? repo.slice(0, -5) : g.top;
};

const URGENT = { blocked: 3, done: 2, working: 1 };
const statusOf = (r) => (r.cmd?.at && (URGENT[r.w.status] ?? 0) < URGENT.done ? "done" : r.w.status);
const urgent = (rows) => rows.map(statusOf).reduce((m, st) => ((URGENT[st] ?? 0) > (URGENT[m] ?? 0) ? st : m), null);

function loadState() {
  try {
    return { ...empty(), ...JSON.parse(localStorage.getItem("folders.state") ?? "null") };
  } catch {
    return empty();
  }
}

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

// The link dialog for a space, or for one of its agents.
function openLinks(id, agent) {
  if (id) openOverlay({ mod: "jj-spaces", kind: "dialog", width: 560, height: 0.7, props: { link: id, ...(agent && { agent }) } });
}

export default class Spaces extends View {
  init(_props, cx) {
    if (props()?.link) return linkInit(this, cx);
    if (props()?.folder) return folderInit(this, cx);
    if (props()?.board) return boardInit(this, cx);
    if (props()?.preview) return previewInit(this, cx);
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked, gh: "owner/repo" }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    this.pressed = null; // a space dragged
    this.over = null; // the space row it would land next to
    this.overFolder = null; // the folder (or "other") it would go in
    this.moving = null; // a folder header pressed (or "other")
    this.overMove = null; // the folder header it would land next to
    this.hoverHead = null;
    this.hidden = new Set(); // spaces in folded folders
    this.folderState = loadState(); // folders.js's, every machine's merged
    this.folderWrites = []; // changes made here, not written yet
    this.folderMissing = new Set();
    this.foldersAt = 0;
    this.foldersReady = null;
    this.homes = { ...JSON.parse(localStorage.getItem("folders.homes") ?? "{}"), "": home() };
    this.machines = [];
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    const gh = shared("github") ?? {};
    this.items = gh.items ?? {}; // url -> { kind, url, repo, number, title, state, at }
    this.agentLinks = gh.agents ?? {}; // terminal -> PR urls its Claude session recorded
    this.branchPrs = {}; // "owner/repo\0branch" -> { url, at }
    this.published = JSON.stringify(gh);
    this.claude = {}; // terminal -> { sid, working } at the last look
    this.scanQueue = new Set();
    this.stale = new Set(); // urls to ask GitHub about again now
    this.ghRetry = 0;
    this.unread = gh.unread ?? {}; // prKey -> { id, reason, at }: GitHub's unread notifications about PRs
    this.dismissed = {}; // prKey -> the news opened from a badge (its at)
    this.unreadAt = 0;
    this.unreading = false;
    this.linksAt = 0;
    this.backfilled = {}; // machine ("" here) -> when its transcripts were last read
    this.missing = new Set(); // "machine\0space" with links whose space wasn't there at the last sync
    this.cards = new Set(); // Trello card urls shown somewhere
    this.trelloRetry = 0;
    this.trelloBlocked = null; // refsOf() and connect when 1Password said no
    this.connected = shared("jj-links.connect") ?? 0;
    this.trello = { state: "idle", error: null, cards: 0 }; // for the Links tab
    this.boardRepos = {}; // machine ("" here) -> the GitHub repos in its sidebar folders: [{ repo, path }]
    this.reposAt = 0;
    this.reposOf = null; // shared("space-folders") they were looked for in
    this.boardsAt = 0;
    this.boardsAsked = this.connected;
    this.agentFolded = new Set(); // agents whose sub-agents the tree folds
    commandsInit(this);
    // The open board (shared("board.open"), which ctrl-a T closes) from a previous run is gone;
    // one still open through a reload says so again (board.js).
    setShared("board.open", null);
    setShared("tasks.open", null);
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // Refresh only when the refs could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
    cx.spawn(async () => {
      for (;;) {
        // "link": the focused agent's, else the space's; "link-space": the space's.
        const command = await nextCommand();
        if (command === "board") {
          const open = shared("board.open");
          if (open) closeOverlay(open);
          else openOverlay({ mod: "jj-spaces", kind: "dialog", width: 0.92, height: 0.88, props: { board: true } });
        }
        // ctrl-a d: here, not in jj-agents, whose block the tree hides (a hidden copy gets no commands).
        // A review in a space of its own (jj-sessions' review dialog), by default in the shown space's repo.
        if (command === "review") {
          const s = spaces().find((x) => x.id === focused()?.space) ?? spaces().find((x) => x.active);
          openOverlay({ mod: "jj-sessions", kind: "dialog", width: 560, height: 200, props: { review: true, folder: s ? place(s, panes()) : null, machine: s?.machine ?? null } });
        }
        // A Claude session to another machine (jj-sessions' move dialog), the focused agent's.
        if (command === "move") {
          const f = focused();
          const a = agents().find((x) => x.address === (f?.agent ?? f?.shown ?? f?.terminal)) ?? agents().find((x) => x.focused && x.space === f?.space);
          if (a) openOverlay({ mod: "jj-sessions", kind: "dialog", width: 520, height: 300, props: { move: a.address } });
        }
        if (command === "describe") {
          const f = focused();
          const a = agents().find((x) => x.address === (f?.agent ?? f?.shown ?? f?.terminal)) ?? agents().find((x) => x.focused && x.space === f?.space);
          if (a) describeDialog(a.address);
        }
        if (command === "tasks") {
          const open = shared("tasks.open");
          if (open) closeOverlay(open);
          else openOverlay({ mod: "jj-sessions", kind: "dialog", width: 680, height: 0.7, props: { tasks: true } });
        }
        if (command !== "link" && command !== "link-space") continue;
        const space = focused()?.space ?? spaces().find((s) => s.active)?.id;
        openLinks(space, command === "link" ? agents().find((a) => a.focused && a.space === space)?.address : null);
      }
    });
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    const ps = panes();
    const due = this.due(now, sp, ps);
    if (due.size) this.refreshGit(due, cx);
    this.claudeDue(cx);
    this.githubDue(now, sp, ps, cx);
    this.unreadDue(now, cx);
    this.trelloDue(now, cx);
    this.linksDue(now, cx);
    this.waitingDue(cx);
    this.forgetDue(cx);
    this.backfillDue(now, cx);
    this.foldersDue(now, cx);
    this.boardDue(now, cx);
    this.treeDue();
    commandsDue(this, now, ps, cx);
  }

  // The agents list's block hidden while the tree shows its agents, and back on the rail.
  treeDue() {
    const want = pref("agents") === "tree" && !narrow();
    const node = find(layout(), "agents");
    if (!node || Boolean(node.hidden) === want) return void (this.treeAsked = null);
    if (this.treeAsked === want) return;
    this.treeAsked = want;
    run(want ? "layout.hide" : "layout.show", { id: "agents" });
  }

  close() {
    if (props()?.board && shared("board.open") === props().overlay) setShared("board.open", null);
    // The board or tasks list under it takes the keyboard back.
    if (props()?.preview) setShared("preview.closed", Date.now());
  }

  // The GitHub repos in the sidebar folders on every machine that answers (one that doesn't
  // keeps what it had), and the Trello boards, only while Trello's key and token are at hand.
  boardDue(now, cx) {
    const sf = shared("space-folders");
    const text = JSON.stringify(sf?.folders ?? []);
    if (sf && !this.discovering && (now > this.reposAt || text !== this.reposOf)) {
      this.discovering = true;
      this.reposOf = text;
      this.reposAt = now + BOARD_REPOS;
      const on = [null, ...this.machines.filter((m) => m.state === "connected").map((m) => m.name)];
      cx.spawn(async (cx) => {
        for (const m of on) {
          try {
            this.boardRepos[m ?? ""] = await discoverRepos(sf.folders ?? [], m);
          } catch {}
        }
        const all = new Map(Object.values(this.boardRepos).flat().reverse().map(({ repo }) => [repo.toLowerCase(), repo]));
        const list = [...all.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
        if (JSON.stringify(list) !== JSON.stringify(shared("board.repos") ?? [])) setShared("board.repos", list);
        this.discovering = false;
        cx.notify();
      });
    }
    if (now > (this.placesAt ?? 0)) {
      this.placesAt = now + 5000;
      this.publishPlaces();
    }
    this.linkAsksDue();
    this.moveAsksDue(cx);
    const pressed = shared("jj-links.connect") ?? 0;
    if (this.listing || this.trello.state !== "ok" || (now < this.boardsAt && pressed === this.boardsAsked)) return;
    this.listing = true;
    this.boardsAsked = pressed;
    this.boardsAt = now + BOARD_LIST;
    cx.spawn(async (cx) => {
      try {
        const boards = await fetchBoardList(linkSettings(shared("jj-links")));
        if (JSON.stringify(boards) !== JSON.stringify(shared("trello.boards") ?? [])) setShared("trello.boards", boards);
      } catch {
        this.boardsAt = Date.now() + GH_RETRY;
      }
      this.listing = false;
      cx.notify();
    });
  }

  // Where each GitHub repo is checked out, by "owner/repo" in lower case: [{ machine, path }],
  // those in the sidebar folders and those the spaces are in.
  publishPlaces() {
    const places = {};
    const add = (repo, machine, path) => {
      const list = (places[repo.toLowerCase()] ??= []);
      if (path && !list.some((p) => p.machine === machine && p.path === path)) list.push({ machine, path });
    };
    for (const [m, found] of Object.entries(this.boardRepos)) for (const { repo, path } of found) add(repo, m || null, path);
    for (const [key, g] of Object.entries(this.git)) if (g?.gh) add(g.gh, JSON.parse(key)[0] ?? null, rootOf(g));
    const text = canon(places);
    if (text !== canon(shared("board.places") ?? {})) setShared("board.places", places);
  }

  // shared("board.link.ask"): [{ url, cwd, machine, known, at }], sessions the board's session
  // picker started. Each is linked to its item, as the link dialog would, once a Claude
  // terminal that wasn't in `known` runs in `cwd`; forgotten after half an hour.
  linkAsksDue() {
    const asks = shared("board.link.ask") ?? [];
    if (!asks.length) return;
    const now = Date.now();
    const live = terminals().filter((t) => t.state === "live" && (t.labels?.["claude.session"] || t.argv?.[0] === "claude"));
    const left = asks.filter((a) => {
      const there = (c) => c && (c === a.cwd || c.startsWith(`${a.cwd}/`));
      const t = live.find((t) => !a.known.includes(t.address) && (split(t.address)[0] ?? null) === (a.machine ?? null) && [t.labels?.["claude.cwd"], t.cwd].some(there));
      if (!t) return now - a.at < 30 * 60000;
      const kept = shared("github.agent-links") ?? {};
      const mine = kept[t.address] ?? [];
      if (!mine.includes(a.url)) setShared("github.agent-links", { ...kept, [t.address]: [...mine, a.url] });
      editLinks({ agent: t.address }, (e) => ({ ...e, links: e.links.includes(a.url) ? e.links : [...e.links, a.url] })).catch(() => null);
      return false;
    });
    if (left.length !== asks.length) setShared("board.link.ask", left);
  }

  // shared("sessions.move.ask"): [{ id, from, to, links, desc, at }], Claude sessions moved to
  // another machine (jj-sessions' move). What jj-tasks knows of it moves from its machine to
  // the new one (left behind without links, so its transcript there doesn't bring them back),
  // and once it runs there, its terminal gets the hand links and description the old one had.
  moveAsksDue(cx) {
    const asks = shared("sessions.move.ask") ?? [];
    if (!asks.length) return;
    this.moving ??= new Set();
    for (const a of asks) {
      const key = `${a.id}@${a.at}`;
      if (this.moving.has(key)) continue;
      this.moving.add(key);
      cx.spawn(async () => {
        let kept = null;
        try {
          await updateHistory(a.from, (doc) => {
            const e = doc.sessions[a.id];
            if (!e?.links?.length) return doc;
            kept = e;
            doc.sessions[a.id] = { ...e, links: [], off: [...new Set([...(e.off ?? []), ...e.links])] };
            return doc;
          });
          if (kept) await updateHistory(a.to, (doc) => {
            const was = doc.sessions[a.id];
            const { space: _s, terminal: _t, off: _o, ...rest } = kept;
            doc.sessions[a.id] = { ...rest, ...(was ?? {}), links: [...new Set([...(was?.links ?? []), ...kept.links])], at: Math.floor(Date.now() / 1000) };
            return doc;
          });
        } catch {}
        this.linksAt = 0;
      });
    }
    const now = Date.now();
    const live = terminals().filter((t) => t.state === "live" && t.labels?.["claude.session"]);
    const left = asks.filter((a) => {
      const t = live.find((t) => t.labels["claude.session"] === a.id && (split(t.address)[0] ?? null) === (a.to ?? null));
      if (!t) return now - a.at < 30 * 60000;
      if (a.links?.length) {
        const kept = shared("github.agent-links") ?? {};
        const mine = kept[t.address] ?? [];
        setShared("github.agent-links", { ...kept, [t.address]: [...new Set([...mine, ...a.links])] });
        editLinks({ agent: t.address }, (e) => ({ ...e, links: [...new Set([...e.links, ...a.links])] })).catch(() => null);
      }
      if (a.desc && !t.labels["jj.description"]) hc(["label", t.address, `jj.description=${a.desc}`]).catch(() => null);
      return false;
    });
    if (left.length !== asks.length) setShared("sessions.move.ask", left);
  }

  // Spaces moved in or out of Waiting by the other mods (jj-menu, jj-tabs), which show it
  // at once in shared("spaces.waiting") and ask here, in shared("spaces.waiting.ask"),
  // for it to be kept on the space's machine.
  waitingDue(cx) {
    const asks = shared("spaces.waiting.ask") ?? [];
    if (!asks.length || this.asking) return;
    setShared("spaces.waiting.ask", []);
    this.asking = true;
    cx.spawn(async (cx) => {
      for (const ask of asks) {
        try {
          await setWaiting(ask.id, ask.waiting);
        } catch (e) {
          notify({ title: "Couldn't move the space", body: String(e?.message ?? e), level: "error" });
        }
      }
      this.asking = false;
      this.linksAt = 0;
      cx.notify();
    });
  }

  // Links the tasks list (jj-sessions) asked ended sessions to forget, in
  // shared("tasks.forget.ask"): [{ id: "<machine>/<session id>", url }].
  forgetDue(cx) {
    const asks = shared("tasks.forget.ask") ?? [];
    if (!asks.length || this.forgetting) return;
    setShared("tasks.forget.ask", []);
    this.forgetting = true;
    cx.spawn(async (cx) => {
      for (const ask of asks) {
        const [on, sid] = split(ask.id);
        try {
          await forgetHistory(on, [sid], ask.url);
        } catch (e) {
          notify({ title: "Couldn't forget the link", body: String(e?.message ?? e), level: "error" });
        }
      }
      this.forgetting = false;
      this.linksAt = 0;
      cx.notify();
    });
  }

  // Each machine's transcripts' links into its jj-tasks, for sessions from before it was
  // kept or outside Herdr: once it's in, then every 15 minutes while the window is in front.
  backfillDue(now, cx) {
    if (this.backfilling) return;
    const due = machines().filter((m) => {
      const at = this.backfilled[m.name ?? ""];
      return m.layout === "ready" && (!at || (window().active && now - at > BACKFILL));
    });
    if (!due.length) return;
    this.backfilling = true;
    cx.spawn(async (cx) => {
      for (const m of due) {
        this.backfilled[m.name ?? ""] = Date.now();
        try {
          const found = await transcriptLinks(m.name ?? null);
          if (found.length) await backfillHistory(m.name ?? null, found);
        } catch {}
      }
      this.backfilling = false;
      this.linksAt = 0;
      cx.notify();
    });
  }

  // Every link jj-tasks' sessions had, on every machine.
  historyLinks() {
    return [...new Set(Object.values(shared("tasks.sessions") ?? {}).flatMap((e) => e.links ?? []))];
  }

  // This machine's live Claude sessions with links, into its jj-tasks: every link each
  // has had, and where and what it is, newer when it gains one or hourly. Not while the
  // link dialog edits, so an unlink isn't put back. Its sessions as they now are.
  async recordHistory(on, mine, before) {
    const now = Math.floor(Date.now() / 1000);
    const as = agents();
    const direct = shared("github")?.shown?.direct ?? {};
    const rows = terminals()
      .filter((t) => t.state === "live" && mine(t.address) && t.labels?.["claude.session"] && direct[t.address]?.length)
      .map((t) => {
        const a = as.find((a) => a.address === t.address);
        return {
          sid: t.labels["claude.session"],
          links: direct[t.address],
          cwd: t.labels["claude.cwd"] ?? "",
          title: t.labels["jj.description"] || a?.title || t.title || a?.tab_name || "",
          space: a ? split(a.space)[1] : "",
          spaceName: a?.space_name ?? "",
          terminal: split(t.address)[1],
        };
      });
    const doc = await updateHistory(on, (doc) => {
      if (edited() !== before) return doc;
      for (const { sid, ...r } of rows) {
        const was = doc.sessions[sid];
        const links = [...new Set([...(was?.links ?? []), ...r.links])];
        const off = (was?.off ?? []).filter((u) => !r.links.includes(u));
        if (was && links.length === was.links.length && off.length === (was.off?.length ?? 0) && now - (was.at ?? 0) < 3600) continue;
        doc.sessions[sid] = { ...r, links, ...(off.length && { off }), at: now };
      }
      return doc;
    });
    return doc.sessions;
  }

  // Folder edits asked for by the menu and the folder dialog (shared("space-folders.ask"))
  // and made here, written to the machines; then every machine's folders read again, now
  // and then and when one comes back.
  foldersDue(now, cx) {
    const asks = shared("space-folders.ask") ?? [];
    if (asks.length) {
      setShared("space-folders.ask", []);
      for (const a of asks) this.ask(a);
    }
    if (this.foldering) return;
    const ready = machines().filter((m) => m.layout === "ready").map((m) => m.name ?? "").sort().join("\0");
    const stale = ready !== this.foldersReady || now - this.foldersAt > (window().active ? 10000 : 60000);
    if (!stale && !this.folderWrites.length) return;
    this.foldersReady = ready;
    this.foldering = true;
    cx.spawn(async (cx) => {
      try {
        while (this.folderWrites.length) await this.writeFolders(this.folderWrites.splice(0));
        await this.syncFolders();
      } catch (e) {
        console.log(`jj-spaces: folders: ${e?.stack ?? e}`);
      } finally {
        this.foldersAt = Date.now();
        this.foldering = false;
      }
      cx.notify();
    });
  }

  ask(a) {
    const st = this.folderState;
    const now = Date.now();
    if (a.op === "save") {
      const id = a.id ?? `f${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const was = st.folders[id];
      const rec = { name: a.name, color: a.color ?? null, rank: was && !was.gone ? was.rank : nextRank(st), at: now };
      this.change([{ kind: "folder", id, rec }, ...Object.entries(a.paths ?? {}).map(([key, paths]) => ({ kind: "path", key, id, paths: paths ?? [] }))]);
    } else if (a.op === "delete" && st.folders[a.id]) {
      this.change([{ kind: "folder", id: a.id, rec: { ...st.folders[a.id], gone: true, at: now } }]);
    } else if (a.op === "unpin") {
      const [on, bare] = split(a.space);
      this.change([{ kind: "pin", key: on ?? "", bare, folder: null }]);
    }
  }

  // Shown at once, written by foldersDue.
  change(changes) {
    for (const c of changes) applyChange(this.folderState, c);
    this.folderWrites.push(...changes);
  }

  async writeFolders(changes) {
    const ready = new Set(machines().filter((m) => m.layout === "ready").map((m) => m.name ?? ""));
    const by = {};
    for (const c of changes) for (const key of c.kind === "folder" ? ready : [c.key]) (by[key] ??= []).push(c);
    for (const [key, cs] of Object.entries(by)) {
      try {
        if (!ready.has(key)) throw new Error(`${key || "This computer"} isn't connected.`);
        await updateFolders(key || null, (doc) => tidy(cs.reduce(writeChange, doc), this.folderState.folders));
      } catch (e) {
        notify({ title: "Couldn't save the folders", body: String(e?.message ?? e), level: "error" });
      }
    }
  }

  // Every machine's document read and merged; one behind (a folder changed while it was
  // away, one gone, a space missing at two reads in a row) is brought up to date.
  async syncFolders() {
    const docs = {};
    for (const m of machines().filter((m) => m.layout === "ready")) {
      try {
        docs[m.name ?? ""] = await foldersOf(m.name);
      } catch {}
    }
    const state = merge(docs, this.folderState);
    const missing = new Set();
    for (const [key, doc] of Object.entries(docs)) {
      const present = new Set(spaces().filter((s) => (s.machine ?? "") === key).map((s) => split(s.id)[1]));
      const drop = new Set();
      for (const bare of Object.keys(doc.spaces)) {
        if (present.has(bare)) continue;
        const k = `${key}\0${bare}`;
        if (this.folderMissing.has(k)) drop.add(bare);
        else missing.add(k);
      }
      const fix = (d) => tidy(d, state.folders, drop);
      if (canon(fix(JSON.parse(JSON.stringify(doc)))) === canon(doc)) continue;
      try {
        const fresh = await updateFolders(key || null, fix);
        state.paths[key] = fresh.paths;
        state.pins[key] = fresh.spaces;
      } catch {}
    }
    this.folderMissing = missing;
    for (const c of this.folderWrites) applyChange(state, c);
    this.folderState = state;
    const text = JSON.stringify(state);
    if (text !== localStorage.getItem("folders.state")) localStorage.setItem("folders.state", text);
  }

  // What the menu and the folder dialog read: the folders with where they are on each
  // machine, spaces moved by hand, homes and machines.
  publishFolders() {
    const st = this.folderState;
    const keys = ["", ...this.machines.map((m) => m.name)];
    const folders = live(st).map((f) => ({ id: f.id, name: f.name, color: f.color ?? null, paths: Object.fromEntries(keys.map((k) => [k, pathsOn(st, f.id, k, this.homes)]).filter(([, at]) => at)) }));
    const pins = {};
    for (const [key, of] of Object.entries(st.pins)) for (const [bare, id] of Object.entries(of)) if (id === "" || (st.folders[id] && !st.folders[id].gone)) pins[key ? `${key}/${bare}` : bare] = id;
    const value = { folders, pins, homes: this.homes, machines: this.machines.map((m) => ({ name: m.name, state: m.state })) };
    const text = JSON.stringify(value);
    if (text !== this.foldersPublished) {
      this.foldersPublished = text;
      setShared("space-folders", value);
    }
  }

  // A space dropped on a folder ("" for Other). Where its path already takes it, it just
  // follows its path again. A folder with nothing on the space's machine yet (no paths of
  // its own there, no space of it) learns its repo as a path there, for its neighbours
  // too; otherwise the space is pinned there.
  dropSpace(id, folder) {
    const s = spaces().find((x) => x.id === id);
    const st = this.folderState;
    if (!s || (folder && (!st.folders[folder] || st.folders[folder].gone))) return;
    const key = s.machine ?? "";
    const bare = split(id)[1];
    const ps = panes();
    const g = this.git[where(s, ps)] ?? null;
    const places = [place(s, ps), rootOf(g)];
    const auto = matchOf(st, this.homes, key, places);
    const was = st.pins[key]?.[bare] ?? null;
    const pin = (to) => (to === was ? [] : [{ kind: "pin", key, bare, folder: to }]);
    if (!folder) return this.change(pin(auto ? "" : null));
    if (auto === folder) return this.change(pin(null));
    const path = places[1] ?? places[0];
    const others = [...(this.rowsById?.values() ?? [])].some((r) => r.folder === folder && r.w.id !== id && (r.w.machine ?? "") === key);
    if (ownPaths(st, folder, key).length || others || !path || path === "/" || path === this.homes[key]) return this.change(pin(folder));
    const teach = { kind: "path", key, id: folder, paths: [path] };
    const taught = matchOf(applyChange(JSON.parse(JSON.stringify(st)), teach), this.homes, key, places) === folder;
    this.change([teach, ...pin(taught ? null : folder)]);
    notify({ title: st.folders[folder].name, body: `Spaces in ${tilde(path, this.homes[key])}${key ? ` on ${key}` : ""} go in this folder now.`, level: "info" });
  }

  // A folder dragged onto another: it goes where that one is.
  reorder(from, to) {
    const ids = live(this.folderState).map((f) => f.id);
    const i = ids.indexOf(from);
    const j = ids.indexOf(to);
    if (i === -1 || j === -1 || i === j) return;
    const rank = (id) => this.folderState.folders[id].rank ?? 0;
    const rest = ids.filter((id) => id !== from);
    const k = rest.indexOf(to) + (i < j ? 1 : 0);
    const before = k > 0 ? rank(rest[k - 1]) : null;
    const after = k < rest.length ? rank(rest[k]) : null;
    const at = before === null ? after - 1 : after === null ? before + 1 : (before + after) / 2;
    this.change([{ kind: "folder", id: from, rec: { ...this.folderState.folders[from], rank: at, at: Date.now() } }]);
  }

  fold(id) {
    const now = shared("space-folders.folded") ?? [];
    setShared("space-folders.folded", now.includes(id) ? now.filter((x) => x !== id) : [...now, id]);
  }

  // Where a new space in a folder starts: this computer, else a connected machine it's on.
  newIn(f) {
    const keys = ["", ...this.machines.filter((m) => m.state === "connected").map((m) => m.name)];
    for (const key of keys) {
      const path = pathsOn(this.folderState, f.id, key, this.homes)?.paths[0];
      if (path) return { args: { folder: path, machine: key }, tip: `New space in ${tilde(path, this.homes[key])}${key ? ` on ${key}` : ""}` };
    }
    return null;
  }

  // Hand-made links and Waiting marks from each machine's core into shared("github.links"),
  // shared("github.hidden"), shared("github.agent-links") and shared("spaces.waiting"),
  // where the rows, the agents list and the dialog read them. A space or agent missing at two syncs in a row on a
  // machine whose layout is in loses its links there; the first time per machine, what
  // this screen kept itself is moved in. Its live Claude sessions' links go in its
  // jj-tasks, and every machine's sessions there into shared("tasks.sessions").
  linksDue(now, cx) {
    if (this.syncing || now - this.linksAt < (window().active ? 10000 : 60000)) return;
    this.syncing = true;
    this.linksAt = now;
    const before = edited();
    cx.spawn(async (cx) => {
      const known = machines();
      const names = new Set(known.map((m) => m.name ?? null));
      const cache = { "github.links": {}, "github.hidden": {}, "github.agent-links": {} };
      for (const [key, into] of Object.entries(cache))
        for (const [id, urls] of Object.entries(shared(key) ?? {})) if (urls?.length && names.has(machineOf(id))) into[id] = urls;
      let waiting = (shared("spaces.waiting") ?? []).filter((id) => names.has(machineOf(id)));
      const tasks = Object.fromEntries(Object.entries(shared("tasks.sessions") ?? {}).filter(([id]) => names.has(machineOf(id))));
      const moved = new Set(shared("github.links.moved") ?? []);
      const missing = new Set();
      for (const m of known.filter((m) => m.layout === "ready")) {
        const on = m.name ?? null;
        const mine = (id) => machineOf(id) === on;
        const full = (bare) => (on ? `${on}/${bare}` : bare);
        const live = {
          spaces: new Set(spaces().filter((s) => (s.machine ?? null) === on).map((s) => split(s.id)[1])),
          agents: new Set(terminals().filter((t) => t.state === "live" && mine(t.address)).map((t) => split(t.address)[1])),
        };
        const move = !moved.has(on ?? "");
        try {
          const doc = await updateLinks(on, (doc) => {
            if (move) {
              const ids = new Set([...Object.keys(cache["github.links"]), ...Object.keys(cache["github.hidden"])].filter(mine));
              for (const id of ids) {
                const bare = split(id)[1];
                const join = (key, field) => [...new Set([...(doc.spaces[bare]?.[field] ?? []), ...(cache[key][id] ?? [])])];
                doc.spaces[bare] = { links: join("github.links", "links"), hidden: join("github.hidden", "hidden") };
              }
            }
            for (const kind of ["spaces", "agents"]) {
              for (const bare of Object.keys(doc[kind])) {
                if (live[kind].has(bare)) continue;
                const k = `${kind}\0${on ?? ""}\0${bare}`;
                if (this.missing.has(k)) delete doc[kind][bare];
                else missing.add(k);
              }
            }
            return doc;
          });
          for (const into of Object.values(cache)) for (const id of Object.keys(into)) if (mine(id)) delete into[id];
          for (const [bare, e] of Object.entries(doc.spaces)) {
            if (e.links?.length) cache["github.links"][full(bare)] = e.links;
            if (e.hidden?.length) cache["github.hidden"][full(bare)] = e.hidden;
          }
          for (const [bare, e] of Object.entries(doc.agents)) if (e.links?.length) cache["github.agent-links"][full(bare)] = e.links;
          waiting = [...waiting.filter((id) => !mine(id)), ...Object.entries(doc.spaces).filter(([, e]) => e.waiting).map(([bare]) => full(bare))];
          moved.add(on ?? "");
        } catch {}
        try {
          const sessions = await this.recordHistory(on, mine, before);
          for (const id of Object.keys(tasks)) if (mine(id)) delete tasks[id];
          for (const [sid, e] of Object.entries(sessions)) tasks[full(sid)] = { ...e, machine: on };
        } catch {}
      }
      this.missing = missing;
      if (edited() === before) {
        for (const [key, value] of Object.entries(cache)) if (JSON.stringify(value) !== JSON.stringify(shared(key) ?? {})) setShared(key, value);
        if (moved.size !== (shared("github.links.moved") ?? []).length) setShared("github.links.moved", [...moved]);
        if (canon(tasks) !== canon(shared("tasks.sessions") ?? {})) setShared("tasks.sessions", tasks);
        const asked = this.asking || (shared("spaces.waiting.ask") ?? []).length > 0;
        if (!asked && JSON.stringify(waiting) !== JSON.stringify(shared("spaces.waiting") ?? [])) setShared("spaces.waiting", waiting);
      } else this.linksAt = 0;
      this.syncing = false;
      cx.notify();
    });
  }

  // Claude sessions to read for PR links: new ones, and those whose turn just ended.
  claudeDue(cx) {
    const seen = {};
    for (const t of terminals()) {
      const sid = t.state === "live" && t.labels?.["claude.session"];
      if (!sid) continue;
      const working = t.status === "working";
      const was = this.claude[t.address];
      seen[t.address] = { sid, working };
      if (!was || was.sid !== sid || (was.working && !working)) this.scanQueue.add(t.address);
    }
    this.claude = seen;
    const gone = Object.keys(this.agentLinks).filter((address) => !seen[address]);
    for (const address of gone) delete this.agentLinks[address];
    if (gone.length) cx.notify();
    if (!this.scanQueue.size || this.scanning) return;
    this.scanning = true;
    cx.spawn(async (cx) => {
      while (this.scanQueue.size) {
        const [address] = this.scanQueue;
        this.scanQueue.delete(address);
        const c = this.claude[address];
        if (!c) continue;
        try {
          const urls = await scanAgent(c.sid, machineOf(address));
          if (urls.length) this.agentLinks[address] = urls;
          else delete this.agentLinks[address];
          for (const url of urls) this.stale.add(url);
        } catch {}
      }
      this.scanning = false;
      cx.notify();
    });
  }

  // The GitHub repo and branch a space's PR would be on: "owner/repo\0branch".
  branchKey(s, ps) {
    const g = this.git[where(s, ps)];
    const branch = g?.gh && branchName(g.branch);
    return branch ? `${g.gh}\0${branch}` : null;
  }

  githubDue(now, sp, ps, cx) {
    if (this.fetching || now < this.ghRetry) return;
    const active = window().active;
    const old = (at, final) => active && now - (at ?? 0) > (final ? GH_FINAL : GH_OPEN);
    const urls = [...new Set([...Object.values(shared("github.links") ?? {}).flat(), ...Object.values(shared("github.agent-links") ?? {}).flat(), ...Object.values(this.agentLinks).flat(), ...this.historyLinks()])]
      .filter((u) => !isCard(u) && (!this.items[u]?.links || this.stale.has(u) || old(this.items[u].at, FINAL.has(this.items[u].state))));
    const keys = [...new Set(sp.map((s) => this.branchKey(s, ps)).filter(Boolean))].filter((k) => !this.branchPrs[k] || old(this.branchPrs[k].at, false));
    if (!urls.length && !keys.length) return;
    this.fetching = true;
    for (const u of urls) this.stale.delete(u);
    cx.spawn(async (cx) => {
      try {
        const r = await fetchGitHub(urls, keys.map((key) => { const [repo, branch] = key.split("\0"); return { key, repo, branch }; }));
        for (const [url, it] of Object.entries(r.items)) this.items[url] = { links: this.items[url]?.links, ...it };
        for (const [k, url] of Object.entries(r.branches)) this.branchPrs[k] = { url, at: Date.now() };
        if (!r.ok) this.ghRetry = Date.now() + GH_RETRY;
      } catch {
        this.ghRetry = Date.now() + GH_RETRY;
      }
      this.fetching = false;
      cx.notify();
    });
  }

  // GitHub's unread notifications about PRs, each minute while the window is active and
  // a PR is shown. News opened from a badge (shared("github.read.ask")) stays read until
  // there's newer, or GitHub agrees.
  unreadDue(now, cx) {
    const asks = shared("github.read.ask") ?? [];
    if (asks.length) {
      setShared("github.read.ask", []);
      for (const a of asks) this.dismissed[a.key] = Math.max(this.dismissed[a.key] ?? 0, a.at);
      cx.notify();
    }
    if (this.unreading || now < this.unreadAt || !window().active) return;
    if (!Object.values(this.items).some((it) => it.kind === "pr")) return;
    this.unreading = true;
    cx.spawn(async (cx) => {
      try {
        this.unread = await fetchUnread();
        for (const [key, at] of Object.entries(this.dismissed)) if (!this.unread[key] || this.unread[key].at > at) delete this.dismissed[key];
        this.unreadAt = Date.now() + GH_UNREAD;
      } catch {
        this.unreadAt = Date.now() + GH_RETRY;
      }
      this.unreading = false;
      cx.notify();
    });
  }

  // The Trello cards shown that are new or due, while Trello linking is on. After
  // 1Password said no, only once the Links tab's Connect is pressed (or the refs
  // change), which also asks about every card again.
  trelloDue(now, cx) {
    const cfg = linkSettings(shared("jj-links"));
    if (!cfg.trello) return this.status({ state: "off", error: null, cards: 0 }, cx);
    if (this.trello.state === "off") this.status({ state: "idle", error: null, cards: 0 }, cx);
    if (this.carding) return;
    const pressed = shared("jj-links.connect") ?? 0;
    const connect = pressed !== this.connected;
    const ask = JSON.stringify([refsOf(cfg), pressed]);
    if (!connect && (this.trelloBlocked === ask || now < this.trelloRetry)) return;
    const active = window().active;
    const old = (it) => !it || (active && now - (it.at ?? 0) > (FINAL.has(it.state) ? GH_FINAL : GH_OPEN));
    const urls = [...new Set([...this.cards, ...this.historyLinks().filter(isCard)])].filter((u) => connect || old(this.items[u]));
    if (!urls.length && !connect) return;
    this.connected = pressed;
    this.carding = true;
    this.trello = { ...this.trello, state: "busy" };
    cx.spawn(async (cx) => {
      try {
        Object.assign(this.items, await fetchCards(urls, cfg));
        this.trelloBlocked = null;
        this.trello = { state: "ok", error: null, cards: [...this.cards].filter((u) => this.items[u]?.state?.startsWith("trello-")).length };
      } catch (e) {
        if (e instanceof OpError) this.trelloBlocked = ask;
        else this.trelloRetry = Date.now() + GH_RETRY;
        this.trello = { state: "error", error: String(e?.message ?? e), cards: 0 };
      }
      this.carding = false;
      cx.notify();
    });
  }

  status(trello, cx) {
    if (this.trello.state === trello.state) return;
    this.trello = trello;
    cx.notify();
  }

  // What the other mods read: every linked item's state, agents' PRs, spaces' branch
  // PRs and the PRs with unread news. Written only when it changed.
  publish(sp, ps) {
    const kept = shared("github.links") ?? {};
    const hidden = shared("github.hidden") ?? {};
    const agentKept = shared("github.agent-links") ?? {};
    const branches = {};
    for (const s of sp) {
      const k = this.branchKey(s, ps);
      if (k && this.branchPrs[k]?.url) branches[s.id] = this.branchPrs[k].url;
    }
    // Kept whatever the Links tab says, so turning something back on shows it at once.
    const direct = [...Object.values(kept).flat(), ...Object.values(agentKept).flat(), ...Object.values(this.agentLinks).flat(), ...Object.values(branches), ...this.historyLinks()];
    const used = new Set(expand([...new Set(direct)], this.items).map((e) => e.url));
    for (const u of Object.keys(this.items)) if (!used.has(u)) delete this.items[u];
    // Each space's links: by hand on it and on its agents, then its branch's PR and its
    // Claude sessions', less those hidden, then what they bring along; agents' the same
    // with their space's own (by hand and its branch's), for the agents list.
    const cfg = linkSettings(shared("jj-links"));
    const mineOf = (own, auto, off) => [...new Set([...own, ...auto.filter((u) => u && !off.has(u))])];
    const shownOf = (own, auto, off) => {
      const mine = mineOf(own, auto, off);
      return expand(mine, this.items, cfg).map((e) => e.url).filter((u) => mine.includes(u) || !off.has(u));
    };
    const as = agents();
    this.links = new Map(sp.map((s) => {
      const mates = as.filter((a) => a.space === s.id);
      const own = [...(kept[s.id] ?? []), ...mates.flatMap((a) => agentKept[a.address] ?? [])];
      const auto = [branches[s.id], ...mates.flatMap((a) => this.agentLinks[a.address] ?? [])];
      return [s.id, shownOf(own, auto, new Set(hidden[s.id] ?? []))];
    }));
    const shownAgents = {};
    const unexpanded = {}; // terminal -> its links before what they bring along, for jj-tasks
    for (const a of as) {
      const own = [...(agentKept[a.address] ?? []), ...(kept[a.space] ?? [])];
      const auto = [...(this.agentLinks[a.address] ?? []), branches[a.space]];
      const off = new Set(hidden[a.space] ?? []);
      const urls = shownOf(own, auto, off);
      if (urls.length) shownAgents[a.address] = urls;
      const mine = mineOf(own, auto, off);
      if (mine.length) unexpanded[a.address] = mine;
    }
    this.cards = new Set([...this.links.values(), ...Object.values(shownAgents)].flat().filter(isCard));
    const unread = Object.fromEntries(Object.entries(this.unread).filter(([k, u]) => !(this.dismissed[k] >= u.at)));
    const gh = { items: this.items, agents: this.agentLinks, branches, shown: { agents: shownAgents, direct: unexpanded }, trello: this.trello, unread };
    const text = JSON.stringify(gh);
    if (text !== this.published) {
      this.published = text;
      setShared("github", gh);
    }
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      const shown = new Set(sp.filter((s) => !this.hidden.has(s.id)).map((s) => at[s.id]));
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && shown.has(k) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      // Homes, for folders on one machine at the same place under another's home.
      for (const m of this.machines.filter((m) => m.state === "connected" && !this.homes[m.name])) {
        const r = await exec("printenv", ["HOME"], { on: m.name }).catch(() => null);
        if (r?.code !== 0 || !r.stdout.trim()) continue;
        this.homes[m.name] = r.stdout.trim();
        localStorage.setItem("folders.homes", JSON.stringify(this.homes));
      }
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        await Promise.all(keys.map((key) => this.check(key, cx)));
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // Ref-only reads avoid scanning the worktree or waking its index watch.
      // Two reads: a folder name may itself contain a newline.
      const [r, common] = await Promise.all([
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on }),
      ]);
      if (r.code !== 0 || common.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.code !== 0 ? r.stderr : common.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = r.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
      const [branch, counts, origin] = await Promise.all([
        exec("git", ["symbolic-ref", "-q", "HEAD"], { cwd, on }),
        exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on }),
        exec("git", ["remote", "get-url", "origin"], { cwd, on }),
      ]);
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      const bookmark = branch.code === 0 ? null : await bookmarkOf(cwd, on);
      const info = { name, top, branch: bookmark ?? (branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : "(detached)"), ahead, behind, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git`, gh: origin.code === 0 ? githubRepo(origin.stdout) : null };
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "jj-menu", kind: "popup", width: 220, height: 380, props: { tab: "space", target: { id: w.id } } });
  }

  // Where each space goes: a folder (by hand, else by path), Other, or Waiting.
  tree(sp, ps) {
    const st = this.folderState;
    const list = live(st);
    const parked = new Set(shared("spaces.waiting") ?? []);
    const inside = new Map(list.map((f) => [f.id, []]));
    const other = [];
    const waiting = [];
    sp.forEach((w, i) => {
      const g = this.git[where(w, ps)] ?? null;
      const r = { w, i, g, folder: null, waiting: parked.has(w.id) };
      if (r.waiting) return waiting.push(r);
      r.folder = folderOf(st, this.homes, w.machine ?? "", split(w.id)[1], [place(w, ps), rootOf(g)]);
      const bucket = inside.get(r.folder);
      if (!bucket) r.folder = null;
      (bucket ?? other).push(r);
    });
    return { list, inside, other, waiting };
  }

  // Folders, each with its spaces (folded: only the shown one), then Other, machines
  // that need you, and Waiting. Publishes the order next/prev and ctrl-1..9 go by
  // (shared("spaces.order")), every space in list order (shared("spaces.listed")) and
  // the folder each filed space is in (shared("spaces.folder"), for jj-agents).
  grouped(t, collapsed) {
    const sp = spaces();
    const ps = panes();
    const now = Date.now();
    const filing = this.tree(sp, ps);
    this.rowsById = new Map([...filing.inside.values(), filing.other, filing.waiting].flat().map((r) => [r.w.id, r]));
    const local = Boolean(shared("spaces.hide-remote"));
    const shown = (r) => !local || !r.w.machine || r.w.active;
    for (const r of this.rowsById.values()) r.cmd = spaceCommand(this, r.w);
    this.filed = filing.list.length > 0;
    const folded = new Set(shared("space-folders.folded") ?? []);
    const out = [];
    const order = [];
    const listed = [];
    const hidden = new Set();
    const tree = !collapsed && pref("agents") === "tree" ? treeContext() : null;
    const draw = (r) => {
      if (collapsed) return [this.compact(r, t)];
      const terms = terminalList(this, r.w, ps);
      return [this.row(r, t), ...spaceRows(this, r.w, t, tree, terms, now, pref("tabs"))];
    };
    const rows = (members, shut) => {
      for (const r of members) {
        listed.push(r.w.id);
        if (shut && !r.w.active) {
          hidden.add(r.w.id);
          continue;
        }
        r.n = order.push(r.w.id);
        out.push(...draw(r));
      }
    };
    for (const f of filing.list) {
      const all = filing.inside.get(f.id);
      const members = all.filter(shown);
      if (all.length && !members.length) continue;
      const color = f.color ? (MARK[f.color] ?? t[f.color]) : t.dim;
      out.push(collapsed ? this.railHead(f.id, f.name, color, folded.has(f.id), members, t) : this.folderHead(f, color, members, folded.has(f.id), t, filing.list));
      rows(members, folded.has(f.id));
    }
    const dragging = this.pressed !== null && Boolean(this.rowsById.get(this.pressed)?.folder);
    const other = filing.other.filter(shown);
    if (this.filed && (other.length || dragging)) {
      out.push(collapsed ? this.railHead("other", "Other", t.border, folded.has("other"), other, t) : this.otherHead(other, folded.has("other"), t));
      rows(other, folded.has("other"));
    } else rows(other, false);
    if (!sp.length) out.push(machines().find((m) => m.name === null)?.layout === "loading" ? this.loadingRow(t, collapsed) : this.emptyRow(t, collapsed));
    if (!local) out.push(...this.machineRows(t, collapsed));
    const open = Boolean(shared("waiting.open"));
    const waiting = filing.waiting.filter(shown);
    for (const r of waiting) {
      listed.push(r.w.id);
      if (open) r.n = order.push(r.w.id);
    }
    out.push(...this.waitingSection(t, collapsed, waiting, draw));
    this.hidden = hidden;
    if (tree) publishOrder(tree);
    const filed = Object.fromEntries(filing.list.flatMap((f) => filing.inside.get(f.id).map((r) => [r.w.id, f.id])));
    for (const [key, value] of [["spaces.order", order], ["spaces.listed", listed]]) if (JSON.stringify(value) !== JSON.stringify(shared(key) ?? [])) setShared(key, value);
    if (JSON.stringify(filed) !== JSON.stringify(shared("spaces.folder") ?? {})) setShared("spaces.folder", filed);
    return out;
  }

  endDrag() {
    this.pressed = this.over = this.overFolder = this.moving = this.overMove = null;
  }

  // A header under a dragged space (it would go in there) or a dragged folder.
  overHead(id, cx) {
    let changed = false;
    if (this.pressed !== null && (this.overFolder !== id || this.over !== null)) {
      this.overFolder = id;
      this.over = null;
      changed = true;
    }
    if (this.moving && this.moving !== "other" && id !== "other" && this.overMove !== id) {
      this.overMove = id;
      changed = true;
    }
    if (changed) cx.notify();
  }

  // Released on a header: a space goes in, a folder goes there, a click folds.
  upOnHead(id, cx) {
    const { pressed, moving, overMove } = this;
    this.endDrag();
    if (pressed !== null) this.dropSpace(pressed, id === "other" ? "" : id);
    else if (moving === id) this.fold(id);
    else if (moving && moving !== "other" && id !== "other" && overMove === id) this.reorder(moving, id);
    cx.notify();
  }

  // A folder: click folds it (folded, its count takes the most urgent status's color),
  // right-click for its menu, drag onto another to move it; spaces dragged onto it go in.
  folderHead(f, color, members, folded, t, list) {
    const top = urgent(members);
    const moving = this.moving && this.moving !== "other" ? this.moving : null;
    const from = list.findIndex((x) => x.id === moving);
    const to = list.findIndex((x) => x.id === f.id);
    const add = this.hoverHead === f.id ? this.newIn(f) : null;
    return h_flex().id(`folder-${f.id}`).relative().h(26).mt(6).flex_none().px(8).gap(7).items_center().rounded(6)
      .text_size(11).text_color(t.dim).cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
      .when(this.pressed !== null && this.overFolder === f.id, (el) => el.bg(t.selected).text_color(t.foreground))
      .when(moving === f.id && this.overMove !== f.id, (el) => el.opacity(0.5))
      .when(Boolean(moving) && moving !== f.id && this.overMove === f.id, (el) => el.child(div().absolute().left(0).right(0).h(2).bg(t.accent)
        .when(from < to, (line) => line.bottom(0))
        .when(from > to, (line) => line.top(0))))
      .on_hover((hovered, cx) => {
        const next = hovered ? f.id : this.hoverHead === f.id ? null : this.hoverHead;
        if (next !== this.hoverHead) {
          this.hoverHead = next;
          cx.notify();
        }
      })
      .on_mouse_down("left", () => { this.moving = f.id; this.overMove = f.id; })
      .on_mouse_down("right", () => openOverlay({ mod: "jj-menu", kind: "popup", width: 240, height: 260, props: { tab: "folder", target: { id: f.id } } }))
      .on_mouse_move((_e, cx) => this.overHead(f.id, cx))
      .on_mouse_up("left", (_e, cx) => this.upOnHead(f.id, cx))
      .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none())
      .child(svg("mods/workspace-chrome/folder.svg").size(12).flex_none().text_color(color))
      .child(div().flex_1().min_w(0).truncate().child(f.name))
      .when(Boolean(add), (el) => el.child(div().id(`folder-add-${f.id}`).flex_none().px(4).rounded(4).tooltip(add.tip)
        .hover((st) => st.bg(t.selected).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", add.args); })
        .child("+")))
      .child(div().flex_none().text_color(folded && top ? t[top] : t.dim).child(String(members.length)));
  }

  // Spaces in no folder; spaces dragged onto it leave theirs.
  otherHead(members, folded, t) {
    const top = urgent(members);
    return h_flex().id("other-head").h(26).mt(6).flex_none().px(8).gap(7).items_center().rounded(6)
      .text_size(11).text_color(t.dim).cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
      .when(this.pressed !== null && this.overFolder === "other", (el) => el.bg(t.selected).text_color(t.foreground))
      .on_mouse_down("left", () => { this.moving = "other"; })
      .on_mouse_move((_e, cx) => this.overHead("other", cx))
      .on_mouse_up("left", (_e, cx) => this.upOnHead("other", cx))
      .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none())
      .child(div().flex_1().child("Other"))
      .child(div().flex_none().text_color(folded && top ? t[top] : t.dim).child(String(members.length)));
  }

  // A folder on the rail: a line (thicker folded) that folds it.
  railHead(id, name, color, folded, members, t) {
    const top = urgent(members);
    return railCell(h_flex().id(`rail-${id}`).w(RAIL_CELL).h(12).mt(4).px(6).items_center().rounded(4).cursor_pointer()
      .hover((st) => st.bg(t.hover))
      .tooltip(`${name} · ${members.length}`)
      .on_click(() => this.fold(id))
      .child(div().flex_1().h(folded ? 3 : 1).rounded(1).bg(folded && top ? t[top] : color)));
  }

  loadingRow(t, collapsed) {
    return h_flex().id("spaces-loading").h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, (el) => el.justify_center())
      .text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
  }

  emptyRow(t, collapsed) {
    const el = h_flex().id("spaces-new").h(28).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(7)
      .text_size(12).text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground))
      .on_click(() => run("space.new", { machine: "" }))
      .when(collapsed, (el) => el.w(RAIL_CELL).rounded(6).justify_center().tooltip("New space")
        .child(h_flex().size(18).rounded(5).border_1().border_color(t.dim).items_center().justify_center()
          .child(svg("mods/workspace-chrome/plus.svg").size(10))))
      .when(!collapsed, (el) => el.child(svg("mods/workspace-chrome/plus.svg").size(12)).child("New space"));
    return collapsed ? railCell(el) : el;
  }

  // Waiting spaces, under a header that folds them (shared("waiting.open"), this
  // screen's, closed at first); folded, its count takes the most urgent status's color.
  waitingSection(t, collapsed, waiting, draw) {
    if (!waiting.length) return [];
    const open = Boolean(shared("waiting.open"));
    const top = urgent(waiting);
    const head = h_flex().id("waiting-head").h(26).mt(6).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(6)
      .text_size(11).text_color(t.dim).cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
      .when(collapsed, (el) => el.w(RAIL_CELL).justify_center().tooltip(`Waiting · ${waiting.length}`))
      .on_click((_e, cx) => { setShared("waiting.open", !open); cx.notify(); })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
      .when(!collapsed, (el) => el.child(div().flex_1().child("Waiting")))
      .child(div().flex_none().text_color(!open && top ? t[top] : t.dim).child(String(waiting.length)));
    return [collapsed ? railCell(head) : head, ...(open ? waiting.flatMap(draw) : [])];
  }

  // A row per machine that needs you: asleep, a login (with the command to Copy),
  // rebuilt (Connect) or loading. A click opens Settings > Machines.
  machineRows(t, collapsed) {
    const names = [...new Set([...spaces().map((s) => s.machine).filter(Boolean), ...this.machines.map((m) => m.name), ...Object.keys(this.reconnecting)])].sort();
    return names.flatMap((m) => {
      const repair = this.reconnecting[m];
      const machine = this.machines.find((k) => k.name === m) ?? repair?.machine;
      const layout = machines().find((k) => k.name === m)?.layout;
      const connected = machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const loading = connected && (!layout || layout === "loading");
      if (connected && !rebuilt && layout === "ready") return [];
      const login = machine?.state === "needs_login" ? `hc machine login ${m}` : null;
      const state = loading ? "loading…" : connected ? "unavailable" : (machine?.state ?? "asleep").replace(/_/g, " ");
      const icon = svg("mods/workspace-chrome/server.svg").size(13).flex_none();
      const badge = div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const head = h_flex().id(`machine-${m}`).h(26).mt(6).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(6).text_size(11).text_color(t.dim)
        .when(!rebuilt && !loading, (el) => el.cursor_pointer().hover((st) => st.bg(t.hover)).on_click(() => run("app.settings", { section: "machines" })))
        .when(collapsed, (el) => el.w(RAIL_CELL).justify_center().tooltip(login ? `${m} needs a login: run ${login}. Click for Settings.` : `${m} · ${rebuilt ? "rebuilt" : state}`)
          .child(div().relative().flex_none().child(icon).child(badge)))
        .when(!collapsed, (el) => el.child(icon).child(div().flex_1().truncate().child(m))
          .when(!rebuilt && !login, (el) => el.child(div().flex_none().child(state)))
          .when(rebuilt, (el) => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover((st) => st.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim)));
      const guidance = !collapsed && login ? [v_flex().px(8).pb(6).gap(3).flex_none()
        .child(div().text_size(11).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(5).items_center()
          .child(div().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login))
          .child(div().id(`machine-login-copy-${m}`).flex_none().px(5).py(2).rounded(4)
            .text_size(11).text_color(t.foreground).bg(t.raised).cursor_pointer().hover((st) => st.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login); this.copiedLogin = login; cx.notify(); })
            .child(this.copiedLogin === login ? "Copied" : "Copy")))] : [];
      return [collapsed ? railCell(head) : head, ...guidance];
    });
  }

  // Only what's unusual, after the name: "spike \u21912 \u21931". The branch goes when the
  // name already says it (a worktree is named after its branch), and master/main go:
  // nearly every space is on one.
  gitTail(g, name, t) {
    const raw = g.branch ?? "detached";
    const where = pref("branch") === "hidden" || raw.toLowerCase() === name.toLowerCase() || raw === "master" || raw === "main" ? "" : raw;
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  // A server icon before the name names another machine's space, a monitor this one's. Dropped on a space of the same
  // machine, a space moves next to it (into its folder); on another machine's, into its folder.
  row(r, t) {
    const { w, i, g } = r;
    const on = w.active;
    const fromIndex = this.pressed === null ? -1 : spaces().findIndex(s => s.id === this.pressed);
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(30)
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === w.id && this.pressed !== w.id, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(fromIndex < i, line => line.bottom(0))
          .when(fromIndex > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.over = w.id;
        this.overFolder = null;
      })
      .on_mouse_move((_e, cx) => {
        let changed = false;
        if (this.moving && this.overMove !== null) {
          this.overMove = null;
          changed = true;
        }
        if (this.pressed !== null) {
          const source = spaces().find(s => s.id === this.pressed);
          const same = Boolean(source) && (source.machine ?? null) === (w.machine ?? null);
          const over = same ? w.id : null;
          const overFolder = same || !this.filed || r.waiting ? null : (r.folder ?? "other");
          if (this.over !== over || this.overFolder !== overFolder) {
            this.over = over;
            this.overFolder = overFolder;
            changed = true;
          }
        }
        if (changed) cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => {
        const { pressed: from, over, overFolder } = this;
        this.endDrag();
        if (from !== null && over === w.id && from !== w.id) {
          const source = this.rowsById?.get(from);
          if (this.filed && source && !source.waiting && !r.waiting && source.folder !== r.folder) this.dropSpace(from, r.folder ?? "");
          const index = spaces().findIndex(s => s.id === w.id);
          if (index !== -1) run("space.move", { id: from, index: index + 1 });
        } else if (from === w.id) run("space.select", { id: w.id });
        else if (from !== null && overFolder !== null) this.dropSpace(from, overFolder === "other" ? "" : overFolder);
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(pref("icon") !== "hidden", (el) => el.child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?")))
          .child(div().id(`space-machine-${w.id}`).flex_none().flex().items_center().text_color(t.dim).tooltip(w.machine ?? "This machine")
            .when(pref("icon") === "hidden", (el) => el.pl(3).mr(-3))
            .child(svg(`mods/workspace-chrome/${w.machine ? "server" : "monitor"}.svg`).size(12)))
          .child(div().flex_shrink(1).min_w(48).when(pref("branch") !== "hidden", (el) => el.max_w(150)).truncate().text_color(t.foreground).child(w.name))
          .child(g ? this.gitTail(g, w.name, t) : div().flex_1())
          .when(this.links?.get(w.id)?.length > 0, (el) => el.child(kinds(this.links.get(w.id), this.items, t, `gh-${w.id}`, () => openLinks(w.id))))
          .when(Boolean(r.cmd), (el) => el.child(commandMark(`cmd-${w.id}`, r.cmd, t))),
      );
  }

  compact({ w, n, cmd }, t) {
    const agent = (URGENT[w.status] ?? 0) >= (cmd?.at ? URGENT.done : URGENT.working) || !cmd;
    return railCell(h_flex()
      .id(`space-${w.id}`)
      .tooltip(w.machine ? `${w.name} · ${w.machine}` : w.name)
      .relative()
      .w(RAIL_CELL)
      .h(26)
      .rounded(6)
      .justify_center()
      .items_center()
      .when(w.active, (el) => el.bg(t.selected))
      .when(!w.active, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(n)))
      .child(agent ? div().absolute().right(5).text_color(tone(t, w.status)).child(glyph(w.status))
        : div().absolute().right(2).child(commandMark(`cmd-${w.id}`, cmd, t, 12))));
  }

  // Shows or hides other machines' spaces; crossed out while they're hidden.
  remoteButton(t) {
    const hidden = Boolean(shared("spaces.hide-remote"));
    return div().id("space-remote").size(26).flex_none().flex().items_center().justify_center().relative().rounded(6)
      .when(hidden, (el) => el.text_color(t.foreground))
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(hidden ? "Show other machines' spaces" : "Hide other machines' spaces")
      .on_click(() => setShared("spaces.hide-remote", !hidden))
      .child(svg("mods/workspace-chrome/server.svg").size(14))
      .when(hidden, (el) => el.child(div().absolute().right(2).bottom(2).size(11).flex().items_center().justify_center().rounded_full().bg(t.chrome).text_color(t.blocked)
        .child(svg("mods/workspace-chrome/x.svg").size(9))));
  }

  render() {
    if (props()?.link) return linkRender(this);
    if (props()?.folder) return folderRender(this);
    if (props()?.board) return boardRender(this);
    if (props()?.preview) return previewRender(this);
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    this.publish(sp, panes());
    this.publishFolders();
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child("Spaces"))
        .child(h_flex().gap(2).items_center()
          .when(!collapsed, el => el.child(this.remoteButton(t)))
          .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
            .tooltip("New space · right-click: on another machine, or a folder")
            .on_click(() => run("space.new"))
            .on_mouse_down("right", () => openOverlay({ mod: "jj-menu", kind: "popup", width: 240, height: 300, props: { tab: "new" } }))
            .child(svg("mods/workspace-chrome/plus.svg").size(14)))))
      .child(v_flex().flex_1().min_h(0).px(collapsed ? 0 : 8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.endDrag(); cx.notify(); })
        .children(this.grouped(t, collapsed)));
  }
}
