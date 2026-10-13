# Original Bloomington native map setup

This command prepares the original QGIS workspace consumed by the parcel-evidence receiving course. It opens the actual retained parcel and flood geometries, creates a normal verified native vector export, imports that export through the existing analyst journal, saves a styled QGIS project, reads its actual native feature IDs, and renders a parcel-centred map. It then writes the complete evidence-course input with those original request IDs.

The command does not acquire another public dataset, start an HTTP listener or browser, issue a provider request, send a message, or claim that the example is ready for delivery. A named equipped worker owns the entire setup → evidence course → application/browser → handover sequence.

## Original source custody

The source page is https://app.notion.com/p/3f8dd7723100811cb67cfd0485b1ad9e. Use its actual retained file attachments. The example JSON beside this guide records the exact attachment references and complete publisher query URLs. Replace only local file paths, actual reviewer, selected installed runtime paths and the owner-chosen workspace path before the first invocation.

| Input | Original identity and meaning |
| --- | --- |
| parcel | 2,489 bytes; SHA-256 3c7b30af07053862a87ea4b1a1639364e8f983576b02a2febe7339b2b94adcbf. One returned IGIO parcel, state_parcel_id 530533210083000005, EPSG:4326. exceededTransferLimit=true stays explicit. |
| metadata | 16,132 bytes; SHA-256 c1cdce8b8834fbb83041553f6f7c67dcd0d5620a3f73141cf5384f3a91fbdf07. Complete retained original layer metadata. |
| floodContract | Current corrected 117,356-byte source-owner contract; SHA-256 555730fb7285ec5740d88b674583ff3be4dbbdc8c1b57f8b7964e44b3204d6f2. All six publisher response strings are unchanged. integrityCorrection records the original packaging digest error. |
| floodContractSuperseded | Original 116,698-byte contract; actual SHA-256 309262f21b9920285301137c883388c8148f45301ebd8bab24648fe10435b867. Kept separately, unchanged, including its earlier declared digests. |
| dnrGeometry | Actual 4,400,973-byte returnGeometry=true response acquired for the exact original parcel polygon. The accepting worker measures its complete SHA-256 before native use. Expected selected fld_ar_id is 01216S3_4501; the actual response must report EPSG:26916. |
| femaGeometry | Actual 2,840,253-byte returnGeometry=true response for the same original parcel polygon. The accepting worker measures its complete SHA-256 before native use. Expected selected FLD_AR_ID is 18105C_607; the actual response must report EPSG:4269. |

The two geometry requests differ from the earlier attributes-only requests only in returnGeometry. They remain separate complete captures. Source object IDs, business identifiers, response flags, nulls, sentinel values, source citations and full polygons are not merged or replaced. The corrected contract comes from the current receiving packet in F0C8VEAHBDF; the old contract remains its own source member. No accepted old operation is retargeted to the corrected contract.

Each source is read from an ordinary local file with bounded length and inode/size/time checks before and after reading. Known identities are checked. A supplied geometry SHA is also checked; if it has not yet been measured, omit it and let the actual worker record the first measured value. The original input is parsed from its one captured byte sequence, so a concurrent edit cannot change the source selection after freezing. The frozen bootstrap-input.json, measured-originals.json and immutable original file copies then bind continuation.

## Installed source and runtime

Use the complete composed QGIS application containing the reviewed evidence modules, original analyst worker and evidence-native-receiving.py. The producer is the existing adjacent stac/vector implementation, not a new export format. The bootstrap resolves application/vector first, then application.parent/vector, requiring this complete Python closure:

- __init__.py
- common.py
- capture.py
- driver.py
- materialize.py
- comparison.py
- archive.py
- engine.py

The original repository tree at Capture merge 338a40976c9f6a9588a1d4055849677c45dc1a96 contains these sources under stac/vector. Source inventory records actual installed bytes and hashes before operating. Normal project export includes these current original files through the maintained analyst source inventory; do not paste an independently maintained copy into the bootstrap.

The selected native runtime JSON is the existing analyst runtime contract:

~~~json
{
  "native_command": ["/absolute/installed-qgis-python"],
  "prefix_path": "/absolute/qgis-prefix"
}
~~~

native_command may include the existing launcher's documented arguments. prefix_path and qfieldsync_path are optional and retain their original meaning. The native interpreter must expose QGIS 3.40 or later and GDAL's osgeo ESRIJSON driver. The vectorPython input is the actual installed Python executable with Fiona/GDAL and the GPKG writer. It may be the same interpreter when that complete environment is installed. A shell launcher is not a replacement for this explicit Python executable.

No runtime installation, package download or new compute allocation is performed by this command. Use the existing admission and job ownership controls of the accepting worker. Keep temporary state, logs and active SQLite state in that worker's private capacity, not a shared full temporary mount.

## First invocation

Create the editable inputs from EVIDENCE_BOOTSTRAP_INPUTS.example.json. The placeholders are intentionally not executable source paths or reviewer identities.

~~~sh
python3 -B /complete/stac/qgis/evidence-native-bootstrap.py \
  --application-root /complete/stac/qgis \
  --directory /private/original-landsage-bootstrap \
  --inputs /private/landsage-bootstrap-inputs.json \
  --operation-timeout 1200
