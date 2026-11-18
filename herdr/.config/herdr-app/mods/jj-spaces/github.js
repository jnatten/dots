// GitHub PRs and issues for the sidebar: the ones Claude Code recorded in a
// session (its transcript's "pr-link" lines, as Claude desktop reads them), the
// PR of a branch, and the state of each, asked of GitHub with one GraphQL query.
// Each comes with what it's linked to: a PR's issues, an issue's PRs, and the
// Trello cards in their descriptions (trello.js asks Trello about those). A PR's badge
// marks its review (approved, changes requested) and, with a dot, GitHub's unread
// notifications about it (shared("github").unread, by prKey).

import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, settings, shared, setShared } from "herdr";

const PR = "__typename url number title state isDraft isInMergeQueue reviewDecision repository { nameWithOwner }";
const ISSUE = "__typename url number title state stateReason repository { nameWithOwner }";
const PR_LINKED = `${PR} body closingIssuesReferences(first: 10) { nodes { ${ISSUE} body } }`;
const ISSUE_LINKED = `${ISSUE} body closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { nodes { ${PR} body } }`;
const NODE = `__typename ... on PullRequest { ${PR_LINKED} } ... on Issue { ${ISSUE_LINKED} }`;

const CARD = /https?:\/\/(?:www\.)?trello\.com\/c\/([A-Za-z0-9]{8})/;
export const cardUrl = (text) => { const m = (text ?? "").match(CARD); return m ? `https://trello.com/c/${m[1]}` : null; };
export const isCard = (url) => CARD.test(url ?? "");
const cardsIn = (body) => [...new Set([...(body ?? "").matchAll(new RegExp(CARD, "g"))].map((m) => `https://trello.com/c/${m[1]}`))];
const linkedOf = (n) => (n.closingIssuesReferences ?? n.closedByPullRequestsReferences)?.nodes ?? [];

// GitHub's own colors, [light, dark]; merge-queued is the attention yellow. Trello cards in its blue.
const GREEN = ["#1a7f37", "#3fb950"], PURPLE = ["#8250df", "#a371f7"], GRAY = ["#59636e", "#9198a1"], BLUE = ["#0c66e4", "#579dff"];
export const GH = {
  open: { icon: "mods/jj-spaces/git-pull-request.svg", color: GREEN, label: "Open" },
  draft: { icon: "mods/jj-spaces/git-pull-request-draft.svg", color: GRAY, label: "Draft" },
  queued: { icon: "mods/jj-spaces/git-pull-request.svg", color: ["#9a6700", "#d29922"], label: "Merge queued" },
  merged: { icon: "mods/jj-spaces/git-merge.svg", color: PURPLE, label: "Merged" },
  closed: { icon: "mods/jj-spaces/git-pull-request-closed.svg", color: ["#cf222e", "#f85149"], label: "Closed" },
  "issue-open": { icon: "mods/jj-spaces/circle-dot.svg", color: GREEN, label: "Open" },
  "issue-done": { icon: "mods/workspace-chrome/circle-check.svg", color: PURPLE, label: "Closed" },
  "issue-skip": { icon: "mods/jj-spaces/circle-slash.svg", color: GRAY, label: "Not planned" },
  "trello-open": { icon: "mods/jj-spaces/trello.svg", color: BLUE, label: "" },
  "trello-done": { icon: "mods/jj-spaces/trello.svg", color: PURPLE, label: "Done" },
  "trello-archived": { icon: "mods/jj-spaces/trello.svg", color: GRAY, label: "Archived" },
};
export const FINAL = new Set(["merged", "closed", "issue-done", "issue-skip", "trello-done", "trello-archived"]);
// An open PR's review, and GitHub's unread blue.
const REVIEW = {
  APPROVED: { icon: "mods/workspace-chrome/check.svg", color: GREEN, label: "Approved" },
  CHANGES_REQUESTED: { icon: "mods/jj-spaces/file-diff.svg", color: ["#cf222e", "#f85149"], label: "Changes requested" },
};
const UNREAD = ["#0969da", "#4493f8"];

