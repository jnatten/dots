function jjw --description "Run a jj command in another workspace"
    if test (count $argv) -eq 0
        jj workspace list
        return $status
    end

    set -l root (jj workspace root --name $argv[1])
    or return $status

    jj -R $root $argv[2..]
end
