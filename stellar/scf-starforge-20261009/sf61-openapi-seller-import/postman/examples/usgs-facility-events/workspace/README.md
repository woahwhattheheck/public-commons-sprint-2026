# Facility operations desk

This is the complete customer workspace for the original USGS facility-event reporter. It carries original event responses and complete saved buyer collections into ongoing site work: a facility roster, immutable report editions, assigned reviews, customer reports and a complete receiving copy.

The installed command is **usgs-facility-events**. The installed Applications catalog presents **Facility operations**. Both open the same private workspace and use the maintained application process lifecycle. The server and CLI require **Node.js 24 or later** and use its built-in SQLite module.

## Open the workspace

From an installed merchant distribution:

    starforge usgs-facility-events --workspace /private/facility-desk

From this repository:

    node stellar/scf-starforge-20261009/sf61-openapi-seller-import/postman/examples/usgs-facility-events/workspace/cli.mjs \
      --workspace /private/facility-desk

Open the complete local URL printed by the launcher. The private server listens on 127.0.0.1. Its workspace token stays in the local URL fragment and authenticated requests. Closing the process drains source captures and current transfers before releasing the original database writer.

The workspace contains a stable workspace identity, a SQLite customer database, complete original buyer archives in its private buyer-collections directory and a private launch record. It can hold several separately named customer projects. Open an existing project to resume its saved state. The original SQLite writer lease and installed Applications resource lease prevent two processes from writing the same directory concurrently.

## Complete the operating workflow

1. **Create a customer project.** Enter the organisation, preparing operator, handover contact and operating procedure.
2. **Save a facility roster.** Each site has a stable ID, name, latitude, longitude, radius in kilometres, minimum magnitude, responsible contact and site procedure. A roster edition retains all these values. Opening an older roster creates an editable draft for a new edition.
3. **Receive or capture event sources.** Receive a complete collection exported by the existing buyer resource library and select its original event responses, retain an individual GeoJSON file, or choose a public USGS feed or fixed catalog window. Original response bytes, collection members and annotations, buyer fields, URLs, headers, query selections and count observations stay with their source edition.
4. **Prepare a report edition.** Select one saved roster and 1–16 explicit response editions. Record the preparing operator and the reason for the source selection. The original report engine performs the calculation and retains its full result.
5. **Work the operating queue.** Assign a site/event pair, investigate it, record its action and close it through the site procedure. Every saved review records its operator, assignee, due time, action, rationale and exact source edition.
6. **Deliver and receive.** Open the printable customer handover, download the full reports and operating CSVs, and export the complete workspace. The receiving operator opens that one portable file and continues from the original source history.

The queue keeps previously observed work even when a later feed window or a narrower report no longer contains the event. An event or facility change returns the item to **needs review**, with the earlier action still available in its attributed history. A review can carry across editions when the actual facility and event values are unchanged. Its original review edition remains visible.

The USGS event-review status and the customer's operating status are separate fields. The customer's review actions are assigned, investigating, action recorded and closed. A completed action or closed review requires a recorded action.

## Receive a complete saved buyer collection

In the existing buyer resource library, save the selected resources as a named collection edition and export that exact revision:

    starforge inbox library collections export \
      --state /private/buyer-library --id ORIGINAL_COLLECTION_ID \
      --revision ORIGINAL_REVISION --out /private/customer-collection.tar

The command returns the original archive SHA-256, manifest SHA-256, collection revision, member count and byte count. Keep that receipt with the archive.

In Facility operations, open the customer project and choose **Sources → Receive a saved buyer collection**. Select the complete .tar file and name the receiving operator. The browser hashes the original file in small slices, streams its complete bytes to the private workspace and keeps the selected File available if its response is interrupted. For an archive already on the operating computer, open **Read an archive already on the operating computer**, enter its absolute original path, the receiving operator, optional expected SHA-256 and a receiving note.

The unchanged SF88 native reader checks the USTAR structure, exact original manifest and every member's original bytes. The workspace keeps the complete archive by its SHA-256 and stores its original manifest bytes separately. A later copy of the same archive reuses those exact retained bytes while preserving its separately attributed receiving edition.

