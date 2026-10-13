# Source Monitoring customer-agent operations

This guide operates the existing installed Source Monitoring application through its maintained JavaScript client and Merchant provider. It covers original source and portfolio intake, native matching requests, separate identity and relevance decisions, saved review cycles, independently edited reviewer returns, complete file transfer and onward workspace receiving.

The agent borrows an already running, explicitly selected application. The original NDJSON workspace, dataset engine, monitoring domain, matching service and database own all business operations. These tools do not start a service, create another case store, choose a screening provider, adjudicate a customer case or sign off a review on someone's behalf.

Use this guide with [the complete operating guide](OPERATING.md), [saved review cycles](REVIEW_CYCLES.md), [the independent reviewer exchange](REVIEWER_EXCHANGE.md), the original source contract and the configured customer's workorder. The original review and source meanings remain unchanged.

## 1. Select the actual installed workspace

The host configures the provider family and configuration key `sourceMonitoring`, provider ID `source-monitoring-workspaces`, through its `sourceMonitoringConnection` input. The value points to one existing private JSON configuration file. The installed host setup/commissioning guide supplies that file to the existing Merchant host; it does not launch a second monitoring service.

### Supported installed host preparation

Use the maintained installed helper to prepare the same selected Application/home and existing Merchant configuration. The complete selection and continuation procedure is [CUSTOMER_SETUP.md](CUSTOMER_SETUP.md). It preserves the selected source configuration and Merchant configuration as explicit originals.

```sh
node /ABS/RUNTIME/source/products/source-monitoring/customer-setup.mjs prepare \
  --runtime-workspace /ABS/OPERATOR \
  --selection /ABS/PRIVATE/selection.json \
  --out /ABS/PRIVATE/plan.json

node /ABS/RUNTIME/source/products/source-monitoring/customer-setup.mjs status \
  --runtime-workspace /ABS/OPERATOR --plan /ABS/PRIVATE/plan.json

node /ABS/RUNTIME/source/products/source-monitoring/customer-setup.mjs advance \
  --runtime-workspace /ABS/OPERATOR --plan /ABS/PRIVATE/plan.json

node /ABS/RUNTIME/source/products/source-monitoring/customer-setup.mjs verify \
  --runtime-workspace /ABS/OPERATOR --plan /ABS/PRIVATE/plan.json
```

These paths are operator selections, not supplied customer paths. The setup selection schema is `stellar-forge.source-monitoring-customer-setup.v1`. It retains the original operation UUID, selected Runtime workspace/Application/revision/run/home identities, source alias, existing private storage, exact source and Merchant configuration paths, expected file SHA values, and optional label, timeout and complete input-file aliases. Both configuration paths belong to the selected Application home's configuration directory; the existing Merchant JSON is required.

Keep the returned plan for status, advance and verify. Use explicit `advance --recover` only for the same stopped configuration worker when the maintained setup procedure establishes that condition. A missing response does not permit another configuration worker or a replacement operation.

The following complete receiving entry is `products/source-monitoring/receiving/customer-agent.mjs`. Its exact caller arguments are `--runtime-workspace DIR --plan JSON --python ABS --output ABS --selection original-reviewer-selection.json`. It joins the existing reviewer course through its explicit client factory; the default original course remains unchanged. Its original owner supplies the selected complete reviewer inputs, native connection and borrowed browser contexts. Preparing this source does not claim that receiving has run.

### Original provider configuration

The configuration schema is `stellar-forge.source-monitoring-workspaces.v1`. Its exact top-level fields are `schema`, `storageDirectory`, `workspaces` and optional `files`. `workspaces` contains one through 32 aliases. `files` contains at most 1,000 deliberately selected input aliases. Aliases use lowercase letters, digits, underscore and hyphen; the first character is a letter or digit and the maximum length is 64.

Each workspace entry has:

