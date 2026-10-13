# Arches Receiving Workspace

## Purpose and operating route

Receive original Arches resource, graph and controlled-vocabulary files; compare the selected edition against an accepted release; record staff decisions; deliver the selected records together with their original meanings and a restorable workspace.

The application uses Python's standard library, SQLite and a local browser. The original source receiver streams resource arrays and retains exact raw bytes. Resource identity is the pair of graph ID and resource ID. It preserves tile IDs, nodegroup and node IDs, multilingual language keys, concept value IDs, graph publication references and geometry values. Decimal JSON values remain exact in source, database and exports.

Run:

    python3 arches_app.py serve --workspace /absolute/path/to/study

Read the private staff-token file named by the ready message, open the local URL and enter that token and a staff name. The token is not included in exported workspaces. The default service binds only to 127.0.0.1. A deployment using a shared host should place the service behind the organisation's existing authenticated reverse proxy and configure its routing deliberately.

## First edition

1. Choose a stable selection-scope name. This identifies what is being compared across editions: for example, one graph or an explicit delivery batch. Scope names are not inferred from a filename.
2. Upload the original resource files, matching graph definitions, vocabulary collections and source license files.
3. Select the original envelope explicitly: business_data.resources or one original resource wrapper.
4. Choose complete or partial coverage. Complete coverage treats absent records as removals. Partial coverage retains previously accepted records that are outside the supplied selection.
5. Receive the edition. The source stream must finish and validate before the candidate enters the authoritative workspace. Duplicate graph/resource identities fail receiving.
6. Inspect added resources and their source-contract diagnostics. Record an approval or rejection with a specific reason.
7. Create the release after every change has a final decision.

The importer does not apply a strict generated schema to a differently shaped observed publisher fixture. It reads the supported original envelopes, retains original shape and reports actual identity/context problems.

## Review the next edition

Use the same scope and select the prior accepted release. Receiving computes additions, changes and removals in SQLite. Resource JSON formatting changes alone do not create a content change. Changes to graph or vocabulary source meanings remain visible even when a resource's canonical JSON is unchanged.

Partial receiving with changed graph/vocabulary definitions is rejected; receive the complete selected scope so every affected record is reviewed. Approval selects the candidate resource. Rejection retains the prior accepted record. For an added record, rejection excludes that addition. Approval of a removal removes the accepted record. Deferral keeps the review open.

A resource with a blocking source-contract issue can be retained and inspected, but cannot be approved. Obtain a corrected original source edition or reject that change. The application never silently moves a foreign-owned tile, replaces an identifier or invents a vocabulary mapping.

Each decision carries the original before/after hashes. A decision about one candidate cannot silently apply to a changed edition. Release creation also checks that the selected parent is still the latest accepted release for that scope.

## Graph and vocabulary meaning

A tile's owner must agree with its enclosing resource. Its nodegroup and populated node keys must belong to the selected graph. Vocabulary bindings distinguish concept IDs from the IDs of label/value entries. Language tags such as en-US and en-us remain distinct original keys.

Each released resource is associated with the context snapshot from which it was selected. If staff reject a resource after a context change, its earlier accepted record keeps its earlier graph/vocabulary context. The release package contains those source contexts and the per-resource context binding. This avoids applying a new definition to an older retained record without review.

Geometry is retained in its original structure and numeric values. The receiver does not infer a coordinate reference system or reproject coordinates.

## Files and recovery

**Release ZIP:** selected original resource wrappers under resources/<graph>/<resource>.json, original graph/vocabulary/license context files, contexts.json, review decisions and a member manifest. Each resource's manifest entry identifies its context snapshot. A receiving publisher may wrap the records in business_data.resources; this application leaves their identifiers unchanged.

**Complete workspace ZIP:** an SQLite backup, all referenced original source files, audit and decision history, and the application source. Credentials, server upload cache, download cache and transient parsing databases are excluded.

