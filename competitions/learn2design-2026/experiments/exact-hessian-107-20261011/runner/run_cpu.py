"""Apply the public JAX CPU dispatch setting before the original runner starts."""
from __future__ import annotations

import json
from pathlib import Path
import runpy
import sys

import jax


def main() -> None:
    # In the pinned JAX 0.9.0.1, this option is a bool_flag, not a bool_state:
    # JAX_CPU_ENABLE_ASYNC_DISPATCH in the environment does not set it.
    # Configure it before any device, Objective or candidate is constructed.
    jax.config.update("jax_cpu_enable_async_dispatch", False)
    cpu_async = jax.config.read("jax_cpu_enable_async_dispatch")
    if cpu_async is not False:
        raise RuntimeError("JAX CPU synchronous dispatch was not applied")

    print(
        "L2D_CPU_RUNTIME "
        + json.dumps(
            {
                "schema": "tjlabs.l2d.cpu-runtime/v1",
                "jax_version": jax.__version__,
                "jax_cpu_enable_async_dispatch": cpu_async,
                "jax_platforms": jax.config.jax_platforms,
                "jax_enable_x64": jax.config.jax_enable_x64,
                "jax_disable_jit": jax.config.jax_disable_jit,
            },
            sort_keys=True,
        ),
        file=sys.stderr,
        flush=True,
    )
    runner = Path(__file__).resolve().with_name("run_public_uifo.py")
    sys.argv[0] = str(runner)
    runpy.run_path(str(runner), run_name="__main__")


if __name__ == "__main__":
    main()
