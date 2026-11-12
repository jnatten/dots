// A terminal pane's screen and history, with the keyboard. Opened as an overlay
// with props { action, terminal }: "copy" (a vim-style copy mode) or "nvim" (opens
// the text in Neovim as a peek over the tab, then closes; { colors } keeps colours).

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, theme, settings, terminals, run, exec, hc, appHome, notify, closeOverlay } from "herdr";
import * as vim from "./vim.js";

const HISTORY = "100000";
const sleep = (cx, ms) => new Promise((resolve) => cx.timer.after(ms, () => resolve()));

// Neovim, found once through the login shell's PATH.
let nvim = null;
const neovim = async () => (nvim ??= (await exec("sh", ["-lc", "command -v nvim"])).stdout.trim() || "nvim");

// The temp file each way of reading the pane writes, and how Neovim shows it. Plain
// is `hc read`'s text, read-only. Coloured is capture.py's output through
// `:terminal cat`, as tmux's capture-and-edit did, ending at the last line of output.
const WAYS = {
  plain: {
    write: 'hc read "$1" --lines "$3" --json | jq -r .text >"$f"',
    show: '"$2" -R -n "+normal G" "+call search(\'\\S\', \'bcW\')" "$1"; rm -f "$1"',
  },
  colors: {
    write: 'python3 -I "$2" "$1" "$f" "$3"',
    show: '"$2" -n -c "autocmd TermClose * ++once execute \'normal! G\' | call search(\'^\\[Process exited\', \'bW\') | call search(\'\\S\', \'bW\') | normal! 0" -c "terminal cat $1"; rm -f "$1"',
  },
};

// The pane's text in a temp file, open in Neovim in the pane's folder as a peek over
// the tab. The peek closes when Neovim quits, and the temp file goes with it.
async function capture(cx, terminal, cwd, colors) {
  const way = WAYS[colors ? "colors" : "plain"];
  const helper = `${appHome()}/mods/jj-copy/capture.py`;
  const file = await exec("sh", ["-c", `f=$(mktemp "\${TMPDIR:-/tmp}/herdr-capture.XXXXXX") && ${way.write} && printf %s "$f"`, "sh", terminal, helper, HISTORY], { timeout: 60000 });
  const path = (file.stdout ?? "").trim();
  if (file.code !== 0 || !path) throw new Error((file.stderr || "couldn't read the pane").trim());
  const here = cwd && (await exec("test", ["-d", cwd])).code === 0 ? ["--cwd", cwd] : [];
  const r = await exec("hc", ["run", "--json", "--bg", "--rm", "--no-parent", ...here, "--", "sh", "-c", way.show, "sh", path, await neovim()]);
  let address = null;
  try {
    address = r.code === 0 ? JSON.parse(r.stdout).address : null;
  } catch {}
  if (!address) throw new Error((r.stderr || r.stdout || "hc run failed").trim());
  for (let waited = 0; waited < 3000 && !terminals().some((x) => x.address === address); waited += 25) await sleep(cx, 25);
  run("terminal.peek", { terminal: address });
}

