# Original station and assessment receiving

This command completes the preparation arm of the original ECO-GEO-0D0F operation, alongside the existing scientific-report receiver. It uses the maintained station-study, station-geography, assessment-context and saved-context report APIs. Each of the seven GIS cases runs in a separate Python process, releasing native geometry memory between cases.

## Original inputs

Continue the existing Upper Savannah project containing the original 217 model-domain polygons. The maintained station-study resolver reuses that domain directly from the Workspace's retained source collections and verifies its original decoded SHA256, `2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af`. An already imported domain needs no external manifest path, new download or source reconstruction. If the selected Workspace does not yet contain that original source, add its already-retained original domain manifest with another `--manifest` argument.

The other complete original inputs are maintained inside the current application:

| Input | Application-relative path |
| --- | --- |
| Original SCDES705 monitoring stations | `source_data/scdes_savannah705_20261013/sources.json` |
| Both original normalized published assessment inventories and publisher-text companion | `source/water-quality-assessments/20261013/sources.json` |
| Original WQP8 station supplement | `source_data/wqp_eight_20261013/sources.json` |
| Original additional WQP2 locations | `source_data/wqp_assessment159_additional_two_20261013/sources.json` |
| Original 101-row draft assessment CSV | `source_data/wqp_eight_20261013/assessment_listed_causes_2026_draft_original.csv` |

Use both complete normalized published JSON inventories. The legacy combined192-record CSV fallback does not supply the three distinct inventory tables used by this course. The exact draft CSV SHA256 is `545a4e1413012b8f17c81c8afe815dd1e225ade5f5b9792ca22e83ef8723307f`.

Earlier shared original carriers remain the statewide assessment bank `F0C8KECMA4V`, monitoring bank `F0C8KSKT3FX`, draft/WQP8 bank `F0C8J8FE4GK` and WQP2 sources in the station family. The application-relative files above supply the same retained originals. Source import reuses existing collections when their original manifests match.

Run with the application's qualified native Python environment, including PyProj, Shapely and ReportLab. Keep the application, original Workspace, independent receiving Workspace and output directories separate. The original Workspace must already exist; `--create-receiving-workspace` may create the selected independent receiving project.

## Complete operation

From the complete current application:

```bash
"$ECO_PYTHON" "$ECO_APP/source/observed-report-20261013/prepare_assessment.py" \
  --workspace "$ECO_ORIGINAL_WORKSPACE" \
  --receiving-workspace "$ECO_RECEIVING_WORKSPACE" \
  --create-receiving-workspace \
  --manifest "$ECO_APP/source_data/scdes_savannah705_20261013/sources.json" \
  --manifest "$ECO_APP/source/water-quality-assessments/20261013/sources.json" \
  --manifest "$ECO_APP/source_data/wqp_eight_20261013/sources.json" \
  --manifest "$ECO_APP/source_data/wqp_assessment159_additional_two_20261013/sources.json" \
  --assessment-csv "$ECO_APP/source_data/wqp_eight_20261013/assessment_listed_causes_2026_draft_original.csv" \
  --output "$ECO_ASSESSMENT_OUTPUT"
```

Set these five environment variables to the receiver's actual Python, complete application, original Workspace, independent receiving Workspace and output paths. The command binds the supplied manifests, draft bytes, project identities and model source in `selection.json`; each saved station selection also retains the exact already-imported domain collection, source ID and original source hash. Repeating the same command resumes the same model outputs and report operations. Each case reopens and verifies its saved immutable results through the maintained APIs; it does not assume completion merely from a previous checkpoint. A different source selection or changed model implementation uses a new output directory, retaining previous editions and their IDs.

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

## Source-native map preparation

The current report source prepares the original watershed overview and paged
publisher-versus-station-membership maps using the existing scientific vector
renderer. Its raw native watershed body, full geometry specification, original
feature identities, every differing assessment record and complete SVGs travel
with the source. The original217 source is drawn in retained EPSG:3857; the
renderer uses native projected grid metres and grid north. It does not recompute
memberships, simplify polygons or turn assessment records into a concentration
surface.

This course and its browser chapter bind
`model/assessment_map_context.py`, `model/scientific_figures.py` and
`model/scientific_map_figures.py` beside the existing source hashes. Keep all
three files from the complete current application. A changed implementation uses
a fresh output directory, preserving the prior seven native editions and their
report-source history. Report source1.2 creates the current map-bearing source
for each original and received context through the existing prepared-report API.

The all293 publisher and computed reports retain their original77/78 polygon
selections and six differing record relationships. The five fully-supported and
101draft contexts retain their original selections. Original native source IDs,
source-body hashes, polygon indices and all original record dictionaries remain
attached. Geographic/foot-based custom sources receive an explicit native-map
availability explanation and retain the original report and complete inputs.

Continue the same report receiver and browser chapter. Open and view the actual
scientific PDF/HTML, native map SVGs and complete exported project; inspect
readable grayscale roles, six-item comparison legends, holes and multipart
boundaries, source-CRS/grid labels and original row links. The complete operator
guide documents the interpretation and source paths. This adds presentation
files to the existing source operation, not a separate GIS/model run.

## Operate the outgoing product

Continue the same receiver's [assessment browser chapter](ASSESSMENT_BROWSER.md) after native preparation. Open and view the exact outgoing populated station/context maps, report HTML/PDF and actual screenshots; operate the study and source selections, prepared report handoff, downloads and independent reopening at desktop and narrow widths. Inspect the actual exported attachments and the project restored from its archive. Repair visible or functional defects in that existing operation before presenting its delivered product. The current application `AGENTS.md` travels with the complete family and preserves the owner's full operating instruction.

TokenJunkieLabs — Ecosystem Sciences original-source engineering.

<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->
