# DeFarm Partner Batch Desk

This complete local application turns one original partner export into a retained DeFarm ingestion case. It opens original CSV or JSON, makes field conversions explicit, calls the unchanged DeFarm SDK preview, preserves the complete response, commits the selected bytes after the operator reviews them, reads returned DFIDs through the original public verifier, and receives a complete case on another machine.

## Run the complete source

Node 20.19 or newer is required. The upstream SDK remains exactly the 50 original source/configuration/example/test files at e9b66dcb1e6e66011677be8af522f4e31ca9ed74. The original package-lock controls its installation. The server imports the built upstream dist/index.js directly; it does not install the deprecated 0.1 SDK or miniapp package.

1. Materialize the full source bank, retaining every path and declared SHA256.
2. Run npm ci --prefix upstream/defarm-sdk-ts. This executes the original package's build/prepare lifecycle and installs the original pinned dependency closure.
3. Run node server.mjs from this application's directory.
4. Open http://127.0.0.1:4317 in the actual browser. Local source preparation, case receiving, report and full downloads work immediately.
5. For the original partner's actual preview/ingestion, configure DEFARM_API_KEY in that server process. DEFARM_GATEWAY is the actual HTTPS gateway origin, default https://gateway.defarm.net. DEFARM_NETWORK is the original SDK label, testnet or public. This label does not change the selected gateway or choose the server's actual anchoring network. The API key is scoped by DeFarm to its partner circuit.
6. DEFARM_DESK_DIR selects the full durable working directory; default ./partner-workspace. DEFARM_DESK_PORT chooses the local port.

The API key stays in the server process. It is not a form field, a saved case, a source-bank value or an exported secret. The desk binds each actual preview to the configured gateway/key using a local HMAC scope; a different key or received preview requires a fresh local preview. Sealing, granting, or changing visibility is not part of this ingestion workflow. Those functions remain in the unchanged upstream SDK.

## Work the source

Choose a UTF-8 JSON array of item objects or an ordinary CSV with unique headers. The complete original text, byte count and SHA256 are retained. CSV values begin as strings. Select number, boolean, JSON or empty-to-null only when the intended field needs that transformation. A blank target omits that field from the selected request while retaining the original. Numeric conversion rejects unsafe integers; identifiers such as SISBOV should remain quoted strings.

Save a named batch. Source identity includes the original name/format/hash, explicit mapping, exact selected request bytes, gateway, network label and upstream SDK version/commit. Re-selecting the same identity reopens the existing case and its original operations. A changed source or mapping creates a separate saved edition.

The Source & selected items view shows the first 250 rows for interactive reading. The original download, complete report, source-row CSV and case package retain every row. JSON-encoded source and selected-item columns distinguish exact strings, types, absent fields and embedded newlines.

## Preview and commit

The server calls exactly DefarmClient.ingest(items, {preview: true}). The upstream producer posts {items} to /v1/partner/ingestions/preview with X-API-Key. HTTP 200 is insufficient: the desk retains the full body, examines original errors and unresolved-row status, and presents original summary/routing. Unknown response shapes remain visible for review.

A recognized preview with no reported errors can admit the same selected bytes. Commit shows the original source, item count, gateway and exact payload SHA256, and calls the same SDK method without preview. The gateway may create, enrich, or leave records unresolved. The desk keeps its full original response, all errors and all returned DFIDs. It never matches response items to source rows merely by array position.

The SDK exposes a direct request here. It does not expose a job queue or an ingestion idempotency-key option. The desk records the operation before sending and preserves returned wire bytes before SDK interpretation. A closed request's original retained wire response can finish local receiving after interruption. An operation without returned response bytes becomes an interrupted commit requiring recovery of its original result, rather than sending the same ingestion again.

Open Notes & recovery to receive that original response JSON and record where it came from. This continuation records operator-recovered response provenance and preserves the original interrupted operation. A new source edition can be prepared separately. There is one commit history per exact saved batch.

Preview and commit are serialized for the selected case. The local workspace has an exclusive process lock. SIGINT/SIGTERM waits for the original operations to settle. If the process was killed, node server.mjs --recover-lock admits recovery only when the recorded PID is actually absent on the same host. It does not kill another process. Preserve the working directory when restarting.

