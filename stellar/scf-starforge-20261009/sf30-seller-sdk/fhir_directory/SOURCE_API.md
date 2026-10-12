# Original directory sources, acquisition and editions

This is the source-owned API for `DirectorySources`, composed with the original
Gravity/eLTSS/FHIR workspace. It receives complete HSDS and FHIR HSD originals,
indexes their source identities, freezes reviewed source editions and compares
them. The separate directory domain owns mappings, service selection, referral
joins and handoff decisions.

## Selected publisher source

The exact source envelope is `directory-original-source.json`, Git blob
`e3d464bb382eee470658b40d97710ab4c3ca9439`, 1,122,425 UTF-8 bytes,
SHA-256 `e3312d1577709bb455c50331023f47f61f8527de417e7db7bf09b7f7dd244e27`.
The loader verifies its complete hash and every embedded original Git blob and
byte count before exposing schemas. The envelope contains 105 complete originals.

* Open Referral HSDS 3.3.1 uses original repository
  https://github.com/openreferral/specification at
  `606a72cc3ddd80f890b6422bc7bd53392764775a`.
  Its original datapackage still declares version 3.0.0. Both values remain
  visible. The 24 canonical schemas, foreign keys, CSV examples, JSON examples
  and OpenAPI document are unchanged. Original CC BY-SA 4.0 terms are retained.
* FHIR HSD 1.0.0 STU1 authoring uses
  https://github.com/HL7/FHIR-IG-Human-Services-Directory at
  `ff9fff7902343f1640c0d3a4cf098a62a3e1c054`, with its original CC0 notice.
  It targets FHIR 4.0.1, US Core 3.1.1 and Plan-Net 1.1.0, and maps HSDS 2.0.1.
  A mapping from HSDS 3.x is a reviewed transformation.
  Published files are at https://hl7.org/fhir/us/hsds/ .

Original schema details are authoritative even when surprising: deprecated
schedules remain separate from operating_hours/events; the selected schedule
schema's timezone type is number. The code does not silently modernize those
originals. Unknown extension fields remain in source rows.

Structural observations identify missing required fields, lexical/type and UUID
issues. They are not a full JSON Schema, FHIR profile or clinical conformance
assessment. Actual selected endpoint discovery remains separate from publisher
requirements and example inputs.

## Runtime and store composition

`directory_source.py` exports `DirectorySources(DirectoryAcquisition)`.
The directory Workspace combines that mixin with the maintained
`referral_workspace.Workspace`. The source arm requires the existing
`root, db, mutex, workspace_id, scratch(), credentials, _retain_file(path,role)`
and `_file_path(descriptor)`. Native descriptors are exactly
`{sha256,bytes,role}`; no second original-file store is created.

The directory owner supplies these shared methods:

```python
_directory_store(kind, value)                   # immutable flat full record with id
_directory_save(kind, record)                   # mutable flat full record with id
directory_record(kind, id, required=True)
directory_records(kind, offset=None, limit=50, query="")
```

Source kinds are immutable `connections, discoveries, requests, sources,
editions, comparisons` and mutable `acquisitions`. All immutable IDs are complete
64-character content identities. Acquisition IDs are the original literal
1–96 character operation token; a UUID is recommended.

`init_directory_sources()` creates only private directory operation journals.
It returns the original workspace UUID and `rowTables:[]`. Complete row,
reference and comparison indices are immutable SQLite files retained through
the original eLTSS file store. The application need only preserve the shared
directory registry and reachable original file descriptors.

Before whole editable export call `directory_sync_sources()`. It reconciles
file-first operation journals into the shared registry and retains every
complete or interrupted original HTTP recovery file. Recursively collect
`retained_file_descriptors(record)` for all directory records, including
acquisitions and their recoveryFiles. Each referenced file must be verified by
the original file accessor. On restore, `directory_operation(id)` recreates
missing original transport files from those verified descriptors. Preserve the
workspace UUID and the original operation/request identities.

`directory_runtime.py` is the domain owner's existing-runtime adapter. It
re-exports InputError, ConflictError, ProviderError, Transport, private_directory,
atomic_json, safe_read, now, retry_time, fhir, original_workspace and MAX_SOURCE.
This arm imports the original JSONReader, numeric-token serializer, exact
reference parser, gzip decoder and ZIP writer.

