# Continue the original Gura case on its receiving machine

The Gura comparison driver now continues a saved native programme after its caller
closes, and accepts the restored original Workspace at a new local path. The
original source classes, parameter profile, actual native grid, native run IDs and
class-comparison plan remain the selected scientific case.

## Receive the existing case

Restore the complete original Workspace with the maintained portable receiving
flow. Carry its matching application source and original receiving JSON as part
of the same handoff. The comparison's own directory retains both
`plan.json` and `original-receiving.json`; those copies can be used directly
after transfer.

Keep the receipt and plan content unchanged. Supply the new Workspace path with
`--workspace`. The driver opens the original source collection, grid, profile,
baseline and programme in that Workspace and validates them against the saved
plan. It reads the original programme selection inside the Workspace, so the old
machine's external `selection_path` is no longer needed.

Set these task-specific paths to the actual received files:

| Value | Meaning |
| --- | --- |
| `GURA_WORKSPACE` | The restored original Workspace directory. |
| `GURA_RECEIPT` | The unchanged original receiving JSON, including the retained `original-receiving.json` copy when used. |
| `GURA_PLAN` | The unchanged original class-comparison `plan.json`. |
| `GURA_RESULTS` | The chosen result JSON path on the receiving machine. |
| `GURA_ARCHIVE` | A new output archive outside the Workspace for this receiving edition. |

From the matching application directory, use its selected GIS Python:

```sh
python -B -m source_tools.gura_comparison execute \
  --receiving "$GURA_RECEIPT" \
  --plan "$GURA_PLAN" \
  --workspace "$GURA_WORKSPACE" \
  --output "$GURA_RESULTS" \
  --workspace-backup "$GURA_ARCHIVE"
```

The same optional `--workspace` is available on `catalog` and `plan`. Existing
commands that use the receipt's original Workspace path continue to work.
Python callers may supply `workspace=` as an existing Workspace object or a path.

## Use the integrated original-input workflow

The existing `source_tools.gura_workflow` entry point now forwards its actual
`--workspace` to receiving, plan validation and comparison execution. Its
`run` command continues the original native baseline, the selected class
comparisons, watershed reports, economic editions and whole-Workspace archive.

For a receiving handoff, keep an intake directory beside the restored Workspace.
Place the unchanged original receipt there as `receiving.json` and the retained
comparison plan as `gura-comparison-plan.json`. When a workflow state and log
already exist, carry `gura-workflow.json` and `original-native-programme.log`
with them. These are the current workflow's original filenames. The Workspace
also retains its comparison's original receipt and plan copies.

Set `GURA_SOURCE_DIRECTORY` to that received intake directory and use the
matching application's InVEST 3.20.0 interpreter:

```sh
python -B -m source_tools.gura_workflow run \
  --workspace "$GURA_WORKSPACE" \
  --source-directory "$GURA_SOURCE_DIRECTORY" \
  --backup "$GURA_ARCHIVE" \
  --serve
```

For a saved explicit cohort, include its original repeated `--convert FROM:TO`
and `--zone-id-field` choices. The wrapper verifies the retained plan against
those choices before native execution. For a new intake, pass the actual retained
archive directory with `--archives` as documented by the original workflow.
An existing validated receiving record reopens the imported sources directly.

The workflow records its original receiving identity and any moved local paths.
It reconnects to a surviving original programme child before launching a caller,
keeps real process attempt history, and proceeds immediately from a completed
programme to the existing comparison/report continuation. When installed
scientific source changes the programme identity, the maintained coordinator
registers the same selection and preserves the native run identities.

The `--serve` continuation opens the actual existing Workspace. It registers
an external `sources.json` only when that original intake manifest is present;
a restored Workspace already contains its imported sources and can reopen
without that external file. The same rule applies to the workflow's standalone
`serve` command. `--operator-ready-file` retains the original server startup
receipt in its own new file. Physical-only runs use their separate default
archive filename, preserving the economic edition's archive selection.

## Join the original 15 m receiving operation

The exact InVEST 3.20.0 archives now captured by the original receiving worker
contain a 15 m land-cover grid in EPSG:32737, with 1,939 columns and 603 rows.
The corresponding full-cell area is 0.0225 ha. The source README describes
SRTM 30 m elevation resampled to that land-cover grid. Preserve any existing
300 m study and its receipt as its own selected edition.

The original archive driver and the established programme intake have different
command interfaces and receiving records. The maintained original driver retains
its actual Workspace baseline under
`WORKSPACE/gura-receiving/gura-receiving-state.json`. The shared comparison
workflow uses the programme-style `receiving.json` contract. Use the adapter to
join the actual already prepared or completed run:

```sh
python -B -m source_tools.gura_receipt \
  --workspace "$GURA_WORKSPACE" \
  --run-id "$GURA_BASELINE_RUN_ID" \
  --output "$GURA_SOURCE_DIRECTORY/receiving.json"
```

Use the original receiver's actual baseline run ID. The adapter validates that
run against its retained source state, imported original arguments, biophysical
tables, selected native models, original land cover and grid. It verifies the
joined coefficient strings against their original model tables and registers an
ordinary programme that references exactly the same native run ID. Its receipt
records the original source IDs, original table edition and actual native grid.
Single-model NDR or SDR runs retain that choice through their class comparisons.

The original archive's table edition and the separately tagged biophysical
tables each remain attached to the profile that actually used them. The adapter
preserves the archived argument metadata, including its embedded older version
labels; the native execution remains the maintained InVEST 3.20.0 runtime.

