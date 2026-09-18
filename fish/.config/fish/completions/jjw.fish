function __jjw_workspaces
    jj workspace list -T 'name ++ "\n"' 2>/dev/null
end

function __jjw_delegate
    set -l tokens (commandline --current-process --tokens-raw --cut-at-cursor)
    set -l current (commandline --current-token --cut-at-cursor)
    set -e tokens[1..2]
    complete --do-complete "jj $tokens $current"
end

complete -c jjw -f
complete -c jjw -n __fish_is_first_arg -a '(__jjw_workspaces)' -d Workspace
complete -c jjw -n 'not __fish_is_first_arg' -a '(__jjw_delegate)'