## Catalogue and input validation

`directory_source_catalogue()` returns
`stellar-forge.directory-source-catalogue.v1`, including `inputSchemas`,
`actions`, `limits`, `formats`, `protocols`, source origins/scopes, comparison
and operation states, exact row-ref fields, all 24 original table definitions,
foreign keys and publisher source citations. The current typed contract is
`directory-source-schema.json`.

Unknown action fields are rejected. Numeric limits are actual JSON integers.
Original query parameter names/values and their repeated order remain strings.
Do not reinterpret empty values, selected CSV columns, logical IDs, timezone
tokens or native source clocks while preparing an action.

### Connections and GET requests

```json
{
  "label":"Selected directory",
  "protocol":"hsds",
  "baseUrl":"https://selected.example/directory",
  "authProfile":null,
  "publisher":"",
  "sourceUrl":"",
  "note":""
}
```

This is an illustrative configuration, not an operated endpoint.
`directory_connection(raw)` stores it using an existing local credential
profile. Credentials and private keys stay in the original local credential
file; public connection records carry only its profile name.

`directory_discover(connection_id, operation_id)` reserves a discovery request
and advances at most one GET. HSDS reads the original root document; FHIR reads
`/metadata` and requires an actual server CapabilityStatement, not a
requirements declaration. The returned acquisition contains `discoveryId`.
The discovery record retains actual declared version, response receipt and
complete wire/decoded file descriptors.

`directory_request(raw)` freezes an exact selection. Required keys are
`label,connectionId,route,origin`. Optional keys are `discoveryId,table,
resourceType,nativeIds,parameters,url,document,pagination,scope,note,limits`.

Routes:

| Route | Selection |
| --- | --- |
| discovery | Selected endpoint native metadata only |
| hsds-list | Retained discovery, canonical table and explicit pagination |
| hsds-read | Retained discovery and exact selected native IDs |
| fhir-search | Retained actual capability and exact resource type/parameters |
| fhir-read | Retained read capability and exact logical IDs; no search filters |
| document | Explicit same-provider URL plus exact file interpretation |

For HSDS native routes the canonical table keys are service, organization,
taxonomy, taxonomy_term and service_at_location; the native endpoint names are
services, organizations, taxonomies, taxonomy_terms and service_at_locations.
Optional endpoints remain subject to their actual provider response.

FHIR HSD native route resource types are Organization, Location,
HealthcareService and Endpoint. Do not put profile names in resource paths.
Exact case matters, including `_lastUpdated`. Parameters are ordered
`[{name,value}]`; repeated names remain repeated. FHIR pagination follows the
actual returned next URL. A repeated URL, ambiguous next link, out-of-scope
provider URL or repeated identical nonempty page requires review.

Every HSDS single-entity read must return the exact requested string ID. Every
FHIR read must return the exact requested resourceType and logical ID. A
different entity, Bundle, OperationOutcome, missing ID or numeric ID requires
review even when HTTP status is 200. The original request, response bytes,
receipt and partial capture remain retained; this does not retry or rewrite
the provider response.

HSDS list pagination is explicitly
`{startPage,perPage,termination:"declared"|"empty-page"}`.
No default zero/one-based interpretation is invented. The receiver retains
original empty, page_number, total_pages, first_page and last_page fields.
Declared termination requires a native last_page or sufficient original
first-page/total-pages evidence. Empty-page termination is a separately reviewed
choice. Reaching a size/page limit preserves the partial receipt and requires
review; it never silently claims a complete remote directory.

The immutable request includes `initialGets,connectionSnapshot,capabilityNotes`.
The acquisition hashes that complete retained request. A later connection or
selection creates a new request; it cannot replace the meaning of the original
operation ID.

### Reserve, advance and recover

```python
request = ws.directory_request(reviewed_input)
operation = ws.directory_acquire(request["id"], original_operation_id)
operation = ws.directory_advance(operation["id"])
```

`directory_acquire` reserves only; it performs no network access.
`directory_advance` receives at most one original GET, preserving complete wire
bytes, decoded bytes, request URL, actual response URL, selected original
headers, timestamps, status, hashes and transport errors. Only credential
references enter request records. It reuses an already completed matching
transport receipt before making a new HTTP request.