export const prKey = (it) => (it?.kind === "pr" && it.repo && it.number ? `${it.repo}#${it.number}`.toLowerCase() : null);
const reviewOf = (it) => (it && GH[it.state] && !FINAL.has(it.state) ? REVIEW[it.review] ?? null : null);
const unreadOf = (it) => shared("github")?.unread?.[prKey(it)] ?? null;

// The PRs opened from a badge: their news is read, until there's newer (jj-spaces keeps it).
function markRead(its) {
  const read = its.map((it) => [prKey(it), unreadOf(it)]).filter(([, u]) => u).map(([key, u]) => ({ key, at: u.at }));
  if (read.length) setShared("github.read.ask", [...(shared("github.read.ask") ?? []), ...read]);
}

export function stateOf(n) {
  if (n.__typename === "Issue") return n.state === "OPEN" ? "issue-open" : n.stateReason === "NOT_PLANNED" ? "issue-skip" : "issue-done";
  if (n.state === "MERGED") return "merged";
  if (n.state === "CLOSED") return "closed";
  return n.isInMergeQueue ? "queued" : n.isDraft ? "draft" : "open";
}

const parseUrl = (url) => url.match(/github\.com\/([^/]+\/[^/]+)\/(pull|issues)\/(\d+)/);

export function itemOf(n, at) {
  return { kind: n.__typename === "Issue" ? "issue" : "pr", url: n.url, repo: n.repository?.nameWithOwner ?? "", number: n.number, title: n.title ?? "", state: stateOf(n), review: n.reviewDecision ?? null, at, links: linkedOf(n).map((l) => l.url), trello: cardsIn(n.body) };
}

// A node and those it's linked to, into `items`. Those come without `links` of their
// own (one hop), so they don't replace one asked about directly.
function collect(n, at, items) {
  items[n.url] = itemOf(n, at);
  for (const l of linkedOf(n)) {
    if (items[l.url]?.links) continue;
    const { links: _, ...it } = itemOf(l, at);
    items[l.url] = it;
  }
}

// What a URL nobody could answer for shows: its number, dimmed.
export function unknown(url, at) {
  if (isCard(url)) return { kind: "trello", url, repo: "", list: "", number: null, title: "", state: "unknown", at };
  const m = parseUrl(url);
  return { kind: m?.[2] === "issues" ? "issue" : "pr", url, repo: m?.[1] ?? "", number: Number(m?.[3]) || null, title: "", state: "unknown", at, links: [], trello: [] };
}

export function tipOf(it, s) {
  if (it.kind === "trello") return [it.repo || "Trello card", it.list, s?.label, it.title].filter(Boolean).join(" · ");
  return [`${it.repo}#${it.number ?? "?"}`, s?.label, reviewOf(it)?.label, unreadOf(it) && "New activity", it.title].filter(Boolean).join(" · ");
}

// `urls`, then what they bring along: a PR's issues and an issue's PRs (`related`),
// and the Trello cards in any of their descriptions (`trello`). One hop only.
// [{ url, via }], via: the URL it came with, null for those in `urls`.
export function expand(urls, items, { related = true, trello = true } = {}) {
  const out = [];
  const seen = new Set();
  const add = (url, via) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, via });
  };
  for (const url of urls) add(url, null);
  for (const url of urls) {
    const near = related ? (items[url]?.links ?? []) : [];
    for (const l of near) add(l, url);
    if (!trello) continue;
    for (const c of items[url]?.trello ?? []) add(c, url);
    for (const l of near) for (const c of items[l]?.trello ?? []) add(c, l);
  }
  return out;
}

