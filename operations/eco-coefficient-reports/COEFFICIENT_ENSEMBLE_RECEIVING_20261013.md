# Receive the ensemble coefficient source package

This package joins the coefficient evidence feature, native ensemble and calibration report exports, Study receiving, and observed-report source links into the current Eco application. Continue the existing coefficient-family installer and its original scientific Workspace.

## Exact source

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `coefficient-ensemble-report-source-20261013.source.json` | 2709384 | `f7d0c7869d68f265071e6e38b7be84a6290c8d4c7dd26947b969823675535aa9` |
| Decoded complete source bank | 7747842 | `ef6ff10fd95f7705d21a1bd217aac5ebd01fb0fb85dfad73bab23d3f70939adf` |
| gzip payload | 2031759 | `cb06aa8d38dd2ac321f44a2e9a99d8ec5bd1a8ee6626e65249ea65ea9203937d` |

The decoded bank carries 262 complete files, 6,874,862 source bytes, 19 selected changed paths, 243 supporting paths, and 16 SHA-bound patch groups containing 69 literal edits. It retains the original 53 base-dependency declarations. Every file identity and every patch group's reverse/forward transformation has been checked. The complete receiving application supplies the original base; this package is an overlay on that application.

First finish the existing 104-file coefficient-family receiving course using the neighboring `coefficient-report-source-20261013.source.json` and its original composition. That course owns installation of the earlier biophysical feature. This successor adds the ensemble/report changes. Its supporting paths retain any bodies already installed and supply missing bodies, so it must not be used to skip the earlier feature installation. Preserve current component catalogues and peer changes through the existing assembler.

## Materialize and join

Use the materializer from merged PR 4263 or its compatible current successor. Its exact published Git blob is `08470a56c1b49facc086b6b1dc3eb7727d9961bc`. Read the actual operation ID and paths from the existing receiving operation. The variables below represent those existing selections and new owned output directories.

```sh
"$PYTHON" -B "$MATERIALIZER" \
  --bank "$BANK" \
  --bank-bytes 2709384 \
  --bank-sha256 f7d0c7869d68f265071e6e38b7be84a6290c8d4c7dd26947b969823675535aa9 \
  --operation "$OPERATION_ID" \
  --output "$STAGE"

"$PYTHON" -B "$STAGE/source/source_tools/application_assembly.py" "$CURRENT_APP" \
  --overlay "$STAGE/banks/ef6ff10fd95f7705d21a1bd217aac5ebd01fb0fb85dfad73bab23d3f70939adf.json" \
  --declared-overlay 1 \
  --expect 1:ef6ff10fd95f7705d21a1bd217aac5ebd01fb0fb85dfad73bab23d3f70939adf \
  --edition eco-coefficient-ensemble-20261013 \
  --operation-id "$OPERATION_ID" \
  --output "$JOINED_APP"

"$PYTHON" -B "$JOINED_APP/install_profile_workbench.py" \
  --application "$JOINED_APP" --source-root "$JOINED_APP"
```

The complete bank also carries explicitly reviewed successor bodies for four published files whose newer features changed the earlier edit context. The assembler verifies each full UTF-8 body against its byte count, SHA-256 and original Git blob. It retains an installed successor only when that exact body matches; older installations receive the original feature bodies through their existing guarded composition. The receiving record identifies the retained source and published provenance.

Run the newly staged assembler: it includes the explicit declaration handling and its required sibling modules. It applies selected changed paths through verified original bodies or unambiguous literal changes, retains existing support, supplies missing dependencies, and records the resulting source identities. The ordinary strict overlay behavior stays available. An ambiguous edit must be reconciled against the reported current source, preserving unrelated edits, before repeating the same installation.

Use the complete joined application as the installer's source root. Keep the original application and Workspace, and preserve any current native process until its existing writer boundary. The receiving application retains the current route and extension configuration.

## Populate and use the original evidence

Use the actual profile and completed ensemble from the same Workspace. Keep receiving output outside application source.

