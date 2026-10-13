# Native collective investment operations

## One original workspace

All commands use the same SQLite journal. A command is `{requestId, expectedRevision, method, args}`. Keep the request ID and complete arguments after an uncertain result. The request lookup exposes the accepted original result; issuing the same request replays that result before current-revision checks. A changed business decision needs a new explicit request.

```sh
node cli.mjs describe --directory /absolute/private/workspace --configuration /absolute/private/configuration.json
node cli.mjs command --directory /absolute/private/workspace --configuration /absolute/private/configuration.json --request /absolute/private/request.json
node cli.mjs list --directory /absolute/private/workspace --table resourceVersions
node cli.mjs item --directory /absolute/private/workspace --table requests --id ORIGINAL_REQUEST_ID
```

The browser sends the same commands with the current workspace and manifest identity. Its complete working copy retains unfinished editors and pending requests. It does not perform financial arithmetic or replace the original response number tokens.

## Provider configuration and original scope

An Escala connection selects the published mock host, sandbox, and an optional operator-configured tenant ID. That tenant label is a source binding, not a claim that the mock authenticated it.

An SDP connection selects provider `sdp`, environment, baseUrl, `authMode: apiKey|jwt`, private token, optional `tenantName`, optional fixed `distributionWalletId`, and exact `networkPassphrase`. API keys and JWT role permissions differ. Distribution-account access must be present on the selected provider credential. When configured, the wallet selector becomes X-Wallet-Id only on operations that declare that header. Explicit conflicting selections fail.

A Horizon connection selects provider `horizon`, environment, baseUrl, networkPassphrase and account IDs. A root network response must match that passphrase before it is usable as network evidence. Historical sources remain tied to the complete original public connection descriptor and credential binding; rebinding an alias cannot silently relabel an older response.

## Original source intake

Use the exact issued action, original request parameters, actual response status/headers, full body and observation time:

```sh
node cli.mjs import-source --directory /absolute/private/workspace --configuration /absolute/private/configuration.json --source /absolute/private/original-response.json --connection SELECTED_ALIAS --action ORIGINAL_ACTION --request-id ORIGINAL_REQUEST
```

The generic command offers all metadata through `source.import`. `inputJSON` accepts the complete original request wrapper as text, alternative to `input`; duplicates, nonfinite numbers and values that cannot be represented exactly for a native request are rejected. Keep financial amounts as the strings required by the selected provider. Original response numeric tokens are retained independently of parsed JavaScript display values.

A source may be accepted yet fail projection; the full original remains available with that finding. Projection errors do not become complete coverage. Imported SDP/Horizon observations are labelled operator-supplied; Escala observations retain the stronger published-mock classification.

## Requests, captures and readback

`operation.prepare` accepts `{connectionAlias,action,input|inputJSON,evidence?,fileId?}`. Preparation freezes the exact method, URL, selected headers, body, file bytes, authentication protocol and source schema. `operation.dispatch` sends that original request once. Enable the original delivery setting explicitly for mutations.

Only the selected catalogue's implemented operations are dispatchable. Documentary Escala webhook paths remain disabled. The mock does not supply effective idempotency. The selected SDP contract does not establish automatic financial retry. Readback retains the original uncertain attempt and follows the selected read action; paginated matches require terminal coverage before uniqueness is reported.

`capture.start` freezes a read-only request; `capture.run` continues the same capture. SDP page/limit selection and next-link filters are preserved. Horizon retains cursor/order/filter constraints. A bounded RUNNING or PARTIAL capture can be continued with a new original command targeting that same capture; prior accepted commands remain immutable.

## Programmes and reviewed relationships

`book.save` accepts `{definition,bookId?,sourceIds?}`. The definition includes:
`id,name,environment,connections:{escala:[],sdp:[],horizon:[]},tenantId,communityId,fundId,projectIds,proposalIds,milestoneIds,distributionWalletIds,period:{start,end,timeZone},notes`.

`link.save` selects `{bookVersionId,decision}`. Native code derives the logical bookId and supplies recordedAt once if absent. Decision status is proposed, accepted or rejected. A superseding decision pins the exact prior decision ID. Prior accepted economic effects remain active through proposed/rejected successors; an accepted withdrawal removes their effect. Full reasons, actors and original source IDs remain retained.

A relationship is an explicit reviewed association. Allocation is restricted to an original SDP payment and independently selected Horizon operation, with exact amount, account, asset, issuer, network, memo and transaction evidence. No exchange rate or native approval is inferred.

## Plans and separate SDP stages

`plan.save {bookVersionId,definition,originalFileIds?}` creates an immutable saved plan. Optional originalFileIds select complete previously retained recipient files; native code verifies their bytes and pins originalFileIds plus complete originalFiles descriptors in the plan. The definition pins milestoneVersionId, proposalVersionId when selected, approvalVersionIds, evidenceVersionIds, treasuryVersionIds, distributionWalletVersionId, assetVersionId, recipientWalletVersionId when required, registrationContactType, verificationField, full rows and note. Each row retains id, amount, paymentID and selected contact/address/memo/verification fields.

The returned record contains `status,findings,totals,versionPins,createInput,csv,files,csvFileId,definitionFileId,originalFileIds,originalFiles`. Download the original file descriptors. The JSON includes all source editions, not merely the displayed grid.

`plan.prepare {planId,stage}` creates the original prepared operation. For instructions/status, also select `disbursementVersionId`; status additionally requires STARTED, PAUSED or CANCELED. The selected disbursement must have the same original connection, source wallet, asset, registration and recipient wallet as the plan. The retained CSV is used verbatim for instructions.

The official instruction upload limits are 10,000 rows and a complete multipart request no larger than 5,000,000 bytes. The app preserves SDP contact and verification semantics, with provider-current phone/date/role validation still performed by SDP. PREPARED is a local construction result.

## Reports, streaming and handover

`reconciliation.create {bookVersionId,versionIds?,sourceIds?,captureIds?,name?}` freezes complete selected versions, their original sources, historical facts, current decision tips, capture coverage and stream checkpoints. `report.create {reconciliationId,name?}` retains whole JSON, CSV and HTML from that immutable edition.

The [Horizon worker](SETTLEMENT_STREAM.md) uses the same store and one lease. Open-ended events are not complete-period coverage. Received workspaces pause workers and disable delivery.

`workspace.export` freezes a whole handover into the supplied destination. `archive`, `unpack`, `package-inspect` and `package-receive` preserve complete byte identities. The CLI file command streams exact retained attachments. Runtime/source retention, full replay and independent customer return are covered in [Commissioning](COMMISSIONING.md).
