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

### neovim

The neovim config has some dependencies:

- https://github.com/pappasam/jedi-language-server
- https://rust-analyzer.github.io/manual.html#installation

```bash
npm install -g typescript typescript-language-server eslint prettier @fsouza/prettierd
```

```bash
pipx install python-lsp-server
pipx install pylsp-mypy
pipx inject python-lsp-server pylsp-mypy
```

### zsh

The .zshrc config is using [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh/)

### tmux

Utilizes [tpm](https://github.com/tmux-plugins/tpm)

```bash
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
```
