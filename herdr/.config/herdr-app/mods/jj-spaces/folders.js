// Folders in the spaces list, kept in herdr-core's `jj-folders` document on every
// machine: { folders: { id: { name, color, rank, at, gone? } } (the same everywhere,
// the newest `at` wins), paths: { id: [where the folder is on this machine] },
// spaces: { this machine's space id: folder id, or "" for Other } (spaces moved by hand) }.
// Machines go by key here: "" for this computer, else their name.
//
// A folder on a machine without paths of its own is where it is on another machine,
// moved to this one's home: ~/dev/ndla/ndla on both, whoever's home that is.

import { docOf, updateDoc } from "./docs.js";

const NAME = "jj-folders";

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
export const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

export const empty = () => ({ folders: {}, paths: {}, pins: {} });
const shaped = (v) => ({ folders: v?.folders ?? {}, paths: v?.paths ?? {}, spaces: v?.spaces ?? {} });
export const foldersOf = async (on) => shaped((await docOf(NAME, on)).value);
export const updateFolders = (on, update) => updateDoc(NAME, on, shaped, update);

export const trim = (path) => (path.length > 1 ? path.replace(/\/+$/, "") : path);
export const under = (path, dir) => path === dir || path.startsWith(dir === "/" ? "/" : `${dir}/`);
export const base = (path) => trim(path).split("/").pop();

// "~/x" with that machine's home; null when it isn't known yet.
export function expand(text, home) {
  const s = trim(text.trim());
  if (s !== "~" && !s.startsWith("~/")) return s;
  return home ? trim(home + s.slice(1)) : null;
}

export const tilde = (path, home) => (home && under(path, home) ? `~${path.slice(home.length)}` : path);

const newer = (a, b) => !b || (a.at ?? 0) > (b.at ?? 0);

// The folders shown, by rank.
export function live(state) {
  return Object.entries(state.folders)
    .filter(([, f]) => !f.gone)
    .sort(([, a], [, b]) => (a.rank ?? 0) - (b.rank ?? 0) || (a.name ?? "").localeCompare(b.name ?? ""))
    .map(([id, f]) => ({ id, ...f }));
}

export const nextRank = (state) => Math.max(0, ...Object.values(state.folders).map((f) => f.rank ?? 0)) + 1;

// A folder's own paths on machine `key` (the first documents kept one, not a list).
export const ownPaths = (state, id, key) => {
  const v = state.paths[key]?.[id];
  return Array.isArray(v) ? v : v ? [v] : [];
};

// Where folder `id` is on machine `key`: its own paths there, else another machine's
// (this computer's first) moved to this one's home. { paths, own } or null.
export function pathsOn(state, id, key, homes) {
  const own = ownPaths(state, id, key);
  if (own.length) return { paths: own, own: true };
  const others = Object.keys(state.paths)
    .filter((k) => k !== key && ownPaths(state, id, k).length)
    .sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  for (const k of others) {
    const from = homes[k];
    if (!from) continue;
    const paths = ownPaths(state, id, k)
      .map((path) => (!under(path, from) ? path : homes[key] ? trim(homes[key] + path.slice(from.length)) : null))
      .filter(Boolean);
    if (paths.length) return { paths, own: false };
  }
  return null;
}

// The deepest folder whose path on machine `key` holds one of `places` (a space's
// folder now, its repo's root).
export function matchOf(state, homes, key, places) {
  let best = null;
  let depth = -1;
  for (const f of live(state)) {
    for (const path of pathsOn(state, f.id, key, homes)?.paths ?? []) {
      if (path.length > depth && places.some((p) => p && under(p, path))) {
        best = f.id;
        depth = path.length;
      }
    }
  }
  return best;
}

// The folder a space is in: where it was moved by hand, else by its path. null: Other.
export function folderOf(state, homes, key, bare, places) {
  const pin = state.pins[key]?.[bare];
  if (pin === "") return null;
  if (pin && state.folders[pin] && !state.folders[pin].gone) return pin;
  return matchOf(state, homes, key, places);
}

// A change: { kind: "folder", id, rec } (every machine), { kind: "path", key, id, paths }
// or { kind: "pin", key, bare, folder } (that machine; no paths, null folder: none).
export function applyChange(state, c) {
  if (c.kind === "folder") {
    state.folders[c.id] = c.rec;
    if (c.rec.gone) {
      for (const paths of Object.values(state.paths)) delete paths[c.id];
      for (const pins of Object.values(state.pins)) for (const [bare, id] of Object.entries(pins)) if (id === c.id) delete pins[bare];
    }
  } else if (c.kind === "path") {
    const paths = (state.paths[c.key] = { ...state.paths[c.key] });
    if (c.paths?.length) paths[c.id] = c.paths;
    else delete paths[c.id];
  } else if (c.kind === "pin") {
    const pins = (state.pins[c.key] = { ...state.pins[c.key] });
    if (c.folder === null) delete pins[c.bare];
    else pins[c.bare] = c.folder;
  }
  return state;
}

export function writeChange(doc, c) {
  if (c.kind === "folder") {
    if (newer(c.rec, doc.folders[c.id])) doc.folders[c.id] = c.rec;
  } else if (c.kind === "path") {
    if (c.paths?.length) doc.paths[c.id] = c.paths;
    else delete doc.paths[c.id];
  } else if (c.kind === "pin") {
    if (c.folder === null) delete doc.spaces[c.bare];
    else doc.spaces[c.bare] = c.folder;
  }
  return doc;
}

// A machine's document brought up to date: the newest of every folder, without paths
// and pins of folders that are gone, or pins of spaces in `drop`.
export function tidy(doc, folders, drop = new Set()) {
  for (const [id, f] of Object.entries(folders)) if (newer(f, doc.folders[id])) doc.folders[id] = f;
  const gone = (id) => !doc.folders[id] || doc.folders[id].gone;
  for (const id of Object.keys(doc.paths)) if (gone(id)) delete doc.paths[id];
  for (const [bare, id] of Object.entries(doc.spaces)) if ((id && gone(id)) || drop.has(bare)) delete doc.spaces[bare];
  return doc;
}

// What every machine read says, over what was known (`prev`) of those not read.
export function merge(docs, prev) {
  const folders = { ...prev.folders };
  for (const doc of Object.values(docs)) for (const [id, f] of Object.entries(doc.folders)) if (newer(f, folders[id])) folders[id] = f;
  const paths = { ...prev.paths };
  const pins = { ...prev.pins };
  for (const [key, doc] of Object.entries(docs)) {
    paths[key] = doc.paths;
    pins[key] = doc.spaces;
  }
  return { folders, paths, pins };
}
