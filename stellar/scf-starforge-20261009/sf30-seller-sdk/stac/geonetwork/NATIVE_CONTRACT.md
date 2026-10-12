# Native GeoNetwork client contract

This directory extends the existing STAC receiving application. `native.mjs` is an independent Node client for the selected GeoNetwork catalogue; it has no dependency on the workspace model and imports only `node:crypto`. The workspace owns reviewed plans, durable operation state, source hosting, record comparison, archive inspection and user decisions. This client owns exact native requests, bounded responses, safe XML parsing and transport outcomes.

The contract was read from **GeoNetwork 4.4.12, commit `45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4`**. A GeoCat deployment must be identified through its actual native API before mutation; the upstream version is not a claim about a customer's installed product. This source was implemented from the native API and harvester code. A client check does not establish that a GeoNetwork installation has completed a harvest.

## Connection and authentication

```js
import { createGeoNetworkClient } from './native.mjs';

const native = createGeoNetworkClient({
  baseUrl: 'https://catalogue.example/geonetwork',
  portal: 'srv',
  language: 'eng',
  auth: {
    usernameEnv: 'GEONETWORK_USERNAME',
    passwordEnv: 'GEONETWORK_PASSWORD',
    // An existing private session may instead use cookieEnv and csrfEnv.
  },
  expectedVersion: '4.4.12',
  allowHttp: false,
  timeoutMs: 30000,
  maxResponseBytes: 8 * 1024 * 1024,
  maxMefBytes: 64 * 1024 * 1024,
}, {
  environment: process.env,
  fetchImpl: globalThis.fetch,
  signal: operationAbort.signal,
  onExchange: exchange => savePrivateExchange(exchange),
});
```

Use the installation context as `baseUrl`, without `/srv/api`. REST requests use `/{portal}/api`; legacy harvester requests use `/{portal}/{language}/admin.harvester.*`. HTTP needs explicit `allowHttp: true`. Credentials are environment references, never inline configuration values. Basic authentication is sent only to the selected origin; existing session and CSRF values may be supplied with `cookieEnv` and `csrfEnv`. Deployment authentication must actually accept the selected mechanism.

The client retains same-origin cookies in memory, applies their path, expiry and Secure rules, and uses `XSRF-TOKEN` with `X-XSRF-TOKEN`. It refuses automatic redirects and does not start a login flow, expand cookies to a parent domain, print authentication headers or export cookies. Mutations require authenticated identity and, when configured, an exact installed-version match. Non-safe HTTP methods also require the native CSRF token. Session expiry is a returned result for the existing operator to resolve.

The default body limits are 8 MiB for ordinary responses and 64 MiB for MEF; explicit maximums are 64 MiB and 512 MiB respectively. Timeouts range from 100 ms to 300 s. Response streaming and cancellation are bounded, including a transport implementation that does not promptly honor an AbortSignal. `close()` aborts owned requests and clears session cookies.

Native source: [MeApi](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/services/src/main/java/org/fao/geonet/api/users/MeApi.java), [SiteApi](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/services/src/main/java/org/fao/geonet/api/site/SiteApi.java).

## Return and uncertainty interface

Every method returns:

```js
{ status, exchange, value }
// A composed reader can additionally return exchanges: [ ... ].
```

`exchange` contains endpoint, method, native path, query/body SHA-256, request/response byte counts, response hash, status, timestamps, elapsed time, mutation/attempted flags, error code, uncertainty and Retry-After. It excludes query values, credentials and native response bodies. Save record XML, reports and MEF bytes only in the existing private operation.

`GeoNetworkError` exposes `code`, `status`, `mutation`, `uncertain`, `exchange` and, where available, a sanitized native error identity plus message/body hashes. HTTP 401/403/404/405/413/415/429 are explicit rejections when a complete rejection is observed. Timeout, network loss, unrecognized acknowledgement, server failure or an exchange-save failure after dispatch can leave a mutation uncertain. The client never automatically repeats a mutation. Both legacy run and stop are classified as mutations although the native API uses GET.

`onExchange` is invoked once per dispatched request. It can persist transport evidence in the original operation; a callback failure is surfaced. It is not a substitute for the workspace's durable pre-dispatch record. Successful HTTP status is not a blanket success for a multi-record processing report. The caller must inspect that original report and read current state.

