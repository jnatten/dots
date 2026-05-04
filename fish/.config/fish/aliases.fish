function git_current_branch
  set -l ref (git symbolic-ref --quiet HEAD 2>/dev/null)

  switch $status
    case 0
      string replace -r '^refs/heads/' '' -- $ref
    case 128
      return
    case '*'
      set ref (git rev-parse --short HEAD 2>/dev/null)
      or return
      echo $ref
  end
end

alias ls="eza"
alias la="eza -la"
alias ll="eza -l"
alias cat="bat"
alias vim="nvim"
alias cd="z"

abbr -a ng 'nvim -c "Neogit" -c "cnoreabbrev q qa"'
abbr -a g git
abbr -a gs git status
abbr -a gd git dft
abbr -a gdd git diff
abbr -a gds git dft --staged
abbr -a gdds git diff --staged
abbr -a gap git add -p

abbr -a gpr 'cd (git root)'
abbr -a gpo 'git push -u origin (git branch --show-current)'
abbr -a gch 'git checkout (git branch --sort=-committerdate -a | sed "s/remotes\/origin\///g" | uniq | fzf --no-sort)'
abbr -a k kubectl
abbr -a groh 'git reset origin/(git_current_branch) --hard'
abbr -a gp 'git push'
abbr -a gl 'git pull'
abbr -a gL 'git log'
abbr -a gco 'git checkout'
abbr -a gfwl 'git push --force-with-lease --force-if-includes'
abbr -a gcm 'git checkout master'
abbr -a kc 'kubie ctx'
abbr -a kn 'kubie ns'
abbr -a mill './mill'

