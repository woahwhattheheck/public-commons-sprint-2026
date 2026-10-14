# Existing deployed Eco endpoint convergence

This edition updates the ACTUAL `eco-workbench` script at `https://eco-workbench.tjlabs-publisher.workers.dev`. Keep deployed class `WorkbenchRelay`, binding `RELAY`, existing SQLite namespace `0c19f8be3092428d9b5534d136589d79`, `PUBLIC_ORIGIN`, `WORKSPACE_KEY=tim-workbench`, and existing secret names `RECIPIENT_TOKEN` and `CONNECTOR_TOKEN`. The complete Worker derives the private SHA256 values inside its instance; current shared secure credential references and values are unchanged. Keep deployment `4a648dd4b1ec4a22a1a599bf66370a3b` as rollback. Perform an ordinary source update with current settings, bindings and migration tag; create no new namespace or migration.

The original SQLite-backed KV entries are preserved. New metadata uses distinct `relay_requests`, `relay_chunks`, `relay_sessions`, `relay_routes` tables. The original `native-workspace-binding` remains authoritative, and connector registration must carry `native_workspace_key` from the original private launcher plus exact installed routes. A conflicting original identity is rejected. Authenticated GET `/_eco/v1/connector/migration-status` returns only existing legacy job-state counts and binding presence; use this before the one current whole-workbench connector attachment to identify any earlier admitted work. Preserve original legacy entries and reconcile any real in-flight job with its existing native owner. Existing browser sessions sign in through `/_eco/login` using the unchanged recipient value.

Deploy the complete maintained native connector, browser remote transport and REGIONAL client together with this `/_eco/v1` protocol . Do not attach the superseded `/_bridge` connector. Actual final operator remains the current complete workbench and its original projects. No additional operator or endpoint is introduced.

# Ecosystem private HTTPS relay

Operation E7A1-ECO-HTTPS-EDGE-20261013. This component joins the existing native operator, the native outbound connector and the existing browser/API clients over HTTPS 443. The native operator remains the only scientific executor and owns the original workspaces, uploads, task IDs and artifact files.

## Deploy the actual three-arm transport

Update the existing `eco-workbench` Worker through its already authenticated deployment route. The current source/configuration keeps the same `WorkbenchRelay` class, `RELAY` binding and original SQLite namespace. Read the existing script settings and retain its exact bindings/migration metadata during this source update. The configuration deliberately declares no new migration. Keep the original deployment version for rollback.

Keep the existing `PUBLIC_ORIGIN=https://eco-workbench.tjlabs-publisher.workers.dev` and `WORKSPACE_KEY=tim-workbench`. The Worker maps those names to its internal original-operator fields. Existing private `RECIPIENT_TOKEN` and `CONNECTOR_TOKEN` secret values remain unchanged; each live instance derives their SHA256 digests privately. It also supports explicit `ECO_RECIPIENT_TOKEN_SHA256`/`ECO_CONNECTOR_TOKEN_SHA256` bindings if raw-secret compatibility is retired later by the actual owner. Actual tokens stay only in the established secure custody and private recipient/connector configurations. The original native capability remains on its machine.

Start source_tools/eco_native_connector.py with its private configuration against the original existing loopback operator. The connector requires the original application's complete source, actual extension route manifest, private spool disk and fixed edge origin. The original operator owner configures its advertised Host/Origin allowlist for that same edge origin. The connector registers actual routes and then polls. Its private persistent instance ID and SQLite journal preserve write identity across restarts. Install the browser remote_transport.mjs and its exact app.api join from the companion browser component so large File uploads use the chunk endpoints below.

GET /_eco/health reports the edge version and chunk size. It is an edge liveness check. Open /_eco/login in the actual receiving browser, enter the recipient token, and run the real application handshake through POST /api/session. Login creates an HttpOnly Secure SameSite=Strict cookie and a sessionStorage upstate-operator-capability marker with the opaque value eco-edge-session. The existing browser can use that marker while edge cookie authentication authorizes its requests. The original person/workspaces/default_workspace JSON passes through; the native Set-Cookie does not. POST /api/logout deletes the edge session and returns connected:false. POST /api/operator-session is an ordinary native UI save and remains allowed. /api/team remains private to the original operator.

