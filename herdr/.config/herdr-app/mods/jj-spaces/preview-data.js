// What the preview (preview.js) shows of a PR, issue or Trello card, asked of GitHub (one
// GraphQL query) or Trello: { kind, url, title, ref, state, meta, labels, checks, blocks }.
// blocks: the description, then comments and reviews oldest first, then a card's checklists
// and attachments, then linked items. A block's text comes as parts: markdown, images and
// videos. Images are downloaded into jj-cache/preview in Herdr's home (cacheImage), for image().

import { appHome, exec } from "herdr";
import * as fs from "fs/promises";
import { graphql, stateOf, cardsIn } from "./github.js";
import { ask, authHeader } from "./trello.js";

const ACTOR = "author { login }";
const COMMENTS = `comments(last: 50) { nodes { ${ACTOR} createdAt url body bodyHTML } }`;
const COMMON = `url number title state repository { nameWithOwner } ${ACTOR} createdAt updatedAt body bodyHTML labels(first: 10) { nodes { name color } } assignees(first: 5) { nodes { login } } milestone { title } ${COMMENTS}`;
const CHECKS = `commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) { nodes { __typename
  ... on CheckRun { name status conclusion detailsUrl checkSuite { workflowRun { workflow { name } } } }
  ... on StatusContext { context state targetUrl description } } } } } } }`;
const PR = `${COMMON} isDraft isInMergeQueue reviewDecision headRefName baseRefName mergeable mergeStateStatus additions deletions changedFiles
  closingIssuesReferences(first: 10) { nodes { url } }
  reviews(last: 30) { nodes { ${ACTOR} state body bodyHTML submittedAt url comments(first: 20) { nodes { path line originalLine body bodyHTML diffHunk url } } } }
  ${CHECKS}`;
const ISSUE = `${COMMON} stateReason closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { nodes { url } }`;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const unescape = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const at = (s) => Date.parse(s) || 0;

// GitHub's rendered HTML signs each attachment's URL so it downloads without a login for a few
// minutes: by the attachment's id, an <img> or a <video>.
function signed(html) {
  const out = {};
  for (const m of (html ?? "").matchAll(/<(img|video)\b[^>]*?\ssrc="([^"]+)"/g)) {
    const src = unescape(m[2]);
    const id = src.match(UUID)?.[0];
    if (id) out[id] ??= { kind: m[1] === "video" ? "video" : "img", src };
  }
  return out;
}

