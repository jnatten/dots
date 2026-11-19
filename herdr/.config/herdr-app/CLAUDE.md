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
Mac's state the windows share (space colors, archived sessions, folded folders), not in dots.
`HERDR_APP_HOME=~/.config/herdr-app-2 herdr-app status` (or `do`, `ls`, `shot`) asks
that window.

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

The board (ctrl-a T, `mods/jj-spaces/board.js`, a jj-spaces overlay) shows every open PR in
its repos and those involving you, their open issues, and a tab per Trello board, each item
with how many sessions, PRs, issues and cards it's linked to. Its repos are those the sidebar
finds in its folders (`shared("board.repos")`) and those added in the spacing dialog's Board
tab; the Trello boards there come from `shared("trello.boards")`, which the sidebar lists once
Trello is connected. What's picked is `jj-board` in `jj-settings.json`. ↵ on an item opens the
tasks list for that item alone (`{ tasks: true, url, parent }`), whose pick closes the board too.

An agent's own description and whether it shows (its Description dialog, ctrl-a d) are
the `jj.description` and `jj.description.mode` labels on its herdr-core terminal, so every
screen sees them and they end with the terminal. The defaults are in `jj-settings.json`.

Space folders live in the `jj-folders` herdr-core document on every machine
(`mods/jj-spaces/folders.js`): each folder's name, color and order on all of them
(newest wins), and on each machine its own paths for a folder and the spaces there
dragged into one. The spaces sidebar is the only writer; the menu and the folder dialog
ask it through `shared("space-folders.ask")`. Folded folders are this Mac's
(`jj-state.json`).

## Working on mods

- **Check:** `herdr-app check ~/.config/herdr-app/mods/<mod>` after every change.
  It only renders a mod's default state, so check other modes with a scratch copy.
- **Errors and focus:** `herdr-app status`.
- **Screenshot:** `herdr-app shot <file>.png`.
- **Reloading:** Herdr doesn't always notice edits made through a symlink.
  - After editing a mod or `keys.json` in dots, run `touch -h` on its link in
    `~/.config/herdr-app` to reload it.
  - Change the layout with `herdr-app do layout.set`, which writes through the link.
- **Generated files:** Herdr adds `gpui-kit.d.ts` and `jsconfig.json` to mod folders.
  They're gitignored.