## Public methods

In this table `API` means `baseUrl/{portal}/api`; `LEGACY` means `baseUrl/{portal}/{language}`. UUID arrays are explicit, distinct and contain 1–500 values. All optional options objects support `signal`.

| Method | Actual request | Result and responsibility |
| --- | --- | --- |
| `identify()` | GET `API/me`, `API/site/info`, `API/operations`, `LEGACY/admin.harvester.info?type=harvesterTypes&type=validation` | Actor, groups, version, operations and actual enabled harvester types. Unauthenticated `me` is 204. Restricted legacy discovery is reported as unavailable, not as an empty installed catalogue. |
| `listHarvesters({id?})` | GET `LEGACY/admin.harvester.list` | Caller-visible nodes, normalized configuration hash, current running/result/error observations. |
| `addHarvester(plan)` | POST XML `LEGACY/admin.harvester.add` | Native numeric ID and acknowledgement; exact list readback is required. |
| `updateHarvester(id, plan)` | POST XML `LEGACY/admin.harvester.update` | Same ID acknowledgement; an unknown ID can still be acknowledged natively, so readback is required. |
| `runHarvester(id)` | GET `LEGACY/admin.harvester.run?id=...` | Native acceptance status, `terminal: false`. It starts scheduling; it does not report a completed harvest. |
| `stopHarvester(id)` | GET `LEGACY/admin.harvester.stop?id=...` | Native acceptance/rejection status; poll actual running state and history. |
| `history({id,uuid,page=0,size=20})` | GET `LEGACY/admin.harvester.history` | Stable native entry IDs/dates, result/error projection, original entry hashes and pagination. |
| `inventory({harvesterUuid?,uuids?,from=0,size=200})` | POST `API/search/records/_search` | Caller-visible indexed ownership union, exact total when available, shard/timeout flags and next offset. |
| `readRecord(uuid,{approved=true,includeSharing=true})` | GET `API/records/{uuid}/formatters/xml?withInfo=true&increasePopularity=false&addSchemaLocation=false&approved=...`, optionally GET sharing | Exact XML, metadata separated from database `geonet:info`, actual owner and sharing. |
| `listAttachments(uuid,{approved=true})` | GET `API/records/{uuid}/attachments?sort=name&filter=*&approved=...` | Actual file descriptors, size and visibility; no native content checksum or unconditional private-file completeness. |
| `exportMef(uuids,{approved=true,withXLinksResolved=false,withXLinkAttribute=true})` | GET `API/records/zip` with FULL, explicit UUIDs, no related records, attachments requested and explicit approved selection | Bounded ZIP bytes/hash; the caller must validate all archive members against actual record and attachment inventories. |
| `readSharing(uuid)` | GET `API/records/{uuid}/sharing` | Native privilege rows; misleading response `owner` is renamed `callerUserId`. |
| `writeSharing(uuid,{clear,privileges})` | PUT JSON `API/records/{uuid}/sharing` | Native 204; exact sharing readback remains necessary. |
| `validateRecord(uuid,{approved=true})` / `validateRecords(uuids,{approved=true})` | PUT `API/records/validate?uuids=...&approved=...` | Native 201 processing report with per-record validation outcomes. |
| `readValidation(uuid,{approved=true})` | GET original XML formatter with database information | Persisted validity, details, metadata hash and change date; no validator execution ID. |
| `readWorkflow(uuid,{approved=true})` | GET `API/records/{uuid}/status/workflow/last?approved=...` | Original current workflow response. |
| `submitRecords(uuids,{message=''})` | PUT JSON `API/records/submit` | Original multi-record processing report. |
| `approveRecords(uuids,{message='',directApproval=false})` | PUT JSON `API/records/approve` | Original approval report, preserving explicit direct-approval selection. |
| `publicationOptions()` | GET `API/records/sharing/options` | Actual deployment publication configurations. |
| `publishRecord(uuid,{publicationType})` | PUT `API/records/{uuid}/publish?publicationType=...` | Native 204 for the explicitly reviewed publication option. |
| `close()` | No new native request | Cancel owned transport and discard in-memory session state. |

### Normalized identity

