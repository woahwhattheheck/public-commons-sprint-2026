# Aviary provider contract

This application preserves an original catalogue, its reviewed Aviary mapping, the complete native import package, and each REST operation through receiving and recovery. [README.md](README.md) describes the operator workflow. This document records the provider interfaces and the evidence used to advance a saved migration.

## Authoritative sources

| Source | Retained identity and use |
| --- | --- |
| [Published OpenAPI schema](https://www.aviaryplatform.com/aviary-api.json) | HTTP 200 retrieved October 12, 2026 at 09:20:11 UTC; 200,348 bytes; SHA256 `1bf29e93ede6bc7aa755be25603e1fed4ddb899dac1964f4f63eaaca930c1291`; OpenAPI 3.0.0, API info version 1.0.0. The actual [documentation page](https://www.aviaryplatform.com/api/v1/documentation) names this schema. |
| [AVP import/export repository](https://github.com/WeAreAVP/aviary-api-scripts/tree/9f189144f6434e6561696983edce17494aa66dd0) | Commit `9f189144f6434e6561696983edce17494aa66dd0`, dated September 29, 2026. Establishes the maintained JSON/form request conventions and native CSV fields. |
| Full-package importer | Original Git blob `e8c612495fb851b1e756a32143c032feaa5d264d`; original media, metadata and thumbnail-URL parameter handling. |
| Media importer | Original Git blob `20809b4ebd4024586a47e1a470d595d83fa48916`; presigned PUT, multipart identity and the original completion request. |
| Transcript exporter | Original Git blob `0b57ecff919740a17fbdf71ac304f981221ebc7b`; resource transcript IDs, export format map and exact file receiving. |
| [Native bulk-import guide](https://coda.aviaryplatform.com/bulk-importing-248) | Resource, media, transcript, index and supplemental CSV structure. |
| [Aviary API guide](https://coda.aviaryplatform.com/aviary-api-14) | Organization API access and the published documentation route. |

The application is original implementation. The provider sources establish its interfaces. AVP's example Steve Zahn OHMS transcript has an explicit distribution restriction and is excluded from the source example. The public USGS example retains its own publisher and rights records.

The captured OpenAPI contains some malformed JSON examples and inconsistent example labels. These are retained as source limitations. Runtime responses must be valid JSON with the expected endpoint-specific identity; the client does not repair a response into a success.

## Native package and mapping

The ZIP has one `aviary-package/` root. Its five CSV basenames match the provider's native templates. Every CSV uses UTF-8, explicit column order, proper quoting and complete row widths. Selected file paths refer to `/aviary-package/{asset-directory}/{filename}` within that archive. Filenames include a source-hash prefix. Equal source bytes are reused at one destination; a destination collision cannot substitute different bytes.

Resource User Key and Media User Key are separate four-digit namespaces, 1000–9999. They link original CSV rows within an import. Aviary does not preserve them as remote record lookup keys. The application retains the original catalogue identifiers and the reviewed key map, then records each actual provider ID separately.

A local resource/media key and an existing Aviary parent ID are mutually exclusive selections. For media, an existing `aviary ID` identifies the resource. For transcripts and indexes it identifies the media file. For supplemental rows it identifies the resource. A local relationship resolves through the saved key map and the original parent's retained creation action.

Explicit row exclusions retain the original source row, reason and mapping history. Included children need an included local parent or an explicit existing provider parent.

| Field family | Conversion |
| --- | --- |
| Resource Public | `yes` → public; `no` → restricted; blank → private |
| Resource Featured | Yes/no to the provider's Boolean representation |
| Media Public / 360 Video | Yes/no to the provider's Boolean representation |
| Transcript/index Public | The provider's `is_public` value |
| Supplemental Public | The provider's yes/no `access` value |
| Sequence # | Positive integer in the native CSV; ordered dispatch within the relevant parent |
| Metadata | `|` separates values; `;;` separates vocabulary and value where present |
| Thumbnail | Select a local path or a URL; retain the chosen source and its distinct delivery action |

Resource metadata uses the provider's resource labels. Media metadata uses lowercase underscore field names. Additional mapped resource/media columns remain explicit custom metadata. Receiving collections supply their own available fields, vocabularies and geolocation semantics.

The maintained templates contain source defects that require deliberate mapping: transcript/index `Tile` headers where the importer reads `Title`, a repeated media key, and unquoted commas that widen a resource row. The full importer also reads Alt Date and Call Sign fields absent from its resource template. The workbench retains these inputs and requires an explicit correction or exclusion.

The REST schema has no transcript/index attachment sequence request parameter. The client dispatches their selected rows in Sequence # order and retains the numeric field in the native CSV and saved review. It does not invent a REST sort field or report unobserved provider-side ordering. Media `sort_order` follows the maintained importer.

## Configuration and requests

Requests use the selected organization HTTPS origin plus `/api/v1/`. The API token is read from the named process environment variable; its value is not saved. The maintained importer uses Bearer authorization, and configuration also permits the provider's raw authorization form.

The captured schema requires an `organization-id` header on every API endpoint. Both `organizationId` and `collectionId` must therefore be positive integer IDs. The normal client does not dispatch with a missing organization. Loopback HTTP is available only through the explicit local receiving configuration.

~~~json
{
  "schema": "stellar-forge.aviary-client.v1",
  "baseUrl": "https://yourorganization.aviaryplatform.com",
  "organizationId": "5",
  "collectionId": "43",
  "tokenEnv": "AVIARY_TOKEN",
  "authorizationScheme": "Bearer",
  "partSize": 104857600,
  "multipartThreshold": 104857600,
  "timeoutSeconds": 120
}
~~~

| Operation | Provider route and original payload | Retained result |
| --- | --- | --- |
| Create resource | POST resources; JSON collection_id, title, access, metadata and selected resource fields | Response `data.update.id` or record `data.id` |
| Create linked/embed media | POST media_files; original parent, link/embed, metadata and media_file object | Original media ID |
| Create local media | POST media_files; parent, filename, display/access/order query and multipart media_file field containing presigned | Media ID and original storage upload description |
| Create staged media | POST media_files with original media_staging_id and parent parameters | Media ID |
| Upload file bytes | PUT each original storage URL with its exact range and Content-Length | Media/upload/part identity, byte count, SHA256 and returned ETag |
| Complete local media | GET media_files/{id}/complete; multipart adds original upload_id and parts_count | Separate mutation action and its endpoint acknowledgement |
| Save media metadata | PUT media_files/{id}; original JSON metadata and empty media_file object | Original media ID and separate metadata action |
| Set local thumbnail | PUT media_files/{id}/thumbnail; multipart binary field `thumbnail_image` | Original media ID, selected source bytes/hash and provider acknowledgement |
| Add transcript/index | POST transcripts or indexes; multipart associated_file and original media parent fields | Actual attachment ID |
| Add supplemental file | POST supplemental_files; multipart associated_file and original resource parent fields | Actual supplemental ID |
| Read target membership | GET collections/{collection_id}/resources with page_number and page_size | Exact collection pages and original resource membership |
| Read transcript exports | GET resources/{id}, transcripts/{id}, associated media model, and each declared export file | Original resource/media/transcript/format and exact file bytes |

Supplemental files belong to resources. Their creation occurs once per supplemental row outside the media loop. A retained resource creation remains separate from the state of its media and attachments.

The client treats HTTP 200 with explicit `success: false`, including the transcript/index/supplemental response forms, as a provider rejection. Nested error objects retain their actual response and meaning. HTTP authentication, permission, rate-limit, conflict and server responses remain distinct.

## Parent and collection binding

Existing resource IDs are read from their original endpoint before child work. The resource GET is documented with both `data.id` and `data.resource_id` examples; the client accepts either and rejects a response containing different values for the two.

A returned collection_id must equal the selected collection. A usable provider direct_url must identify the same resource and collection. When the resource model exposes neither, the client follows the documented collection-scoped route:

~~~text
GET collections/{collection_id}/resources?page_number=1&page_size=100
GET collections/{collection_id}/resources?page_number=2&page_size=100
~~~

Its response is `{data: [...], total_entries: N}`. Pages are followed until the selected resource is found or the full reported set is exhausted. Repeated IDs, conflicting ID aliases, changing totals, premature empty pages and counts exceeding the total are explicit receiving errors. A short nonterminal page does not stop the walk.

Existing media IDs are read from their original endpoint. Their `collection_resource_id` must match the selected original resource, which is itself checked against the collection. If the resource exposes its documented `media_file_id` array, that array must contain the media ID. Fresh media readback refreshes the resource model so a newly created child is not compared with a cached pre-creation list.

Original-record reconciliation uses the same parent checks. It also compares requested title, filename, display name and custom identifier where those fields were part of the retained creation. The operator's discovery note is stored with the actual readback.

Transcript export validates each transcript's documented `resource_file_id` through its media and resource. Selecting an arbitrary transcript ID from another collection cannot silently add it to the current handoff.

## Local media, thumbnails and source bytes

The maintained importer uses one presigned PUT for smaller media and multipart upload for larger files. The default threshold and part size are 100 MiB. Configured part sizes range from 5 MiB to 5 GiB; the client preserves its 25,000,000,000-byte media ceiling. A multipart response supplies its original upload_id, part_size, parts_count and exactly one URL per contiguous part number. The final part contains the actual remaining bytes.

The client verifies the whole file length and SHA256 against the saved source, holds the source descriptor and reads exact ranges from that descriptor. Identity checks before and after reading bind transmitted bytes to the reviewed plan even if a pathname is replaced during a long migration. Attachments and local thumbnails use the same source mechanism. Empty selected upload files are rejected by the mapping review.

Automatic storage retries repeat the same original part and range. The Aviary token and organization header are never supplied to the separate storage origin. Completion retains the original media/upload identity and stays separate from metadata and attachments.

A local thumbnail is uploaded only after the original media record exists. Its action key is `media:<Media User Key>:thumbnail`; the request contains the original file descriptor, logical source path, byte count and SHA256. The documented success body is an acknowledgement array such as `{"data":["The media file thumbnail updated successfully."]}`.

For a URL thumbnail, the maintained full importer supplies `thumbnail_path` in the media creation request. The client preserves that behavior and records `CREATE_PARAMETER_ACCEPTED` after the creation response. This parameter is supported by the maintained importer source, while the separately documented thumbnail endpoint handles local image bytes.

Selecting both a local thumbnail and a URL is an explicit validation error before plan creation or provider dispatch. Both original cells remain in the review so the operator can choose one. Neither source silently takes precedence.

## Recovery of an original action

Every action stores its immutable request before dispatch. Confirmation retains its response and provider ID. Interruption preserves the existing operation, original IDs, request hash and any accepted upload parts.

| Original state | Receiving behavior |
| --- | --- |
| CONFIRMED / ADOPTED | Reuse the retained action and provider ID |
| Unknown creation outcome | Read and explicitly adopt the selected original provider ID with a discovery note |
| Unfinished storage part | Retry only its original upload identity and exact byte range |
| Expired/redacted storage URLs | Supply current URLs for the original upload through `refresh_upload` |
| Unknown completion outcome | Perform original-media and original-file reads; keep the completion mutation unchanged |
| Unknown metadata update | Compare the original requested fields against the current original media record |
| Unknown local thumbnail update | Compare the current original thumbnail bytes with the selected source |
| Provider Retry-After | Retain its deadline and delay subsequent readback or dispatch |

The only automatic write retries are original storage parts. Media metadata and thumbnail PUTs retain uncertainty after a lost response instead of repeating a potentially significant update. Although completion uses GET, the endpoint changes provider state and is treated as a mutation.

The resource update documentation explicitly appends repeatable metadata and offers `[TRUNCATE]` to clear fields. The media update documentation does not provide a replacement/idempotency guarantee. The application therefore confirms interrupted media metadata through an original-record read, comparing every requested value/vocabulary pair with its multiplicity. Additional unrelated values may remain. HTML or vocabulary normalization that prevents an exact comparison leaves the action unresolved for operator review.

### Lost media creation and upload URLs

Use the retained action's original provider ID:

~~~python
import aviary_client as client

client.reconcile(
    workspace, operation_id, "media:1001:create", original_media_id,
    "Original media record located in the receiving collection."
)
client.refresh_upload(workspace, operation_id, "1001", original_upload_record)
client.run(workspace, operation_id)
~~~

The media GET model is not documented to return multipart_upload or presigned_url. Upload URL recovery is a separate explicit step using the receiving provider's original upload record.

If no upload identity was received before the creation response was lost, that first supplied record must match the original media ID, selected upload mode, retained source length and requested part size. Later records must preserve the already observed upload ID, part layout and every dispatched part binding. The original creation request and operator note remain unchanged.

A completed upload bypasses expired or removed upload URLs when the workspace reopens. An unfinished part still requires a usable URL for the original upload.

### Lost completion response

The completion endpoint's example identifies the original media and a Boolean `processing` value, although its published JSON example has a syntax error. The client accepts a valid matching record, including a one-record data array, with an actual Boolean. An ambiguous or malformed response remains uncertain.

On an uncertain original completion, `run` reconstructs completion parameters from confirmed immutable part receipts and preserves the original parameter representation. It does not create a second upload, repeat accepted parts or call the mutating completion endpoint again.

Positive readback requires all of these observed facts:

1. The original media ID and resource/collection binding still match.
2. The documented `media_info_metadata` includes one General record whose FileSize matches the retained source.
3. The documented `media_download_url` returns exactly the original byte count and SHA256.
4. Every original upload part remains confirmed and covers the whole original file contiguously.

The download is streamed and hashed without storing another media copy. Redirects retain their origin boundaries; credentials are supplied only to the original API origin. The resulting action becomes ADOPTED with `ORIGINAL_UPLOADED_BYTES_AVAILABLE`, its original request hash, file-analysis evidence and exact readback digest.

This is an inference from the observed original file and its provider analysis. It does not reconstruct the lost completion response. The media GET schema exposes no processing-status field, so that processing value remains unknown in the readback receipt. Missing analysis, an unavailable file, a transcode with different bytes, or inconsistent identity leaves the original completion uncertain. A later `run` performs those reads again after any recorded retry deadline.

### Lost metadata or thumbnail response

Metadata recovery automatically reads the same media ID and requires all original requested fields. A matching read becomes ADOPTED with `REQUESTED_MEDIA_METADATA_PRESENT`; the original PUT request stays byte-identical.

Thumbnail recovery reads the same original media and its documented thumbnail_url, then hashes the returned image against the selected local source. Exact matches become ADOPTED with `ORIGINAL_THUMBNAIL_BYTES_AVAILABLE`. If the provider transforms the thumbnail bytes, the original action remains unresolved for an explicit provider review.

These readbacks run automatically when `run` encounters an uncertain original action. The explicit `reconcile` function also accepts the same completion, metadata and thumbnail action keys, but the supplied ID must equal the ID already present in that immutable request. Repeating reconciliation of an already retained terminal action with the same ID reuses the result.

## Result meaning and portable handoff

A run's COMPLETE state covers confirmed or positively adopted record creation, requested metadata, source-file transfers and attachments. Its `mediaDelivery` entries distinguish original completion evidence, nullable `providerReportedProcessing`, and the selected thumbnail outcome. Aviary's later encoding and player availability remain provider lifecycle facts; they are reported only when the retained API result exposes them.

The transcript exporter reads `data.transcripts_id` from a bound resource and each transcript's `data.export` format map. A format supplies file_name and file. Exact bytes, response length and SHA256 are retained. Any explicit additional-page marker remains an incomplete result. Already retained downloads are reused only after their file identity matches.

The saved operation pins the workspace UUID, source manifest, mapping revision/hash, target configuration and operation ID. The full handoff includes application source, all original source files, SQLite state, mapping revisions, operations, selected native package, current review and retained transcript exports. A draft mapping can be exported alongside the latest usable native-package revision and its explicit availability status.

Provider response/event copies remove temporary storage and signed download capability URLs. Original immutable action requests preserve their identity. The receiving operator supplies its own selected token environment. ZIP receiving verifies the complete member list, every file hash, safe paths, original workspace UUID and source manifest before publishing the received workspace.

The public USGS example preserves actual publisher media, transcript text, credit and rights provenance. The separate complete local API/storage receiving journey exercises the maintained application and its HTTP bytes, original IDs, multipart ranges, thumbnail transfer, interruption recovery and portable reopen. An institution's live migration uses its selected organization, collection and normal Aviary service.
