# Public-corpus initialization for the original 096 optimizer

This arm turns the organizer's released Differometor-30k designs into a compact
bank of coherent UIFO starting points. It then substitutes alternate starts in
the original scalar 096 optimizer. The native optimizer controls every subsequent
physics evaluation, gradient, trust update, noise draw, restart and stopping
decision. The original 096, 099, Hessian candidates and accepted runner are not
edited by this experiment.

The source pipeline is complete. Its learned bank is produced by the command
below from the actual pinned organizer input; an empty or invented bank is not
included. The original Muse transfer operation owns that input acquisition and
the same preprocessing handoff. This source publication makes that operation
executable on its existing equipped runtime while the final bank returns.

## Data and physical meaning

The input is the [official HDF5 dataset](https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/1dc4d6e7d0ff656555f48bcf3c22a4d284779386/dataset/dataset.h5),
74,920,439 bytes, Git blob `6da06060a27e9530f630c3a2fb40c90082dfd152`.
The [published schema](https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/1dc4d6e7d0ff656555f48bcf3c22a4d284779386/dataset/README.md)
contains 29,650 broadband designs, saved bounded parameters, fifty-frequency
sensitivities and named carrier-port powers. The compiler verifies the complete
input's size and Git blob and records its independently computed SHA-256.

`official/dataset_utils.py` is the organizer's exact reconstruction helper at
that commit. It builds the structural parameter map without constructing or
running an Objective. Coupled horizontal/vertical lengths remain one variable
with every member in its key. Source/readout roles distinguish a laser or dark
detector boundary even when its component's position has the same name.

The offline donor filter applies the native `calculate_powers` contract to the
saved, measured port arrays:

| Component | Native power check |
| --- | --- |
| Mirror | Maximum of its left/right side maxima is at most 3,500,000 W; minimum of those side maxima is at most 2,000 W. |
| Ordinary beamsplitter | Same check for left+top versus right+bottom sides. |
| Directional beamsplitter | Every port is at most 2,000 W. |
| Detector | Its actual reconstructed target/port/direction is at most 0.01 W. Each retained homodyne output is checked separately. |

Side selection occurs per saved power column before reducing columns. Detector
targets come from actual setup nodes, including native handling of repeated
homodyne detector names. A low saved loss alone never qualifies a donor.

Selection rotates across readout-placement and laser-count buckets, trying the
lowest saved losses in each. It retains at most one physically qualified donor
per topology and up to 512 donors for each configured grid size. This prevents
reoptimized copies of one topology from filling the bank. The report distinguishes
all source entries, inspected power records, rejected records and retained
donors; it does not describe uninspected rows as feasible.

At runtime, donors are ranked by readout placement, boundary roles, center types,
orientation and saved loss. Exact semantic parameter keys transfer a whole donor
vector coherently; only absent variables receive empirical role medians. The
supplied Objective bounds control clipping, followed by the documented default
sigmoid inverse. Transferred designs can behave differently on a new topology:
their reported feasibility and loss come from actual logged Objective calls.

## Compile on the existing equipped native runtime

Use the accepted `dfbench==0.3.3`, `differometor==0.0.5` environment. Preprocessing
additionally uses `h5py==3.15.1`; it is not a submission dependency. From this
source directory, with the original downloaded corpus already available:

```sh
python compile_bank.py /absolute/existing/dataset.h5 \
  --sizes 3 4 --max-donors-per-size 512 \
  --output warmstart_bank.npz > corpus-compile.json
python package_candidate.py corpus-seeded096.zip
```

Return `warmstart_bank.npz` and `corpus-compile.json` to the same original
acquisition/initializer thread. They contain parameters, source identity and
actual preprocessing counts; no simulator run is needed to create them. The
compiler streams each selected record and retains compact structural metadata.
Its wall time is in the report, outside the deterministic bank bytes.

For this cloud seat's already retained reader, use the original L2D interpreter
with `PYTHONPATH` containing
`/workspace/scratch/dba55fe4658b/l2d-native/hdf5-reader/installed`.
This adds the verified offline HDF5 reader without replacing the numerical stack.

## Native optimizer comparison

Original 096 source: SHA-256
`97cbe70ec309629be60c78facf903e110aace074111715e58fde57afc01c8077`.
The new `submission_corpus096.py` draws the same full original random start list,
then replaces slots 0, 2 and 4 by default. Other starts and random-stream
advancement are retained. Caller-supplied `init_params` stays in slot 0; learned
starts then use slots 1 and 3. Unsupported objectives/sizes or incomplete donor
maps retain the corresponding original starts.

The existing runner must be able to import this candidate's sibling helper.
For a newly assigned, source-matched condition on an existing GPU allocation:

```sh
SOURCE_DIR=$(pwd)
PYTHONPATH="$SOURCE_DIR${PYTHONPATH:+:$PYTHONPATH}" \
  python /absolute/original/run_public_uifo.py \
  --candidate "$SOURCE_DIR/submission_corpus096.py" \
  --topology-seed 8 --algorithm-seed 42 --seconds 180 \
  --out /absolute/new-output/corpus096-t8-s42-180.json
```

Compare against unchanged 096 on the same hardware, precision, full native
size-three/fifty-frequency problem and budget. Reuse completed source-matched
controls only when their actual runtime matches. The chosen public topology
exposes an existing measured 096 weakness relative to V1; expand through the
original comparison owner after that useful condition returns. The existing
A6455 T24/S41 control, 6966 Hessian phase and completed Kaggle-output recovery
retain their operation identities.

The [official rules](https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/1dc4d6e7d0ff656555f48bcf3c22a4d284779386/docs/submission.md)
allow inspecting public context and preparing learned starts before logging.
This candidate makes no result-producing call then. `start_logging()` precedes
every donor evaluation. Final evaluation remains the supplied four-hour
Objective, four-and-a-half-hour container and organizer hardware; a public
development comparison does not replace that evaluation.

## Runtime archive and integration

`package_candidate.py` includes exactly `submission.py`, `warmstart.py`, the
compiled bank, mandatory `requirements.txt` and the upstream license. The offline
compiler and helper contain simulator imports and are intentionally absent from
the runtime ZIP. The official evaluator supplies NumPy and Optax, so this
candidate requests no package overrides. The original submission owner chooses
the entrant through the current organizer portal after measured comparison.

The upstream helper and data retain the included MIT notice. Original work order:
[FLEET-EOD-20261011-L2D02](https://tokenjunkielabs.slack.com/archives/C0BVDDS04G2/p1791722905517069).
The original source carrier is `sol/l2d-budgeted-restarts-20261011` in
`woahwhattheheck/public-commons-sprint-2026`; this experiment has its own directory
alongside that carrier's original candidates.