Operations expose `id,operationId,workspaceId,requestId,requestSha256,connectionId,
state,phase,queue,attempts,pages,recoveryFiles,activeStep,receivedBytes,
decodedBytes,receivedRecords,receivedRows,pageCount,notBefore,sourceId,
discoveryId,observations,error,createdAt,updatedAt`.
States include ready, receiving, paused, waiting, needs-review and complete.

* `directory_operation(id)` reads/reconciles the original operation.
* `directory_pause(id)` pauses local continuation without a provider mutation.
* `directory_resume(id)` resumes the same request and respects its actual
  Retry-After boundary. Nonretryable selection/response errors require a new
  reviewed request; all earlier originals remain available.
* `directory_capture_source(id)` explicitly freezes complete pages received so
  far, preserving whether the original query was incomplete.
* `directory_capture_file(id)` returns the complete original capture packet.
* `directory_sync_sources()` is the whole-workspace receiving boundary.

A complete query creates a source by reusing the same source importer and
returns its `sourceId`. No provider write is implemented by this source arm.

### Original file intake

```python
source = ws.directory_import(original_path, {
    "label": "Original selected CSV",
    "format": "hsds-csv",
    "table": "service",
    "origin": "published_reference",
    "encoding": "utf-8-sig",
    "delimiter": ",",
    "filename": "services.csv",
    "scope": "subset"
})
```

Formats are hsds-json, hsds-csv, hsds-csv-zip, fhir-json, fhir-json-zip and
directory-capture. Origins are published_reference, operator_source and
authored_example. Source scopes are snapshot, subset, incremental and unknown.
Scope is an explicit operator claim, not inferred from import time or row count.

Set filename to preserve the exact reviewed original filename. If it is
omitted, the importer and original-file download both use
directory-<full-original-SHA256>.csv for an individual CSV, .json for an
individual JSON, or .zip for an archive. A non-ZIP member uses that same name.
Runtime upload paths do not enter source identity, so complete unchanged
bytes and the same normalized profile produce the same source through direct
intake or HTTP PUT. The published-source operating driver supplies every
original filename explicitly.

HSDS JSON uses entity, array, page or tables layout. All but tables require an
exact canonical table. The tables layout recognizes both canonical table keys
and original schema CSV paths such as services.csv.

CSV ZIP selection is `members:[{name,table,encoding?,delimiter?}]`. FHIR ZIP
selection is `members:[{name}]`. Every original archive member is retained,
including unselected schemas, metadata and documentation; only reviewed
members are indexed. Duplicate names, path traversal, symlinks, encryption,
unsupported compression and oversized complete expansion are rejected.
No malformed row or resource is silently dropped.

The source record includes `id,schema,label,format,origin,scope,publisher,
sourceUrl,referenceBase,note,interpretation,originalFile,originalSha256,members,
documents,indexFile,inventory,schemaEditions`, plus imported capture provenance
when applicable. Documents retain the exact selection, original member identity
and complete record count; full source bytes remain at originalFile/members.
Inventory includes records, table counts, missing native IDs, duplicate identity
groups, reference-resolution counts and structural observations.

## Original rows and exact references

```python
directory_source(id)
directory_source_rows(id, offset=0, limit=50, table=None, query="")
directory_source_row(id, record_id)
directory_source_members(id)
directory_source_file(id, member=None)
directory_record_file(source_id, record_id)
directory_iter_rows("sources", id, table=None)
directory_iter_rows("editions", id, table=None)
```

Row pages always use `rows`, not items:
`{rows,total,offset,limit,nextOffset,bytes,byteBudget}`.
They also carry sourceId or editionId. Follow the returned nextOffset: a page can
contain fewer rows than its requested limit because the byte budget was reached.
Literal query is a local retained-text search, not a new provider request.

Rows contain sourceId, recordId, protocol, table, nativeId, identityKey, rowOrdinal,
recordOrdinal, pointer, memberName, memberSha256, rowSha256, resourceSha256,
comparisonSha256, parentRecordId, label, observations, rawRange, representation,
data, json, numericTokens and ref.

