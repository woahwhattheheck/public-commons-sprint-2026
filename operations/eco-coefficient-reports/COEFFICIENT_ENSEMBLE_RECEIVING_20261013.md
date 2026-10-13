# Receive the ensemble coefficient source package

This package joins the coefficient evidence feature, native ensemble and calibration report exports, Study receiving, and observed-report source links into the current Eco application. Continue the existing coefficient-family installer and its original scientific Workspace.

## Exact source

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `coefficient-ensemble-report-source-20261013.source.json` | 2633311 | `66b9318dbe89dde7fc7560c2462297f0d2db5c7d7d109442f7e879c6edd3c642` |
| Decoded complete source bank | 7479203 | `77134a501df30d230b82c3fb10fa133865ca9b294c97f37c246032c797c98dd7` |
| gzip payload | 1974629 | `5f29197466a94228fb2342939d6f9ca9dcb963dbf3f3bc78905bd3a59c118993` |

The decoded bank carries 261 complete files, 6,847,028 source bytes, 15 selected changed paths, 246 supporting paths, and 12 SHA-bound patch groups containing 53 literal edits. It retains the original 53 base-dependency declarations. Every file identity and every patch group's reverse/forward transformation has been checked. The complete receiving application supplies the original base; this package is an overlay on that application.

First finish the existing 104-file coefficient-family receiving course using the neighboring `coefficient-report-source-20261013.source.json` and its original composition. That course owns installation of the earlier biophysical feature. This successor adds the ensemble/report changes. Its supporting paths retain any bodies already installed and supply missing bodies, so it must not be used to skip the earlier feature installation. Preserve current component catalogues and peer changes through the existing assembler.

## Materialize and join

Use the materializer from merged PR 4263 or its compatible current successor. Its exact published Git blob is `08470a56c1b49facc086b6b1dc3eb7727d9961bc`. Read the actual operation ID and paths from the existing receiving operation. The variables below represent those existing selections and new owned output directories.

```sh
"$PYTHON" -B "$MATERIALIZER" \
  --bank "$BANK" \
  --bank-bytes 2633311 \
  --bank-sha256 66b9318dbe89dde7fc7560c2462297f0d2db5c7d7d109442f7e879c6edd3c642 \
  --operation "$OPERATION_ID" \
  --output "$STAGE"

"$PYTHON" -B "$STAGE/source/source_tools/application_assembly.py" "$CURRENT_APP" \
  --overlay "$STAGE/banks/77134a501df30d230b82c3fb10fa133865ca9b294c97f37c246032c797c98dd7.json" \
  --declared-overlay 1 \
  --expect 1:77134a501df30d230b82c3fb10fa133865ca9b294c97f37c246032c797c98dd7 \
  --edition eco-coefficient-ensemble-20261013 \
  --operation-id "$OPERATION_ID" \
  --output "$JOINED_APP"

"$PYTHON" -B "$JOINED_APP/install_profile_workbench.py" \
  --application "$JOINED_APP" --source-root "$JOINED_APP"
```

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

## Operate the outgoing product

The actual producing worker opens/runs/renders the exact populated outgoing version, looks at its screens and screenshots, and operates relevant desktop and narrow-screen controls, loaded/empty/loading/error states, export and cold reopen. Inspect every relevant PDF page, map, CSV, project/archive, and any audio/video attachment; use natural generative speech where speech is part of the product. Source checks, tests, or captured screenshots without looking do not replace this pass. Repair obvious mistakes in the outgoing version.

Preserve the full `CURRENT_OWNER_DIRECTION.md` version 2026-10-13.3, the original source-bound baseline/riparian/matched-control native NDR/SDR study, distinct upstream model domain and South Carolina reporting mask, four utility anchors, correct annual N/P and sediment units, and the original 14:00 UTC delivery boundary. Export the existing Study, receive it into a fresh owned destination, and reopen the actual saved evidence/report selections.

Record the actual installation result, saved evidence ID, report/Study identities, native process result, and completed visual inspection in the original receiving thread.
