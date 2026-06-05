# Existing shells keep the environment they were started with, so a pane
# created during an ssh session keeps SSH_CONNECTION after a local attach.
# Re-sync from the tmux session environment (which tmux updates on attach
# via update-environment) before each prompt.
function __refresh_tmux_env --on-event fish_prompt
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
end
