if status is-login
    test "$(uname -s)" = "Darwin"; and /opt/homebrew/bin/brew shellenv | source

    # Make global Mise tools available in system PATH
    mise hook-env -s fish | source

    test -e ~/.cargo/env.fish; and source ~/.cargo/env.fish

    functions -q autostart-compositor; and autostart-compositor
end

if not status is-interactive
    return
end


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
    echo
    commandline -f repaint
end
bind \cc __ctrl_c_newline
bind -M insert \cc __ctrl_c_newline

source $__fish_config_dir/aliases.fish
source $__fish_config_dir/theme.fish

