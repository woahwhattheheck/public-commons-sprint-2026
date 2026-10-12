# Municipal Field Desk: source and operating contract

This contract describes the implemented Field Desk under `open311/field-desk/`. It connects an approved municipal request/work-order dispatch to crew planning, field returns, supervisor decisions and an editable receiving workspace. The complete original dispatch remains attached to each field action.

Implementation basis: the complete twelve-file core in [source capsule 5c89942e12571e28995e0c6633e413bc95abc4fc](https://api.github.com/repos/woahwhattheheck/public-commons-sprint-2026/git/blobs/5c89942e12571e28995e0c6633e413bc95abc4fc), 126,098 UTF-8 bytes, SHA-256 `6f68e432c38e275af87babf9e071920bb515c2c9e43aaa007384c211af3700c6`. The complete typed interface is `index.d.mts`, Git blob `05779d33797c2ba84484a367bb12abb27721ced0`. Source intake uses `source.mjs` at `8ff71aeb982a979eaedb4377381e772077faed2c`; durable receiving uses `workspace.mjs` at `24e0b9a58f36d8faf4bc033fddb7dd2779b2a20b`.

## 1. Customer workflow and primary sources

The following published workflows motivate the product. Their product descriptions establish operating needs; the corresponding Field Desk behavior is the implementation described in the remaining sections.

| Primary source | Published operating need | Implemented Field Desk behavior |
| --- | --- | --- |
| [Connected Bits: Spot Workers, integration layer and partners](https://connectedbits.com/) | Assign field tasks, record status, photographs and completion notes, supervise queues and connect CRM, GIS, assets and work orders. | Versioned crews and visits; a portable crew editor; exact attachment files; returned field changes; supervisor review; source-linked destination packages. |
| [Catalis Request311](https://catalisgov.com/public-works/request311/) | Reassign, update and close requests while retaining history and integration context. | Field visits retain the approved request/order source binding, original history and local action history through export and receiving. |
| [Catalis: Public Works Efficiency with Citizen Request Management](https://catalisgov.com/request311/public-works-efficiency-with-citizen-request-management/) | Mobile crews need request information and equipment/material context during field work. | Issued packages contain selected visits, their original source rows, crew details and files. Returns include exact labor, material, equipment and other resource entries. |
| [Catalis: Inventory Tracking & Work Order Management](https://catalisgov.com/inventory-tracking-work-order-management/) | Schedule and assign maintenance work with resource and mapped-asset context. | Crew assignment, planned and actual times, due time, priority, instructions, resource quantities and costs, with original mapped source context. |
| [Catalis GIS WebMap](https://catalisgov.com/public-works/geographic-information-system/) | Field work depends on municipal asset and geographic information. | Original effective source geometry travels with the approved dispatch and destination export. The implemented field form edits the field record defined below. |

These are primary sources read for this implementation on 12 October 2026. The citizen-request management article is dated 12 November 2025. `SOURCE_REGISTER.json` preserves the original source URLs, observed sections and the source pins for the preceding Follow-through product.

The proposed adoption work is to configure this operating handoff for an agency's supported systems and actual source files. An implementation profile must identify the agency, service groups, crews, destination system, source meaning and acceptance workflow.

## 2. Original dispatch intake

The importer accepts either complete sealed `commons.open311.follow-through-dispatch.v1` JSON or a complete sealed `commons.open311.follow-through-workspace.v1` JSON export. A workspace may contain several dispatches. `inspectSource` reports all available dispatches and whether a selection is required; `importSource` records the selected dispatch ID with the complete original input text.

A saved `commons.open311.field-source.v1` retains the complete original file, its UTF-8 byte count and SHA-256, the selected original dispatch, source series, edition ID and seal, and any originating workspace UUID and revision. Source rows preserve:

- The complete normalized request, its original values and source SHA-256.
- The complete explicitly approved associated orders, each with its own identity and source SHA-256.
- The saved approved local work and its original approval context.
- The original effective geometry and destination-column mapping.
- The dispatch definition, coverage and totals.

The intake validates the original seals and selected source versions. Approved work carried forward from an earlier edition remains valid when its original request and order versions still match the selected dispatch. This preserves an existing approval across an unchanged source edition.

Request identity, order identity, approved work identity and field visit identity are distinct. An approved row can contain zero associated orders. A missing or unavailable published order source remains part of the original source context.

A visit's `SourceBinding` includes source ID/hash, series, dispatch ID/hash, edition ID/hash, source key, request ID/hash, approved work ID/hash, every linked order key/ID/hash and the complete selected row hash. The original source status remains available as source data throughout field work.

## 3. Crews, visits and time

A crew is a versioned roster with `name`, `members`, `note` and `active`. A member has `id`, `name`, `role` and `contact`. Saving a crew records its prior version. New assignments select an active crew; an existing assignment can retain its historical inactive crew.

A visit selects one imported source row and an optional crew. Its planning fields are `title`, `plannedStart`, `plannedEnd`, `dueAt`, `priority` and `instructions`. Priority is exactly `low`, `normal`, `high` or `urgent`. Saved visits retain crew identity/version/name, source binding, prior visit version, creation time and the cause of the saved change.

Planning and actual time inputs require an explicit time-zone offset. An end time cannot precede its corresponding start. Original source date-only values remain in the original source object; an agency chooses any additional interpretation in its source configuration.

The editable field record has the following exact vocabulary:

| Field | Accepted content |
| --- | --- |
| `status` | `planned`, `assigned`, `in_progress`, `completed`, `unable`, `cancelled` |
| `actualStart`, `actualEnd` | Offset-bearing timestamp or null |
| `completionNote` | Text |
| `notes` | Entries with stable `id`, `author`, `text`, `recordedAt` |
| `resources` | Entries described in section 4 |
| `attachmentIds` | IDs of retained exact attachment files |

The current crew/visit model uses this roster, assignment and field-record vocabulary. Geographic context comes from the original approved source row. Visit filtering supports source, crew, local field status and text, with paginated results.

Saving a visit creates a new version. A visit can explicitly select a successor dispatch for the same original series, source key and request identity. Its history then records the new source binding.

## 4. Exact resource entries and attachments

Each resource entry has stable `id`, `kind`, `name`, `quantity`, `unit`, optional `unitCost`, optional `currency`, and `note`. Kind is exactly `labor`, `material`, `equipment` or `other`.

Quantity and any unit cost are nonnegative decimal strings with at most 18 whole digits and 9 fractional digits. Examples are `"2"`, `"0.75"` and `"18.500"`. The implementation calculates sums and products using exact integer/scale arithmetic. A unit cost requires an uppercase three-letter currency code. Quantities are grouped by kind, name and unit; money totals remain grouped by currency. Original source work-order costs remain in their source records alongside these newly entered field resources.

`putAttachment` accepts filename, content type and complete base64 file content. Stored identity is based on the SHA-256 of the decoded bytes. Byte count, content hash, exact bytes and original descriptors are retained. Reusing identical bytes preserves additional filename/content-type descriptors as aliases. A visit refers to stored files by attachment ID.

An original request photograph can be imported as source-context material, with its original URL and request identity recorded in the accompanying source or note. Its evidential meaning follows its actual origin. A crew note and returned file describe a field observation only when that is what their original content records.

The complete issued and receiving packages carry referenced files. Binary input through the merchant host records its original alias, hash and content type before entering the same attachment operation.

## 5. Issuing a portable crew package

`createPackage` freezes a named, nonempty selection of saved visits. A `commons.open311.field-crew-package.v1` contains:

- Package ID, producer workspace UUID and revision, creation time, name and note.
- Each exact visit baseline, its source summary and complete original dispatch row.
- The selected crew details and all referenced attachment content.
- The package SHA-256 seal.

Export `crew-json` carries the full structured package. Export `crew-html` carries the portable editor for that package. Both preserve the same package ID, seal and original visit version IDs.

The crew receives the original request/order context, assignment and field inputs together. A later return identifies the package it used, so the supervisor can compare the actual issued baseline with subsequent office edits.

## 6. Receiving field work and reconciling changes

The complete return input has schema `commons.open311.field-return.v1`, original `packageId` and `packageSha256`, name, returned-by identity, optional note, a visit array and optional complete new attachments.

Each included visit names `visitId`, its issued `baseVersionId` and a partial `fields` object from the exact field-record vocabulary in section 3. A return can cover part of the issued package. Omitted visits and omitted field keys remain unchanged. An included list field supplies the intended list against its package baseline; stable entry IDs allow additions, edits and deletions to be compared individually.

`importReturn` retains the complete original text, original-file byte/hash identity, package reference, supplied attachments and generated proposals. The original package baseline, current saved visit and returned values remain available together.

The comparison works at the following granularity:

| Field type | Comparison |
| --- | --- |
| Status, actual times, completion note | Original, current and returned scalar value |
| Notes and resources | Stable entry ID, including additions and deletions |
| Attachments | Membership of each attachment ID |

A conflicting change means that the current value differs from both the issued baseline and returned value. Each conflict requires an explicit `current` or `returned` choice. Source-context and assignment changes are shown separately from field-value conflicts.

A supervisor applies decisions using the pending proposal ID and expected current visit version. Each proposal is accepted or rejected, with reviewer and note. Accepted work with changed source or assignment context requires the corresponding explicit acknowledgment. A decision records its full selected changes, choices, original baseline, observed current version and result.

Accepting a return creates a new visit version when its field data changes and records supervisor approval of the resulting exact visit/source context. Rejecting a proposal retains the current visit and its recorded rejection. Partial decisions leave the remaining proposals pending.

## 7. Supervisor approval and destination actions

`reviewVisits` supports `approve` and `return_to_crew` for explicitly selected current visit versions. A direct approval with changed source context requires the visit to select its intended current source; the return-decision path also supports an explicit source-change acknowledgment. Every approval is tied to the exact visit version and source context it reviewed.

`createUpdate` selects current approved visits, names a destination `name` and `system`, and optionally records the destination's reference. Per-visit actions are exactly `update` and `request_closure`. A closure request additionally requires local field status `completed`.

The sealed `commons.open311.field-destination-update.v1` contains each full visit, original source row, source binding, original dispatch definition, crew, supervisor approval and referenced files, together with resource totals and action counts. It carries both the intended local destination action and the original external source values.

This operation produces a reviewed destination handoff. The external municipal request/work-order system remains the authority for its own recorded state. Installation work configures how the agency receives this package through its supported integration or operator process.

Exports are complete JSON, CSV, GeoJSON and an HTML report. CSV uses the maintained reversible spreadsheet-formula escaping. Geographic exports use the original effective source geometry. Unlocated and exceptional source values remain available in the complete JSON/source records.

## 8. Durable workspace and independent receiving

The SQLite workspace saves complete source records, every crew and visit version, attachment bytes and aliases, issued packages, complete returns, decisions, supervisor reviews, destination updates and successful operation history.

Each write requires a caller's stable `requestId` and observed `expectedRevision`. Reusing a request ID returns its original result only when the operation and input identity match. A conflicting revision or different action under the same request ID produces a conflict.

The complete export has schema `commons.open311.field-desk-workspace.v1`. It includes producer UUID/revision, original creation and update times, records, full operation inputs/results, receiving history and its seal. An unchanged workspace uses its saved update time for deterministic export identity. The complete portable package limit is 256 MiB.

Independent receiving opens a new empty Field Desk workspace at revision zero. `receive` validates the complete original package and replays its operation history to check records and results. It then imports the original history, preserves the producer workspace UUID and records a new receiving operation and receipt. The receipt includes the destination's original UUID, origin UUID/revision, complete original-file byte/hash identity and package seal. The received workspace advances to the original revision plus one and remains editable.

A receiving request ID must be distinct from the imported operation history. An exact repeat of that receiving request returns its saved result. Subsequent work continues with the received workspace's observed revision.

## 9. Interfaces and complete exports

The shared core exposes source inspection/import, crew and visit management, attachment import, package creation, return import, decisions, supervisor review, destination updates, complete export and receiving. Read operations provide state, individual original operations, full objects and paginated source rows/visits.

The HTTP and CLI interfaces use the same workspace operations. The typed merchant integration uses the original file transport for JSON source, return and workspace inputs, and binary attachment inputs. A retained host input descriptor identifies alias, original SHA-256, kind, format and optional content type. Revision-aware reads and writes let the installed application continue the same saved operation.

| Export kind | Complete intended content |
| --- | --- |
| `workspace` | Editable workspace and full original history |
| `source` | Exact imported source text |
| `crew-json`, `crew-html` | Issued package or its portable editor |
| `returned` | Exact imported return text |
| `visits-csv` | Selected visit rows |
| `update-json` | Complete approved destination package |
| `update-csv`, `update-geojson`, `update-report` | Destination table, geographic view and readable report |

## 10. Agency implementation and original-source interpretation

A deployment agrees its source fields, service groups, crew roster, dates, resource units/currencies, destination references and supervisor responsibilities. The source profile records the actual provider's ID, date, status and coordinate semantics.

For the existing municipal source editions, request and order identifiers remain distinct. Manatee's request-only edition retains its actual work-order retrieval errors and original geometry/declared CRS. Omaha's original request and order records retain their explicit relationship decisions, literal source date strings and source-generated object-ID behavior. Public request attachments retain their actual report origin. These are configuration and source-context facts for the agency handoff.

The acceptance journey follows the product's complete operating path: import the original approved dispatch, assign saved visits, issue a portable package, receive partial field work, decide actual changes, approve selected current visits, prepare a destination update, export the editable workspace, receive it into a new workspace and continue from its recorded revision.

Actual source captures, operating outputs and implementation profiles establish the particular deployment's result. This contract defines the implemented data and action semantics that those deployments use.
