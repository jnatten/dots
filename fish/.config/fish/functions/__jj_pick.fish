function __jj_pick --description "fzf over jj bookmarks (l local, u untracked, t tracked remote) and revisions (r)" --argument-names kinds
    set -l jj jj --ignore-working-copy --color=always --config 'colors.pick_untracked="bright black"'
    set -l id 'pad_end(10, if(normal_target, normal_target.change_id().shortest(8), label("conflict", "conflicted")))'
    set -l desc 'if(normal_target, coalesce(normal_target.description().first_line(), description_placeholder))'

    set -l remote_kinds
    string match -q '*u*' -- $kinds; and set -a remote_kinds '!tracked'
    string match -q '*t*' -- $kinds; and set -a remote_kinds tracked

    begin
        string match -q '*l*' -- $kinds
        and $jj bookmark list --sort committer-date- \
            -T 'if(!remote && present, "l\t" ++ name ++ "\t" ++ '$id' ++ pad_end(32, label("bookmark", name)) ++ " " ++ '$desc' ++ "\n")'

        string match -q '*r*' -- $kinds
        and $jj log --no-graph -r 'log_this_workspace() ~ (bookmarks() | remote_bookmarks())' \
            -T '"r\t" ++ if(divergent, commit_id.short(), change_id.short()) ++ "\t" ++ pad_end(10, change_id.shortest(8)) ++ pad_end(32, if(current_working_copy, label("working_copy", "@"))) ++ " " ++ coalesce(description.first_line(), description_placeholder) ++ "\n"'

        set -q remote_kinds[1]
        and $jj bookmark list --all-remotes --sort committer-date- \
            -T 'if(remote && remote != "git" && ('(string join ' || ' -- $remote_kinds)'), if(tracked, "t", "u") ++ "\t" ++ stringify(self) ++ "\t" ++ '$id' ++ pad_end(32, label(if(tracked, "bookmark", "pick_untracked"), stringify(self))) ++ " " ++ '$desc' ++ "\n")'
    end | fzf --ansi --delimiter \t --with-nth 3.. --accept-nth 2 --tiebreak index \
        --height 60% --layout reverse \
        --with-shell 'sh -c' \
        --preview 'jj --ignore-working-copy --color=always log -r "log_branch("{2}")"' \
        --preview-window 'right,50%,<60(down,50%)' \
        --bind 'ctrl-/:toggle-preview' \
        $argv[2..]
end
