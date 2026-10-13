# Receive a source-profile comparison before raster preparation

This receiving path imports the retained regional biophysical source, materializes the already-published source alternative through `model.experiment_profiles`, and saves a complete source comparison in the original Workspace. It produces the readable report, original table/source ZIP and an exact profile-selection handoff immediately. The existing Scenario sensitivity form then supplies its selected grid, baseline and alternatives.

The entrypoint is `source_tools.receive_profile_comparison`. The merged Source profiles component, original Workspace/profile-source engine and original source directories are its dependencies. It uses their existing content identities and the standard library. Run it from the complete application root with that application's Python.

## Current receiving operation

Continue the same cloud source/operator Workspace used by the completed 217-HUC regional receiving arm. Its existing original watershed report and paired results keep their IDs. Select its actual Workspace path; `--create` only initializes that chosen directory when `workspace.json` does not exist.

The independently demonstrated paired archive receiving runtime is:

- Application: `/workspace/scratch/790ee23f7efd/ensemble-recovery-operation`
- Interpreter: `/workspace/scratch/790ee23f7efd/ensemble-recovery-venv/bin/python`

Use the current complete application installed at that host, including PR2885 and this receiver. The original GURA-NATIVE-01 model operation continues through its maintained native programme. Both receiving arms can use the original source-profile records when they share the same actual Workspace.

## Immediate regional source comparison

This command explicitly selects the working reference configuration copied from the source owner's existing `source/run_profile_source_workflow.py`, then applies the coherent Upper Flint 2024 nonurban coefficient specification:

```sh
"$PYTHON" -B -m source_tools.receive_profile_comparison \
  --workspace "$WORKSPACE" \
  --working-regional-example
```

For the first retained regional Workspace in a receiving operation, add `--create` to this same command. Continue the completed regional archive import in that Workspace using its original receiver:

```sh
"$PYTHON" -B -m source_tools.receive_watershed_context \
  --workspace "$WORKSPACE" \
  --source-package source/water_context/20261013/completed-run.package.json
```

The application includes these original inputs:

| Source | Selected file |
|---|---|
| Georgia 2019 nutrients / Duke Forest 2022 erosion table and companions | `source/biophysical-regional-20261012/source-manifest.json` |
| Explicit working algorithm configuration and source attribution | `source/biophysical-regional-20261012/working-profile-intake.json` |
| Coherent Upper Flint 2024 nonurban coefficient alternative | `source/upper-flint-2024/profile-combined.json` |
| Original Upper Flint source/mapping explanation | `source/upper-flint-2024/README.md` |

The original regional table has SHA256 `b2b5778c5d8c71b2b0c6db370f29a60e987d1be3d491cec91493a0b975b8b9e4`. Its ordinary source import verifies the manifest's original table and companion identities. The explicit working-parameter JSON cites the original source workflow SHA256 `a3856040873a7ff1fe19a1ab3316ffc8ca7927ac9a982bfde581ee95e24301d9`.

### Declared working parameters

The two profiles hold these algorithm choices fixed:

| Parameter | NDR | SDR |
|---|---:|---:|
| Stream threshold, upstream cells | 1000 | 1000 |
| Connectivity shape k | 2 | 2 |
| Flow routing | mfd | mfd |
| Subsurface N retention length, m | 200 | — |
| Subsurface N retention efficiency | 0.5 | — |
| Maximum SDR | — | 0.8 |
| Connectivity midpoint | — | 0.5 |
| Maximum L factor | — | 122 |

These are the source owner's explicit working choices. The saved profile retains their working scientific status and complete attribution. Regional coefficient provenance is distinct from selecting site-specific stream/routing parameters. The later native study selects its actual grid, source period and scenarios.

The existing Upper Flint specification applies the published nonurban rows to NLCD 31,41,42,43,52,71,81,82,90. It retains the regional water, developed and emergent-wetland rows. Its own metadata records grouped forest/herbaceous mappings and the modern `measured-runoff` compatibility choice. The receiver copies the specification, binds the actual saved baseline ID and passes it unchanged to the existing profile engine.

Original source: Abbasnezhad, Abrams and Wenger (2024), *Land*13(6),893, https://doi.org/10.3390/land13060893 ; author supplement https://www.researchgate.net/publication/381634619_land-2997438-supplementarypdf . Field-level citations, original table identities and modified-cell rationale remain in the materialized profiles and their companion lineage.

## Continue existing source work

Use an actual retained baseline and the existing source factor specification:

```sh
"$PYTHON" -B -m source_tools.receive_profile_comparison \
  --workspace "$WORKSPACE" \
  --baseline-profile "$BASELINE_PROFILE_ID" \
  --profile-spec source/upper-flint-2024/profile-combined.json
```

Repeat `--profile-spec` for independently selected published alternatives. Each specification is retained byte-for-byte. Its `baseline_profile_id` must be the selected actual ID, absent, empty, or the published `BASELINE_PROFILE_ID` placeholder. The receiving state records that original binding and the resulting exact native profile IDs.

