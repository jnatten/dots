// The spacing dialog's settings that aren't in the layout (hints, links, the hidden
// title bar), kept in jj-settings.json beside it so dots can share them between
// machines. Mirrored into shared(), where the mods read and write them: the file
// wins at start and whenever it changes on disk (a pull), and changes made here are
// written back. Without the file (dots not stowed there yet) nothing is synced.

import { appHome, readTextFile, writeTextFile, shared, setShared } from "herdr";

const KEYS = ["jj-copy.hints", "jj-links", "jj-spacing.header"];

const empty = (v) => v == null || (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
const same = (a, b) => (empty(a) && empty(b)) || JSON.stringify(a) === JSON.stringify(b);
const textOf = () => JSON.stringify(Object.fromEntries(KEYS.filter((k) => !empty(shared(k))).map((k) => [k, shared(k)])), null, 2) + "\n";

export function syncSettings(cx) {
  const file = `${appHome()}/jj-settings.json`;
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
        for (const k of KEYS) if (!same(shared(k), data[k])) setShared(k, data[k] ?? null);
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
