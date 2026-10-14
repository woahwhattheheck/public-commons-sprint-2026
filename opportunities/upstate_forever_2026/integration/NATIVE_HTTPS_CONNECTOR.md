# Native HTTPS connector for the existing scientific workbench

This connector binds one authenticated edge transport to one already-running native operator. It does not create a scientific queue or another operator. Requests retain their original method, path, body, Workspace selection and operation identity; original binary files remain binary.

## Existing deployment and opening

The deployment owner supplies the canonical HTTPS origin, its exact operator ID and a separately revocable connector credential through the existing private credential surface. ES26's advertised-origin configuration must be active on the original native server. The physical listener remains its existing literal loopback address and port.

Use the actual selected Python from the delivered GIS runtime. The connector itself uses only its standard library and native SQLite. Place this complete file in source_tools/eco_native_connector.py. Keep configuration, tokens, journal and spooled bytes outside application/source and scientific Workspace directories.

Create an owner-only JSON file in the existing private runtime, using values from the actual deployment and native opening:
~~~json
{
  "schema": "upstate.eco-native-connector/v1",
  "edge_origin": "https://EXACT-DEPLOYED-HOST",
  "operator_id": "EXACT_OPERATOR_IDENTIFIER",
  "connector_token_file": "connector-token.json",
  "native_session_file": "/existing/private/operator-state/workbench-session.json",
  "application": "/existing/received/application",
  "state_directory": "/existing/private/eco-transport-state",
  "workers": 4,
  "max_spool_bytes": 10737418240,
  "native_timeout_seconds": 600
}
~~~
The private connector-token file contains {"token":"..."} from the original edge credential custody. The native_session_file is the actual maintained launcher's existing workbench-session.json (upstate.workbench-local-session/v1). It remains on the native machine with mode0600. The connector rereads it for every native request, binds the exact original project, Workspace key and application in its persistent instance record, and obtains the launcher's current loopback port and native capability after an ordinary reopen. It never opens a new operator. Configuration and credential files must be owned by the runtime user with mode0600; the state directory uses0700. For a recipient session, also set native_token_file to the existing TeamAccess credential scoped to the intended scientific Workspaces. The connector then obtains only the current physical port from the maintained opening and uses that separate native credential, rereading it for each request; native role/workspace checks and revocation remain authoritative. Leaving native_token_file absent selects the original owner session for its private owner preview. The edge recipient credential is independently scoped to this operator and is never a substitute for native TeamAccess. Native credentials stay local. As an explicit compatibility alternative, omit native_session_file and supply operator_origin plus native_token_file; that fixed binding requires updating the private config when the original operator port or credential changes.

~~~sh
SELECTED_PYTHON source_tools/eco_native_connector.py --config PRIVATE_CONFIG --register-only
SELECTED_PYTHON source_tools/eco_native_connector.py --config PRIVATE_CONFIG
~~~

Registration reads exact routes and assets from the trusted installed application and the existing authenticated /api/extensions response, including native literal/frozenset READS declarations. No model or provider is imported for this. The edge deployer binds this connector to the same single operator ID. Startup verifies native authentication and the configured advertised Host before exposing application routes. The connector uses TLS verification and HTTPS443 with no redirects; its only upstream target is the configured literal loopback native server.

## Complete byte and execution path

The edge keeps control metadata and bounded chunks. Incoming bodies are received in at most1MiB binary chunks, checked by SHA256, written and fsynced to the private native spool, then acknowledged. SQLite records the offset only after bytes are durable. After an interrupted acknowledgement the same chunk is read back and verified before repeating its acknowledgement.

The native journal records executing before the original upstream request. The edge execution marker is bound to the same persistent connector instance. Each write is forwarded once. A failure before any native call returns that request to ready; ambiguous native calls retain their original identity and outcome. After a process interruption, original GETs can resume while POSTs reconcile rather than run again.

Responses are spooled, hashed and retained before their metadata is announced. The edge can reconnect and request the same bytes at its actual offset. Content type, original status, Range/Content-Range, ETag, disposition and download headers survive. The connector strips native authentication cookies; the edge owns its separate recipient session. Native authorization is injected only on the loopback hop. The original /api/operator-session route saves the UI working state and remains allowed; account/team administration and native logout do not cross this transport.

For an interrupted /api/actions submit, the connector derives the original task key using the native model.common canonical identity, reads that exact /api/task, and checks workspace, operation ID and complete request hash. A matching original task is returned as a reconciled202 with its actual current record. It never creates an alternate operation or retries the native write. Other ambiguous writes retain their original request and operation information for original native readback.

All request/response bytes are kept in the private state directory for receiving and reconnect. The configured spool limit and actual free disk are checked while receiving. Retain this directory across ordinary connector restarts. Do not erase its write journal to retry a scientific action. Stop the connector through its own SIGTERM/SIGINT; this does not stop the native operator or alter existing scientific jobs.