## Body transport and identity

Cloudflare request-body limits depend on the account plan (100 MB on Free and Pro). A single large original POST cannot rely on Worker streaming to bypass that inbound limit. The browser and API client split the original bytes into 1 MiB binary chunks. Each original request has one durable ID matching [A-Za-z0-9_-]{8,128}; native execution still receives one original method/path/body.

The edge stores request metadata, session hashes, registered routes and per-chunk byte counts/hashes in SQLite. Binary chunks travel through a bounded 24-chunk memory window to the native connector and its fsynced private spool. Neither SQLite nor JSON/base64 carries large request/response bodies. There is no edge limit on the total staged body length apart from safe integer size; actual private disk capacity and original native application limits remain authoritative.

Request method, path including query, selected headers, declared body_bytes and initial body_sha256 form the immutable identity for the ID. Omit body_sha256 if only per-chunk hashes are available. A hash supplied at seal is recorded separately and compared against the connector's complete native input hash; it never mutates the initial poll identity. A receiving request becomes pollable only when a live input chunk exists, or when its complete body is sealed. Zero-length bodies start queued.

| Recipient endpoint | Contract |
| --- | --- |
| POST /_eco/v1/requests | JSON id, method, path, headers, body_bytes, optional body_sha256. First create201; identical reuse200; changed identity409. |
| PUT /_eco/v1/requests/ID/input?offset=N | Raw 1..1048576 bytes with X-Chunk-SHA256. Ack200 only after native fsync. JSON id,input_offset,bytes,sha256. |
| POST /_eco/v1/requests/ID/seal | JSON body_bytes and optional body_sha256; requires full natively acknowledged input. Idempotent. |
| GET /_eco/v1/requests/ID/status | Immutable original request metadata plus current input_offset,response_offset,sealed,state,response. |
| GET /_eco/v1/requests/ID/result | Original upstream status/selected headers/raw body when ready; otherwise202 plus X-Eco-Pending:1. |

A duplicate input chunk must match its durable byte count and SHA. Its acknowledgement input_offset is the end of that particular chunk even if later chunks have already arrived. Retry the same ID, offset and bytes after a lost ACK. Retained staged-chunk metadata also permits a native ACK to complete after an edge restart between native fsync and ACK.

Every edge transport error has X-Eco-Transport-Error with a stable code and JSON code/message. REQUEST_MISSING404 means no retained manifest: staged clients may recreate the identical ID/metadata. Native404/503 responses have no transport-error header. INPUT_PENDING503 and TRANSPORT_BACKPRESSURE503 retry the exact chunk. X-Eco-Pending distinguishes transport202 from original native202. A possibly executed write returns X-Eco-Uncertain:1 and preserves its original ID and any reconciled task ID.

Normal application routes use the same protocol internally and accept X-Eco-Request-ID. Their captured complete body auto-seals on its final native ACK, so a delayed ACK still completes a normal JSON request after browser disconnection; explicitly staged requests retain their explicit seal step. Ordinary GET navigation/download responses wait for original native response metadata instead of returning transport202, preserving normal browser links for slow large files. The explicit result endpoint continues to support pending202 polling. If an ordinary mutation's network response is lost, read that ID's result. Larger unknown-length bodies must use the staged interface; normal unknown-length requests are buffered only up to1MiB to establish immutable body size before polling. Known-length normal bodies stream into the same native ACK sequence and remain subject to the account's inbound HTTP request limit.

## Native connector API

All calls use its separate bearer plus X-Eco-Connector-Instance, persisted across restarts. The connector certificate-verifies HTTPS443, does not follow edge redirects, and sends original requests only to its configured existing loopback operator.

