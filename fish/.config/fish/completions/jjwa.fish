function __jjwa_delegate
    set -l tokens (commandline --current-process --tokens-raw --cut-at-cursor)
    set -l current (commandline --current-token --cut-at-cursor)
    set -e tokens[1]
    complete --do-complete "jj $tokens $current"
end

complete -c jjwa -f
complete -c jjwa -a '(__jjwa_delegate)'