// Markdown, its images and videos taken out as parts of their own: [{ md } | { img, auth? } | { video }].
function partsOf(md, html, auth = null) {
  const sign = signed(html);
  const parts = [];
  const re = /!\[[^\]]*\]\(<?(\S+?)>?(?:\s+"[^"]*")?\)|<img\b[^>]*?src=["']([^"']+)["'][^>]*>|^[ \t]*(https:\/\/github\.com\/user-attachments\/assets\/\S+)[ \t]*$/gm;
  let last = 0;
  for (const m of (md ?? "").matchAll(re)) {
    const text = md.slice(last, m.index);
    if (text.trim()) parts.push({ md: text });
    last = m.index + m[0].length;
    const url = unescape(m[1] ?? m[2] ?? m[3]);
    const s = sign[url.match(UUID)?.[0]];
    if (s?.kind === "video" || (!s && m[3])) parts.push({ video: s?.src ?? url, link: url });
    else parts.push({ img: s?.src ?? url, auth: /(^|\.)trello\.com\//.test(url) ? auth : null, link: url });
  }
  const rest = (md ?? "").slice(last);
  if (rest.trim()) parts.push({ md: rest });
  return parts;
}

const CHECK_STATE = { SUCCESS: "success", NEUTRAL: "skipped", SKIPPED: "skipped", STALE: "skipped", FAILURE: "failure", TIMED_OUT: "failure", CANCELLED: "failure", ACTION_REQUIRED: "failure", STARTUP_FAILURE: "failure", ERROR: "failure", PENDING: "pending", EXPECTED: "pending" };
const CHECK_ORDER = { failure: 0, pending: 1, success: 2, skipped: 3 };

function checksOf(n) {
  const roll = n.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  if (!roll) return null;
  return (roll.contexts?.nodes ?? [])
    .map((c) => c.__typename === "CheckRun"
      ? { name: c.name, workflow: c.checkSuite?.workflowRun?.workflow?.name ?? "", state: c.status !== "COMPLETED" ? "pending" : CHECK_STATE[c.conclusion] ?? "skipped", url: c.detailsUrl }
      : { name: c.context, workflow: c.description ?? "", state: CHECK_STATE[c.state] ?? "pending", url: c.targetUrl })
    .sort((a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state] || `${a.workflow} ${a.name}`.localeCompare(`${b.workflow} ${b.name}`));
}

export async function fetchGithub(url) {
  const data = await graphql(`r: resource(url: ${JSON.stringify(url)}) { __typename ... on PullRequest { ${PR} } ... on Issue { ${ISSUE} } }`);
  const n = data?.r;
  if (!n?.number) throw new Error("GitHub didn't answer for it: is gh logged in, and can it see the repo?");
  const pr = n.__typename === "PullRequest";
  const meta = [];
  if (pr) meta.push(`${n.headRefName} → ${n.baseRefName}`, `+${n.additions} −${n.deletions} · ${n.changedFiles} file${n.changedFiles === 1 ? "" : "s"}`);
  if (n.milestone?.title) meta.push(n.milestone.title);
  const blocks = [{ type: "body", id: "body", author: n.author?.login ?? "ghost", at: at(n.createdAt), url: n.url, parts: partsOf(n.body || "_No description._", n.bodyHTML) }];
  const timeline = [
    ...(n.comments?.nodes ?? []).map((c) => ({ type: "comment", id: c.url, author: c.author?.login ?? "ghost", at: at(c.createdAt), url: c.url, parts: partsOf(c.body, c.bodyHTML) })),
    ...(n.reviews?.nodes ?? [])
      .filter((r) => r.body?.trim() || r.comments?.nodes?.length || r.state !== "COMMENTED")
      .map((r) => ({
        type: "review", id: r.url, author: r.author?.login ?? "ghost", at: at(r.submittedAt), url: r.url, state: r.state, parts: r.body?.trim() ? partsOf(r.body, r.bodyHTML) : [],
        inline: (r.comments?.nodes ?? []).map((c) => ({ path: c.path, line: c.line ?? c.originalLine, hunk: (c.diffHunk ?? "").split("\n").slice(-4).join("\n"), url: c.url, parts: partsOf(c.body, c.bodyHTML) })),
      })),
  ].sort((a, b) => a.at - b.at);
  const links = [...(n.closingIssuesReferences ?? n.closedByPullRequestsReferences)?.nodes?.map((l) => l.url) ?? [], ...cardsIn(n.body)];
  return {
    kind: pr ? "pr" : "issue", url: n.url, title: n.title, ref: `${n.repository.nameWithOwner}#${n.number}`, state: stateOf(n), review: pr ? n.reviewDecision : null,
    merge: pr ? n.mergeStateStatus : null, meta, author: n.author?.login ?? "ghost", created: at(n.createdAt),
    labels: (n.labels?.nodes ?? []).map((l) => ({ name: l.name, color: `#${l.color}` })),
    people: (n.assignees?.nodes ?? []).map((a) => a.login),
    checks: pr ? checksOf(n) : null,
    blocks: [...blocks, ...timeline],
    links,
  };
}

const GITHUB = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|issues)\/\d+/g;

export async function fetchCard(url, cfg) {
  const short = url.match(/trello\.com\/c\/([A-Za-z0-9]{8})/)?.[1];
  if (!short) throw new Error("That isn't a Trello card's URL.");
  const c = await ask(`cards/${short}?fields=name,desc,due,dueComplete,closed,labels,url,shortUrl,idShort,dateLastActivity&list=true&list_fields=name&board=true&board_fields=name&members=true&member_fields=fullName,initials&checklists=all&checklist_fields=name&attachments=true&attachment_fields=name,url,mimeType,isUpload,previews,date&actions=commentCard&actions_limit=50&action_memberCreator_fields=fullName,initials`, cfg);
  const auth = await authHeader(cfg);
  const blocks = [{ type: "body", id: "body", author: "", at: 0, url: c.shortUrl, parts: partsOf(c.desc || "_No description._", "", auth) }];
  for (const a of [...(c.actions ?? [])].reverse()) blocks.push({ type: "comment", id: a.id, author: a.memberCreator?.fullName ?? "", at: at(a.date), url: `${c.shortUrl}#comment-${a.id}`, parts: partsOf(a.data?.text ?? "", "", auth) });
  for (const l of c.checklists ?? []) blocks.push({ type: "checklist", id: l.id, title: l.name, items: [...(l.checkItems ?? [])].sort((x, y) => x.pos - y.pos).map((i) => ({ name: i.name, done: i.state === "complete" })) });
  for (const a of c.attachments ?? []) {
    const preview = [...(a.previews ?? [])].filter((p) => p.width <= 1600).sort((x, y) => y.width - x.width)[0];
    const image = a.mimeType?.startsWith("image/") || preview;
    blocks.push({ type: "attachment", id: a.id, title: a.name, url: a.url, at: at(a.date), parts: image ? [{ img: preview?.url ?? a.url, auth: a.isUpload ? auth : null, link: a.url }] : [] });
  }
  const state = c.closed ? "trello-archived" : c.dueComplete ? "trello-done" : "trello-open";
  const meta = [`${c.board?.name ?? "Trello"} › ${c.list?.name ?? ""}`];
  return {
    kind: "trello", url: c.shortUrl, title: c.name, ref: `${c.list?.name ?? "Card"} #${c.idShort}`, state, meta, active: at(c.dateLastActivity), due: c.due ? { at: at(c.due), done: Boolean(c.dueComplete) } : null,
    labels: (c.labels ?? []).map((l) => ({ name: l.name, trello: l.color })),
    people: (c.members ?? []).map((m) => m.fullName),
    checks: null,
    blocks,
    links: [...new Set(c.desc?.match(GITHUB) ?? [])],
  };
}

const hash = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
};
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp" };
const cached = {}; // key -> app-relative path, or a promise of it

