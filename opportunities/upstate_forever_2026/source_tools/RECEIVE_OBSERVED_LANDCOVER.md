# Receive selected-watershed observed land-cover changes

This procedure uses the original 217-HUC Annual NLCD 2023 and 2025 inventories and paired class transitions already retained in the application. It imports their existing source manifest, selects actual HUC12 records, saves the native comparison, composes its Scientific Report, exports PDF and original companions, and receives a complete Workspace archive into a second Workspace. Finally it launches the copied receiver from the restored application and reopens the same products.

The source-only course reads the published class counts. It does not require the original raster solver. The selected native comparison retains the complete 16 × 16 directional matrix, annual margins, class gains and losses, original cell support and NoData counts. Its percentages use the selected paired-valid cells as their denominator.

## Application assembly

Receive the current application through its maintained `source_tools/application_assembly.py` and `source_tools/application_components.py`. The additive declaration is:

`integration/component_fragments/observed-watershed-change.json`

Its component identity is `observed-watershed-change`. The fragment appends this family to the selected edition and declares the complete desk, native model/provider, receiving procedure, original source ZIP writer, and the native manifest:

`observations/landcover_2023_2025/model-sources.json`

The declaration includes all ten source members. The component closure reads their actual manifest paths and checks their original byte counts and SHA-256 values. It depends on the maintained `core`, `observed-context` and `scientific-report-review` families, which provide the original Workspace importer, queue, upload/download transport, source composer and PDF renderer. Python imports and registered browser assets remain part of the same static closure. Preserve the fragment when capturing an installed application.

A full Git checkout containing the merged feature and this receiving addition already contains these paths. A selected source carrier must also carry the fragment, its declared source members and the resolved dependencies; copying only the six desk files is insufficient.

Inspect a complete installed application with the maintained assembler:

```sh
"$ECO_GIS_PYTHON" "$ECO_APPLICATION/source_tools/application_assembly.py" \
  "$ECO_APPLICATION" --edition selected-huc-receiving --inspect
```

Use the same assembly command with `--output`, `--source-map` or `--zip` for the actual receiving edition. Publication requires the original component closure to be complete. Existing shared host and renderer source is selected by that application edition; this family does not overwrite it through a separate installer.

The native Workspace backup's maintained application inventory includes `model`, `operator`, `source_tools`, `integration` and `observations`. The copied receiver and original source family therefore travel in the same archive and can be reopened independently.

## Run in the receiving application's native scientific environment

Use the equipped receiving host's actual application, Python, Workspace and state paths. Keep the operator state and output directories outside the scientific Workspace and application source. The state directory is dedicated to this course's original queue. Use an existing actual receiving Workspace, or add `--create` when the chosen directory is new.

```sh
"$ECO_GIS_PYTHON" "$ECO_APPLICATION/source_tools/receive_observed_landcover.py" \
  --workspace "$ECO_WORKSPACE" \
  --state-directory "$ECO_RECEIVING_STATE" \
  --output "$ECO_RECEIVING_OUTPUT" \
  --operation-id ECO-264B-SELECTED-HUC-20261013 \
  --source-revision "$ECO_APPLICATION_REVISION" \
  --huc12 030601010101 \
  --huc12 030601010102 \
  --huc12 030601010103 \
  --huc12 030601010704
```

The four default HUCs are those shown above. Each must be present in the actual imported native inventory. Set `--restore-directory` if the original Operator's default receiving root is unsuitable. `--timeout-seconds` controls waiting for each actual native phase and the copied application's cold reopen.

For these four original HUCs the source contains 370,136 paired-valid cells: 364,377 stable-class cells and 5,759 changed-class cells. The changed share is approximately 1.55591458275%; the native report calculates it from the original counts. These are a useful source selection reference, not replacement inputs. Every saved edition binds the original source SHA values and HUC identities.

## Original operations and outputs

The procedure uses the actual registered actions:

1. `observed.landcover.import` imports the original installed manifest.
2. `observed.landcover.save` saves the selected native HUC comparison and its ordinary `OBSERVED_CONTEXT` source.
3. `source-reports.render` uses the actual Scientific Reports preview for that retained source.
4. `source-reports.export` saves the complete native report archive.
5. `workspace.backup` retains the Workspace and complete application with `include_intermediates=false`.
6. `workspace.restore` receives the actual native backup ticket through the original upload CAS.

The output directory contains:

- `selected-huc-receiving.json`: frozen course selection, source implementation history, original requests and accepted queue identities, product identities and receiving progress.
- `selected-huc-landcover.zip`: the selected comparison, human-readable HTML, complete directional CSVs, original JSON sources and declared companions.
- `selected-huc-scientific-report.pdf` and `selected-huc-scientific-report.zip`: actual renderer outputs and their native original companions.
- `cold/cold-reopen.json`, `cold-stdout.json` and `cold-stderr.txt`: the result of launching the copied receiver from the restored application.

The full Workspace ZIP remains the original Operator's retained output and download ticket, recorded in the journal. The receiver streams its actual bytes into the original upload endpoint and verifies its SHA before restore. The original project identity remains separate from each physical Workspace's local key.

The course only marks `complete: true` after the restored application itself reopens the exact saved comparison/report, verifies their original file hashes, and confirms the same native model source. A saved PDF is also opened and checked as an actual PDF. Completed native tasks are reopened from the original queue after operator restart.

## Resume the same course

Repeat the identical command and paths after a transport interruption. The journal reuses its original request and operation IDs. If the native queue had coalesced an identical active request, its accepted task and operation are retained before waiting. Completed phases are read back; the receiving course does not resubmit them under new identities.

For a repaired incomplete course, retain the original `--source-revision` argument and add:

```sh
--resume-failed --reviewed-source-revision "$ECO_REPAIRED_APPLICATION_REVISION"
```

This records the old and new actual implementation hashes and the existing phase identities. The scientific selection, original project and completed products stay unchanged. The same reviewed revision must continue to identify the same installed source on subsequent retries.

If only the implementation changed after a native report completed, the original saved report request and preview remain the authority. The maintained report renderer reconciles its completed `operation.json` before using today's renderer.

If a report failed before completion and the repaired renderer requires a different native preview, the receiver obtains that preview from the same original source list and title. It records the old failed request, task, accepted operation and preview as a predecessor, then uses a deterministic new operation for the reviewed implementation repair. The original request and files remain intact. An active original task is reconciled first. Completed comparison, report, export and backup identities are never silently replaced.

If a completed archive itself needs a different application edition, retain that original archive and start an explicitly named receiving course for the new edition. The journal prevents a completed artifact from changing underneath the same phase.

## Reading and using the delivered comparison

Open **Observed watershed change** in the restored application and select the saved edition. Its source control hands the exact retained `OBSERVED_CONTEXT` pair to **Scientific Reports**, allowing the existing report composer to combine it with other actual study sources.

CSV text that begins with a spreadsheet formula prefix is apostrophe-prefixed for safe spreadsheet opening. Exact original strings remain in the retained JSON. Import HUC12 columns as text to preserve leading zeroes.

Class change describes the observed annual classifications and their explicit paired support. It does not establish intervention causality or substitute for native fractional-treatment scenarios. Original class inventories, transitions, geometry/domain binding and source years remain available in the delivered originals.
