# Public event integration contract

TJLabs · Digital Native Consultants public event-collection work · researched 13 October 2026

This contract connects a retained public event collection to an editable desk and reviewed exports. America250WA is the actual published customer example. Its installed WordPress version, The Events Calendar edition, active add-ons, licences, REST schema and import settings have not yet been received. Those are installation facts to observe during commissioning. The public calendar's visual controls cannot establish them.

## Operating contract

Each source snapshot has a stable source key, exact collection URL, retrieval time, stated selection/window and coverage. Keep literal received records alongside normalized values and the list of fields actually observed. Absence from a partial page is not a withdrawal. An explicitly complete snapshot permits a missing-row review only within that same source scope; it does not establish that the organizer cancelled an event.

The operator's working entry and the last received source baseline are separate. Compare incoming source, baseline and current working values. A schedule is an atomic field: accepting a changed date while silently retaining a previous time zone would invent a new interpretation. An explicit field choice records who selected it and why. Retain before/after values, source identity and scope so an ordinary monthly update is reproducible.

An export is a reviewable projection of selected entries at an exact working revision. Keep a complete JSON companion with all selected original records, current values, target choices, unmapped fields and per-entry issues. A CSV or calendar file is not a replacement for that archive. The adapter emits no network request.

## Target-specific identity

The documented CSV duplicate key is title plus start/end for timed events, or title plus start date and all-day flag. Changed titles or dates can create another event. The reference supplies no external-ID update key. Our adapter therefore records actual target identity and its last accepted values, and routes changed-key updates to explicit review. [TEC-CSV]

For a future authorized REST adapter, use the installed site's own `/wp-json/tribe/events/v1/doc` and original read responses. The published V1 event endpoint documents POST for creation/update and a path event ID; its edit argument builder requires the event ID and makes create fields optional. Obtain that exact installed route/method/schema before generating a write. Retain a request journal, original body, target binding and returned event. If the response is lost, reconcile the target first; the reviewed vendor contract does not supply our application with a guaranteed idempotency-key header. [TEC-REST, TEC-EDIT, TEC-UPDATE]

Current custom-table APIs distinguish a WordPress event post, an occurrence's provisional ID and a Series. A large occurrence ID cannot simply become the parent post ID. Vendor code offers occurrence ID normalization for server integrations. Store these identifiers distinctly if the source provides them; a matching title or URL slug does not establish the relationship. [TEC-ID, TEC-CT]

## Dates, zones and recurrence

Retain the exact source schedule text. Normalized dates use YYYY-MM-DD; timed values preserve their original local date/time, explicit offset when available and named zone. Named zones accommodate daylight-saving changes; fixed UTC offsets do not. The installed display mode may show each event's own zone or convert all events into the site's zone. Review both the stored event and the visible calendar when commissioning. [TEC-TIME]

For a portable iCalendar occurrence, use the stable workspace and entry identity as UID, UTC DTSTAMP, escaped text, CRLF lines and UTF-8-aware folding. DTEND is exclusive; an inclusive source all-day final date must advance one calendar day in that output. Preserve the original dates in the companion. Timed exports use UTC instants only after unique resolution. A local time in a daylight-saving gap or repeated hour requires the operator to supply a correct offset; guessing the host computer's zone is never a valid conversion. [ICAL]

A literal recurring label is retained as source information. The current CSV reference exposes no recurrence-rule column. That is insufficient to promise creation of a native recurring Series. The documented PHP custom-table API can create recurrence from an RRULE, but this is a different API with its own installation requirements. Keep source occurrences separate, or retain a true rule plus exceptions for a deliberately implemented supported recurrence adapter. Do not infer a rule by noticing similarly named rows. [TEC-CSV, TEC-CT]

## Venue, organizer, category and media mapping

Create or receive venues and organizers before events; CSV associations match existing names, with organizer post IDs also accepted. Association commas are parsed separately from CSV quoting. Our adapter therefore requires unambiguous mappings, and keeps original address/contact data in JSON. [TEC-CSV]

WordPress media is its own resource. The REST media schema supplies attachment identity, alternative text, caption, description and source URL; creation and later editing are separate operations. A referenced image URL is not itself a received attachment or a permission to republish it. Keep the original URL, caption, attribution and any known rights statement. A future uploader records the downloaded original hash, its returned target attachment ID and the event association. Reuse that actual target attachment rather than re-uploading every month. [WP-MEDIA]

