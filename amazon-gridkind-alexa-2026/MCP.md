# GridKind: connect a local assistant to a saved household

This is the existing GridKind household application with a first-class MCP2025-11-25 interface. It uses the same Node24 server, SQLite household, exact optimizer, weekly review records and human approval controls. It does not change tariffs, devices, electricity, a smart-home account or any outside service.

## Open the original application and connect

Start the ordinary product, using a private workspace directory:

```sh
node server.mjs --workspace /absolute/private/gridkind --host 127.0.0.1 --port 4181
```

Open http://127.0.0.1:4181, select the household you intend to share, then use the **Assistant connection** panel. Name the assistant and create its connection. Download the complete `GridKind_Assistant_<connectionUUID>.json` file. Its standard configuration is:

```json
{"mcpServers":{"gridkind":{"type":"http","url":"http://127.0.0.1:4181/mcp","headers":{"Authorization":"Bearer <private-token>"}}}}
```

Use that file with a desktop client that supports MCP Streamable HTTP, or the included ordinary file client described below. The connection is limited to the selected household. If you select a different household in the browser, the assistant can still read its own linked saved history, but new planning requires you to reopen that linked household. It never switches the browser to another household automatically.

The connection file contains a credential. Keep it private and outside source control, public reports and household archives. The server stores only its SHA256 and cannot redisplay it from the connection list. The browser retains the exact initial request locally before creating a grant so it can recover a lost response with the same identity. Use the panel's local clear/revoke controls after adoption. Revoke ends access for every MCP session using that grant. Downloaded copies do not confer access after revocation.

The human browser remains the only approval interface. There is no MCP approve tool. A proposal from an assistant clears old approval, exactly as the ordinary planner does. After a human has reviewed and approved that exact proposal in the original browser, the assistant may invoke its **simulation**. Neither the browser nor MCP operates physical appliances.

## Use the included MCP client

No additional npm dependency is required. The file client opens the same network endpoint, negotiates the real protocol, closes that session on completion, and stores the complete tool response without printing household data or the credential.

```sh
node mcp-client.mjs --connection /private/GridKind_Assistant.json --catalog --out /private/catalog.json
node mcp-client.mjs --connection /private/GridKind_Assistant.json --request /private/state-request.json --out /private/state-result.json
```

The state request is:

```json
{"name":"gridkind_state","arguments":{}}
```

Every mutating request file contains a fresh UUID chosen once for that operation, the exact returned context, and the full intended arguments. For example, take `result.structuredContent.context` and `result.structuredContent.state.scenario` from the saved state response, then retain a request of this shape before calling:

```json
{"name":"gridkind_propose","arguments":{"requestId":"<original-operation-UUID>","context":{"householdId":"<returned-household-UUID>","generation":"<returned-generation-UUID>","revision":0},"input":{"prices":["<the24originalnumericprices>"],"maxKw":0,"tasks":["<theoriginaltypedloads>"]},"label":"Evening schedule"}}
```

The bracketed values above are explanatory placeholders, not runnable scenario data. Use the complete actual returned scenario and exact revision; do not reconstruct its missing values. The original input engine validates the actual numerical constraints.

After a proposal, the owner opens the original page, refreshes the current state, reviews its exact plan and chooses the existing approval control. Read state again through MCP. A simulation request uses that current context and `state.proposal.id`:

```json
{"name":"gridkind_simulate","arguments":{"requestId":"<new-original-operation-UUID>","context":{"householdId":"<returned-household-UUID>","generation":"<returned-generation-UUID>","revision":0},"planId":"<the-exact-approved-plan-id>"}}
```

The response explicitly says simulation only, and the retained original receipt has zero live device calls.

### Complete tools

| Tool | Original application behavior |
|---|---|
| gridkind_state | Current connected household, active proposal, actual browser approval, context |
| gridkind_history | Original paginated household records; offset and limit1–100 |
| gridkind_record | Complete original immutable record |
| gridkind_request_status | Original operation outcome, or explicit historical/absent observation |
| gridkind_propose | Original daily proposal and household history |
| gridkind_cancel | Original active-proposal cancellation |
| gridkind_simulate | Original exact approved-plan simulation |
| gridkind_save_scenario | Original saved inputs, clearing incompatible approval |
| gridkind_compare_tariffs | Exact proposal's original hypothetical tariff comparison |
| gridkind_plan_week | Original seven-day optimizer and immutable saved week |
| gridkind_adopt_day | Original saved successful day into daily inputs, with fresh approval required |
| gridkind_review_request | Original independent offline review request |
| gridkind_review_preview | Original/current/returned whole-day comparison |
| gridkind_review_apply | Original explicit choices and atomically linked return/new week |
| gridkind_export | Complete native household JSON, week CSV/calendar, review request JSON or offline HTML |

