# Original site and visit CSV intake: source and native API

This operation imports one original site/station CSV, one original visit CSV, or both into one saved field-plan revision. A combined batch resolves visits against the accepted new or existing sites before it writes anything. Existing campaign membership and visit/activity relationships are validated by the maintained field-plan schema.

## Source and mapping

Each native input is an object with kind ("sites" or "visits"), path (the server-resolved upload ticket), filename (the original upload name), and mapping. The provider accepts original upload IDs and saved native plan identities; filesystem paths and incoming plan bodies do not come from a browser request. There is at most one CSV for each kind. The native operation processes sites first regardless of input array order.

The mapping schema is upstate.implementation-site-visit-mapping/v1:

| Mapping key | Meaning |
| --- | --- |
| columns | Native field to an exact original CSV header. |
| constants | Explicit original text for a supported field other than id. |
| fallback_columns | Ordered alternative original headers after a mapped primary header. The first nonblank original value is used, and the selected header is retained. |
| delimiter, encoding | The exact CSV parser selection; defaults comma and utf-8-sig. The maintained parser also supports utf-8, cp1252 and latin-1. |
| decimal_separator | Dot or comma, selected explicitly. Thousands separators are not inferred. |
| id_mode | native, stable or source_record. |
| namespace | Required for stable and source_record IDs. |
| coordinate_mode | geographic or retain_only; default retain_only. |
| crs_values | Explicit original text to supported geographic EPSG code aliases. |
| date_format | iso (YYYY-MM-DD), mdy (M/D/YYYY), or dmy (D/M/YYYY), applied to date-only input columns. |
| time_zone_values | Explicit original zone labels to Z or fixed +/-HH:MM offsets. This is a source interpretation, not a daylight-saving lookup. |
| status_values | Explicit original status labels to planned, complete or cancelled. |
| site_binding | native_id or source_id; source_id resolves exact original identifiers retained by saved sites or accepted site rows in this batch. |
| row_actions | Decisions keyed by one-based original nonblank data-record number, excluding the header. Physical CSV line spans are separately retained. |

Site target fields are id, label, candidate_id, source_ref, latitude, longitude, coordinate_reference_system and notes. Visit target fields are id, site_id, monitoring_plan_id, planned_date, visited_at, visited_date, visited_time, utc_offset, observer, status and notes.

Constants cannot replace the original ID column. A deliberate native ID override is a row decision, with its reason. This prevents every row accidentally receiving one constant ID.

Row actions have action (import, skip or replace), reason and optional id, target_id and site_id. Explicit replacement requires the actual saved target_id in the same collection. Skip, replacement and any override require a nonblank reason. site_id is only a visit decision and selects an actual existing or accepted batch site. The supplied original source ID is retained even if a reviewed override selects a different native ID.

## Identifier semantics

Native IDs obey the existing field-plan identifier grammar. Invalid external station IDs are not silently cleaned or matched by label.

Stable IDs use the first 24 hexadecimal characters of SHA256 over the canonical compact UTF-8 JSON array [kind, namespace, exact_original_identifier], prefixed by site_ or visit_. The original identifier and namespace remain in each row's source metadata.

Source-record IDs use [kind, namespace, source_csv_sha256, one_based_record_number] with the same prefix and digest length. This explicit option admits original visit schedules that contain no visit-ID column. It is an identity for the exact source edition and record; a changed file may produce new IDs. The preview exposes every generated native ID.

Visits using source_id binding resolve the exact original site identifier from saved sites' original_source.original_identifier and accepted site rows in the current batch. This supports visit-only follow-up files. An exact identifier that names multiple native sites remains ambiguous, including identifiers reused by different declared namespaces; the importer does not infer a namespace from a visit identifier. Ambiguous or unavailable bindings require an explicit native site decision. Existing saved sites can also be selected directly using native_id. Campaign membership is checked after the complete batch is assembled; the intake never silently adds a site to a campaign.

## Coordinates and datum

Geographic mode accepts paired decimal latitude/longitude with an explicitly selected EPSG:4326, EPSG:4269, EPSG:4267 or EPSG:4258 declaration, or an explicit alias to one of those declarations. The selected CRS is stored as site.coordinate_reference_system. The original degree values remain in latitude/longitude; they are not transformed or relabeled as WGS84.

The original CSV text is retained as original_source.original_latitude, original_longitude and original_coordinate_reference_system, alongside the full original row and the selected headers. A source value of zero remains a numeric zero. Both native coordinates may be absent; one missing coordinate is an error. A mapped blank pair clears that pair on explicit replacement. A CRS declaration cannot be changed independently of its mapped coordinate pair.

Retain-only mode keeps original coordinate text and source records. It leaves existing native coordinates unchanged and gives new sites null coordinates. It is useful for source coordinates whose projection or geographic datum has not been selected for native use. Neither projected coordinates nor an unstated datum are inferred from numeric ranges.

Downstream GeoJSON producers must use the declared native datum and an actual transformation to WGS84 when necessary. The intake does not describe NAD83 or NAD27 degrees as WGS84 output.