~~~

The orchestrator can use the existing standard Python. It launches native derivation and native styling through the supplied original QGIS runtime and the maintained vector producer through vectorPython. The original analyst worker handles every workspace operation serially. Its own flock, input SHA and request journal remain authoritative. Bootstrap owns only its own foreground children and closes those children on interruption.

Use a new owner-chosen workspace for the example. Before creating its first database, workspace-creation-intent.json freezes the exact input/source hashes, original operation and selected path. If interrupted after database creation but before its binding is saved, the same invocation can receive only that initial empty workspace: revision zero, the original title, no sources/layers/projects/reviews, and only the three original tables, with one initial workspace row and empty event/request tables. It preserves the UUID already created. Any unrelated existing workspace requires existingWorkspaceId on the first join. A missing previously bound workspace is never replaced. The saved workspace-binding.json then fixes the actual UUID and directory. Existing layer definitions are retained in the complete layers.save payload. Its original revision is saved before native style work, so a concurrent edit causes a real CAS conflict rather than silently replacing someone else's layer changes.

## What the native derivation does

The vector producer accepts its documented GeoJSON, GPKG and other supported formats; an Esri FeatureSet is not mislabeled as GeoJSON. The bootstrap therefore performs an explicit native format derivation before the maintained producer:

1. GDAL opens the actual original response with the ESRIJSON driver.
2. Its row count, declared CRS and the original row's business identifier must agree with the retained FeatureSet.
3. OGR supplies the original polygon/multipolygon and interior-ring topology.
4. Each native coordinate is matched to the exact original numeric value. Every original closed ring must remain present exactly once, allowing only native ring orientation/start-point changes.
5. The derived GeoJSON keeps the complete original attributes, nulls and exact numeric values, including publisher IDs and sentinel values. It declares the actual original CRS. There is no coordinate transform, simplification, clipping, union, buffer or invented geometry in this step.
6. derivation-provenance.json retains the whole response metadata, original descriptors, exact row/feature hashes, actual native-read FIDs, GDAL version/CRS and complete derived-file identity.

The ring comparison uses a linear-time cyclic normalization; it does not reorder polygon vertices or infer topology from a sorted point set. An original number that cannot round-trip through native double coordinates stops with an explicit error. Unsupported curves or additional dimensions similarly stop for source review. The raw publisher file remains in the complete source closure even when a derived representation cannot be created.

The source selection uses the actual business identifier and preserves repeated occurrences through the original vector producer. Each raw source is retained once in the complete export. portableOriginalMembers records its exact final source/sources/... location. Source capture, source feature ledger, field mappings, native row bindings, native GeoPackage and actual full readback are produced and verified by the maintained vector code. No verification flag or native ID is authored by this bootstrap.

## Native map and evidence bindings

Normal source.inspect and source.import receive the exact vector-export manifest hash. VectorReceivingSource supplies each actual output layer definition. layers.save retains all pre-existing selected layers and the three native example layers. The styles use dark parcel outlines and separate restrained gray flood-source fills/outlines; both flood sources remain separately labeled and selectable.

The map project uses EPSG:26916. The view extent is calculated from the actual parcel layer, transformed by QGIS into that project CRS, and padded on each side by twice the largest of its width, height and 20 metres. This is a documented display extent only. It does not alter the polygons, measure regulatory distance or limit the later spatial operation. The full FEMA and DNR polygons can be very large; a union-of-layer-bounds view would make this small parcel unreadable.

A normal map.save operation produces the actual QGZ and retained native-input.json. A complete map.features request for each selected native layer returns its fields and feature IDs. The bootstrap selects the one native row matching the original business value, requires non-empty geometry and complete bounded-layer readback, and saves its exact original request ID. map.render saves a 1440×960 native PNG with the explicit parcel-centred extent. All measured journal inputSha256 values come from the original AnalystJournal.

The output evidence-inputs.json contains:

- The actual workspace path and workspace UUID.
- Exact current parcel, metadata and corrected contract descriptors.
- The original retained runtime JSON path.
- Subject mapObservation bindings to completed map.features request IDs, actual feature IDs and original business fields.
- Two explicit parcel-to-source spatial observations, using the complete native geometries and EPSG:26916.
- The completed map.render request ID used by the frozen evidence report.

No geometry-based or regulatory finding is asserted here. Native intersection predicates and intersection area/length are observations of these selected publisher geometries. The source business IDs are not owner names, jurisdiction determinations, permanent service object IDs or professional certifications.

## Continue the same evidence course

After NATIVE_SETUP_COMPLETE, the named original receiving owner runs the already-reviewed course with this exact generated input:

~~~sh
python3 -B /complete/stac/qgis/evidence-native-receiving.py \
  --application-root /complete/stac/qgis \
  --directory /private/original-landsage-evidence-course \
  --inputs /private/original-landsage-bootstrap/evidence-inputs.json \
  --operation-timeout 1200
~~~