`json` is a complete JSON **text string**, with exact source numeric tokens
preserved by the original serializer. It may use canonical whitespace/key order.
`data` is a convenient decoded projection; original number tokens appear as
strings and `numericTokens:[{pointer,token}]` identifies them. Never use a normal
floating-point parse/re-serialization as an exact source substitute.

`rawRange`, when present, is the half-open original member byte range.
`representation` distinguishes original-range from derived-exact-values.
Nested original objects retain their exact member/pointer and canonical value
hash; the complete original member is always available for exact formatting.

CSV rows additionally retain complete ordered headers/cells, logicalRowOrdinal,
lineStart/lineEnd, duplicateHeaders and ragged. rowOrdinal is the logical row
within that member; recordOrdinal is the global index position. Blank and
duplicate headers and ragged positions stay intact. Only unique nonblank
column names enter data; full cells remain independently comparable.

FHIR rows additionally retain exact fullUrl (including urn:uuid), referenceBase,
containedIn, versionId and lastUpdated. Logical ID, version, authored capture
time and actual source modification time are separate values.

`ref` is the full retained source citation:
`{sourceId,recordId,table,rowOrdinal,rowSha256,resourceSha256,memberName,
memberSha256,pointer}`. Save it unchanged.

Large row content may exceed the 4 MiB interactive page budget. Such a row
returns its descriptor and contentOmitted, retaining complete content in its
source member, record document and SQLite index. The full streaming iterator
returns complete rows and is the domain's bulk mapping/receiving interface.

Nested HSDS objects retain parentRecordId and their absolute pointer without
adding fabricated foreign-key fields. Parent links use kind hsds-nested and
the exact relative child path. A domain joins the original parent record by
sourceId plus parentRecordId. Native HSDS foreign keys and FHIR references are
also indexed exactly. Identifier-only/display-only references never become
name-based matches.

## Editions, lookup and complete comparisons

```python
edition = ws.directory_edition({
    "label": "Reviewed source selection",
    "sourceIds": [source["id"]],
    "actor": "original operator",
    "predecessorId": None,
    "tables": [],
    "scope": "subset",
    "note": ""
})
```

A frozen edition copies selected records on disk, resolves all exact aliases
against that selection and retains source IDs/index descriptors/completeness
basis. Empty tables means every indexed table; an explicit nonempty selection
is checked against actual retained records. Every source remains immutable.

```python
directory_edition_rows(id, offset=0, limit=50, table=None, query="")
directory_edition_row(id, source_id, record_id)
directory_edition_links(id, offset=0, limit=50, record_id=None)
directory_link_targets(id, source_id, link_id, offset=0, limit=50)
directory_lookup(id, protocol, table, native_id)
```

Lookup protocol is hsds or fhir-hsd. For FHIR use actual ResourceType as table
and raw resource.id as native_id, without adding a Type/ prefix. Lookup returns
`{editionId,protocol,table,nativeId,state,rows,total,truncated}`, with up to 250
complete candidate descriptors. It never picks one ambiguous candidate.

Edition link rows contain id, sourceId, recordId, pointer, kind, original
reference/foreign-key details, state, candidateCount, candidates and
candidatesTruncated. Embedded candidates are capped at 25; directory_link_targets
pages **every** exact `{sourceId,recordId}` candidate. Resolved, ambiguous,
unresolved and not-resolvable remain distinct. A reference to an unselected
source remains unresolved. Full URL and contained-reference identity are kept.

```python
comparison = ws.directory_compare({
    "label": "Reviewed editions",
    "beforeEditionId": before["id"],
    "afterEditionId": after["id"],
    "actor": "original operator",
    "reviewedLinks": [],
    "note": ""
})
```

Native matching uses exact protocol, namespace, table/resource type and logical
ID. Reviewed cross-edition links explicitly select one before and after
`{sourceId,recordId}`, with a nonempty reason. A record cannot be reused in two
reviewed pairs. Duplicate IDs remain ambiguous; missing IDs remain unidentified.
No title matching or silent one-to-many reduction occurs.

Comparison states are unchanged, changed, only-before, only-after, ambiguous
and unidentified. only-before/after describes selected editions, not a provider
deletion/creation claim. Comparisons include all original JSON values, ordered
CSV headers/cells and fullUrl. Changed rows retain changedPointers and
changedMetadata; a pointer list over 10,000 is explicitly marked truncated while
complete source rows and index remain available.