## Protocol

Protocol upstate.eco-transport/v1. All connector calls carry the separate connector bearer, X-Eco-Connector-Instance and X-Eco-Operator-ID.

- POST /_eco/v1/connector/register: actual exact route manifest.
- GET /_eco/v1/connector/poll: one original request object, or204.
- GET /_eco/v1/connector/requests/ID/status: authoritative transfer phase and offsets.
- GET /_eco/v1/connector/requests/ID/input?offset=N: original raw input chunk with X-Chunk-SHA256.
- POST /_eco/v1/connector/requests/ID/input-ack: offset, bytes and SHA after native fsync.
- POST /_eco/v1/connector/requests/ID/executing: checked full input bytes/SHA.
- POST /_eco/v1/connector/requests/ID/response: original status, allowed headers, complete byte count/SHA.
- PUT /_eco/v1/connector/requests/ID/response?offset=N: original response chunk and SHA.
- POST /_eco/v1/connector/requests/ID/uncertain: preserved original identity and concrete outcome information.

The companion browser and original API client use staged requests for large uploads: POST /_eco/v1/requests, repeated binary PUT /_eco/v1/requests/ID/input?offset=N, POST /seal, then GET /result. This avoids Cloudflare's account request-body ceiling while preserving the original native /api/upload byte stream. Ordinary responses are streamed by the edge from the retained native file.

## Actual receiving

The original equipped recipient applies this connector beside its current app/runtime, configures the actual deployed edge and existing native port, then opens the authenticated HTTPS UI. Continue the original project: upload/review scientific choices, inspect saved source, run through the original TaskRequests operation ID, open/read results, download an original archive and verify its existing hash, then reconnect the connector and reopen the same project. Exercise an interrupted chunk acknowledgement and confirm the original operation count remains one. Preserve current Workspaces and accepted runs.

The complete source is reviewable and directly runnable; the actual deployed edge and native operation are recorded by their existing receiving owners. Root E7A1 owns the connector source, the paired edge writer owns the DurableObject protocol, ES26 owns advertised server origin, REGIONAL owns the existing API client, and the browser writer owns staged file input in the original API wrapper.

## Provider references

Python3.12 http.client explicitly supports file-like request bodies with Content-Length and reads original response bytes:
https://docs.python.org/3.12/library/http.client.html

SQLite transaction and connection behavior:
https://docs.python.org/3.12/library/sqlite3.html

Current Cloudflare request, memory and streaming limits:
https://developers.cloudflare.com/workers/platform/limits/

## Current source routing and concurrent requests

The connector admits GET, POST, PUT, PATCH or DELETE only when that exact path/method appears in the actual installed handler, extension manifest, or private additional_routes configuration. Each mutating method sends the exact configured advertised Origin. Original method and complete document bytes are preserved. The ordinary maintained Measurements extension uses POST /api/measurements/rpc with its original method/path/document in the body; no direct mounted Measurements service is inferred from files merely being present. A deliberately mounted original service can provide its actual concrete route inventory in additional_routes. The native service remains authoritative for route, size and scientific meaning.

Up to the configured worker count can relay independent requests. Each poll excludes this connector's currently active request IDs through the paired edge exclude parameter; a concurrent polling race backs off briefly. The edge filters exclusions before selecting queued requests, preventing duplicate active requests from consuming the connector or API budget. Original per-request locks and durable write identity remain in place.

## Durable input recovery

Every resumed upload verifies the entire acknowledged prefix against its original contiguous chunk inventory before skipping any edge acknowledgements. A missing or short acknowledged spool is an explicit error; reopening never creates zeros in its place. Only an uncommitted suffix may be discarded. Before native dispatch, the connector verifies exact complete length, every recorded chunk SHA and any declared full body SHA from the same open file that supplies the native request. This check also runs when a previously ready request resumes after process restart.

Initial input file creation and retained response publication synchronize the containing directory on the qualified Linux runtime. Input bytes reach disk before their journal rows and edge acknowledgement, and the persistent connector identity directory entry is synchronized before registration. If retained input has been lost or changed, preserve its request journal and recover the original bytes from the original retained source; never erase the journal or replay the native mutation as a recovery shortcut.

## Actual deployed endpoint and complete served assets

The existing deployed endpoint is https://eco-workbench.tjlabs-publisher.workers.dev, with operator_id tim-workbench. Its WorkbenchRelay/RELAY deployment is being aligned to this maintained upstate.eco-transport/v1 protocol. The original edge recipient and connector credentials remain in their existing private custody. Use this connector with the matching current Worker, browser transport and original API client; a legacy /_bridge connector is a different protocol and must not be paired with these clients.

