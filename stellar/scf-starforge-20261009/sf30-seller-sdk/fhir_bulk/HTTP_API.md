# FHIR Bulk Data workbench — complete operator and receiving contract

Operation: SCF-FHIR-BULK-DATA-WORKBENCH-450E-20261012.
Source root: stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_bulk/.
450E engineering owns fhir_source.py, fhir_acquisition.py, fhir_workspace.py, fhir_auth.mjs, cli.py, cli.mjs, merchant.mjs, customer.mjs, source-native receiving and additive SDK composition.
Root450E owns fhir_server.py, public/index.html, public/app.js, public/style.css and operate_browser.mjs.
Original coordination parent: C0BTB4SUCP9 / 1791730220.899469; TAKE 1791794293.845129.

## Original runtime and source

The implementation consumes the existing ../xml/workspace.py SourceFormat, Workspace and NativeEngine, and ../xml/xml_source.py InputError, primitive native type validation and dataset specification. Initial read pins are workspace 24c4fb7ccf08f6d350bcfb4eae6accc251a60a4e, xml_source 8f02d9545ae2959f354cff555ddb0e8595f1b8e0, native.mjs b335d4148f82cc40b3d5bdb08891c0d6b98f67ac. These originals are not replaced.

FHIR protocol selection is the published HL7 Bulk Data STU2 or STU3 export contract based on FHIR R4. The current permanent STU3 source is https://hl7.org/fhir/uv/bulkdata/STU3/en/export.html . Original sample operation uses https://bulk-data.smarthealthit.org/fhir and its published SMART sample-data description. The original server's CapabilityStatement, SMART discovery, Group pages, every accepted kick-off/status response, manifest and output/error/deleted file are retained with exact original bytes and HTTP identity. Provider-supplied narrative remains original data; it is never executed by the operator UI.

## Python factory and errors

from fhir_workspace import Workspace, InputError

Workspace(root, create=False, credentials_file=None). One original private 0700 workspace and its native single-owner lock. Context manager, close(). credentials_file is an absolute owner-selected local file supplied at server/CLI startup; HTTP requests never choose or read arbitrary credential paths. The secret profile file stays outside source and receiving archives. Public auth_profiles() returns only profile name, type and configured origin names.

InputError is the original ValueError subtype. ProviderError adds provider_status, retry_after, not_before and retained receipt, with HTTP-facing status 502. Source validation is a useful 422. Concurrent or conflicting original operation identity is 409. A returned waiting/exporting state is a successful retained operation, not an HTTP error.

## Connection and export definition

save_connection(body) -> {id, connection}.
connection(id) -> same object.
Body:
{
  label: string,
  baseUrl: absolute HTTPS FHIR base (HTTP only for loopback),
  protocol: "stu2" | "stu3",
  authProfile: null | configured profile name,
  origin: "published_sample" | "operator_source",
  publisher: string,
  sourceUrl: string,
  note: string
}
The content ID binds the complete connection. Exported source and publication lineage keep the source classification.

discover(connection_id) -> {id, connectionId, fhirVersion, resourceTypes, operations, capability, smart, receipts}.
Each capability/smart value is {file,sha256,bytes,status,jsonText}; original JSON is available as text. This is a retained actual discovery, and every new explicit discovery produces/reopens its observed content ID.
groups(connection_id, url=None) -> {id,connectionId,items,nextUrl,receipt}; items contain {id,name,type,actual,quantity,jsonText}; nextUrl is the original same-origin FHIR Bundle next link. Passing it requests that exact next page.