```js
{
  authenticated: true,
  actor: { id, username, profile, admin },
  groups: [{ id, profiles: ['Editor', 'Reviewer'] }],
  version: { appVersion, appSubVersion, gitCommit },
  versionMatches: true, // null when no expectedVersion was selected
  options: {
    operations: [{ id, name, harvesterAllowed }],
    validationOptions: [...],
    harvesterTypes: [...],
    harvesterDiscovery: 'available',
    discoveryError: null,
  },
}
```

Site diagnostics, environment, database information and identity fields unrelated to operation authorization are not returned. Access is checked by native endpoints, not inferred solely from a group label.

### Harvester plan and XML

```js
{
  nativeName: 'Reviewed collection source [stable-operation-marker]',
  marker: 'stable-operation-marker',
  ownerId: '1',
  ownerGroupId: '2',
  sourceUrl: 'https://original-source.example/collections/SHA256.json',
  privileges: [{ groupId: '2', operations: ['view', 'download'] }],
  validation: 'NOVALIDATION',
  transform: 'schema:iso19115-3.2018:convert/stac-to-iso19115-3',
  loopElement: '/collections',
  recordIdPath: '/id',
  // Optional native source API-key header; environment reference only:
  // sourceAuth: { header: 'Authorization', apiKeyEnv: 'SOURCE_AUTHORIZATION' }
}
```

`buildSimpleUrlXml(plan,{environment,operations,id?})` produces the native `node type="simpleurl"` document. It sets explicit owner user/group, full source URL, an inactive one-run schedule, `overrideUuid=SKIP`, `/collections` and `/id`, empty pagination, the installed STAC transform, selected validation and exact privileges. It disables source Basic login, translation and batch edits. It does not invent a native UUID; the native add operation assigns it. The stable marker is retained in the reviewed name for lost-add reconciliation.

Harvester operation IDs **2 and 4 are rejected by native AbstractParams**. Reserved usable names are view (0), download (1), notify (3), dynamic (5) and featured (6); editing (2) remains a separate record-sharing operation. The actual operation catalogue is read at runtime. Reserved groups include guest (-1), intranet (0) and all (1); these are distinct from owner/user IDs. Direct sharing uses native rows `{group: -1, operations: {view:true}}`, with explicit `clear`.

Native validation enum values are exactly `NOVALIDATION`, `XSDVALIDATION` and `SCHEMATRONVALIDATION`. The legacy discovery response supplies the installed values. The general transform listing is not proof that the STAC transform is installed: schema STAC conversion has a different naming convention. No supported raw STAC dry-run endpoint was found in this source selection. Do not replace its Java/XSL conversion with a purported equivalent per-item mapper.

Native source: [SimpleUrlParams](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/harvesters/src/main/java/org/fao/geonet/kernel/harvest/harvester/simpleurl/SimpleUrlParams.java), [Info](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/harvesters/src/main/java/org/fao/geonet/services/harvesting/Info.java), [OperationsApi](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/services/src/main/java/org/fao/geonet/api/operations/OperationsApi.java), [ReservedGroup](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/domain/src/main/java/org/fao/geonet/domain/ReservedGroup.java).

### Record identifiers and complete-source scope

`nativeRecordId(originalCollectionId)` reproduces the native original-string URL normalization for conventional HTTP, HTTPS and FTP URLs. Ordinary identifiers and URNs remain unchanged. Ambiguous JVM URL forms and unsupported schemes require review instead of a guessed mapping.

GeoNetwork validates a Java URL and then applies a greedy last-slash expression to the **original string**, not the parsed URL pathname. A slash in a query or fragment can therefore affect the resulting ID; percent escapes are not decoded. The workspace must retain both the original Collection ID and normalized native UUID, reject collisions, and ensure that portable UUID paths are single record names.

The transform imports collection-level series descriptions. Preserve full original Collection metadata and absolute original links. Serve one immutable, complete selected collection document; partial page results are not a safe replacement feed.

Native source: [SimpleURL Harvester](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/harvesters/src/main/java/org/fao/geonet/kernel/harvest/harvester/simpleurl/Harvester.java), [Aligner](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/harvesters/src/main/java/org/fao/geonet/kernel/harvest/harvester/simpleurl/Aligner.java).

## Harvest observation and recovery

