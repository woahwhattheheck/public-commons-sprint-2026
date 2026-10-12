# Customer commissioning operator

The original Redis / Valkey workspace includes a complete customer commissioning view at **/commissioning**. It uses the same saved source, writer lease, SQLite operation history, native previews, package builder and release controls as the product editor.

Open an existing workspace with the maintained command, then choose **Customer commissioning** in the header:

```sh
starforge-merchant redis workspace open --directory /PRIVATE/redis-workspace --port 8438
```

The returned operator URL carries the original local session token. The customer view retains that session when navigating between products, commissioning and releases.

## Prepare the customer contract

Choose the saved product version and keep one receiving example for every offered product. Each example names the original query, its input, a page and row budget, and the expected result. The six native query kinds are value, hash fields, sorted set, stream, list entries and set members.

The matrix supports these comparisons together:

| Expected field | Meaning |
| --- | --- |
| `columns` | Exact returned column names and order. |
| `rows` | Exact complete rows, preserving row order. |
| `requiredRows` | Required rows as a multiset. Repeated expected rows require repeated observed rows. |
| `rowCount` | Exact collected row count. |
| `rowsSha256` | SHA256 of canonical JSON rows, preserving array order and sorting object keys. |

Use the source's actual value representation: Redis numbers and numeric text remain strings; missing projected fields use JSON null; non-UTF-8 values use an object with a `base64` member. Native SSCAN order is unspecified and repeated members are possible, so choose a comparison that matches the customer's selected receiving contract.

**All pages** follows the original `nextInput`. Empty SSCAN batches with a continuation remain part of the run. A complete set scan must reach native cursor `0`. A final page with `truncated:true`, a native `OFFSET_LIMIT` or `INPUT_LIMIT` reason, or an unfinished set cursor retains that exact page and source reason for review before package creation. The operator exposes the original request and rows so the source limits can be corrected in a new saved version. A first-page example deliberately compares the selected first page.

Review the complete draft before saving. The review binds the complete original connection profile, public CA identities, saved source revision, examples, customer export selection and optional staged release. Environment variable **names** remain in the source; live receiving uses the existing workspace process environment. Editing and review work while the live source is unavailable.

A contract always selects its saved revision. A later product edit does not silently change an existing receiving request. Changed commissioning input is reviewed and saved as a new contract; the earlier contract and its operations remain available.

## Receive, inspect and continue

**Receive saved contract** first retains a parent request in the original workspace database, then queues it on the original writer. The browser can inspect progress while the same process executes the original preview, prepare and stage operations. Each child request retains its original revision, query, input and complete native result.

The view shows each example's collected pages, rows and comparison result. **Inspect rows** pages through the original saved native rows without rerunning the query. The source-limit panel names the final original request and native continuation reason. Expected-result differences return `ACCEPTANCE_MISMATCH` with the original observations.

The browser saves the full pending request before sending it. On a lost response, **Refresh original request** reads the retained result. If admission did not occur, **Send retained request** resends that same input and request ID. If the workspace process ended, opening the original workspace marks queued/running operations interrupted; **Continue original request** requeues that original parent and reuses completed child operations. A completed request returns its saved result when called again.

The complete local draft, including temporarily invalid JSON fields, is retained in the existing browser draft store under this workspace's commissioning namespace. Refreshing receiving or saved history preserves the edited draft. Contracts, results, public handover bytes and server-side operation state are in the original `workspace.sqlite3`.

## Include the customer export application

The optional customer application section selects actual generated GET operations from the saved merchant plan. Each product retains its original source query, kind, example input, set cursor parameter when applicable, chosen offer, payment flow and per-call atomic ceiling.

Set the customer's aggregate atomic allocation, maximum call count, response size and request timeout explicitly. The aggregate budget covers one selected network and asset. Review checks each offer against the saved plan and its per-call ceiling. These settings are carried into the original neutral customer export plan; making a handover does not initiate customer purchases.

The exported application calls the maintained `runCustomerExport` implementation with the original generated client, existing buyer context and `prepareBuyerResponseFile`. Its detailed plan and invocation contract are in [CUSTOMER_EXPORT.md](CUSTOMER_EXPORT.md).

## Deliver the complete handover

After a successful receiving run, **Prepare customer handover** retains a separate original handover request and produces one ZIP. The complete public files include:

- Original OpenAPI and complete generated `client/` export, including `client-export.json`.
- `receiving.json` with the selected product mapping, original native receiving results and package identities.
- The reviewed `customer-export.plan.json`, exact shared `customer-export.mjs` and application guide when the application was selected.
- A README with the installed SDK, existing buyer context and customer invocation.

The original connection file and environment values remain in the private workspace. The ZIP and each included file have retained byte counts and SHA256 identities. Download checks the complete archive against its saved identity. Reopening the workspace reads that same handover blob even if reproducible package directories are later retired.

The optional release selection stages the original prepared merchant release. Use **Open original release controls** to activate, run, stop, select or roll back a retained release.