## Read the result

Read returned DFIDs calls exactly DefarmClient.verify(dfid), the unauthenticated original gateway aggregator. Complete wire bodies and SDK results are retained per DFID. The SDK's trusted-timestamp and sealed-commitment convenience fields are best-effort extractions; the raw gateway report is visible. Independent Stellar/IPFS verification is the separate upstream defarm-verify product.

The HTML report contains original source identity, selected request identity, all operation responses, verification reads, original source rows and selected items. Browser Print can produce a PDF. Download complete case includes the full retained case text and its byte/hash manifest. The source-row CSV keeps original values encoded as JSON to preserve types and strings.

## Receive and reopen

The browser's Receive a complete case action verifies the whole package and every declared source/request/response identity, saves the original package unchanged, retains its complete operation history, and opens the selected case. It does not repeat an ingestion. If a differing history for that identity already exists, use a separate workspace directory so both originals remain available.

For a file-only recipient:

    node receive-case.mjs COMPLETE-CASE.json NEW-OUTPUT-DIRECTORY

This command writes a staged, complete receiving directory with the unchanged original case package, case JSON, original source, exact selected request, full source-row CSV, HTML report and verified per-file manifest, then publishes it into the chosen new directory. Repeating the exact complete-package receive into that completed directory verifies its entire original inventory and returns the prior manifest. A different package or changed output is preserved for separate receiving. No gateway operation occurs. Open report.html locally, or use the original complete-case.json in the running browser desk to continue.

Hash verification preserves byte identity and detects changed copies. It does not assert that a received operator-authored file came from DeFarm. Gateway-returned and operator-recovered response provenance remain explicitly distinct in the case.

## Original-source contracts

- SDK repository and immutable source: https://github.com/defarm-repo/defarm-sdk-ts/tree/e9b66dcb1e6e66011677be8af522f4e31ca9ed74
- Actual ingestion producer: src/client.ts, DefarmClient.ingest; src/api/http.ts.
- Actual preview-body error example: examples/02-ingest.ts. It expressly checks errors inside a 200 response.
- Actual typed response reference: https://github.com/defarm-repo/tooling/blob/6de60c9ad3539052e240461f4aa875bca88d2727/packages/sdk/src/types.ts
- Actual current tooling migration issue: https://github.com/defarm-repo/tooling/issues/1
- Public developer onboarding: https://github.com/defarm-repo/tooling/blob/6de60c9ad3539052e240461f4aa875bca88d2727/docs/build-on-defarm.md

All original SDK licensing is included. The small response DFID walk in core.mjs follows the original MIT-licensed SDK function and is used only to continue an already retained gateway response.

## Native receiving course and rendering

The equipped original receiver should install the complete original source, start this desk in a fresh owned workspace, open it in the actual browser and operate source mapping, saved-batch reopening, the existing complete-case receiver, source/report downloads, narrow-window tables and all visible controls. Where an actual authorized partner staging key and original batch are already available, continue the exact preview, commit and original-response read course above. Retain the actual gateway response, selected source, browser result and complete received package with that same case.

Inspect every outgoing human-visible artifact rendered before delivery: open its original files, operate its controls, read tables at narrow width, and repair obvious formatting, missing-source or broken-link errors. Review should be on the complete application and retained original case, with its actual runtime. The standalone pure core can also be executed against controlled response records to check parser and interruption transitions; that software exercise is distinct from a partner gateway run.

## Product limits that affect use

Original input text is admitted up to 16 MiB; HTTP receiving accepts up to 80 MiB serialized JSON. Full case exports include response histories and may eventually exceed receiving admission, so select an appropriate local batch size and retain the whole original working directory for large histories. The 250-row interactive view is a display page, not a source cut.

This edition is a local single-operator application. Its HTTP listener binds 127.0.0.1, checks the expected host and same-origin mutation token, and keeps files private to the process user. Remote/team deployment is part of an explicit commissioning scope with authentication and a durable service owner.
