# Import original sites and visits into an implementation plan

Use **Sites & monitoring → Import sites / visits CSV**, or the same control in **Field records**, to bring an original station inventory, visit schedule, recorded visit table, or a paired sites-and-visits batch into the existing plan. The same reviewed flow is available in the native application and the self-contained field workbench.

A batch can contain one sites CSV, one visits CSV, or both. Sites are resolved first so visits can refer to their accepted original station identifiers. No samples, laboratory results, campaign assignments, coordinate transformations or actual collection times are invented. Existing single-record forms remain the ordinary editors after import.

## Choose and map the original files

1. Open the intended implementation plan. In the native application, save its original revision first. An unsaved browser draft stays separate while the native importer reviews that saved revision.
2. Choose **Import sites / visits CSV**, then **Choose sites CSV** and/or **Choose visits CSV**. Each file is retained unchanged. The dialog shows its original name, byte count, SHA-256, headers and a labeled source sample.
3. Choose the actual delimiter and encoding. Supported encodings are UTF-8 with an optional BOM, UTF-8, UTF-16 with its BOM, Windows-1252 and Latin-1. Changing the delimiter or encoding reads the same retained original bytes again.
4. Map each plan field to its actual source header or an explicit constant. **Map matching native field names** is an explicit convenience when the original headers already match the plan fields; the dialog does not silently infer columns.
5. Use the advanced mapping JSON for documented source aliases, ordered fallback headers, explicit blank constants and reusable mappings. **Download mapping**, **Open mapping JSON**, **Download all mappings** and **Open batch mappings** preserve the complete conventions and row choices.

A field uses one original column or one explicit constant. A fallback is a selected sequence of different actual headers for a blank primary source cell; it is not fabricated text. A native ID cannot come from a constant. Use the original ID column, an explicit derived-ID mode, or a reasoned per-record override.

### Site fields

| Plan field | Source meaning |
|---|---|
| id | Exact original/native station identifier, or input to the explicitly selected derived-ID mode |
| label | Original site name or explicitly entered label |
| candidate_id | Exact existing candidate ID, when the source actually declares that relationship |
| source_ref | Exact existing source-link ID; a new site otherwise refers to its original CSV |
| latitude, longitude | Paired original degree values, admitted only under the declared coordinate mode |
| coordinate_reference_system | Explicit original geographic datum/CRS |
| notes | Original notes or an explicit constant |

### Visit fields

| Plan field | Source meaning |
|---|---|
| id | Original/native visit identifier, or a declared derived-ID mode |
| site_id | Exact native site ID or exact original source station ID |
| monitoring_plan_id | Exact existing monitoring campaign ID, when actually declared |
| planned_date | Calendar date under the selected original date convention |
| visited_at | Actual ISO date/time with a recorded offset, or a full ISO clock combined with an explicitly selected offset |
| visited_date, visited_time, utc_offset | Separate actual source date, clock and fixed offset |
| observer | Original observer or explicitly supplied assignment |
| status | Explicit planned, complete or cancelled value, or a selected source-label alias |
| notes | Original visit context |

Choose either the full actual timestamp or separate date/time fields. Supplying both is a conflict. A separately supplied offset must agree with an offset already present in the full timestamp.

## Record identity and relationships

**Original native IDs** retain the exact source text. Native IDs are 1–96 letters, digits, underscores or hyphens, beginning with a letter or digit. Identifiers are not trimmed or matched by label.

**Stable IDs from original identifiers** requires a declared source namespace. Each ID derives from the table kind, that exact namespace and the exact original identifier. This supports inventories whose identifiers contain punctuation that native IDs cannot contain; the original identifier remains in the retained row context.

**IDs from this exact source row** also requires a namespace and is useful when an original visit schedule has no ID column. IDs derive from the table kind, namespace, original CSV SHA-256 and one-based data-record number. They identify that exact retained source edition; editing the file may create different IDs.

For a visits-only batch, **Exact original source site IDs** can resolve a station identifier already retained in a site's original source context. It can also resolve sites accepted in the same paired batch. If multiple actual sites retain that same identifier, the importer does not infer a namespace or choose one: select an explicit native site ID with a reason. Label matching is never used.

The complete plan validator also checks candidate/source/campaign links, campaign membership and visit/activity consistency. A proposed site reassignment that would disagree with retained sample activities must be reviewed rather than silently accepted.

## Coordinates and calendars

The default coordinate choice is **Retain original cells only**. This preserves the source coordinate cells and their original datum text. It leaves a new site's native coordinates absent and an existing site's coordinates unchanged.

Use **Declared geographic coordinates** only for paired source latitude/longitude in the explicitly declared EPSG:4326, EPSG:4269, EPSG:4267 or EPSG:4258 system. Documented labels such as NAD83 can be mapped explicitly to their actual CRS. A numeric latitude/longitude range does not establish the datum. No reprojection or datum transformation occurs.

