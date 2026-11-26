// Trello for Claude Code, read-only: a card with its description, checklists, comments and
// attachments, a board's lists and cards, the boards there are, and search. With the person's
// own key and token, the ones Herdr's Trello links use (its jj-settings.json says where in
// 1Password), so it sees boards they're only a guest on. `login` reads them from 1Password
// (one Touch ID) into the macOS Keychain; TRELLO_KEY and TRELLO_TOKEN win when set.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SERVICE = "claude-trello";
const API = "https://api.trello.com/1";
const USAGE = `usage: node trello.mjs <command>
  card <url|shortLink> [--images]   a card: description, checklists, comments, attachments
                                    (--images downloads image attachments and prints their paths)
  board <url|shortLink|name> [--list <name>] [--closed]
                                    a board's lists and their cards
  boards                            the open boards you're on, guest boards too
  search <words> [--board <url|shortLink|name>]
                                    cards matching the words (Trello's search syntax works)
  login                             read the key and token from 1Password into the Keychain`;

const [command, ...rest] = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--images" || rest[i] === "--closed") flags[rest[i].slice(2)] = true;
  else if (rest[i] === "--list" || rest[i] === "--board") flags[rest[i].slice(2)] = rest[++i];
  else args.push(rest[i]);
}

function keychain(account) {
  if (process.platform !== "darwin") return null;
  try {
    return execFileSync("security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

function credentials() {
  const key = process.env.TRELLO_KEY || keychain("key");
  const token = process.env.TRELLO_TOKEN || keychain("token");
  if (key && token) return { key, token };
  fail("Not logged in to Trello. Ask the person to run `! node ~/.claude/skills/trello/trello.mjs login` (one Touch ID).");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function get(path, { key, token } = credentials()) {
  const r = await fetch(`${API}/${path}`, { headers: { Authorization: `OAuth oauth_consumer_key="${key}", oauth_token="${token}"` } });
  if (r.status === 401 || r.status === 403) {
    const why = (await r.text()).trim();
    fail(/permission|unauthorized permission/i.test(why) ? "Your Trello member can't see that." : `Trello refused the key and token (${why || r.status}). Run login again.`);
  }
  if (r.status === 404) fail("Trello has no such card or board (or it was deleted).");
  if (!r.ok) fail(`Trello said ${r.status}: ${(await r.text()).trim().slice(0, 300)}`);
  return r.json();
}

const shortOf = (ref, kind) => ref.match(new RegExp(`trello\\.com/${kind}/([A-Za-z0-9]{8})`))?.[1] ?? (/^[A-Za-z0-9]{8}$|^[0-9a-f]{24}$/.test(ref) ? ref : null);
const day = (iso) => (iso ? iso.slice(0, 10) : "");
const indent = (text) => text.split("\n").map((l) => `> ${l}`).join("\n");

async function boardId(ref) {
  const short = shortOf(ref, "b");
  if (short) return short;
  const boards = await get("members/me/boards?filter=open&fields=name,shortLink");
  const hit = boards.find((b) => b.name.toLowerCase() === ref.toLowerCase()) ?? boards.find((b) => b.name.toLowerCase().includes(ref.toLowerCase()));
  if (!hit) fail(`No open board called "${ref}". \`boards\` lists them.`);
  return hit.shortLink;
}

async function download(url, path, auth) {
  const r = await fetch(url, { headers: auth ? { Authorization: auth } : {} });
  if (!r.ok) return null;
  writeFileSync(path, Buffer.from(await r.arrayBuffer()));
  return path;
}

async function card(ref) {
  const short = shortOf(ref ?? "", "c");
  if (!short) fail("Give a card's URL (trello.com/c/…) or its 8-character short link.");
  const creds = credentials();
  const c = await get(`cards/${short}?fields=name,desc,due,dueComplete,closed,labels,shortUrl,shortLink,idShort,dateLastActivity&list=true&list_fields=name&board=true&board_fields=name,url&members=true&member_fields=fullName,username&checklists=all&checklist_fields=name&attachments=true&attachment_fields=name,url,mimeType,bytes,isUpload,date&actions=commentCard&actions_limit=100&action_memberCreator_fields=fullName`, creds);
  const facts = [
    c.shortUrl,
    `${c.board?.name ?? "?"} › ${c.list?.name ?? "?"}`,
    `#${c.idShort}`,
    c.closed ? "archived" : null,
    c.due ? `due ${day(c.due)}${c.dueComplete ? " (done)" : ""}` : null,
    (c.labels ?? []).length ? `labels: ${c.labels.map((l) => l.name || l.color).join(", ")}` : null,
    (c.members ?? []).length ? `members: ${c.members.map((m) => m.fullName).join(", ")}` : null,
    `last activity ${day(c.dateLastActivity)}`,
  ].filter(Boolean);
  const out = [`# ${c.name}`, "", facts.join(" · "), "", "## Description", "", c.desc?.trim() || "_No description._"];
  for (const l of c.checklists ?? []) {
    out.push("", `## Checklist: ${l.name}`, "");
    for (const i of [...(l.checkItems ?? [])].sort((a, b) => a.pos - b.pos)) out.push(`- [${i.state === "complete" ? "x" : " "}] ${i.name}`);
  }
  const comments = [...(c.actions ?? [])].reverse();
  if (comments.length) {
    out.push("", `## Comments (${comments.length}, oldest first)`);
    for (const a of comments) out.push("", `**${a.memberCreator?.fullName ?? "?"}** · ${day(a.date)}`, "", indent(a.data?.text ?? ""));
  }
  const files = c.attachments ?? [];
  if (files.length) {
    out.push("", "## Attachments", "");
    const dir = join(homedir(), ".cache", "claude-trello", c.shortLink);
    const auth = `OAuth oauth_consumer_key="${creds.key}", oauth_token="${creds.token}"`;
    for (const [i, a] of files.entries()) {
      let line = `- ${a.name}${a.mimeType ? ` (${a.mimeType}${a.bytes ? `, ${Math.round(a.bytes / 1024)} KB` : ""})` : ""} ${a.url}`;
      if (flags.images && a.mimeType?.startsWith("image/")) {
        mkdirSync(dir, { recursive: true });
        const path = join(dir, `${i + 1}-${a.name.replace(/[^\w.-]+/g, "_")}`);
        const saved = existsSync(path) ? path : await download(a.url, path, a.isUpload ? auth : null);
        line += saved ? `\n  saved: ${saved}` : "\n  (couldn't download it)";
      }
      out.push(line);
    }
    if (!flags.images && files.some((a) => a.mimeType?.startsWith("image/"))) out.push("", "_Add --images to download the images and read them._");
  }
  console.log(out.join("\n"));
}

async function board(ref) {
  if (!ref) fail("Give a board's URL, short link or name.");
  const b = await get(`boards/${await boardId(ref)}?fields=name,url&lists=open&list_fields=name,pos&cards=${flags.closed ? "all" : "open"}&card_fields=name,idList,idShort,shortUrl,labels,due,dueComplete,idMembers,closed,pos&members=all&member_fields=fullName`);
  const people = Object.fromEntries((b.members ?? []).map((m) => [m.id, m.fullName]));
  const out = [`# ${b.name}`, "", b.url];
  for (const l of [...(b.lists ?? [])].sort((x, y) => x.pos - y.pos)) {
    if (flags.list && !l.name.toLowerCase().includes(flags.list.toLowerCase())) continue;
    const cards = (b.cards ?? []).filter((c) => c.idList === l.id).sort((x, y) => x.pos - y.pos);
    out.push("", `## ${l.name} (${cards.length})`, "");
    for (const c of cards) {
      const more = [
        (c.labels ?? []).map((x) => x.name || x.color).join(", "),
        (c.idMembers ?? []).map((m) => people[m]).filter(Boolean).join(", "),
        c.due ? `due ${day(c.due)}${c.dueComplete ? " (done)" : ""}` : "",
        c.closed ? "archived" : "",
      ].filter(Boolean);
      out.push(`- #${c.idShort} ${c.name}${more.length ? ` — ${more.join(" · ")}` : ""} ${c.shortUrl}`);
    }
  }
  console.log(out.join("\n"));
}

async function boards() {
  const list = await get("members/me/boards?filter=open&fields=name,url,dateLastActivity");
  for (const b of list.sort((x, y) => x.name.localeCompare(y.name))) console.log(`- ${b.name} ${b.url}`);
}

async function search(words) {
  if (!words) fail("Give some words to search for.");
  const scope = flags.board ? `&idBoards=${(await get(`boards/${await boardId(flags.board)}?fields=id`)).id}` : "";
  const r = await get(`search?query=${encodeURIComponent(words)}&modelTypes=cards&cards_limit=30&card_fields=name,shortUrl,idShort,closed,dateLastActivity&card_board=true&card_list=true${scope}`);
  if (!r.cards?.length) return console.log("No cards found.");
  for (const c of r.cards) console.log(`- ${c.name} — ${c.board?.name ?? "?"} › ${c.list?.name ?? "?"}${c.closed ? " · archived" : ""} · ${day(c.dateLastActivity)} ${c.shortUrl}`);
}

// The 1Password references Herdr's Trello links use (its spacing dialog's Links tab).
function refs() {
  const defaults = { account: "my.1password.com", key: "op://Private/Trello/key", token: "op://Private/Trello/token" };
  try {
    return { ...defaults, ...(JSON.parse(readFileSync(join(homedir(), ".config", "herdr-app", "jj-settings.json"), "utf8"))["jj-links"] ?? {}) };
  } catch {
    return defaults;
  }
}

async function login() {
  if (process.platform !== "darwin") fail("login keeps the key and token in the macOS Keychain; elsewhere set TRELLO_KEY and TRELLO_TOKEN.");
  const r = refs();
  let text;
  try {
    text = execFileSync("sh", ["-c", 'printf "{{ %s }}\\n{{ %s }}\\n" "$1" "$2" | op inject --account "$3"', "sh", r.key, r.token, r.account], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  } catch {
    fail(`1Password didn't give ${r.key} and ${r.token}.`);
  }
  const [key, token] = text.split("\n").map((s) => s.trim());
  if (!/^\w+$/.test(key ?? "") || !/^\w+$/.test(token ?? "")) fail("1Password gave something that isn't a Trello key and token.");
  const me = await get("members/me?fields=fullName,username", { key, token });
  execFileSync("security", ["-i"], { input: `add-generic-password -U -s ${SERVICE} -a key -w ${key}\nadd-generic-password -U -s ${SERVICE} -a token -w ${token}\n`, stdio: ["pipe", "ignore", "inherit"] });
  console.log(`Logged in to Trello as ${me.fullName} (@${me.username}); the key and token are in the Keychain as "${SERVICE}".`);
}

const commands = { card: () => card(args[0]), board: () => board(args.join(" ")), boards, search: () => search(args.join(" ")), login };
if (!commands[command]) fail(USAGE);
await commands[command]();
