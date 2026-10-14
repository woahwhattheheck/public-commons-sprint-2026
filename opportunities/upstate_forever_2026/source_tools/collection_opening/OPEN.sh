#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$(uname -s)" = Darwin ]; then
  exec /bin/sh "$ROOT/Open_Workbench.command" "$@"
fi
if [ -z "${ECOSYSTEMS_PYTHON:-}" ]; then
  exec sh "$ROOT/Open_Native_Collection.sh" "$@"
fi
PYTHON=$ECOSYSTEMS_PYTHON
if [ ! -x "$PYTHON" ]; then
  printf '%s\n' 'Select the executable Python supplied with the scientific runtime.' >&2
  exit 2
fi
unset PYTHONHOME PYTHONPATH
export PYTHONNOUSERSITE=1
SCIENTIFIC_PREFIX=$("$PYTHON" -I -c 'import sys; print(sys.prefix)')
export PATH="$(dirname -- "$PYTHON"):$PATH"
if [ -f "$SCIENTIFIC_PREFIX/share/proj/proj.db" ]; then
  export PROJ_DATA="$SCIENTIFIC_PREFIX/share/proj"
fi
if [ -d "$SCIENTIFIC_PREFIX/share/gdal" ]; then
  export GDAL_DATA="$SCIENTIFIC_PREFIX/share/gdal"
fi
if [ -d "$SCIENTIFIC_PREFIX/lib" ]; then
  export LD_LIBRARY_PATH="$SCIENTIFIC_PREFIX/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
if [ "${SSL_CERT_FILE+x}" != x ] && [ -f "$SCIENTIFIC_PREFIX/ssl/cert.pem" ]; then
  "$PYTHON" -I -c \
    'import ssl,sys; c=ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT); c.load_verify_locations(cafile=sys.argv[1]); assert c.cert_store_stats()["x509_ca"]>0' \
    "$SCIENTIFIC_PREFIX/ssl/cert.pem"
  export SSL_CERT_FILE="$SCIENTIFIC_PREFIX/ssl/cert.pem"
fi
"$PYTHON" -I -B "$ROOT/prepare_runtime_dependencies.py" --application "$ROOT/application"
exec "$PYTHON" -B "$ROOT/open_collection.py" "$@"