| Field | Meaning |
| --- | --- |
| `connectionFile` | Existing original Applications connection file; relative paths resolve from the configuration file's parent. |
| `expectedWorkspace` | Exact canonical absolute physical directory of the original native workspace. |
| `expectedBindingSha256` | Actual installed launch binding SHA-256 selected for that workspace and source. |
| `label` | Optional operator-facing name, otherwise the alias. |
| `timeoutMs` | Optional native client timeout, default 120,000 milliseconds. |

The original connection is either the private saved Applications URL or the supported saved Applications connection record. The maintained client validates the actual loopback launch, domain schema, source binding and physical workspace before each native operation. A changed token may belong to the same restarted application; a different physical workspace or source binding requires deliberate selection of the new identity. The token remains in the original private connection file and is not an agent argument or output.

`storageDirectory` is an existing private directory owned by the host. The provider retains complete original inputs and outputs in a content-addressed subdirectory bound to the tuple of workspace alias, physical directory and source binding. That durable file identity is separate from short-lived range-read handles.

Each configured input file entry contains `path`, exact `bytes`, exact `sha256`, and optional `name`, `media` and `sourceUrl`. The configuration pins a full original file, including a customer return or receiving ZIP. Paths may be relative to the configuration file; the runtime resolves and checks the actual regular file. Input aliases do not permit arbitrary path access from a tool call.

A configuration example uses placeholders deliberately; replace them with identities already observed from the actual original launch and full files:

```json
{
  "schema": "stellar-forge.source-monitoring-workspaces.v1",
  "storageDirectory": "./private-agent-files",
  "workspaces": {
    "review": {
      "label": "Selected customer monitoring workspace",
      "connectionFile": "./original-connection.json",
      "expectedWorkspace": "/absolute/original/workspace",
      "expectedBindingSha256": "<actual 64-character lowercase SHA-256>"
    }
  },
  "files": {
    "reviewer-return": {
      "path": "./received/Reviewer_Return.json",
      "bytes": 12345,
      "sha256": "<actual complete file SHA-256>",
      "name": "Reviewer_Return.json",
      "media": "application/json"
    }
  }
}
```

The displayed byte count is illustrative, not a supplied customer file. Select the real count and digest before configuration. Do not insert API keys in this document. Matching credentials remain the original domain's named environment references.

Call `merchant_monitoring_workspaces` with `{}` to read configured aliases and complete input-file descriptors. Then call `merchant_monitoring_inspect` with a `scope` copied from the selected entry:

```json
{
  "scope": {
    "workspace": "review",
    "expectedWorkspace": "/absolute/original/workspace",
    "expectedBindingSha256": "<actual original binding SHA-256>"
  }
}
```

Every other scoped tool requires that same complete scope. A portable workspace can be received into another physical directory while retaining original record identities. Give that receiving application its own configured alias and actual directory/binding. A matching logical case or portable workspace ID does not authorize writing to another branch.

## 2. The nine complete tool operations

All tool schemas close unknown keys. The runtime snapshots the complete arguments synchronously, validates that snapshot, then uses those same values through asynchronous work. Native business validation remains in the maintained domain.

| Tool | Complete operation |
| --- | --- |
| `merchant_monitoring_workspaces` | List the configured original workspace aliases and exact input-file selections. |
| `merchant_monitoring_inspect` | Verify the original live connection and selected physical workspace/source binding. |
| `merchant_monitoring_read` | Read one of the 26 original native GET operations with its exact query parameters. |
| `merchant_monitoring_command` | Send one of the 23 original POST operations from complete original JSON text or a verified configured JSON file. |
| `merchant_monitoring_upload` | Retain one complete configured original file in the native object store. |
| `merchant_monitoring_receive_archive` | Receive one full selected workspace ZIP through the original native importer. |
| `merchant_monitoring_download` | Acquire one complete native workspace/object/source/reviewer file and retain its exact immutable descriptor. |
| `merchant_monitoring_file_read` | Read a bounded range from that complete retained output, or an explicitly selected original native file. |
| `merchant_monitoring_file_release` | Release the selected read handle without deleting the retained source or stopping the application. |