// "owner/name" of a GitHub remote URL, or null.
export function githubRepo(remote) {
  const m = (remote ?? "").trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

// A branch from the spaces list's label (git's branch, or jj's nearest bookmarks:
// "feat/x*~2", "feat@origin"), or null for main, master and the unknowable.
export function branchName(label) {
  if (!label || /^\d+ bookmarks/.test(label)) return null;
  const names = label.replace(/~\d+$/, "").split(/\s+/).map((b) => b.replace(/\*$/, "").replace(/@[^@]*$/, ""));
  return names.find((b) => b && b !== "?" && b !== "main" && b !== "master" && b !== "(detached)") ?? null;
}

// PR URLs Claude recorded in a session, first seen first.
export async function scanAgent(sid, on) {
  if (!/^[\w-]+$/.test(sid)) return [];
  const r = await exec("sh", ["-c", `grep -hF '"type":"pr-link"' "$HOME"/.claude/projects/*/"$1".jsonl 2>/dev/null; true`, "sh", sid], { on });
  const urls = [];
  for (const line of r.stdout.split("\n")) {
    try {
      const url = JSON.parse(line).prUrl;
      if (url && !urls.includes(url)) urls.push(url);
    } catch {}
  }
  return urls;
}

async function graphql(fields) {
  const r = await exec("gh", ["api", "graphql", "-f", `query=query { ${fields} }`], { timeout: 30000 });
  // A missing PR or repo is an error beside the rest of the data, and gh exits 1.
  return JSON.parse(r.stdout || "null")?.data ?? null;
}

// A repo's open PRs, yours first, then the most recently updated.
export async function openPrs(repo) {
  const [owner, name] = repo.split("/");
  const data = await graphql(`viewer { login } r: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequests(states: OPEN, first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ${PR} headRefName author { login } } } }`);
  if (!data?.r) throw new Error(`Couldn't list ${repo}'s open PRs.`);
  const at = Date.now();
  const prs = data.r.pullRequests.nodes.map((n) => ({ ...itemOf(n, at), branch: n.headRefName, author: n.author?.login ?? "", mine: n.author?.login === data.viewer?.login }));
  return [...prs.filter((p) => p.mine), ...prs.filter((p) => !p.mine)];
}

// A PR or issue from what someone typed: its URL, owner/repo#12, or #12 in `repo`.
// A Trello card's URL comes back as it is: the sidebar asks Trello about it.
export async function resolve(text, repo) {
  const s = text.trim();
  const card = cardUrl(s);
  if (card) return unknown(card, Date.now());
  const m = s.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/(?:pull|issues)\/(\d+)/) ?? s.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
  const short = s.match(/^#?(\d+)$/);
  if (!m && !(short && repo)) throw new Error(short ? "This space isn't in a GitHub repo: paste a URL or owner/repo#12." : "Paste a PR, issue or Trello card URL, owner/repo#12 or #12.");
  const [owner, name, number] = m ? m.slice(1) : [...repo.split("/"), short[1]];
  const data = await graphql(`r: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { issueOrPullRequest(number: ${Number(number)}) { ${NODE} } }`);
  const n = data?.r?.issueOrPullRequest;
  if (!n) throw new Error(`${owner}/${name}#${number} isn't on GitHub, or gh can't see it.`);
  return itemOf(n, Date.now());
}

// The PRs GitHub has unread notifications about, by prKey: { id, reason, at (ms) }.
// CI runs and merges or closes aren't news: the badge's own state says those.
export async function fetchUnread() {
  const q = '.[] | select(.subject.type == "PullRequest" and .reason != "ci_activity" and .reason != "state_change") | {id, url: .subject.url, reason, at: .updated_at} | tojson';
  const r = await exec("gh", ["api", "notifications", "--paginate", "-q", q], { timeout: 30000 });
  if (r.code !== 0) throw new Error((r.stderr || "gh api notifications failed").trim());
  const out = {};
  for (const line of r.stdout.split("\n")) {
    try {
      const n = JSON.parse(line);
      const m = n.url?.match(/\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/);
      if (m) out[`${m[1]}#${m[2]}`.toLowerCase()] = { id: n.id, reason: n.reason, at: Date.parse(n.at) || 0 };
    } catch {}
  }
  return out;
}

// Each URL's state, and each { repo, branch }'s newest PR (an open one first).
// ok: false when GitHub couldn't be asked at all.
export async function fetchGitHub(urls, branches) {
  const at = Date.now();
  const out = { items: {}, branches: {}, ok: true };
  const parts = [
    ...urls.map((url) => ({
      q: `resource(url: ${JSON.stringify(url)}) { ${NODE} }`,
      done: (d) => (d?.number ? collect(d, at, out.items) : (out.items[url] = unknown(url, at))),
    })),
    ...branches.map(({ key, repo, branch }) => {
      const [owner, name] = repo.split("/");
      return {
        q: `repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequests(headRefName: ${JSON.stringify(branch)}, first: 5, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { ${PR_LINKED} } } }`,
        done: (d) => {
          const nodes = d?.pullRequests?.nodes ?? [];
          const pr = nodes.find((n) => n.state === "OPEN") ?? nodes[0];
          out.branches[key] = pr?.url ?? null;
          if (pr) collect(pr, at, out.items);
        },
      };
    }),
  ];
  for (let i = 0; i < parts.length; i += 40) {
    const chunk = parts.slice(i, i + 40);
    let data = null;
    try { data = await graphql(chunk.map((p, j) => `a${j}: ${p.q}`).join("\n")); } catch {}
    if (!data) { out.ok = false; continue; }
    chunk.forEach((p, j) => p.done(data[`a${j}`]));
  }
  return out;
}

const open = (url, cx) => cx.spawn(async () => { await exec("open", [url]).catch(() => null); });
const iconOf = (it, s) => s?.icon ?? (it.kind === "issue" ? GH["issue-open"].icon : it.kind === "trello" ? GH["trello-open"].icon : GH.open.icon);
const colorOf = (s, t) => (s ? s.color[settings()?.dark ? 1 : 0] : t.dim);

// The icon, with a dot when there's news, and the lead PR's review after it.
function marks(el, it, s, news, t) {
  const review = reviewOf(it);
  return el
    .child(div().relative().flex_none().child(svg(iconOf(it, s)).size(11))
      .when(news, (d) => d.child(div().absolute().top(-2).right(-3).size(6).rounded(3).bg(colorOf({ color: UNREAD }, t)))))
    .when(Boolean(review), (el) => el.child(div().flex_none().text_color(colorOf(review, t)).child(svg(review.icon).size(10))));
}

// A state-colored icon with its number, for the link dialog; a click opens the link.
export function badge(url, items, t, id) {
  const it = items[url] ?? unknown(url, 0);
  const s = GH[it.state];
  return h_flex()
    .id(id)
    .flex_none()
    .gap(2)
    .items_center()
    .text_size(11)
    .text_color(colorOf(s, t))
    .cursor_pointer()
    .tooltip(tipOf(it, s))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); markRead([it]); open(url, cx); })
    .map((el) => marks(el, it, s, Boolean(unreadOf(it)), t))
    .child(String(it.number ?? "?"));
}

