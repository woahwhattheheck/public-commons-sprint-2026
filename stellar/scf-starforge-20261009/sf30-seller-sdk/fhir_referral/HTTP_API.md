# Gravity referral workspace API

The complete source, referral, conditional-exchange, dataset and receiving workspace runs behind one private loopback operator. GET /api/referrals/catalogue exposes the sixteen authoritative input schemas from referral-schema.json. The existing FHIR/eLTSS routes keep their original engine and file contracts.

## Startup and identity

~~~sh
node fhir_referral/cli.mjs init --workspace /absolute/private/gravity
node fhir_referral/cli.mjs serve --workspace /absolute/private/gravity --port 0 \
  --expected-workspace-id ORIGINAL_UUID
~~~

Run from the original SF30 SDK directory. The installed native command is gravity-referrals. Python3.11+ and Node22+ are required; SF30_REFERRAL_PYTHON and SF30_REFERRAL_NODE select existing executables. The optional --credentials-file selects the original private FHIR authentication profiles.

Startup schema stellar-forge.gravity-referral-startup.v1 contains url, workspace, workspaceId, instanceId and connectionFile. Open its private URL exactly as emitted. The UI retains the fragment capability for that origin; API requests use Authorization: Bearer with the same capability. The descriptor at referral/operator-connection.json also retains active state, processId and accessToken.

| Surface | Exact identity |
| --- | --- |
| GET /api/operator | stellar-forge.gravity-referral-operator-connection.v1; active, exact workspace/UUID/instance/process and URL. |
| GET /api/state | Original stellar-forge.eltss-workspace.v1; native sources, artifacts, graphs, plans/builds, connections, discoveries and acquisition operations. |
| state.referral or GET /api/referrals/state | stellar-forge.gravity-referral.v1, the same workspace UUID and all referral collections. |
| workspace.json and eltss/identity.json | Original eLTSS schema and retained workspace UUID. |
| GET /api/referrals/catalogue | Complete typed inputs, statuses, topologies, limits, collections and source definitions. |
| GET /api/referrals/profile | Full57source requirements and24authored operating field definitions, original text and citations. |

A complete archive receiver republishes its actual operator descriptor while retaining the original workspace UUID. Connections verify the selected directory, instance and both workspace schemas.

## Records and pagination

A source ID is the SHA-256 of its full retained packet. Qualified resource rows retain recordId, resourceType, id, versionId, memberId, entryPointer, jsonText, resourceSha256 and original Bundle context. Full member bytes and lexical JSON number tokens remain available.

Immutable authored records use SHA-256 content IDs. Successors name their predecessor or original correction preview. Exchange and archive receiving operations retain their original UUID.

~~~text
GET /api/referrals/records/{kind}/{id}
GET /api/referrals/records/{kind}?offset=0&limit=50&query=
~~~

Pages return rows,total,offset,nextOffset,pageBytes. Continue nextOffset until null. Each page supports at most250rows and the native interactive byte limit; complete files retain the whole result.

The original collections are configurations, editions, reviews, assessments, decisions, comparisons, correctionPreviews, corrections, exchangeRequests, exchangeOperations, monitoring, handoffs, receivings and receives. Use the current catalogue's sorted list.

## Complete original source intake

~~~text
POST /api/sources
GET  /api/sources/{sourceId}
GET  /api/sources/{sourceId}/members
GET  /api/sources/{sourceId}/rows?resourceType=Task&offset=0&limit=50
GET  /api/sources/{sourceId}/rows/{recordId}
GET  /api/sources/{sourceId}/packet
~~~

POST uses the complete original JSON or declared source ZIP body. URL-encoded X-Source-Name and X-Source-Label retain its chosen name and label.

POST /api/referrals/published-examples accepts the complete original Gravity examples ZIP with URL-encoded X-Source-Label, X-Actor, X-Publication-Url, X-Reference-Base and X-Source-Note. It preserves the full archive and all JSON members, then identifies a separate collection with the operator's reviewed full-URL assignments.

