# Parcel evidence review and complete receiving

The Evidence workspace turns retained parcel, flood-map, ordinance and site material into a named research case, reviewed findings, explicit source-edition decisions and an editable handover. It is part of the existing QGIS analyst application. The same QgisWorkspace SQLite database, analyst request journal, native QGIS worker and complete project package own the work.

## Operate the complete native receiving course

[EVIDENCE_FOREGROUND.md](EVIDENCE_FOREGROUND.md) runs the original native bootstrap, full evidence workflow, existing analyst, desktop and phone browser controls, report downloads and independent editable-project receiving in one foreground operation. It retains the complete application, PostGIS adapter and vector producer under their original source identities in the private receiving directory. [EVIDENCE_BOOTSTRAP.md](EVIDENCE_BOOTSTRAP.md) explains the actual original geometry inputs, installed runtime selection and interrupted-workspace recovery; [EVIDENCE_BOOTSTRAP_INPUTS.example.json](EVIDENCE_BOOTSTRAP_INPUTS.example.json) gives the complete input shape.

Continue the same directory and original requests after an interruption. The accepting operator must open and inspect the populated app, downloaded report, every PDF page, native map and reopened editable project. The receiving course retains these actual outputs for inspection.

## Review original address cohorts

Open **Evidence → Address QA** to analyze retained GeoJSON or Esri FeatureSet address sources in this same workspace. [ADDRESS_REVIEW.md](ADDRESS_REVIEW.md) covers the complete source selection, field mapping, explicit screening policy, original count/ID reconciliation, candidate-member inspection, named findings and editable handover.

Address signatures include original building and unit fields. Exact-point comparisons preserve each source's declared CRS; municipality and postal city remain separate fields. Every analysis retains all selected rows, complete candidate membership, original file identities and full JSON/CSV outputs. Candidate interpretations use the existing Findings editor and source-edition history.

The supplied `address-review-receiving.py` accepts the operator's complete original cohort manifest and source files. Continue its retained operation and workspace for original-request replay, frozen report, later-case review and complete project export/reopening. Customer-specific cohorts and terms stay with the original customer case. The maintained project archive includes the generic application module, guide and source course.

## Run the maintained application

Use the existing Python and QGIS environment selected for this application. Start the complete maintained source with:

```bash
node analyst.mjs --workspace /absolute/case/workspace --python /absolute/existing/python --native-runtime-file /absolute/private/native-runtime.json
```

Open the original private connection URL printed by that listener. Keep its connection file private. The existing Applications workspace also exposes this application's Review, Save, Start, Open and Stop controls. The Evidence tab uses the same authenticated local listener as Sources, Parcels, Maps and Field. It does not create another service or database.

A native runtime file has the existing form:

```json
{"native_command":["/absolute/existing/qgis-python"],"prefix_path":"/existing/qgis/prefix"}
```

Include prefix_path or qfieldsync_path only when required by the selected installed runtime. Source inspection, evidence editing and report generation use ordinary Python. Native map inspection, feature reading, rendering and geometric observations use the selected actual QGIS runtime. The original worker keeps the selected native profile, authority database and service environment.

To initialize a separate original evidence workspace through the same model:

```bash
python evidence_cli.py --workspace /absolute/case/workspace --create --title "Parcel evidence review"
```

The command returns the catalogue; an existing workspace retains its original identity. Use the same directory to continue interrupted work.

## Retain a source edition

Choose the complete original local file or upload one original file. An evidence upload supports one nonempty file up to128MiB, using the original chunked upload identity, offsets and SHA-256 checks. A PDF, source response, ordinance extract, survey or supplied proposed-improvement file is retained byte for byte. The completed upload returns its directory, exact file descriptors and absolute file path. It does not itself create a source edition.

Inspect the file, then save its complete definition. Record the original publisher, source URL, source class, jurisdiction, source series, edition, retrieval timestamp, publication/effective dates and coordinate reference when available. Use documentScope for the actual chapter/page coverage, coverageNotes for query limitations, publisherUpdatedAt for the publisher's own update statement and queryDescription for the exact selection. These are separate facts. An absent effective date remains absent; a service edit date does not silently become a feature effective date.

