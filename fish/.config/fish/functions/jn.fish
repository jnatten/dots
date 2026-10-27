function jn --description "jj new on a picked bookmark or revision (alt-enter tracks untracked bookmarks first)"
    if set -q argv[1]
        jj new $argv
        return
    end

    set -l picked (__jj_pick lru --multi --expect alt-enter --prompt 'new> ' \
        --header 'enter: new · alt-enter: track + new · tab: merge · ctrl-/: preview')
    or return
    set -q picked[2]; or return

    set -l revs
    for ref in $picked[2..]
        if test "$picked[1]" = alt-enter; and string match -q '*@*' -- $ref
            jj bookmark track $ref; or return
            set ref (string replace -r '@[^@]*$' '' -- $ref)
        end
        set -a revs $ref
    end
    jj new $revs
end
