# Aviary provider contract

This application uses Aviary's native bulk-import structure and the interfaces exercised by AVP's maintained importer and transcript exporter. The operating instructions are in [README.md](README.md). This file records the provider-specific choices that affect migration and recovery.

## Original sources

| Source | Retained identity |
| --- | --- |
| [AVP import/export repository](https://github.com/WeAreAVP/aviary-api-scripts/tree/9f189144f6434e6561696983edce17494aa66dd0) | Commit `9f189144f6434e6561696983edce17494aa66dd0`, dated September 29, 2026 |
| Full-package importer | Blob `e8c612495fb851b1e756a32143c032feaa5d264d` |
| Media importer | Blob `20809b4ebd4024586a47e1a470d595d83fa48916` |
| Transcript exporter | Blob `0b57ecff919740a17fbdf71ac304f981221ebc7b` |
| [Native bulk-import guide](https://coda.aviaryplatform.com/bulk-importing-248) | Resource, media, transcript, index and supplemental CSV structure |
| [Aviary API guide](https://coda.aviaryplatform.com/aviary-api-14) | Organization API access and documentation route |
| [Current API documentation](https://www.aviaryplatform.com/api/v1/documentation) | Receiving service's published API reference |

The application is original implementation. The provider repository is used to establish request/response interfaces. Its example Steve Zahn OHMS transcript has an explicit distribution restriction and is excluded from our source example.

## Native package and mapping

The ZIP has one `aviary-package/` root. Its five CSV basenames match the provider's native templates. Every CSV uses UTF-8, explicit column order, proper quoting and complete row widths. Selected file paths refer to `/aviary-package/{asset-directory}/{filename}` within that archive. Filenames include a source-hash prefix; equal source bytes are reused at a shared destination, and a destination collision cannot substitute different bytes.

Resource User Key and Media User Key are separate four-digit namespaces, 1000–9999. They link original CSV rows within an import. They are not remote lookup keys: Aviary does not preserve them as provider record identifiers. The application retains original catalogue identifiers and the reviewed key map, then separately records every returned provider ID.

A local resource/media key and an existing Aviary parent ID are mutually exclusive choices. In the media table, an existing `aviary ID` identifies its resource; in transcript and index tables it identifies the media file; in supplemental rows it identifies the resource. A local relationship resolves through the same saved key map and the original parent's action.

Explicit row exclusions retain the original source row, reason and mapping history. Excluded rows do not create provider records. Included children still need an included local parent or an explicit existing provider parent.

| Field family | Conversion |
| --- | --- |
| Resource Public | `yes` → public; `no` → restricted; blank → private |
| Resource Featured | Yes/no to the provider's Boolean representation |
| Media Public / 360 Video | Yes/no to the provider's Boolean representation |
| Transcript/index Public | The provider's `is_public` value |
| Supplemental Public | The provider's yes/no `access` value |
| Sequence # | Positive integer ordering within the relevant parent |
| Metadata | `|` separates values; `;;` separates vocabulary and value where present |

Resource metadata uses the provider's resource field labels. Media metadata uses the corresponding lowercase underscore field names. Mapped additional resource/media columns remain explicit custom metadata. Receiver-specific fields, vocabularies and geolocation semantics need the receiving collection's actual configuration.

The maintained example templates contain several source defects that must be mapped deliberately: transcript/index `Tile` headers where the importer reads `Title`, a repeated media key, and unquoted commas that widen a resource row. The full importer also reads Alt Date and Call Sign fields absent from its resource template. The workbench retains these inputs and requires an explicit correction or exclusion instead of shifting columns or discarding a row.

## Requests and identity

Requests use the configured HTTPS organization origin plus `/api/v1/`. The API token is read from an environment variable. The current importer uses Bearer authorization; the configuration also supports raw authorization and an organization-id header for the receiving service's actual configuration. Only the variable name is saved.

| Operation | Provider route and body | Original identity retained |
| --- | --- | --- |
| Create resource | POST resources; JSON collection_id, title, access, metadata and configured resource fields | Response data.update.id |
| Create linked/embed media | POST media_files; JSON parent, link/embed, metadata and media_file object | Response data.id |
| Create local media | POST media_files; parent/filename/display/access/order query and multipart media_file field containing presigned | Media ID and original storage upload description |
| Create staged media | POST media_files with the original media_staging_id and parent parameters | Media ID |
| Upload storage bytes | PUT each original storage URL with its exact byte range and Content-Length | Original media/upload/part identity, byte count, SHA256 and returned ETag |
| Complete local media | GET media_files/{id}/complete; multipart adds original upload_id and parts_count | Separate completion action for that media |
| Save media metadata | PUT media_files/{id}; JSON metadata and media_file object | Same original media ID |
| Add transcript/index | POST transcripts or indexes; multipart associated_file and original media parent fields | Returned attachment ID |
| Add supplemental file | POST supplemental_files; multipart associated_file and original resource parent fields | Returned supplemental ID |
| Read transcript exports | GET resources/{id}, then GET transcripts/{id}, then each declared export file | Original resource/transcript/format and exact retained file bytes |

Supplemental files belong to resources. Their creation occurs once per supplemental row, outside the media loop. Completing a resource never marks its unfinished media or attachments complete.

The original transcript exporter obtains `data.transcripts_id` from the resource and each transcript's `data.export` format map. A format supplies `file_name` and `file`. Downloads preserve the exact bytes and response length/hash. An additional-page marker is an explicit incomplete result; it cannot turn a partial ID list into a completed export.

## Local media and storage

The current importer uses a single presigned PUT for smaller media and supports multipart upload for larger files. Its default threshold and part size are 100 MiB. The client accepts configured part sizes from 5 MiB through 5 GiB and enforces the native guide's 25 GB media ceiling. A multipart response must provide its original upload_id, part_size, parts_count and one URL for each contiguous part number. The final part contains the actual remaining bytes.

The client verifies the full local file length and SHA256 against the saved source, holds that file descriptor continuously and reads exact ranges from it. It checks descriptor identity before and after reading. Attachments use the same held-file mechanism. This binds the bytes sent to the reviewed plan even if a path is replaced while the migration is running.

Automatic write retries are limited to the same original storage part and byte range. The request supplies no Aviary authorization header to the storage origin. Completion uses the original media/upload identity. A successful completion remains separate from subsequent metadata and attachment actions.

If a creation response is lost, adopting the actual media ID does not create another media record. When its GET model omits storage URLs, the first supplied original upload manifest must match the mode, file size and requested part size in that saved creation request. Every subsequent manifest must preserve the observed upload identity and all dispatched part bindings.

A completed upload bypasses stale or removed storage URLs during cold reopen. An unfinished part needs a current URL for that original upload.

## Durable operation and receiving

The saved operation pins the workspace UUID, source manifest, mapping revision/hash, target configuration and operation ID. Each action saves its immutable request before network dispatch. Confirmed actions retain their original response and provider ID. Creation response loss or interruption leaves an uncertain action for original-record reconciliation; it never causes automatic duplicate creation.

HTTP authentication, permission, rate-limit, conflict and server responses retain their distinct meanings. The provider's Retry-After is preserved. A body timeout, short declared response or unusable successful creation response retains uncertainty. GET /complete is treated as a mutation despite its HTTP verb. Explicit same-record metadata updates and original storage part retries keep their own request bindings.

The complete handoff includes application source, every original source file, SQLite state, all mapping revisions and operations, current review, selected native package and retained transcript exports. A draft mapping can be exported: the handoff records that draft and the latest usable native-package revision, or records why a native package is unavailable.

Provider response/event copies remove temporary storage and signed download capability URLs. Original immutable action requests retain their identity. The receiving process supplies its own selected token environment. ZIP receiving verifies the complete member list, each hash, safe paths, original workspace UUID and original source manifest before publishing the received workspace.

The original public USGS example and the complete loopback API/storage receiving program are separate inputs. The first preserves actual publisher media, transcript text, credit and public-domain provenance. The second exercises the maintained client, HTTP bytes, interruption recovery, original IDs and portable application on explicitly generated receiving records. Receiving into an institution's configured Aviary collection uses that collection's normal provider service and access.