save_export(body) -> {id, export}; export_plan(id) -> {id,export}.
Body:
{
 connectionId, label,
 scope: "system" | "patient" | "group",
 groupId: null | literal FHIR Group id,
 method: "GET" | "POST",
 parameters: {
  types: [FHIR resource type],
  since: null | FHIR instant, until: null | FHIR instant,
  elements: [root element token],
  typeFilters: [complete original resource-type query string],
  includeAssociatedData: [string],
  patients: [relative Patient reference, POST only],
  organizeOutputBy: null | resource type,
  allowPartialManifests: boolean,
  separateExportStatus: boolean,
  handling: "strict" | "lenient"
 },
 limits: {maxBytes: integer<=268435456, maxFiles: integer<=4096, maxLineBytes: integer<=16777216},
 note: string
}
Defaults are empty selections, GET, no optional filtering/organization, strict handling, and 256 MiB / 4096 files / 16 MiB per original line. The request preview returned in export.request has method,url,headers (no credentials),bodyText and requestSha256. No default resource/date/clinical filter is added.
An empty types list means the selected native endpoint's full authorized export scope. _since and _until are modification instants, not clinical event dates. Repeated typeFilters retain native OR semantics; they do not filter other resource types by inferred patient membership.

## Retained acquisition and recovery

advance(export_id, operation_id) -> the complete operation object. operation(id) reopens it.
The browser creates and saves operation_id BEFORE POST, then keeps the original ID until completion. Exact identity may be a UUID or a 1–96 character [A-Za-z0-9_.-] token. Reusing it for another export is rejected.

An operation object:
{
 operationId, exportId, connectionId,
 state: "prepared" | "kickoff_unknown" | "exporting" | "waiting" | "receiving" | "complete" | "failed" | "cancelled" | "cancel_unknown",
 phase: "kickoff" | "status" | "manifest" | "files" | "source" | "complete",
 requestSha256, createdAt, updatedAt,
 statusUrl: null|string, notBefore: null|UTC ISO instant,
 progress: null|string,
 files: [{id,kind:"output"|"error"|"deleted",type:null|string,url,state:"pending"|"partial"|"complete",bytes,sha256?,lineCount?,count?,contentType?}],
 manifests: [{id,url,status,sha256,bytes,transactionTime,nextUrl}],
 sourceId: null|string, source: null|source descriptor,
 error: null|{message,providerStatus?,receipt?},
 history: [{at,action,status?,receipt?}]
}

Each advance performs the next exact native network/file step and durably saves its result. UI can continue automatically while visible, awaiting notBefore and retaining the same operation. Pausing browser polling does not cancel the server export. Status polling obeys native Retry-After and exponential delay. HTTP 202, or HTTP 200 with X-Export-Status:202 when that preference was accepted, remains in progress. Complete/partial manifests preserve native error arrays and paging. Complete files are reused by their original identity; a changed file validator is received as a new complete attempt, never byte-concatenated to its predecessor.

If transport/process death loses the initial Content-Location after kick-off, the original operation is kickoff_unknown and is never automatically kicked off again. adopt_status(operation_id,{statusUrl,reason}) attaches the actual provider status URL to that same saved operation; the final manifest must identify the exact retained request. The UI offers this actual status-URL receiving control. Starting a separate new export is a new explicit operation.
cancel(operation_id, request_id) retains the exact cancellation request and provider outcome. Cancellation is a separate explicit operator action.

STU3 organized files retain Parameters header records as original organized-group metadata. The source parser distinguishes those headers from actual resources. Deletion files retain complete transaction Bundles and exact DELETE references; OperationOutcome severity/code/diagnostics stay inspectable. Partial-success exports remain visibly distinct through their original outcomes.

## Original source and resource review

