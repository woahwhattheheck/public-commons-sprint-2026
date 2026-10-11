# Original-objective CPU runtime and fused proposals

The original 096 and 107 candidates dispatch the small Adam, trust-radius,
Gaussian-noise and restart-pull operations individually. `fused_adam.py` combines
that proposal arithmetic in one lazy JAX executable. The first custom compilation
occurs after `Objective.start_logging()` and consumes the supplied budget.
Physics, feasibility, sampling, logging and stopping remain with the original
Objective and candidate control flow.

`submission_fused.py` composes the helper with unchanged 096 search scheduling.
`submission107_fused.py` composes it with the original 107 five-lane scheduler,
feasible eight-slot archive and quiet finishing phase. `elite_archive.py` is the
exact original PR761 blob. The polishing proposal does not split the random key
or add noise. The controls, original Sol source and accepted public runner in this
directory remain unchanged. Fusion can change floating-point rounding; a native
comparison must decide whether either variant is useful.

## Run with the original benchmark

Use `run_public_uifo.py` already in this directory. The native default is
`UIFOProblem(size=3, n_frequencies=50)`, with physical feasibility supplied by
dfbench0.3.3. A public development condition uses topology seed24, algorithm41,
180 Objective seconds and separate fresh processes/output files. Run unchanged
096 then `submission_fused.py`; compare original107 then `submission107_fused.py`
on the same host/settings. The existing Muse topology23/seed41/600 condition uses
its original pinned source and is a separate running campaign.

For an existing GPU runtime, retain its original package/device settings and call
the accepted runner directly. For a CPU host, `requirements-cpu.txt` records the
exact installed Python3.12 package set, including `filelock`, which JAX requires
when its persistent compilation cache has a size limit. `run_cpu.sh` applies the
CPU settings, calls `run_cpu.py` to configure JAX before its backend starts,
and forwards every argument to the unchanged runner:

```sh
L2D_CPUS=0,1 L2D_PYTHON=/absolute/path/to/venv/bin/python bash run_cpu.sh \
  --candidate submission096.py --topology-seed 24 --algorithm-seed 41 \
  --seconds 180 --out results/096-t24-s41.json
L2D_CPUS=0,1 L2D_PYTHON=/absolute/path/to/venv/bin/python bash run_cpu.sh \
  --candidate submission_fused.py --topology-seed 24 --algorithm-seed 41 \
  --seconds 180 --out results/fused-t24-s41.json
```

Choose an affinity allowed on the actual host. The launcher sets the public
`jax.config.update("jax_cpu_enable_async_dispatch", False)` API before device,
Objective or candidate creation. Its `L2D_CPU_RUNTIME` line records the effective
setting, x64 and JIT mode. It limits parallel code generation and bounds its cache to
128MiB. It does not change model size, frequencies, precision or physics. Cache
reuse saves compilation work; it does not reuse evaluated designs or results.

The initial launcher set `JAX_CPU_ENABLE_ASYNC_DISPATCH=false` in the environment.
That did not apply the setting in pinned JAX0.9.0.1: its `bool_flag` declaration
uses the default `True` without reading that environment variable. An actual
import-only readback returned `True` before the public API update and `False`
afterward. The Python bootstrap fixes that error. This matters because the
original Objective warmup calls the full gradient twice without a synchronization
barrier; synchronous CPU dispatch prevents those calls from overlapping.

The first cloud attempts exposed shared-container contention: one native process
reached 3,109,056KiB peakRSS and finished its gradient compilation, then was killed
under the shared8GiB cgroup. A later attempt started with3.101GiB resident headroom
but was killed at1,021,476KiB as concurrent jobs consumed that headroom. No complete
Objective history was produced by those attempts. A momentary free-memory check
is not a reservation. Those attempts used the ineffective environment-only
dispatch request. A later eager attempt (`JAX_DISABLE_JIT=true`) reached
1,706,660KiB and was stopped by its own RSS guard after38.208s, without a new OOM
or a logged Objective history. The CPU launcher therefore needs a coordinated memory
window; it does not claim to protect against unrelated processes.

## Evaluation and delivery

The original runner's logged best feasible loss, feasible fraction, call/evaluation
counts, time history and candidate source hashes determine each comparison.
Keep the exact hardware and CPU configuration with a result. CPU development
measurements cannot be pooled with the H100 final score. The original AST
contract checks pass both new variants, and an independent code review compared
state, key advancement, trust clipping, pull and polishing with the originals.
Native performance and optical-loss results remain to be measured.

After selecting a candidate from actual results, put its exact bytes at the ZIP
root as `submission.py`, with `requirements.txt` and `fused_adam.py`. The107
variant additionally needs the supplied `elite_archive.py`. Do not put the CPU
launcher or CPU-only environment into the competition submission path. Current
organizer delivery is [submit.learn2design2026.com](https://submit.learn2design2026.com),
as linked by the [official submission guide](https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/main/docs/submission.md).
The last accepted ZIP before October15AoE is the evaluated entry.
