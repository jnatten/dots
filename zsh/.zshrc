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
	kubectl 
	zsh-autosuggestions
	web-search
	yarn
	docker
)

function gwl() {
  WLS=$(git worktree list)
  FOUND=$(echo $WLS | fzf)
  if [ -z "${FOUND}" ]; then
    echo "Cancelled..."
  else
    echo "Going to worktree -> $FOUND"
    CDDIR=$(echo $FOUND | cut -d' ' -f1)
    cd $CDDIR
  fi

}


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
alias cat='bat -n'

# Created by `pipx` on 2022-08-03 07:25:25
export PATH="$PATH:/home/jonas/.local/bin"
# eval "$(register-python-argcomplete pipx)" # Also slow, probably useful if we use pipx?
eval "$(starship init zsh)"

function bwcopy() {
  if [[ -z "$BW_SESSION" ]]; then
    export BW_SESSION=$(bw unlock --passwordfile ~/.bw --raw)
  fi
  if hash bw 2>/dev/null; then
    bw get item "$(bw list items | jq '.[] | "\(.name) | username: \(.login.username) | id: \(.id)" ' | fzf-tmux | awk '{print $(NF -0)}' | sed 's/\"//g')" | jq '.login.password' | sed 's/\"//g' | pbcopy
  fi
}

function supervim() {
  WHERE=$1
  COMP_PATH=$(readlink -f $WHERE)
  NAME=$(basename $COMP_PATH)

  tmux neww -n $NAME
  tmux send-keys -t $NAME cd Space $COMP_PATH Enter
  tmux send-keys -t $NAME vim Enter
  tmux split -t $NAME -l 10
  tmux send-keys -t $NAME cd Space $COMP_PATH Enter
  tmux select-pane -t $NAME -D
}

eval "$(mise activate zsh)"
eval "$(mise completion zsh)"
eval "$(uv generate-shell-completion zsh)"


alias mill='MILL_OUTPUT_DIR=out-term ./mill'

source ~/.zsh_ndla

