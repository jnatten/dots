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

### tmux

Utilizes [tpm](https://github.com/tmux-plugins/tpm)
Other dependencies: [tmux-url-select](https://github.com/dequis/tmux-url-select)

```bash
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
curl https://raw.githubusercontent.com/dequis/tmux-url-select/master/tmux-url-select.pl > ~/.bin/tmux-url-select && chmod +x ~/.bin/tmux-url-select
```