source(id) -> original Workspace {id,label,name,bytes,created,inventory}.
inventory:
{
 schema:"stellar-forge.fhir-bulk-inventory.v1",
 mode:"capture"|"materialized",
 classification:{origin,publisher,sourceUrl,note},
 export:{connectionId,baseUrl,scope,groupId,parameters,requestSha256},
 transactionTime, captures:[{id,transactionTime,request,parameters}],
 files:[{id,name,kind,type,bytes,sha256,lines,resources,headers,count,contentType,url}],
 resourceTypes:[{type,count,identities,duplicateIdentities,missingIds}],
 fields:[{resourceType,path:[string],pointer,types:[string],occurrences,resourceCount,examples:[{jsonText}]}],
 totals:{files,bytes,resources,deletedEntries,outcomes,organizedHeaders},
 findings:[{code,message,fileId?,line?}],
 coverage:{kind:"full-export"|"modification-export"|"retained-resource-state",since,until,transactionTime},
 composition:null|{baseSourceId,deltaSourceIds,resolutions}
}
Original file/member/path names and property strings are text. No browser innerHTML rendering of native FHIR narratives.
source_rows(id,resource_type=None,kind="output",offset=0,limit=50,query="") ->
{sourceId,resourceType,kind,rows,total,offset,nextOffset}; each row:
{fileId,fileName,line,recordId,kind,resourceType,id,versionId,lastUpdated,bytes,lineSha256,resourceSha256,jsonText,references:[{path,reference}],deleted:[{url,resourceType,id,versionId}],issues:[{severity,code,diagnostics}]}
jsonText is the exact original UTF-8 line, including its original line ending. It avoids browser numeric coercion of FHIR decimals. Source row identity is file + one-based original physical NDJSON line; sourceId supplies edition scope.

source_row(id,file_id,line) -> one complete row.
open_source_member(id,name) is a context manager yielding the verified original binary stream.
source_members(id) -> files above plus retained protocol/source manifest descriptors.
source_path(id) -> verified original complete source packet Path.

add_source(stream,label=None,name=None) is the original SourceFormat intake. The accepted file is the complete FHIR source ZIP, not an inferred collection of unlabeled JSON files.

## Reviewed projection and native engine

default_mapping(source_id, resource_type, name=None) -> a complete editable mapping.
projection_preview(source_id,plan,limit=25) -> {columns,rows,totalRows,previewRows}; rows contain {ordinal,cells,values}. Preview shows the first selected rows; build verifies the full selected projection.
save_plan(body) -> {id,plan}; plan(id) returns the complete retained body.

Mapping:
{
 schema:"stellar-forge.fhir-bulk-mapping.v1",name,resourceType,
 columns:[{
  name, source:"resource"|"record", path:[string],
  mode:"single"|"first"|"last"|"array"|"join",
  encoding:"plain"|"json", type:"string"|"integer"|"number"|"boolean",
  nullable:boolean, missing:"error"|"empty"|"default",
  default?:string, separator?:string
 }],
 filters:[columnName],ranges:[columnName],sorts:[columnName],keys:[columnName],
 defaultLimit:50,maxLimit:250,maxBytes:67108864,maxRows:250000,maxCellChars:65536,allowEmpty:false
}
Paths use exact object keys and explicit array positions; "*" selects every array item at that position. This is a transparent projection selector, not a general FHIRPath evaluator. Source "record" exposes resourceType,id,versionId,lastUpdated,fileId,line,recordId. Default identity columns are resourceType/id and exact string values. All other optional original values default to explicit JSON-cell encoding, preserving missing/null/empty values and lexical numbers. Plain/number conversions require the operator's reviewed mapping. Arrays and joins use explicit multiplicity policies; no first-item selection is implicit. Exact original files always remain present.

build(source_id,plan_id) -> original build review {id,source,plan,rowCount,keys,columns,native,engineBlob,files}.
build_view(id), query(build_id,scalar_string_params), compare(before_build_id,after_build_id), comparison_page(id,offset=0,limit=50), comparison_file(id), export_dataset(build_id,destination), export_packet(build_id,output), import_packet(path) preserve the original SF30 contracts.
Default comparison uses the same mapping and actual resource identity. Absence from one selected export is an observed source difference, not proof of a clinical deletion. Actual native deleted references remain separately visible.

## Incremental retained-resource state