Successful native JSON replies use `stellar-forge.source-monitoring-agent-result.v1` with status `NATIVE_RESPONSE`, the selected scope and operation, optional complete input selection, and `response`. The response contains its actual HTTP status and headers, complete byte count, SHA-256 and `selection: {kind:"retained",sha256,bytes}`. Its separate `response.metadata` is a retained JSON file with schema `stellar-forge.source-monitoring-agent-http.v1`, original scope/operation, request descriptor when present, actual status/headers and complete body identity. Read that metadata through the same retained-file tool when preserving the full HTTP correspondence.

When the full response is at most 32,768 bytes, `response.rawJson` contains its complete original JSON text. Larger replies set that field to null and preserve the entire original response as the same retained selection. There is no summarized row substitute. Read every requested byte of that selection before relying on a complete population or file.

`CONNECTED` identifies successful launch inspection. `FILE_RETAINED` identifies a complete native download; its immutable selection is under `file.selection`. `NATIVE_ERROR` is a failed native operation, even if the Merchant call itself returned a structured result. The error carries the original failure classification, uncertainty and complete retained evidence. Inspect that evidence and any complete native HTTP body before deciding the next action.

Original JSON is exposed as text so exact numbers and source tokens can remain unchanged. A caller that parses an unsafe integer into a JavaScript number can lose precision. Keep the full original text/file authoritative and use an exact-number parser when those values matter.

## 3. Read the complete source and operating state

`merchant_monitoring_read` takes `scope`, `operation` and a required `parameters` object. Use `{}` for an operation with no query parameters. The following table is the exact original read mapping.

| Operation | Required parameters | Optional parameters |
| --- | --- | --- |
| `state` | none | none |
| `contract` | none | none |
| `entity` | `scope`, `id` | none |
| `entities` | `scope` | `offset`, `limit` |
| `aliases` | `scope`, `id` | none |
| `changes` | `comparison` | `offset`, `limit`, `kind`, `material` |
| `impacts` | `comparison` | none |
| `case` | `id` | none |
| `statements` | `set` | `entity`, `offset`, `limit` |
| `response` | `id` | none |
| `request` | `id` | none |
| `update-plan` | `before`, `after`, `index` | none |
| `cycles` | none | none |
| `cycle` | `id` | none |
| `cycle-request` | `id` | none |
| `cycle-report` | `id`, `version` | none |
| `gleif-intake` | `requestId` | none |
| `review-exchanges` | none | `offset`, `limit` |
| `review-exchange` | `id` | `offset`, `limit` |
| `review-exchange-request` | `requestId` | none |
| `review-exchange-compare` | `returnId`, `editionId` | `adoptionRequestId` |
| `portfolio-cycle-reviews` | `comparisonId` | none |
| `portfolio-refreshes` | none | none |
| `portfolio-refresh` | `id` | `offset`, `limit`, `kind`, `query` |
| `portfolio-refresh-request` | `requestId` | none |
| `portfolio-refresh-report` | `id` | none |

Here, `parameters.scope` is an original source edition or portfolio SHA, while the outer `scope` selects the physical application. They serve different roles.

Page limits range from 1 to 250. Follow each response's actual `nextOffset` where present. The portfolio-refresh view instead exposes `offset`, `limit` and `total`; continue the same selected comparison until its complete total has been received. Preserve filters across pages. A specified source-change `kind` takes precedence over its `material` flag, matching the original native route. Portfolio kinds are added, removed, changed, unchanged or the explicit empty filter.

A case read returns its actual history. A cycle report selects its real signed historical version. A reviewer comparison with `adoptionRequestId` opens the saved original adoption comparison read-only and separately exposes current versions; it does not recompute or relabel the earlier decision.

Request identifiers are not interchangeable. Cycle-command and reviewer-exchange request IDs are canonical UUIDs. GLEIF intake and portfolio-refresh requests use the actual original text identifier; portfolio requests can be `portfolio-refresh-` followed by a digest. Do not manufacture a UUID to replace that retained ID. Native case, edition, object, source and comparison identities use their actual retained SHA-256.

## 4. Preserve the original command before sending

`merchant_monitoring_command` requires `scope`, `operation` and exactly one of:

