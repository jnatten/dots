if status is-login

  if test "$(uname -s)" = "Darwin"
    /opt/homebrew/bin/brew shellenv | source
    fish_add_path -aP "/Users/jonasnatten/Library/Application Support/JetBrains/Toolbox/scripts"
    fish_add_path -aP "/Users/jonasnatten/Library/Application Support/Coursier/bin"
  end

  # Make global Mise tools available in system PATH
  mise hook-env -s fish | source

  test -e ~/.cargo/env.fish; and source ~/.cargo/env.fish

  functions -q autostart-compositor; and autostart-compositor

  fish_add_path -aP ~/.local/bin
  fish_add_path -aP ~/.bin
end

if not status is-interactive
    return
end
### Everything after this line is only executed in interactive shells


set fish_greeting
set -x EDITOR "nvim"

if test "$TERM_PROGRAM" = "ghostty"
    tmux
end

mise activate fish | source
zoxide init fish | source
starship init fish | source

set --global fish_key_bindings fish_vi_key_bindings


# Ctrl-C to clear prompt and new line no matter what
function __ctrl_c_newline
    commandline ""
    printf "\n"
    commandline -f force-repaint
end

bind \cc __ctrl_c_newline
bind -M insert \cc __ctrl_c_newline

source $__fish_config_dir/aliases.fish
source $__fish_config_dir/theme.fish

