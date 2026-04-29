
# Ctrl-C to clear prompt and new line no matter what
function __ctrl_c_newline
    commandline ""
    printf "\n"
    commandline -f force-repaint
end

bind \cc __ctrl_c_newline
bind -M insert \cc __ctrl_c_newline


# Ctrl-P to previous command
bind \cp up-or-search
bind -M insert \cp up-or-search

# Ctrl-N to previous command
bind \cp down-or-search
bind -M insert \cp down-or-search

bind \cf accept-autosuggestion
bind -M insert \cf accept-autosuggestion

bind \cg accept-autosuggestion execute
bind -M insert \cg accept-autosuggestion execute