- `jsonText`: the complete original JSON object text, retained before native dispatch and sent without reserialization; or
- `inputFile: {alias,bytes,sha256}`: one configured complete JSON file verified against those exact identities.

The native input boundary is 24 MiB in UTF-8 bytes. `jsonText` can preserve original numeric tokens outside JavaScript's safe integer range. The boundary validates that it is a complete object but does not parse and rebuild it as a new business request. Large or highly escaped originals can use the explicit configured file route.

Before calling the native client for a command, upload or archive receiving, the provider saves a complete request metadata file. The returned `request: {kind:"retained",sha256,bytes}` identifies JSON with schema `stellar-forge.source-monitoring-agent-request.v1`, the exact scope/native operation, full input descriptor and selected file metadata when applicable. This record proves that those bytes were prepared; it does not prove dispatch, commit or successful receiving. The native request identity remains inside the exact original input. No replacement agent request UUID is generated.

Keep the precise operator-authored request, identity, time, expected versions and review hashes with the selected case. Never change a body while reusing its original request UUID. A deliberate changed decision needs the original domain's new operation, after the operator has inspected current state.

| Original operation | Maintained function |
| --- | --- |
| `published-edition` | Receive the explicitly selected publisher metadata URL and source entitlement through the original fetcher. |
| `edition` | Accept previously retained original metadata and complete FtM entity objects with the selected metadata URL and provenance. |
| `portfolio` | Accept a complete retained customer FtM object with its actual key and label. |
| `statement-set` | Accept original statements for the selected edition, preserving source URL, full/partial declaration and scope. |
| `compare` | Compare exact original before/after editions and optional statement sets. |
| `update` | Stage the complete selected original delta index and exact required version/object list. |
| `fetch-update` | Acquire the selected edition's original delta index/files through the maintained source fetcher. |
| `select-update` | Record the reviewer and reason selecting the verified full target, guarded by its original selection revision. |
| `review` | Record the original source-change decision, reason, reviewer and any authority URL, guarded by the previous review. |
| `case` | Save the original customer case with separate identity/relevance choices, original source and current case revision. |
| `profile` | Save the actual matching profile, dataset, parameters and named credential environment reference. |
| `prepare` | Prepare the original match/entity/catalog/statements request without dispatching it. |
| `dispatch` | Dispatch that exact prepared matching request with its expected original revision. |
| `receive-response` | Receive the complete actual provider response, status, headers and source note against the original request. |
| `query` | Use the original native dataset query route `/api/query`; the adapter does not implement another query engine. |
| `cycle-command` | Perform original create/assign/complete/reopen/signoff with its request UUID and expected cycle version. |
| `gleif-preview` | Inspect the complete retained GLEIF portfolio input before original intake. |
| `gleif-receive` | Receive the reviewed input with its original intake ID and exact preview identity. |
| `portfolio-refresh-prepare` | Prepare the original before/after customer portfolio comparison. |
| `portfolio-refresh-command` | Record the original reviewed/retain/continue decision and exact case revision. |
| `review-exchange-issue` | Prepare and retain the complete selected original reviewer issue JSON and editable HTML. |
| `review-exchange-return-preview` | Inspect the exact retained returned file before recording receiving. |
| `review-exchange-command` | Record the original issued/received/applied exchange command in the same case/cycle domain. |

The complete operation-specific body remains the native contract. Tool schemas close the operation set and transport; they do not translate camelCase/snake_case native fields or synthesize missing values. For example, the original case writer uses `portfolio_id`, `counterparty_id`, `candidate_id`, `edition_id`, `case_id` and `expected`, while exchange and cycle envelopes use their original camelCase fields.

Publisher acquisition and matching dispatch can contact the configured original external service. Use the customer's selected entitlement, actual source endpoint and reviewed request. A source download, successful HTTP status or matching score is not a human relevance or identity decision.

## 5. An end-to-end customer monitoring cycle

Begin by reading the original state and contract, then select the actual portfolio, source edition, previous case and configured matching profile. Download complete original source files when inspection requires their contents, not just a metadata row.

