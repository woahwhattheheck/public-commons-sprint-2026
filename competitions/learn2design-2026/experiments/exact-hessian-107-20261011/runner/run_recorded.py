#!/usr/bin/env python3
"""Record effective runtime settings, then execute the unchanged native runner."""
from __future__ import annotations

import argparse
import datetime
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import runpy
import sys

ENVIRONMENT_KEYS = (
    "JAX_PLATFORMS", "JAX_PLATFORM_NAME", "JAX_ENABLE_X64", "JAX_DISABLE_JIT",
    "XLA_FLAGS", "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS", "TF_NUM_INTRAOP_THREADS", "TF_NUM_INTEROP_THREADS",
    "MALLOC_ARENA_MAX", "MALLOC_TRIM_THRESHOLD_", "CUDA_VISIBLE_DEVICES",
    "NVIDIA_VISIBLE_DEVICES", "CUDA_DEVICE_ORDER", "XLA_PYTHON_CLIENT_MEM_FRACTION",
    "XLA_PYTHON_CLIENT_PREALLOCATE", "XLA_PYTHON_CLIENT_ALLOCATOR",
    "JAX_COMPILATION_CACHE_MAX_SIZE", "JAX_PERSISTENT_CACHE_MIN_COMPILE_TIME_SECS",
)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def config(jax):
    return {
        "jax_cpu_enable_async_dispatch": jax.config.read("jax_cpu_enable_async_dispatch"),
        "jax_enable_x64": bool(jax.config.jax_enable_x64),
        "jax_disable_jit": bool(jax.config.jax_disable_jit),
        "jax_platforms": jax.config.jax_platforms,
        "jax_default_matmul_precision": jax.config.jax_default_matmul_precision,
    }


def native_sources():
    distribution = importlib.metadata.distribution("dfbench")
    names = ("dfbench/core/objective.py", "dfbench/core/algorithm.py",
             "dfbench/problems/uifo/uifo_problem.py")
    return {name: sha(distribution.locate_file(name)) for name in names}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cpu-sync", action="store_true",
                        help="Apply the accepted synchronous CPU dispatch setting before initialization")
    parser.add_argument("native_arguments", nargs=argparse.REMAINDER,
                        help="Pass -- followed by the original native runner arguments")
    args = parser.parse_args()
    argv = args.native_arguments
    if argv[:1] == ["--"]:
        argv = argv[1:]
    native_parser = argparse.ArgumentParser(add_help=False)
    native_parser.add_argument("--candidate", type=Path, required=True)
    native_parser.add_argument("--out", type=Path, required=True)
    native, _ = native_parser.parse_known_args(argv)
    report = native.out.resolve()
    context = Path(str(report) + ".runtime.json")
    if report == context or report.exists() or context.exists():
        raise FileExistsError("Use new, distinct native report and runtime-context paths")
    report.parent.mkdir(parents=True, exist_ok=True)
    context.parent.mkdir(parents=True, exist_ok=True)
    runner = Path(__file__).resolve().with_name("run_public_uifo.py")
    capture = Path(__file__).resolve()
    before = {"capture_sha256": sha(capture), "runner_sha256": sha(runner),
              "candidate_sha256": sha(native.candidate)}

    # No Objective is constructed here. This config precedes device initialization,
    # and the original runner still owns every warmup, evaluation and budget clock.
    import jax
    if args.cpu_sync:
        jax.config.update("jax_cpu_enable_async_dispatch", False)
        if jax.config.read("jax_cpu_enable_async_dispatch") is not False:
            raise RuntimeError("JAX CPU synchronous dispatch was not applied")
    condition = {
        "capture_sha256": before["capture_sha256"],
        "entry_mode": "cpu_sync" if args.cpu_sync else "native",
        "affinity": sorted(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else None,
        "jax_config": config(jax),
        "environment": {key: os.environ.get(key) for key in ENVIRONMENT_KEYS},
        "compilation_cache_configured": bool(jax.config.jax_compilation_cache_dir),
        "native_source_sha256": native_sources(),
    }
    record = {
        "schema": "tjlabs.l2d.runtime-context/v1", "state": "captured_before_native_runner",
        "captured_at": now(), "condition": condition, "source_before": before,
        "report": str(report), "python_executable": sys.executable,
        "compilation_cache_directory": jax.config.jax_compilation_cache_dir,
        "native_arguments": argv,
    }
    original = (json.dumps(record, indent=2, sort_keys=True) + "\n").encode()
    with context.open("xb") as stream:
        stream.write(original)
    previous_argv = sys.argv
    sys.argv = [str(runner), *argv]
    try:
        runpy.run_path(str(runner), run_name="__main__")
    finally:
        sys.argv = previous_argv
        record.update({"finished_at": now(), "jax_config_after": config(jax),
                       "capture_unchanged": sha(capture) == before["capture_sha256"],
                       "runner_unchanged": sha(runner) == before["runner_sha256"],
                       "native_sources_unchanged": native_sources() == condition["native_source_sha256"]})
        if report.is_file():
            record.update({"state": "native_report_retained", "report_sha256": sha(report)})
        else:
            record["state"] = "native_runner_ended_without_report"
        if context.read_bytes() != original:
            raise RuntimeError("Runtime capture changed during the native run")
        temporary = Path(str(context) + ".completed")
        with temporary.open("x") as stream:
            json.dump(record, stream, indent=2, sort_keys=True, allow_nan=False)
            stream.write("\n")
        os.replace(temporary, context)


if __name__ == "__main__":
    main()