The supported source roles are parcel, effective FEMA, preliminary FEMA, LOMC, DNR best available, local ordinance, structure, proposed improvement, survey and other. Keep these roles separate even when two sources return the same classification. A successor source names its original previousId and retains the original issuer, series and role. Saving it preserves the earlier edition.

Original source data remains in its publisher format. GeoJSON and ArcGIS Esri FeatureSet rows can be inspected and attached to subjects. The Esri response retains attributes, geometry rings, spatialReference, geometryType, original response metadata and exceededTransferLimit. A locally completed page means that the saved file has been read to its end; it does not establish a complete county or publisher dataset. Attribute names and string identifiers retain their original spelling, punctuation and leading zeros.

## Create the decision case

Name the decision being supported, proposed use or improvement, research date, jurisdiction, scope and assumptions. Record unresolved jurisdiction or proposed-use information in the case itself.

Add distinct subjects for parcels, structures, proposed improvements or mapped areas. A subject has its own stable ID, label, original business identity and original source references. Selecting a source feature freezes its original file SHA, feature position, feature hash, properties, geometry and coverage. Select the actual business identifier field; matching or normalizing an unrelated county's parcel key is not part of this operation.

Each source reference records a source ID and exact locator. For a PDF, record sourcePageIndex0 (the actual zero-based file page), printedPage (the publisher's label) and section independently. The interface can show a human PDF page number while preserving the underlying index. A 125-page excerpt whose printed pages run110–234 begins at file page index0; it does not begin at file page index110.

Attach the actual original map.features request when a native map feature has been observed. The subject selects its completed request ID, feature ID and business field. The application verifies the completed original journal, source-bound saved QGZ, native layer ID, stable application layer ID, original fields and values. If both a source feature and native feature are attached, their original business identities must agree.

Case edits retain the original caseId and previous case-version ID. A stale editor cannot silently replace a newer case. Review the current edition and explicitly adopt that basis before saving an intended correction. A changed case edition makes affected older findings visibly require review.

## Record findings and questions

Choose the appropriate classification:

| Classification | Intended record |
| --- | --- |
| Source fact | A statement directly observed in an original source, with its exact locator |
| Reviewed interpretation | A named analyst interpretation with applicability and assumptions |
| Agency question | A specific unresolved question for the relevant agency |
| Professional question | A specific question requiring the identified professional role |

Every finding names its subjects, original sources, reviewer, review time, applicability, next action and responsible role. Record a due date when there is an actual one. OPEN, REVIEWED, ANSWERED and WITHDRAWN describe the finding's own recorded status. The separate source-review state shows whether the case or cited editions have changed.

An answered agency or professional question retains its original answer text and answer-source references. Correcting a finding creates a successor finding under the same logical findingId and original previousId; it retains the earlier version, named reviewer and correction reason. It does not rewrite a previously exported report.

## Review a later source edition

Compare two distinct editions of the same declared issuer, role and series. The comparison retains exact byte equality, changed source metadata, affected subjects and every affected current finding. Source equality alone does not imply semantic applicability.

Choose one explicit treatment for every affected finding:

| Decision | Result |
| --- | --- |
| Keep earlier | Retain the earlier evidence with a named reason |
| Review required | Keep the open review visible |
| Adopt later | Save the complete replacement finding against the later source |
| Withdraw | Save the complete reasoned withdrawn successor |

The submitted comparison SHA binds these decisions to the actual displayed case, source editions and current finding heads. A concurrent edit requires a fresh comparison and review. A partial decision list is rejected. Later editions do not erase original findings, answers or earlier source decisions.

## Observe the actual native geometry

Select two saved subjects with original native map-feature bindings. Declare a projected measurement CRS and the observation's purpose. Use a CRS appropriate to the actual location and intended planar measurement; document that choice in the case and result.

The original QGIS worker reopens each saved project, verifies the original layer and fields, reads the actual retained feature, and checks the original geometry. It transforms copies through the project's actual transformation context into the declared projected CRS and performs the native GEOS predicates and intersection. It records intersection, containment and touching, the exact projected intersection geometry, original/transformed geometry hashes, native units, actual QGIS version and the source-bound inputs.

Area and length are projected planar measurements in the declared CRS units. The operation performs no geometry repair. An invalid source or failed transformation requires an explicit source correction before a new observation. A filter extent, a source feature's whole area and a parcel intersection are separate quantities. Attribute values such as -9999, null and NP retain their original values and must not be displayed as measured elevations. A horizontal CRS transformation does not establish a vertical datum conversion.

Use the existing Map controls to save and render the complete original project. When freezing a report, select the exact completed map.render request IDs to include. The report accepts only maps from projects bound to its subjects. It carries the original input, result, layer order, CRS, visible/requested extent and image SHA. Selection copies the original native image; it starts no new rendering.

## Produce the findings report and editable handover

A report freezes the selected case edition, current findings, source-review states, full earlier case/finding/source-decision history, native observations, cited original source lineage, interpretation and selected native maps.

The complete report ZIP contains:

- OPEN.html: responsive industrial report with findings, named review, applicability, sources, questions and selected native map images. Images are embedded in this HTML and also retained as original PNG members.
- case.json and report.json: the complete frozen case and the report interpretation.
- findings.csv and actions.csv: usable matrices with source locators and review states.
- observations.json and map-views.json: original native measurement and rendered-view records.
- sources/: the complete original bytes of every cited source edition and required predecessor.
- maps/: selected original native PNGs.
- manifest.json: complete member names, sizes and SHA-256 values.

Open OPEN.html from the complete extracted ZIP to use its linked originals and JSON/CSV downloads. The individual HTML download retains embedded map images; its sibling source links become available when the full report ZIP is extracted. Use the browser's actual print/PDF rendering when a PDF is needed and inspect the result. Exporting the report preserves a frozen research result. Continue editing in the full project workspace.

Use the existing whole-project Export control to create the editable handover outside the active workspace. It includes the original state, events, requests, analyst requests, original sources, maps, native styles and dependencies, reports, software and guides. Export validates source feature bindings against the actual retained file, native observations against the original completed request/QGZ and every report member against its frozen snapshot.

On another host, receive the complete archive into a new separate directory using the existing project receiving flow. The receiver verifies the original archive, source and request closure before publishing its SQLite database. Open that received workspace with the maintained application. Original completed requests remain replayable. Unfinished requests keep their original host and input identity; inspect their retained input and original operation status before authoring a deliberate current-host invocation.

## Browser recovery and concurrency

The Evidence pane retains its form drafts and exact original operation bodies before submitting a mutation. A pending request keeps its original actor, action, payload, workspace and revision. After a lost response, reopen that exact request from the original journal. If the listener has no such request, resubmit its original saved body. Do not silently assign another UUID or update its revision.

Drafts retain the case/finding heads on which they were started. Refreshing server state must not relabel old form text as an edit of a newer head. Use the explicit current-edition adoption/rebase action after reviewing the change. Other tabs share pending-operation ownership; a completed request can clear only its own retained pending body. Export a recovery copy before clearing intentionally abandoned local drafts.

Upload recovery uses the original upload ID and measured byte offset. Original file re-selection must match its saved identity. Complete uploads expose the exact hash used by source inspection and saving.

## Original operator API and CLI

The original POST /api/operations endpoint accepts the complete request body:

```json
{
  "requestId":"landsage-source-001",
  "action":"evidence.command",
  "payload":{"action":"source.inspect","payload":{"file":"/absolute/original.json"}},
  "revision":0,
  "actor":"Named analyst"
}
```

Use evidence.command with source.inspect, source.save, case.save, finding.save, source.compare, succession.save or report.build. Native geometry uses action evidence.spatial with caseId, caseVersionId, leftSubjectId, rightSubjectId, measurementCrs and purpose. Report build takes caseId, caseVersionId, title, interpretation and optional mapRequestIds.

The catalogue is GET /api/evidence. Source features are paged with sourceId, offset and limit at /api/evidence/features. Complete records use /api/evidence/records/KIND/ID. A case exposes snapshot, findings, successions, reports, observations and history under /api/evidence/cases/CASE_ID/. Snapshot returns the whole selected case; the row routes retain offset/limit paging. Original source downloads and report downloads remain authenticated original analyst routes.

A CLI invocation reads the same complete request from a file:

```bash
python evidence_cli.py --workspace /absolute/case/workspace --request /absolute/case/request.json
python evidence_cli.py --workspace /absolute/case/workspace --request-id landsage-source-001
python evidence_cli.py --workspace /absolute/case/workspace --case-id ORIGINAL_CASE_ID
```

The CLI creates or reopens the same analyst journal record and runs the original worker. It prints the complete retained result or failure. Its native option uses the original selected runtime file. It does not rebuild another evidence state.

## Actual public Bloomington receiving example

The maintained receiving course is evidence-native-receiving.py. Use its --help and supply the retained original files. Its fixed operation continues the same directory and request IDs. It operates the whole original source/case/finding/succession/report/export/independent receiving flow, with actual native map bindings when supplied by the existing QGIS runtime.

The actual initial public sample is IGIO parcel stateID530533210083000005 / parcel53-05-33-210-083.000-005, Monroe County, EPSG4326. Its original2489-byte response SHA is3c7b30af07053862a87ea4b1a1639364e8f983576b02a2febe7339b2b94adcbf. The one-record response has exceededTransferLimit=true. Its metadata is16132 bytes, SHAc1cdce8b8834fbb83041553f6f7c67dcd0d5620a3f73141cf5384f3a91fbdf07.

The original selected-parcel flood responses use the same polygon with explicit input EPSG4326. They retain effective FEMA and Indiana DNR best-available source roles separately. DNR feature/source IDs01216S3_4501/01216S3_FIRM1 differ from FEMA18105C_607/18105C_FIRM1. The returned panel18105C0142D has effective date2010-12-17; its raw PRE_DATE253392451200000 is the9999-09-09 placeholder. Original queries returned attributes with returnGeometry=false; a native intersection requires separately retained geometry responses and actual source-bound native maps.

The available municipality-authored ordinance PDF contains Chapter20.04 only:125 file pages, printed110–234, footer amendedJune11,2026. Its mirror, missing chapters and currentness are explicit source scope. The software example supports operating the research workflow; any property-specific finding must cite the actual original material and named review.

## Required actual rendered-product inspection

Bryce's owner instruction applies across providers, local and cloud runtimes and future workers. Before presenting this app, report or export as ready, open/run/render the exact outgoing version, LOOK at the actual screen or its real screenshots, and operate the important controls. Check populated, empty, loading and error states at the intended desktop/screenshare width and390-pixel width, plus downloads, report printing, reopening and meaningful recovery. Capturing a screenshot without viewing it does not complete inspection. Fix unreadable, clipped, overflowing, cramped or broken output within the same authorized work.

Keep plain industrial design: readable tables, restrained controls, clear hierarchy, consistent spacing and neutral colors. Real source, geometry, review and receiving workflows remain the product. Code parsing, DOM counts, HTTP200 and peer approval do not replace seeing and using the rendered product. Use focused validation to resolve concrete defects; retain actual screenshots and native outcomes with their original version. The component AGENTS.md carries this instruction for receiving workers.


### All outgoing attachments

ALL ATTACHMENTS count. Literally open, view, play and use the final delivered HTML, PDF, report, slides, spreadsheet, map, image, video, audio, archive and project as its recipient would. For archives, extract and open the actual contained deliverables and working project. Tests, checklists and screenshots merely captured are not substitutes. Use available high-quality generative media models and natural voice generation/TTS for videos; avoid robotic default voices. Watch and listen to the final export for pronunciation, pacing, timing and audio alignment. Keep building and fixing; inspection is not review/test performance theatre.