The ordinary site editor now displays the declared CRS beside the original coordinates. New manual sites show an explicit WGS84 selection. An existing untagged site's datum remains unstated; opening it does not relabel it as WGS84. Changing coordinate numbers requires an explicit geographic declaration, and retained declared coordinates cannot silently lose that declaration.

Choose ISO, month/day/year or day/month/year for calendar dates. Actual timestamps require a source clock and explicit recorded offset. An offset alias means a fixed offset supplied by the source; it is not a daylight-saving rule.

Partial actual date/time context stays in the original CSV and audit with a warning. If actual-time fields are mapped but incomplete, a proposed old timestamp is cleared instead of borrowing an earlier time. A complete visit then fails validation until an actual timestamp is supplied. Entirely unmapped actual-time fields preserve an existing timestamp. A planned date never becomes an observed time.

## Review the entire batch

Select **Preview complete batch**. The native preview binds the saved revision, both original upload bodies and all selected mappings. The portable preview binds the complete original draft and both original byte sequences.

The review shows counts for append, replace, identical, skip and error for each table. Search and decision filters change only the displayed records; they do not limit the batch that is applied. Pagination covers all matching decisions, and **Download complete batch review** includes every decision and issue.

Use **Review row** to inspect the original record, physical line span, selected source fields and proposed native definition. Choose:

- **Import with explicit overrides** for a deliberate new native ID or an exact site binding.
- **Skip this original row** to retain it in the source and audit without applying it.
- **Replace an existing record** to select the exact saved target ID.

Record a reason for these decisions. A replacement keeps existing unknown metadata and unmapped optional fields. An explicitly mapped blank can clear a permitted optional field. Existing equal native content is classified as identical and keeps its original source binding.

Repeated identical rows in the same CSV are reported as identical with a warning; both original records remain audited. Different rows assigning different content to the same ID are errors, even if their order would otherwise suggest a last-row overwrite. Resolve them explicitly by skipping or assigning a deliberate different ID.

After changing a row decision, select **Preview complete batch** again. Every required error and whole-plan relationship conflict must be resolved before applying.

## Save natively or update the portable draft

### Native application

**Save reviewed batch as one native revision** sends one original queued operation. The server uses the exact saved revision, upload tickets, mapping and preview operation ID. Both original CSVs, their complete decision audit, source links, import history and accepted rows commit together.

The dialog retains the original action, payload and operation ID before submission. If a response is uncertain, **Recover original request** resends that exact request. An accepted task is polled by its original ID; an interrupted task can be resumed through **Resume original task**. Failed or cancelled requests can be downloaded and retained before beginning a new review. No unknown response is treated as success.

A completed receipt identifies the originally applied revision and the current latest revision. **Refresh receipt downloads** obtains current tickets from that original completed task. **Open latest saved plan** reads the latest native plan and preserves any prior browser draft separately; it does not install an older receipt's plan over later edits.

### Portable workbench

**Apply reviewed batch to portable draft** rechecks the exact full draft, mappings and original CSV bytes, validates the complete result, and retains both source files plus the complete audit through the existing original-file vault. Only then does it replace the portable draft once.

The portable operation is explicitly labeled as a draft operation. It does not create or increment a native revision. Keep editing through the existing site, monitoring and field-record forms, then use **Handover → Export plan + files ZIP** to carry the full plan, CSVs and audit. A plan-only JSON contains the source references but does not carry the original file bodies.

Returning that complete package uses the existing native evidence import and save. If its original native revision is stale, **Review returned field package** retains and reconciles it with the actual saved base and latest plan. This CSV importer does not replace that three-way return review.

## Original source retention

Each imported or replaced row retains its exact original identifier, header choices, original parsed row, physical line span, CSV hash, mapping hash and source link. The audit retains the complete original row set, including skipped rows. The unchanged original files remain authoritative.

The plan's append-only site/visit import history names its original CSV source links and audit. The normal source-removal guard now recognizes this history and its source_link_ids array as well as existing laboratory history, custody references and attachments. Remove an association explicitly before removing a still-referenced source.

The existing evidence limits apply: each CSV or audit must fit the 64 MiB original-file limit, the complete plan must fit 16 MiB, and the package must fit 128 MiB of unique retained original members and the existing file-count bound. Shared byte aliases are retained under the existing evidence rules.

## Application integration

The native model is model/implementation_site_visit_intake.py. The original operator exposes inspect and preview reads plus the queued implementation.site-visit.import action. Browser requests contain upload tickets and saved revision/digest bindings; they do not provide arbitrary server paths or a replacement native plan document.

The browser model implementation_site_visit_csv.mjs provides the portable parser, normalized mapping, whole-batch preview and atomic vault/draft apply. implementation_site_visit.mjs is the existing workbench dialog. The maintained offline builder embeds both modules, so the complete local workflow has no network dependency.

Coordinate/date conventions and native source rules are documented in [IMPLEMENTATION_SITE_VISIT_SOURCE.md](IMPLEMENTATION_SITE_VISIT_SOURCE.md). The crew/day deployment and monitoring campaign workflows continue to consume the actual saved sites and visits; their producers are unchanged.
