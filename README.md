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
compiler at login. Two things to know if it does not come up:

- The plist hardcodes `/Users/jonas`, since launchd expands neither `~` nor
  `$HOME`. A different username means editing
  `ccdots/Library/LaunchAgents/dev.natten.ccdots.plist`.
- The committed binary is arm64. Run `make` on anything else, which needs the
  Xcode command line tools.

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
