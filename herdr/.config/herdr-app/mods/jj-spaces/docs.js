// Hand-made links and the Waiting mark, kept on the machine each space and agent lives
// on: herdr-core's `jj-links` document there, { spaces: { "<space id>": { links, hidden,
// waiting? } }, agents: { "<terminal address>": { links } } } with that machine's bare
// ids, so every screen sees and edits the same ones. Asked through `hc connect`; doc.set
// only writes over the version it was given.

import { exec } from "herdr";

const NAME = "jj-links";
let seq = 0;
let edits = 0;

// Counts the dialog's edits (copies share this module), so a sync that read before one
// doesn't put back what it changed.
export const edited = () => edits;

// [machine or null, the id there] of a space id or terminal address as this screen
// names it ("macwg/sp…", "macwg/t7").
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

// The first documents were only spaces' entries, at the top.
const shaped = (stored) => {
  const { spaces = {}, agents = {}, ...old } = stored ?? {};
  return { spaces: { ...old, ...spaces }, agents };
};

// The core keeps keys sorted: compared without their order.
export const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

// A document on a machine as stored (null when there's none yet) and its version.
export async function docOf(name, on) {
  const r = await call("doc.get", { name }, on);
  return { value: r.value ?? null, version: r.version };
}

// Writes `update(doc)` (a fresh copy of `shape(stored)` to change) over the machine's
// document, reading it again when another screen wrote in between. The document as it now is.
export async function updateDoc(name, on, shape, update) {
  let failed;
  for (let i = 0; i < 3; i++) {
    const { value: stored, version } = await docOf(name, on);
    const value = shape(stored);
    const next = update(JSON.parse(JSON.stringify(value)));
    if (canon(next) === canon(stored ?? value)) return next;
    try {
      await call("doc.set", { name, value: next, version }, on);
      return next;
    } catch (e) {
      failed = e;
    }
  }
  throw failed;
}

export async function linksOf(on) {
  const { value, version } = await docOf(NAME, on);
  return { value: shaped(value), version, stored: value };
}

export const updateLinks = (on, update) => updateDoc(NAME, on, shaped, update);

// A space's { links, hidden, waiting } ({ space: id }) or an agent's { links }
// ({ agent: address }) through `change`; one with nothing left is left out.
export async function editLinks(target, change) {
  const kind = target.agent ? "agents" : "spaces";
  const [on, bare] = split(target.agent ?? target.space);
  edits++;
  try {
    return await updateLinks(on, (doc) => {
      const was = doc[kind][bare];
      const entry = change({ links: was?.links ?? [], hidden: was?.hidden ?? [], waiting: Boolean(was?.waiting) });
      if (!entry.links.length && !entry.hidden?.length && !entry.waiting) delete doc[kind][bare];
      else if (kind === "agents") doc[kind][bare] = { links: entry.links };
      else doc[kind][bare] = { links: entry.links, hidden: entry.hidden ?? [], ...(entry.waiting && { waiting: true }) };
      return doc;
    });
  } finally {
    edits++;
  }
}

export const setWaiting = (id, waiting) => editLinks({ space: id }, (e) => ({ ...e, waiting }));
