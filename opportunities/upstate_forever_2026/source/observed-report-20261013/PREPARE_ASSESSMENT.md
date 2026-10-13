# Original station and assessment receiving

This command completes the preparation arm of the original ECO-GEO-0D0F operation, alongside the existing scientific-report receiver. It uses the maintained station-study, station-geography, assessment-context and saved-context report APIs. Each of the seven GIS cases runs in a separate Python process, releasing native geometry memory between cases.

## Original inputs

Continue the existing Upper Savannah project containing the original 217 model-domain polygons. Supply the complete retained manifests for the original domain, SCDES705 stations, both published assessment inventories as their original normalized JSON sources, WQP8 supplement and additional WQP2 locations. The statewide bank F0C8KECMA4V contains both complete published originals. The legacy combined192-record CSV fallback does not supply the three distinct inventory tables used by this course. Supply the exact original 101-row draft assessment CSV; its SHA256 is `545a4e1413012b8f17c81c8afe815dd1e225ade5f5b9792ca22e83ef8723307f`.

The shared complete sources are the statewide assessment bank `F0C8KECMA4V`, monitoring bank `F0C8KSKT3FX`, draft/WQP8 bank `F0C8J8FE4GK`, the retained original217 domain and the WQP2 sources included in the station family. Use their already materialized local paths. Source import retains the existing collections when their original manifests match.

Run with the application's qualified native Python environment, including PyProj and Shapely. Keep the application, original Workspace, independent receiving Workspace and output directories separate. The original Workspace must already exist; `--create-receiving-workspace` may create the selected independent receiving project.

## Complete operation

From the complete current application:

```bash
"$ECO_PYTHON" "$ECO_APP/source/observed-report-20261013/prepare_assessment.py" \
  --workspace "$ECO_ORIGINAL_WORKSPACE" \
  --receiving-workspace "$ECO_RECEIVING_WORKSPACE" \
  --create-receiving-workspace \
  --manifest "$ECO_DOMAIN_MANIFEST" \
  --manifest "$ECO_STATIONS705_MANIFEST" \
  --manifest "$ECO_PUBLISHED_ASSESSMENTS_MANIFEST" \
  --manifest "$ECO_WQP8_MANIFEST" \
  --manifest "$ECO_WQP2_MANIFEST" \
  --assessment-csv "$ECO_ORIGINAL_DRAFT_CSV" \
  --output "$ECO_ASSESSMENT_OUTPUT"
```

These variables identify the original sources and selected directories already held by the receiving operation. The command binds their exact manifests, draft bytes, project identities and model source in `selection.json`. Repeating the same command resumes the same model outputs and report operations. Each case reopens and verifies its saved immutable results through the maintained APIs; it does not assume completion merely from a previous checkpoint. A different source selection or changed model implementation uses a new output directory, retaining previous editions and their IDs.

The default course performs:

1. Build, export and independently receive all164, published159 and draft87 station studies.
2. Prepare and independently receive four contexts from the original all164 study: all293 records by publisher watershed, all293 by computed membership, five July fully-supported records and101 draft2026 records.
3. Prepare the saved scientific-report sources in both original and independent receiving Workspaces.
4. Invoke the maintained `receive_operator.py --course` for the four original report sources. That receiver owns source import, preview, queued report publication, HTML/PDF/data downloads, report ZIP, complete Workspace receiving and selected scientific-study receiving.

An individual GIS failure is retained in `assessment-preparation.json`. Independent cases continue in the same invocation. The report receiver retains its original course state and handles already prepared independent sources. The command returns nonzero until all requested preparation and receiving operations complete.

## Expected original selections

| Case | Original assessment records | Stations | Selected watersheds | Publisher/computed differences |
| --- | ---: | ---: | ---: | ---: |
| all-published-watersheds | 293 | 164 | 77 | 6 |
| all-computed-memberships | 293 | 164 | 78 | 6 |
| july-fully-supported | 5 | 5 | 5 | 0 |
| draft-2026 | 101 | 87 | 49 | 0 |

The three station studies contain293/192/101 records at164/159/87 stations respectively. These are editions of the original sources, so their records are not summed as separate observations. The assessment selections use the original field defaults returned by `assessment_context.options`; explicitly typed geographic source tables stay outside the assessment inventory.

The `fully_supported` value belongs to the five original July records. Draft2026 uses the exact edition filter `2026`; unreported draft support remains unreported. Stable original assessment row IDs keep records from different editions distinct. Independent receiving compares those IDs and complete original row dictionaries, while the maintained station receiver also compares original source identities, coordinates and polygon memberships.

## Join the existing cumulative report course

For the already accepted ASTRA13 cumulative course, add `--prepare-only` to the complete command. This performs the seven model cases and prepares all four exact original report-source receipts. It writes the ordinary `upstate.scientific-report-receiving-course/v1` manifest to `report-course.json`. Its items use the existing receiver's `source_receipt` and `output_from_receipt` fields.

Each source receipt is `prepared/CASE-report.json`, with the original source under `source`, the report title under `title` and the exact context identity under `context_id`. The same receipts can be joined to the existing ordered course without copying or changing the Workspace, source selections or task identities. The paired received context has a separate `prepared/CASE-received-report.json`.

To continue this generated report course through the existing receiver:

```bash
"$ECO_PYTHON" "$ECO_APP/source/observed-report-20261013/receive_operator.py" \
  --workspace "$ECO_ORIGINAL_WORKSPACE" \
  --course "$ECO_ASSESSMENT_OUTPUT/report-course.json" \
  --output "$ECO_ASSESSMENT_OUTPUT/report-receiving"
```

Add `--resume` once that report-receiving directory exists. Retain each course item's original output path when joining it to the accepted cumulative course. The generated outputs include their original source-operation IDs.

For a specific repaired GIS case, repeat the preparation command with `--case study-all164`, `study-published159`, `study-draft87` or `context-CASE`. Context cases use the original completed `prepared/study-all164.json`; they preserve every previously completed result. A case-only invocation prepares its scientific sources and leaves report generation to the existing report course.

## Delivery files

The source models retain their ordinary immutable editions, original-source archives and editable receiving Workspaces. The preparation directory contains the exact input selection, seven case records, paired original/received report-source receipts and the existing receiver's course. Final report files and portable receiving results are written by the established report receiver under `reports/` and `report-receiving/`.

Prepared/model completion is recorded separately from final report receiving. `assessment-preparation.json` records each native model case; `report-receiving/scientific-report-course.json` records the actual report tasks and final downloads. The terminal result includes both preparation completion and the report receiver's exit code.

TokenJunkieLabs — Ecosystem Sciences original-source engineering.