For an explicit local source intake, upload the complete metadata, entities, portfolio or statement files separately. Each upload returns the original native object descriptor. Use those native IDs in the appropriate original acceptance command. Upload alone does not create an accepted edition or case. Complete original statement populations remain distinct from partial statement evidence.

For an update, select both original complete editions and the real delta index. Read `update-plan`, upload every required published delta and preserve its version. Stage the original chain, inspect the full reconciliation, then record the actual reviewer's selected target/reason against its expected prior selection. The complete later edition remains independently retained.

For matching, save the actual profile and prepare its original request. Inspect that request and its correlation to the customer's original entity IDs before dispatch. Dispatch the retained request with its current expected revision. Read the actual request and response afterward. If the original request has left PREPARED, do not create another request merely because a reply was interrupted. Receive the actual provider result under the original native recovery contract.

Save a case only after the designated operator supplies the separate resolution, relevance, source edition, reason and policy. Use the case's exact current revision. Preserve existing history when a canonical identifier or customer portfolio changes.

Create a saved review cycle from the actual source comparison or portfolio-refresh comparison. Use the original frozen affected population, selected supervisor and assignments. The assigned reviewer completes a case against its actual current decision and original evidence. A portfolio-review completion references the real original retain/continue event for that case and pair; the editor or agent cannot create that event by naming an arbitrary ID.

The supervisor explicitly signs off an eligible cycle. Later case work is visible as current/stale state while the previous signed report remains historical. If the workflow requires reopening, retain the original signoff and use the original reopen command.

## 6. Issue, return and adopt an independent reviewer copy

This path is the same [reviewer-exchange workflow](REVIEWER_EXCHANGE.md) used by the installed browser.

1. Read the actual cycle, current version, assignments and selected case histories. Receive the supervisor's case selection and named reviewer identity.
2. Call `review-exchange-issue` with the complete original issue selection. Preserve its request UUID. The native operation retains both exact issue JSON and complete editable HTML before returning their descriptors.
3. Download `kind:"review-exchange"` using its actual issue ID, `issued_html` role and exact SHA/bytes. Read the retained file completely and hand the original HTML to the assigned reviewer.
4. The reviewer operates the complete independent editor. Unfinished raw drafts may be exported and returned without a fabricated named edition. Named editions retain all issued cases, actual reviewer attribution, parent history and complete evidence.
5. Configure the received complete JSON or HTML as an actual file alias with its full digest/count. Upload that file. Preserve its original filename and media type even when native content deduplication already knows the same bytes under an earlier name.
6. Call `review-exchange-return-preview` with the exact retained `{sha256,bytes,name,mediaType}` descriptor. Then record the original `receive` exchange command with its UUID, actor, time and complete file descriptor.
7. Read `review-exchange-compare` for the actual return ID and selected named edition. A file with only an unfinished draft remains evidence; adoption requires a real named edition.
8. Obtain explicit keep/apply choices and every divergent field choice from the receiving operator. Send the original apply envelope with exact `reviewSha256`, `expectedCycleVersion`, all `expectedCases` and choices. Native case changes, cycle completion and exchange history share the original transaction.
9. Recover the same request if the reply is uncertain. Read the resulting exchange and original cases/cycle. Reopen the historical comparison using its actual `adoptionRequestId` after later work.
10. Export the full native workspace and independently receive it into the selected receiving application. Reopen the original issued/returned files and adoption comparison there.

A named reviewer edition does not itself sign off a cycle. A returned copy cannot approve its own source or overwrite intervening author work. When the selected portfolio case changes on adoption, perform the actual original portfolio review for that new case revision before claiming REVIEWED completion; FOLLOW_UP can retain the factual unfinished state.

## 7. Complete files, immutable downloads and range continuation

`merchant_monitoring_upload` selects `fileAlias`, exact `bytes` and `sha256`, plus optional original `name`, `media` and `sourceUrl`. The runtime copies and verifies the entire configured input before calling the native uploader. The native object receipt must match the sent bytes and hash. The agent output separately retains `selectedInput` so a content-deduplicated object does not erase the name/media selected for this action.

