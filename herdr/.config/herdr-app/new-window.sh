#!/bin/sh
# Opens another Herdr window: another app with a home of its own (~/.config/herdr-app-2,
# -3, …), connected to the same herdr-core, so it shows the same spaces and terminals
# with its own selection, focus and place on screen. This setup's files are linked from
# the main home; its settings are a copy with sounds off (the main window chimes);
# jj-state.json is the state the windows share (jj-limits keeps it).
set -eu
main="$HOME/.config/herdr-app"

n=2
while HERDR_APP_HOME="$HOME/.config/herdr-app-$n" herdr-app status >/dev/null 2>&1; do n=$((n + 1)); done
dir="$HOME/.config/herdr-app-$n"

mkdir -p "$dir/layouts" "$dir/mods"
[ -e "$main/jj-state.json" ] || python3 - "$main/shared.json" "$main/jj-state.json" <<'EOF'
import json, sys
try:
    shared = json.load(open(sys.argv[1]))
except Exception:
    shared = {}
state = {k: shared[k] for k in ("space.colors", "jj-sessions.archived") if shared.get(k) is not None}
open(sys.argv[2], "w").write(json.dumps(state, indent=2) + "\n")
EOF
for f in keys.json jj-settings.json jj-state.json CLAUDE.md; do ln -sfn "$main/$f" "$dir/$f"; done
ln -sfn "$main/layouts/jj.json" "$dir/layouts/jj.json"
for m in "$main"/mods/jj-*; do ln -sfn "$m" "$dir/mods/$(basename "$m")"; done

python3 - "$main/settings.json" "$dir/settings.json" <<'EOF'
import json, sys
s = json.load(open(sys.argv[1]))
s.setdefault("sounds", {})["enabled"] = False
open(sys.argv[2], "w").write(json.dumps(s, indent=2) + "\n")
EOF
[ -e "$dir/shared.json" ] || printf '{"layout":"jj","frame.welcomed":"finished"}\n' >"$dir/shared.json"
[ -e "$dir/update-notes.json" ] || cp "$main/update-notes.json" "$dir/update-notes.json" 2>/dev/null || true

open -n -a Herdr --env HERDR_APP_HOME="$dir"
