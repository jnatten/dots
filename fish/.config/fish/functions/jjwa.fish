function jjwa --description "Run a jj command in all other workspaces"
    set -l current (jj workspace root)
    or return $status

    set -l failed 0
    for name in (jj workspace list -T 'name ++ "\n"')
        set -l root (jj workspace root --name $name)
        or begin
            set failed 1
            continue
        end
        test "$root" = "$current"; and continue

        echo (set_color --bold)$name(set_color normal)
        jj -R $root $argv
        or set failed 1
    end
    return $failed
end
