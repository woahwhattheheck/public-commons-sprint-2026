# SF47 agent client

agent-client.mjs gives applications typed access to the original planning and delivery service. It uses the same managed launch validation as **Grant planning and delivery** in Applications, and the same authenticated HTTP routes as the browser.

The original Workspace, Operations, forecast and portfolio implementations remain the authorities for saved revisions, source attachments, record states, allocations and calculations. This client opens no SQLite database and stores no alternative business records.

The complete Merchant setup, tools, input references, source-bound pages, downloads, same-ID recovery and receiving workflow are in [Grant workspaces through Merchant MCP](../../../../stellar-forge/mcp-merchant-operator/GRANT_WORKSPACES.md).

## Direct API

First call inspectGrantAgentBinding with directory and optional scenarioFile, pythonExecutable, allowStart and label. It reads the original host selection without launching a process. Construct a GrantWorkspaceClient from that result.

| Method | Original operation |
| --- | --- |
| open({expectedSelectionSha256?}) | Borrow the verified current managed service, or explicitly start its original launcher when allowStart is true. |
| inspect() | Inspect current original launch and connection ownership. |
| browser() | Obtain the same private original browser access link. |
| read(view, selection) | Original plans, plan revision/history, cases, case/report/history, forecasts or review. |
| plan(action, planId, body) | Original estimate, save, restore or clone with current revision. |
| createCase(body) | Original case from the reviewed immutable plan/content hash. |
| command(caseId, body) | Original record/review lifecycle command with current version, actor and request ID. |
| forecastPreview(caseId, expectedVersion, inputs) | Pure original remaining-work and dated cash preview. |
| forecastSave(caseId, body) | Original save against the same input and reviewed preview SHA. |
| download(kind, selection) | Complete original ZIP, source, scenario or CSV. |
| importBundle(kind, bytes, body) | Original complete plan or case ZIP receiver. |
| importScenario(bytes, body) | Original source JSON with native byte identity. |
| attach(caseId, bytes, body) | Native source attachment. |
| intake(bytes, body) | Existing original source-intake importer. |
| detach(expectedInstanceId) | Drain the client and close only its own original server, or release a borrowed connection. |
| close() | Final process shutdown; drains requests and closes owned original service. |

Native data responses contain value, bytes, mediaType, status, sha256, source and filename. The value is present for JSON; bytes is always the complete exact HTTP body. The source identifies the actual managed instance and source selection. Native financial strings are passed unchanged.

The service accepts complete bundles up to 32 MiB and original source inputs up to 8 MiB. The client receives complete responses up to 64 MiB. The Merchant layer retains large responses and serves exact arrays and byte chunks, so those responses do not have to fit in a model message.

Mutations retain their original requestId and current version/revision. After an interrupted response, recover the original request with the identical payload. The original database rejects a changed payload under that same ID. The client performs no automatic write retry.

A borrowed Applications instance keeps its existing lifetime. A client-started service uses the same original managed startup and workspace lock; the client drains and closes that owned server on shutdown. Keep the access-fragment URL and private launch record with the original operator.
