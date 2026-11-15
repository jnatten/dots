# The agent ssh, git and jj's signing use outside an ssh session: this Mac's 1Password,
# but in a Herdr terminal on a machine marked with ~/.ssh/prefer-forwarded-agent (one
# mostly driven from another, as macwg is from Herdr on the mbp), an agent that a live
# ssh session forwarded to it (OpenSSH keeps those in ~/.ssh/agent; Herdr's own
# connection is one), so 1Password asks on the machine you're at. Checked again before
# each command: a reconnect forwards a new one.
function __ssh_agent --on-event fish_preexec
    set -q SSH_CONNECTION; and return
    set -q __local_ssh_auth_sock; or return
    if set -q HC_TERMINAL_ID; and test -e ~/.ssh/prefer-forwarded-agent
        string match -q -- "$HOME/.ssh/agent/*" "$SSH_AUTH_SOCK"; and test -S "$SSH_AUTH_SOCK"; and return
        set -l socks ~/.ssh/agent/s.*.sshd.*
        if set -q socks[1]
            for s in (command ls -t $socks)
                if SSH_AUTH_SOCK=$s ssh-add -l >/dev/null 2>&1
                    set -gx SSH_AUTH_SOCK $s
                    return
                end
            end
        end
    end
    set -gx SSH_AUTH_SOCK $__local_ssh_auth_sock
end
