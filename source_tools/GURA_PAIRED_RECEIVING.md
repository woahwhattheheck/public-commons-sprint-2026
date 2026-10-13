# Original Gura paired receiving

This continuation uses the actual completed Gura baseline, its original archived coefficient tables, its saved grid and the maintained InVEST engines. It selects two explicit land-cover alternatives: original class 5 to original class 8, and original class 5 to original class 19, within the original reporting watershed. Each alternative is evaluated separately.

The source arm is the existing GURA-NATIVE-01 operation. Use its restored Workspace or its current completed Workspace on the accepting host. The regional Upper Savannah project is a different scientific case; keep its source selection separate.

## Source and application

The three production files in this package are the exact merged PR3368 implementation, commit ed06d50e7beaa8fdf1f11fe3a0c6f6d86ccf6eaa. The additional source_tools/prepare_gura_paired_case.py binds the original native receiving record to those maintained APIs and records each receiving attempt.

Install into the complete current Upper Savannah application. Required existing modules include model.workspace, model.compute_programme, model.parameter_studies, model.experiments, model.scenario_decisions, model.native, model.rasters and source_tools.gura_receipt, gura_comparison and receive_gura_studies. The ordinary cumulative application already supplies them. The source family index is https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C9KMLM34G; use its current family identity and whole-application receiving instructions, then install the additive paired leaves from this package. Native command execution uses the application source directly.

The prepared standalone family and the regional project archive are not an original Gura Workspace archive. To reuse the original completed native work, restore the actual original Workspace using the application's model.portable implementation and retain gura-receiving/gura-receiving-state.json. That Workspace contains the original coefficient/argument sources, grid and saved run outputs. The gura_receipt adapter verifies their bindings and creates the ordinary shared receiving.json without another baseline solve.

## Original source identity

The immutable original data archives are listed in source/gura-paired-original-inputs.json. NDR.zip is 701988 bytes with SHA256 df4ba0d9b96152d3bc5eef3c41b6ec701f62ec3548dc4d4d4c8af8bea53c6c7d; SDR.zip is 726334 bytes with SHA256 34351a1305d8e6258c2d566917cfeab5f152096e930ef5b0a834968146bdc779.

The actual completed original case used the archived datastack coefficient tables and arguments. Its 15m EPSG32737 grid had 1939 columns, 603 rows and 0.0225ha pixels, with zero context buffer. Its threshold of 1000 upstream pixels represents 22.5ha. The helper reads the actual selected grid and retains it; it does not force a new resolution.

For a first original baseline on an admitted receiving host, the maintained receive_gura_native parser accepts --inputs as a directory containing exactly one matching NDR.zip and one SDR.zip. It verifies original sizes/hashes and safely extracts/retains their original datastack members itself. The source contract was read from PR3324 commit ff1025bd891af49bca9bc099946a05463975e0ca, receiver Git blob 327d251cd0ff9800b09928e53e3a8bea883b4c59 (74,034 B, SHA256 8929b6966e6ebcca7c6b41ad6647de4d48b4071154d3bc9a4fad5d5a31906e6b). Keep a newer maintained receiver already installed in the cumulative application.

Acquire just those two official archives using the original family 104 helper's existing acquire() function. This call does not select the generic sample-table workflow:

```sh
"$PY" -B - "$APP" "$ORIGINAL_GURA_INPUTS" <<'GURA_ARCHIVES'
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[1]).resolve(strict=True)))
from source_tools.receive_first_gura_case import acquire
print(json.dumps(acquire(Path(sys.argv[2]).resolve()), indent=2))
GURA_ARCHIVES
```

The original receiver then prepares and runs its reference/Workspace course using the archived tables. GURA_ARCHIVE must be an external archive path, separate from the live application and Workspace.

```sh
"$PY" -B "$APP/source_tools/receive_gura_native.py" \
  --application "$APP" --workspace "$WS" \
  --inputs "$ORIGINAL_GURA_INPUTS" --models ndr sdr --mode both \
  --archive "$GURA_ARCHIVE"
```

The current receiver checkpoints under "$WS/gura-receiving" and reuses actual completed native stages. On independent restoration, use the returned restored application/Workspace paths and omit --inputs to reopen verified retained originals. The original invocation and archive-recovery semantics are retained in the same-operation source post https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791871520276589?thread_ts=1791760162.728339 .