// An image downloaded into jj-cache/preview (once: by its URL without a signature), as the
// path image() takes, or null when it couldn't be had. auth: an Authorization header, handed
// to curl in a config file that's gone again at once, not on its command line. (A mod's
// fetch gives text, not bytes.)
export function cacheImage(url, auth) {
  const key = hash(url.replace(/\?.*$/, ""));
  return (cached[key] ??= (async () => {
    const dir = `${appHome()}/jj-cache/preview`;
    for (const ext of Object.values(EXT)) if (await fs.exists(`${dir}/${key}.${ext}`)) return `jj-cache/preview/${key}.${ext}`;
    const part = `${dir}/${key}.part`;
    const conf = `${dir}/.${key}.curl`;
    try {
      await fs.mkdir(dir, { recursive: true });
      if (auth) await fs.writeFile(conf, `header = "Authorization: ${auth.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"\n`);
      const r = await exec("curl", ["-sfL", "--max-filesize", "15000000", "-o", part, "-w", "%{content_type}", ...(auth ? ["-K", conf] : []), url], { timeout: 60000 }).finally(() => auth && fs.unlink(conf).catch(() => null));
      const ext = EXT[r.stdout.split(";")[0].trim().toLowerCase()];
      if (r.code !== 0 || !ext) {
        await fs.unlink(part).catch(() => null);
        return null;
      }
      await exec("mv", ["-f", part, `${dir}/${key}.${ext}`]);
      return `jj-cache/preview/${key}.${ext}`;
    } catch {
      delete cached[key];
      return null;
    }
  })());
}
