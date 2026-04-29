# Custom configuration that is specific to THIS system
source ~/.zshcustom

if [[ -z $ALACRITTY_LOG && -z $WEINKITTY && "$TERM_PROGRAM" != "ghostty" ]]; then
  # Disable auto spawning tmux if not in alacritty (Nice in intellij since it sucks with tmux)
  case $(tty) in
    (/dev/tty[1-9]) ;;
              (*) export DISABLE_AUTO_TMUX=true;;
  esac
fi

if [[ "$TMUX" = "" && -t 1 && "$DISABLE_AUTO_TMUX" = "" ]]; then 
	case $(tty) in 
	  (/dev/tty[1-9]) ;;
		      (*) tmux;;
esac
fi 

export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="robbyrussell"

export EDITOR=nvim
export GPG_TTY=$(tty)

export HISTFILE=~/.zsh_history
export HISTSIZE=100000
export SAVEHIST=100000


plugins=(
	git 
	vi-mode 
	zsh-autosuggestions
	yarn
)

source $ZSH/oh-my-zsh.sh
source ~/.zshcustom_late

export PATH=$PATH:~/.bin
export PATH=$PATH:~/.rd/bin
export PATH=$PATH:~/dev/blackbox/bin

alias confignvim='$EDITOR ~/.config/nvim/init.vim'

bindkey '^f' end-of-line # Binds Ctrl+f to go to end of line. Useful with zsh-autosuggestion

alias vim='nvim'
alias gs='git status'
alias gd='git dft'
alias gdd='git diff'
alias gds='git dft --staged'
alias gdds='git diff --staged'
alias gco='git checkout'
alias gcm='git checkout master'
alias ls='eza'
alias kc='kubie ctx'
alias kn='kubie ns'
alias k='kubectl'
alias gpr='cd $(git root)'
alias gpo='git push -u origin $(git branch --show-current)'
alias gch='git checkout $(git branch --sort=-committerdate -a | sed "s/remotes\/origin\///g" | uniq | fzf --no-sort)'

export PATH="/usr/local/opt/libpq/bin:$PATH"

source ~/.zoxiderc
alias cd='z'
alias cat='bat'

export PATH="$PATH:/home/jonas/.local/bin"
eval "$(starship init zsh)"
eval "$(mise activate zsh)"
eval "$(uv generate-shell-completion zsh)"
# source ~/.cache/mill/download/mill-completion.sh

source "$HOME/.cargo/env"

if [ "$TERM_PROGRAM" = "tmux"  ]; then
  # Since intellij sources zshrc for some reason when running mill, we need to set the output dir in a if statement
  export MILL_OUTPUT_DIR=out-term
fi

alias mill='MILL_OUTPUT_DIR=out-term ./mill'

source ~/.zsh_ndla

