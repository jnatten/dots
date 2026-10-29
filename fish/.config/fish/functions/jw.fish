function jw --description "cd to a picked jj workspace in the current repo"
    set -l root (jj --ignore-working-copy --color=always workspace list \
        -T 'if(root, root.absolute() ++ "\t" ++ pad_end(10, target.change_id().shortest(8)) ++ pad_end(32, label(if(target.current_working_copy(), "working_copy"), name)) ++ " " ++ coalesce(target.description().first_line(), description_placeholder) ++ "\n")' \
        | fzf --ansi --delimiter \t --with-nth 2.. --accept-nth 1 --tiebreak index \
            --height 60% --layout reverse --select-1 --exit-0 \
            --prompt 'workspace> ' --query "$argv" \
            --with-shell 'sh -c' \
            --preview 'jj -R {1} --ignore-working-copy --color=always log -r "log_branch(@)"' \
            --preview-window 'right,50%,<60(down,50%)' \
            --bind 'ctrl-/:toggle-preview')
    or return
    cd $root
end