## Planned and actual time

Planned dates are date-only values parsed with the selected format. They are not actual observation timestamps.

Actual visited_at may come from one full ISO date/time with its recorded offset, or from separate original visited_date, visited_time and an explicit utc_offset. A naive full ISO date/time can be paired with an explicitly supplied offset. Conflicting full and split date/time mappings are rejected. A supplied offset must agree with an offset already embedded in a full timestamp.

Incomplete actual date/time context is retained in the source row with a warning and no inferred visited_at. An explicitly mapped partial timestamp clears the proposed native visited_at rather than borrowing part of an older timestamp. A completed visit then requires a valid actual timestamp. If none of the actual-time fields are mapped during replacement, the saved timestamp remains unchanged. The operation never invents midnight, an observer, a completion claim or a daylight-saving interpretation.

## Duplicates and replacement

The preview contains every original data record and its selected columns, native ID, proposed row, decision and issues. Its statuses are append, replace, identical, skip and error.

An existing native ID with matching supplied content is identical and keeps its saved source binding. The newly supplied original row remains in the new source audit. Different content requires an explicit replacement target and reason.

Identical repeated rows within one batch are retained in the audit and marked identical with a warning. Divergent rows assigning the same native ID are errors. There is no last-row-wins rule.

Replacement begins with the complete saved row. Unmapped optional fields and unknown metadata survive. Explicitly mapped blank optional values may clear them. Original source metadata is replaced as one complete row definition, while older source files, revisions and import history remain retained. Changing a visit's site must remain compatible with any already-saved activity that refers to that visit.

## Native API

The additive module is model/implementation_site_visit_intake.py:

- inspect_site_visit_csv(path, delimiter=",", encoding="utf-8-sig", filename=None) returns source bytes/hash/name, original headers, row count and the first 25 original parsed records.
- preview_site_visit_intake(workspace, saved_plan, inputs) accepts an exact saved native plan and one or two resolved original source inputs.
- import_site_visit_intake(workspace, saved_plan, inputs, expected_operation_id=..., actor="") rechecks the same source files, mapping and saved revision before writing the complete accepted batch.

The preview includes schema, edition, operation_id, plan binding (id, revision, sha256 and title), sources, normalized mappings, summary, decisions, issues and can_import. A whole-plan schema or source-binding issue prevents import; accepted and skipped records are never silently committed as a partial batch while errors remain.

The summary includes record_count, source_count, error_count, warning_count, site_count_before/after and visit_count_before/after. It also contains sites and visits dictionaries with append, replace, identical, skip and error counts.

The receipt includes operation_id, plan_id, base_revision, applied_revision, applied_document_digest, source_link_ids keyed by kind, audit_source_link_id, sources, summary, files and receipt_path. The returned result also includes status (imported or reconnected), the exact applied plan and the current saved revision. A later native revision is not replaced during replay.

## Original bytes, source associations and restart

CSV source IDs are field_csv_ followed by 24 hexadecimal characters of SHA256 over canonical [plan_id, kind, csv_sha256, normalized_mapping]. The original files are ordinary local_file source links at:

implementation/plans/<plan-id>/attachments/<csv-sha>-<kind>-original.csv

The source link retains the original filename, exact byte count and hash. Each accepted row retains original_source with source_link_id, record/physical-line spans, full original row/header list, selected columns, original identifier/namespace and operation/mapping identities. Sites additionally retain original_station and visits original_visit for source consumers.

The exact row-decision audit is linked as field_csv_audit_<operation-id-first24> and retained at attachments/<audit-sha>-site-visit-row-decisions.json. Operation identity, preview, audit and import receipt live under implementation/site-visit-imports/<operation-id>.

The plan's field12_site_visit_imports list records each original operation, base revision/digest, applied revision, source_link_ids, audit_source_link_id, mapping digest and per-kind CSV hashes. Native source-removal guards and offline reconciliation preserve these committed source records alongside existing laboratory history.

Final source descriptors pass the existing evidence-package admission rules before commit: at most 128 local-file source links, 64 MiB per original file and 128 MiB of unique packaged payloads. Payload aliases retain their separate source IDs while the existing SHA256/filename member identity counts their bytes once. An oversized source audit or existing attachment collection becomes an explicit preview issue, preserving the ability to export the applied plan through the ordinary portable evidence package.

The maintained native plan lock protects the final source checks and one immutable revision commit. Original attachments and operation metadata are retained before the commit. A retry compares the actual original next revision and full candidate document, ignoring only the native revision/timestamp fields set by the store. It reconnects that exact revision after interrupted receipt writing and leaves later native edits intact.

The native operation does not alter modeled results, observations, campaign definitions or candidate snapshots. Accepted saved sites and visits are available to the existing field, campaign and crew/day workflows. Portable browser adoption uses the same mapping, source and decision semantics in a draft, and preserves the original files and audit through the existing evidence package; it does not invent a native revision.