There is **no SimpleURL option in this selection that disables deletion after an incomplete/error response**. The native retrieval path can swallow unsuccessful retrieval and continue to cleanup. A one-run setting also does not guarantee deactivation after every failure. Whole-source equality preflight, original native record ledger, verified backups and actual history/current-state reconciliation are substantive requirements of a refresh.

Before a mutation, persist its exact reviewed input and the actual configuration/source/history baseline. After a lost add reply, locate the unique retained marker and compare complete expected configuration rather than posting another add. After update, compare the current selected node even when the acknowledgement was successful. After run, reconcile new native history IDs/hashes and current record state; `running=false` alone is not proof that the intended run completed.

History parsing retains native `id`, date, harvester UUID/name/type, elapsed time, result/error and original XML entry hash. Native reported page count uses integer division; the client exposes both `reportedPages` and a ceiling-based `pages` count. Sanitized projections omit credentials and hash error messages. Read pages until the selected native baseline is reached; the client does not create a second job identity.

`inventory` combines `harvesterUuid` with any explicit historical UUID ledger using an OR query. Current indexed records are caller-visible and may lag the database; a hidden, deleted or detached record cannot be disproved by an empty search alone. A timed-out search, failed shard or lower-bound total is not complete. Pagination is not an atomic snapshot, so the workspace must compare original database-backed record/configuration identities immediately before guarded changes.

Native source: [Harvester](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/harvesters/src/main/java/org/fao/geonet/kernel/harvest/harvester/simpleurl/Harvester.java), [History](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/harvesters/src/main/java/org/fao/geonet/services/harvesting/History.java), [UUIDMapper](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/harvesters/src/main/java/org/fao/geonet/kernel/harvest/harvester/UUIDMapper.java).

## XML, ownership, validation and publication

`parseXml(input,{maxBytes,maxDepth,maxNodes})` returns `{root,xml}`. Each element has `name`, `localName`, `prefix`, `namespaceURI`, `attributes`, `children`, exact source `start/end` and namespace mappings. Children are text strings or elements. The parser supports the native ASCII qualified names, UTF-8, namespaces, comments, CDATA and the initial declaration. It rejects DTDs, entity declarations, external/general entities, undeclared prefixes, duplicate expanded attributes and excessive structure. Predefined and numeric XML references are decoded exactly once.

```js
const { root } = parseXml(infoXml);
const general = xmlChild(root, 'general');
const recordUuid = xmlText(xmlChild(general, 'uuid'));
```

`xmlChild(node,localName)` selects the first direct child or null. `xmlChildren(node,localName?)` returns direct elements. `xmlText(node)` returns already-decoded descendant text. Check namespace and duplicate-child requirements in the calling contract. Do not apply another entity decoder: `&amp;#x61;` is literal `&#x61;`, not the character a.

`parseRecordXml` separates exactly one direct `geonet:info` element in `http://www.fao.org/geonetwork`. The result retains `rawXml`, `metadataXml`, byte-oriented `metadataSha256`, actual `ownerId`, source, harvesting flag/information, change dates and edit/download observations. Missing edit/download flags are null. This is exact XML separation, not semantic canonicalization. The sharing response's field named `owner` contains the **caller**, so it is renamed `callerUserId`; it must not replace actual metadata ownership.

The editor-only `PUT /records/{uuid}/validate/internal` requires an active editor session and is unsuitable for ordinary post-harvest validation. `validateRecord` therefore delegates to native stored-record `PUT /records/validate`, returning its original 201 processing report. `readValidation` reads persisted `valid` and `valid_details` from database-backed XML, tied to metadata hash/change date. It has no validation run ID and cannot prove that a particular lost PUT completed.

Submission, approval and publication are separate native transitions. Inspect per-record failures and native current status. Publishing requires the actual deployment publication option and permissions; successful approval does not itself establish public access. Sharing clear/update also remains subject to reserved-group and owner-group rules, so read it back.

Native source: [stored-record ValidateApi](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/services/src/main/java/org/fao/geonet/api/processing/ValidateApi.java), [editor MetadataValidateApi](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/services/src/main/java/org/fao/geonet/api/records/MetadataValidateApi.java), [MetadataSharingApi](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/services/src/main/java/org/fao/geonet/api/records/MetadataSharingApi.java), [StatusApi](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/services/src/main/java/org/fao/geonet/api/status/StatusApi.java).

