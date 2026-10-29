function jjwr --description "Remove picked jj workspaces from disk"
    set -l current (jj --ignore-working-copy workspace root)
    or return
    set -l main
    set -l here
    set -l entries
    for line in (jj --ignore-working-copy --color=always workspace list \
            -T 'if(root, name ++ "\t" ++ root.absolute() ++ "\t" ++ pad_end(10, target.change_id().shortest(8)) ++ pad_end(32, label(if(target.current_working_copy(), "working_copy"), name)) ++ " " ++ coalesce(target.description().first_line(), description_placeholder) ++ "\n")')
        set -l fields (string replace -ra '\e\[[0-9;]*m' '' -- $line | string split -m2 \t)
        if test -d $fields[2]/.jj/repo
            set main $fields[2]
        else
            set -a entries $line
            test "$fields[2]" = "$current"; and set here (string join \t $fields[1..2])
        end
    end

    set -l fzf_opts --ansi --delimiter \t --with-nth 3.. --accept-nth 1,2
    set -l picked
    if test "$argv" = .
        set -q here[1]; or begin
            echo "jjwr: the main workspace can't be removed" >&2
            return 1
        end
        set picked $here
    else if set -q argv[1]
        set picked (printf '%s\n' $entries | fzf $fzf_opts --filter "$argv")
    end

    if test (count $picked) -eq 1
        read -l -P "Remove workspace "(string split -f1 \t -- $picked)"? [y/N] " reply
        string match -qi y -- $reply; or return 1
    else
        set picked (printf '%s\n' $entries | fzf $fzf_opts --multi --tiebreak index \
            --height 60% --layout reverse --exit-0 \
            --prompt 'remove> ' --query "$argv" \
            --header 'enter: remove · tab: select multiple · ctrl-/: preview' \
            --with-shell 'sh -c' \
            --preview 'jj -R {2} --ignore-working-copy --color=always log -r "log_branch(@)"' \
            --preview-window 'right,50%,<60(down,50%)' \
            --bind 'ctrl-/:toggle-preview')
        or return
    end

    set -l names
    for entry in $picked
        set -l name (string split -f1 \t -- $entry)
        set -l root (string split -f2 \t -- $entry)
        set -a names $name
        if string match -q -- $root $PWD; or string match -q -- "$root/*" $PWD
            cd $main; or return
        end
    end
    jj workspace remove $names
end