Do not create another workspace or regenerate feature bindings between these steps. The original course receives and reviews source editions, case/subjects/findings, source succession, full native spatial observations, frozen report and complete project export/cold receiving. Its browser controller consumes the same original request/result identities and same workspace through the maintained local listener.

The first complete receiving run uses the corrected source-owner contract before accepting its frozen course inputs. Both contract editions are already retained in the native source package. If an older course had already accepted the old contract, that original course must continue its own frozen inputs; do not substitute the new one under its request identity.

## Interrupted invocation and retained results

Continue by repeating the exact original bootstrap command with the same source files, input bytes, directory and installed source generation. A bootstrap lock prevents simultaneous invocations. Original native derivation/style directories publish only after complete result/files are written. Their saved requests and every file hash are rechecked before reuse.

Every workspace step saves its complete normalized payload, original revision, reviewer and native runtime before journal creation. Completion reads the original journal and verifies its returned files. A later run reuses the exact original request and first complete result; it does not choose a new UUID or silently adopt a new revision. A completed vector export is reopened by the original producer; replay-only metadata does not replace its retained first response.

An explicit source, CRS, revision or request conflict is not a transient retry signal. Inspect the retained original and the current state, then resolve it with the owning operator. Do not delete requests, reset the journal, fabricate a successful return or start a second native course. Logs retain the original errors. The script starts no browser and leaves rendered inspection pending.

## Complete outgoing artifact use

The final receiving owner must account for and actually open/use every outgoing attachment. Open the populated Evidence interface, actual native PNG, QGZ/project layers, frozen HTML report, any included PDF, each downloadable archive and its extracted project, every complete handover/readme, and the cold-received application. Operate relevant controls and links, download the actual complete files, reopen them, and inspect desktop and 390-pixel layouts where relevant. View the captured screenshots themselves. A screenshot capture, HTTP success, DOM count, source review or another worker's acknowledgment is not actual rendered acceptance.

An included ordinance PDF must be opened at its real PDF/printed-page coordinates. Do not call its chapter excerpt a complete current ordinance. Source JSON, manifests, reports and numerical tables must be read in their actual delivered form; source and native geometry must be used through the real GIS/operator. The final archive must be extracted and its actual project reopened, not just listed.

bootstrap-result.json deliberately reports renderedInspection:PENDING. Replace no historical result to claim this work happened. Retain the actual later browser/native inspection receipts and any repaired successor edition beside the original outputs. Only the named operator who has used the exact outgoing edition may record its actual completion.

## Owner instruction consumed by this receiving guide

The following current application instruction remains in force for this bootstrap and every delegated equipped-worker continuation:

# Owner-directed rendered-product inspection

Source: direct owner instruction of October 13, 2026. Repository copy version: `2026-10-13.1`.
Scope: owner-controlled work across providers, local and cloud runtimes, and current and future workers. Existing owner controls remain in force.

Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing worker must open/run/render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Code review, DOM counts, HTTP200, unit checks or another worker's approval do not replace seeing the actual product.

The Ecosystem product requires plain industrial design: readable tables, clear hierarchy, consistent typography/spacing, restrained controls, useful labels and responsive layouts. Keep the real workflows/data/computation. Reviews must lead directly to repairs and must not replace implementation/integration or become endless rechecking. The existing focused-validation policy remains; do not run broad suites or build a verification product.

Persist this instruction in the active owner-controlled instruction surfaces actually read by the relevant workers: global/project AGENTS/CLAUDE/GEMINI/rules, provider-specific boot instructions, source mirrors, cloud repository copies and current build/receiving guides. Include this instruction in every delegated child assignment, including assignments to another provider or runtime. Maintainers update their own consumed files and return exact paths, source/version and readback. A coordination acknowledgment alone is not propagation. Do not alter historical evidence or third-party/vendor policies. No forced restarts, new watchers or revival of owner-stopped work.

Inspect the actual completed scientific screens, reports, source pages and downloadable HTML in the real operator. Prior empty-Workspace screenshots are not completed-workspace acceptance. Preserve current engineering owners; other coordinators receive propagation rather than duplicate implementation. Continue native source/runtime/archive joins rather than diverting everyone to cosmetic review. This instruction does not extend or restart the Ecosystem sprint: the existing cutoff is October 13, 2026 at 10:00 a.m. America/Kentucky/Louisville, 14:00 UTC.

Source assembly and standalone application handoffs retain the application-level instruction copies with their current guides. This file records an owner-requested product delivery requirement; it does not change provider safeguards, repository access controls, or existing authorization boundaries.

## Parcel evidence operator and receiving

Use the existing QgisWorkspace, its analyst request journal, source-native QGIS engine, complete project export and cold receiving. Preserve source editions, exact publisher IDs, coverage and page scope, analyst request identities and current concurrent parcel/capture writers. All case, finding and source adoption changes retain their original revision/head basis; recover an uncertain operation with the same full request before proposing another. Render and operate the exact populated Evidence pane, report, downloaded and reopened application at desktop and 390-pixel widths before a client-facing delivery. The current operating and receiving course is PARCEL_EVIDENCE.md and evidence-native-receiving.py.