// One icon per kind (PR, issue, Trello card), in the state of the one most worth a
// look (open before done, known before unknown, news first), with how many when more
// than one. A click opens the link, or calls `many` (the link dialog) when there are several.
export function kinds(urls, items, t, id, many) {
  const rank = (u) => (!GH[items[u]?.state] ? 4 : FINAL.has(items[u].state) ? 2 : 0) + (unreadOf(items[u]) ? 0 : 1);
  const groups = ["pr", "issue", "trello"].map((kind) => urls.filter((u) => (items[u] ?? unknown(u, 0)).kind === kind)).filter((g) => g.length);
  return h_flex()
    .flex_none()
    .gap(6)
    .items_center()
    .children(groups.map((g) => {
      const lead = g.reduce((a, b) => (rank(b) < rank(a) ? b : a));
      const it = items[lead] ?? unknown(lead, 0);
      const s = GH[it.state];
      return h_flex()
        .id(`${id}-${it.kind}`)
        .flex_none()
        .gap(2)
        .items_center()
        .text_size(11)
        .text_color(colorOf(s, t))
        .cursor_pointer()
        .tooltip(g.map((u) => { const x = items[u] ?? unknown(u, 0); return tipOf(x, GH[x.state]); }).join("\n"))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => {
          cx.stop_propagation();
          if (g.length > 1) return many();
          markRead([it]);
          open(lead, cx);
        })
        .map((el) => marks(el, it, s, g.some((u) => unreadOf(items[u])), t))
        .when(g.length > 1, (el) => el.child(String(g.length)));
    }));
}
