#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$(uname -s)" = Darwin ]; then
  exec /bin/sh "$ROOT/Open_Workbench.command" "$@"
fi
RECEIVER="$ROOT/application/source_tools/receive_native_runtime.py"
SPEC="$ROOT/NATIVE_RUNTIME.json"

unset PYTHONHOME PYTHONPATH
export PYTHONNOUSERSITE=1

# An explicit qualified interpreter remains authoritative.
if [ -n "${ECOSYSTEMS_PYTHON:-}" ]; then
  exec "$ECOSYSTEMS_PYTHON" -B "$RECEIVER" --application "$ROOT/application" \
    --spec "$SPEC" --open-script "$ROOT/OPEN.sh" -- "$@"
fi

# An exported empty selector is absent, just as in the shell branch above.
unset ECOSYSTEMS_PYTHON
BOOTSTRAP=
if command -v python3 >/dev/null 2>&1; then
  CANDIDATE=$(command -v python3)
  if "$CANDIDATE" -I -c 'import tarfile; raise SystemExit(0 if hasattr(tarfile, "data_filter") else 1)' >/dev/null 2>&1; then
    BOOTSTRAP=$CANDIDATE
  fi
fi
if [ -z "$BOOTSTRAP" ]; then
  RUNTIME_STORAGE=${ECOSYSTEMS_RUNTIME_STORAGE:-"${XDG_DATA_HOME:-"$HOME/.local/share"}/ecosystem-workbench/runtimes"}
  # A retained installed interpreter can bootstrap the SAME receiver after
  # moving the collection, without unpacking another temporary copy.
  for CANDIDATE in "$RUNTIME_STORAGE/50d241618c1fade7179bf9d4e3fec8da5fc377b0b190ea056ce51e7081a74172"/attempt-*/runtime/bin/python "$ROOT/runtime/bin/python"; do
    if [ -x "$CANDIDATE" ] && "$CANDIDATE" -I -c 'import tarfile; raise SystemExit(0 if hasattr(tarfile, "data_filter") else 1)' >/dev/null 2>&1; then
      BOOTSTRAP=$CANDIDATE
      break
    fi
  done
fi
if [ -n "$BOOTSTRAP" ]; then
  exec "$BOOTSTRAP" -B "$RECEIVER" --application "$ROOT/application" \
    --spec "$SPEC" --open-script "$ROOT/OPEN.sh" -- "$@"
fi

# Bootstrap only from the original supplied raw pack. Its canonical receiver
# still owns final installation, relocation, locking and scientific qualification.
ARCHIVE=${ECOSYSTEMS_RUNTIME_ARCHIVE:-"$ROOT/Ecosystem_Native_Runtime_Linux_x86_64.tar.gz"}
if [ ! -f "$ARCHIVE" ] || [ -L "$ARCHIVE" ]; then
  printf '%s\n' 'Keep the complete original scientific runtime archive beside the opening files.' >&2
  exit 2
fi
if [ "$(wc -c < "$ARCHIVE" | tr -d '[:space:]')" != 249771729 ]; then
  printf '%s\n' 'The original scientific runtime archive is incomplete.' >&2
  exit 2
fi
ARCHIVE_HASH=$(sha256sum < "$ARCHIVE")
ARCHIVE_HASH=${ARCHIVE_HASH%% *}
if [ "$ARCHIVE_HASH" != 50d241618c1fade7179bf9d4e3fec8da5fc377b0b190ea056ce51e7081a74172 ]; then
  printf '%s\n' 'The scientific runtime archive differs from the supplied original.' >&2
  exit 2
fi
BOOTSTRAP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/eco-runtime-bootstrap.XXXXXXXX")
chmod 700 "$BOOTSTRAP_DIR"
printf '%s\n' 'Preparing the supplied Python to receive the scientific tools.' >&2
# The original archive was fully checked before any executable is extracted.
# No conda-unpack runs against this temporary bootstrap copy.
tar -xzf "$ARCHIVE" -C "$BOOTSTRAP_DIR"
BOOTSTRAP="$BOOTSTRAP_DIR/runtime/bin/python"
if [ ! -x "$BOOTSTRAP" ]; then
  printf '%s\n' "The supplied bootstrap Python is missing; retained folder: $BOOTSTRAP_DIR" >&2
  exit 2
fi
# Do not select the temporary interpreter as --python/ECOSYSTEMS_PYTHON:
# that would skip the existing receiver's stable installation.
"$BOOTSTRAP" -I -B "$RECEIVER" --application "$ROOT/application" \
  --spec "$SPEC" --archive "$ARCHIVE" --prepare-only > "$BOOTSTRAP_DIR/ready.json"
SELECTED_PYTHON=$("$BOOTSTRAP" -I -c \
  'import json,sys; v=json.load(open(sys.argv[1],encoding="utf-8")); assert v["state"]=="ready"; print(v["python"])' \
  "$BOOTSTRAP_DIR/ready.json")
if [ ! -x "$SELECTED_PYTHON" ]; then
  printf '%s\n' 'The original receiver did not return its installed Python.' >&2
  exit 2
fi
# All temporary Python processes have exited and final qualification succeeded.
# Failed attempts stay available at their original paths for receiving diagnosis.
rm -rf -- "$BOOTSTRAP_DIR"
export ECOSYSTEMS_PYTHON="$SELECTED_PYTHON"
exec "$SELECTED_PYTHON" -B "$RECEIVER" --application "$ROOT/application" \
  --spec "$SPEC" --open-script "$ROOT/OPEN.sh" -- "$@"
