# Complete original collections with streamed receiving

Prepared by TokenJunkieLabs.

The installed Measurements collection panel can receive a reviewed set containing large WQP or station CSV originals, ordinary USGS daily-response originals and supporting files. It keeps the original collection format, canonical collection and import identifiers, source filenames, earlier study editions and scientific writers. The same collection remains available to the existing Chemistry, Observation editions and study workflows.

Large CSV bodies pass through the existing checked 256 KiB intake. The browser retains its unfinished choices, exact pending operation and any unacknowledged chunk; the native workspace retains the complete original. Collection publication uses the original streaming ZIP64 exporter, including the complete native database, ordinary workspace companions and original collection sources.

## Operator course

1. Open the original Measurements workspace and its collection panel. Name the set and add its original files. Choose WQP, station metadata, USGS daily response or companion deliberately. A companion is retained without interpreting it as a measurement.
2. For each large CSV, select or create its original intake. Choose its source label and mapping. Sequential upload acknowledges each original chunk. To resume after closing the page, reselect the same file; every previously acknowledged chunk is compared before more bytes are accepted.
3. Prepare the complete original. Inspect the actual headers, column interpretation, accepted and rejected counts, literal sample values and source hash. Correct a mapping before proceeding. The normalizer keeps source units, dates, fractions, qualifiers and censoring behavior; collection receiving adds no new scientific transformation.
4. Inspect the entire collection. The returned collection ID binds the complete canonical source document. Its review hash also binds the exact workspace revision, complete per-file inspection and each selected normalizer edition.
5. Choose Receive. The browser saves the complete original request before dispatch. The native operation retains every original file before its first import, then uses each source's original scientific transaction. Receiving a set is a sequence of complete native imports. An interruption can leave an explicitly partial set, with its original request and per-file results available for continuation.
6. If the response is lost, reopen the saved working copy and continue the same request. Completed imports are reused by their original identities. If unrelated workspace changes intervene before an unfinished import, inspect a new continuation and choose a new operation ID; earlier partial history and every original remain retained.
7. Inspect the received original collection and its source records. Publish a large edition at the displayed workspace revision. The edition selection identifies this collection and is itself copied into the complete native archive.
8. Download every selected native edition member. Each member has its full size, whole SHA-256 and ordered 256 KiB chunk hashes. A native receiving copy can reopen the complete project, its original collection, records, reviews, prior editions and source files through the existing receiver.
9. Return to the original collection and continue the unfinished or next scientific work through the existing controls. Historical inline study editions keep their original report, CSV, JSON and ZIP opening routes.

The producing peer operates the actual controls and downloads, personally views desktop and narrow rendering, opens every outgoing attachment, and cold-reopens the full editable receiving project. Continue the original accepted native course; source-level execution does not replace that product use.

## Canonical source document

The ordinary document is still:

~~~json
{
  "format": "upper-savannah-measurement-collection/v1",
  "title": "An explicitly selected measured study",
  "files": []
}
~~~

For an inline source, keep the original member fields: path, kind, SHA-256, label, mapping, origin and exactly one UTF-8 text or canonical base64 body. USGS daily responses and arbitrary companions continue through this original bounded path. They are not interpreted by the large CSV parser.

A streamed WQP or stations source replaces its inline body with intakeId. Its sha256 is the actual prepared sourceSha256; label and origin are the retained intake's original metadata; mapping is the actual prepared mapping. The server compares those fields rather than rebinding a different label, source or interpretation. Browser-created collection intakes begin with origin set to {"type":"collection-file"}. A CLI intake may retain its own original file origin; use that actual value.

The stored canonical collection.json contains the same original member metadata, bytes and native import IDs as an equivalent inline collection. It contains no transport-dependent intake ID. Therefore choosing the streaming transport does not change the scientific source identity.

Source filenames must be relative, unique and nonoverlapping. A file named source.csv cannot also be the parent of source.csv/notes.txt. Original files are immutable under collections/COLLECTION_ID/sources/.

## Native request and response

All routes remain under the original authenticated /api/measurement-workspace transport.

| Route | Original operation |
| --- | --- |
| POST /large/collections/preview | Inspect every full source before receiving. |
| POST /large/collections/receive | Receive the exact saved collection request. |
| GET /large/collections/COLLECTION_ID | Open the canonical document, per-file progress and saved editions. |
| GET /large/collections/COLLECTION_ID/editions | List bindings and their complete available native metadata. |
| POST /large/collections/COLLECTION_ID/publish | Capture the complete native workspace with the selected collection binding. |
| GET /large/editions/EDITION_ID | Open unchanged native edition metadata. |
| GET /large/editions/EDITION_ID/files/MEMBER/INDEX | Read an original member chunk by chunk index. |

