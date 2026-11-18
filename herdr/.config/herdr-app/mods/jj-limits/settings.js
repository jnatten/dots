// Two files beside the layout, mirrored into shared(), where the mods read and write them:
// - jj-settings.json (in dots, so shared between machines): the spacing dialog's settings
//   that aren't in the layout (hints, links, the hidden title bar, space branches, agent
//   descriptions). The file wins at start and whenever it changes on disk (a pull); changes
//   made here are written back.
// - jj-state.json (this Mac's, linked into each window's home by new-window.sh): what
//   every window on this Mac shows alike (space colors, archived sessions, folded folders). A key it
//   doesn't have yet is taken from the window that looks first, and an emptied one is
//   kept, so a window coming back can't bring old values with it.
// Without a file (dots not stowed there yet, no second window yet) it isn't synced.

import { appHome, readTextFile, writeTextFile, shared, setShared } from "herdr";

const FILES = [
  { name: "jj-settings.json", keys: ["jj-copy.hints", "jj-links", "jj-spacing.header", "jj-agents", "jj-spaces"], fill: false, keepEmpty: false },
  { name: "jj-state.json", keys: ["space.colors", "jj-sessions.archived", "space-folders.folded"], fill: true, keepEmpty: true },
];

const empty = (v) => v == null || (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
const same = (a, b) => (empty(a) && empty(b)) || JSON.stringify(a) === JSON.stringify(b);

export function syncSettings(cx) {
  for (const f of FILES) syncFile(cx, f);
}

function syncFile(cx, { name, keys, fill, keepEmpty }) {
  const file = `${appHome()}/${name}`;
  const kept = (v) => (keepEmpty ? v != null : !empty(v));
  const textOf = () => JSON.stringify(Object.fromEntries(keys.filter((k) => kept(shared(k))).map((k) => [k, shared(k)])), null, 2) + "\n";
  let disk = null; // the file's text as last read or written
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const raw = await readTextFile(file);
      if (raw !== null && raw !== disk) {
        // Unreadable (a merge conflict): left alone, and nothing is written over it.
        const data = JSON.parse(raw);
        for (const k of keys) {
          if (fill && disk === null && !(k in data)) continue;
          if (!same(shared(k), data[k])) setShared(k, data[k] ?? null);
        }
        disk = raw;
      } else if (raw !== null) {
        const text = textOf();
        if (text !== disk) {
          await writeTextFile(file, text, disk);
          disk = text;
        }
      }
    } catch {}
    busy = false;
  };
  cx.spawn(tick);
  cx.timer.every(2000, (cx) => cx.spawn(tick));
}
