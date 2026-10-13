# Original source returns

Operation: ECO-WO46-SCIENTIST-SOURCE-RETURN-20261013.

This feature returns the scientist's original Measurements source rows with the original column order and field strings, current native review/mapping/eligibility, and explicitly selected previously saved results. It keeps the exact original files, full native portable project, full native display/domain context, every rejected or unmatched row, and all original collection companions. A separate literal-text Excel workbook and individual CSVs make the reviewed results usable in familiar tools.

## Product workflow

Open Source returns in the original Measurements app. Select complete imported sources and any retained scientific results, name the return, and inspect the whole preview. The table preserves original columns and physical source-line identities. Review the entire population through paging; counts include rejected, blank, station-only and unmatched rows. No first-page truncation is used when publishing.

Publish the inspected return. The server reads one original atomic snapshot, compares the exact preview digest, and creates an immutable edition. A changed workspace or native domain requires a fresh preview. Repeating the same pending publication returns the same retained edition, including after the live workspace advances. The browser keeps the original request for uncertain-response recovery.

Download the ZIP and open report.html, returned-workbook.xlsx and the individual returned CSVs/row JSON. Every original remains unchanged under originals/. A matching retained collection is copied completely under collections/, including original XLSX formulas, cached values, cell metadata and other companion files. The review workbook is separate from that original workbook.

Use Receive returned ZIP to reopen this exact edition on another installation. Receiving validates its complete original native project using the existing Measurements receiver in an isolated temporary workspace, derives the corresponding native record view, reconstructs all generated member files, and checks the originals/companions. The receiving app retains the immutable return without replacing its current Measurements project.

To continue editing scientific inputs, receive project.json through the original Measurements project receiver into an empty workspace. Continue through the original mapping, review and calculation controls.

## Contents