The TEC event API's image argument accepts an attachment ID or URL, while its published prepare path delegates image intake to the vendor helper. That does not guarantee a remote URL will be accessible or keep the source's caption/alt metadata. The current export defaults to retaining image references in the complete JSON; an explicitly chosen, direct image URL may be mapped after the operator checks its intended use. [TEC-IMAGE]

## Authentication, licences and commissioning

WordPress's supported in-site cookie route also requires the REST nonce, and the authenticated account still needs the relevant capability. External integrations can use an application-specific password over HTTPS on supported WordPress installations. Keep credentials outside every source archive, export, screenshot and request log; retain only the account label and non-secret target binding. [WP-AUTH]

The vendor's July 2026 import guide confirms CSV import without an Event Aggregator purchase. Additional remote/calendar origins and scheduled imports require the appropriate Event Aggregator licence. That is separate from Events Calendar Pro functionality, the installed site's active licences and any custom theme work. Do not quote a new licence charge or claim it already exists before checking that installation. [TEC-LICENSE]

The proposed receiving sequence is one original monthly operation:

1. Receive and retain the actual public snapshot and its complete scope, then open the original event URLs used in normalization.
2. Import into the same named collection. Edit an event, receive a source successor, compare each conflict and keep an explicit mixture of local and source choices.
3. Retain an omitted row from a partial result; exercise a complete-scope absence as an explicit review. Preserve the source's own cancellation/status separately.
4. Choose a target, inspect date/time and association mappings, and review the export's included and omitted entry lists.
5. Open every emitted JSON/CSV/calendar file and check original identities, dates, UTF-8 content and issue explanations. A changed source or working revision requires a new projection.
6. Receive the complete archive into empty storage, then reopen the same source/current/history/target data and regenerate the same projection.
7. During separately authorized CMS commissioning, capture the actual installed route/schema/settings and existing target IDs, import a draft, read it back, view desktop/narrow calendar and event pages, and reconcile the accepted target identities into the existing collection.

These steps belong to the actual application course. The original public snapshot is the source input; deliberately changed successor records are labeled authored exercises and never presented as public updates.

## Primary references

All references below were retrieved through the ordinary web reader on 13 October 2026. URLs identify the maintained vendor or standards sources. Some original The Events Calendar knowledge-base links redirected to the vendor's Nexcess documentation. Statements about the public site remain separate from these generic platform contracts.

- **SITE:** https://america250wa.org/events/ — actual public collection; its rendered event count varies with retrieval/window and is not a promised complete import.
- **TEC-CSV:** https://docs.nexcess.com/software/the-events-calendar/import-events-csv/ — duplicate matching, supported columns, association order and preview/import controls.
- **TEC-REST:** https://docs.nexcess.com/software/the-events-calendar/event-tickets-rest-api/ — event base routes, public reads, installed documentation and creation examples.
- **TEC-EDIT:** https://docs.theeventscalendar.com/reference/classes/tribe__events__rest__v1__endpoints__single_event/edit_args/ — exact argument builder.
- **TEC-UPDATE:** https://docs.theeventscalendar.com/reference/classes/tribe__events__rest__v1__endpoints__single_event/get_documentation/ — published event route's POST response contract.
- **TEC-ID:** https://docs.nexcess.com/software/the-events-calendar/provisional-event-ids/ — occurrence identity and normalization.
- **TEC-CT:** https://docs.theeventscalendar.com/apis/custom-tables/events/ — event/occurrence/Series distinction and PHP recurrence API.
- **TEC-TIME:** https://docs.nexcess.com/software/the-events-calendar/calendar-timezone/ — named zones and display modes.
- **ICAL:** https://www.rfc-editor.org/rfc/rfc5545 — sections 3.1, 3.3.5, 3.3.11, 3.6.1 and 3.8; original iCalendar syntax and date semantics.
- **WP-MEDIA:** https://developer.wordpress.org/rest-api/reference/media/ — attachment resource schema and operations.
- **TEC-IMAGE:** https://docs.theeventscalendar.com/reference/classes/tribe__events__rest__v1__endpoints__single_event/ — event image argument and preparation.
- **WP-AUTH:** https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/ — cookie nonce, capabilities and application passwords.
- **TEC-LICENSE:** https://docs.nexcess.com/software/the-events-calendar/event-imports/ — free CSV and licensed additional origins/scheduling.
- **TEC-AUTHORITY:** https://docs.nexcess.com/software/the-events-calendar/imported-events/ — imported-event update authority and Ignored behavior. If the original site already uses an Aggregator job, preserve its configuration and reconcile our plan with it before adding a second importer.