Open **Review and select original responses**. Search by original filename, intent, source URL, annotation or tag; page through the complete collection and select 1–16 responses. Selections stay selected across pages. Enter the receiving operator and a source-selection note, then choose **Retain selected responses for reporting**. Open report preparation to select the facility roster and name the report.

A response is usable by the original event reporter when it has a saved HTTP 200 GeoJSON FeatureCollection, or an original empty HTTP 204 response, and fits the reporter's 64 MiB source limit. The reporter checks the complete selected body before saving it. Collection members of other formats and outcomes remain in the original archive and member list. The original reader's complete-archive limit is 16 GiB; the manifest can contain up to 10,000 members. Selecting fewer report sources leaves the complete collection intact.

Each source shows its receiving operator and a downloadable **Original buyer member**. That file includes the full original member object, its collection identity and the source binding. Original intent IDs, buyer status, HTTP outcome, payment terms, annotations, nested origin data, strings, arrays and objects remain as supplied in the manifest. The desk's receiving attribution and customer event decisions are separately recorded.

The customer handover includes the original collection revision, receiving attribution, selected member, buyer outcome and payment terms. **Delivery → Complete original buyer collections** downloads each complete archive or its exact original manifest. The full customer workspace transfer carries all original archives, including members that were not selected for reporting.

### Continue after an interrupted response

Keep the selected original file, project and operation unchanged and retry the same form. The service returns the original receipt if the save completed. Choosing another file, changing the source selection or editing the receiving fields gives the next operation its own identity. The browser disables intake controls while it awaits the current save.

An incomplete private archive upload is removed when its receiving operation ends. A fully retained archive remains available under its content identity even if a later project transaction fails. The original user-selected input file is never rewritten.

## Original historical walkthrough

Create a project with a preparing operator, open **Sources → Original historical example**, and select **Open historical example project**.

This creates a separate, named historical project from the original sibling files:

- facilities.example.json: three illustrative city-centre sites;
- historical-response.json: the retained USGS response for the 2014 South Napa earthquake;
- report-core.mjs: the original facility matching and rendering engine.

The saved source includes USGS event nc72282711 and its retained magnitude 6.02. Its three original site distances are approximately 9.421 km for Napa, 49.846 km for San Francisco and 82.102 km for Sacramento. The native workflow checks those values through the original reporter.

Assign and record a review, save another facility roster with a changed radius, then prepare a second edition from the same original source. Compare the two editions. The operating queue retains an earlier assignment if the changed radius removes its event from the new report.

The historical source includes its original provider update timestamp. **Use Napa historical window** loads the exact catalog filters for an additional live capture; the resulting response is retained as a new edition.

## Public source capture

Published real-time feeds support the provider's all, 1.0, 2.5, 4.5 and significant selections over the hour, day, week and month periods.

Fixed catalog selections retain explicit UTC start and end times, the minimum magnitude and optional geographic rectangle. Longitude bounds outside ±180 permit an interval across the date line. The service includes both time boundaries.

For each catalog interval, the capture retains a count response, a GeoJSON response and a subsequent count response. If the service reports more than 20,000 events, the same capture divides its time interval and continues with the two inclusive child windows. Original observations remain in the capture history. The original report engine resolves repeated event IDs at shared window boundaries.

Each completed HTTP body is stored by its SHA-256. A paused or interrupted capture resumes accepted observations and completed intervals under its original capture identity. Its failed HTTP responses remain downloadable as original observations. Provider retry times are retained and used for the next resume.

The original reporter accepts 1–16 responses, at most 100,000 received feature rows and at most 10,000 matched facility/event rows per report. A capture can retain more responses; the report selection remains explicit. Source and radius coverage notes appear for declared capture plans, including a source magnitude floor above a site's threshold or a rectangle narrower than the complete site radius.

An original empty HTTP 204 response remains an empty body with its HTTP status. It contributes zero features through the same native report engine.

Primary source contracts:

