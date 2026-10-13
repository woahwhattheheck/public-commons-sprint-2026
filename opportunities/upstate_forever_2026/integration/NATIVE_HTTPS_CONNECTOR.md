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
