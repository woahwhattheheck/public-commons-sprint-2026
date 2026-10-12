# Original sources, mappings and complete interchange

The workbench retains the original input text separately from its normalized operating records. Original files are strict UTF-8. A leading UTF-8 BOM remains part of the saved file identity while the JSON/CSV parser may ignore it for reading. Invalid UTF-8 is rejected instead of silently replacing source bytes.

Original request and order files have separate source-series identities. A saved source records its selected capture IDs, complete original files, declared fields, geometry reference, capture timing, query scope and error state. An operating edition selects exact source IDs and an immutable profile revision.

## Provider-native source files

### ArcGIS

A feature response supplies features, attributes, optional geometry, field definitions and spatialReference. The source inspector retains all original feature members. Separate original layer metadata can be supplied with the complete file.

A retained packet uses schema commons.arcgis.retained-source.v1 and a captures array. Each capture supplies an id, raw {encoding:"base64",body,bytes,sha256,complete:true} and its original receipt. Every original capture body is decoded and checked against its complete byte count and SHA-256. The original packet remains downloadable unchanged.

Select exact capture IDs when several successful datasets or query responses appear in the same packet. Multiple original pages can be selected together. Pages with source URLs must belong to the same service and layer. Automatic layer metadata selection matches both the complete service URL and layer number, so independent services' layer 0 records remain separate.

The coverage record retains every selected URL/query, observation time, raw hash and exceededTransferLimit value. A true transfer-limit flag means the original response reached a source limit. The original ArcGIS query contract permits a terminal response to omit that flag. A selected page set remains the saved original query population at its individual acquisition times; row counts alone do not establish an atomic snapshot or universal municipal coverage.

