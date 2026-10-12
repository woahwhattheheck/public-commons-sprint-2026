# Original Node operation accounting exports

Import an unchanged `stellar-forge.node-operation-accounting-export.v1` file into the existing buyer expense workspace. The retained producing attempt, checkout evidence and original SF36 accounting result become one source capture. Source acceptance, expense allocation, period review, accountant delivery and complete receiving use the same Store, native SQLite history and customer request recovery as other buyer sources.

## Original producer and authority

The source is the original Node buyer's `exportAccounting` output, implemented by `sf88-operator-buyer-cli/node/operation-accounting.mjs::exportOperationAccounting`. The original operation owner selects an already complete accounting command and exports that saved result. This intake does not start that command or its worker.

Keep the exporter-returned path, byte count, SHA-256, intent ID, command ID and actual operation provenance. Import the exact UTF-8 JSON file, including its original formatting. Its top-level authority is `ORIGINAL_SF36_RESULT_AND_RETAINED_ORIGINAL_ATTEMPT`. The producer includes exact attempt and evidence bytes; it leaves the source ledger, policy, signer and purchased body in their original workspace.

The fixed stdin reader reuses the producer's `accountingOutput`, original SF52 outcome analysis, SF86 original-evidence and payment-term checks, and the original SF36 approved-request canonical form. It binds the command/context, embedded byte counts and hashes, original producing attempt, request/body identity and saved accounting result. Those checks identify the retained source and internal relationships. They do not authenticate an arbitrary file's author: the operator supplies and reviews the real source provenance.

| Original outcome | Retained expense meaning |
| --- | --- |
| `NO_PAYMENT_REQUIRED` | Retain the unpaid response and source history. There is no payment asset, expense amount, receipt or reservation. |
| `FINALIZED` | Retain exact original settled actual, request digest, receipt and proof identity. A source decision is required before expense coding. |
| `IDEMPOTENT_FINALIZED` | Reuse the original audited finalization. A repeated accounting command does not create another expense. |
| Other complete native outcomes | Retain the outcome for source and period review. No settled amount is inferred and no reservation balance is manufactured from this export. |

Exact atomic amounts remain decimal strings. The original attempt UTC day, observed response time, accounting completion time and operator-assigned recognition date remain distinct. The source is not a complete ledger statement. A separately captured original SF36 ledger continues to own outstanding reservations, settled balances and released capacity.

## Browser workflow

1. Open the original expense application with Python 3.11+ on POSIX. Use the same existing workspace or a new private directory. Opening retained state does not start Node or read a source ledger.
2. Open **Sources → Import Node accounting export**. Select the unchanged original file, source name, accountable intake owner, actual operation context and source provenance. Operational and controlled development sources remain separate.
3. **Preview source and native outcome**. Inspect the original intent, command, SHA-256, bytes, authority, dates and exact settled amount when present. The preview also identifies an earlier capture of the same file and the current accepted parent.
4. Confirm the displayed intake action. A current accepted capture or a pending capture based on the current parent can be reopened. An explicitly previewed historical, rejected or stale-parent file creates a new pending capture while retaining its previous decisions and original bytes.
5. Open the retained source review. Accept or reject it with the actual reviewer and reason. Accepting makes that captured edition current; it does not finalize a payment.
6. For a present settled row, use **Expenses** to assign recognition date and exact allocations. Every line sum must equal the original settled actual. An unpaid row remains a source outcome with no coding form. An unfinalized outcome remains available for a named period disposition.
7. In **Period review**, complete pending source decisions and inspect duplicate-source findings. Save the actual reviewer and conclusion, then issue the ready period. A source or coding change requires a fresh review. Reopening records a reason and preserves every earlier issued edition.
8. Download the exact original file from its capture, a frozen accountant packet, or the complete included-source project. The accountant packet retains original Node files under `node-operations/<capture-id>/original-accounting-export.json`; the frozen capture also contains its complete source snapshot.

Use the host's existing Node 22.13+ or Node 24 runtime for a new preview or capture:

~~~sh
umask 077
python3 stellar/scf-starforge-20261009/sf36-spend-governor/expense-workspace/server.py \
  --state /absolute/private/buyer-expenses --port 0 \
  --node /absolute/path/to/node
~~~

The source reader invokes only the fixed included `operation-accounting-export.mjs` with the original file on stdin. It accepts no arbitrary command or file path arguments. The ten included reader files cover its complete active imports, including the original SF86 network definitions. The producer worker, RPC requests, wallet imports and decoder factory are not called.

## Intake identity and interrupted replies

The original source identity is the producing operation and attempt: intent, original operation/configuration hashes, original body/ticket identity and attempt creation time. A later accounting command for that same source creates a successor source edition rather than a new financial source. All imported original-file versions retain their own SHA-256 and immutable bytes.

Before committing, the browser saves a stable request ID, expected workspace revision, preview digest and exact intake metadata. If acknowledgement is lost, **Recover saved request** reads the original Store request. **Retry exact original request** first checks that recovery and requires the same original file to be reselected. The filename and SHA-256 must match. The complete original request, including file bytes, is retained in the successful native transaction.

A definite revision or preview conflict requires a new review. The browser can release its uncommitted draft only after the server reports no committed result. A saved request can also be recovered by its original ID after local browser storage is lost. The capture's accepted result remains visible even if a later workspace refresh fails.

