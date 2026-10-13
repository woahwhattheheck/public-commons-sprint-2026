#!/bin/sh
# TokenJunkieLabs - open the original received scientific workbench.
# Keep this file beside application/, workspace/ and the supplied runtime/.
set -eu

fail() {
    printf '%s\n' "$*" >&2
    exit 1
}
case "${1-}" in
    --help|-h)
        printf '%s\n' 'Open the received scientific workbench on Linux x86_64.' \
            'Open_Workbench.sh                open or reopen this project' \
            'Open_Workbench.sh --no-browser   print the private same-machine address' \
            'Open_Workbench.sh --status       inspect the saved local session' \
            'Keep the original owning terminal open while using the application.'
        exit 0
        ;;
esac
[ "$#" -le 1 ] || fail 'Use no option, --no-browser, --status or --help.'
case "${1-}" in ''|--no-browser|--status) ;; *) fail 'Use no option, --no-browser, --status or --help.' ;; esac
[ "$(uname -s)" = Linux ] || fail 'This supplied runtime opens on Linux x86_64. Use the complete package on that platform.'
[ "$(uname -m)" = x86_64 ] || fail 'This supplied runtime requires a Linux x86_64 machine.'
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P) || fail 'Cannot locate this received project.'
APP="$ROOT/application"
WORKSPACE="$ROOT/workspace"
RUNTIME="$ROOT/runtime"
PYTHON="$RUNTIME/bin/python"
LAUNCHER="$APP/source_tools/open_received_study.py"
PROFILE="$ROOT/workbench.json"
[ -f "$LAUNCHER" ] || fail 'The application is incomplete. Restore its complete application folder beside this launcher.'
[ -f "$APP/source_tools/workbench_session.py" ] || fail 'The application is missing its original workbench session helper. Restore the complete application.'
[ -f "$APP/source_tools/native_runtime/invocation.py" ] || fail 'The application is missing its native runtime invocation. Restore the complete application.'
[ -f "$WORKSPACE/workspace.json" ] || fail 'The original workspace folder is missing. Restore the complete project beside this launcher.'
[ -x "$PYTHON" ] || fail 'Extract the supplied Linux runtime as runtime/ beside application/ and workspace/, then use its documented one-time conda-unpack step.'
[ -d "$RUNTIME/share/proj" ] || fail 'The received runtime is missing its PROJ data. Restore the complete supplied runtime.'
[ -d "$RUNTIME/share/gdal" ] || fail 'The received runtime is missing its GDAL data. Restore the complete supplied runtime.'
unset PYTHONHOME PYTHONPATH
export PROJ_DATA="$RUNTIME/share/proj"
export GDAL_DATA="$RUNTIME/share/gdal"

# Windows shortcut uses the standard browser hook; the original launcher still
# owns startup, authentication, reuse and graceful shutdown.
if [ "${ECO_WORKBENCH_WINDOWS_BROWSER-}" = 1 ]; then
    [ -f "$APP/source_tools/open_windows_browser.py" ] || fail 'Receive the complete Windows browser helper with this opening source.'
    export BROWSER="\"$PYTHON\" \"$APP/source_tools/open_windows_browser.py\" %s"
fi

# A saved profile retains the original project/runtime/source selection.
# The maintained launcher authenticates and reuses that selection's active server.
# Explicit receiving-machine ECOSYSTEMS_PYTHON remains its supported override.
if [ -e "$PROFILE" ] || [ -L "$PROFILE" ]; then
    [ -f "$PROFILE" ] && [ ! -L "$PROFILE" ] || fail 'workbench.json must be the original regular project opening file.'
    exec "$PYTHON" -B "$LAUNCHER" --profile "$PROFILE" "$@"
fi
# --status remains read-only and never creates a profile or starts a server.
if [ "${1-}" = --status ]; then
    exec "$PYTHON" -B "$LAUNCHER" --workspace "$WORKSPACE" --python "$PYTHON" --native --status
fi
# Ask the maintained native invocation to load the actual selected libraries.
# This reads the environment; it never relocates an active/existing runtime.
if ! "$PYTHON" -B "$APP/source_tools/native_runtime/invocation.py" --python "$PYTHON" --application "$APP" --inspect; then
    printf '%s\n' 'The supplied runtime could not open its selected scientific libraries.' >&2
    if [ -f "$RUNTIME/bin/conda-unpack" ]; then
        printf '%s\n' 'For a freshly extracted runtime, its original one-time relocation command is:' >&2
        printf '"%s" "%s"\n' "$PYTHON" "$RUNTIME/bin/conda-unpack" >&2
        printf '%s\n' 'Run that only for this newly extracted runtime, then open the same shortcut again.' >&2
    else
        printf '%s\n' 'Restore the complete supplied runtime and follow its original receiving instructions.' >&2
    fi
    printf '%s\n' 'An already-running workbench remains owned by its original terminal.' >&2
    exit 1
fi
printf '%s\n' 'Opening the original scientific workbench. Keep this terminal open.'
exec "$PYTHON" -B "$LAUNCHER" --workspace "$WORKSPACE" --python "$PYTHON" --native --save-profile "$PROFILE" "$@"
