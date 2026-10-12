#!/usr/bin/env bash
set -euo pipefail

# Record the effective CPU runtime, then invoke the unchanged public Objective runner.
# Choose CPUs from this host's actual affinity. The caller schedules the memory
# window; this small launcher does not reserve RAM against unrelated processes.
: "${L2D_CPUS:?Set L2D_CPUS to the granted CPU affinity, for example 0,1}"
L2D_PYTHON="${L2D_PYTHON:-python}"
L2D_CPU_CACHE_DIR="${L2D_CPU_CACHE_DIR:-${TMPDIR:-/tmp}/l2d-native-cpu-cache}"
L2D_SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p -- "$L2D_CPU_CACHE_DIR"

L2D_CAPTURE_OPTIONS=()
if [[ -n "${L2D_SOURCE_MANIFEST:-}" || -n "${L2D_SOURCE_ID:-}" ]]; then
  : "${L2D_SOURCE_MANIFEST:?Set the retained source manifest with the selected source ID}"
  : "${L2D_SOURCE_ID:?Set the selected source ID with its retained manifest}"
  L2D_CAPTURE_OPTIONS=(--source-manifest "$L2D_SOURCE_MANIFEST" --source-id "$L2D_SOURCE_ID")
fi

exec taskset -c "$L2D_CPUS" env \
  JAX_PLATFORMS=cpu JAX_ENABLE_X64=true \
  OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=2 \
  MALLOC_ARENA_MAX=2 MALLOC_TRIM_THRESHOLD_=65536 \
  XLA_FLAGS=--xla_cpu_parallel_codegen_split_count=1 \
  JAX_COMPILATION_CACHE_DIR="$L2D_CPU_CACHE_DIR" \
  JAX_COMPILATION_CACHE_MAX_SIZE=134217728 \
  JAX_PERSISTENT_CACHE_MIN_COMPILE_TIME_SECS=1 \
  "$L2D_PYTHON" "$L2D_SOURCE_DIR/run_recorded.py" --cpu-sync "${L2D_CAPTURE_OPTIONS[@]}" -- "$@"
