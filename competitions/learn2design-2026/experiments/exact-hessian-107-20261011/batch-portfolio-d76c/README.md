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
The original helper and compiled bank retain their exact bytes. Native reports
retain the complete donor selection and any random fallback, so the comparison
includes the policy's outcome on every selected topology.

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
SHA256 609a69e08ef1c9ec3460e3f012e7f1b52bb6a29c232c198a63415409d2ab7d39.
That bank was compiled from the organizer's Differometor-30k dataset by DBA55:
1,024 saved donors, 646 semantic parameter keys and 33 role priors. The compiler
and original donor source remain in the adjacent corpus-initializer project.
This candidate consumes that completed result.

## Broad native comparison

From the parent exact-hessian-107-20261011 directory, use the existing equipped
GPU Python environment. The maintained finite compilation cache also requires
`filelock` in that environment (the recovered CPU runtime uses `filelock==4.1.1`).
Install that cache dependency alongside the candidate requirements before
starting a comparison:

    /actual/venv/bin/python -m pip install filelock==4.1.1


    python run_phase.py run --phase batch-corpus-broad-public \
      --mode gpu --python /actual/venv/bin/python \
      --run-dir /actual/output/l2d-batched-corpus-gpu-d76c

This is forty original Objective cells: topology seeds 7–16, algorithm seed 42,
600 seconds per cell, interleaved across four sources:

| Source | Algorithm |
| --- | --- |
| 099 | Unchanged MeasuredPortfolio099 |
| 107-archive-scalar | Unchanged BoundedArchiveRestartPortfolio |
| batch-random-d76c | Batched portfolio with original random starts |
| batch-corpus-d76c | Same batched portfolio with the compiled donor starts |

The two batched arms have the same candidate bytes, eight lanes, batch width 8,
native physics and seeds. The corpus option is their only invocation difference.
The original 107 exact-Hessian sources remain separately named in SOURCES.json.

For an existing CPU allocation, set `L2D_CPU_LIST` to its actual allowed CPUs
(for example, `8-15` only when those CPUs are granted). The complete separate
twenty-cell comparison is:

    python run_phase.py run --phase batch-corpus-cpu-public \
      --mode cpu --python /actual/venv/bin/python \
      --cpu-affinity "$L2D_CPU_LIST" \
      --run-dir /actual/output/l2d-batched-corpus-cpu-d76c

This pairs original 099 and the same candidate using scalar dispatch across all
ten topologies. It retains its CPU runtime identity separately from the GPU
campaign. The original CPU launcher applies the maintained synchronous dispatch
setting and the phase operator gives each cell an initially empty cache.
Both CPU arms use one compiler code-generation partition and disable XLA's
concurrency-optimized CPU scheduler. The selected flags appear in each native
runtime sidecar; this reduces compiler scheduling pressure on a shared host
while retaining the same original Objective and time budget.

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
full-objective-budget phase. That phase runs the official 14,400-second Objective
budget on the same ten public topologies, with the 16,200-second container cap.
Select both frozen source IDs explicitly; for example, to compare the original
099 control with this corpus candidate:

    python run_phase.py run --phase full-objective-budget \
      --candidate 099 --candidate batch-corpus-d76c --baseline 099 \
      --mode gpu --python /actual/venv/bin/python \
      --run-dir /actual/output/l2d-batched-corpus-four-hour-d76c

The ten-minute comparison helps expose runtime failures and promising starts.
The final candidate choice also uses the four-hour native histories, including
late feasible improvement. Keep the selected source IDs and runtime fixed when
resuming a phase.

## Use several existing GPU allocations

The complete final phase contains 20 four-hour Objective cells: 80 GPU-hours
before warmup and process overhead. Divide whole topology groups between the
available GPU allocations so the full comparison can finish before the final
deadline. Each allocation still runs one original native cell at a time.

Use the same source revision, phase, candidate IDs, partition count and original
physics everywhere. Assign a different zero-based partition index to each
allocation. For two existing workers, worker 0 receives topologies
7, 9, 11, 13 and 15; worker 1 receives 8, 10, 12, 14 and 16.
Every candidate and algorithm seed for a topology stays on that worker.
The whole broad panel remains 40 cells; the final panel remains 20 cells.