## Full MEF and the exact partial-recovery boundary

`exportMef` requests FULL MEF 2 with explicit UUIDs, attachments and no related records. It verifies bounded transport and the ZIP signature, then returns bytes and SHA-256 with `archiveInventoryVerified:false`. A complete receiving application must inspect ZIP headers/central directory, CRC/size, selected record identities, metadata/info and every actual attachment.

Native MEF 2 uses Java NIO ZIP filesystem access. Valid archives can contain top-level `index.csv` and `index.html`; selected record directories contain metadata, info, public/private data, optional metadata-format variants and optional `applschema` feature-catalogue files. The native importer enumerates top-level directories, so an unrelated record root is consequential, not harmless packaging.

The attachment list returns native descriptors including filename, size, visibility, metadata UUID, version and modification time. It has no content checksum; the attachment HTTP ETag is a descriptor-derived digest, not a file-content hash. Non-editors can receive only public files. An HTTP 200 list is not proof that all private files were visible.

The client explicitly requests attachment `filter=*`. The selected native MEF exporter uses the default `*.*` listing, which can omit extensionless files. It also selects approved attachments even when metadata approval selection differs. Compare all actual descriptor names, visibility and size with archive entries, using actual edit/download permission. External STAC href targets are not native uploaded attachments.

MEF import does **not** restore harvesting ownership. The selected importer sets `isHarvested=false`; importing over an existing record may retain a raw hidden harvester UUID, while inserting a new record does not recreate that association. A subsequent native cleanup can still act on the raw UUID relationship. The native `/api/harvesters/{uuid}/assign` operation detaches records; it is not a supported reattachment route. No supported ownership-reattach endpoint was found in this selection.

Accordingly this client does not expose an invented transactional restore or silently import archives. Preserve raw ever-owned UUID ledger, prior XML/sharing, exact archive, native state and partial recovery outcome. Any later authorized native import must review collisions, concurrency, owner/group/version/publication choices and reharvesting consequences. Restored metadata/files are not proof that the original harvesting relationship or workflow history was restored.

Native source: [AttachmentsApi](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/services/src/main/java/org/fao/geonet/api/records/attachments/AttachmentsApi.java), [FilesystemStore](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/core/src/main/java/org/fao/geonet/api/records/attachments/FilesystemStore.java), [MEF2Exporter](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/core/src/main/java/org/fao/geonet/kernel/mef/MEF2Exporter.java), [MEF2Visitor](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/core/src/main/java/org/fao/geonet/kernel/mef/MEF2Visitor.java), [Importer](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/core/src/main/java/org/fao/geonet/kernel/mef/Importer.java), [HarvestersApi](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/services/src/main/java/org/fao/geonet/api/harvesting/HarvestersApi.java).

## Complete native configuration identity

The parsed harvester now exposes `numberOfRecordPath`, `pageFromParam`, `pageSizeParam`, `scheduleEvery`, `batchEdits`, `translateContent`, `translateContentLangs`, `translateContentFields`, `ifRecordExistAppendPrivileges`, `categories`, `searches` and `icon` in addition to its original projections. The builder selects empty pagination, schedule `0 0 0 ? * *`, `batchEdits=[]`, no translation, no category, one empty search, `blank.png`, and no appended privileges. The caller must compare these fixed choices when accepting an existing native harvester.

`configurationSha256` with `configurationDigestVersion=native-node-v2` covers the complete native node: namespace-aware names, sorted attributes and ordered content, excluding only direct native runtime `info` and `error` elements. Whitespace between child elements is ignored; scalar text remains exact. Unknown native configuration fields and private source authentication values affect the digest. Private values are never returned as part of that canonical tree. Runtime active/inactive status is still configuration and therefore changes this digest; retain the final stopped configuration separately.

The source for these fields is the same pinned [SimpleUrlParams](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/harvesters/src/main/java/org/fao/geonet/kernel/harvest/harvester/simpleurl/SimpleUrlParams.java) and [AbstractHarvester](https://github.com/geonetwork/core-geonetwork/blob/45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4/harvesters/src/main/java/org/fao/geonet/kernel/harvest/harvester/AbstractHarvester.java).
