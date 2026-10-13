# Original Gura native parameter suite

The suite executes actual InVEST 3.20.0 studies using the official release archives and the retained application. It keeps the original Gura, Kenya watershed, original 15 m lattice, zero added watershed buffer, biophysical coefficients and original baseline arguments. The operator can open every prepared case through **Parameter studies**.

## Execute the complete suite

Use the equipped native environment and the assembled application containing the separate parameter-study module.

```bash
python /absolute/application/source_tools/receive_gura_studies.py \
  --application /absolute/application \
  --workspace /absolute/gura-workspace \
  --inputs /absolute/original-release-archives
```

The inputs directory contains the exact official NDR.zip and SDR.zip. The original receiving driver verifies their published SHA256 and size before extracting or reusing them. If the original both-model baseline has not been received, the suite invokes `receive_gura_reference.py` with native and Workspace execution. If that receiving operation already retained a run, the suite resumes its exact selection. It validates the original data, table, source parameters, geometry, affine and area before expanding the studies.

To use a specific retained original baseline, add `--baseline-run-id ID`. To include the selected Gura portfolio treatment as a second landscape, add `--include-planning-evaluation`, or supply one or more `--evaluation-run-id ID` arguments. Each added run must be a retained portfolio land-cover scenario with the same original grid and coefficient profile. Its actual completed combined treatment becomes the landscape reference for its own parameter studies.

## Default factorial design

| Study | Explicit axes | Logical cases including reference |
| --- | --- | ---: |
| NDR | k: 1, 2; routing: mfd, d8 | 4 |
| SDR | k: 1, 2; IC0: 0.5, 2; routing: mfd, d8 | 8 |
| Combined | NDR k: 1, 2; SDR k: 1, 2; SDR IC0: 0.5, 2; coupled NDR/SDR routing: mfd, d8 | 16 |
| Total for each selected landscape | Three model scopes | 28 |

The baseline retains the original k=2, SDR IC0=0.5 and MFD routing. The documented 1/2 shape values and 0.5/2 midpoint values are explicit sensitivity choices. NDR derives its own IC0 internally; the adjustable midpoint axis targets SDR only. Routing uses the native supported mfd and d8 choices, and the combined scope changes both together.

These are logical study cases. Retained identical profiles and runs are reused. The native stage layer additionally receives completed donor runs and checks their original runtime, arguments and source identities before reuse. NDR-only and SDR-only runs retain the same combined source grid and profile while executing only their selected model.

Optional controls:

- `--scopes ndr sdr both` selects the desired complete model scopes.
- `--design one-at-a-time` isolates each axis against the unchanged reference. This creates 3 NDR, 4 SDR and 5 combined logical cases.
- `--difference-maps` requests the native comparison rasters for completed cases.
- `--archive /absolute/destination/gura-parameter-suite.zip` copies the portable report package outside the source workspace.

## Resume and inspect the operation

Rerun the same command to resume. The request's source-bound identity selects the same suite directory, study IDs and case run IDs. Completed cases and verified exports remain available; failed native cases are retried by the original execution layer.

The receiver writes initial-stage status in `gura-receiving/parameter-suite-receiving.json`. After resolving the exact source identity, it writes `gura-receiving/parameter-studies/<suite_id>/state.json` after every case-progress callback. The record includes the active study/run, case counts, selected models, source arguments/archive hashes and original runtime metadata. It retains driver and parameter-engine hashes separately from the immutable scientific selection.

Execution holds the original workspace native-batch lock and the suite-specific driver lock. Another native experiment remains in its own recorded state while the active operation owns that workspace. Each study retains its normal immutable selection and `experiments/<study_id>/experiment.json` record, so the same operation can also be opened through the independent parameter-study operator view.

The suite continues other model scopes if an individual study needs recovery. It returns exit code 0 only when all selected studies are complete; partial or failed operations return 1 and retain their actual stage and completed result exports.

## Completed deliverable

The suite directory contains:

- `index.html`: clean report index linking each original study report.
- `results.csv` and `results.json`: all completed cases, labeled by landscape and model scope.
- `selection.json`: immutable axes, original source identifiers and explicit study choices.
- `studies/<study_id>/`: verified study CSV/JSON/HTML, source profiles, selections and ZIP with executed native argument documents.
- `manifest.json` and `gura-parameter-suite.zip`: original artifact identities and portable package.

Results preserve nitrogen/phosphorus kg/year and sediment metric tonnes/year. The capture layer converts native per-hectare rates once with original affine cell area. The study then sums stored mass per pixel, retaining paired-cell support, full valid totals and coverage changes. Each landscape's cases are compared with its own original-parameter reference; the completed portfolio's separate physical evaluation remains in its original report.

## Original references

- [InVEST 3.20.0 NDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html)
- [InVEST 3.20.0 SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html)
- [Official NDR sample archive](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/data/NDR.zip)
- [Official SDR sample archive](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/data/SDR.zip)