compose(body) -> {source,composition}; body {baseSourceId,deltaSourceIds:[in original sequence],label,resolutions:[]}.
The base is a complete export. Deltas bind the same source scope/resource/type filters, advance the actual modification coverage without a gap and are applied in the reviewed order. Upserts replace the corresponding resource identity; only explicit unambiguous native DELETE references remove a retained identity. Absent resources do not implicitly delete anything. Historical/group membership completeness is not invented.
Unresolved conflicting same-capture duplicates require explicit resolution:
{sourceId,resourceType,id,fileId,line}.
Every selected resource and deletion remains linked to the exact unchanged original capture file/line. Composition retains its original source packets and can be independently reconstructed.
This is a retained resource state for downstream datasets; the UI also keeps each original modification export individually accessible.

## Whole receiving

export_workspace(output_path) -> {file,bytes,sha256,workspaceId,schema}.
import_workspace(packet_path) -> {workspaceId,reconstructed:true,state}; imports into a fresh empty workspace and resumes the identical packet identity after interrupted receiving. It retains connections, discovered source, export definitions, original operation results, captures, mappings, native builds/comparisons, and original private source files. Credentials and transient locks/process/cache files are excluded. Original native datasets are reconstructed against their declared CSV/config/snapshot identities.

Dataset packet receiving uses the original six-member SourceFormat packet and rebuilds from the complete source and reviewed mapping. A full workspace archive is the separate receiving choice for editable operations and source history.

## HTTP routes reserved for root

All /api routes reuse the maintained SDMX private capability, exact Host/Origin/CSP/streaming upload and shutdown pattern. A single original Workspace supplies both HTTP and CLI. The server startup owns the credentials path and startup token; request URLs never carry that token.

GET /api/catalogue
GET /api/state
GET /api/auth-profiles
POST /api/connections {complete connection}
GET /api/connections/:id
POST /api/connections/:id/discover {}
POST /api/connections/:id/groups {url:null|original nextUrl}
POST /api/exports {complete export definition}
GET /api/exports/:id
POST /api/exports/:id/advance {operationId}
GET /api/operations/:id
POST /api/operations/:id/status {statusUrl,reason}
POST /api/operations/:id/cancel {requestId}
POST /api/sources (raw application/zip; X-Source-Name / X-Source-Label)
GET /api/sources/:id
GET /api/sources/:id/rows?resourceType=&kind=&offset=&limit=&query=
GET /api/sources/:id/rows/:fileId/:line
GET /api/sources/:id/files/:name (exact retained member)
GET /api/sources/:id/packet (original complete source ZIP)
POST /api/sources/:id/mapping {resourceType,name}
POST /api/sources/:id/preview {plan,limit}
POST /api/compositions {baseSourceId,deltaSourceIds,label,resolutions}
POST /api/plans {complete mapping}
GET /api/plans/:id
POST /api/builds {sourceId,planId}
GET /api/builds/:id
GET /api/builds/:id/query?native_scalar_parameters
GET /api/builds/:id/packet (original dataset/customer packet)
GET /api/builds/:id/dataset (data.csv/dataset.json/fhir-bulk-lineage.json ZIP)
POST /api/packets (raw complete dataset/customer ZIP)
POST /api/comparisons {beforeId,afterId}
GET /api/comparisons/:id/changes?offset=&limit=
GET /api/comparisons/:id/file
GET /api/workspace/packet
POST /api/workspace/packet (raw whole workspace ZIP; fresh workspace only)

## Product flow

Connect or receive original workspace → inspect capabilities/Groups → choose explicit full native export → save request → run/reopen same operation → inspect resources/identities/original outcomes and source fields → review projection → build/query the original native dataset → compare observed editions or compose retained resource state from explicit native deltas → export original merchant input, original SF88 customer packet, or whole editable workspace. Source, mapping and operation detail expose original identities without making hashes the primary UI.

Merchant/customer CLI uses the original SF30 dataset release store and original SF88 dataset buyer. It does not introduce a second payment implementation or classify healthcare data through invented labels. The original public operating example keeps its publisher's sample-data classification through source, export and receiving.
