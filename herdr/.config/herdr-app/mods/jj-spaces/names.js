// Names for the spaces and tabs nobody named (the Names pref "auto", from the spacing dialog's
// Sidebar tab), shown in place of Herdr's by this sidebar and, through shared("names")
// { spaces: {id: name}, tabs: {id: name} }, by the tab bar, the agents list, the space pickers
// and the session search. Herdr's own names are left alone: a name given by hand wins.
// A space is called after its git worktree's or jj workspace's folder, else its branch, without a trailing hash; a tab
// after its panes' programs.

import { shared, setShared } from "herdr";
import { branchName } from "./github.js";

const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Without a trailing hash: "pr-353-review-f67c2b" → "pr-353-review".
const tidy = (name) => name.replace(/-(?=[0-9a-f]*\d)[0-9a-f]{6,}(-\d+)?$/, "") || name;

// A branch or jj bookmark label as a name: its last segment, without a trailing hash
// ("claude/feide-id-token-pr-review-996f37-399" → "feide-id-token-pr-review"); null for main and
// the like, and for jj's generated push-<change id> bookmarks.
export function branchTitle(label) {
  const b = branchName(label);
  if (!b || b === "trunk" || b === "HEAD") return null;
  const last = b.split("/").pop();
  if (/^push-[k-z]{8,}$/.test(last)) return null;
  return tidy(last);
}

// `g`: the sidebar's git facts for the space's first terminal, or null.
export function spaceName(w, g) {
  if (w.named || !g) return null;
  const folder = g.workspace ?? (g.linked ? g.top : null);
  return folder ? tidy(base(folder)) : branchTitle(g.branch);
}

// Its panes' programs in order, repeats counted: "Claude Code | fish ×2".
export function tabName(tab, ps) {
  if (tab.named) return null;
  const parts = [];
  for (const p of ps) {
    if (p.tab !== tab.id) continue;
    const name = p.terminal ? p.program?.name || p.title : p.title || p.mod;
    if (!name) continue;
    const seen = parts.find((x) => x.name === name);
    if (seen) seen.n++;
    else parts.push({ name, n: 1 });
  }
  return parts.map(({ name, n }) => (n > 1 ? `${name} ×${n}` : name)).join(" | ") || null;
}

// Works them out for every space and tab, shares them, and returns them; none when `on` is false.
export function publishNames(sp, ps, gitOf, on) {
  const names = { spaces: {}, tabs: {} };
  if (on) {
    for (const w of sp) {
      const s = spaceName(w, gitOf(w));
      if (s) names.spaces[w.id] = s;
      for (const tab of w.tabs ?? []) {
        const n = tabName(tab, ps);
        if (n) names.tabs[tab.id] = n;
      }
    }
  }
  if (JSON.stringify(names) !== JSON.stringify(shared("names") ?? {})) setShared("names", names);
  return names;
}