Registration includes the original native workspace_key from the maintained private launcher session. In the explicit fixed-origin compatibility mode, it reads the authenticated original /api/whoami default_workspace. The edge preserves and enforces its original native workspace binding across source updates. The sole final whole-workbench host supplies this original binding; parsing or reading a separate retained receiving project is independent of attaching it to the final endpoint.

All exact web_assets declared by the actual authenticated extension manifest are registered beneath /web/, including nested Study modules and styles such as extensions/study_transfer.mjs. Each declaration retains the original native relative-path and .mjs/.css/.html constraints. Native root assets and exact optional private route declarations continue through the same registration. This uses the served inventory without inferring a separate Measurements mount.

## Normal startup and temporary service failures

The maintained launcher can own this connector as its selected-runtime child after writing the original private native session. Its lifecycle integration reads the optional private transport configuration before selecting the advertised origin, preserves the same configuration and journal across cold reopen, and never places credentials in the portable application or scientific exports.

The connector retries initial registration only for transient connection failures or HTTP408,429 and5xx. Its normal retry delay grows from1 to30 seconds; a longer valid Retry-After delay from the edge or native discovery response takes precedence. Both numeric seconds and HTTP dates are supported. Waiting remains interruptible by the existing shutdown signal. Permanent configuration, certificate-verification, authentication, route and binding errors retain their explicit failure instead of retrying registration indefinitely. The diagnostic --register-only command remains a single attempt.

A startup_retry event means registration is still pending. The existing connected event is emitted only after the actual current route manifest and original native Workspace pin have been accepted by the edge. Later reconnecting events also honor Retry-After. Event fields contain only safe error codes, delay, route count and protocol; credentials and request content remain private. The transfer receive/execute/journal and original-operation reconciliation paths are unchanged.

HTTP Retry-After syntax is defined in RFC9110 section10.2.3:
https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after

## Closing the original launcher and retained edge state

When the original owner stops, queued recovery and a just-returned poll check the same STOP signal before starting another retained request. Registration that finishes after shutdown does not enter the pending-work or worker phase. The native dispatch path checks shutdown before entering and again after the edge execution marker; if that marker completed but no native call began, the same request returns to ready in the retained journal. An already-started native exchange keeps its existing durable uncertainty/reconciliation behavior. The lifecycle owner gives only its own connector child a15-second graceful close, then reaps that child if necessary; the original scientific process and journal remain under their existing owners.

The deployed edge's quota-outage mode reports memory-preview-native-journal-authoritative and a process transport_epoch. It retains control metadata in its current process while native input/response bytes and the write journal remain durable. Recipient login sessions are bound to that edge epoch; after eviction, use the normal recipient login again. An absent original result or status is reported explicitly as PREVIEW_STATE_LOST. Keep the original request, operation and task identifiers and read the original native task/project state through the same authorized application. Do not erase the native journal, switch connector identity or resubmit a scientific mutation under a new identifier to hide a lost edge response. Ordinary original native tasks, reports and downloads remain recoverable from the existing workbench.

## Recovering the same registration after an edge reset

An authenticated connector poll with HTTP409 and X-Eco-Transport-Error: REGISTRATION_REQUIRED triggers re-registration of the same current routes, instance, native Workspace binding, private configuration and journal. Polling workers serialize renewal and compare the successful registration generation, so simultaneous failures do not register competing identities. Initial and renewed registration use the same transient-only retry and Retry-After behavior. A permanent renewal error stops the owned connector with its explicit error; the maintained launcher can apply its existing configuration-change recovery. Shutdown interrupts waiting and never starts new native work.

The connector preserves a bounded uppercase transport error code from that response header separately from the generic HTTP error. Unrelated409 responses do not trigger registration. Its explicit User-Agent is TJLabs-Workbench-Native-Connector/1.0, identifying this actual native client to the existing edge without browser impersonation.

Before handling an already-ready, executing, uncertain, response or delivered native journal row, the connector reads the current original edge status and checks the immutable request identity. This also applies to startup recovery, whose saved request contains no edge control metadata. A receiving row still uses its existing durable-prefix and lost-ACK recovery. A ready row whose full body is ACKed but not yet sealed waits for the original client seal; it does not invent a seal or classify that ordinary gap as lost.

If a ready row has regressed edge input, or an already-dispatched/result row has lost its complete input or original execution binding, the connector publishes PREVIEW_STATE_LOST through the existing uncertain endpoint. It retains the native journal state, exact input and complete response files without dispatching again. Another nonempty connector owner remains an explicit ownership conflict. For an original actions request, available operation, Workspace and deterministic task lookup identifiers are derived from the retained original payload; they identify the original task to inspect and do not claim a new task has run. The paired edge ends an outstanding input wait with409, X-Eco-Uncertain:1 and the original request ID. The matching browser/API client retains its uncertain checkpoint and observes that same result or native task rather than restaging the mutation.
