# Herdr config

Before changing anything here, read the Herdr app's manual and API types in its
home folder, `~/.config/herdr-app`:

- `~/.config/herdr-app/AGENTS.md`: how layouts, keys, settings and mods work, and
  the `herdr-app` / `hc` commands. Herdr rewrites it on every start, so read it
  there rather than from memory.
- `~/.config/herdr-app/herdr.d.ts` and `gpui-kit.d.ts`: the mod API, which is the
  truth where the manual and code disagree.

## Where the files live

`~/.config/herdr-app` is Herdr's own folder. Only the files in the dots package
`~/dev/dots/herdr/.config/herdr-app` are this setup's: the `jj` layout, `keys.json`,
`settings.json`, `jj-settings.json` (the spacing dialog's hints and links, which
`jj-limits` keeps in sync with `shared()`), this file and the `mods/jj-*` mods. They're linked into Herdr's folder with
`stow herdr --target ~` from `~/dev/dots`, so edit them in dots and run stow after
adding a file. Everything else in `~/.config/herdr-app` is Herdr's: clone shipped
mods and layouts (`mod.clone`, `layout.clone`) rather than editing them.

More windows onto the same spaces (cmd-shift-n) are more Herdr apps, each with a home
of its own: `new-window.sh` makes `~/.config/herdr-app-2`, `-3`, … with this setup's
files linked from `~/.config/herdr-app`, and opens it. `jj-state.json` there is this
Mac's state the windows share (space colors, folded folders), not in dots.
`HERDR_APP_HOME=~/.config/herdr-app-2 herdr-app status` (or `do`, `ls`, `shot`) asks
that window.

opt+h/j/k/l (`jj-tabs.go-*`) cross between those windows: where `pane.go` finds no pane
further that way, `window-go.sh` (in the main home) asks macOS for the on-screen Herdr
window on that side, brings it to the front through System Events (macOS asks Herdr for
that once) and walks its focus to the pane nearest the edge it came in by.

Links added by hand in the link dialog (ctrl-a g for the focused agent, ctrl-a G for
the space) and the Waiting mark (ctrl-a H) aren't in any file: they live in the
`jj-links` herdr-core document on the machine each space and agent is on
(`mods/jj-spaces/docs.js`), so every screen sees the same ones. An agent also has its
space's own links (by hand and its branch's PR).

Which Claude sessions had which links outlives their terminals: the spaces sidebar keeps
every link a running session has had in the `jj-tasks` herdr-core document on the machine
it runs on, by session id, and shares all machines' as `shared("tasks.sessions")`. The
tasks list (ctrl-a t, `mods/jj-sessions/tasks.js`) shows them by task, and resumes a
session where it ran or (⌘↵) copies it from another machine and resumes it here
(`mods/jj-sessions/sessions.js`).

The session search (cmd-k, ctrl-a w, `mods/jj-sessions/main.js`) also finds a session by its
branches, PRs and issues. `scan.mjs` reads each transcript once in full and then only what was
added (cached in `~/.cache/herdr-jj-sessions.json` on each machine): branches from the jj bookmarks
Claude pushed or set (`gitBranch` is `HEAD` in a jj repo), PRs, issues and Trello cards from the
links in your prompts, Claude's replies and its tool calls (not tool output). The session's links in
`shared("tasks.sessions")` count too, with their titles from `shared("github")`. ⌃space previews the
selected session: `peek.js`, a jj-sessions dialog `{ peek, query, parent }` over the search, fed by
`peek.mjs` run on the machine the session ran on.

The board (ctrl-a T, `mods/jj-spaces/board.js`, a jj-spaces overlay) shows every open PR in
its repos and those involving you, their open issues, and a tab per Trello board, each item
with how many sessions, PRs, issues and cards it's linked to. Its repos are those the sidebar
finds in its folders (`shared("board.repos")`) and those added in the spacing dialog's Board
tab; the Trello boards there come from `shared("trello.boards")`, which the sidebar lists once
Trello is connected. What's picked is `jj-board` in `jj-settings.json`. ↵ on an item opens the
tasks list for that item alone (`{ tasks: true, url, parent, start }`), whose pick closes the
board too. It also starts a new session in the item's repo, where `shared("board.places")` (the
sidebar's) has it checked out: in the checkout or a new worktree (the WorktreeCreate hook's, then
`claude --worktree`), on a PR's branch. The sidebar links the new session to the item once it
runs (`shared("board.link.ask")`).