Restore into an empty directory:

    python3 arches_app.py restore Arches_Workspace_....zip receiving-directory
    python3 receiving-directory/application/arches_app.py serve --workspace receiving-directory/workspace

The restore checks archive membership, lengths and SHA-256 before reopening the database. It verifies SQLite integrity and every referenced original source. It rejects unsafe paths and symlink archive entries.

Every staff mutation carries a stable operation ID and expected workspace revision. The browser retains an uncertain request in session storage and reuses the same request when opening the workspace. A lost HTTP response therefore does not require a second logical import, decision or release.

## Source and storage behavior

Resource parsing is incremental. Indexed SQLite rows hold each candidate and accepted record; comparison does not load all resources into one Python list. Source files are copied and checked before receiving. Parsing uses a temporary SQLite staging file, so malformed trailing source input cannot publish a partial candidate. The final authoritative transaction checks the expected workspace revision.

Retained files are content-addressed and immutable. Current edition metadata records the original filename, role, complete raw-byte digest and source coverage. File upload supports one source up to 2 GiB. Portable restore declares a 20 GiB uncompressed envelope. Capacity and processing time depend on actual resource/geometry size, indexes and the selected host; the included commissioning journey reports its real input counts.

No source deletion is implied by a failed import. The original retained bytes and any previous accepted release remain available.

## Included publisher commissioning cohort

The source cohort comes from flaxandteal/alizarin. The original resource is d2368123-9628-49a2-b3dd-78ac6ee3e911, graph 07883c9e-b25c-11e9-975a-a4d18cec433a.

The earlier resource at commit ddb5594127fb106af74574bf7e0df660cb95961f has two correctly owned tiles. The later observed source adds tile 5f95bf95-3682-4bd5-957d-ee643389f117, whose resourceinstance_id is 460c69bb-bccc-4f71-b276-edaac6ff6ee5. The resourceinstance object and first two tiles remain unchanged. Both editions use byte-identical graph and collection sources. The populated action value e3a6493e-5df4-4ad4-a699-ade7ccf01917 is the Reading label/value ID, belonging to concept 70415d03-b11b-48a6-b989-933d788ffc88.

These are publisher fixtures. They commission the actual source/review/release/receiving path and are labelled accordingly. Original publisher license text and attribution travel with the cohort. A customer delivery uses its authorised actual source cohort and its own scope, graph definitions, staff decisions and deployment.

## Partner implementation offer

The product supports a specific delivery arm for an Arches implementation partner: receive a client-approved data batch, resolve its original graph/vocabulary contracts, compare corrected editions, operate the staff review and return an accepted portable release. The partner retains its client relationship and original publishing deployment.

A priced engagement should name the actual source system and selection, expected record/geometry volumes, two concrete editions, source access, review owner, deployment target, receiving outputs and handover schedule. Public publisher fixtures establish software behavior; customer-specific mapping and source access are agreed during intake.

## Downstream StaticFile and per-resource receiving

Every accepted release now contains both the selected original `resources/<graph>/<resource>.json` wrappers and complete streamed `business_data/<context>.json` files. Each latter file has the original `business_data.resources` envelope used by Alizarin’s retained StaticFile receiver. The operator builds it directly from the accepted canonical records in SQLite, with exact JSON numbers and language keys preserved, and records its complete bytes, SHA-256, resource count and context identity in `MANIFEST.json` and `downstream.json`.

Choose the declared receiving format explicitly. For StaticFile, receive the corresponding business-data file with `source_format="business_data"` and the graph/collection files named by its `context_snapshot` in `contexts.json`. For the direct static/HTTP client, use each unchanged resource wrapper. A release can retain records from different meaning editions after a rejection; those records stay in separate business-data files grouped by their selected original context. Do not merge those meaning definitions or infer a current global vocabulary for an older accepted record.

The complete native publisher journey reopens the actual exported envelope through the original streaming adapter to EOF, matches its exact accepted record and validates its recorded file identity. It also restores the full workspace and produces the same accepted delivery from the fresh receiver.


