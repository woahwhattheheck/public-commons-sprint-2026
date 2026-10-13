#!/bin/sh
# Called on stdin by the optional existing-WSL shortcut.
set -eu
[ -n "${WORKBENCH_WIN_ROOT-}" ] || {
    printf '%s\n' 'The existing WSL distribution did not translate this project directory.' >&2
    exit 1
}
[ -f "$WORKBENCH_WIN_ROOT/Open_Workbench.sh" ] || {
    printf '%s\n' 'The complete Linux opening file is missing beside this project.' >&2
    exit 1
}
export ECO_WORKBENCH_WINDOWS_BROWSER=1
exec /bin/sh "$WORKBENCH_WIN_ROOT/Open_Workbench.sh" "$@"