See the original [ArcGIS MapServer query reference](https://developers.arcgis.com/rest/services-reference/enterprise/query-map-service-layer/) and [layer metadata reference](https://developers.arcgis.com/rest/services-reference/enterprise/layer-table/) for the provider's supported query and schema fields. A FeatureServer-specific option is not automatically a MapServer option.

An original ArcGIS error is retained as source_error with the complete original body. It is available in source inspection and full receiving. A build selecting an order source requires a successful dataset. A request-only edition remains available while a separate order query is being resolved.

### GeoJSON

A standard GeoJSON FeatureCollection supplies properties and geometry for each Feature. With no separate CRS member, the workbench follows [RFC 7946](https://www.rfc-editor.org/rfc/rfc7946): a position is longitude then latitude, and a Feature may have null geometry.

The operating location accepts a finite numeric Point within WGS84 bounds. Other geometry types, missing geometry, nonnumeric values and invalid longitude/latitude stay available in the original record with a normalized null point.

A legacy GeoJSON crs declaration is preserved explicitly and requires a named interpretation. It is not silently relabeled as WGS84. Original feature or geometry declarations remain attached to the normalized source row.

### JSON rows, collections and reports

A plain JSON array, or an object with a records array, is interpreted as original row objects. CSV and row inputs require explicit field mappings for identity, status and relationships.

The complete Open311 collection-export.v1 and service-report.v1 formats expose their original source rows. The original complete input, source attributes and normalized geometry selection remain retained. Choose actual original source fields in the follow-through profile and keep each municipality's source series separate.

### CSV

CSV input follows quoted fields, doubled double-quotes, commas and CRLF or LF row endings. It requires distinct nonempty headers and a consistent number of cells. Input cells remain text; numeric-looking identifiers are not silently converted or stripped of leading zeros.

Exports quote every cell. An output column named open311_csv_encoding carries apostrophe-v1. Formula-leading cells and cells beginning with an apostrophe receive one protective apostrophe. When the declared marker is present, the reader removes exactly that reversible prefix. A changed encoding marker is rejected. Unmarked original CSV receives no automatic prefix removal.

Original nested objects and arrays are represented as canonical JSON cell text in CSV. The full JSON workspace keeps their native types and original source bodies. The reserved encoding column cannot be chosen as a destination field.

## Explicit profile semantics

Each request and order role maps original business identity fields, title, description, status, references and dates. A request also maps work-required values; an order can name individual original cost fields.

| Mapping | Interpretation |
| --- | --- |
| idFields | Ordered exact original scalar values, namespaced by the source series |
| statusField | Literal original value; internal work status remains separate |
| workNeeded | Independent original field and typed values for needed/not-needed |
| referenceFields | Original values displayed for operator research and relationship review |
| joins | Named request/order field comparison that produces candidates |
| dates | Explicit epoch-ms, iso-offset or literal parsing for each selected field |
| costs | Original typed value, chosen label and optional declared unit |
| coordinates | Original source meaning or a named explicit interpretation |

Missing business identities remain visible with their source row and issue; those requests need a valid identity before action approval. String IDs remain case-sensitive and preserve punctuation. The ordered identity tuple prevents collisions between different source namespaces or composite field selections.

A relationship candidate does not establish a confirmed order link. Exact comparison uses the original typed values. trim-text and fold-text are explicit operator choices. An empty joins array enables manual original-order search and reviewed selection without an inferred cross-system relationship.

Cost values retain original numeric precision and zeros. The workbench does not supply a currency for a source that has not declared one. A literal date such as 10/08/2026 stays in dates.closedAt.sourceValue with format literal and a null instant. Epoch-millisecond and ISO-offset mappings preserve their original value alongside the parsed instant. A missing or mismatched date remains visible as an issue.

### Source-generated ArcGIS IDs

MapServer metadata may declare a hash-derived object ID through uniqueIdInfo.OIDFieldContainsHashValue. Choose the actual business identity, such as WORKORDERID, in idFields.

Every complete original feature still receives its own source hash. Request and order comparisons identify a change confined to declared hash-derived esriFieldTypeOID fields as sourceMetadataOnly. The comparison requires the original declaration in both compared source editions and reports the exact changed field names. Summary changed includes those changed originals; sourceMetadataOnly is its subset. Cost/date/status changes remain ordinary source changes.

This distinction keeps original query representations visible while separating source-generated ID changes from mapped business facts. Source-bound work and relationship decisions remain attached to their exact recorded versions.

### Original and interpreted coordinates

The original geometry and spatialReference are retained independently of the current operating point.

- source uses a declared WGS84 Point with finite numeric longitude/latitude in bounds.
- wgs84 is a named operator interpretation of the original x/y as longitude/latitude.
- web-mercator is a named interpretation of finite original x/y within the supported Web Mercator bounds, transformed using radius 6378137.
- manual stores one per-record WGS84 point.

Every non-source interpretation requires a name and sourceReferences. Manual interpretation belongs to a single work record. A source point can change while an earlier interpretation remains in history; its original geometry/reference fingerprint indicates that a fresh decision is needed.

Manatee's published QAlert response includes original coordinate declarations and mixed coordinate magnitudes. The source profile keeps those literal declarations and leaves an invalid unconfigured point unlocated. An empty Esri point such as {x:"NaN",y:"NaN"} likewise remains in the source and produces a null operating point.

## Original editions and current work

An operating edition saves its original normalized requests and orders, exact source object versions and occurrence references, complete profile interpretation, candidate relationships and separate capture scopes.

When selected pages repeat the same business record:

- Identical full original versions combine their occurrence references.
- Different full original objects remain separate versions.
- The last occurrence in the explicitly selected original file order supplies the displayed edition.
- Ambiguous versions remain visible; source count is not used as the identity.

Request and order comparisons operate within the same operating series. A missing later row is not_observed in the selected later files. Source completion, deletion or the existence of an order outside the chosen query population is not inferred.

A relationship decision saves both exact original request and order hashes. A work record saves its request version, selected order versions, original coordinate fingerprint, location interpretation and prior work identity. Later changed sources expose review discrepancies while preserving all earlier decisions.

A new dispatch requires current approved work, an open internal work status, a selected action, and current confirmed relationships for the chosen orders. Unchanged source-bound work can carry forward to a later operating edition of the same series.

## Reviewer interchange

The editable file uses schema commons.open311.follow-through-review.v1. It contains the baseEditionId and baseEditionSha256, reviewer, notes, work rows and relationship rows.

Each work row includes the original request key/version, beforeWorkId, complete before fields and proposed after fields. Relationship rows include both source keys/hashes, beforeLinkId and the proposed decision. A reviewer can edit after fields and add a manual relationship proposal against known original request/order identities.

On import, the workbench retains the complete returned file, validates its base and original preimages, and creates distinct proposed changes. Proposal review names a target edition of the same series. Conflicts identify changed original source, intervening work or relationship decisions, absent records and unsupported selection.

An accept/reject decision chooses explicit proposal IDs and a reviewer. A partial decision leaves the remaining proposals pending. Accepted relationships are applied before accepted work from the same decision. Rejection records the decision and preserves the current operator work. Every original file, proposal and decision transfers in the full workspace.

## Reviewed dispatch formats

A dispatch saves explicit current work IDs, named receiving-system columns, complete source/work/order rows and the exact operating edition.

| Export | Contents |
| --- | --- |
| dispatch-json | Complete sealed dispatch, definitions, original source editions, work and coverage |
| dispatch-csv | Exact selected destination columns and reversible cell encoding |
| dispatch-geojson | One Feature per selected request, its operating geometry and exact mapped columns |
| report | Printable HTML operating view, original coverage, mapping and current work |
| workspace | Complete editable sources, editions, reviewer and operation history |

GeoJSON Feature.properties contains exactly the selected mapped columns. Feature.id is the original normalized request key. Its foreign member followThrough carries request identity/version, full original request attributes and geometry, selected orders and reviewed work. The FeatureCollection's followThrough member records dispatch identity and coverage. Foreign metadata never overwrites a chosen destination column. An unlocated selected request is retained as a Feature with geometry null.

Original source files and returned reviewer files are also exportable byte-for-byte. A source-file export may choose the whole retained packet, an exact original capture or the explicitly supplied layer metadata.

## Complete receiving and replay

The workspace package uses schema commons.open311.follow-through-workspace.v1. It contains original source bodies and receipts, saved profile revisions, all source editions, links, work, returned reviewer files, decisions, dispatches and ordered successful operations.

Receiving reconstructs source, profile, edition and reviewed derivations before committing to an initialized empty destination. It preserves the original workspace identity and adds a receiving operation. The stored receiving input is the complete original file's byte count/SHA-256 and the incoming sealed package hash; all actual original municipal/reviewer files and prior records already reside in the imported history.

A stable requestId and the complete original intent identify an action. expectedRevision controls admission of a new action. An exact successful retry returns the original result. A changed intent with the same ID conflicts, and a new action at a stale revision is rejected. Unchanged reopen preserves complete workspace export bytes.

The browser and merchant reader provide compact state and paged views. The complete JSON file remains the portable receiving unit, including original source rows that have no valid location or no selected order.
