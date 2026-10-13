# Direct Calibration Studies — complete installer source

This release contains all **105 exact source paths** consumed by the maintained Calibration installer at merged commit `81120739440bdaf152182e0a35c29cd83b119545` ([PR4784](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/4784)). Every body was compared with that merged application tree and verified after reading back the complete encoded carrier.

The cohort includes direct saved Calibration selections, original source and observation-period inspection, immutable receipt verification, editable receiving, selected-profile continuation, Parameter working histories, same-DEM catchment integration, and the current shared joint Parameter, terrain and climate Study runtime. It preserves the previous complete 86-file family and adds its current required source members.

It installs into an **existing complete scientific application**. The 76 retained host prerequisites are listed in `manifest.json`. Original datasets, native model dependencies and scientific Workspaces remain separate. This cohort does not replace a complete application or an original Workspace.

## Materialize and install the complete source

Download `source-bank.json.gz` and `materialize_source.py` from this pinned directory. A connector-only receiver can fetch the exact complete UTF-8 blob `af1f92070d115475180c2702cb24d5ca2fe59389` and save its unmodified content as `source-bank.base64.txt`. Both carriers represent the same source bank; direct native Git HTTP is optional.

Set the variables to the actual receiving paths and qualified Python:

```bash
export ECO_PYTHON=/path/to/the/qualified/python
export ECO_APP=/path/to/the/existing/complete/application
export ECO_CALIBRATION_SOURCE=/path/to/a/new/calibration-study-source
export ECO_CALIBRATION_BANK=/path/to/source-bank.json.gz
"$ECO_PYTHON" /path/to/materialize_source.py --bank "$ECO_CALIBRATION_BANK" --output "$ECO_CALIBRATION_SOURCE"
"$ECO_PYTHON" "$ECO_CALIBRATION_SOURCE/operator/install_calibration.py" --application "$ECO_APP" --source "$ECO_CALIBRATION_SOURCE" --preview
"$ECO_PYTHON" "$ECO_CALIBRATION_SOURCE/operator/install_calibration.py" --application "$ECO_APP" --source "$ECO_CALIBRATION_SOURCE"
```

For the text carrier, set `ECO_CALIBRATION_BANK` to the actual `source-bank.base64.txt` path. Do not trim, reformat or split its content.

The materializer verifies the full carrier and all 105 original members before creating a new source directory, and refuses to replace an existing directory. The installer checks exact predecessors, retains backups, composes current extension registration and rechecks concurrent changes. Run it at a safe boundary for that physical application, preserving active processes and their Workspace. If an independent later source differs, reconcile the actual source body instead of bypassing the installer guard.

## Share an already completed original course

The installed source contains the full guide at `source/usgs-southeast-sparrow-2012/CANDIDATE_COURSE.md`. For a completed seven-reference course, set these paths to its actual retained Workspace and output directory:

```bash
export ECO_ORIGINAL_WORKSPACE=/path/to/the/original/workspace
export ECO_COMPLETED_COURSE=/path/to/the/completed/course-output
export ECO_RECEIVED_STUDY=/path/to/a/new/independent/received-study
PYTHONPATH="$ECO_APP" "$ECO_PYTHON" -m source_tools.sparrow_candidate_course \
  --workspace "$ECO_ORIGINAL_WORKSPACE" \
  --output "$ECO_COMPLETED_COURSE" \
  --share-completed \
  --receive-study "$ECO_RECEIVED_STUDY"
```

This mode reads the seven original course-control files and the saved immutable Workspace records. It preserves the original source, units, observation periods, train/holdout assignments and prior history. It exports the original direct Calibration Study, restores it independently and verifies it through a separate process using the archived application. It does not rerun comparisons, fitting or native models, and does not require the former prepared-input directory. Optional existing follow-up Calibration IDs and saved supplementary products are described in the complete guide; only products already related to the retained evaluation are admitted.

The original analysis output remains unchanged. The sharing phase records its own progress and result; interruption in sharing does not change the status of the completed scientific analysis.

## Inspect the received product

Read `model/CALIBRATION_STUDIES.md`. In the actual operator, open **Study transfer**, then **Received studies and original sources**. Inspect the original observation periods, methods, units, source downloads, captured status and current retained status. Use **Open original evaluation**, **Open editable design** and **Open selected native run** where offered. Inspect saved reports, maps, histories and original downloaded files at desktop and narrow widths. Preserve captured studies and create new native identities for later work.

Full source review, exact merged-body comparison and complete carrier reconstruction passed. Actual native Python execution and rendered browser inspection of this new direct-Study course remain with the original receiving owner; source verification alone is not a claim that those runs are complete.

## Exact identities and provenance

- Source files: **105**, containing **2,112,234 original bytes**.
- JSON: 2222134 bytes / SHA-256 `94c26e2c781aa2d2659e6095fa06f31e54e5bd3043ca83fa3b8f9545fec2fff6`.
- Gzip: 563837 bytes / SHA-256 `cbac362f3a6c07e591ec9ea3c075e69c31180ea0715c4d1d010ad86915c2f221` / Git blob `2016becd99a507c470e48af7c4b14847fd1cfc0a`.
- Base64 UTF-8: 751784 bytes / SHA-256 `235b6d703385ce6339512ca9aade082dc024845696aa72f428cede00a6560651` / Git blob `af1f92070d115475180c2702cb24d5ca2fe59389`.
- All path, byte-length, SHA-256 and immutable Git identities are retained in `manifest.json` and the full source bank.
- Source checkpoint: [original Eco thread, 1791917408.834329](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791917408834329?thread_ts=1791724121.853269).
- Full workflow handoff: [1791917909.854029](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791917909854029?thread_ts=1791724121.853269).
- Historical full86 source remains unchanged at `3044fee9c272b8d5434db05970371b6e2745b2f9/deliveries/ecosystem_20261013/parameter_working_86`.
