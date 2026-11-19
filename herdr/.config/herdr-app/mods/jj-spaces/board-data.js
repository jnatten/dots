// What the board (ctrl-a T, board.js) shows, asked of GitHub: the open PRs in its repos
// and those involving you, and the open issues in its repos. Its repos: those added in
// the spacing dialog's Board tab and those in the sidebar's folders (shared("board.repos"),
// found by discoverRepos), less those turned off there. Its settings: shared("jj-board").

import { exec, shared } from "herdr";
import { PR, ISSUE, githubRepo, graphql, itemOf } from "./github.js";

export const BOARD_DEFAULTS = { repos: [], skip: [], boards: [], hideEmpty: false };
export const boardSettings = () => ({ ...BOARD_DEFAULTS, ...(shared("jj-board") ?? {}) });

export function boardRepos() {
  const cfg = boardSettings();
  const skip = new Set(cfg.skip.map((r) => r.toLowerCase()));
  const seen = new Set();
  return [...cfg.repos, ...(shared("board.repos") ?? []).filter((r) => !skip.has(r.toLowerCase()))].filter((r) => {
    const k = r.toLowerCase();
    return !seen.has(k) && seen.add(k);
  });
}

const PR_FIELDS = `${PR} body updatedAt headRefName isCrossRepository author { login } closingIssuesReferences(first: 10) { nodes { url } } commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`;
const ISSUE_FIELDS = `${ISSUE} body updatedAt author { login } assignees(first: 3) { nodes { login } } labels(first: 6) { nodes { name color } } closedByPullRequestsReferences(first: 5) { nodes { url } }`;
const repoArgs = (repo) => {
  const [owner, name] = repo.split("/");
  return `owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}`;
};
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

// One query per chunk of repos, all at once: { data per repo, repos GitHub didn't know }.
async function perRepo(repos, size, field, head = "") {
  const out = { data: [], missing: [], failed: false, head: null };
  await Promise.all(
    chunks(repos, size).map(async (chunk, c) => {
      const data = await graphql([c === 0 ? head : "", ...chunk.map((r, i) => `r${i}: repository(${repoArgs(r)}) { ${field} }`)].join("\n")).catch(() => null);
      if (!data) return (out.failed = true);
      if (c === 0) out.head = data;
      chunk.forEach((r, i) => (data[`r${i}`] ? out.data.push(data[`r${i}`]) : out.missing.push(r)));
    }),
  );
  if (!repos.length && head) out.head = await graphql(head).catch(() => null);
  return out;
}

function prOf(n, at, login) {
  return {
    ...itemOf(n, at),
    author: n.author?.login ?? "",
    mine: Boolean(login) && n.author?.login === login,
    updated: Date.parse(n.updatedAt) || 0,
    checks: n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
    branch: n.headRefName ?? null,
    fork: Boolean(n.isCrossRepository),
  };
}

const search = (q) => `search(query: ${JSON.stringify(q)}, type: ISSUE, first: 100) { nodes { ... on PullRequest { ${PR_FIELDS} } } }`;

// { login, prs, missing }: every open PR in `repos` and on GitHub involving you, each
// with rr (your review is asked for), inv (it involves you) and mine.
export async function fetchPrs(repos) {
  const head = `viewer { login } rr: ${search("is:pr is:open archived:false review-requested:@me")} inv: ${search("is:pr is:open archived:false involves:@me")}`;
  const r = await perRepo(repos, 20, `pullRequests(states: OPEN, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ${PR_FIELDS} } }`, head);
  if (!r.head) throw new Error("Couldn't ask GitHub about PRs: is gh logged in?");
  const login = r.head.viewer?.login ?? "";
  const at = Date.now();
  const prs = {};
  const add = (n, flag) => {
    if (!n?.url) return;
    prs[n.url] ??= prOf(n, at, login);
    if (flag) prs[n.url][flag] = true;
  };
  for (const n of r.head.rr?.nodes ?? []) add(n, "rr");
  for (const n of r.head.inv?.nodes ?? []) add(n, "inv");
  for (const d of r.data) for (const n of d.pullRequests?.nodes ?? []) add(n);
  return { login, prs: Object.values(prs), missing: r.missing, partial: r.failed };
}

// { login, issues, missing }: every open issue in `repos`.
export async function fetchIssues(repos) {
  const r = await perRepo(repos, 15, `issues(states: OPEN, first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ${ISSUE_FIELDS} } }`, "viewer { login }");
  if (!r.head && repos.length) throw new Error("Couldn't ask GitHub about issues: is gh logged in?");
  const login = r.head?.viewer?.login ?? "";
  const at = Date.now();
  const issues = r.data.flatMap((d) =>
    (d.issues?.nodes ?? []).map((n) => ({
      ...itemOf(n, at),
      author: n.author?.login ?? "",
      assignees: (n.assignees?.nodes ?? []).map((a) => a.login),
      labels: (n.labels?.nodes ?? []).map((l) => ({ name: l.name, color: l.color })),
      updated: Date.parse(n.updatedAt) || 0,
    })),
  );
  return { login, issues, missing: r.missing, partial: r.failed };
}

// For each path, its own origin when it's a repo, else those of the repos right inside it:
// "<path>\t<origin>" lines.
const FIND = `origin() {
  if [ -e "$1/.jj" ]; then u=$(jj --ignore-working-copy -R "$1" git remote list 2>/dev/null | awk '$1 == "origin" { print $2 }')
  else u=$(git -C "$1" remote get-url origin 2>/dev/null); fi
  if [ -n "$u" ]; then printf '%s\\t%s\\n' "$1" "$u"; fi
}
for d; do
  if [ -e "$d/.git" ] || [ -e "$d/.jj" ]; then origin "$d"
  else for c in "$d"/*/; do if [ -e "$c.git" ] || [ -e "$c.jj" ]; then origin "\${c%/}"; fi; done; fi
done; true`;

// The GitHub repos in the sidebar's folders on machine `on` (null: this one), and where
// each is: [{ repo: "owner/repo", path }].
export async function discoverRepos(folders, on) {
  const paths = [...new Set(folders.flatMap((f) => f.paths?.[on ?? ""]?.paths ?? []))];
  if (!paths.length) return [];
  const r = await exec("sh", ["-c", FIND, "sh", ...paths], { on, timeout: 30000 });
  return r.stdout.split("\n").map((line) => {
    const [path, url] = line.split("\t");
    const repo = githubRepo(url);
    return repo ? { repo, path } : null;
  }).filter(Boolean);
}
