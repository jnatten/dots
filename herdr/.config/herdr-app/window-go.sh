#!/bin/sh
# Moves into the Herdr window beside this one, when opt+h/j/k/l (jj-tabs' go-* commands)
# finds no pane further that way: brings it to the front and focuses its pane nearest the
# edge we came from. Herdr windows are separate apps (new-window.sh), so macOS finds them:
# the on-screen Herdr windows, the frontmost being the one the key was pressed in. Raising
# one goes through System Events, which macOS asks about once.
set -eu
dir=${1:-}
case $dir in
  left) back=right ;;
  right) back=left ;;
  up) back=down ;;
  down) back=up ;;
  *) echo "usage: window-go.sh left|right|up|down" >&2; exit 2 ;;
esac

pid=$(osascript -l JavaScript - "$dir" <<'EOF'
ObjC.import("CoreGraphics");
function run([dir]) {
  const raw = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID);
  const seen = new Set(), wins = [];
  for (const w of ObjC.deepUnwrap(ObjC.castRefToObject(raw))) {
    const b = w.kCGWindowBounds;
    if (w.kCGWindowOwnerName !== "Herdr" || w.kCGWindowLayer !== 0 || b.Width < 200 || b.Height < 200 || seen.has(w.kCGWindowOwnerPID)) continue;
    seen.add(w.kCGWindowOwnerPID);
    wins.push({ pid: w.kCGWindowOwnerPID, l: b.X, t: b.Y, r: b.X + b.Width, b: b.Y + b.Height });
  }
  const [from, ...rest] = wins;
  if (!from) return "";
  const gap = (w) => ({ right: w.l - from.r, left: from.l - w.r, down: w.t - from.b, up: from.t - w.b })[dir];
  const overlap = (w) => dir === "left" || dir === "right"
    ? Math.min(from.b, w.b) - Math.max(from.t, w.t)
    : Math.min(from.r, w.r) - Math.max(from.l, w.l);
  const to = rest.filter((w) => gap(w) > -40 && overlap(w) > 0)
    .sort((a, b) => Math.abs(gap(a)) - Math.abs(gap(b)) || overlap(b) - overlap(a))[0];
  if (!to) return "";
  Application("System Events").processes.whose({ unixId: to.pid })[0].frontmost = true;
  return String(to.pid);
}
EOF
)
[ -n "$pid" ] || exit 0

home=$(ps -Eww -o command= -p "$pid" | tr ' ' '\n' | sed -n 's/^HERDR_APP_HOME=//p')
export HERDR_APP_HOME="${home:-$HOME/.config/herdr-app}"

focused() { herdr-app status | sed -n 's/.*"focused_pane": *"\([^"]*\)".*/\1/p'; }
last=$(focused)
i=0
while [ "$i" -lt 8 ]; do
  herdr-app do "pane.go:$back" >/dev/null 2>&1 || break
  now=$(focused)
  [ "$now" = "$last" ] && break
  last=$now
  i=$((i + 1))
done
