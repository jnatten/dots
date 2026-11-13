// GitHub PRs and issues for the sidebar: the ones Claude Code recorded in a
// session (its transcript's "pr-link" lines, as Claude desktop reads them), the
// PR of a branch, and the state of each, asked of GitHub with one GraphQL query.

import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, settings } from "herdr";

const PR = "__typename url number title state isDraft isInMergeQueue repository { nameWithOwner }";
const ISSUE = "url number title state stateReason repository { nameWithOwner }";
const NODE = `__typename ... on PullRequest { ${PR} } ... on Issue { ${ISSUE} }`;

// GitHub's own colors, [light, dark]; merge-queued is the attention yellow.
const GREEN = ["#1a7f37", "#3fb950"], PURPLE = ["#8250df", "#a371f7"], GRAY = ["#59636e", "#9198a1"];
export const GH = {
  open: { icon: "mods/jj-spaces/git-pull-request.svg", color: GREEN, label: "Open" },
  draft: { icon: "mods/jj-spaces/git-pull-request-draft.svg", color: GRAY, label: "Draft" },
  queued: { icon: "mods/jj-spaces/git-pull-request.svg", color: ["#9a6700", "#d29922"], label: "Merge queued" },
  merged: { icon: "mods/jj-spaces/git-merge.svg", color: PURPLE, label: "Merged" },
  closed: { icon: "mods/jj-spaces/git-pull-request-closed.svg", color: ["#cf222e", "#f85149"], label: "Closed" },
  "issue-open": { icon: "mods/jj-spaces/circle-dot.svg", color: GREEN, label: "Open" },
  "issue-done": { icon: "mods/workspace-chrome/circle-check.svg", color: PURPLE, label: "Closed" },
  "issue-skip": { icon: "mods/jj-spaces/circle-slash.svg", color: GRAY, label: "Not planned" },
};
export const FINAL = new Set(["merged", "closed", "issue-done", "issue-skip"]);

export function stateOf(n) {
  if (n.__typename === "Issue") return n.state === "OPEN" ? "issue-open" : n.stateReason === "NOT_PLANNED" ? "issue-skip" : "issue-done";
  if (n.state === "MERGED") return "merged";
  if (n.state === "CLOSED") return "closed";
  return n.isInMergeQueue ? "queued" : n.isDraft ? "draft" : "open";
}

const parseUrl = (url) => url.match(/github\.com\/([^/]+\/[^/]+)\/(pull|issues)\/(\d+)/);

export function itemOf(n, at) {
  return { kind: n.__typename === "Issue" ? "issue" : "pr", url: n.url, repo: n.repository?.nameWithOwner ?? "", number: n.number, title: n.title ?? "", state: stateOf(n), at };
}

// What a URL GitHub couldn't answer for shows: its number, dimmed.
function unknown(url, at) {
  const m = parseUrl(url);
  return { kind: m?.[2] === "issues" ? "issue" : "pr", url, repo: m?.[1] ?? "", number: Number(m?.[3]) || null, title: "", state: "unknown", at };
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
export async function resolve(text, repo) {
  const s = text.trim();
  const m = s.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/(?:pull|issues)\/(\d+)/) ?? s.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
  const short = s.match(/^#?(\d+)$/);
  if (!m && !(short && repo)) throw new Error(short ? "This space isn't in a GitHub repo: paste a URL or owner/repo#12." : "Paste a PR or issue URL, owner/repo#12 or #12.");
  const [owner, name, number] = m ? m.slice(1) : [...repo.split("/"), short[1]];
  const data = await graphql(`r: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { issueOrPullRequest(number: ${Number(number)}) { ${NODE} } }`);
  const n = data?.r?.issueOrPullRequest;
  if (!n) throw new Error(`${owner}/${name}#${number} isn't on GitHub, or gh can't see it.`);
  return itemOf(n, Date.now());
}

// Each URL's state, and each { repo, branch }'s newest PR (an open one first).
// ok: false when GitHub couldn't be asked at all.
export async function fetchGitHub(urls, branches) {
  const at = Date.now();
  const out = { items: {}, branches: {}, ok: true };
  const parts = [
    ...urls.map((url) => ({
      q: `resource(url: ${JSON.stringify(url)}) { ${NODE} }`,
      done: (d) => (out.items[url] = d?.number ? itemOf(d, at) : unknown(url, at)),
    })),
    ...branches.map(({ key, repo, branch }) => {
      const [owner, name] = repo.split("/");
      return {
        q: `repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequests(headRefName: ${JSON.stringify(branch)}, first: 5, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { ${PR} } } }`,
        done: (d) => {
          const nodes = d?.pullRequests?.nodes ?? [];
          const pr = nodes.find((n) => n.state === "OPEN") ?? nodes[0];
          out.branches[key] = pr?.url ?? null;
          if (pr) out.items[pr.url] = itemOf(pr, at);
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

// Small state-colored icons with their numbers; a click opens the link.
export function badges(urls, items, t, id, max) {
  const dark = Boolean(settings()?.dark);
  const badge = (url) => {
    const it = items[url] ?? unknown(url, 0);
    const s = GH[it.state];
    const color = s ? s.color[dark ? 1 : 0] : t.dim;
    const icon = s?.icon ?? (it.kind === "issue" ? GH["issue-open"].icon : GH.open.icon);
    const tip = [`${it.repo}#${it.number ?? "?"}`, s?.label, it.title].filter(Boolean).join(" · ");
    return h_flex()
      .id(`${id}-${url}`)
      .flex_none()
      .gap(2)
      .items_center()
      .text_size(11)
      .text_color(color)
      .cursor_pointer()
      .tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        cx.spawn(async () => { await exec("open", [url]).catch(() => null); });
      })
      .child(div().flex_none().child(svg(icon).size(11)))
      .child(String(it.number ?? "?"));
  };
  const rest = urls.slice(max);
  return h_flex()
    .flex_none()
    .gap(6)
    .items_center()
    .children(urls.slice(0, max).map(badge))
    .when(rest.length > 0, (el) => el.child(div().id(`${id}-more`).flex_none().text_size(11).text_color(t.dim)
      .tooltip(rest.map((u) => { const it = items[u]; return it ? `${it.repo}#${it.number} ${it.title}`.trim() : u; }).join("\n"))
      .child(`+${rest.length}`)));
}