| Connector endpoint under /_eco/v1/connector | Contract |
| --- | --- |
| POST /register | Original native_workspace_key plus actual routes:[{method,path}]. Exact GET page/asset paths (including an explicitly mounted /measurements or /measurements/) and exact native GET/POST/PUT/PATCH/DELETE API paths declared by the installed operator. Registration admits only those exact rows; /_eco and its descendants stay reserved. |
| GET /poll?wait=20&exclude=ID1,ID2 | Optional comma-separated active IDs, max64, prevent concurrent native worker polling from repeatedly selecting locked work. One original request object or204. Receiving chunks, queued work, execution reconciliation and demanded retained responses resurface. |
| GET /requests/ID/input?offset=N | Raw original bytes with X-Chunk-SHA256 and X-Eco-Offset.204 indicates no available bytes; X-Eco-Input-Sealed indicates completion. |
| POST /requests/ID/input-ack | JSON offset,bytes,sha256 after durable private write. Idempotent exact ACK. |
| POST /requests/ID/executing | Complete native body_sha256, optional body_bytes. Requires sealed/ACKed body; binds original connector instance. |
| POST /requests/ID/response | Original status,headers,body_bytes,optional body_sha256 after entire native response is durably spooled. |
| PUT /requests/ID/response?offset=N | Original raw chunk plus X-Chunk-SHA256. Ack only after public response stream consumes it. |
| GET /requests/ID/status | Same metadata and retained offsets. |
| POST /requests/ID/uncertain | Sanitized code,message,optional task_id after ambiguous native outcome. |

The native journal persists executing before the single upstream write. It must never replay an uncertain native mutation. The existing connector reads the original native task identity to reconcile /api/actions where possible. Response metadata and original binary response spools are retained before transmission, allowing a lost public download to reopen the same result from offset0 without executing the original request again. Only one active result reader is allowed per ID. Native204/205/304 use a null Response body. Range, Content-Range, ETag, disposition and original response status are retained. The public body uses Cloudflare FixedLengthStream with manual encoding, preserving its declared Content-Length and original identity bytes instead of chunked or automatically compressed output.

Original retained review-desk member paths may contain URI-encoded spaces or Unicode, as emitted by the native application. The edge validates every decoded path segment once, rejects separators, control characters, empty and dot traversal segments, and forwards the unchanged original wire path for native authorization/file resolution.

Selected headers exclude original authorization and cookies. The edge's fixed route mapping, exact origin checks and recipient scope prevent arbitrary host forwarding. Changing ECO_RECIPIENT_TOKEN_SHA256 revokes prior edge cookies. Cookie mutations require the exact edge Origin; scoped bearer clients may omit Origin, but any supplied Origin must match. Input and response chunk hashes are checked at each side; native whole-body identity remains a separate check.

## Actual receiving sequence

1. Deploy the separate edge Worker; verify exact configured origin and migration/binding.
2. Start the native connector against the original server, register its actual route/asset manifest and read the first real connector exception if one occurs.
3. Open the actual browser, login, complete /api/session, render the original workbench and visually inspect it.
4. Upload the original science input through the staged File route. Confirm native source SHA and original task IDs, then drive the original application task to completion.
5. Transfer an actual body larger than500MB through the staged route and retrieve the original binary result; compare actual bytes/SHA. Interrupt/reconnect a chunk transfer and reattach the same request/result ID. Observe the native journal for a single upstream execution.
6. Open a retained original download in the browser/API client, including the intended Range path. Refresh the original native task view and verify the same task identity rather than initiating replacement science.

The code was syntax-compiled in the authoring JavaScript runtime and checked against the companion connector and browser contract. Deployment, SQLite runtime behavior, actual browser rendering and the large original byte path are verified by this receiving sequence with the existing authorized native and Cloudflare owners.

## Platform references

Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
Cloudflare Durable Objects limits: https://developers.cloudflare.com/durable-objects/platform/limits/
Cloudflare SQLite storage API: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
Cloudflare Streams API: https://developers.cloudflare.com/workers/runtime-apis/streams/
Cloudflare fixed-length streams: https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/

These references establish the request-size/memory constraints, SQLite Durable Object API and streaming lifecycle used by this implementation.


## Existing deployment operating with native durable authority

The provider rejected the original SQLite writes. The existing deployment was
adapted in place to the `ECO_PREVIEW_MEMORY="true"` mode, with the additive
`preview_storage.mjs` module beside `worker.mjs`. Preserve the same
WorkbenchRelay/RELAY namespace, migration, public origin, alias, private secret
bindings and native Workspace mapping when uploading BOTH complete modules.
Keep the existing deployment settings; do not add a namespace or change accounts.