Existing source-workflow results can enter directly:

```sh
"$PYTHON" -B -m source_tools.receive_profile_comparison \
  --workspace "$WORKSPACE" \
  --workflow-receipt "$ORIGINAL_PROFILE_WORKFLOW_RECEIPT"
```

The receipt's Workspace UUID must match. The receiver reads its baseline and actual profile IDs from the original Workspace and creates a saved comparison. It does not need the earlier workflow's file-reconstruction exercise.

For already-retained reference/candidate profiles:

```sh
"$PYTHON" -B -m source_tools.receive_profile_comparison \
  --workspace "$WORKSPACE" \
  --baseline-profile "$BASELINE_PROFILE_ID" \
  --candidate-profile "$CANDIDATE_PROFILE_ID" \
  --grid "$PREPARED_GRID_ID"
```

A supplied grid adds its actual retained NLCD class counts and selected-model scope. Those counts describe the aligned prepared input rectangle. The completed native comparison later supplies its own shared output support.

### Import a complete baseline selection

`--baseline-spec FILE` accepts:

```json
{
  "schema": "upstate.profile-intake-spec/v1",
  "source_manifest": "source-manifest.json",
  "source_id": "regional-biophysical",
  "table_sha256": "ACTUAL_ORIGINAL_TABLE_SHA256",
  "attribution": {"purpose": "Describe the actual selected parameter source"},
  "profile": {
    "title": "Actual complete parameter selection",
    "references": ["ORIGINAL_SOURCE_URL"],
    "ndr": {"...": "all declared selected NDR parameters"},
    "sdr": {"...": "all declared selected SDR parameters"}
  }
}
```

This is a shape illustration; the shipped working-profile-intake JSON is the complete executable example. The source-manifest path is relative to the selection file and stays within its directory. The importer supplies the actual source collection ID and source ID, reads all original companions, and validates the complete profile using the existing native profile schema. The selected source manifest and intake JSON are retained with their bytes and hashes.

## Saved outputs and recovery

The receiving operation returns actual runtime and source identities:

- Hostname, executable, Python version, application root, Workspace root and UUID.
- Baseline profile, materialized profile-set IDs and candidate IDs.
- Actual saved comparison ID and common native model scope.
- Full report directory, HTML and source/report ZIP paths and per-file hashes.
- Exact `study_selection` and its saved JSON path.
- Any requested original Workspace backup and its hash.

The operation lives in:

```text
WORKSPACE/profile-comparison-intakes/INTAKE_ID/
  selection.json
  state.json
  original-selections/
  comparison-selection.json
  study-selection-COMPARISON_ID.json
```

The original comparison/report storage remains:

```text
WORKSPACE/profile-comparisons/COMPARISON_ID.json
WORKSPACE/profile-comparison-reports/COMPARISON_ID/
```

An intake identity binds the actual Workspace, baseline table/profile, original specification hashes, explicit candidate profiles and selected grid/title. Repeating the same command resumes its original profile materialization. Complete source tables, derived-cell lineage and saved profiles keep their original IDs. Every exported report member is read back against its original descriptor before the receiving state reaches `reported`.

The comparison saves the native-run metadata available at that time. If native results arrive later, continuing the same intake retains the new comparison edition in `comparison_ids`; earlier saved editions remain available. No source-profile record is deleted.

The operation lock is local to that exact intake. Exceptions retain phase and error in `state.json`, and the same command resumes with original profile IDs. The CLI emits the actual result as JSON and returns a nonzero status for a failed operation.

## Optional complete Workspace backup

```sh
"$PYTHON" -B -m source_tools.receive_profile_comparison \
  --workspace "$WORKSPACE" \
  --working-regional-example \
  --backup-directory "$OUTSIDE_WORKSPACE_BACKUPS"
```

The original `Workspace.backup` owns the portable archive. The selected directory must be outside the Workspace. Archive filenames include the intake and comparison IDs. An existing archive is reused only when the retained path, size and hash agree; a different existing file is preserved and reported as a path conflict.

Open the existing operator against that same Workspace. In **Source profiles**, open the saved comparison, inspect the original table links and load-definition changes, and select **Use selected source profiles**. The existing native study form preserves the reference first, selects only common model scope and uses the actual prepared grid/scenarios. The original study engine owns subsequent runs, parameter sensitivity, physical paired reports and optional raster products.

The original model CLI remains usable:

```sh
"$PYTHON" -B -m model.profile_comparison_cli --workspace "$WORKSPACE" inspect "$COMPARISON_ID"
"$PYTHON" -B -m model.profile_comparison_cli --workspace "$WORKSPACE" export "$COMPARISON_ID"
"$PYTHON" -B -m model.ensemble_cli --workspace "$WORKSPACE" catalog
```

For physical method interpretation, see `model/PROFILE_COMPARISON.md`, `model/ENSEMBLE_OPERATIONS.md` and the version-pinned InVEST 3.20 [NDR](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html) and [SDR](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html) guides.
