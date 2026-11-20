// Quick Look for a PR, issue or Trello card (space on the board, ctrl-space in the tasks list):
// its header, a PR's status checks, the description, comments and reviews, a card's checklists
// and attachments, and what it's linked to, with their images (preview-data.js). j/k pick a
// block, ↵ opens what it is (a check's run, a comment, an image), ⌃↵ the item; space or esc close.
// A jj-spaces overlay with props { preview: url, item? } (item: what the opener knows, for the
// header until GitHub or Trello answers).

import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle, TextView } from "gpui-base";
import { props, closeOverlay, theme, settings, shared, exec } from "herdr";
import { GH, isCard, markRead, unknown } from "./github.js";
import { OpError, linkSettings } from "./trello.js";
import { fetchCard, fetchGithub, cacheImage } from "./preview-data.js";

const ICON = (name) => `mods/workspace-chrome/${name}.svg`;
const GREEN = ["#1a7f37", "#3fb950"], RED = ["#cf222e", "#f85149"], YELLOW = ["#9a6700", "#d29922"], GRAY = ["#59636e", "#9198a1"], PURPLE = ["#8250df", "#a371f7"];
const CHECK = { failure: ["x", RED, "failing"], pending: [null, YELLOW, "running"], success: ["check", GREEN, "passed"], skipped: ["minus", GRAY, "skipped"] };
const REVIEW = { APPROVED: [GREEN, "approved"], CHANGES_REQUESTED: [RED, "requested changes"], COMMENTED: [GRAY, "reviewed"], DISMISSED: [GRAY, "dismissed"], PENDING: [YELLOW, "pending review"] };
const DECISION = { APPROVED: [GREEN, "Approved"], CHANGES_REQUESTED: [RED, "Changes requested"], REVIEW_REQUIRED: [YELLOW, "Review required"] };
const MERGE = { CLEAN: [GREEN, "Ready to merge"], BLOCKED: [YELLOW, "Blocked"], BEHIND: [YELLOW, "Behind its base"], DIRTY: [RED, "Conflicts"], UNSTABLE: [YELLOW, "Checks not passing"], DRAFT: [GRAY, "Draft"] };
const TRELLO = { green: "#4bce97", yellow: "#f5cd47", orange: "#fea362", red: "#f87168", purple: "#9f8fef", blue: "#579dff", sky: "#6cc3e0", lime: "#94c748", pink: "#e774bb", black: "#8590a2" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// What was fetched, by URL, for the next opening (copies of this build share it).
const memory = {};

const pick = (c, dark) => c[dark ? 1 : 0];
const ago = (ms) => {
  const d = (Date.now() - ms) / 1000;
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86400 ? `${Math.round(d / 3600)}h` : d < 86400 * 60 ? `${Math.round(d / 86400)}d` : `${Math.round(d / 86400 / 30)}mo`;
};
const dateOf = (ms) => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ""}`;
};
const refOfUrl = (url) => {
  const m = url.match(/github\.com\/[^/]+\/([^/]+)\/(?:pull|issues)\/(\d+)/);
  return m ? `${m[1]}#${m[2]}` : isCard(url) ? "Trello card" : url;
};

export function previewInit(view, cx) {
  view.handle = cx.focus_handle();
  view.handle.focus();
  view.at = 0;
  view.scroll = ScrollHandle.new();
  view.images = {}; // an image part's link -> its cached path, false when it couldn't be had
  view.error = "";
  view.busy = false;
  load(view, cx);
}

function load(view, cx) {
  const url = props()?.preview;
  if (!url || view.busy) return;
  view.busy = true;
  view.error = "";
  cx.spawn(async (cx) => {
    try {
      memory[url] = isCard(url) ? await fetchCard(url, linkSettings(shared("jj-links"))) : await fetchGithub(url);
    } catch (e) {
      view.error = `${e?.message ?? e}${e instanceof OpError ? " r tries again." : ""}`;
    }
    view.busy = false;
    cx.notify();
    const parts = (memory[url]?.blocks ?? []).flatMap((b) => [...(b.parts ?? []), ...(b.inline ?? []).flatMap((c) => c.parts)]).filter((p) => p.img);
    const asked = parts.filter((p) => !(p.link in view.images)).map((p) => [p, cacheImage(p.img, p.auth)]);
    for (const [p, path] of asked) {
      view.images[p.link] = (await path) ?? false;
      cx.notify();
    }
  });
}

