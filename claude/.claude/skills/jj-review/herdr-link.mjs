// Links a URL (a GitHub PR or issue, a Trello card) to the agent in this terminal, as
// the link dialog does; Herdr shows it on the agent and on its space. Kept in
// herdr-core's `jj-links` document on this machine (herdr/.config/herdr-app/mods/
// jj-spaces/docs.js in dots). Outside Herdr it does nothing.
import { execFileSync } from "node:child_process";

const url = process.argv[2];
if (!url) {
  console.error("usage: node herdr-link.mjs <url>");
  process.exit(2);
}
const terminal = process.env.HC_TERMINAL_ID;
if (!terminal) {
  console.log("Not in a Herdr terminal: nothing linked.");
  process.exit(0);
}
const labels = JSON.parse(execFileSync("hc", ["get", terminal, "--json"], { encoding: "utf8" })).labels ?? {};
if (!labels["herdr.space"]) {
  console.log(`${terminal} isn't in a Herdr space: nothing linked.`);
  process.exit(0);
}

let seq = 0;
function call(method, params) {
  const id = ++seq;
  const out = execFileSync("hc", ["connect"], { input: `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, encoding: "utf8" });
  const reply = out.split("\n").map((line) => { try { return JSON.parse(line); } catch { return null; } }).find((m) => m?.id === id);
  if (!reply) throw new Error("hc connect gave no answer");
  if (reply.error) throw new Error(reply.error.message ?? JSON.stringify(reply.error));
  return reply.result;
}

// doc.set only writes over the version read; another screen may write in between.
for (let tries = 1; ; tries++) {
  const { value, version } = call("doc.get", { name: "jj-links" });
  // The first documents were only spaces' entries, at the top.
  const { spaces = {}, agents = {}, ...old } = value ?? {};
  const doc = { spaces: { ...old, ...spaces }, agents };
  const links = doc.agents[terminal]?.links ?? [];
  if (links.includes(url)) {
    console.log(`Already linked to this agent (${labels.where ?? terminal}).`);
    break;
  }
  doc.agents[terminal] = { links: [...links, url] };
  try {
    call("doc.set", { name: "jj-links", value: doc, version });
    console.log(`Linked ${url} to this agent (${labels.where ?? terminal}).`);
    break;
  } catch (e) {
    if (tries === 3) throw e;
  }
}
