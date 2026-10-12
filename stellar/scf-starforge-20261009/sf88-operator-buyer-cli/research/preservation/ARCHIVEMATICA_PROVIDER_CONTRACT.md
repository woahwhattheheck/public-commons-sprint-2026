# Archivematica provider contract and original receiving

This adapter receives one reviewed bibliographic BagIt transfer through an existing **Archivematica Dashboard 1.18.0** and **Storage Service 0.24.0**. Preparation retains the original ZIP, source review, record metadata and entered processing/storage choices. The client retains one original transfer, its SIP, each distinct related DIP, all provider actions and complete receiving evidence in that same prepared workspace.

This document describes the implemented released-source contract. A source review, the local 169-record protocol receiving, and acceptance on a customer's deployment are separate outcomes. An unrun fixture or tenant ingest is not a pass. See [ARCHIVEMATICA.md](ARCHIVEMATICA.md) for operator instructions and [WORKBENCH.md](WORKBENCH.md) for the shared source-review application.

## 1. Source authority

| Surface | Exact authority |
| --- | --- |
| Dashboard 1.18.0 | [Release source](https://github.com/artefactual/archivematica/tree/243867858da329bb27ac9d5cf1747b3389d39149), commit 243867858da329bb27ac9d5cf1747b3389d39149 |
| Storage Service 0.24.0 | [Release source](https://github.com/artefactual/archivematica-storage-service/tree/0c3129d6f549e1223a119c07f0d3f9f972b9c890), commit 0c3129d6f549e1223a119c07f0d3f9f972b9c890 |
| Dashboard reference | [Official 1.18 API reference](https://archivematica.org/fr/docs/archivematica-1.18/dev-manual/api/api-reference-archivematica/) |
| Storage reference | [Official Storage Service API](https://www.archivematica.org/en/docs/archivematica-1.18/dev-manual/api/api-reference-storage-service/) |
| Automation comparison | [Artefactual automation-tools](https://github.com/artefactual/automation-tools/tree/2ff90d8f24226701761cd8db76f21719fec3c224) |
| Optional 7z reader | [py7zr 1.1.3 source](https://github.com/miurahr/py7zr/tree/v1.1.3), [first-party API](https://py7zr.readthedocs.io/en/latest/api.html) |

Relevant immutable Git blobs:

| Released module | Blob |
| --- | --- |
| Dashboard API views | 3c0edf8ee4a78042e118b345742319a138fec16c |
| Dashboard package creation | 389fba2fb8abc437491f143a3426c2b02f75e651 |
| Dashboard MCP views | 0c75c6fc333177c27781886db2f7f4021ff9dfdd |
| Dashboard MCP client | 13f5a20d6aec9d0c3c49a1e2a9920fe9530afd89 |
| MCPServer RPC | f71ad87f1bc9f5387ac4947cea054d41d5ede1eb |
| Dashboard arrangement views | 0d92eeed4bf013b7b27adc67e41e2be55efe1fb8 |
| Transfer BagIt restructuring | 2bd61f81657a390d5237c4a2c0eb5338fcb01ebc |
| SIP creation | d590f7bdc338d792243e03ce6566daae721e5908 |
| AIP bagging | 0f11b844fa497d54790862e5449a772756d6364a |
| Storage resources | cae745acf88b1c78a0b090a99465918c2c22385f |
| Storage Package model | 49599fa170c12bbaa3ad3c21e71bbe0bacecbd0c |
| Storage compression utility | 53be4d7919e29b561fc8fce7d5ca516ed2962a09 |

Successful Dashboard API responses must identify 1.18.0 through the released X-Archivematica-Version header. A supplied X-Archivematica-ID must match the selected pipeline UUID. Storage version is an explicit deployment declaration; the client does not invent a version endpoint or treat an absent header as attestation.

The client does not create tenants, pipelines, locations, processing configurations or credentials. Generic Dashboard decisions use an existing authenticated session. No automatic login or API-key substitution for that session occurs.

## 2. Prepared package and public ABI

The shared Workbench builds the current saved source review as the original BagIt ZIP before provider preparation. Preparation is offline.

~~~python
settings_template()
normalize_settings(value)
prepare(original_bag, prepared_dir, settings)
show(prepared_dir)
verify(prepared_dir)
lock(prepared_dir)
export(prepared_dir, output)
receive(source, output)
~~~

The prepared manifest has schema **stellar-forge.archivematica-prepared.v1**, packageId, released profile, exact settings, original source/review identity and a complete immutable file inventory.

- **originalBag** contains path source/bag.zip, bytes and SHA-256. The complete ZIP is retained byte for byte.
- **bagIdentity** and **bagManifestSha256** retain the original verified BagIt identity.
- **bagMembers** lists every original tag and payload member with its exact relative path, bytes and SHA-256.
- **payloadFiles** retains original data/... paths and identities.
- **records.json** is the complete original review array: identifiers, payload paths, inclusion decisions, original/reviewed Dublin Core and reasons.
- The source summary and report accompany the original package.

Producer show/verify return schema, valid:true, id, packageId, full manifest, its exact manifestSha256 and summary. The workspace uses its original **workspace.lock**. Writers and exports share that lock. Reader methods do not reacquire it.

Client ABI:

~~~python
configuration_template()
normalize_configuration(value)       # returns normalized dict; offline
validate_configuration(value)        # same validator
plan(workspace, configuration, operation_id)
show(workspace, operation_id)
run(workspace, operation_id)
refresh(workspace, operation_id)
reconcile(workspace, operation_id, evidence)
decide(workspace, operation_id, evidence)
reconciliation_template(kind='original-start-response')
~~~

Plan/show return **{operation, state}**. Run/refresh/reconcile/decide return the state object. Client show is a pure atomic saved-state read: no lock wait, provider request, credential lookup or publication. It is safe while an operation writer or portable-receiving lock is held.

## 3. Explicit reviewed settings

The complete settings schema is **stellar-forge.archivematica-settings.v1**:

~~~json
{
  "schema": "stellar-forge.archivematica-settings.v1",
  "name": "Reviewed bibliographic transfer",
  "accession": "",
  "accessSystemId": "",
  "transferSource": {
    "locationUuid": null,
    "relativePath": "reviewed-transfer.zip"
  },
  "processingConfiguration": "default",
  "pipelineUuid": null,
  "aipLocationUuid": null,
  "dip": {"policy": "required", "locationUuid": null},
  "backlog": {"policy": "arrange", "locationUuid": null},
  "fixity": {"requestAipCheck": true, "forceLocal": false},
  "note": ""
}
~~~

Null UUIDs are template placeholders. Preparation requires the actual selected existing identities. Name is a nonempty single line without separators. The source relative path is canonical, relative and ends in .zip. Processing-configuration names use 1–16 letters, digits or underscores.

The source must be an enabled TS location for the selected pipeline; the AIP destination must be an enabled AS location. A required DIP needs a selected DS UUID. Optional DIP permits a selected DS UUID or the observed related stored DIP. The not-requested policy has no DIP location. Backlog arrange requires the selected BL UUID; pause leaves it null.

The client never infers a source prefix from a receiving filename. Configuration names an environment variable whose value is the existing absolute shared/mounted source root for the selected TS location. The reviewed relative path is resolved under that root. A previously staged source is reused only after its original ZIP length/hash matches; a different file is not overwritten.

Before starting, the client lists the existing processing configurations and retains the selected XML. Released creation can silently choose default if the named configuration disappears before dispatch. The captured XML is therefore a pre-start observation, not proof of the server's applied processing configuration.

## 4. Configuration and authentication

The exact client template is:

~~~json
{
  "schema": "stellar-forge.archivematica-client.v1",
  "dashboard": {
    "baseUrl": "https://your-existing-dashboard.example",
    "username": "your-api-user",
    "apiKeyEnv": "ARCHIVEMATICA_DASHBOARD_API_KEY",
    "sessionCookieEnv": null,
    "csrfTokenEnv": null
  },
  "storage": {
    "baseUrl": "https://your-existing-storage-service.example",
    "username": "your-api-user",
    "apiKeyEnv": "ARCHIVEMATICA_STORAGE_API_KEY"
  },
  "deployment": {
    "dashboardVersion": "1.18.0",
    "storageVersion": "0.24.0"
  },
  "transferSourceRootEnv": "ARCHIVEMATICA_TRANSFER_SOURCE_ROOT",
  "timeoutSeconds": 60,
  "pollSeconds": 2,
  "waitSeconds": 30,
  "maxResponseBytes": 16777216,
  "maxDownloadBytes": 2147483648,
  "caFile": null,
  "allowLoopback": false,
  "note": ""
}
~~~

Unknown fields and literal credentials are rejected before saving an operation. API authentication is the released **Authorization: ApiKey username:key** form. Secrets are resolved from the entered environment references only when needed. They are not copied into saved requests, configuration, receipts, reports or portable source.

Dashboard API authentication differs from the session-protected MCP and filesystem routes. Supply the existing session Cookie and CSRF environment references together for processing choices or arrangement. The client sends the original Referer, Origin and CSRF header; it does not obtain a new session.

HTTPS is required, except when a loopback receiving fixture is explicitly selected. Provider URLs and pagination remain on the original authenticated origin and service path. Redirects are retained for review; credentials are not forwarded.

Python 3.11 or later is the baseline. ZIP/TAR archive reading is standard-library only. A 7z package loads the declared py7zr dependency lazily:

~~~sh
python3 -m pip install -r archivematica-requirements.txt
~~~

That file declares **py7zr==1.1.3**. No dependency is automatically installed during a saved operation. Missing/different versions return ARCHIVE_READER_REQUIRED with the original download retained. The reviewed BinaryIO/WriterFactory interface keeps the original input descriptor and hashes bounded output streams without extracting provider paths into the filesystem.

Default metadata limit is 16 MiB, with an accepted range of 64 KiB–128 MiB. Default download and expanded-archive limit is 2 GiB, configurable from 1 MiB to 8 GiB. Archive entries are capped at 30,000. These are validation ceilings, not measured throughput or guaranteed available disk/memory. The accepted source sample and original research preparation limits remain the commercial/input boundary.

## 5. One original journal

Plan is offline and immutable. It binds the original manifest, normalized configuration, released source profile and entered operation ID. It also allocates one arrangedSipUuid for a later explicitly approved backlog decision; planning creates nothing remotely.

All state lives under **operations/<operation-id>/** inside the prepared workspace.

| Member | Purpose |
| --- | --- |
| operation.json | Original package/configuration/source and planned arranged-SIP identity |
| state.json | Atomic progress that may advance |
| provider-binding.json | Existing pipeline, locations, processing and source observations |
| actions/<key>/request.json | Exact request saved before dispatch |
| actions/<key>/started.json | Entered original action and wire-response directory |
| actions/<key>/result.json | Original CONFIRMED or ADOPTED result |
| http/<id>/ | Safe request, headers, partial/complete response bytes and receipt |
| decisions/, backlog-decision.json, reconciliations/ | Original operator choices and original-response evidence |
| downloads/ | Exact receiving request and selected complete response |
| receiving/<sha>.json and .html | Complete source/byte/metadata/fixity proof and report |

Credentials are checked before the dispatch marker. After that marker exists, every continuation first reads the original response and terminal result. Interrupted, incomplete, lost or unexpected responses do not authorize a second POST. The original request remains pending until its evidence is reconciled or an exact released readback proves it.

Transfer titles, queue absence, elapsed time or similar files are not identity evidence. The released package-create endpoint allocates a fresh UUID; it has no idempotency contract and GET is not a lost-response lookup.

HTTP reads retain actual byte lengths and SHA-256. Conflicting framing, premature Content-Length EOF, encoded responses, unexpected redirects and reflected credentials produce explicit retained failures. Retry-After is persisted. A cooldown never changes an uncertain write into a safe retry.

## 6. Dashboard workflow

| Phase | Released route | Required binding |
| --- | --- | --- |
| Processing observation | GET /api/processing-configuration and selected name | Existing name and retained XML observation |
| Start | POST JSON /api/v2beta/package | Exact TS UUID:path in base64; type zipped bag; auto_approve:false; original 202 id |
| Approval observation | GET /api/transfer/unapproved/ | Original returned UUID and type |
| Approve | POST form /api/transfer/approve/ | Actual original observed directory/type; returned UUID matches |
| Transfer | GET /api/transfer/status/<uuid>/ | Original unit and actual SIP relation |
| Ingest | GET /api/ingest/status/<sip-uuid>/ | Original SIP status, separately from transfer completion |
| Job history | GET /api/v2beta/jobs/<unit-uuid>?detailed | Original job UUID, name and microservice |
| Choices | GET /mcp/list/ | Session XML for the original unit/job |
| Decision | POST form /mcp/execute/ | Exact job UUID and string choice ID; released empty response |

Transfer COMPLETE may precede a SIP UUID or return sip_uuid BACKLOG. Neither means that an AIP is stored. The client follows the actual original SIP relation, observes ingest completion and independently checks Storage.

The wait budget controls observation polling. Once ready, a run carries all selected receiving files/records through the same saved operation. The 169-record case does not require one manual click per record. Previously completed streams are hash-checked and reused on continuation.

## 7. Explicit choices and backlog

Pending choices retain original unit/job UUIDs, exact string options, saved observation descriptors and an actual matching job name/microservice label when available. An option may be an index or UUID; the UI must preserve its exact string.

~~~json
{
  "schema": "stellar-forge.archivematica-operation.v1.decision",
  "kind": "processing-choice",
  "unitUuid": "original-unit-uuid",
  "jobUuid": "original-job-uuid",
  "choiceId": "exact-observed-string",
  "observationSha256": "saved-observation-sha256",
  "note": "Reason for this original processing choice."
}
~~~

The decision must match the saved observation and still be available on that same original job. The old and current observations are retained before dispatch. Loss of the MCP response cannot be resolved simply from disappearance of a waiting job.

Pending backlog is a separate **state.pendingBacklog** value. It contains the original transfer/package UUID, reviewed BL, Storage current path, actual transfer basename, source selector, file UUID inventory and original observation.

~~~json
{
  "schema": "stellar-forge.archivematica-operation.v1.decision",
  "kind": "arrange-backlog",
  "transferUuid": "original-transfer-uuid",
  "observationSha256": "saved-backlog-observation-sha256",
  "arrangePath": "/arrange/entered-sip-name/",
  "note": "Reason for arranging this original backlog transfer."
}
~~~

Released move-to-backlog makes a new BagIt around the restructured transfer. Storage package UUID is the transfer UUID, package_type is transfer, and current_path is **originals/T**, with T the actual retained transfer basename. Storage contents.name starts **T/data/** and does not repeat originals/.

The reviewed BL must match the first enabled pipeline backlog location used by the released Dashboard. The client checks actual source browsing/inventory, requires a new entered arrangement path and journals each step separately:

1. GET /filesystem/contents/arrange/ with a base64 path.
2. POST /filesystem/create_directory_within_arrange/ with base64 paths[].
3. POST /filesystem/copy_to_arrange/ with base64 source/destination.
4. POST /filesystem/copy_from_arrange/ with the original arrangement path and the plan's fixed SIP UUID.

Selecting **/originals/T/data/objects/** copies that folder's contents into **/arrange/name/**. The released workflow attaches metadata/logs separately. Before creating the planned SIP, the client checks the exact original file UUIDs in the arrangement. A completed copy can be adopted from that exact retained inventory; an uncertain copy is not repeated blindly. Original source, choices, transfer UUID and planned SIP UUID remain fixed through portable continuation.

## 8. Storage package association

The client reads original Pipeline, Location and Package resources under /api/v2/. It checks UUIDs, enabled location purposes, pipeline relations, current location and original package origin.

AIP UUID is the recorded SIP UUID. It must have status UPLOADED at the selected AS location and selected pipeline. A DIP has a **distinct UUID**, its own DS location and a symmetric related_packages relation with that AIP. Filename similarity or coincident time does not establish this relation.

**GET /api/v2/file/<uuid>/contents/** exposes Storage database rows, not guaranteed completeness. Empty contents and nullable checksums are retained. The response envelope establishes containment; source_package records the originating unit and may be the original transfer rather than the containing AIP. Backlog rows must bind the original transfer. For an AIP row matching an actual original File UUID, the source transfer/SIP, pipeline origin and supplied checksum must not contradict that original evidence; unrelated indexed provenance is retained as observation. The checksum column carries no algorithm; a nonempty value is compared against all supported digests computed from that same bound archive member and remains corroboration only. A nonmatching value requires review as contradictory or an unsupported algorithm. An absent row does not substitute for or invalidate the complete archive/METS/byte proof.

Required DIP remains pending until an actual related stored DIP exists. Optional/not-requested outcomes are explicit. A DIP archive has its own download/member inventory and hashes; derivatives are not represented as original JSON bytes.

## 9. Retrieval and whole AIP BagIt proof

Run uses GET /api/v2/file/<uuid>/download/ and GET /api/v2/file/<uuid>/extract_file/?relative_path_to_file=... .

These routes can return **202** while offline content is retrieved and can notify storage staff. HEAD can also trigger underlying retrieval. They are therefore excluded from ordinary Refresh and are not cheap existence probes. A 202 is OFFLINE_RETRIEVAL_PENDING; receiving requires a complete bounded 200 stream.

The full downloaded archive is read from one held regular-file descriptor. ZIP/TAR/declared7z reading rejects duplicate and special/link members, unsafe paths, unexpected encryption, excessive inventory and expanded bytes. It does not extract provider member paths to disk.

The stored BagIt declaration is the **direct bagit.txt under the single archive-root directory**. Original source bagit.txt and other tags copied inside data/logs remain ordinary payload; they are not mistaken for extra root bags.

The reader checks the actual root, UTF-8 BagIt version, External-Identifier equal to original SIP, supported observed manifest algorithms, complete payload inventory and every supplied tag manifest. It supports MD5, SHA-1, SHA-224, SHA-256, SHA-384 and SHA-512. It does not assume the example's SHA-256: released bagging takes its algorithm from the configured checksum setting. Empty directories are recreated after bagging; they are inventoried without invented manifest entries.

Every actual payload member must appear in each observed payload manifest and match its digest. A supplied tag manifest must cover the complete declared non-tag-manifest tag set. Payload-Oxum, when supplied, must match actual byte/file counts. Generated METS, logs, README and all other actual archive payload remain included.

The separately returned METS and original-member extract_file responses must match the corresponding member of that **same full downloaded AIP**. This joins the complete package, extraction interface, original source and metadata.

## 10. Original file and metadata associations

Final filenames can change in the released cleanup workflow. Receiving follows actual METS FLocat rather than guessing final names.

Let T be the actual original transfer basename and B the AIP archive root.

| Original source member | Released AIP association |
| --- | --- |
| data/records/<id>.json | USE original; same transfer File UUID; PREMIS originalName %transferDirectory%data/records/<id>.json; actual FLocat |
| data/metadata/<path>, except submissionDocumentation | Copied metadata; NEW SIP File UUID; USE metadata; originalName under %SIPDirectory%objects/metadata/transfers/<metadata-prefix>/ |
| data/metadata/submissionDocumentation/<path> | Copied document; NEW SIP File UUID; USE submissionDocumentation; originalName under %SIPDirectory%objects/submissionDocumentation/transfer-T/ |
| Original root manifest* | Exact bytes copied into the metadata transfer path |
| Other original BagIt tags | Exact bytes in B/data/logs/transfers/<metadata-prefix>/logs/BagIt/; no File UUID is invented |

For direct ingest, metadata-prefix is T. For **backlog-arranged ingest**, metadata/logs use **transfer-<original-transfer-uuid>**: the released code resolves its temporary source before deriving that basename. Submission documentation still uses original T because its name is computed before the fallback. These prefixes are distinct.

The retained transfer METS is copied as transfer-T/METS.xml in submission documentation. Its OBJID is the original transfer UUID. Original File UUID, PREMIS name, size and digest join transfer METS to the AIP originals. The released AIP METS creator does not require OBJID; its actual data/METS.<sip-uuid>.xml path is bound to the stored package and BagIt SIP identity.

AIP FLocat is already a plain relative objects/... path and resolves against the enclosing data directory. Physical structMap file-pointer parent DMDID, plus file DMDID when present, selects the DC sections. Every reviewed DC value and multiplicity must remain; additional provider metadata is preserved. The included original-record set is exact. Every original BagIt member is checked through its appropriate released path and original SHA-256/length.

## 11. Separate provider fixity effect

GET /api/v2/file/<aip-uuid>/check_fixity/ is **effectful**: released code records fixity logs and signals. It is entered once as action fixity/aip only when settings request it. force_local=true is sent only when explicitly selected.

Success is strictly true, false or null. The released DIP check is unsupported and can return null. A compressed AIP with a stored checksum can return true after checking that compressed package alone. This provider observation is therefore separate from the independent BagIt/METS/original-byte proof.

False is FIXITY_FAILED; null is FIXITY_INCONCLUSIVE. Both preserve the original result. The client does not rerun the effect to obtain a different answer. Response loss requires the original action response, not an unrelated later fixity check.

## 12. Original-response reconciliation

RECONCILIATION_KINDS is exactly:

~~~python
('original-start-response', 'original-action-response')
~~~

Generate templates through the client:

~~~sh
python3 -B archivematica_client.py reconciliation-template --kind original-start-response
python3 -B archivematica_client.py reconciliation-template --kind original-action-response
~~~

Start evidence:

~~~json
{
  "schema": "stellar-forge.archivematica-operation.v1.reconciliation",
  "kind": "original-start-response",
  "requestSha256": "sha256-of-the-retained-exact-request",
  "response": {"status": 202, "body": {"id": "original-returned-transfer-uuid"}},
  "note": "Where the original response was retained."
}
~~~

The other kind adds **actionKey** and retains its original status/body. Supported original actions are transfer start, approval, processing choice, backlog directory/copy/SIP, and the selected AIP fixity check.

Evidence must bind an already-entered exact request. Transfer/SIP IDs are read back through their actual status routes. Choice evidence is checked against original unit job history. Operator-supplied evidence remains distinct from a native HTTP receipt. Reconciliation does not dispatch another transfer, decision, copy, SIP or fixity action.

## 13. Progress and completion

| State family | Meaning |
| --- | --- |
| PLANNED | Original offline package/configuration saved |
| CREDENTIALS_REQUIRED / SESSION_REQUIRED / ACCESS_REQUIRED | Restore the selected existing access |
| TRANSFER_STARTED / TRANSFER_PROCESSING / WAITING_SIP | Original transfer exists; SIP assignment is separate |
| WAITING_FOR_DECISION | Select an exact saved-observation choice |
| WAITING_BACKLOG / BACKLOG | Original backlog observation; pause or explicitly arrange |
| INGESTING / WAITING_AIP / WAITING_DIP | Observe the original SIP and required stored relations |
| COOLDOWN | Preserve Retry-After and resume after the saved time |
| RECONCILIATION_REQUIRED | Resolve the original entered action; no blind replay |
| OFFLINE_RETRIEVAL_PENDING / RETRIEVAL_PENDING | Original read has not returned complete file bytes |
| READY_TO_VERIFY | Run may perform entered retrieval/verification |
| RETRIEVING / VERIFYING_ORIGINAL_FILES | Complete receiving advances through retained files |
| ARCHIVE_READER_REQUIRED / ARCHIVE_FORMAT_REQUIRES_REVIEW | Retain download and resolve the declared reader/profile |
| FIXITY_FAILED / FIXITY_INCONCLUSIVE | Original requested check returned non-success |
| VERIFIED | Original identities, source bytes, metadata and selected requirements have complete proof |

Refresh is **provider-read-only**, with local atomic observation/progress publication. It does not start, approve, decide, arrange, request file retrieval or run fixity. Show has neither provider requests nor local mutation.

State retains transferUuid, sipUuid, aipUuid, dipUuids, pendingChoices and pendingBacklog. VERIFIED adds summary, proof:{path,bytes,sha256} and report. **Proof and report paths are relative to the prepared workspace root**, normally operations/<id>/receiving/<sha>.json and .html, not relative to the operation directory.

The receiving schema is **stellar-forge.archivematica-operation.v1.receiving**. It binds package/operation IDs, manifest/configuration hashes, exact source profile, settings, original provider models, archive/member/record evidence and selected fixity. A saved proof reopens with exact artifact hashes. Current model contradictions in UUID/type/origin/location/path/size produce a changed-package observation while preserving the previous verified evidence.

## 14. Complete portable acceptance

The prepared export carries the original BagIt and review; every immutable operation input; original choices and responses; complete/partial receiving evidence; full package/file bytes; proof/report; and complete application source.

The mandatory provider source group is **archivematica.py**, **archivematica_client.py**, **archivematica-requirements.txt**, **ARCHIVEMATICA.md** and **ARCHIVEMATICA_PROVIDER_CONTRACT.md** with the common foundation and Workbench. Runtime locks are excluded. Same-archive receiving validates original members before publication and preserves valid newer progress. Cold continuation uses the original operation ID and never repeats a completed provider action.

The complete native receiving companion uses the unchanged original 169-record CC0 research sample, real HTTP, actual TAR/ZIP/METS parsing, entered backlog/processing decisions, retained response-loss boundaries, one transfer and fixed arranged SIP, a distinct related DIP, full source/DC/BagIt proof and cold complete-application continuation. Its actual result records which phases ran and passed. A customer deployment still requires its own actual access, processing, storage and returned-byte acceptance.
