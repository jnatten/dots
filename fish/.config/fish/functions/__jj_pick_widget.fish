function __jj_pick_widget --description "Insert picked jj bookmarks or revisions at the cursor"
    set -l tokens (commandline --current-process --tokens-raw --cut-at-cursor)
    set -l words (string match -rv -- '^-' $tokens)
    set -l kinds lru

    set -l i (contains -i -- bookmark $words; or contains -i -- b $words)
    if test -n "$i"; and not string match -qr -- '^(-[rtf]|--(revisions?|to|from))$' "$tokens[-1]"
        set -l sub $words[(math $i + 1)]
        switch "$sub"
            case track t
                set kinds u
            case untrack
                set kinds t
            case delete d forget f move m rename r set s advance a
                set kinds l
        end
    end

    set -l refs (__jj_pick $kinds --multi "--query=$(commandline -ct)")
    and commandline -rt -- (string join ' ' -- (string escape -- $refs))' '
    commandline -f repaint
end