Space on the board (ctrl-space in the tasks list) previews the selected PR, issue or card:
`mods/jj-spaces/preview.js`, a jj-spaces overlay `{ preview: url, item? }` fed by
`preview-data.js` (one GraphQL query, or Trello's card API). Its images are downloaded with
curl (a mod's fetch has no bytes) into `jj-cache/preview` in Herdr's home, GitHub's through the
signed URLs in `bodyHTML`, Trello's with its key and token.

The keybind list (prefix+? and cmd-/, `mods/jj-help`, a clone of Herdr's `help`) says what
each binding in `keys.json` does from its `DESCRIBE` table: when adding or changing a key, give
it a line there too (one it doesn't know falls back to Herdr's words for the command).

The spacing dialog's Sidebar tab can put the agents under their spaces (`jj-spaces`' Agents
pref "tree", `mods/jj-spaces/agent-tree.js`): the spaces sidebar draws them, hides the agents
list's block (`layout.hide`, back on the narrow rail) and sets the agent order. Both draw an agent
with `mods/jj-agents/parts.js`; `mods/jj-spaces/agent-parts.js` is a copy, since Herdr won't load
a module from outside a mod's folder, symlinked or not: change `parts.js`, then copy it over.
ctrl-a d is `jj-spaces.describe` so it works with the agents block hidden.

ctrl-a r opens jj-sessions' review dialog (`mods/jj-sessions/review.js`): paste a PR URL or name a
PR (#123), branch or revision, and Claude starts in a new worktree and space on it, with
`/jj-review` first, so the skill's trunk()..@ and checks are that code. The space shows at once:
its terminal fetches, makes the worktree and moves it there before it becomes Claude (sessions.js'
`startNew` and its `BOOT` script, with `branch`, `pull` for a fork's PR, or `text` to look for). A GitHub URL goes to that repo's
checkout (`shared("board.places")`), the rest to the shown space's repo.

ctrl-a m (or an agent's menu) moves a Claude session to another machine: jj-sessions' move
dialog (`mods/jj-sessions/move.js`) maps its folder there through the sidebar folders' paths
(`mapPath` in `sessions.js`), copies its transcript, subagents', rewind checkpoints and todos
through `hc exec -i`, closes it here (not mid-turn) and resumes it there. Code isn't moved. The
spaces sidebar moves its jj-tasks entry and gives the new terminal the old one's hand links and
description (`shared("sessions.move.ask")`). The tasks list's ⌘↵ (bring) is the same move to here.

An agent's own description and whether it shows (its Description dialog, ctrl-a d) are
the `jj.description` and `jj.description.mode` labels on its herdr-core terminal, so every
screen sees them and they end with the terminal. The defaults are in `jj-settings.json`.

Space folders live in the `jj-folders` herdr-core document on every machine
(`mods/jj-spaces/folders.js`): each folder's name, color and order on all of them
(newest wins), and on each machine its own paths for a folder and the spaces there
dragged into one. The spaces sidebar is the only writer; the menu and the folder dialog
ask it through `shared("space-folders.ask")`. Folded folders are this Mac's
(`jj-state.json`).

A terminal glyph on a space row, the rail and a tab (jj-tabs, from `shared("commands.tabs")`)
says a command runs there (inside a cyan ring spinning like the agents', after 2 s) or finished
while its pane wasn't focused in this window (on a tile: green, red on a non-zero exit, blue when
the code is unknown), until it is
(`mods/jj-spaces/commands.js`). A command is a program in front of a shell (`panes()`' `program`)
that isn't an agent and isn't skipped: the spacing dialog's Commands tab
(`mods/jj-spacing/commands-tab.js`, `jj-commands` in `jj-settings.json`) skips editors, pagers,
TUIs and ssh by default. Each window tracks on its own in memory; the one that focuses it sets
`jj.seen=<ms>` on the terminal so the others let go. The exit code and command line come from
fish (`fish/.config/fish/config.fish`, commands over 2 s) as `jj.exit=<code>:<epoch s>` and
`jj.cmd`; without them the command is what the terminal's title said while it ran. The session
search (cmd-k) lists the running ones after Working (`shared("commands.running")`) and the unseen
finished ones after Done (`shared("commands.done")`), and ↵ focuses the pane. The Sidebar tab's Terminals option (`jj-spaces`' `terminals`: off, commands,
all) lists a space's terminals under it after its agents, drawn like the tree's agent rows
(`terminalRows` in commands.js): what runs or ran, how long ago and its mark, or the folder of
one at its prompt.

## Working on mods

- **Check:** `herdr-app check ~/.config/herdr-app/mods/<mod>` after every change.
  It only renders a mod's default state, so check other modes with a scratch copy.
- **Errors and focus:** `herdr-app status`.
- **Screenshot:** `herdr-app shot <file>.png`.
- **Reloading:** Herdr doesn't always notice edits made through a symlink.
  - After editing a mod or `keys.json` in dots, run `touch -h` on its link in
    `~/.config/herdr-app` to reload it.
  - Change the layout by editing `layouts/jj.json` in dots: Herdr picks the edit up. Resizes,
    hidden blocks and a stack's tab are clicks Herdr keeps in `layouts/.state/` (not in dots),
    so the file only changes when something means to change it. `layout.set` drops every click,
    and a tree read from `layout()` has them in it, so the spacing dialog edits the file too.
- **Tab, shift-tab and Escape:** the app takes them before a mod's `on_key_down` (Tab moves
  the keyboard to the next tab stop, which can be an input behind a dialog; Escape closes the
  top dialog). A mod that uses them binds its own with `cx.bind_keys` in a `key_context` of its
  own and handles them with `on_action`, as the board does.
- **Generated files:** Herdr adds `gpui-kit.d.ts` and `jsconfig.json` to mod folders.
  They're gitignored.
