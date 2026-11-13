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
`settings.json`, this file and the `mods/jj-*` mods. They're linked into Herdr's folder with
`stow herdr --target ~` from `~/dev/dots`, so edit them in dots and run stow after
adding a file. Everything else in `~/.config/herdr-app` is Herdr's: clone shipped
mods and layouts (`mod.clone`, `layout.clone`) rather than editing them.

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