const open = (url, cx) => url && cx.spawn(async () => { await exec("open", [url]).catch(() => null); });

// Every block j/k can pick, each one child of the scrolled column: { key, url, el(on) }.
function rowsOf(view, data, t, dark) {
  const rows = [];
  const card = (key, url, build) => rows.push({ key, url, el: (on) => build(v_flex().id(`pv-${key}`).flex_none().p(12).gap(8).rounded(8).border_1().border_color(on ? t.accent : t.border).bg(t.background)) });
  const line = (key, url, build) => rows.push({ key, url, el: (on) => build(h_flex().id(`pv-${key}`).flex_none().h(30).px(10).gap(8).items_center().rounded(6).when(on, (el) => el.bg(t.selected))) });
  const head = (b, extra) => h_flex().gap(6).items_center().text_size(11.5).text_color(t.dim)
    .when(Boolean(b.author), (el) => el.child(div().font_semibold().text_color(t.foreground).child(b.author)))
    .when(Boolean(extra), (el) => el.child(extra))
    .when(Boolean(b.at), (el) => el.child(div().child(ago(b.at))));
  const partsEl = (key, parts) => v_flex().gap(8).children(parts.map((p, i) => {
    if (p.md) return TextView.markdown(`pv-md-${key}-${i}`, p.md).selectable(true).text_size(13).text_color(t.foreground);
    if (p.video) return h_flex().id(`pv-v-${key}-${i}`).gap(6).items_center().text_color(t.accent).cursor_pointer().on_click((_e, cx) => open(p.link ?? p.video, cx)).child("▶ Video: opens in the browser");
    const path = view.images[p.link];
    if (path) return image(path).max_w_full().max_h(560);
    return h_flex().id(`pv-i-${key}-${i}`).gap(6).items_center().text_size(12).text_color(t.dim).cursor_pointer().on_click((_e, cx) => open(p.link, cx))
      .child(path === false ? "Image: couldn't load it, click to open" : div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90))
      .when(path !== false, (el) => el.child("loading image…"));
  }));

  if (data.checks?.length) {
    const count = (s) => data.checks.filter((c) => c.state === s).length;
    const summary = ["failure", "pending", "success", "skipped"].filter(count).map((s) => `${count(s)} ${CHECK[s][2]}`).join(" · ");
    const quiet = data.checks.filter((c) => c.state === "success" || c.state === "skipped").length;
    rows.push({ key: "checks", toggle: true, url: `${data.url}/checks`, el: (on) => h_flex().id("pv-checks").flex_none().h(30).px(10).gap(8).items_center().rounded(6).when(on, (el) => el.bg(t.selected))
      .child(svg(ICON(view.allChecks ? "chevron-down" : "chevron-right")).size(11).text_color(t.dim))
      .child(div().font_semibold().text_color(t.foreground).child("Checks"))
      .child(div().flex_1().text_size(12).text_color(t.dim).child(summary))
      .when(quiet > 0, (el) => el.child(div().text_size(11).text_color(t.dim).child(view.allChecks ? "↵ hide passed" : `↵ show ${quiet} passed or skipped`))) });
    data.checks.forEach((c, i) => {
      if (!view.allChecks && (c.state === "success" || c.state === "skipped")) return;
      const [icon, color, word] = CHECK[c.state];
      line(`check-${i}`, c.url, (el) => el.pl(18)
        .child(h_flex().w(14).flex_none().justify_center().child(icon ? svg(ICON(icon)).size(12).text_color(pick(color, dark)) : div().size(7).rounded(4).bg(pick(color, dark))))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(c.workflow ? `${c.workflow} / ${c.name}` : c.name))
        .child(div().flex_none().text_size(11.5).text_color(pick(color, dark)).child(word)));
    });
  }
  for (const b of data.blocks) {
    if (b.type === "checklist") {
      const done = b.items.filter((i) => i.done).length;
      card(b.id, data.url, (el) => el
        .child(h_flex().gap(6).child(div().font_semibold().text_color(t.foreground).child(b.title)).child(div().text_size(11.5).text_color(t.dim).child(`${done}/${b.items.length}`)))
        .children(b.items.map((i) => h_flex().gap(8).items_center().text_color(i.done ? t.dim : t.foreground)
          .child(svg(ICON(i.done ? "circle-check" : "square")).size(12).text_color(i.done ? pick(GREEN, dark) : t.dim)).child(i.name))));
    } else if (b.type === "attachment") {
      if (b.parts.length) card(b.id, b.url, (el) => el.child(head({ author: b.title, at: b.at })).child(partsEl(b.id, b.parts)));
      else line(b.id, b.url, (el) => el.child(svg(ICON("file-text")).size(13).text_color(t.dim)).child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(b.title)).child(div().text_size(11.5).text_color(t.dim).child(b.at ? ago(b.at) : "")));
    } else {
      const review = b.type === "review" ? REVIEW[b.state] ?? REVIEW.COMMENTED : null;
      const badge = review ? div().text_color(pick(review[0], dark)).child(review[1]) : b.type === "body" && data.kind !== "trello" ? div().child("opened this") : null;
      card(b.id, b.url, (el) => el
        .when(b.type !== "body" || data.kind !== "trello", (el) => el.child(head(b, badge)))
        .when(Boolean(b.parts?.length), (el) => el.child(partsEl(b.id, b.parts)))
        .children((b.inline ?? []).map((c, i) => v_flex().gap(6).pl(10).border_l(2).border_color(t.border)
          .child(div().text_size(11.5).text_color(t.dim).child(`${c.path}${c.line ? `:${c.line}` : ""}`))
          .when(Boolean(c.hunk), (el) => el.child(div().p(6).rounded(4).bg(t.raised).text_size(11.5).font_family(settings()?.font_family ?? "Menlo").text_color(t.muted).child(c.hunk)))
          .child(partsEl(`${b.id}-${i}`, c.parts)))));
    }
  }
  const items = shared("github")?.items ?? {};
  for (const u of data.links ?? []) {
    const it = items[u] ?? unknown(u, 0);
    const s = GH[it.state];
    line(`link-${u}`, u, (el) => el
      .child(svg(s?.icon ?? (it.kind === "issue" ? GH["issue-open"].icon : it.kind === "trello" ? GH["trello-open"].icon : GH.open.icon)).size(13).text_color(s ? pick(s.color, dark) : t.dim))
      .child(div().flex_none().text_size(11.5).text_color(t.dim).child(refOfUrl(u)))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(it.title || u)));
  }
  return rows;
}