Preview returns the original id, format, title, files, inspection and workspaceRevision, plus reviewSha256 and receiving. Each receiving row includes path, intakeId or null, sourceSha256, bytes, importId or null, and normalizerPin or null. A streamed inspection is the complete actual prepareIntake result; an inline inspection is the original workspace preview.

Receive adds operationId, expectedId, expectedReviewSha256 and expectedRevision to that same complete manifest. Both operationId and native IDs are 64 lowercase hexadecimal characters. Save the entire request before sending and preserve it verbatim for recovery. The response includes id, operationId, title, complete, phase, workspaceRevision, continuationRevision and each original native result.

A successful receive writes the unchanged complete.json convention. GET status includes all receiving operations, including an interrupted phase, its exact pending source and error. The saved request remains under the original collection's receiving/OPERATION_ID/request.json and its durable progress under operation.json. A later reviewed operation can finish the same canonical collection without deleting its earlier partial history.

No whole-set atomicity is claimed. Each native source transaction is atomic. A revision check binds each newly admitted scientific import; an exact already-committed source can be recovered without reinterpreting it. A changed interpretation is refused before a different native import is written.

## Collection-bound large edition

Publish accepts id, expectedRevision and filters. Retain the entire original selection for recovery. The native binding has format upper-savannah-collection-large-edition/v1, collectionId, editionId, expectedRevision, filters, documentSha256 and sourcePaths. It is stored as an ordinary selection.json under collections/COLLECTION_ID/large-editions/EDITION_ID/ before capture.

The response is {collectionId,binding,edition}, where edition is the unchanged complete native metadata plus collectionBinding. The exporter checks the actual captured database revision and full binding. An existing edition with a different original request is refused; a lost-response retry selects the same saved capture. Creating the collection binding does not make an unfinished archive complete.

Status.largeEditions is an array of those same rows. The editions route returns {collectionId,editions:[...]}. An interrupted publication has edition:null until the original native metadata is available. The actual files list determines available downloads.

The edition contains the complete workspace, including other retained collections and its ordinary companions. Filters select exported analytical populations; they do not remove source records or collections from the native project. Every original file in this collection is copied into the archive. The original checked source chunks and rejections remain in the native database.

On an independently received workspace, saved analytical population members remain available under their original edition IDs. The original sending host retains its complete project.zip bytes. A receiving workspace creates a new full archive with a new edition ID and its current revision; it does not reconstruct old ZIP bytes under an old identity.

The .large intake and temporary export directories remain managed runtime state and are excluded from the complete project archive. A completed collection travels through its ordinary source files, canonical document, native imports and binding. An unfinished browser working copy separately preserves its request and intake selections for continuation on the same native host.

## Installed CLI

The existing engine CLI dispatches these commands:

~~~text
node measurement_workspace/engine/cli.mjs large-collection-preview \
  --workspace /absolute/selected-measurements \
  --manifest /absolute/complete-collection-input.json \
  --result /absolute/new-preview.json

node measurement_workspace/engine/cli.mjs large-collection-receive \
  --workspace /absolute/selected-measurements \
  --manifest /absolute/exact-reviewed-receiving-request.json \
  --result /absolute/new-receiving-result.json

node measurement_workspace/engine/cli.mjs large-collection-status \
  --workspace /absolute/selected-measurements \
  --collection COLLECTION_ID

node measurement_workspace/engine/cli.mjs large-collection-publish \
  --workspace /absolute/selected-measurements \
  --collection COLLECTION_ID \
  --request /absolute/exact-edition-selection.json \
  --output /absolute/new-complete-edition
~~~

Result files use the existing create-only CLI behavior. Publication output contains every actual native edition member and collection-edition.json. Existing equal member bytes can resume a partial output; conflicting bytes are retained and reported.

Use the original large-prepare --file/--id or retained --intake flow to receive local large files, then select its actual metadata in the collection manifest. The installed caller supplies paths; the HTTP collection endpoint accepts no arbitrary server filesystem path.

## Source composition and receiving

The cumulative Measurements installer remains the installation authority. The complete release includes the native collection adapter, original canonical collection helpers, narrow transaction/capture guards, original HTTP and CLI joins, the original collection panel and its browser working-copy/transfer helpers, both installed browser aliases, the scoped mount, component inventory and this guide. Preserve concurrent native scientific modules and compose these owned source rows into the current installer; do not restore an older cumulative manifest.

The original inline collection API, original importer, original database schema and scientific normalizer remain selected. The base64 reader now validates linearly and checks canonical decoded bytes, so a valid 6 MiB companion does not overflow the former nested-quartet regular expression.

Focused complete-module execution covers canonical inline/streamed identity equality, mixed original sets, all-source preflight, saved-request replay, interrupted commit acknowledgement, changed workspace continuation, changed source metadata, collection-bound whole publication and complete base64 source custody. The current equipped native receiving owner executes the SQLite, archive and rendered controls on its retained application and real original input course.