```sh
"$PYTHON" -B "$JOINED_APP/source_tools/receive_biophysical_evidence.py" \
  --application "$JOINED_APP" --workspace "$WORKSPACE" \
  --profile "$PROFILE_ID" --output "$EVIDENCE_OUTPUT"
```

If an actual cited CSV matches this profile's exact values, units, and load types, add `--evidence-csv "$MATCHING_CSV"`. The first invocation uses a fresh output directory; an interrupted identical operation uses its existing `--resume` course. Supplied-table provenance remains distinct from externally cited coefficient support and from calibrated uncertainty. Retain unknown support and absent uncertainty wherever the original evidence does not establish them.

From the joined application directory, inspect the saved evidence options:

```sh
"$PYTHON" -m model.ensemble_consumers_cli --workspace "$WORKSPACE" \
  coefficient-evidence --ensemble-id "$ENSEMBLE_ID"
```

Write a selection containing the actual returned saved IDs, for example `{"evidence_ids":["ACTUAL_SAVED_ID"],"range_ids":[]}`, then publish the existing ensemble Study source:

```sh
"$PYTHON" -m model.ensemble_consumers_cli --workspace "$WORKSPACE" \
  study-source --ensemble-id "$ENSEMBLE_ID" \
  --coefficient-evidence "$SELECTION_JSON"
```

Calibration reports use the same explicit selection with `scientific-source --consumer-id`. The original report selection retains its source order; append this new source through the existing selection action. Reuse completed native results. The report contains the complete cell evidence CSV, actual citations, raw retained sources, original source identities, and matching saved profile lineage. See `model/ENSEMBLE_COEFFICIENT_EVIDENCE.md` for the complete UI, CLI, source selection, and Study receiving course.

## Complete the saved report and editable receiving course

The complete family includes `source_tools/receive_ensemble_coefficient_report.py`. It uses the existing completed native runs, original coefficient table, source producer, registered scientific report edition, Study export and portable receiver. Run it at the current writer's packaging boundary:

```sh
"$PYTHON" -B "$JOINED_APP/source_tools/receive_ensemble_coefficient_report.py" \
  --application "$JOINED_APP" --workspace "$WORKSPACE" \
  --profile "$PROFILE_ID" --ensemble "$ENSEMBLE_ID" \
  --output "$REPORT_RECEIVING_OUTPUT"
```

Use a fresh output directory outside the application and Workspace; continue the same saved selection with `--resume`. Supply `--evidence-id` for an existing explicitly chosen record, repeated `--range-id` for actual saved ranges, and `--base-report-edition` to keep the order of an existing report's other sources, including separate scenario-contrast sections and older physical report editions. Without an evidence ID, the existing population function records the supplied native table. It does not infer external citations or uncertainty ranges.

The course produces the registered report's HTML/PDF and complete export, the editable `scientific-study.zip`, its received application/Workspace and cold-reopened original evidence/profile/report identities. Original completed run and profile/table records remain bound throughout. It resumes retained report and archive operations; the source producer reads saved results and prepares their figures. Open the actual outputs and operate the received application's affected controls as described below.

## Operate the outgoing product

The actual producing worker opens/runs/renders the exact populated outgoing version, looks at its screens and screenshots, and operates relevant desktop and narrow-screen controls, loaded/empty/loading/error states, export and cold reopen. Inspect every relevant PDF page, map, CSV, project/archive, and any audio/video attachment; use natural generative speech where speech is part of the product. Source checks, tests, or captured screenshots without looking do not replace this pass. Repair obvious mistakes in the outgoing version.

Carry the complete current `CURRENT_OWNER_DIRECTION.md` version `2026-10-13.4`. The renewed owner instruction supersedes the earlier 14:00 UTC cutoff. Continue the existing unfinished product work, preserving completed native runs and current implementation owners. Retain the original source-bound baseline/riparian/matched-control native NDR/SDR study, distinct upstream model domain and South Carolina reporting mask, four utility anchors, and correct annual N/P and sediment units. Export the existing Study, receive it into a fresh owned destination, and reopen the actual saved evidence/report selections.

Record the actual installation result, saved evidence ID, report/Study identities, native process result, and completed visual inspection in the original receiving thread.
