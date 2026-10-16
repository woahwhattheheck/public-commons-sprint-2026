# L2D107: bounded feasible elite archive and basin-aware restarts

**Purpose.** This is an experimental Learn2Design optimizer, not a replacement for the original entrant or an uploaded competition submission. It composes the exact source from existing Sol candidate PR693 (submission_sol_restart.py at Git blob ee54f0611291cac8930ce9a1ce559639b3cdcb23) with a feasibility-only, bounded restart archive. Sol PR693 and the counted incumbent V1/096/097/099/100 remain unchanged.

## Operator workflow

On an official dfbench-equipped development runtime, retain the original accepted run_public_uifo.py from Sol PR693 unchanged. Copy submission107.py, elite_archive.py, and requirements.txt into that runner's directory. Run the existing accepted runner against both the incumbent and this candidate with the exact same official UIFO public seed/time/hardware. The import is local: submission107.py imports elite_archive.py. For an eligible final ZIP, the existing entrant must rename submission107.py to root-level submission.py, include elite_archive.py and root requirements.txt, and run the original organizer static validator first. This source is NOT a counted upload.

## What actually changes

- The original optimizer calls prepare(unbounded=True), which uses the documented default Objective sigmoid-to-physical-bounds mapping. The archive stores genuine unbounded vectors, computing distance only after sigmoid normalization. It does not mutate Objective space, physics, scorer, or logging.
- The existing source's true Objective is_feasible flag is the sole authority for admission. Never replace a scored feasible point using a lower infeasible penalized loss. Archive offers only finite-loss, finite-gradient/params candidates.
- At most eight feasible elites are retained. Storage for float64 vector plus unit coordinates is at most 16 * 8 * n_params bytes, independent of evaluations and iterations. For 256 physical dimensions, 32,768 vector bytes; for 1024, 131,072 bytes. A narrow RMS diversity radius de-duplicates near-identical points.
- Every other stalled exploration restart can start from a different feasible elite instead of a new Objective random point, only when at least two distinct elites exist. The other restarts preserve the source-native Objective random sampling. The original best feasible point remains the quiet polishing anchor.
- If an anchor later yields invalid derivatives, the archive evicts its neighborhood. Runtime diagnostic elite_archive/ archive_restarts counters are advisory; only official Objective history and feasibility determine any score.

## Linux memory/shape profile

At 2026-10-11 local Python/NumPy runtime, an independent local profile streamed 2,500 candidate offers per dimension (64/256/1024; seed 20261011; 2,272 feasible accepted/228 intentionally infeasible in each). Archive size remained 8, exact float64 archive storage 8,192 / 32,768 / 131,072 bytes respectively, and Python tracemalloc peak during the streaming profile was 22,104 / 47,992 / 177,048 bytes on this environment. Times were ~0.39 / 0.43 / 0.48 s. The local exercise checked capacity, feasibility-only admission, incumbent preservation and selection; it was NOT a dfbench physics measurement, official score, H100 or Muse performance claim.

## Original Muse comparison needed

L2D107-T23-S41-600-20261011: public UIFOProblem(size=3, n_frequencies=50, topology_seed=23), independent original Objective per arm, algorithm seed 41, same dfbench 0.3.3 / JAX, JAX_ENABLE_X64=true and same original accelerator. 600 official Objective seconds for unchanged V1 or 096 control and candidate L2D107 respectively, no other condition differences. Run original control *then* L2D107 with unmodified accepted PR693 runner and fresh distinct result files. Preserve complete real feasibility history, best logged feasible loss, counts, exact source hashes, warmup-inclusive runtime, actual hardware/dtype/n_params and errors. Compare before considering promotion; earlier Sol T15/096 and L2D100 T22 jobs are different and must not be repeated. No extra GitHub Actions or paid API calls.

Official API/rules, pinned public organizer commit: https://github.com/artificial-scientist-lab/Learn2Design-2026/tree/1dc4d6e7d0ff656555f48bcf3c22a4d284779386 . Scope is one candidate and its real memory-management improvement, not a new simulator.