## Operate the same contracts from the CLI

The existing command forwards to the original commissioning operator CLI:

```sh
starforge-merchant redis workspace commissioning template --directory /PRIVATE/redis-workspace
```

The direct source entry is `sf30-seller-sdk/redis/workspace/commission-operator-cli.mjs`. Close the currently running browser workspace process before acquiring its original writer from this CLI.

```sh
node commission-operator-cli.mjs template --directory /PRIVATE/redis-workspace > /PRIVATE/contract.json
node commission-operator-cli.mjs review --directory /PRIVATE/redis-workspace --input /PRIVATE/contract.json
node commission-operator-cli.mjs save --directory /PRIVATE/redis-workspace --input /PRIVATE/contract.json --request customer-contract-1 --review-digest REVIEW_DIGEST
node commission-operator-cli.mjs receive --directory /PRIVATE/redis-workspace --contract customer-contract-1 --request customer-receive-1
node commission-operator-cli.mjs history --directory /PRIVATE/redis-workspace --limit 20
node commission-operator-cli.mjs rows --directory /PRIVATE/redis-workspace --run customer-receive-1 --check EXAMPLE_ID --limit 50
node commission-operator-cli.mjs handover --directory /PRIVATE/redis-workspace --run customer-receive-1 --request customer-handover-1
node commission-operator-cli.mjs export --directory /PRIVATE/redis-workspace --id customer-handover-1 --output /PRIVATE/customer-handover.zip
```

Edit the template's expected results and customer terms before reviewing it. Substitute the returned review digest and original example ID. The template is a `stellar-forge.redis-commissioning-workbook.v1` wrapper containing `revisionId`, the original commissioning `input`, optional `customerPlan`, and `note`. The CLI also accepts the original `stellar-forge.redis-commissioning-input.v1` input against the current saved head.

`inspect --id` reads the complete original operation. `continue --id` resumes that exact interrupted request. The CLI waits for its admitted operation to finish; a failed operation exits 1, while a completed receiving mismatch exits 2. Export creates a new complete ZIP path and leaves an existing destination intact.

The earlier `commission.mjs` template/review/create/receive API and deterministic CLI request identities remain available for commissioning from complete original setup input.

## Embedded and HTTP integration

The original open workspace exposes:

| Method | Result |
| --- | --- |
| `commissioningTemplate({revisionId?})` | Full draft from one original saved revision. |
| `commissioningReview({revisionId,input,customerPlan?})` | Reviewed complete input digest and customer/source summary. |
| `commissioningSave({...reviewInput,requestId,digest,note?})` | Saved immutable contract operation. |
| `commissioningReceive({requestId,contractId})` | Retained queued receiving operation. |
| `commissioningContinue(requestId)` | Original interrupted receiving or handover continuation. |
| `commissioningHistory({after?,limit?})` | Cursor-paged contract, receiving and handover summaries. |
| `commissioningRows({runId,checkId,cursor?,limit?})` | Paged original native rows and source-completion state. |
| `commissioningHandover({requestId,runId})` | Retained queued complete archive operation. |
| `commissioningFile(requestId)` | Complete saved ZIP bytes and identity. |

Receiving and handover admission return before the original queue completes. Read `workspace.operation(id)` for progress and outcome; callers in the owning process can await `workspace.queue`. The common engine `receiveRedisCommissioning` accepts an already-open workspace, a saved revision and an optional original request namespace/child-operation executor.

The original authenticated server provides the same actions below `/api/commissioning/`. GET actions are `template`, `history`, `operation`, `rows` and `handover`; POST actions are `review`, `save`, `receive`, `continue` and `handover`. It retains the original local origin/token checks. Receive, continue and handover admission return HTTP 202.

## Source-native receiving

The existing six-product Redis native journey invokes `commission-journey.mjs` in its already-open authoring workspace when `SF30_REDIS_WORKSPACE_COMMISSIONING=1`. It uses the native fixture's specified expected values and original source, package, release and browser paths:

```sh
SF30_REDIS_JOURNEY_SETUP=1 \
SF30_REDIS_JOURNEY_COLLECTIONS=1 \
SF30_REDIS_JOURNEY_WORKSPACE=1 \
SF30_REDIS_WORKSPACE_BROWSER=1 \
SF30_REDIS_WORKSPACE_COMMISSIONING=1 \
node sf30-seller-sdk/redis/native-journey.mjs
```

Use the receiving host's existing declared Redis binary, native client, Playwright/Chromium and optional `SF30_REDIS_JOURNEY_APPLICATIONS_CONFIG`. This hook uses the same original workspace and browser. It exercises native source-limit retention, full six-product expectations, a later saved head while the contract stays pinned, original request replay, native set row paging, customer ZIP download, source package/stage, and original workspace reopen. The full result is under `workspace.commissioning` in the existing journey output.

The fixture is an explicitly generated native receiving workload. Production customer input is imported into this operator and received against the customer's selected source and expected-result matrix.
