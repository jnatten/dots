// A review in a space of its own (ctrl-a r): paste a PR URL, or name a branch or revision, and
// Claude starts in a new worktree with `/jj-review <that>` as its first message. A GitHub URL
// reviews in that repo's checkout (shared("board.places"), the spaces sidebar's), a PR's on
// its branch, so the skill's trunk()..@ is the PR; anything else in the shown space's repo.
// A jj-sessions overlay with props { review: true, folder, machine } (the shown space's).

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { shared, props, closeOverlay, exec } from "herdr";
import { startNew } from "./sessions.js";

const ICON = (name) => `mods/workspace-chrome/${name}.svg`;
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "change";

// What's typed, and where it would be reviewed: { text, repo?, pr?, place } or { error }.
function targetOf(text) {
  const s = text.trim();
  if (!s) return null;
  const gh = s.match(/github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/(\d+)/);
  if (gh) {
    const [, repo, kind, number] = gh;
    const places = shared("board.places")?.[repo.toLowerCase()] ?? [];
    const place = places.find((p) => p.machine === null) ?? places[0];
    if (!place) return { error: `No checkout of ${repo} in the sidebar's folders or spaces.` };
    return { text: s, repo, pr: kind === "pull" ? Number(number) : null, place };
  }
  const folder = props()?.folder;
  if (!folder) return { error: "No space is shown to review in: paste a PR URL instead." };
  return { text: s, place: { machine: props()?.machine ?? null, path: folder } };
}

const where = (p) => `${p.machine ? `${p.machine} · ` : ""}${p.path.replace(/^\/(?:Users|home)\/[^/]+/, "~")}`;

export function reviewInit(view) {
  view.busy = false;
  view.error = "";
  view.input = InputState.new({ placeholder: "PR URL, branch or revision" });
  view.input.on("change", (_e, cx) => { view.error = ""; cx.notify(); });
  view.input.on("submit", (_e, cx) => go(view, cx));
  view.input.focus();
}

function go(view, cx) {
  const t = targetOf(view.input.value());
  if (view.busy || !t) return;
  if (t.error) return (view.error = t.error), cx.notify();
  view.busy = true;
  view.error = "";
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      let branch = null;
      if (t.pr) {
        const r = await exec("gh", ["pr", "view", t.text, "--json", "headRefName,isCrossRepository"], { timeout: 30000 });
        const pr = r.code === 0 ? JSON.parse(r.stdout) : null;
        if (!pr) throw new Error(`gh couldn't see ${t.repo}#${t.pr}: ${(r.stderr || "").trim().split("\n").pop()}`);
        if (!pr.isCrossRepository) branch = pr.headRefName;
      }
      view.error = await startNew({
        path: t.place.path,
        machine: t.place.machine,
        worktree: true,
        name: t.pr ? `review-${t.pr}` : `review-${slug(t.text)}`,
        branch,
        url: t.pr ? t.text : null,
        task: `/jj-review ${t.text}`,
      });
    } catch (e) {
      view.error = String(e?.message ?? e);
    }
    view.busy = false;
    if (!view.error) closeOverlay(props().overlay);
    cx.notify();
  });
}

export function reviewRender(view, t) {
  const target = targetOf(view.input.value());
  const about = !target
    ? props()?.folder ? `Without a URL: in ${where({ machine: props()?.machine ?? null, path: props().folder })}` : "Paste a PR URL."
    : target.error ?? `In a new worktree of ${where(target.place)}${target.pr ? `, on PR #${target.pr}'s branch` : ""}`;
  return v_flex()
    .id("review")
    .track_focus(view.handle)
    .on_key_down((e) => {
      if (e.key === "escape") closeOverlay(props().overlay);
    })
    .size_full()
    .p(16)
    .gap(10)
    .bg(t.popover)
    .text_size(13)
    .child(div().flex_none().font_semibold().text_color(t.foreground).child("Review"))
    .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
      .child(svg(ICON("git-compare")).size(14).text_color(t.dim))
      .child(Input.new(view.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
    .child(div().flex_none().text_size(12).text_color(target?.error ? t.blocked : t.dim).child(about))
    .when(Boolean(view.error), (el) => el.child(div().flex_none().text_color(t.blocked).child(view.error)))
    .child(div().flex_1())
    .child(h_flex().flex_none().justify_end().text_size(11).text_color(t.dim)
      .child(view.busy ? "making the worktree and starting Claude…" : "↵ start /jj-review in a new space · esc cancel"));
}