- [USGS earthquake event service](https://earthquake.usgs.gov/fdsnws/event/1/)
- [USGS GeoJSON summary feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php)
- [Node.js 24 SQLite API](https://github.com/nodejs/node/blob/v24.9.0/doc/api/sqlite.md)

## Decisions and customer output

The original engine selects the newest event update, excludes conflicting values at the same newest update, and retains its exclusions and issues. It uses great-circle epicentral distance with a 6371 km spherical Earth. Radius comparison uses the unrounded distance; the report displays rounded kilometres. Site action follows the customer's recorded procedure.

Every report edition has its original source IDs, roster ID, preparing operator, note, creation time, native result and report SHA-256. **Exact report facility input** downloads the canonical JSON bytes whose SHA-256 appears in that report's facilitySource.

The customer handover includes:

- the complete original matched-event report, source identities, exclusions and issues;
- selected original collection members, their buyer outcomes, terms, annotations and separately recorded receiving attribution;
- current operating decisions, assignees, actions, rationale and due times;
- site procedures and source selection observations;
- outstanding work from older retained editions;
- the attributed review history of the included operating work.

The operating CSV contains both the current edition and the original review edition and fingerprints. Spreadsheet-facing text is escaped before CSV delivery. Use the complete JSON/NDJSON handover to carry the full original data structures and byte identities.

## Receive a complete workspace

**Export complete workspace** produces a newline-delimited JSON transfer with one header, deduplicated original source bodies, all immutable saved items, capture observations, operation receipts and a final byte/hash manifest. Projects containing buyer collections use the v2 transfer and also stream every complete original archive, deduplicated by its SHA-256, with the exact original manifests and source-member bindings. Projects with ordinary response files retain the original v1 transfer shape; both versions can be received.

Receiving checks every original source digest, verifies every complete collection through the original SF88 USTAR reader, binds each selected response back to its original member and raw manifest, recomputes every report through the original engine and checks each review against its saved facility/event values. It then commits a new customer project atomically. The received project retains the original header, project identity, revision, receipts and transfer hash.

The export streams source bodies in small encoded parts. Imports retain one complete source line at a time and commit the customer copy only after the complete manifest and native recomputations succeed. Pause source captures before receiving a full workspace, so the original database has one active write operation.

The receiving copy is separately named. Earlier project data and original portable files remain available. New decisions in the copy receive their own attribution and revision.

## Customer CLI

Use a stable --operation-id when retrying a write after an interrupted response.

    starforge usgs-facility-events project \
      --workspace /private/facility-desk \
      --settings project.json \
      --operation-id customer-intake-001

A project settings file contains title, organisation, operator, procedure and handoverContact.

    starforge usgs-facility-events ingest \
      --workspace /private/facility-desk \
      --project ORIGINAL_PROJECT_ID \
      --roster facilities.json \
      --source original-response.geojson \
      --name "Morning facility review" \
      --operator "Named preparing operator" \
      --operation-id customer-report-001

A roster can be the original commons.facility-watch-input.v1 object or a desk draft containing label, facilityInput and per-ID details. The CSV screen accepts id, name, latitude, longitude, radiusKm, minimumMagnitude, owner, procedure and notes columns.

Capture an exact saved query or continue its original capture:

    starforge usgs-facility-events capture \
      --workspace /private/facility-desk --project ORIGINAL_PROJECT_ID \
      --query query.json --operation-id source-window-001

    starforge usgs-facility-events capture \
      --workspace /private/facility-desk --project ORIGINAL_PROJECT_ID \
      --capture ORIGINAL_CAPTURE_ID

Prepare the selected customer delivery in a new output directory:

    starforge usgs-facility-events report \
      --workspace /private/facility-desk --project ORIGINAL_PROJECT_ID \
      --edition ORIGINAL_EDITION_ID --out /delivery/customer-report

The directory contains the complete report JSON, report CSV, operating queue CSV, printable customer handover and full workspace transfer.

    starforge usgs-facility-events export \
      --workspace /private/facility-desk --project ORIGINAL_PROJECT_ID \
      --out /delivery/customer-workspace.ndjson

    starforge usgs-facility-events import \
      --workspace /private/received-desk \
      --input /delivery/customer-workspace.ndjson \
      --operation-id customer-receiving-001

Output files are created exclusively. Keep an interrupted output and use a new destination when receiving another copy. A finished transfer ends with its completion manifest.

### Collections and retained-source reports

Receive the complete original archive:

    starforge usgs-facility-events collection-import \
      --workspace /private/facility-desk --project ORIGINAL_PROJECT_ID \
      --archive /private/customer-collection.tar --operator "Receiving operator" \
      --sha256 ORIGINAL_ARCHIVE_SHA256 --note "Original source selection from the buyer" \
      --operation-id customer-collection-001

Use the returned receiving collection ID to inspect the original member page:

    starforge usgs-facility-events collection-show \
      --workspace /private/facility-desk --project ORIGINAL_PROJECT_ID \
      --collection RECEIVING_COLLECTION_ID --query "earthquake" --offset 0 --limit 50

Each item contains the unchanged original member plus separate selection guidance. The receiving collection ID identifies the Facility receipt; the original collection ID and revision remain in the returned collection identity.

Select the original member IDs from that page:

    starforge usgs-facility-events collection-sources \
      --workspace /private/facility-desk --project ORIGINAL_PROJECT_ID \
      --collection RECEIVING_COLLECTION_ID --member ORIGINAL_MEMBER_ID \
      --operator "Receiving operator" --note "Selected original event window" \
      --operation-id customer-source-selection-001

Repeat --member for up to 16 distinct original responses. All selections are adopted together, and the command returns their retained Facility source IDs.

    starforge usgs-facility-events edition \
      --workspace /private/facility-desk --project ORIGINAL_PROJECT_ID \
      --roster facilities.json --source-id RETAINED_SOURCE_ID \
      --name "Source-linked facility review" --operator "Preparing operator" \
      --operation-id customer-retained-report-001

Repeat --source-id for additional selected responses, or use --roster-id to reuse an existing immutable roster. The existing **report** command delivers this edition with the full original archives inside workspace.ndjson.

    starforge usgs-facility-events collection-export \
      --workspace /private/facility-desk --project ORIGINAL_PROJECT_ID \
      --collection RECEIVING_COLLECTION_ID --out /delivery/original-collection.tar

This download reuses the buyer's fully verified native file descriptor and creates an exact complete archive copy. Its output SHA-256 is the receiving archive SHA-256.

    starforge usgs-facility-events show \
      --workspace /private/facility-desk --project ORIGINAL_PROJECT_ID

The saved project view includes all collection receipts, rosters, source IDs, edition summaries and capture state.

## Reusable application interfaces

The installed distribution contribution exposes:

| Export | Maintained interface |
| --- | --- |
| ./customer/facility-operations | Source/roster validation, native report editions, review binding, comparisons, CSV and customer HTML rendering. |
| ./customer/facility-operations/store | openFacilityStore, immutable entries, transactional edits, source bodies and complete streaming transfer. |
| ./customer/facility-operations/captures | SourceCaptures with the retained public USGS capture and resume lifecycle. |
| ./customer/facility-operations/collections | Complete archive receiving, original member paging, exact archive streaming and verified native downloads, with adjacent TypeScript declarations. |

The existing store exposes importBuyerCollection and importBuyerCollectionUpload for complete archive intake, collectionMembers for original member pages, importCollectionSources for one atomic source selection and sourceAcquisitions for full buyer provenance. importCollectionSources returns retained source IDs for the existing createEdition call. Full exportProject/importProject carry the archive bytes through the original project transaction.

Store mutations take the expected project revision and stable operation ID. Repeated identical operations return their original receipt; changed payloads cannot reuse that identity. The caller refreshes a changed project before submitting its retained draft.

The browser disables intake and mutating controls while an operation awaits its result. Draft field values and selected file objects remain available when moving between its sections. All delivered source bytes and completed saves live in the private customer workspace.

## Original framework integration

The owned contribution is distribution/contributions/usgs-facility-events.json. It registers the maintained CLI, explicit exports and the same browser-assets.json read by the server and distribution collector.

The additive managed Applications helper is distribution/runtime-workspace/application-usgs-facilities.mjs. The workspace reader includes complete retained archive files in its existing transferFiles inventory, and the launch source inventory includes the original collection reader, validation and file modules plus the same browser hasher used by SF88. It joins the original catalog, source preparation and serialized startup observer. Its reader validates the original workspace identity, selected and actual launch source inventories, process ID, instance ID, private launch record and local URL. The original Applications resource and process ownership remain in use.

The generic Postman importer, seller, merchant runtime and buyer payment flow remain the existing implementations. This customer desk receives their original complete collections and GeoJSON responses and carries the facility operating work forward.
