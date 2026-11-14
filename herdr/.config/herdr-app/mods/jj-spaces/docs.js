// Hand-made links, kept on the machine each space lives on: herdr-core's `jj-links`
// document there, { "<space id>": { links: [url], hidden: [url] } } with that machine's
// bare ids, so every screen showing a space sees and edits the same ones. Asked through
// `hc connect`; doc.set only writes over the version it was given.

import { exec } from "herdr";

const NAME = "jj-links";
let seq = 0;
let edits = 0;

// Counts the dialog's edits (copies share this module), so a sync that read before one
// doesn't put back what it changed.
export const edited = () => edits;

// [machine or null, the id there] of a space id as this screen names it ("macwg/sp…").
export const split = (id) => {
  const at = id.indexOf("/");
  return at === -1 ? [null, id] : [id.slice(0, at), id.slice(at + 1)];
};

async function call(method, params, on) {
  const req = { jsonrpc: "2.0", id: ++seq, method, params: on ? { ...params, on } : params };
  const r = await exec("sh", ["-c", 'printf "%s\\n" "$1" | hc connect', "sh", JSON.stringify(req)], { timeout: 20000 });
  let reply = null;
  for (const line of r.stdout.split("\n")) {
    try {
      const msg = JSON.parse(line);
      if (msg.id === req.id) reply = msg;
    } catch {}
  }
  if (!reply) throw new Error((r.stderr || "hc connect gave no answer").trim());
  if (reply.error) throw new Error(reply.error.message ?? JSON.stringify(reply.error));
  return reply.result;
}

export async function linksOf(on) {
  const r = await call("doc.get", { name: NAME }, on);
  return { value: r.value ?? {}, version: r.version };
}

// Writes `update(doc)` (a fresh copy to change) over the machine's document, reading it
// again when another screen wrote in between. The document as it now is.
export async function updateLinks(on, update) {
  let failed;
  for (let i = 0; i < 3; i++) {
    const { value, version } = await linksOf(on);
    const next = update(JSON.parse(JSON.stringify(value)));
    if (JSON.stringify(next) === JSON.stringify(value)) return value;
    try {
      await call("doc.set", { name: NAME, value: next, version }, on);
      return next;
    } catch (e) {
      failed = e;
    }
  }
  throw failed;
}

// One space's { links, hidden } through `change`; a space with neither is left out.
export async function editLinks(id, change) {
  const [on, bare] = split(id);
  edits++;
  try {
    return await updateLinks(on, (doc) => {
      const entry = change({ links: doc[bare]?.links ?? [], hidden: doc[bare]?.hidden ?? [] });
      if (entry.links.length || entry.hidden.length) doc[bare] = entry;
      else delete doc[bare];
      return doc;
    });
  } finally {
    edits++;
  }
}