All schemas are available through `tools/list`. Tools cannot execute arbitrary routes, URLs, scripts or commands contained in source/review data. Weekly review files are the same complete files described in WEEK_REVIEW.md. The weekly and tariff computations retain their original hypothetical scope.

## Lost response, restart and deliberate new work

Keep the original request file. If a connection times out after a mutation, do not assign a replacement UUID. Inspect the original UUID:

```sh
node mcp-client.mjs --connection /private/GridKind_Assistant.json --recover <original-operation-UUID> --out /private/recovered-outcome.json
```

Or replay the same tool name, UUID and exact arguments using a new explicit output filename. The original household mutation and its full request/result receipt commit in one SQLite transaction. An accepted replay returns its first complete result without replanning, reapplying a review, or re-simulating.

The receipt is checked before a stale generation/revision can reject a completed replay. This works after an ordinary server restart, although the original application correctly does not revive a prior active approval. `result` is the retained original outcome; `currentState` and `context` are separately read current values. If the browser is on another household, those current fields are null and `selectionRequired` is true; no other household data is exposed through the grant.

A status of `not_found` is an observation, not permission to abandon an in-flight operation. Replaying the same UUID/body remains safe. If the original request has definitively failed because its live context is obsolete, retain it as history, read the current state and deliberately prepare a new request for the changed work. There is no automatic context rewrite or background retry.

The CLI never automatically retries a write and does not mint operation UUIDs. An existing output file is reused only if the complete returned bytes are identical. A different result cannot overwrite it; choose a new output path for current status or replay observations. Authentication/session failure creates no alternative connection or household.

## Export, receive and reopen

Use a complete artifact request such as:

```json
{"name":"gridkind_export","arguments":{"format":"household"}}
```

```sh
node mcp-client.mjs --connection /private/GridKind_Assistant.json --request /private/export-request.json --out /private/export-result.json --artifact-out /private/GridKind_Household.json
```

The artifact's complete UTF8 bytes are checked against the server's SHA256 and byte length before create-only publication. Other formats are `week_csv`, `week_calendar`, `review_request`, and `offline_review`; these require the original saved `recordId`. The CSV/calendar and reviewer HTML come from the existing exporters; the client does not rebuild them.

The ordinary household backup now includes all retained assistant request/results, including their source lineage after restoration. No grant or credential is exported. Restore the complete household through the existing browser import. Original records and accepted review history remain complete; imported assistant operations are labeled `received_history`. They can be read but cannot resume as active mutations or reauthorize old approval. Create a new connection for the restored household, read fresh context and deliberately choose new work. Repeated receiving preserves the whole earlier operation receipt and its previous source record, subject to the documented complete-size bounds.

This preserves the original household model: receiving creates a new household; it does not silently merge browser ownership or replace the original. Existing original request/results survive independently of later editable inputs.

## Limits, protocol and access

The transport is MCP2025-11-25 Streamable HTTP with JSON responses. POST accepts one JSON-RPC request or notification; GET returns405 because this server does not open SSE streams; DELETE closes the exact authenticated session. Initialization returns a session identifier; later requests retain that identifier and the negotiated version. Unsupported supplied versions are rejected before session deletion. Notifications receive202 without a response body. The catalog has15 tools and no further page.

The original Host check and exact Origin validation remain active. Assistant access is disabled when this server is explicitly bound outside localhost. Tokens are checked on every request and revocation is rechecked in the same transaction as each write. Sessions expire after an hour of inactivity and after server restart; reconnect with the same still-valid private connection and recover the original operation UUID. There are no polling watchers or automatic dispatch loops.

Bounds:8MiB request/complete export through MCP;4MiB per complete operation receipt and4MiB total assistant request history per household;2000 retained operations;50 live named connections per browser;100 active MCP sessions. A rejected receipt-size admission rolls back the domain write in the original transaction. Retain the complete original household before approaching these limits. Imports validate full request/result hashes and receiving lineage rather than dropping history to fit. The native household export remains the original supported receiving format.

Protocol references:
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- https://modelcontextprotocol.io/specification/2025-11-25/server/tools

## Existing receiving course and truthful readiness

Use the original379A/BBBD GridKind receiving owner and its current full-source installation. The addition requires the original Node24 SQLite runtime and browser, no npm installation or new process controller. Its useful native continuation is: open actual saved household → create/download connection → discover/call current MCP → propose → human browser approval → exact simulation → lost-response same-request replay → revoke → full household download/restore → new connection → historical original operation read with fresh approval required. Operate the weekly review/export tools against that same retained case. Use the included CLI to open actual saved configuration/request/output files and open the downloaded artifacts in their recipient-facing applications.

Source-level checks and peer review are recorded separately from native SQLite/protocol/browser and visually inspected output. No native or rendered completion is inferred from source publication. Preserve the original competition entrant/media owner and accepted optimizer measurements; do not rerun broad suites or replace a pending receiving owner.

<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->