| Member | Use |
| --- | --- |
| manifest.json | Complete selection, exact preview identity, every member's bytes/hash, source paths, workbook sheet map and counts |
| report.html | Readable source inventory, current native reviews, source/return links and saved-result links |
| returned-workbook.xlsx | Original columns first, appended review/results; every cell literal text |
| originals/* | Exact complete original imported files |
| returns/*.csv | Original-shaped rows with current native review/result columns |
| returns/*.json | Exact source fields, full native row context, rejections and result associations |
| source-return.json | Complete selected-source view and saved results |
| project.json | Whole original native Measurements project |
| native-context.json | Corresponding original native records, summary and domain-presence state |
| results/*.json | Complete selected saved result and its original revision |
| collections/* | Complete matching retained source collections and companions |
| README.md | Recipient working instructions |

All original field strings, leading zeros, source dates, timezone strings, reported units, normalization, censor bounds, fractions, basis, source IDs and selected revisions remain distinguishable. CSV fields that resemble spreadsheet formulas receive a leading apostrophe for safe opening; original bytes and full JSON remain exact. Excel cells use inline literal text, so formula text is not evaluated. Source rows wider than the original header retain extra cells in explicit surplus-field columns. Oversized Excel cells or columns produce a clear workbook-capacity note while preserving complete CSV/JSON/originals.

The table joins by the original import ID and physical source line, never approximate station names or row order. All linked native records and all retained source rejections must have corresponding source rows. Selected saved calibration and paired-load outputs retain their own revisions, references, values, assumptions and temporal support; the exporter does not perform scientific calculations. A newer current review can therefore differ from an older selected result without rewriting the earlier result.

## Original API

Existing base: /api/measurement-workspace.

- GET /handbacks: current revision, source/result metadata and retained editions.
- POST /handbacks/preview: {expectedRevision,sourceIds,exportIds}; returns every selected source row and previewSha256.
- POST /handbacks: {expectedRevision,sourceIds,exportIds,previewSha256,title,note}; returns immutable manifest.
- GET /handbacks/:id: immutable manifest with full selection and requestFingerprint.
- GET /handbacks/:id/view: original complete returned view.
- GET /handbacks/:id/bundle: {filename,bytes,sha256,contentBase64}.
- GET /handbacks/:id/files?name=MEMBER: original retained member download.
- POST /handbacks/receive: {contentBase64,sha256}; receives the complete original stored ZIP.

The publication ID is SHA-256 of stable JSON {format:"upper-savannah-source-handback/v1",request:canonicalSelection}. All selected arrays preserve their order. The exact original request resolves retries; new selections or changed content require a new preview. There is no new financial/scientific record writer, controller or background watcher.

The original HTTP request limit is 128 MiB. Base64 receiving is therefore suitable for ZIPs below roughly 96 MiB; use the command line for larger complete editions. Do not reduce an edition to fit transport.

## Command line

Use the existing engine/cli.mjs with Node 22.16 or newer.

~~~sh
node engine/cli.mjs source-handback-list --workspace ./data
node engine/cli.mjs source-handback-preview --workspace ./data --selection selection.json --output preview.json
node engine/cli.mjs source-handback-publish --workspace ./data --selection publish.json --output manifest.json
node engine/cli.mjs source-handback-inspect --workspace ./data --id RETURN_SHA
node engine/cli.mjs source-handback-bundle --workspace ./data --id RETURN_SHA --output returned.zip
node engine/cli.mjs source-handback-receive --workspace ./data --file returned.zip
~~~

selection.json contains expectedRevision, sourceIds and exportIds. publish.json adds the exact previewSha256, title and note. Preserve the complete original publish.json after an uncertain response and repeat it unchanged.

## Native composition

New engine leaves: source_handback_core.mjs, source_handback_xlsx.mjs, source_handback.mjs, source_handback_cli.mjs.
New web leaves: source_handback.mjs and source_handback.css.

The original http.mjs dispatches the namespaced routes. The original cli.mjs adds the commands and static assets; the source-return view is mounted once through the original Measurements tabs. The original operator.py includes the new static asset in its existing route allowlist. No changes to normalise.mjs, workspace.mjs, original source schemas, mapping/review mutation paths or saved scientific calculation methods are needed.

mountSourceHandback(container,{request,refresh,initialState,onStateChange}) uses the same Response-returning original Measurements request adapter. It exposes snapshot()/destroy() for its parent. The original workspace.js and installed measured_observations.mjs mounts compose current Guided Intake, Source Versions, Daily Flow and Saved Results. The original extension preserves unfinished handback selections per workspace/person; switches snapshot and dispose the child before replacing its DOM. Preserve 22B7 Inspect, 9F05 Guided, CEDAR source interpretation and all scientific-engine owners.

## Operate the existing completed source set

The optional engine/source_handback_course.mjs command performs one whole original publish, exact retry, full ZIP delivery and cold return receive against the actual existing database. It selects the five original source SHA values only when each identifies exactly one retained import, otherwise use an explicit --selection file. Previously saved calibration/load results are selected from the actual catalog; absent results are never invented. It writes the complete preview, request, bundle, reopened manifest and native outcome to a new owned output directory.

~~~sh
node engine/source_handback_course.mjs --workspace ACTUAL_MEASUREMENTS_DIRECTORY --output NEW_RETURN_DIRECTORY
~~~

Open and operate the actual resulting workbook, report, CSV and original files; source execution does not replace seeing the outgoing product.

## Focused execution

The five actual Eighteenmile 2023 WQP originals contain 533 accepted rows and 63 headings. Their complete source strings and physical lines have been exercised through the original current parseSource and the new original-row reader. Native database publication, cold ZIP receive and actual outgoing product viewing must be performed in the original native application host.

Use the existing completed 533-row Measurements project, not a newly invented reviewed dataset. Select its real sources and retained results; inspect the full preview, publish, download/reopen the workbook, report, CSV and ZIP, then receive the same ZIP in another native workspace and operate its retained edition. Confirm an uncertain publication reuses the same ID and a changed revision asks for a fresh preview. Check actual screenshare and narrow widths, empty/loading/error states, source and result views, original download and cold receiving. Fix concrete defects in the product. Do not run a broad suite or build a verification application.

## Owner direction

Retain the repository AGENTS.md rendered-product instructions and opportunities/upstate_forever_2026/CURRENT_OWNER_DIRECTION.md version 2026-10-13.4. Bryce renewed the existing Eco build and wants the complete original native scientific application and useful editable handoff. The original NDR/SDR annual stream-delivery results, explicit simulated-case designation and all existing workers remain intact. Preserve warm relationships internally; the producing peer must actually open, render, LOOK at and operate the exact outgoing app and every attachment before calling it client-ready.

## Installation through the existing native host

Use the complete integration/measurements/INSTALLATION.json and original operator/install_measurements.py against the existing registered scientific application. All declared member bytes and current predecessors are retained in the complete source delivery, including current Flow products, source reconciliation, guided intake and characteristic interpretation. Run the original installer with --check first, then its normal install; it preserves the original scientific target requirements and its shared installation lock. Use the same existing host and Measurements database; do not manufacture a second scientific source set.

## Delivery edition 2: complete project and companion identity

Historical deliveryEdition 2 publications remain supported. The preview binds the complete native project and native display/domain context, plus each matching original collection and all of its files. The browser shows the whole included project counts and full companion inventory before publication, including imports and saved results outside the selected returned rows. Only the original portable export's freshly generated createdAt value is excluded from the project digest; original sources, event timestamps, reviews, saved results and intake history remain bound.

Each collection's original definition, original source bytes, interpreted mapping and import ID must agree with the included native project. A matching collection retains every file, including unselected imports and companions, in the unchanged original order. Changing that inventory requires a fresh preview even when the scientific revision is unchanged.

Cold receiving preserves original editions 1 and 2. Edition 1 uses the original report and generated-file renderer exactly; edition 2 adds explicit Prepared by TokenJunkieLabs attribution to the report and working instructions. Receiving an already retained return compares the entire incoming manifest and all original member bytes with that exact edition. A conflicting payload cannot silently reuse its identity. Retrying the same original publication continues to resolve the retained edition before inspecting the current workspace revision.

## Delivery edition 3: reviewed copies of the original workbook

Operation: ECO-ORIGINAL-WORKBOOK-RESULTS-20261013.

A source imported through the retained workbook/worksheet bridge carries its exact binary, selected sheet/header/formula reading choices, source collection identity and complete physical row map. Selecting that native source in Source returns now also previews an original-workbook return. It follows each actual preparation receipt to its exact saved preparation, source and original binary. Multiple selected sheets or retained preparations from the same original workbook share one reviewed copy, with a distinct source-bound review sheet for each selection.

The original workbook is included byte for byte under workbooks/<original SHA>/originals/. The reviewed XLSX or XLSM contains every original worksheet and adds plainly named TJLabs Review sheets. Original worksheet, formula, style, media, external-link and macro parts retain identical uncompressed bytes. Only the workbook catalog, its relationship catalog and content-type catalog change to register the added sheets. The ZIP container is rebuilt; the unchanged original file remains independently downloadable.

Added review cells are literal text. They keep complete original field labels and projected values, original workbook/sheet/physical row, native source line, preparation edition, current Measurements revision and the existing current review/result columns. Preamble, header, blank and excluded rows have explicit positions and reasons; their actual original cells remain on the original sheet. Selected saved results retain their own original revisions. Full source-lineage.json and package-parts.json record the exact binding and before/after part identities.

The selected original scientific Python runs the standard-library package helper. The installed Measurements operator already supplies MEASUREMENTS_PYTHON=sys.executable. For standalone Node CLI use the same scientific Python on PATH or set MEASUREMENTS_PYTHON explicitly. This adds no workbook library, formula evaluator, macro execution, external-link access or scientific calculation.

Signed or structure-protected workbooks retain their exact original and complete separate row review, with a visible explanation instead of a changed protected/signed file. Unsupported binary/templates, unsafe or incomplete packages and Excel row/column/cell capacity limits likewise retain the original and complete existing CSV/JSON return. A missing selected interpreter or failed helper process stops publication while the original request remains available. No value is silently shortened. Original package expansion and complete reviewed workbook are bounded at 512 MiB.

Preview binds every reviewed-copy byte identity. Publication recomputes the same complete snapshot and compares that preview; a changed original or source binding requires another preview. Cold receive reconstructs the original-workbook members from the included native project and checks every outgoing byte through the original immutable receiving operation. Historical edition 1 and 2 rendering/replay is unchanged.

## Downloading workbook members through the installed app

The saved edition exposes Download original workbook, Download editable reviewed workbook, Download complete worksheet lineage and Download original part comparison. These controls use GET /handbacks/:id/member?name=MEMBER, an exact Base64/bytes/SHA-256/type envelope from the original verified member reader. The existing installed extension is a JSON/UTF-8 transport, so binary workbooks never pass through text decoding. The browser validates the complete decoded member against its saved manifest before download.

The original raw /files route and complete bundle route remain available. Existing browser limits still apply: a member/bundle above 256 MiB uses the original native file/CLI route, and a return ZIP above 90 MiB uses the original source-handback-receive CLI. Keep the entire source return rather than removing members.

## Operate the same actual workbook case

Use the original accepted workbook intake case and its actual preparation/native source IDs. The existing Eighteenmile 533-row CSV case remains its own operation; it is not evidence of a supplied workbook. Do not manufacture a new customer workbook, formula or measurement.

Write a selection file containing expectedRevision, complete sourceIds, chosen existing exportIds, title and note. Run the delivered course against the original Measurements database:

~~~sh
node measurement_workspace/engine/source_workbook_course.mjs --workspace ORIGINAL_MEASUREMENTS_DIRECTORY --output SAME_RETURN_DIRECTORY --selection ORIGINAL_SELECTION_JSON
~~~

The same operation directory retains its original selection, preview and exact publication request before writing. Repeating it reconciles that same immutable request. The course exports every member, receives the full ZIP in its private recipient workspace, closes/reopens that receiver and compares every original/reviewed file. It verifies that neither the original scientific project nor the recipient scientific project is changed by return publication/receiving.

A live receiving.lock protects the original invocation. Reconcile its actual process before removing a stale lease. Completed/reused outputs must match exact retained bytes; an existing conflicting output is never replaced.

In the original browser, operate Source returns at actual screenshare and 390 px width. Inspect the complete selected workbook identity and added-sheet/row map, publish, reopen its exact saved edition, download both workbook files and the full ZIP, then receive/reopen that edition through the same application. Exercise a lost publication response using its retained exact request. Include original excluded/blank rows and surplus fields when present in the real case. Open the original and reviewed XLSX/XLSM in the recipient's spreadsheet viewer, LOOK at original and added sheets, and save/reopen an explicitly separate editable copy. Preserve the native source return as issued; any recipient-edited workbook is a separate file.

Record actual screenshots viewed, file identities, rows/sheets and controls operated with the existing original receiving result. The course's visualInspection starts as awaiting_producer_review and names its actual output artifacts. Complete that observation in the producing lifetime, preserve the full operating case and use the original approved delivery route. Read and carry AGENTS.md and CURRENT_OWNER_DIRECTION.md version 2026-10-13.4.

The additive source_workbook_browser.mjs exports operateOriginalWorkbookReturn({page,selection,edition,output}). The caller supplies its already open original browser and the complete saved native edition. It preserves/downloads the current operator form, selects the exact original IDs in order, inspects the new workbook preview, repeats the same native publication request, verifies each workbook download, captures 1440 px and 390 px views, then restores the original operator form through the existing working-file receiver. It launches no browser or scientific job. The original producer reviews its returned actual screenshots and opens the workbook attachments normally.
