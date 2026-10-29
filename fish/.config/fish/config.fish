if status is-login

  if test "$(uname -s)" = "Darwin"
    /opt/homebrew/bin/brew shellenv | source
    fish_add_path -aP ~/Library/Application\ Support/JetBrains/Toolbox/scripts
    fish_add_path -P ~/Applications/IntelliJ\ IDEA.app/Contents/MacOS
    fish_add_path -aP ~/Library/Application\ Support/Coursier/bin

    if not set -q SSH_CONNECTION
      set -x SSH_AUTH_SOCK ~/Library/Group\ Containers/2BUA8C4S2C.com.1password/t/agent.sock
    end
  end

  # Make global Mise tools available in system PATH
  mise hook-env -s fish | source

  test -e ~/.cargo/env.fish; and source ~/.cargo/env.fish

  functions -q autostart-compositor; and autostart-compositor

  fish_add_path -aP ~/.local/bin
  fish_add_path -aP ~/.bin
end

function fish_prompt_loading_indicator
  echo (starship prompt --profile sync --terminal-width=$COLUMNS --keymap=$fish_bind_mode --status=$__async_prompt_last_pipestatus[-1])
end

# Under load, command timeouts are expected; don't paint them over the prompt.
set -gx STARSHIP_LOG error

function fish_focus_in --on-event fish_focus_in
    type -q __async_prompt_fire && __async_prompt_fire
end

starship init fish | source

if not status is-interactive
    return
end
### Everything after this line is only executed in interactive shells


set fish_greeting
set -x EDITOR "nvim"

if test "$TERM_PROGRAM" = "ghostty"
    tmux
end

fzf --fish | source
mise activate fish | source
zoxide init fish | source

set --global fish_key_bindings fish_vi_key_bindings


source $__fish_config_dir/bindings.fish
source $__fish_config_dir/aliases.fish
source $__fish_config_dir/theme.fish
source $__fish_config_dir/ndla.fish

