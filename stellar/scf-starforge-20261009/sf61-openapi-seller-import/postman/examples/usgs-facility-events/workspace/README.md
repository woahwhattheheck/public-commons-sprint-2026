# Facility operations desk

This is the complete customer workspace for the original USGS facility-event reporter. It turns a retained response into ongoing site work: a facility roster, immutable report editions, assigned reviews, customer reports and a complete receiving copy.

The installed command is **usgs-facility-events**. The installed Applications catalog presents **Facility operations**. Both open the same private workspace and use the maintained application process lifecycle. The server and CLI require **Node.js 24 or later** and use its built-in SQLite module.

## Open the workspace

From an installed merchant distribution:

    starforge usgs-facility-events --workspace /private/facility-desk

From this repository:

    node stellar/scf-starforge-20261009/sf61-openapi-seller-import/postman/examples/usgs-facility-events/workspace/cli.mjs \
      --workspace /private/facility-desk

Open the complete local URL printed by the launcher. The private server listens on 127.0.0.1. Its workspace token stays in the local URL fragment and authenticated requests. Closing the process drains source captures and current transfers before releasing the original database writer.

The workspace contains a stable workspace identity, a SQLite customer database and a private launch record. It can hold several separately named customer projects. Open an existing project to resume its saved state. The original SQLite writer lease and installed Applications resource lease prevent two processes from writing the same directory concurrently.

## Complete the operating workflow

1. **Create a customer project.** Enter the organisation, preparing operator, handover contact and operating procedure.
2. **Save a facility roster.** Each site has a stable ID, name, latitude, longitude, radius in kilometres, minimum magnitude, responsible contact and site procedure. A roster edition retains all these values. Opening an older roster creates an editable draft for a new edition.
3. **Receive or capture event sources.** Retain the original GeoJSON files supplied by the existing buyer workflow, or choose a public USGS feed or fixed catalog window. Original response bytes, URLs, headers, query selections and count observations stay with their source edition.
4. **Prepare a report edition.** Select one saved roster and 1–16 explicit response editions. Record the preparing operator and the reason for the source selection. The original report engine performs the calculation and retains its full result.
5. **Work the operating queue.** Assign a site/event pair, investigate it, record its action and close it through the site procedure. Every saved review records its operator, assignee, due time, action, rationale and exact source edition.
6. **Deliver and receive.** Open the printable customer handover, download the full reports and operating CSVs, and export the complete workspace. The receiving operator opens that one portable file and continues from the original source history.

The queue keeps previously observed work even when a later feed window or a narrower report no longer contains the event. An event or facility change returns the item to **needs review**, with the earlier action still available in its attributed history. A review can carry across editions when the actual facility and event values are unchanged. Its original review edition remains visible.

The USGS event-review status and the customer's operating status are separate fields. The customer's review actions are assigned, investigating, action recorded and closed. A completed action or closed review requires a recorded action.

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
- current operating decisions, assignees, actions, rationale and due times;
- site procedures and source selection observations;
- outstanding work from older retained editions;
- the attributed review history of the included operating work.

The operating CSV contains both the current edition and the original review edition and fingerprints. Spreadsheet-facing text is escaped before CSV delivery. Use the complete JSON/NDJSON handover to carry the full original data structures and byte identities.

## Receive a complete workspace

**Export complete workspace** produces a newline-delimited JSON transfer with one header, deduplicated original source bodies, all immutable saved items, capture observations, operation receipts and a final byte/hash manifest.

Receiving checks every original source digest, recomputes every report through the original engine and checks each review against its saved facility/event values. It then commits a new customer project atomically. The received project retains the original header, project identity, revision, receipts and transfer hash.

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

## Reusable application interfaces

The installed distribution contribution exposes:

| Export | Maintained interface |
| --- | --- |
| ./customer/facility-operations | Source/roster validation, native report editions, review binding, comparisons, CSV and customer HTML rendering. |
| ./customer/facility-operations/store | openFacilityStore, immutable entries, transactional edits, source bodies and complete streaming transfer. |
| ./customer/facility-operations/captures | SourceCaptures with the retained public USGS capture and resume lifecycle. |

Store mutations take the expected project revision and stable operation ID. Repeated identical operations return their original receipt; changed payloads cannot reuse that identity. The caller refreshes a changed project before submitting its retained draft.

The browser disables intake and mutating controls while an operation awaits its result. Draft field values and selected file objects remain available when moving between its sections. All delivered source bytes and completed saves live in the private customer workspace.

## Original framework integration

The owned contribution is distribution/contributions/usgs-facility-events.json. It registers the maintained CLI, explicit exports and the same browser-assets.json read by the server and distribution collector.

The additive managed Applications helper is distribution/runtime-workspace/application-usgs-facilities.mjs. It joins the original catalog, source preparation and serialized startup observer. Its reader validates the original workspace identity, selected and actual launch source inventories, process ID, instance ID, private launch record and local URL. The original Applications resource and process ownership remain in use.

The generic Postman importer, seller, merchant runtime and buyer payment flow remain the existing implementations. This customer desk receives their original GeoJSON response and carries the facility operating work forward.