## Complete staff review exchange

For a larger selection, open its Review tab and choose **Download review CSV**. This uses the current change-type filter; **Open and deferred changes only** is selected initially. Clear it deliberately when revisiting previously decided resources. Export is read-only and streams every selected row from the existing SQLite indexes.

Edit only the final two columns: decision (approve, reject or defer) and reason. A blank pair keeps that row unchanged. Keep the remaining columns exactly as exported, including the JSON string quotes on resource IDs. They bind each decision to its original resource, before/after hashes, meaning context, previous staff decision and workspace revision. The JSON display columns keep source text as data when a spreadsheet opens the CSV.

Receive the completed file in the same tab. Preview parses the entire file into temporary SQLite storage, checks every original identity and field, detects duplicate rows, verifies source stability and rejects approvals with blocking diagnostics. It shows full counts and a small sample; no staff decision changes during preview. A malformed last row cannot publish a partial review. The supported envelope is 2 GiB per CSV and 16 MiB per cell.

Apply the exact preview. All selected decisions commit in one original workspace transaction with its expected revision and stable operation ID. Another staff change invalidates the old file; receive a fresh export and reconcile the intended decisions. A lost response resumes the same saved operation and receives its completed result. The original CSV, full preview identity and selected decision history are retained and included in complete workspace backup/restore and the corresponding release. Staff-token and private upload caches remain outside portable output.

The exchange does not infer approvals, repair original data or replace per-resource inspection. Use the existing source/record view to make the decision, and enter the responsible staff reason. The original page-based decision flow remains available for small selections.

For service integration, use POST /api/review/export, then PUT /api/uploads?kind=review&name=review.csv, POST /api/review/preview and POST /api/review/apply. Preview takes snapshot, upload_id and expected_revision; apply adds its returned preview_sha256 plus actor and the stable operation_id. All routes require the existing staff credential and same-origin check.


## Inspect the actual outgoing product

Before presenting this application or its generated reports/downloads as ready, open the exact outgoing edition in its real browser runtime and look at the rendered screens or their actual screenshots. Operate the important staff controls at the intended screenshare width and at a narrow/mobile width: first open, receiving/loading, source error, populated comparison, original-record inspection, CSV preview and commit, release download and independent workspace reopening. Screenshot creation alone is insufficient; the producing owner must inspect the images and repair clipped, cramped, overflowing, unstyled or unreadable output in this same product. Preserve the original source, decisions and delivery history while correcting the display.

Use plain industrial presentation: readable tables, clear hierarchy, consistent type and spacing, restrained controls and useful labels. Full source review or HTTP success does not replace looking at this rendered edition. This is part of completing the actual customer workflow, not a separate test suite or review queue. Any delegated receiving owner carries this same instruction and returns the actual screenshots together with the original programme result for source-owner inspection.

### Whole browser receiving on existing compute

The source owner uses `browser-receiving.mjs` and `BROWSER_RECEIVING.md` to operate the actual original publisher editions through the rendered staff controls. The original HTTP receiving and this browser course run inside the same admitted programme; the browser course uses its own clearly named commissioning workspace and returns its full portable workspace. Set `ARCHES_NODE`, `ARCHES_PLAYWRIGHT` and `ARCHES_CHROMIUM` to existing installed executable/module paths before the source receiver starts. If the host requires Chromium flags, supply a JSON string array as `ARCHES_CHROMIUM_ARGS`. The programme declares those actual runtime paths and the additional memory/disk footprint. It neither installs another browser nor invokes hosted CI.

The complete project joins the actual browser result, screenshots, downloaded source/review/release/workspace files and their original identities. Its `visual_review_complete` remains false until the producing owner has looked at the actual images and repaired any visible defects. If the existing browser runtime is absent, the original HTTP course can still retain its real output and source; the returned result explicitly carries `existing_browser_runtime_required`, and the rendered-product receiving continues from that exact saved edition.