Its complete result contains source, archiveSha256, resourceDocuments and referenceAssignments. Read the native source ID from result.source.id. resourceDocuments counts original resource documents adopted as top-level collection entries; the inventory also indexes nested Bundle and contained resources.

GET /api/referrals/guidance/packet returns all191complete original source files and hashes. GET /api/referrals/guidance returns the index. GET /api/referrals/guidance/file?name=EXACT_PATH returns one full original member.

## Configuration, cohort, complete review and assessment

| POST route | Complete input |
| --- | --- |
| /api/referrals/configurations | label/actor/note, topology, sourceVersion/classification, exact role/organization/owner/connection/note records, recipientHostRole, monitoring calendar, optional predecessor and legacy profile artifact. |
| /api/referrals/editions | Exact sourceId, configurationId and1–100Task record IDs; referencePolicy/baseUrl, predecessor and reviewed reference decisions. |
| /api/referrals/reviews/profile | label/actor/note; adopts all57requirements and24field rows as one complete review draft. |
| /api/referrals/reviews | Full original requirement and field arrays, each key exactly once; profile/predecessor and explicit disposition, reviewer, reason, owner, date, citations, mapping and receiving reference. |
| /api/referrals/assessments | Exact editionId/reviewId, label/actor/note and optional offset-aware asOf; freezes the complete source assessment. |
| /api/referrals/decisions | Original edition/Task/resource scope, kind/outcome, responsible owner, reason, citations, purpose and dates, optional original finding/predecessor and reviewed resource links. |

| Topology | Required roles | Recipient server |
| --- | --- | --- |
| direct | source, target | target |
| direct-light | source, target | source |
| intermediary | source, intermediary, target | target |
| intermediary-light | source, intermediary, target | source or intermediary |

Version3.0.0 is the installed original source. Selecting2.3.0 requires the retained complete legacyProfileArtifactId. Polling requires an explicit interval; a sub15minute selection retains its urgent situation and concrete reason.

Original-Bundle reference resolution requires an empty base URL. Selected-base uses its explicit reviewed HTTPS base. Graph identities retain original member, Bundle, logical identity and version context.

Review states are unreviewed, applicable, met, gap and not-applicable. Every reviewed disposition retains its responsible reviewer and concrete reason. Authored review choices remain distinct from actual source observations.

~~~text
GET /api/referrals/assessments/{id}/tasks
GET /api/referrals/assessments/{id}/findings
GET /api/referrals/assessments/{id}/cells
GET /api/referrals/assessments/{id}/decisions
GET /api/referrals/assessments/{id}/file
~~~

Pages accept offset,limit,query,taskId; the file is the complete frozen assessment. Every selected Task retains24operating field observations plus exact source pointers, focused requests, subjects, outcomes, consent references and unresolved relationships.

Original Consent resources and the responsible operator's scoped consent decision are separate records. A selected native write requires a current permitting decision for its exact purpose, edition and resources. Ownership, workflow, finding, contact and resource-link decisions preserve their source scope and predecessors.

## Exact correction and edition comparison

POST /api/referrals/corrections/preview retains the selected edition, actor, reason and ordered original-resource patches. A patch carries recordId,path,action and a complete valueJson string for add/replace. The preview retains original old/new values, request SHA, derived-document identity and the whole changes file.

POST /api/referrals/corrections/apply takes previewId and expectedRequestSha256. The engine reconstructs that exact preview, preserves the complete predecessor packet, and returns the new source, edition and recordMap. Reopening the same preview returns its saved successor.

POST /api/referrals/edition-comparisons selects beforeId,afterId and explicitly reviewed resource-link decisions. Qualified original identities drive the complete comparison. Distinct logical IDs can be joined through actual saved relationship decisions.

~~~text
GET /api/referrals/edition-comparisons/{id}/changes?offset=0&limit=50
GET /api/referrals/edition-comparisons/{id}/file
~~~

## Source-native read and conditional update

POST /api/referrals/exchange-requests retains editionId,connectionId,discoveryId,role,method,resourceType,logicalId, optional original recordId, complete bodyJson, expectedETag, explicit createIfAbsent, consentDecisionId and exact purpose.