The actual earlier WO45 eight-station course completed native receiving, independent SQLite reopening and desktop1440/narrow390 use. Its original records remain eight station metadata entries and zero measurement observations; this new collection course extends the same product without recasting that earlier result.

## Original completed station receiving

The [original WO45 receiving completion](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791919527972169?thread_ts=1791724121.853269) retains the operated eight-station metadata course and its exact independently opened originals. Continue that accepted product operation at its source boundary.

## Complete current owner direction

Durable source: CURRENT_OWNER_DIRECTION.md, version 2026-10-13.4. The complete retained brief follows. Its earlier call framing is retained as source history; Bryce's later positive meeting outcome and current build instructions remain in the original coordination thread.

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.4`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build and finish as much of the existing Eco science application as possible before Bryce's call. Bryce renewed this work directly at **October 13, 2026, 10:46 a.m. Eastern / 14:46 UTC**, after the earlier 10 a.m. preservation checkpoint. Resume the existing unfinished work from its actual saved state and preserve completed outputs, active processes and original implementation ownership.

## Direct owner instructions

Latest direct instruction, October 13 at 10:46 a.m. Eastern:

> Get as much of eco science done with the fleet as possible before my call. Try to get it finished its possible im throwing shit ton of agents just get it done

This current instruction supersedes the earlier 10 a.m. Eco work cutoff. Prior cutoff records remain historical evidence. Coordinate at the existing Eco thread, reconcile actual issued handles, complete unfinished integration and native receiving, and publish usable durable handoffs in the existing application. Preserve the distinction between the sender's completed runs and the runs actually included in a received Study. Existing workers keep their current operations; additional workers clear complementary blockers. The recorded call remains unchanged; this direction schedules no meeting or automation and authorizes no client message.

> do the simulated model

> just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it

> just checking dont pause anythi g

> and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast

## Build for an experienced scientific practice

Ecosystem Sciences lists GIS, hydrology/monitoring, ecological modeling, watershed assessment, statistics, visualization, optimization and publishing. Tim Maguire's practice includes GIS, modeling and water resources. Its South Platte work assembled data, mapped natural capital and produced watershed investment decision support. Do not assume it lacks these capabilities. Its unmet tooling, InVEST or production-capacity gap is unknown until the call. Sources: [Services](https://www.ecosystemsciences.com/read-me), [Firm](https://www.ecosystemsciences.com/firm), [South Platte](https://www.ecosystemsciences.com/).

Show concrete delivery and engineering offload on the actual Upper Savannah RFP workflow: source assembly, reproducible native calculations, editable scenarios, useful decisions and a complete working handoff. The prime retains scientific direction, method choices, interpretation/review and the client relationship. Relevance comes from useful work they can inspect, adapt and receive; do not promise Tim's reaction or claim an unconfirmed need.

## Execute the prepared simulated case now

Native execution is the immediate hard priority. Issue the prepared simulated case on the verified scientific runtime, retain its actual run identity and progress, and obtain the real native outputs. Continue the source/runtime/application integration needed to make that happen. Further plans, stock demonstrations, policy reviews and cosmetic inspection do not replace execution. Do not introduce a bid decision or a prime's yes as a gate.

Demonstrate the scientific operation in the actual application:

1. Use the RFP's 30 m GIS selection. Keep the upstream contributing model domain distinct from the South Carolina reporting mask and the four existing utility focus anchors; retain their actual source geometries and identities.
2. Run the baseline, a realistic riparian alternative and its matched control with explicit, editable source editions, assumptions, parameters and scenario changes.
3. Show active run/progress/logs and completed native annual NDR/SDR results: nitrogen and phosphorus in **kg/year**, sediment in **tonnes/year**, representing delivery to streams. Do not present these modeled stream loads as intake concentrations.
4. Compare the actual maps, tables and report, preserving matched scientific support and original units. Keep source/assumption edits and their consequences inspectable.
5. Export the editable GIS/project and complete scientific working package. Cold-reopen the delivered application/project and show the retained sources, selections, results and useful controls.

Identify the simulated case as modeled. Never invent measurements, completion or customer acceptance.

## Present the real work and real speed

Actually open, see and use the outgoing app and every attachment as its recipient would. Repair defects and ship a plain, readable product. Apply the standing inspection rule without review/test theatre or parallel bureaucracy.

If producing video, record the actual working application and use available natural generative voice/TTS. Watch and listen to the final export. Generated frames must never pretend to be a working app. Explain speed using actual elapsed start, commit, run and package history; do not invent delivery times or guaranteed reactions.

## Carry this direction with the work

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.4` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.