function header(data, item, t, dark) {
  const it = data ?? item ?? unknown(props()?.preview ?? "", 0);
  const s = GH[it.state];
  const kind = it.kind;
  const icon = s?.icon ?? (kind === "issue" ? GH["issue-open"].icon : kind === "trello" ? GH["trello-open"].icon : GH.open.icon);
  const ref = data?.ref ?? (item ? (kind === "trello" ? `${item.list || "Card"}${item.number ? ` #${item.number}` : ""}` : `${item.repo}#${item.number}`) : refOfUrl(props()?.preview ?? ""));
  const facts = [];
  if (data?.author) facts.push(`${data.author} opened this ${ago(data.created)} ago`);
  facts.push(...(data?.meta ?? []));
  if (data?.active) facts.push(`active ${ago(data.active)} ago`);
  const chip = (text, color) => div().flex_none().text_size(11.5).text_color(color).child(text);
  const decision = DECISION[data?.review];
  const merge = s && !["merged", "closed"].includes(it.state) ? MERGE[data?.merge] : null;
  return v_flex().flex_none().gap(6)
    .child(h_flex().gap(8).items_center()
      .child(svg(icon).size(16).text_color(s ? pick(s.color, dark) : t.dim))
      .child(div().flex_none().text_size(12).text_color(t.dim).child(ref))
      .child(div().flex_none().text_size(12).text_color(s ? pick(s.color, dark) : t.dim).child(s?.label ?? "")))
    .child(div().text_size(16).font_semibold().text_color(t.foreground).child(it.title || ""))
    .child(h_flex().flex_wrap().gap_x(12).gap_y(4).items_center().text_size(12).text_color(t.dim)
      .children(facts.map((f) => div().child(f)))
      .when(Boolean(decision), (el) => el.child(chip(decision[1], pick(decision[0], dark))))
      .when(Boolean(merge), (el) => el.child(chip(merge[1], pick(merge[0], dark))))
      .when(Boolean(data?.due), (el) => el.child(chip(`due ${dateOf(data.due.at)}`, data.due.done ? pick(GREEN, dark) : data.due.at < Date.now() ? pick(RED, dark) : t.dim))))
    .when(Boolean(data?.labels?.length || data?.people?.length), (el) => el.child(h_flex().flex_wrap().gap_x(8).gap_y(4).items_center()
      .children((data.labels ?? []).map((l) => h_flex().gap(4).items_center().px(6).h(18).rounded(9).border_1().border_color(t.border).text_size(11).text_color(t.muted)
        .child(div().size(8).rounded(4).bg(l.color ?? TRELLO[(l.trello ?? "").replace(/_(light|dark)$/, "")] ?? t.dim))
        .when(Boolean(l.name), (el) => el.child(l.name))))
      .when(Boolean(data.people?.length), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(data.people.join(", "))))));
}

export function previewRender(view) {
  const t = theme();
  const dark = Boolean(settings()?.dark);
  const url = props()?.preview ?? "";
  const data = memory[url] ?? null;
  const rows = data ? rowsOf(view, data, t, dark) : [];
  view.at = Math.max(0, Math.min(view.at, rows.length - 1));
  const site = isCard(url) ? "Trello" : "GitHub";
  const go = (i) => {
    view.at = Math.max(0, Math.min(rows.length - 1, i));
    view.scroll.scroll_to_item(view.at);
  };
  const hint = ["j/k move", "↵ open it", `⌃↵ open on ${site}`, "r refresh", "space close"].join(" · ");
  return v_flex()
    .id("preview")
    .track_focus(view.handle)
    .on_key_down((e, cx) => {
      const m = e.modifiers;
      const half = 4;
      if (e.key === "escape" || (e.key === "space" && !m.alt && !m.platform)) return closeOverlay(props().overlay);
      if (e.key === "enter" && m.control) {
        markRead([data ?? { kind: "pr", url }]);
        open(url, cx);
      } else if (e.key === "enter" && rows[view.at]?.toggle) view.allChecks = !view.allChecks;
      else if (e.key === "enter") open(rows[view.at]?.url, cx);
      else if (m.control && e.key === "d") go(view.at + half);
      else if (m.control && e.key === "u") go(view.at - half);
      else if (m.control || m.alt || m.platform) return;
      else if (e.key === "j" || e.key === "down") go(view.at + 1);
      else if (e.key === "k" || e.key === "up") go(view.at - 1);
      else if (e.key === "g" && !m.shift) go(0);
      else if (e.key === "g" || e.key === "G") go(rows.length - 1);
      else if (e.key === "r") load(view, cx);
      else return;
      cx.stop_propagation();
      cx.notify();
    })
    .size_full()
    .min_h(0)
    .p(18)
    .gap(12)
    .bg(t.popover)
    .text_size(13)
    .child(header(data, props()?.item, t, dark))
    .child(v_flex().id("pv-list").flex_1().min_h(0).gap(8).overflow_y_scrollbar().track_scroll(view.scroll)
      .children(rows.map((r, i) => r.el(i === view.at).cursor_pointer().on_click((e, cx) => {
        view.at = i;
        if (r.toggle) view.allChecks = !view.allChecks;
        else if (e.click_count >= 2) open(r.url, cx);
        cx.notify();
      })))
      .when(!data && !view.error, (el) => el.child(h_flex().gap(6).p(10).text_color(t.dim).child(div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)).child(`Asking ${site}…`))))
    .child(h_flex().flex_none().gap(12).items_center().text_size(11).text_color(t.dim)
      .child(div().flex_1().min_w(0).truncate().text_color(view.error ? t.blocked : t.dim).child(view.error || (view.busy && data ? "refreshing…" : "")))
      .child(div().flex_none().child(hint)));
}