`directory_comparison(id)` returns the full immutable summary.
`directory_changes(id,offset=0,limit=50,state=None)` pages actual change rows.
`directory_changes_file(id)` returns full JSONL, or explains when the complete
SQLite index is the supported receiving form.
`directory_index_file(kind,id)` exposes the complete retained index for
sources, editions or comparisons.

All file accessors return `(path,descriptor)`, with original native
sha256/bytes/role plus name/contentType. Servers use the existing authenticated
binary-download route; complete JSON files must still stream as files.

## Limits and complete receiving

Original file, expanded archive and each retained index: 256 MiB.
One acquisition journal's complete metadata is capped at 16 MiB; every received
wire/receipt file remains retained if that boundary is reached. Complete page
header values use headerFile, headerBytes and headerSha256; headerJson is inline
only through 8 KiB. Pagination still inspects the complete original metadata,
and full original response bytes remain unchanged.

One record: 16 MiB. Original source: 100,000 indexed records.
Edition: 250,000 records from up to 64 sources.
References: 500,000. Archive: 4,096 members and at most 1,024 reviewed members.
Acquisition: at most 512 complete selected pages.
Interactive JSON: 4 MiB and 250 rows per page.

Limits reject unsupported complete selections with their existing original
bytes preserved. They do not silently reduce source, select a first duplicate,
truncate a native query or mark a partial acquisition complete.
HTTP identity and gzip wire/decoded budgets are each enforced against the
selected request. Private editable receiving retains the full registry,
file-first journals, wire responses, original source members and every index.

## Source operating leg

`operate_sources.py` exports `exercise_directory_sources(ws,output,hsd_examples=None)`.
The original directory native owner calls it on the same Workspace, then carries
its returned sourceIds, editionIds and comparisonIds into domain mapping,
selection and receiving. This leg never starts a provider query. Its connectionIds,
requestIds and acquisitionOperationIds are empty and are labelled accordingly.

It receives all 24 original HSDS CSV examples, complete original nested JSON and
tabular JSON, one explicitly authored description-cell successor retaining the
complete predecessor, every exact reference candidate and complete change output.
An optional already-preserved published HSD example ZIP enters unchanged. All
original input files, exact hashes and selected native IDs are returned in
`OPERATED_DIRECTORY_SOURCES.json`; `SOURCE_JOURNEY.json` retains exact per-step
requests and accepted record IDs for continuation. No live service status is
authored by the example. The directory owner's full native journey adds domain
review, handoff, editable export and restore on this same source state.

```sh
python3 operate_sources.py --workspace /absolute/original-workspace \\
  --output /absolute/original-source-receiving \\
  --hsd-examples /absolute/already-preserved-HSD-examples.zip
```

Only the sole directory operator should run this command on its workspace.
The caller may instead import the function into its already-owned full journey.

## Completed source-index operation

The source-index operation completed natively against the complete
`e091f68161c9c1c8135fec653b64643508ba2e55` source edition.
`SOURCE_INDEX_RECEIPT.json` retains the complete original result: 22,609 bytes,
SHA-256 `10ee77acd16361f96a6e3f1fb918b60ceff43258e53927ed8521945259d3f28f`.

It indexed all 24 unchanged published CSV tables, the selected original
organization and tabular JSON, and a joined edition containing 65 rows and
86 reference links. The explicitly authored service-description successor
compared as one changed row and 23 unchanged rows. Every one of the 105
publisher source files was verified against its original Git identity.

A separate generic FHIR parser observation used the unchanged 128,055-byte
published eLTSS STU2 Bundle: all 39 resources were indexed, with 98 resolved
links and two links marked not-resolvable. This is generic FHIR parser
evidence; it is not an HSD example or a profile-conformance result. The receipt
preserves the exact original bytes/hash and a reversible staging-byte repair.

This operation created no Directory registry or provider request. The complete
Directory workspace, HTTP, mapping, service-selection and receiving journey
uses `exercise_directory_sources` from `operate_sources.py` on the selected
original workspace. The subsequent filename and read-identity correction keeps
the completed index receipt unchanged; its exact full Python postimages were
AST parsed and imported with the original runtime, and the complete original
organization response retained its exact native ID.