The actual saved discovery must match the selected connection. Read requires advertised resource read; update also requires advertised update, unchanged resource type/logical ID, the selected complete preimage and current purpose-bound permission. Task status changes preserve original requester/target responsibility. ServiceRequest changes use their requester role.

~~~text
POST /api/referrals/exchange-requests/{requestId}/advance
     {"operationId":"ORIGINAL_UUID"}
GET /api/referrals/exchange-operations/{operationId}
GET /api/referrals/exchange-operations/{operationId}/file
GET /api/referrals/exchange-operations/{operationId}/packet
~~~

Continue the same saved request and UUID. The retained operation contains its actual preimage, conditional request, provider response, full readback and complete resulting source. An uncertain update reconciles through the actual resource before another attempt. A stale preimage/ETag retains its review-required state. Provider notBefore and retry information remain part of that operation.

## Exact Task search and instance history

POST /api/referrals/monitoring selects the retained topology, actual connection and its matching discovery, and the exact search/history parameters. It returns the original acquisition requestId. Continue through:

~~~text
POST /api/requests/{requestId}/advance {"operationId":"ORIGINAL_UUID"}
GET  /api/operations/{operationId}
~~~

Task search retains the chosen lower inclusive _lastUpdated=ge instant, upper exclusive _lastUpdated=lt instant, exact owner/requester and statuses. Actual saved discovery validates its search support.

Instance history requires the exact Task logical ID and advertised history-instance. Its optional since becomes _since. Upper-window, owner, requester and statuses must be empty. Complete history pages retain every returned original version. The inclusive _since semantics and newest-first history order follow [FHIR4.0.1 HTTP history](https://hl7.org/fhir/R4/http.html#history).

## Native datasets

~~~text
POST /api/sources/{sourceId}/mapping
POST /api/sources/{sourceId}/preview
POST /api/plans
POST /api/builds
GET  /api/builds/{buildId}/query?limit=5
GET  /api/builds/{buildId}/dataset
GET  /api/builds/{buildId}/packet
POST /api/comparisons
~~~

These are the original SF30 source-derived mapping, full preview, exact keyed build/query/comparison and complete customer receiving routes. Query parameters are scalar strings. Source lineage, qualified resource IDs and lexical values remain with the dataset. Merchant/customer commands reuse the original saved native build and buyer configuration.

## Handoff, full files and editable receiving

POST /api/referrals/handoffs selects label/actor/note, exact editionId/assessmentId, receiver/purpose, sourceRefs and scope=complete-workspace. It freezes readable HTML/CSVs, full source/profile/configuration/assessment, decisions, native dataset/HTTP custody and editable data. Reopening the same complete request returns the retained original handoff after file verification.

POST /api/referrals/receivings retains actual receiver/disposition, handoffId, original operationId, receivedAt, complete result artifact or exact destination object, citations and optional correctionOf. The same operation UUID stays bound to the same complete input.

| Route | Complete file operation |
| --- | --- |
| GET /api/referrals/handoffs/{id}/packet | Complete frozen handoff ZIP. |
| GET /api/referrals/workspace/packet | Whole editable workspace ZIP. |
| POST /api/referrals/workspace/packet | Receive the entire original archive into a fresh workspace or resume the identical archive. |
| POST /api/referrals/handoffs/receive | Receive the full handoff and its editable native data. |
| POST /api/referrals/exports | Prepare a complete workspace/handoff/assessment/comparison/exchange-operation artifact. |
| POST /api/artifacts | Retain full original bytes with X-Artifact-Name/Label/Content-Type metadata. |
| GET /api/artifacts/{id}/file | Full retained artifact bytes. |

The receiver verifies every original member, restores the source/database/operation closure and reopens the original UUID.

The current catalogue exposes256MiB complete source/artifact input,10000indexed resources,100selected referrals and512MiB whole-workspace archives. Original per-resource/member/edge and interactive-response limits also apply. The native catalogue and structured error remain authoritative.