## Current retrieval boundary

The ordinary reader returned an internal fetch error for the site's `/wp-json/tribe/events/v1/events?per_page=1`. This establishes only that this route did not yield JSON through that reader. It does not prove the site's API is absent, disabled, private or an unsupported version. The original source owner retains public HTML and is arranging the ordinary source receipt. No installed plugin/version/licence assertion is derived from this unsuccessful read.

## Delivered adapter interface

The adjacent `event_collection_exports.mjs` exports `createEventExportAdapter(model)`. Supply the maintained `createEventCollectionModel` instance; the adapter calls its actual validation, projection and full archive functions. It introduces no network, file-system or package dependency. Its pure calendar conversion uses the browser's standard Intl timezone data.

```javascript
const exporter = createEventExportAdapter(model);
const prepared = exporter.buildExport(workspace, {
  format: 'event-csv', // portable-json, event-csv, ical or tec-csv
  entryIds: workspace.entries.map(entry => entry.id),
  generatedAt: new Date().toISOString(),
  target: workspace.target,
});
```

Every result lists selected, exported and omitted IDs, per-entry issues, original source descriptors, exact working revision/seal and the complete original model archive. Its files are named `event-collection-complete.json`, plus `selected-events-review.csv`, `selected-events.ics` or `selected-events-tec.csv` as selected. The complete JSON can be read to obtain its `archive`; the application's original `openArchive(JSON.stringify(archive))` then receives it without translation.

For review CSV, target.mapping maps actual normalized field names to distinct visible column headings. Structured schedules, venues, organizers and media remain complete JSON values inside correctly quoted cells. Formula-like scalar text and headings receive a leading apostrophe in this spreadsheet review file, with a per-cell notice; the complete JSON preserves the exact original literal. The TEC import CSV retains exact selected content and should be inspected in the desk or a text viewer rather than edited as a spreadsheet. Identity and original URL columns are always present. This is the editorial review format, distinct from the vendor's CMS import format.

For TEC CSV, use the exported `TEC_FIELD_MAPPING` as the starting target mapping. It names supported event columns; title and the date/time group are required. Null explicitly omits an optional field and its CSV column. A blank column is not an omission. Selected but unresolved association mappings leave the entry for review; explicit empty association arrays clear them. The per-entry clear_fields list can explicitly clear a selected summary, website or other supported optional field. The target includes adapter `tec-csv`, a stable id, name, timezone_policy `preserve` or `override`, an optional explicit timezone and entry_mappings keyed by actual entry IDs. Each entry mapping can select one exact existing venue name, organizer names or positive post IDs, category names, an image_url, a selected-occurrence recurrence mode, and an actual target_event_id plus last_accepted_identity.

When an event already has a named zone, that source zone continues to interpret its local clock. A target override converts the display fields into the chosen target zone. When the source has no zone, the operator's explicit target choice supplies an interpretation and is identified in the result. Every original schedule remains available alongside that choice. Invalid dates, unresolved ends, nonexistent or ambiguous local times, indistinguishable selected CSV duplicate keys, and changed accepted target keys produce concrete per-entry issues. The adapter retains those entries in JSON instead of silently changing their meaning.

The adjacent `receive_event_collection_model.mjs` is the complete authored model receiving course over the supplied original public cohort. It exercises original import/replay, partial-field provenance, local/source conflict, complete-scope absence selection, immutable editions, exact archive reopening, calendar UID and daylight-saving semantics, and mapped target-update review. Its deliberate successor titles and calendar dates are labeled authored receiving inputs. The original cohort remains in every full archive. The application's same browser course adds actual controls, downloads, two-tab recovery and desktop/narrow viewing.