`merchant_monitoring_download` takes `scope` and one of these exact selections:

| Selection | Required complete identity |
| --- | --- |
| `{kind:"workspace"}` | Current native complete workspace ZIP is acquired once and returned as an immutable retained file. |
| `{kind:"object",id}` | Exact original native object SHA; optional expected complete `bytes`. |
| `{kind:"source",id}` | Exact original native source SHA; optional expected complete `bytes`. |
| `{kind:"review-exchange",id,role,sha256,bytes}` | Exact issue/return ID, role and selected complete descriptor. Roles are `issued_json`, `issued_html`, `returned_file`. |

After download, prefer `merchant_monitoring_file_read` with `selection: {kind:"retained",sha256,bytes}` from `file.selection`. The same pattern reads complete large native JSON replies through `response.selection`. Error evidence uses the same complete retained-file selection.

The range-read response is:

```text
{
  readId,
  file: {name, contentType, bytes, sha256},
  offset,
  bytesRead,
  nextOffset: null | integer,
  encoding: "base64",
  data
}
```

Decode `data` as the bytes at the returned absolute offset. Check the complete file identity on every continuation. Supply the returned `readId` and `nextOffset` for the same file until `nextOffset` is null. Retain the original chunks and verify the assembled byte count and SHA-256 before claiming a complete download.

Ranges default to 65,536 bytes and may request at most 196,608 bytes. The maintained reader permits four active reads with a 120-second idle lifetime; the last chunk closes its handle automatically. Explicit release is idempotent within its original scope.

If a handle expires or the agent restarts, reopen the retained selection with the same full SHA/bytes and resume at the original byte offset. Do not repeat a mutable workspace export to recreate the old selection: later case work may produce a different ZIP. The retained file remains addressable independently of the original read handle and native service.

`file_read` also accepts the four native selections for direct acquisition, but a saved `download` result is the clearer continuation for whole mutable workspace exports. For a direct native workspace selection, supply `expectedSha256` from the first returned complete file descriptor whenever reusing `readId` or resuming an offset; a retained selection supplies its expected hash automatically. A read handle is scoped to its exact selected workspace tuple and file; it cannot be moved to another configured branch.

## 8. Uncertain effects and actual first results

`NATIVE_ERROR` contains an explicit failure. The provider retains complete selected JSON/file bytes and the request metadata before invoking a native write. It then retains the complete error metadata and original native HTTP error bytes when available. `error.evidence` selects the whole error document; inline `error.detail` contains only its bounded transport summary. An available native error response includes status, headers, its complete retained body identity and `response.metadata` for the full HTTP correspondence. Select the body's `kind`, `sha256` and `bytes` when reading it; do not pass unrelated response metadata fields as file-selection arguments.

`error.dispatched:false` means the original client operation was not invoked. Correct the actual input/configuration before submitting it. For an invoked command, upload or archive receiving, `error.uncertain` preserves the native client's classification, conservatively true when no definite result was available. An invoked read-only operation has `uncertain:false`; a read failure does not submit a business command. Invocation alone does not prove that the native server accepted or committed anything. None of these flags permits replacement of an unresolved original write.

Use the native recovery route for the original operation family:

| Original action | Read its original outcome |
| --- | --- |
| Matching prepare/dispatch/response | `request` and `response` with the original request ID. |
| Saved review-cycle command | `cycle-request` with its original UUID under query key `id`. |
| GLEIF receiving | `gleif-intake` with its original `requestId`. |
| Portfolio retain/continue/review | `portfolio-refresh-request` with its actual original text `requestId`. |
| Reviewer issue/receive/apply | `review-exchange-request` with its original command UUID. |

For a committed command, use the first complete native result and continue from its current state. For a validated same-request absence or an explicitly uncommitted native validation rejection, inspect the full original response and correct the actual prerequisite. Repeating unchanged original bytes under the same original UUID is distinct from authoring a revised operation.

For legacy case/source-review/update-selection writes without a universal request-lookup endpoint, inspect their actual native history and expected revision. Do not pretend the agent storage adds server-side exactly-once semantics. A transport timeout must not trigger a new case, a repeated external matching request or an automatic second import.

