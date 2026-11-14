// Workspace spaces: stable colored avatars, in the order they're in, grouped by
// machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Agent state lives in the agents list, not here. Click to
// switch, right-click for its menu, drag to reorder. Spaces put in Waiting (kept on
// their machine, docs.js) go to a section of their own at the bottom, folded at first.
// Then its GitHub PRs and issues: linked from its menu, its branch's PR, and
// those its Claude sessions opened, each with the issues or PRs it's linked to
// and the Trello cards in their descriptions. This copy asks GitHub and Trello
// about all of them and shares what it learns as shared("github") for the agents
// list, the link dialog and the spacing dialog's Links tab. Those linked by hand, to
// the space or to one of its agents, live on its machine (docs.js), copied into
// shared("github.links") and shared("github.agent-links").

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, terminals, agents, focused, props, nextCommand, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout, notify } from "herdr";
import { FINAL, branchName, expand, fetchGitHub, githubRepo, isCard, kinds, scanAgent } from "./github.js";
import { OpError, fetchCards, linkSettings, refsOf } from "./trello.js";
import { edited, setWaiting, split, updateLinks } from "./docs.js";
import { linkInit, linkRender } from "./links.js";

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
const inside = (p, dir) => p === dir || p.startsWith(dir + "/");
const ARCHIVE = "jj-sessions.archived";

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
const machineOf = (id) => (id.includes("/") ? id.split("/")[0] : null);

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

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
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked, gh: "owner/repo" }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    const gh = shared("github") ?? {};
    this.items = gh.items ?? {}; // url -> { kind, url, repo, number, title, state, at }
    this.agentLinks = gh.agents ?? {}; // terminal -> PR urls its Claude session recorded
    this.branchPrs = {}; // "owner/repo\0branch" -> { url, at }
    this.published = JSON.stringify(gh);
    this.claude = {}; // terminal -> { sid, working } at the last look
    this.scanQueue = new Set();
    this.stale = new Set(); // urls to ask GitHub about again now
    this.ghRetry = 0;
    this.linksAt = 0;
    this.missing = new Set(); // "machine\0space" with links whose space wasn't there at the last sync
    this.cards = new Set(); // Trello card urls shown somewhere
    this.trelloRetry = 0;
    this.trelloBlocked = null; // refsOf() and connect when 1Password said no
    this.connected = shared("jj-links.connect") ?? 0;
    this.trello = { state: "idle", error: null, cards: 0 }; // for the Links tab
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // Refresh only when the refs could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
    cx.spawn(async () => {
      for (;;) {
        // "link": the focused agent's, else the space's; "link-space": the space's.
        const command = await nextCommand();
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
    this.trelloDue(now, cx);
    this.linksDue(now, cx);
    this.waitingDue(cx);
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

  // Hand-made links and Waiting marks from each machine's core into shared("github.links"),
  // shared("github.hidden"), shared("github.agent-links") and shared("spaces.waiting"),
  // where the rows, the agents list and the dialog read them. A space or agent missing at two syncs in a row on a
  // machine whose layout is in loses its links there; the first time per machine, what
  // this screen kept itself is moved in.
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
      }
      this.missing = missing;
      if (edited() === before) {
        for (const [key, value] of Object.entries(cache)) if (JSON.stringify(value) !== JSON.stringify(shared(key) ?? {})) setShared(key, value);
        if (moved.size !== (shared("github.links.moved") ?? []).length) setShared("github.links.moved", [...moved]);
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
    const urls = [...new Set([...Object.values(shared("github.links") ?? {}).flat(), ...Object.values(shared("github.agent-links") ?? {}).flat(), ...Object.values(this.agentLinks).flat()])]
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
    const urls = [...this.cards].filter((u) => connect || old(this.items[u]));
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

  // What the other mods read: every linked item's state, agents' PRs and spaces'
  // branch PRs. Written only when it changed.
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
    const direct = [...Object.values(kept).flat(), ...Object.values(agentKept).flat(), ...Object.values(this.agentLinks).flat(), ...Object.values(branches)];
    const used = new Set(expand([...new Set(direct)], this.items).map((e) => e.url));
    for (const u of Object.keys(this.items)) if (!used.has(u)) delete this.items[u];
    // Each space's links: by hand on it and on its agents, then its branch's PR and its
    // Claude sessions', less those hidden, then what they bring along; agents' the same,
    // for the agents list.
    const cfg = linkSettings(shared("jj-links"));
    const shownOf = (own, auto, off) => {
      const mine = [...new Set([...own, ...auto.filter((u) => u && !off.has(u))])];
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
    for (const a of as) {
      const urls = shownOf(agentKept[a.address] ?? [], this.agentLinks[a.address] ?? [], new Set(hidden[a.space] ?? []));
      if (urls.length) shownAgents[a.address] = urls;
    }
    this.cards = new Set([...this.links.values(), ...Object.values(shownAgents)].flat().filter(isCard));
    const gh = { items: this.items, agents: this.agentLinks, branches, shown: { agents: shownAgents }, trello: this.trello };
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
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
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
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
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
    openOverlay({ mod: "jj-menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  ordered() {
    const sp = spaces(), ps = panes();
    return sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
  }

  // Archived Claude sessions in a workspace, leaving out those in workspaces nested inside it.
  archivedIn(path, nested = []) {
    return (shared(ARCHIVE) ?? []).filter((r) => inside(r.cwd, path) && !nested.some((p) => inside(r.cwd, p))).length;
  }

  archiveBadge(count, t) {
    return h_flex().flex_none().gap(3).items_center().text_size(11.5).text_color(t.dim).child(svg("mods/workspace-chrome/archive.svg").size(11)).child(String(count));
  }

  // The rows, but those in Waiting, then the Waiting section.
  grouped(t, collapsed) {
    const parked = new Set(shared("spaces.waiting") ?? []);
    const all = this.ordered();
    const rows = all.filter((r) => !parked.has(r.w.id));
    const waiting = all.filter((r) => parked.has(r.w.id));
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));
    return [...this.machineGroups(t, collapsed, rows, waiting, draw), ...this.waitingSection(t, collapsed, waiting, draw)];
  }

  // Waiting spaces, under a header that folds them (shared("waiting.open"), this
  // screen's, closed at first); folded, its count takes the most urgent status's color.
  waitingSection(t, collapsed, waiting, draw) {
    if (!waiting.length) return [];
    const open = Boolean(shared("waiting.open"));
    const URGENT = { blocked: 3, done: 2, working: 1 };
    const top = waiting.map((r) => r.w.status).reduce((m, st) => ((URGENT[st] ?? 0) > (URGENT[m] ?? 0) ? st : m), null);
    const head = h_flex().id("waiting-head").h(26).mt(6).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(6)
      .text_size(11).text_color(t.dim).cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
      .when(collapsed, (el) => el.w(RAIL_CELL).justify_center().tooltip(`Waiting · ${waiting.length}`))
      .on_click((_e, cx) => { setShared("waiting.open", !open); cx.notify(); })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
      .when(!collapsed, (el) => el.child(div().flex_1().child("Waiting")))
      .child(div().flex_none().text_color(!open && top ? t[top] : t.dim).child(String(waiting.length)));
    return [collapsed ? railCell(head) : head, ...(open ? waiting.map(draw) : [])];
  }

  // The rows, under a header per machine once one isn't this computer.
  machineGroups(t, collapsed, rows, waiting, draw) {
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"));
    };
    const loadingRow = m => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, el => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : rows.map(draw);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const login = machine?.state === "needs_login" ? `hc machine login ${m}` : null;
      const folded = this.folded.has(m);
      const icon = svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none();
      const badge = div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .when(collapsed, el => el.mt(4).w(RAIL_CELL).justify_center().rounded(6).tooltip(login ? `${m} needs a login: run ${login}. Click for Copy.` : m ? `${m} · ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : "This computer"))
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          if (collapsed && login) { run("app.settings", { section: "machines" }); return; }
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .when(!collapsed, el => el.child(icon))
        .when(collapsed, el => el.child(div().relative().flex_none().child(icon).when(Boolean(m), el => el.child(badge))))
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt && !login, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .when(collapsed, el => el.w(RAIL_CELL).rounded(6).justify_center().tooltip(`New space on ${m ?? "this computer"}`)
          .child(h_flex().size(18).rounded(5).border_1().border_color(t.dim).items_center().justify_center()
            .child(svg("mods/workspace-chrome/plus.svg").size(10))))
        .when(!collapsed, el => el.child(svg("mods/workspace-chrome/plus.svg").size(12)).child("New space there"));
      if (!collapsed && rebuilt) return [head];
      const cell = collapsed ? railCell : (el) => el;
      const guidance = !collapsed && login ? [v_flex().px(8).pb(6).gap(3).flex_none()
        .child(div().text_size(11).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(5).items_center()
          .child(div().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login))
          .child(div().id(`machine-login-copy-${m}`).flex_none().px(5).py(2).rounded(4)
            .text_size(11).text_color(t.foreground).bg(t.raised).cursor_pointer().hover(s => s.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login); this.copiedLogin = login; cx.notify(); })
            .child(this.copiedLogin === login ? "Copied" : "Copy")))] : [];
      const parkedHere = waiting.some((r) => (r.w.machine ?? null) === m);
      return [cell(head), ...guidance, ...(folded ? [] : mine.length ? mine.map(draw) : parkedHere ? [] : [loading(m) ? loadingRow(m) : cell(empty)])];
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one.
  gitTail(g, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
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

  row({ w, i, g }, t) {
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
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces().find(s => s.id === this.pressed);
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? w.id : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === w.id && from !== w.id) {
          const index = spaces().findIndex(s => s.id === w.id);
          if (index !== -1) run("space.move", { id: from, index: index + 1 });
        } else if (from === w.id) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?"))
          .child(div().flex_shrink(1).min_w(48).max_w(150).truncate().text_color(t.foreground).child(w.name))
          .child(g ? this.gitTail(g, w.name, t) : div().flex_1())
          .when(this.links?.get(w.id)?.length > 0, (el) => el.child(kinds(this.links.get(w.id), this.items, t, `gh-${w.id}`, () => openLinks(w.id))))
          .when(Boolean(g?.top), (el) => {
            const count = this.archivedIn(g.top, g.linked ? [] : Object.values(this.git).filter((k) => k?.linked && k.repo === g.repo).map((k) => k.top));
            return count > 0 ? el.child(this.archiveBadge(count, t)) : el;
          }),
      );
  }

  compact({ w, i }, t) {
    return railCell(h_flex()
      .id(`space-${w.id}`)
      .relative()
      .w(RAIL_CELL)
      .h(26)
      .rounded(6)
      .justify_center()
      .items_center()
      .when(w.active, (el) => el.bg(t.selected))
      .when(!w.active, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().absolute().right(5).text_color(tone(t, w.status)).child(glyph(w.status))));
  }

  render() {
    if (props()?.link) return linkRender(this);
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
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child("Spaces"))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().flex_1().min_h(0).px(collapsed ? 0 : 8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(this.grouped(t, collapsed)));
  }
}