export default class Copy extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.action = p.action ?? "copy";
    if (this.action === "nvim") {
      cx.spawn(async (cx) => {
        try {
          await capture(cx, p.terminal, p.cwd, Boolean(p.colors));
        } catch (error) {
          notify({ title: "Couldn't open the pane in Neovim", body: String(error?.message ?? error), level: "error" });
        }
        closeOverlay(p.overlay);
      });
      return;
    }
    if (this.action !== "copy") return;
    this.lines = null;
    this.error = "";
    this.cur = { row: 0, col: 0 };
    this.want = 0;
    this.anchor = null;
    this.mode = null; // "char" | "line" while selecting
    this.top = 0;
    this.left = 0;
    this.rows = 20;
    this.cols = 120;
    this.count = "";
    this.pending = "";
    this.query = "";
    this.dir = 1;
    this.searching = 0;
    this.message = "";
    this.wheel = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.input = InputState.new({ placeholder: "search" });
    this.input.on("submit", (_e, cx) => {
      this.query = this.input.value();
      this.searching = 0;
      this.handle.focus();
      this.find(this.dir, cx);
    });
    cx.spawn(async (cx) => {
      const r = await hc(["read", p.terminal, "--lines", HISTORY, "--json"]);
      let text = "";
      try {
        text = r.code === 0 ? JSON.parse(r.stdout).text.replace(/\s+$/, "") : "";
      } catch {}
      this.lines = text.split("\n").map((l) => l.replace(/\s+$/, ""));
      if (r.code !== 0) this.error = (r.stderr || "hc read failed").trim();
      this.cur = { row: this.lines.length - 1, col: 0 };
      this.reveal();
      cx.notify();
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  reveal() {
    const { row, col } = this.cur;
    if (row < this.top) this.top = row;
    if (row >= this.top + this.rows) this.top = row - this.rows + 1;
    this.top = Math.max(0, Math.min(this.top, this.lines.length - this.rows));
    if (col < this.left) this.left = col;
    if (col >= this.left + this.cols) this.left = col - this.cols + 1;
  }

  go(row, col, vertical) {
    const r = Math.max(0, Math.min(row, this.lines.length - 1));
    this.cur = vim.clamp(this.lines, { row: r, col: vertical ? this.want : col });
    if (!vertical) this.want = this.cur.col;
    this.reveal();
  }

  find(dir, cx) {
    const hit = vim.search(this.lines, this.cur, this.query, dir);
    if (hit) this.go(hit.row, hit.col, false);
    this.message = hit ? "" : `Not found: ${this.query}`;
    cx.notify();
  }

  yank(cx) {
    const text = this.anchor ? vim.selection(this.lines, this.anchor, this.cur, this.mode === "line") : this.lines[this.cur.row];
    cx.write_to_clipboard(text);
    const n = text.split("\n").length;
    notify({ title: "Copied", body: n > 1 ? `${n} lines` : `${text.length} characters` });
    this.close();
  }

  key(e, cx) {
    if (!this.lines) return e.key === "escape" && this.close();
    if (this.searching) {
      if (e.key === "escape") {
        this.searching = 0;
        this.handle.focus();
        cx.stop_propagation();
        cx.notify();
      }
      return;
    }
    const m = e.modifiers;
    if (m.platform) return;
    const ctrl = m.control && !m.alt;
    const k = !ctrl && /^[!-~]$/.test(e.key_char ?? "") ? e.key_char : e.key;
    if (!ctrl && /^[0-9]$/.test(k) && (k !== "0" || this.count)) {
      this.count += k;
      cx.stop_propagation();
      return cx.notify();
    }
    const n = Math.max(1, parseInt(this.count || "1", 10));
    const counted = this.count !== "";
    const pending = this.pending;
    this.count = "";
    this.pending = "";
    this.message = "";
    const { row, col } = this.cur;
    const half = Math.max(1, Math.floor(this.rows / 2));
    const repeat = (f) => {
      let p = this.cur;
      for (let i = 0; i < n; i++) p = f(this.lines, p);
      this.go(p.row, p.col, false);
    };
    const select = (mode) => {
      if (this.mode === mode) {
        this.mode = null;
        this.anchor = null;
      } else {
        this.mode = mode;
        this.anchor ??= { ...this.cur };
      }
    };
    if (ctrl) {
      if (k === "d") (this.top += half), this.go(row + half, col, true);
      else if (k === "u") (this.top = Math.max(0, this.top - half)), this.go(row - half, col, true);
      else if (k === "f") (this.top += this.rows), this.go(row + this.rows, col, true);
      else if (k === "b") (this.top = Math.max(0, this.top - this.rows)), this.go(row - this.rows, col, true);
      else if (k === "j" || k === "n") this.go(row + 5 * n, col, true);
      else if (k === "k" || k === "p") this.go(row - 5 * n, col, true);
      else if (k === "c") this.close();
      else return;
    } else if (k === "j" || k === "down") this.go(row + n, col, true);
    else if (k === "k" || k === "up") this.go(row - n, col, true);
    else if (k === "h" || k === "left") this.go(row, col - n, false);
    else if (k === "l" || k === "right") this.go(row, col + n, false);
    else if (k === "w") repeat(vim.wordForward);
    else if (k === "b") repeat(vim.wordBackward);
    else if (k === "e") repeat(vim.wordEnd);
    else if (k === "0" || k === "home") this.go(row, 0, false);
    else if (k === "^") this.go(row, vim.firstNonBlank(this.lines[row]), false);
    else if (k === "$" || k === "end") (this.go(row, Infinity, false), (this.want = Infinity));
    else if (k === "g") {
      if (pending !== "g") this.pending = "g";
      else this.go(counted ? n - 1 : 0, 0, false);
    } else if (k === "G") this.go(counted ? n - 1 : this.lines.length - 1, 0, false);
    else if (k === "H") this.go(this.top, col, true);
    else if (k === "M") this.go(this.top + Math.floor(Math.min(this.rows, this.lines.length - this.top) / 2), col, true);
    else if (k === "L") this.go(Math.min(this.top + this.rows, this.lines.length) - 1, col, true);
    else if (k === "pagedown") (this.top += this.rows), this.go(row + this.rows, col, true);
    else if (k === "pageup") (this.top = Math.max(0, this.top - this.rows)), this.go(row - this.rows, col, true);
    else if (k === "v") select("char");
    else if (k === "V") select("line");
    else if (k === "o" && this.anchor) [this.anchor, this.cur] = [this.cur, this.anchor];
    else if (k === "y" || k === "enter") return this.yank(cx);
    else if (k === "/" || k === "?") {
      this.dir = k === "/" ? 1 : -1;
      this.searching = this.dir;
      this.input.set_value("");
      this.input.focus();
    } else if (k === "n" && this.query) return this.find(this.dir, cx);
    else if (k === "N" && this.query) return this.find(-this.dir, cx);
    else if (k === "escape") {
      if (!this.anchor && !pending && !counted) return this.close();
      this.anchor = null;
      this.mode = null;
    } else if (k === "q") return this.close();
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // The columns of row r the selection covers, both ends included; null when none.
  selected(r) {
    if (!this.anchor) return null;
    const [s, e] = vim.ordered(this.anchor, this.cur);
    if (r < s.row || r > e.row) return null;
    const last = vim.lastCol(this.lines, r);
    if (this.mode === "line") return [0, last];
    return [r === s.row ? s.col : 0, r === e.row ? e.col : last];
  }

  line(t, r, lh) {
    const text = this.lines[r];
    const left = this.left;
    const right = left + this.cols + 1;
    const shown = text.slice(left, right);
    const sel = this.selected(r);
    const here = r === this.cur.row;
    const width = Math.max(shown.length, here ? this.cur.col - left + 1 : 0, sel ? 1 : 0);
    const paint = new Array(width).fill(null);
    for (const [s, e] of vim.matches(text, this.query)) for (let c = Math.max(s, left); c < Math.min(e, right); c++) paint[c - left] = "match";
    if (sel) for (let c = Math.max(sel[0], left); c <= Math.min(sel[1], left + width - 1); c++) paint[c - left] = "sel";
    if (here) paint[this.cur.col - left] = "cursor";
    const bg = { match: t.ansi3, sel: t.selection, cursor: t.accent };
    const spans = [];
    for (let i = 0; i < width; ) {
      let j = i;
      while (j < width && paint[j] === paint[i]) j++;
      const chunk = shown.slice(i, j).padEnd(j - i, " ");
      spans.push(paint[i] ? div().bg(bg[paint[i]]).when(paint[i] !== "sel", (el) => el.text_color(t.background)).child(chunk) : div().child(chunk));
      i = j;
    }
    return h_flex().h(lh).flex_none().whitespace_nowrap().children(spans);
  }

  renderCopy(t) {
    const family = settings().font_family ?? "JetBrains Mono";
    const size = Number(settings().font_size) || 14;
    const lh = Math.round(size * 1.45);
    const cw = size * 0.6;
    const L = this.lines;
    const rows = [];
    if (L) for (let r = this.top; r < Math.min(L.length, this.top + this.rows); r++) rows.push(this.line(t, r, lh));
    const mode = this.mode === "line" ? "V-LINE" : this.mode === "char" ? "VISUAL" : "COPY";
    const hint = this.anchor ? "y copy · o other end · esc cancel" : "v select · V lines · / search · y copy line · q quit";
    return v_flex()
      .id("copy-mode")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .bg(t.background)
      .child(
        v_flex()
          .id("copy-text")
          .flex_1()
          .min_h(0)
          .overflow_hidden()
          .px(12)
          .pt(8)
          .font_family(family)
          .text_size(size)
          .text_color(t.foreground)
          .on_size_change((s, cx) => {
            this.rows = Math.max(1, Math.floor((s.height - 8) / lh));
            this.cols = Math.max(10, Math.floor((s.width - 24) / cw));
            if (this.lines) this.reveal();
            cx.notify();
          })
          .on_scroll_wheel((e, cx) => {
            if (!this.lines) return;
            this.wheel -= e.delta_lines?.y ?? e.delta.y / lh;
            const step = Math.trunc(this.wheel);
            if (!step) return;
            this.wheel -= step;
            this.top = Math.max(0, Math.min(this.top + step, this.lines.length - this.rows));
            const row = Math.max(this.top, Math.min(this.cur.row, this.top + this.rows - 1));
            if (row !== this.cur.row) this.cur = vim.clamp(this.lines, { row, col: this.want });
            cx.notify();
          })
          .when(!L, (el) => el.child(div().text_color(t.dim).child("Reading the pane\u2026")))
          .children(rows),
      )
      .child(
        h_flex()
          .h(26)
          .flex_none()
          .px(12)
          .gap(12)
          .items_center()
          .bg(t.chrome)
          .border_t(1)
          .border_color(t.border)
          .text_size(11.5)
          .text_color(t.muted)
          .child(div().flex_none().font_semibold().text_color(this.mode ? t.accent : t.foreground).child(mode))
          .when(Boolean(this.searching), (el) =>
            el.child(div().flex_none().text_color(t.foreground).child(this.searching > 0 ? "/" : "?")).child(Input.new(this.input).flex_1().h(20).text_color(t.foreground)),
          )
          .when(!this.searching, (el) =>
            el.child(div().flex_1().min_w(0).truncate().text_color(this.message || this.error ? t.blocked : t.dim).child(this.error || this.message || (this.query ? `/${this.query}` : ""))),
          )
          .when(Boolean(this.count || this.pending), (el) => el.child(div().flex_none().text_color(t.foreground).child(this.count + this.pending)))
          .when(Boolean(L), (el) => el.child(div().flex_none().child(`${this.cur.row + 1}/${L.length}`)))
          .child(div().flex_none().text_color(t.dim).child(hint)),
      );
  }

  render() {
    const t = theme();
    if (this.action === "copy") return this.renderCopy(t);
    return div();
  }
}
