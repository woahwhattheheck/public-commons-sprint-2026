# Batched corpus portfolio

This package combines the fleet's independent Adam/trust restart portfolio,
its feasible elite archive and the already compiled public donor bank. All
physical evaluations use the supplied dfbench 0.3.3 Objective. The official
source and rules are pinned at
1dc4d6e7d0ff656555f48bcf3c22a4d284779386.

The candidate maintains eight separate optimizer states. On a GPU its default
gradient call evaluates all eight lanes together; on a CPU it rotates the same
eight lanes through scalar calls. Each lane has its own learning rate, trust
radius, noise schedule, restart counter and Adam state. Half the lanes become
quiet basin refiners at 65% of the budget, and all lanes refine at 90%.

The original public donor helper supplies complete vectors to alternating
initial slots after the same random draws. The supplied initial point, when
present, stays first. The original feasible archive supplies diverse restart
basins. New random starts remain part of exploration.

Donor mapping receives a snapshot of finite public bounds, problem specification
and parameter context captured before the Objective switches to unbounded
search. Both donor clipping and the sigmoid inverse use that same snapshot.
The original helper and compiled bank retain their exact bytes.

## Native feasibility and timing

Every batched gradient call returns the original Objective's physical
feasibility for every lane. A finite batch's minimum is already retained by the
default history. When the best improved feasible member is outside that
minimum, the algorithm evaluates that exact vector through the scalar Objective
value/aux method. This keeps the feasible design available to evaluators using
reduced batched histories. The algorithm uses returned native flags and losses.

Only Objective-provided warmups run before logging. The first custom optimizer
update compiles after start_logging, and its cost belongs to the timed run.
Measured loop duration includes physical evaluation, host portfolio work and
completed device updates. Finite evaluation caps use scalar tail calls.

The seven-file submission includes the original 2,170,687-byte donor bank,
SHA256609a69e08ef1c9ec3460e3f012e7f1b52bb6a29c232c198a63415409d2ab7d39.
That bank was compiled from the organizer's Differometor-30k dataset by DBA55:
1,024 saved donors, 646 semantic parameter keys and 33 role priors. The compiler
and original donor source remain in the adjacent corpus-initializer project.
This candidate consumes that completed result.

## Broad native comparison

From the parent exact-hessian-107-20261011 directory, use the existing equipped
GPU Python environment:

    python run_phase.py run --phase batch-corpus-broad-public \
      --mode gpu --python /actual/venv/bin/python \
      --run-dir /actual/output/l2d-batched-corpus-gpu-d76c

This is forty original Objective cells: topology seeds7–16, algorithm seed42,
600seconds per cell, interleaved across four sources:

| Source | Algorithm |
| --- | --- |
| 099 | Unchanged MeasuredPortfolio099 |
| 107-archive-scalar | Unchanged BoundedArchiveRestartPortfolio |
| batch-random-d76c | Batched portfolio with original random starts |
| batch-corpus-d76c | Same batched portfolio with the compiled donor starts |

The two batched arms have the same candidate bytes, eight lanes, batch width8,
native physics and seeds. The corpus option is their only invocation difference.
The original 107 exact-Hessian sources remain separately named in SOURCES.json.

For an existing CPU allocation, the complete separate twenty-cell comparison is:

    python run_phase.py run --phase batch-corpus-cpu-public \
      --mode cpu --python /actual/venv/bin/python \
      --run-dir /actual/output/l2d-batched-corpus-cpu-d76c

This pairs original099 and the same candidate using scalar dispatch across all
ten topologies. It retains its CPU runtime identity separately from the GPU
campaign. The original CPU launcher applies the maintained synchronous dispatch
setting and the phase operator gives each cell an initially empty cache.

The original source-invocation adapter now includes the donor asset in the
selected arm, startup byte checks, source observation and final output archive.
Companions keep their original import interface. Existing arms without assets
retain their original treatment identity.

Use the original operator for progress, recovery and export:

    python run_phase.py status --run-dir /actual/output/l2d-batched-corpus-gpu-d76c
    python run_phase.py run --phase batch-corpus-broad-public \
      --mode gpu --python /actual/venv/bin/python \
      --run-dir /actual/output/l2d-batched-corpus-gpu-d76c
    python run_phase.py export --run-dir /actual/output/l2d-batched-corpus-gpu-d76c \
      --archive /actual/output/l2d-batched-corpus-gpu-d76c.zip

The existing operator reuses completed cells in that exact phase and retains
interrupted attempts. Read its full matched comparison, feasibility, tail
behavior and timing before choosing the sources for the original
full-objective-budget phase. That phase runs the official14,400-second Objective
budget on the same ten public topologies, with the16,200-second container cap.

## Submission package

The maintained donor packager has been extended for the complete portfolio:

    python batch-portfolio-d76c/package_candidate.py \
      /actual/output/l2d-batched-corpus-submission.zip
    python official/validate_submission.py \
      /actual/output/l2d-batched-corpus-submission.zip

The archive contains root-level submission.py and requirements.txt, the batched
update, original feasible archive, original warmstart helper, donor bank and
third-party license. Its one algorithm class uses its own default GPU/CPU
dispatch; all simulation stays in Objective. The packager preserves an existing
output and returns each member's byte identity with the complete ZIP.

The current official final deadline is15October2026 AoE. The evaluation machine
is an H100SXM5 80GB,16vCPU,128GiB RAM host. The official rules and API are:

- https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/1dc4d6e7d0ff656555f48bcf3c22a4d284779386/docs/submission.md
- https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/1dc4d6e7d0ff656555f48bcf3c22a4d284779386/docs/dfbench/Objective-API-Reference.md