A new invocation of the established programme intake through the wrapper now
selects the captured 15 m source grid and zero added context by default.
`--expected-resolution-m` and `--upstream-buffer-m` explicitly select another
source-matched edition. When `receiving.json` already exists, its original grid
and context are reused; supplied controls must agree with that receipt.
The current intake/grid implementation must include ESI's composed zero-context
and original-grid support. Keep its existing `receive(args)` API and install
the original standalone archive driver through the owner's separate command
path; their different receiving records are joined by `gura_receipt`.

The original programme completes first. The workflow then publishes the actual
baseline's annual watershed report through S1 before running the full selected
class alternatives. Its `reference_report_complete` event gives the original
baseline run, report directory and files, so the reference result can be opened
while the broad comparison continues.

## Continue the current calculation

If the saved programme still has an active native worker, the driver follows its
actual status and waits for that original worker. The launch gate is inherited
by the native child, so the same operation remains owned even if its caller
closes before the programme enters its execution lock. The first issued command
and its PID remain retained; later attempts each have their own saved record.
The driver also checks actual local child identity before issuing another child.

A completed programme with completed native cases continues directly into the
original watershed report, economic companion and whole-Workspace archive.
A completed report moved with its Workspace reopens from its verified relative
artifacts. The previous result JSON is preserved under `receiving-results`
before current report and economic paths are rebound. Previous external archive
provenance remains with its original receiving location; a new receiving archive
is recorded only after its actual backup completes.
Unfinished cases continue through the original programme executor, which reuses
completed native runs and their retained model stages. An existing pause remains
under the original programme's pause/resume controls.

The driver retains the real native child command, host, PID, log and return code
when it launches a calculation. Native completion is checked from the retained
programme and run records. The reported Gura classes, changed cells and hectares,
native output units, report selection and economic inputs remain those of the
original maintained implementation.

For Tim: “We can move or reopen the study and continue its saved calculations
and reports from the same original inputs.”

## Current shared launcher and portable workflow capsule

This edition composes the published shared launcher recovered from the public
application on 13 October 2026. It retains the launcher’s separate
`programme-executions/<programme_id>` command records, original first process
record and attempt history. Continuing a saved programme uses the original
`resume` command, which clears its pause request before continuing unfinished
work. If the installed scientific source changes, the existing coordinator
registers the same selected native cases under the current programme source
edition and retains the prior programme as its origin.

The original-input workflow now saves its receipt, original programme selection,
comparison plan and progress inside `WORKSPACE/gura-workflow`. After the complete
Workspace moves, supply the actual new `--workspace` and intake
`--source-directory`. The workflow authenticates the capsule against the
restored Workspace, restores the exact source receipt and saved plan, and reads
programme selections from the native Workspace. It does not rewrite the source
receipt’s old machine paths. Those paths describe its original receiving
location; the explicit current Workspace controls execution.

Earlier capsule editions reformatted receipts or changed their local paths.
When their retained comparison still contains the original receipt, the
workflow recovers that exact file by the SHA256 already recorded in the saved
plan. It preserves any previous path-rewritten copy under
`receiving-locations/<sha256>.json`. It then continues the same source selection
and native run identities.

Completed economic outputs can occupy either the original zone directory or
the shared producer’s `editions/<report_id>` directory. The receiving path
recovery keeps that exact edition, verifies its report, source zone and archive,
and exposes its current desk path. Historical result bytes and the previous
external archive location remain retained alongside the received result.

The original archive check uses the Workspace source entry’s actual
`body.sha256` descriptor. This follows the imported source schema and preserves
the current shared receiver’s archive verification. C8FF’s original-driver
receipt binds its archived inputs through the existing receiving state and
source-bound table/argument records.

### Source installation

Apply this edition over the exact current shared source, preserving surrounding
application modules and the current `receive_gura.receive(args)` integration.
The source packet provides complete files and guarded replacements against
the freshly recovered comparison and workflow. The packet’s recorded base
hashes identify those exact sources. The retained original-receipt adapter
remains an additive module.

The equipped receiving operation should compile the installed modules, continue
its existing native programme and publish the first actual model result.
Retain the issued command, host, interpreter, programme ID, process ID and log.
Open the generated original watershed report before continuing the broad class
comparisons, then exercise the same completed report and Workspace after
transfer.

The integrated shared edition also retains the original watershed report's live
progress callback and uses the programme's inexpensive status path during native
process observation. Reopening completed native outputs uses the GIS/reporting
runtime; the original coordinator checks the pinned InVEST runtime when native
calculation is needed.

The current shared `_native_selection` interface remains available. Fresh intake
passes an omitted expected resolution through to the receiver, which reads the
actual original raster; `--expected-resolution-m` is an optional check. Context
remains independently selectable and permits zero. A partial intake reuses its
saved grid's resolution and context, and source updates reuse an already saved
programme whose scientific source matches before registering another edition.


### Retain study context across automatic reports

The early original-reference report and the full class-comparison report now carry the saved plan’s original study title, purpose and source reference as an explicit native-study delivery context. The source report created by `receive_gura_study.py` uses the same declaration as its native delivery. This context follows the saved report into the Economic desk and atlas; it is independent of the actual grid resolution and selected model scope.

Continuing a partially completed comparison preserves its first `report-selection.json`, verifies the same ordered runs, pollutants and watershed selections, and retains the current context-bearing selection under `report-selections/<selection-sha256>.json`. The current selection descriptor is recorded in progress. Existing completed report and economic editions reopen unchanged. See [Original study context through reports and client delivery](GURA_COMPARISON.md#original-study-context-through-reports-and-client-delivery) for the operator route.
