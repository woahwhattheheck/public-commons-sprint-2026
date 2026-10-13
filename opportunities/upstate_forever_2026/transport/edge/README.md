# Ecosystem private HTTPS relay

Operation E7A1-ECO-HTTPS-EDGE-20261013. This component joins the existing native operator, the native outbound connector and the existing browser/API clients over HTTPS 443. The native operator remains the only scientific executor and owns the original workspaces, uploads, task IDs and artifact files.

## Deploy the actual three-arm transport

Deploy this separate Worker into the existing authorized Cloudflare account. The existing deployment owner selects the account already used for this sprint. The example configuration uses ecosystem-workbench-relay.tjlabs-publisher.workers.dev; if another Worker name is selected, change both name and ECO_PUBLIC_ORIGIN to that one exact HTTPS origin before deployment. ECO_OPERATOR_ID is a fixed nonsecret mapping and must equal the native connector configuration. The existing LDA and publication Workers keep their own names and bindings.

The SQLite Durable Object binding is ECO_RELAY and the exported class is EcoRelay. The new_sqlite_classes migration creates a new namespace; do not substitute a legacy namespace. Publish worker.mjs and wrangler.json through the connected Cloudflare deployment route or an already authenticated local Wrangler. No GitHub Actions job is needed.

Generate two distinct high-entropy tokens on the authorized private owner machine: a recipient token and a connector token. Configure only their lowercase SHA-256 digests as Worker secret values ECO_RECIPIENT_TOKEN_SHA256 and ECO_CONNECTOR_TOKEN_SHA256. Pass the actual connector token only into the connector's private owner-only JSON. Pass the recipient token through the existing private recipient delivery route. The Worker source, Git, Slack messages and URL query strings must contain neither token. The original native capability/session remains solely on the native machine and never becomes a relay credential.

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
| POST /register | Actual routes:[{method,path}]. Exact static GET paths and exact native GET/POST/PUT/PATCH/DELETE API paths declared by the installed operator. |
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