If the outer Merchant reply is lost, the installed host can recover its complete preparation records in the selected private storage. The directory is exactly `storageDirectory / SHA256(UTF8(JSON.stringify([workspaceAlias, expectedWorkspace, expectedBindingSha256])))`; each retained file is named by its full content SHA-256. Inspect the full JSON request documents to recover the exact operation, input descriptor and selected scope, then read the original input and use its native request lookup/history. Do not infer a committed result from a request document's existence or from a filesystem timestamp.

If the complete reply could not be retained because storage was unavailable after a native action, its business effect may still exist. Keep the original input and selected scope; recover through the original native lookup/history. There is no synthetic success receipt.

## 9. Whole workspace receiving and continued work

Acquire the complete current ZIP once with `download`. Preserve its returned SHA/count and read all bytes. Configure that exact file on the receiving host. Select a separately configured receiving workspace and verify its actual connection/directory/binding before `receive_archive`.

The importer receives the original full archive. It owns conflicts, original source/native-build restoration, case events, saved cycles and exchange replay. It does not authorize replacing an unrelated existing case. The agent does not edit archive tables or rewrite IDs to force receiving.

After import, inspect the full received state and original source identities. Reopen selected case histories, signed cycle reports, issue and returned originals, named editions and historical adoption. Download an original source and a returned attachment and compare their exact complete identities. Continue one deliberately selected receiving edit through the original writer, then export again and retain that new complete file under its own SHA.

The original application remains the owner throughout. Closing the Merchant provider waits for its pending calls and releases its own read handles. It does not terminate the monitoring service, revoke another process's connection, replay the original native commissioning course or claim that a source-only integration has passed a rendered run.

## 10. Limits and practical receiving evidence

| Boundary | Current complete limit |
| --- | --- |
| Original native JSON command | 24 MiB UTF-8. |
| Original uploaded object/reviewer file | 256 MiB. |
| Original full workspace ZIP | 1 GiB. |
| Successful original native JSON response | 128 MiB; retained in full. |
| Inline original JSON text | 32,768 bytes; larger responses use the complete retained selection. |
| Range response | At most 196,608 decoded bytes. |
| Configured workspaces/files | 32 workspace aliases and 1,000 input-file aliases. |
| Independent reviewer JSON/HTML | Each complete file at most 256 MiB; the native exchange also applies its complete case, edition and evidence limits. |

A capacity failure preserves the available original files and identifies the complete boundary. Do not truncate entities, statements, history, named editions or evidence to turn an incomplete result into a declared complete one.

The installed host commissioning course should operate these nine tools against its actual original application and selected source. Receive complete source and file responses; inspect original query/case/cycle history; perform an explicitly selected reviewer issue/return/adoption; retain and reopen whole exports; stop the agent host and prove the borrowed application remains available; and reopen retained outputs under the same configured scope. Use the existing native/rendered receiving owner and its original operation, not a parallel provider job.

This agent interface is a maintained source integration. Source/API review and exact merged-file custody are separate from an actual equipped-host execution. The original completed customer receiving remains its own accepted result; report the newer agent commissioning only after the real caller supplies its complete native outcome and closure.

## Maintained implementation

- [catalog.mjs](catalog.mjs): complete tool declarations and synchronous closed-argument validation.
- [merchant.mjs](merchant.mjs): original client dispatch, full request/response custody and agent close.
- [agent-files.mjs](agent-files.mjs): private configuration, exact original inputs and complete durable file selection.
- [merchant-provider.mjs](merchant-provider.mjs): existing Merchant provider registration.
- [client.mjs](client.mjs): original authenticated monitoring HTTP/client contract.
- [client.d.mts](client.d.mts): complete native client types.

The current original source/API basis is PR1918, commit `7b142022a315055123bd01072c9465818d3080fc`. Installed provider/setup source is delivered alongside this guide. Customer commissioning selects the actual current full source and binding; it does not silently relabel the retained earlier application or its received files.