Set `L2D_PARTITION_INDEX` to `0` on the first worker and `1` on the second.
Run the complete broad comparison on each:

    python run_phase.py plan --phase batch-corpus-broad-public \
      --partition-count 2 --partition-index "$L2D_PARTITION_INDEX"
    python run_phase.py run --phase batch-corpus-broad-public \
      --partition-count 2 --partition-index "$L2D_PARTITION_INDEX" \
      --mode gpu --python /actual/venv/bin/python \
      --run-dir "/actual/output/l2d-broad-part-$L2D_PARTITION_INDEX"

After comparing the broad results, use the same two explicitly selected source
IDs on both workers. This example retains the original 099 control and the
corpus candidate; substitute the selected frozen IDs together if the broad
results favor another pair:

    python run_phase.py run --phase full-objective-budget \
      --candidate 099 --candidate batch-corpus-d76c --baseline 099 \
      --partition-count 2 --partition-index "$L2D_PARTITION_INDEX" \
      --mode gpu --python /actual/venv/bin/python \
      --run-dir "/actual/output/l2d-full-part-$L2D_PARTITION_INDEX"

With two workers, each final partition has ten cells and 40 hours of Objective
time, with a maximum of 45 hours under the original per-cell container cap.
Additional existing workers can reduce elapsed time further: set a common
partition count from 1 through 10 and assign every index from 0 through N-1
once. A topology is assigned by its position modulo N. The source, physical
problem, seed, candidate options and per-cell budgets stay fixed.

Each phase intent and result records its partition index, the complete public
topology list, its assigned topology list and the full panel's cell count.
Resume a partition with its original command, index, count, directory and
runtime. Existing phases started without partition options retain the original
complete selection and resume without those options.

Export each worker's original phase and collect the complete directories,
including every adjacent `native.json.runtime.json`, under a common returns
directory. For example, on each broad worker:

    python run_phase.py export \
      --run-dir "/actual/output/l2d-broad-part-$L2D_PARTITION_INDEX" \
      --archive "/actual/output/l2d-broad-part-$L2D_PARTITION_INDEX.zip"

After unpacking both broad archives into separate `broad-part-0` and
`broad-part-1` directories, combine the returned native reports with the
existing comparator:

    python compare_native.py \
      /actual/returns/broad-part-0/cells/*/native.json \
      /actual/returns/broad-part-1/cells/*/native.json \
      --sources SOURCES.json --baseline 099 \
      --out /actual/returns/complete-broad-comparison.json

Use the same export and comparison pattern for all final partitions.
The complete broad panel has 40 planned cells and up to 30 baseline comparisons;
the final panel has 20 planned cells and up to ten baseline comparisons.
Read every partition's original result alongside the combined comparison to
account for retained errors, interrupted cells and missing native reports.
The comparator preserves the actual runtime cohorts and pairs only matching
conditions. Keeping all methods for each topology on its assigned worker makes
those comparisons available even when the fleet has different GPU models.

## Submission package

The maintained donor packager has been extended for the complete portfolio:

    python batch-portfolio-d76c/package_candidate.py \
      /actual/output/l2d-batched-corpus-submission.zip
    python official/validate_submission.py \
      /actual/output/l2d-batched-corpus-submission.zip

The archive contains root-level submission.py and requirements.txt, the batched
update, original feasible archive, original warmstart helper, donor bank and
third-party license. Its one algorithm class uses its own default GPU/CPU
dispatch; all simulation stays in Objective. The packager writes and syncs a complete archive before publishing its final
name. A retry reuses an existing archive only after all seven member names,
contents and CRCs match; its result includes `reused: true`. Every result includes
each member's byte identity and the complete ZIP identity.

The current official final deadline is 15 October 2026 AoE. The evaluation machine
is an H100 SXM5 80GB, 16 vCPU, 128 GiB RAM host. The official rules and API are:

- https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/1dc4d6e7d0ff656555f48bcf3c22a4d284779386/docs/submission.md
- https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/1dc4d6e7d0ff656555f48bcf3c22a4d284779386/docs/dfbench/Objective-API-Reference.md
