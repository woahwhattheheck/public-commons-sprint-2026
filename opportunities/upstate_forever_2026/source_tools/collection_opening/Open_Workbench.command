#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
fail() { printf '%s\n' "$*" >&2; exit 2; }
[ "$(uname -s)" = Darwin ] || fail 'Use the opening file supplied for this operating system.'
# Detect the native Apple Silicon machine even from a translated terminal.
if [ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || printf 0)" = 1 ]; then
  TARGET=macos-arm64
else
  TARGET=macos-x86_64
fi
SPEC="$ROOT/NATIVE_RUNTIME.json"
field() { /usr/bin/plutil -extract "platforms.$TARGET.$1" raw -o - "$SPEC"; }
relative() {
  case "$1" in ''|/*|*\\*|*:*|.|..|./*|../*|*/./*|*/../*|*/.|*/..|*//*|*/) return 1;; esac
}
no_alias() {
  BASE=$1; REL=$2
  relative "$REL" || fail 'A supplied bootstrap member leaves its directory.'
  while :; do
    case "$REL" in */*) PART=${REL%%/*}; REL=${REL#*/};; *) PART=$REL; REL=;; esac
    BASE="$BASE/$PART"
    [ ! -L "$BASE" ] || fail "A supplied bootstrap member is an alias: $BASE"
    [ -e "$BASE" ] || fail "A supplied bootstrap member is missing: $BASE"
    [ -n "$REL" ] || break
  done
}
unset PYTHONHOME PYTHONPATH
export PYTHONNOUSERSITE=1
if [ -n "${ECOSYSTEMS_PYTHON:-}" ]; then
  PYTHON=$ECOSYSTEMS_PYTHON
else
  DIRECTORY=$(field bootstrap.directory) || fail 'Keep the matching macOS bootstrap in this collection.'
  EXECUTABLE=$(field bootstrap.python) || fail 'The supplied bootstrap has no Python selection.'
  no_alias "$ROOT" "$DIRECTORY"
  BOOTSTRAP="$ROOT/$DIRECTORY"
  no_alias "$BOOTSTRAP" "$EXECUTABLE"
  PYTHON="$BOOTSTRAP/$EXECUTABLE"
  # Validate the executable with native macOS tools before starting Python.
  # The Python entry point validates the entire original bootstrap inventory.
  INDEX=0; FOUND=0
  while MEMBER=$(field "bootstrap.files.$INDEX.path" 2>/dev/null); do
    if [ "$MEMBER" = "$EXECUTABLE" ]; then
      EXPECTED=$(field "bootstrap.files.$INDEX.sha256")
      BYTES=$(field "bootstrap.files.$INDEX.bytes")
      [ "$(/usr/bin/stat -f %z "$PYTHON")" = "$BYTES" ] || fail 'The supplied bootstrap interpreter is incomplete.'
      ACTUAL=$(/usr/bin/shasum -a 256 < "$PYTHON"); ACTUAL=${ACTUAL%% *}
      [ "$ACTUAL" = "$EXPECTED" ] || fail 'The supplied bootstrap interpreter differs from its original.'
      FOUND=1; break
    fi
    INDEX=$((INDEX + 1))
  done
  [ "$FOUND" = 1 ] || fail 'The supplied interpreter is absent from its bootstrap inventory.'
  # A Windows/filesystem ZIP round trip can retain all bytes but lose execute
  # permission. Repair only this byte-verified supplied interpreter; never an
  # explicitly selected external Python, aliases, or unrelated bootstrap files.
  if [ ! -x "$PYTHON" ]; then
    /bin/chmod u+x "$PYTHON" || fail 'The verified supplied Python cannot be made executable in this folder.'
  fi
fi
[ -x "$PYTHON" ] || fail 'The supplied Python is not executable. Extract the complete original ZIP with Archive Utility.'
exec "$PYTHON" -I -B "$ROOT/open_native_collection.py" "$@"
