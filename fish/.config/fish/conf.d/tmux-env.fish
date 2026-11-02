# Existing shells keep the environment they were started with, so a pane
# created during an ssh session keeps SSH_CONNECTION after a local attach.
# Re-sync from the tmux session environment (which tmux updates on attach
# via update-environment) before each prompt and command.
# SSH_AUTH_SOCK is only taken from tmux while attached over ssh; locally tmux
# holds whatever the last client had (often unset or a dead socket), so use
# the local agent instead.
function __refresh_tmux_env --on-event fish_prompt --on-event fish_preexec
    set -q TMUX; or return

    for var in SSH_CONNECTION SSH_CLIENT SSH_TTY
        set -l line (tmux show-environment $var 2>/dev/null)
        test -n "$line"; or continue

        if string match -q -- "-*" $line
            set -e $var
        else
            set -gx $var (string split -m1 -- = $line)[2]
        end
    end

    if set -q SSH_CONNECTION
        set -l line (tmux show-environment SSH_AUTH_SOCK 2>/dev/null)
        string match -q -- "SSH_AUTH_SOCK=*" $line
        and set -gx SSH_AUTH_SOCK (string split -m1 -- = $line)[2]
    else if set -q __local_ssh_auth_sock
        set -gx SSH_AUTH_SOCK $__local_ssh_auth_sock
    end
end
