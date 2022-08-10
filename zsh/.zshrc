if [[ "$TMUX" = "" && -t 1 ]]; then 
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
	asdf 
	kubectl 
	zsh-autosuggestions
	web-search
	yarn
)

source $ZSH/oh-my-zsh.sh

# . /usr/local/opt/asdf/libexec/asdf.sh

export PATH=$PATH:~/.bin
export PATH=$PATH:~/.rd/bin
export PATH=$PATH:~/dev/blackbox/bin
source ~/.zsh_ndla

alias confignvim='$EDITOR ~/.config/nvim/init.vim'


alias vim='nvim'
alias gs='git status'
alias gd='git diff'
alias gds='git diff --staged'
alias gco='git checkout'
alias gcm='git checkout master'
alias ls='exa'
alias kc='kubie ctx'
alias kn='kubie ns'
alias k='kubectl'
alias gpr='cd $(git root)'
alias gpo='git push -u origin $(git branch --show-current)'
export PATH="/usr/local/opt/libpq/bin:$PATH"

source ~/.zoxiderc

# Created by `pipx` on 2022-08-03 07:25:25
export PATH="$PATH:/home/jonas/.local/bin"
eval "$(register-python-argcomplete pipx)"  
eval "$(starship init zsh)"
