#!/bin/sh
set -eu
release_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ ! -x "$release_dir/airport-env/bin/python" ]; then
  printf '%s\n' 'Run sh install-posix.sh first.' >&2
  exit 1
fi
exec "$release_dir/airport-env/bin/python" -m airport_operator --workspace "$release_dir/airport-workspace" --demo --port 8771 "$@"