The actual operated predecessor served health, private login, migration inspection
and logout successfully. This maintained successor composes directly from those
full bodies. Its health identifies
`transport_persistence: "memory-preview-native-journal-authoritative"` and a
per-instance `transport_epoch`. SQL/KV writes are never sent in this selected
mode. Original stored history remains unchanged; original native-workspace
binding and migration history are read from the existing namespace. An existing
environment `NATIVE_WORKSPACE_KEY` remains authoritative.

Request execution, original TaskRequests and full input/response bytes remain
durable in the original native connector's private journal and fsynced spool.
The edge's connection metadata is transient. It uses the actual deployed metadata bounds of 40 MiB estimated metadata,
4,096 request records and 65,536 chunk identities, plus the existing 24 binary
chunk slots. Complete files remain on native disk and move in 1 MiB chunks.
Completed and failed connection records and their chunk metadata can be retired. Active and uncertain request metadata remains admitted
until completion and receives ordinary backpressure if physical capacity fills.
A cache or epoch loss never establishes that an upstream action did not execute.

### Authentication and native registration

The private login signs an HMAC cookie bound to the exact credential epoch and
transport epoch. The parser requires exactly two canonical components.
The same-instance logout digest therefore cannot be bypassed by appending a
third cookie component. Instance replacement invalidates previous cookies and
uses the ordinary private login again.

Preview storage serializes its asynchronous transactions. First registration
reads the original stored native pin (or its exact configured environment pin),
checks the authenticated incoming original native workspace key, then remembers
it within that transaction. Concurrent first registrations cannot select two
different native workspaces. Where the original persistent pin is absent, the
first selected connection pin is transient; the native private configuration
and its original principal remain authoritative. Set the existing `NATIVE_WORKSPACE_KEY`
binding to the actual final host's original `native_session.workspace_key` once
that host reports it; this preserves the selected pin across preview resets
without a storage write. Failed reads are returned as
errors, never treated as an empty old pin.

After instance replacement, connector poll returns HTTP409 with
`X-Eco-Transport-Error: REGISTRATION_REQUIRED` until the same native instance
registers its actual route manifest. The paired current connector preserves this
validated error code, serializes re-registration with its existing registration
generation, and resumes its original polling workers. It preserves its private
instance ID, native pin and journal; no scientific action is issued by renewal.

### Original outcome recovery

Missing or released preview request state returns HTTP409
`PREVIEW_STATE_LOST`, `X-Eco-Uncertain: 1` and the original
`X-Eco-Request-ID`. An input chunk waiting for an original request that becomes
uncertain also exits with409 and the same uncertain-outcome header. It does not
repeat503 INPUT_PENDING indefinitely. Marking a request uncertain also releases
its staged edge input slot, and delayed input ACK or seal calls preserve that
terminal outcome rather than returning it to the native dispatch queue.

The native connector recognizes a retained ready/response/delivered journal
entry paired with regressed edge offsets or a missing execution owner. It uses
the existing uncertain-state endpoint and keeps its native journal outcome,
complete response files and original IDs. The edge preserves only bounded
validated recovery fields: original64hex `task_id`, original16–100-character
`operation_id`, original Workspace identifier and an exact
`/api/task?id=<task_id>` lookup. Native workspace identifiers may be project
UUIDs; they are distinct from the private opening's64hex workspace pin.

The browser/client retains the original uncertain/sealed File checkpoint and
reads the same result on reentry. It must not silently restage, substitute a new
ID or repeat an unknown native mutation. Recover scientific work through its
original native task, operation, project or retained response file.

After metadata retirement or a complete instance loss, edge memory alone cannot
distinguish an old manifest from a new one; manifest acceptance is therefore not
execution authority. Status/result reads of missing records report state loss. The original
native journal validates immutable request identity and governs recovery. No
seal or execution marker is inferred from a locally ready native input file.

### Same-endpoint receiving

Upload both current modules together while preserving the actual
`ECO_PREVIEW_MEMORY` binding and all current deployment settings. Read health,
then use the original connector/private configuration and one actual complete
application registration. Follow the real private session, selected native
projects, large upload/download and normal close/reopen course. Carry literal
provider/runtime errors back to the original source owners.

Provider operation limits are documented at
https://developers.cloudflare.com/durable-objects/platform/pricing/ .
This mode uses permitted compute and retains existing stored data; it does not
represent renewed write quota or durable edge connection state.
