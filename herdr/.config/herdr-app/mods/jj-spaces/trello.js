// Trello cards for the sidebar: board, list and name, asked of Trello's API with a
// key and token read from 1Password (`op`) once per Herdr run and kept only in memory.
// What to link and where the key and token are: shared("jj-links"), set in the
// spacing dialog's Links tab (jj-spacing keeps a copy of DEFAULTS).

import { exec } from "herdr";
import { unknown } from "./github.js";

export const DEFAULTS = { related: true, trello: true, account: "my.1password.com", key: "op://Private/Trello/key", token: "op://Private/Trello/token" };
export const linkSettings = (s) => ({ ...DEFAULTS, ...(s ?? {}) });
export const refsOf = (cfg) => JSON.stringify([cfg.account, cfg.key, cfg.token]);

let auth = null; // { refs, key, token }

// 1Password's own failure (locked, denied, no such item): asking again only asks
// for Touch ID again, so the sidebar waits to be told to.
export class OpError extends Error {}

async function credentials(cfg) {
  const refs = refsOf(cfg);
  if (auth?.refs === refs) return auth;
  // One op for both, so at most one Touch ID prompt.
  const r = await exec("sh", ["-c", 'printf "{{ %s }}\\n{{ %s }}\\n" "$1" "$2" | op inject --account "$3"', "sh", cfg.key, cfg.token, cfg.account], { timeout: 120000 })
    .catch((e) => { throw new OpError(`Couldn't run op: ${e?.message ?? e}`); });
  if (r.code !== 0) throw new OpError((r.stderr || r.stdout).trim().replace(/^\[ERROR\] \S+ \S+ /, "") || "op failed.");
  const [key, token] = r.stdout.split("\n").map((s) => s.trim());
  if (!key || !token) throw new OpError("1Password gave an empty key or token.");
  auth = { refs, key, token };
  return auth;
}

// Each card's state. Throws OpError when 1Password won't say, or Trello refuses
// the key and token; anything else (offline) throws plainly.
export async function fetchCards(urls, cfg) {
  const { key, token } = await credentials(cfg);
  const headers = { Authorization: `OAuth oauth_consumer_key="${key}", oauth_token="${token}"` };
  const at = Date.now();
  const items = {};
  for (const url of urls) {
    const short = url.split("/").pop();
    const r = await fetch(`https://api.trello.com/1/cards/${short}?fields=name,closed,dueComplete,idShort&board=true&board_fields=name&list=true&list_fields=name`, { headers });
    if (r.status === 401) {
      const why = (await r.text()).trim();
      // A board this token's member can't see: only that card stays unknown.
      if (/permission/i.test(why)) {
        items[url] = unknown(url, at);
        continue;
      }
      auth = null;
      throw new OpError(`Trello refused the key and token: ${why || "401"}. The token comes from trello.com/1/authorize with the key, not the app's secret.`);
    }
    if (!r.ok) {
      items[url] = unknown(url, at);
      continue;
    }
    const c = await r.json();
    items[url] = {
      kind: "trello", url, repo: c.board?.name ?? "", list: c.list?.name ?? "", number: c.idShort ?? null, title: c.name ?? "",
      state: c.closed ? "trello-archived" : c.dueComplete ? "trello-done" : "trello-open", at,
    };
  }
  return items;
}