The native API adds these fixed routes:

| Route | Request / response |
| --- | --- |
| `POST /api/node-operations/preview` | Body `{payload}`; returns original source/outcome, previous capture, intake behavior and `preview_sha256`. |
| `POST /api/node-operations` | Body `{request_id, expected_revision, payload}`; payload adds the exact `preview_sha256`. Returns the original source and pending or reused capture. |
| `GET /api/requests/<request-id>` | Existing transactional request recovery; same method/path/payload/revision must be retained for a retry. |
| `GET /api/captures/<capture-id>/node-original` | Exact retained original JSON bytes. |
| Existing capture decision, item, period, issued and export routes | The same original financial Store workflow. |

The payload fields are `content_base64`, `source_sha256`, original basename `filename`, `name`, `operator`, `provenance` and `data_context` (`operational` or `development`). Maximum original file size is 16 MiB; the two intake routes allow a complete 24,000,000-byte JSON envelope. Unknown original outcomes are not promoted into settled expense.

## Duplicate purchases and closed periods

The full original SF36 request/proof identity joins the same finalized purchase across direct ledger, governed MCP and Node representations. An exact duplicate group requires one included original charge. Complete native matched events retain their existing event identity as well.

Transaction references normalize only a bare or network-prefixed 64-hex transaction hash. Opaque references, network and asset stay unchanged. If a Node source and a currently closed source share a transaction but lack two distinct bound events, the new representation must be excluded or the prior period reopened for joint source review. This applies in either arrival order. Different bookkeeping representation does not establish another purchase. Original unsent reservations remain separate ledger rows.

A new source version that changes financial meaning makes its current coding stale. An otherwise identical original idempotent finalization retains the stable financial basis even if the accounting command or export hash changes. Previously issued allocations and their exact captured bytes remain frozen.

## Configured MCP and customer operations

The existing `stellar-forge.buyer-expense-connection.v1` workspace can declare `nodeSources`. Each alias contains:

| Field | Meaning |
| --- | --- |
| `sourceFile` | Original private JSON file, resolved by the host configuration. |
| `sourceSha256` | Exact hash returned by the original exporter. |
| `name`, `provenance` | Actual retained source name and operation context. |
| `dataContext` | Explicit `operational` or `development`. |

The client supplies an alias and actual operator, never an arbitrary filesystem path or executable. The host rechecks the declared private file and hash before each preview/capture. Updating a source alias to another original file requires a new native preview.

Two additive tools share the existing buyer-expense catalog:

- `merchant_buyer_expense_node_preview`: `workspace`, `nodeSource`, `operator`.
- `merchant_buyer_expense_node_capture`: the same fields plus `requestId`, `expectedRevision` and `previewSha256`.

The existing SDK exposes `nodePreview` and `nodeCapture`, or `client.call('node_preview', args)` and `client.call('node_capture', args)`. Explicitly open the declared workspace first. Save the exact mutation arguments privately before calling it. Continue with existing `captureReview`, `items`, `codingSave`, period tools and original request recovery.

~~~sh
starforge merchant-mcp expenses tools
starforge merchant-mcp expenses call --url http://127.0.0.1:3211/mcp \
  --action node_preview --arguments /private/original-node-preview.json \
  --output /private/original-node-preview-result.json
starforge merchant-mcp expenses call --url http://127.0.0.1:3211/mcp \
  --action node_capture --arguments /private/exact-node-capture-request.json \
  --output /private/original-node-capture-result.json
starforge merchant-mcp expenses call --url http://127.0.0.1:3211/mcp \
  --action request --arguments /private/original-node-request-recovery.json
~~~

Use the operator's environment bearer through the existing `--token-env` option; do not put it in argument files. The original request ledger, prefix-checked download and per-workspace child lifetime remain unchanged. All prior ledger, governed-MCP, Woo, generic adjustment and accountant actions remain available.

Export kind `node-operation` selects `recordId` equal to the retained capture ID. Its sole payload is `original-node-accounting-export.json`. Export kind `project` freezes the current workspace revision, every source/capture/decision and the included application. Stable export IDs reopen completed downloads after host restart.

## Complete receiving and compatibility

The original complete-project format remains `stellar-forge.buyer-expense-private-project.v1`. Current projects advertise `node_operation_capture: original-node-accounting-export-v1`, exact Node source/capture counts, original source kinds and the included Python/JavaScript reader files. No new financial table or second journal is added.

The trusted installed receiver verifies the whole archive SHA-256, exact known member set, byte counts/hashes, native SQLite schema and revision, original request history and Node source/capture counts. It checks exact retained Node bytes against their original source/result projection, current accepted items and frozen issued captures without launching Node, running archive code or replaying a capture. Historical projects without the additive Node feature remain supported with their original member selection.

After receiving, opening the included Python app reads retained state only. New imports use its included native reader. The original source ledger, policy, signer, purchased body and former source path need not be available to inspect the retained file, period or reviewer decisions.

## Operating status and original source custody

This implementation composes the original producer released in PR2082. The original A39C OpenCage operation reported an HTTP 200 unpaid response; its exact completed accounting-export locator is still with the original producer. The separately owned paid profile is not an intake prerequisite and is not represented here as completed. This guide describes the implemented workflow; it does not claim that an unavailable original export has been imported or that a new purchase was performed.