The existing GURA-NATIVE-01 owner selects this fresh-host route only when continuing the original admitted operation there. If its complete original Workspace can be transferred, restore and reuse it first. The explicit paired command below follows that completed original baseline.

## Exact receiving commands

Set APP to the complete application directory, WS to the original or restored Gura Workspace, and PY to the actual scientific interpreter on the accepting host. Application and Workspace must be separate directories.

Default admission adopts the actual original baseline, creates the explicit class plan, prepares the paired study and synchronizes completed cases. It launches zero native model solves:

```sh
"$PY" -B "$APP/source_tools/prepare_gura_paired_case.py" \
  --application "$APP" --workspace "$WS"
```

The original state defaults to "$WS/gura-receiving/gura-receiving-state.json". When restoring an externally retained state or selecting its run explicitly:

```sh
"$PY" -B "$APP/source_tools/prepare_gura_paired_case.py" \
  --application "$APP" --workspace "$WS" \
  --receiving-state "$ORIGINAL_GURA_STATE" \
  --baseline-run-id "$ACTUAL_BASELINE_RUN"
```

After the single existing GURA-NATIVE-01 owner admits the pending paired course, continue that same prepared selection:

```sh
"$PY" -B "$APP/source_tools/prepare_gura_paired_case.py" \
  --application "$APP" --workspace "$WS" --execute
```

Add --output "$PAIRED_EXPORT" to export to a separate directory. The maintained receiver rejects an output that intersects the application or Workspace trees or their ancestors.

The helper requires natcap.invest 3.20.0 for execution. Its receipt records actual Python, installed package versions, hostname, PID and exact application source hashes. The current native engine retains the full model argument and execution provenance. Rasterio alone does not supply InVEST/GDAL/pygeoprocessing; use the accepting host's actual scientific environment.

## Selection and execution meaning

The original combined-model axes produce 16 native parameter profiles. Two additional original-profile cases vary the physical stream-initiation threshold by 0.5 and2. With the baseline plus two explicit landscapes, the original-grid design has 54 selections. Original cases and stage-cache matches are reused. The helper does not add resolution or domain experiments automatically.

The preserved default design includes the selected baseline itself. For already-completed parameter summaries, the companion parameter-study correction introduces summary edition parameter-study-summary/2 so old reports refresh from retained runs. This is independent of native-engine and GIS-export editions.

The paired report asks whether treatment benefit and alternative ordering persist across those explicit parameter choices. It computes baseline minus alternative on common valid support. Its common support is shared across completed matched profile/landscape cohorts within each grid, so a change in support cannot silently become a treatment benefit. It retains original full totals and coverage alongside the shared-support result. Separate spatial grids retain separate comparison cohorts.

A positive paired benefit means lower modeled annual export than that profile's baseline. Native N/P output rates are converted once using actual affine pixel area; retained Workspace outputs are kg/year per pixel, summed to kg/year. Sediment export is metric_tonnes/year per pixel, summed to metric_tonnes/year.

## Receiving result and recovery

Every attempt records source binding, mode, exact software files, actual original class labels/coefficient rows, affected source-cell counts, grid/profile/scenario/programme IDs, logs and the actual paired study state under:

gura-receiving/paired-class5-continuation/attempts/<attempt>.json

latest.json points to that attempt. Logs have unique names and remain alongside it. The original receiving.json and immutable class plan live under the original programme directory. The actual model/report state is under paired-robustness/<study-id>/state.json, with immutable report generations and their hashes.

A returned partial state retains completed cases and progress; repeat the same command to continue the same saved selection. The ordinary native batch guard prevents overlapping solver courses. Attempt errors preserve the original exception even when storage cannot save another receipt. There is no new numerical solver or alternative run queue.

## Actual results already retained

The source-native baseline NDR/SDR comparison completed with zero differing common-support cells and maximum difference zero after the original output-unit conversion and matching float32 encoding. The completed four-case NDR study shows why common support matters: D8 k=1 reports a 0.9506% increase in independently summed full nitrogen totals but a 5.1807% decrease on the same 456304 cells. Those are different geographic comparisons. MFD k=1 increases nitrogen 3.5436% and phosphorus 4.7056% on unchanged 458967-cell support.

These actual prior outputs and the native 30m resolution/unit journey are retained in https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8KE9N5U3. Their input/output identities remain separate from newly prepared paired selections. This helper's default receipt explicitly records native_solver_calls:0; execution receipts report the actual retained study state and completed cohorts.
