# Dots

Dotfiles yay

## Usage

Use `stow` to install the dotfiles.
Usually one would stand on the root of the git-repository and install the package you want:

Example to install neovim

```bash
$ stow neovim --target ~
```

## Dependencies

### zsh

The .zshrc config is using [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh/)

### ccdots

The Claude Code dots in the macOS menu bar. Needs the `tmux` package stowed as
well, since it renders what `~/.tmux/claude/sessions.sh` reports and focuses
panes through `~/.tmux/claude/activate.sh`.

On a new machine:

```bash
brew install tmux jq stow
stow tmux ccdots --target ~
cd ~/.config/ccdots && make load
```

`make load` bootstraps the LaunchAgent, which starts it now and at every login.
No build step: `ccdots.app` is committed, because launchd must not wait on a
compiler at login. Nothing in the plist names a user, so the same one works on
every machine: launchd expands neither `~` nor `$HOME`, so it launches the app
through `/bin/sh`, which does.

The one thing to know if it does not come up: the committed binary is arm64, so
run `make` on anything else, which needs the Xcode command line tools.

A session changing into a state that wants something from you, while you are
not looking at its pane, also raises a toast in the top right for five seconds;
clicking it goes to that session. It is drawn by the app rather than posted to
Notification Center, so it needs no authorisation and leaves no history behind.

After changing the Swift, `make reload` rebuilds and restarts the agent.
`make unload` stops it, and it logs to `~/Library/Logs/ccdots.log`.
`CCDOTS_DEBUG=1` adds a line per poll saying where in the menu bar macOS
actually put the item, which is what to reach for when it is running but
nowhere to be seen.

### tmux

Utilizes [tpm](https://github.com/tmux-plugins/tpm)
Other dependencies: [tmux-url-select](https://github.com/dequis/tmux-url-select)

```bash
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
curl https://raw.githubusercontent.com/dequis/tmux-url-select/master/tmux-url-select.pl > ~/.bin/tmux-url-select && chmod +x ~/.bin/tmux-url-select
```
