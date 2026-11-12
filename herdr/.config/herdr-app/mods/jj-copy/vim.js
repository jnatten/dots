// Vim motions over an array of lines. A position is { row, col }; the column one
// past a line's end stands for its line break, which counts as whitespace.

const at = (lines, p) => (p.col < lines[p.row].length ? lines[p.row][p.col] : "\n");
const kind = (ch) => (/\s/.test(ch) ? 0 : /\w/.test(ch) ? 1 : 2);
const fwd = (lines, p) => (p.col < lines[p.row].length ? { row: p.row, col: p.col + 1 } : p.row + 1 < lines.length ? { row: p.row + 1, col: 0 } : null);
const back = (lines, p) => (p.col > 0 ? { row: p.row, col: p.col - 1 } : p.row > 0 ? { row: p.row - 1, col: lines[p.row - 1].length } : null);
const blank = (lines, p) => lines[p.row].length === 0;

export const lastCol = (lines, row) => Math.max(0, lines[row].length - 1);
export const clamp = (lines, p) => ({ row: p.row, col: Math.max(0, Math.min(p.col, lastCol(lines, p.row))) });
export const firstNonBlank = (line) => Math.max(0, line.search(/\S/));

export function wordForward(lines, p) {
  let q = p;
  const k = kind(at(lines, q));
  if (k) {
    for (;;) {
      const n = fwd(lines, q);
      if (!n) return clamp(lines, q);
      q = n;
      if (kind(at(lines, q)) !== k) break;
    }
  }
  while (kind(at(lines, q)) === 0) {
    if (blank(lines, q) && q.row !== p.row) return q;
    const n = fwd(lines, q);
    if (!n) return clamp(lines, q);
    q = n;
  }
  return q;
}

export function wordBackward(lines, p) {
  let q = back(lines, p);
  if (!q) return p;
  while (kind(at(lines, q)) === 0) {
    if (blank(lines, q) && q.row !== p.row) return q;
    const b = back(lines, q);
    if (!b) return clamp(lines, q);
    q = b;
  }
  const k = kind(at(lines, q));
  for (let b = back(lines, q); b && kind(at(lines, b)) === k; b = back(lines, q)) q = b;
  return q;
}

export function wordEnd(lines, p) {
  let q = fwd(lines, p);
  if (!q) return p;
  while (kind(at(lines, q)) === 0) {
    const n = fwd(lines, q);
    if (!n) return clamp(lines, q);
    q = n;
  }
  const k = kind(at(lines, q));
  for (let n = fwd(lines, q); n && kind(at(lines, n)) === k; n = fwd(lines, q)) q = n;
  return q;
}

const before = (a, b) => a.row < b.row || (a.row === b.row && a.col <= b.col);
export const ordered = (a, b) => (before(a, b) ? [a, b] : [b, a]);

// The text from a to b, both ends included; whole lines when `linewise`, without a final line break.
export function selection(lines, a, b, linewise) {
  const [s, e] = ordered(a, b);
  if (linewise) return lines.slice(s.row, e.row + 1).join("\n");
  if (s.row === e.row) return lines[s.row].slice(s.col, e.col + 1);
  return [lines[s.row].slice(s.col), ...lines.slice(s.row + 1, e.row), lines[e.row].slice(0, e.col + 1)].join("\n");
}

// Smart case, as vim's ignorecase + smartcase: lowercase queries match any case.
const fold = (query) => (query === query.toLowerCase() ? (s) => s.toLowerCase() : (s) => s);

// The next match after `from` (dir 1) or before it (dir -1), wrapping around; null when none.
export function search(lines, from, query, dir) {
  if (!query || !lines.length) return null;
  const f = fold(query);
  const q = f(query);
  const n = lines.length;
  for (let i = 0; i <= n; i++) {
    const row = (((from.row + dir * i) % n) + n) % n;
    const line = f(lines[row]);
    let col;
    if (dir > 0) col = i === 0 ? line.indexOf(q, from.col + 1) : line.indexOf(q);
    else col = i === 0 ? (from.col > 0 ? line.lastIndexOf(q, from.col - 1) : -1) : line.lastIndexOf(q);
    if (i === n && col !== -1 && (dir > 0 ? col > from.col : col < from.col)) col = -1;
    if (col !== -1) return { row, col };
  }
  return null;
}

// Where `query` matches in one line: [start, end) pairs.
export function matches(line, query) {
  if (!query) return [];
  const f = fold(query);
  const hay = f(line);
  const q = f(query);
  const out = [];
  for (let i = hay.indexOf(q); i !== -1; i = hay.indexOf(q, i + Math.max(1, q.length))) out.push([i, i + q.length]);
  return out;
}
