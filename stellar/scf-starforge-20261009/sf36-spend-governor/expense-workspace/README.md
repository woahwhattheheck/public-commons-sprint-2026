# Buyer expense and period workspace

A private operator workspace for taking original SF36 buyer statements, native MCP purchase records and complete original Node accounting exports through source review, expense allocation, named period review, accountant delivery and receiving.

The application uses the maintained `../statement.py` reader and statement calculator for SF36 ledgers. Original MCP quote stores enter through their own unchanged validation and a read-only `SqliteQuoteStore.readSnapshot` transaction. The original buyers continue to own reservations, payment receipts and reconciliation. This workspace retains reviewed captures and operator decisions in its existing SQLite database.

## Open the workspace

Python 3.11 or later on a POSIX host opens the saved workspace using only the standard library. A new native MCP source capture also uses the host's Node 22.13+ or Node 24 runtime; the included read-only source requires no package installation.

~~~sh
umask 077
python3 stellar/scf-starforge-20261009/sf36-spend-governor/expense-workspace/server.py \
  --state /absolute/private/buyer-expenses --port 0
~~~

Open the complete private URL printed by the server. It listens on 127.0.0.1 with a fresh capability for that process. Keep the process open while working; use Ctrl-C to finish accepted requests and release its writer lease.

With the maintained Starforge package, the original command is `starforge buyer-expenses --state /absolute/private/buyer-expenses --port 0`. Its fixed Node forwarder runs this same Python server and preserves arguments, signals and exit status.

Use a new private directory with mode 0700, separate from the buyer. An existing expense project opens in the same way. Opening a saved project reads its operator state without touching its source ledgers or quote databases. Use `--node /absolute/path/to/node` when a later MCP capture needs an explicitly selected host runtime.

## Original Node accounting export intake

Sources → Import Node accounting export retains the exact original producer file, producing attempt/evidence and saved SF36 accounting result. Preview identifies the source and previous capture; a named review makes its pending capture current. Unpaid outcomes remain source history without payment assets or reservations. Finalized original rows use the same exact allocation, duplicate-source review, issued periods and complete receiving. The complete browser/API/MCP/customer workflow and source meanings are in [NODE_OPERATIONS.md](NODE_OPERATIONS.md).

## Complete operating flow

1. **Source captures.** Register the exact existing SF36 `reservations.sqlite` path or original native MCP quote directory, with its source name and provenance. Select the source type explicitly. Each maintained reader opens its own read-only SQLite snapshot. Review additions, changed fields and rows absent from the new capture. Accept the capture to make it current, or reject it with an accountable reason. Both decisions and the original bytes remain retained.
2. **Cost centers.** Define the codes and names used by the operator. Codes stay text, including leading zeroes. Inactivating a center prevents new allocations while preserving its earlier editions.
3. **Expenses.** Open a present native settled row. Assign its recognition date, owner and memo; split its original settled actual across one to 100 cost-center/project/account lines. Every amount is an exact nonnegative base-unit integer string, and the sum must equal the original actual.
4. **Period review.** Select an explicit recognition-date window. The view retains exact grouped allocations, source changes, outstanding reservations and duplicate receipt-reference review. Complete current source reviews and record the displayed exception dispositions. The native ledger is unchanged by those decisions.
5. **Named review and issuance.** Save the current source, coding and exception context under the reviewer's actual name and capacity. A ready, current review can close the period. Its issued edition freezes the original source captures, allocations, labels, outstanding rows and conclusion.
6. **Reopen and revise.** Record the reopening owner and reason before changing issued-period coding. Save a successor review and edition. Earlier editions remain available with their own source and decisions.
7. **Accountant and complete-project handoff.** Download the frozen accountant ZIP or complete private project. The latter contains runnable source and consistent saved state, so the receiver needs no separate checkout.

Forms remain intact when a stale workspace revision rejects a save. Explicit navigation asks before discarding unsaved changes, and browser unload warns about them. Source, expense, period history and activity views provide page navigation.

## Native meanings and operator decisions

| Value | Meaning retained |
| --- | --- |
| SF36 `amount` | Original reserved authorization maximum |
| `settled_base_units` | Actual recorded by the original native finalization |
| `reserved_base_units` | Outstanding authorization from an unresolved original row |
| `released_capacity_base_units` | Unused authorization capacity; it is not a refund |
| SF36 native `day` | UTC reservation day from the original ledger |
| MCP native `day` | Original quote creation day, distinct from payment and recognition dates |
| MCP quoted amount | Accepted native quote amount; no reservation or expense is inferred |
| MCP matched actual | Original amount bound by the saved native SF86 `TRANSFER_MATCHED` observation |
| Recognition date | Explicit date assigned by the expense operator |
| Network / asset | Exact native grouping; totals never combine unlike assets |
| Receipt / proof / request digest | Original statement references retained without running a new verifier |

An unresolved reservation remains visible as exposure when carried or excluded from a period. A row absent from a later capture keeps its original retained row and source edition; the human report and machine export both identify that absence. Captures awaiting review cannot be substituted with a period disposition.

The same receipt reference in several registered rows requires an explicit decision. A receipt reference alone does not establish duplicate payment. Where the original observations identify the same exact transfer event, only one included charge can close, including across currently closed periods; the reviewer identifies the original charge and excludes its duplicate source representation. The application infers no refund or fiat value.

The operator may define display labels with `network`, `asset`, `symbol` and `decimals` from 0 to 30. The original label validator is reused. Native integer strings remain the authoritative exported amounts; labels perform no currency conversion. Issued editions keep their original labels even after current display settings change.

## Native MCP purchase sources

The source is the original private `SqliteQuoteStore` directory containing `quotes.sqlite`. This workspace calls its fixed read-only reader; it does not load a broker, signer or wallet, contact the merchant or RPC, or write to that source. The snapshot includes the original quote and transition count from one read transaction, with a bounded source size. Recorded result metadata stays with the quote; purchased result bodies remain in the original buyer.

The original quote, buyer outcome, and payment observation remain separate:

| Retained native state | Expense behavior |
| --- | --- |
| No recorded signed dispatch | Visible quote; no expense or reservation |
| Seller-confirmed or dispatched quote without a matched observation | Unresolved payment; carry or exclude it with a named period decision |
| Original native `FAILED` observation | Failed payment remains visible and separate from another successful attempt |
| Original native `NOT_FOUND` observation | Unresolved; it does not authorize a retry |
| Saved `TRANSFER_MATCHED` with exact quote, payer, recipient, asset, amount and transaction binding | Eligible for exact allocation after source acceptance |
| Saved observation with invalid or changed binding | Source needs original buyer reconciliation; a period disposition cannot turn it into expense |

The reader consumes the saved original SF86 report, including its native network catalog, transaction and event evidence hashes. It does not repeat verification or promote a seller response to settlement. Use the existing original MCP buyer's `bazaar_reconcile_payment` workflow when a saved observation is needed, then capture and review the changed source here. The original recovery guide is [PAYMENT_RECOVERY.md](../../../../stellar-forge/mcp-paid-agent/PAYMENT_RECOVERY.md).

Sources → **Register original MCP buyer source** accepts the operator-declared quote directory. Its review shows semantic payment changes alongside original quote IDs and hashes. Expense detail shows buyer status, dispatch, payer/recipient, quote amount, transaction, observation and recorded output metadata. Period review and frozen accountant editions include **Original MCP payment outcomes**, including unallocated and failed quotes. Raw observation and response metadata remain in the retained JSON.

MCP quote creation dates are source dates. The operator chooses expense recognition dates after inspecting the original payment and useful delivered output. Unresolved MCP quotes never contribute to SF36 outstanding-reservation totals. Labels and total groups retain the original network and asset; they perform no conversion.

## Source continuity and revisions

Each capture retains the original snapshot, statement, journal count, last sequence and projection digest. Accepted rows are keyed by source and original request ID. Coding is bound to all original statement columns plus the row's presence state. MCP rows also bind the retained semantic quote/payment/result context. A changed row requires current coding or a permitted reviewed period disposition.

A source capture has an accepted parent. Another capture cannot replace a changed parent without being captured and reviewed again. Multiple pending captures remain visible until the operator accepts or rejects them.

To move the original buyer, open its source and choose **Rebind moved original ledger** or **Rebind moved original MCP source**. The proposed source must retain every accepted native request/quote ID and its immutable original digest before its path is saved. The resulting capture still requires review. A distinct buyer belongs in a distinct source.

A lifetime POSIX lock keeps one expense writer on the private workspace. Mutations use SQLite transactions, a current workspace revision and retained activity sequence. The original source ledger receives no expense lock or application writes. Saved reviews include a complete source/coding/disposition context digest; issuance rejects a changed context. Closed-period coding can change only after reopening the affected original period.

## Accountant packet

Every issued packet includes:

- `issued.html`: semantic human report with exact totals, allocations, outstanding source status, exception decisions and reviewer conclusion.
- `period.json`: complete immutable issued edition.
- `allocations.csv`: original request/capture/receipt references, dates, exact amounts and operator classification.
- `outstanding-reservations.csv`: unresolved SF36 native maxima, original capture and presence status.
- `native-mcp-payment-outcomes.csv`: original quote date, buyer/payment states, quoted amount, nullable matched amount and recorded receipt/output metadata. This contains no inferred reservations.
- `exception-decisions.json`: retained accountable decisions.
- `sources/*.json`: current captures and any earlier source edition referenced by retained period rows.
- `manifest.json`: each included file's size and SHA-256.

Import amount and identifier columns as text in spreadsheet software. The CSV is fully quoted and prefixes formula-like text values; the unchanged values remain available in JSON. Keep the packet within the intended private operator/accountant relationship.

## Complete receiving project

The **Download complete project** action takes a consistent SQLite backup and includes this application, the original statement/governor source, the original MCP quote-reader dependency closure, receiving instructions and a file manifest. Source kinds and locators are retained. Original buyer databases, signing material and purchased output bodies stay outside the package.

~~~sh
umask 077
python3 -m zipfile -e buyer-expense-complete-project.zip received-expenses
cd received-expenses
python3 prepare_private.py
python3 app/sf36-spend-governor/expense-workspace/server.py --state project --port 0
~~~

The receiving helper checks the retained file hashes and applies private file/directory modes. The saved captures, coding editions, period reviews and issued reports open without the original source path. Rebind the same buyer only when a new original capture is needed.

The server binds only loopback. Static assets have a restrictive content policy; API requests require the private capability and same-origin mutation headers. Fixed routes provide the application operations. Persistent HTTP connections close after a response, and shutdown drains active requests before releasing the database and writer lock.

## Existing integrations

The whole source lives inside SF36, so the maintained distribution's existing SF36 component retains its files. The original `statement.py`, `governor.py`, SF88 buyer, source finalizer and seller accounting modules are unchanged.

| Module | Responsibility |
| --- | --- |
| `native.py` | Dispatch to the original source reader |
| `native_mcp.py` | Fixed native quote-reader invocation and expense projection |
| `domain.py` | Exact allocations, source differences and period projection |
| `store.py` | Private source/decision editions and close/reopen lifecycle |
| `exports.py` | Frozen accountant HTML, CSV, JSON and source packet |
| `portable.py` | Included-source, consistent private receiving package |
| `server.py` | Loopback capability interface and graceful lifetime |
| `cli.mjs` | Installed command forwarding to the same Python entrypoint |
| `public/` | Operator source review, expense coding and period UI |

The original source contract is documented in [STATEMENTS.md](../STATEMENTS.md). The original SF36 ledger and original MCP quote/payment observation each retain their own authoritative scope.

## Completed native operator journey

The original retained Stellar testnet buyer statement was exercised through this whole workspace on 2026-10-11. Its two original intents retained a finalized 10,000-base-unit actual and a separate unsent 10,000-base-unit reservation. The operator accepted the capture, allocated the actual 6,000 / 4,000, carried the unresolved reservation, reviewed and issued the period, reopened it, accepted an unchanged original-ledger capture, and issued a 7,000 / 3,000 successor. Both issued editions and both source captures remained available after restart.

The included-source receiving project reopened the same workspace at revision 15 with the original exact amounts and native projection unchanged. Receiving created no source capture or payment. The desktop and mobile operator views completed with no browser page errors. An initial exact-control lookup exposed a combined label/help accessible name; the shared field renderer now separates the accessible name from its description, and the same retained case continued successfully. This is an internal operator workflow over an existing testnet purchase; it does not count as an independent external adoption.

### Original MCP purchase continuation

On 2026-10-12, the same case continued from revision 22 to 29 with the existing MySQL HPD buyer's four original quotes. The original buyer's signer-free reconciliation saved a native `TRANSFER_MATCHED` observation for its existing 50,000-base-unit purchase. Source acceptance retained that matched quote, a separate indeterminate signed quote and two unsigned signing rejections. The original result remained recorded as 53,468 bytes with its SHA-256; its body stayed in the original buyer workspace.

The new allocation split that original purchase 35,000 / 15,000. The issued period kept the earlier D173 8,000 / 2,000 allocation, producing 60,000 settled atomic units while retaining the separate 10,000-unit unsent reservation and the named unresolved MCP quote. Restart and trusted receiving reopened the same case, both source types, all four native quote outcomes, 14 native tables and 14 committed customer requests. The included-source desktop and mobile views rendered the retained source and issued report; receiving added no capture or payment. Earlier issued editions remained unchanged.

## Customer requests and native receiving

The same Store now supports an optional `request_id` on the existing POST envelope. It fingerprints the exact fixed route, payload and expected workspace revision, and saves the successful response in the same SQLite transaction as the original operation. Recover through `GET /api/requests/ID`; `GET /api/requests?offset=0&limit=50` pages committed request identities. Exact retry returns the original response before another source capture or close. A changed payload under that ID is a conflict. Calls without the optional field retain their original behavior.

Known version-1 workspace opening adds only the trusted `api_requests` table. The complete-project snapshot now retains that table and advertises its successful-request count, exact workspace ID and revision. `GET /api/complete-project?expected_revision=N` binds the export to the operator's inspected revision.

The trusted `receive.py --archive ABS_ZIP --directory NEW_ABS_DIRECTORY --expected-sha256 SHA256` verifies the complete package and known native database schema, then retains the included source and database in a new private directory. An interrupted receive can continue only with the same archive SHA. It executes no archive code or SQL, imports no original ledger and replays no source capture or payment. Older complete projects without request history remain explicitly identifiable as legacy. New projects advertise `mcp_quote_capture: native-readonly-v1`; receiving requires the complete original reader files and verifies that manifest source kinds match the native database.

The maintained merchant MCP host now exposes the same full capture/allocation/review/close/export/receiving workflow. Its [buyer expense guide](../../../../stellar-forge/mcp-merchant-operator/BUYER_EXPENSES.md) documents host-declared ledger and quote-source aliases, exact tool schemas, SDK/CLI use and retained request/export recovery. No additional accounting or payment engine is involved.

## Original customer refunds and buyer returns

Credits & returns completes original customer refund receiving in this same expense workspace. The maintained SF104 `receiveRefund`, `inspectRefund` and `bindRefundAdjustment` validate the original packet, released purchase identity, store-currency mapping and retained reverse-transfer observation. The buyer source copies only the selected original local packet into its own private intake. It makes no network request, merchant mutation or payment.

Receive the exact original handoff directory, manifest SHA-256 and store URL. Retain its operation provenance and select `operational` or `development`; one workspace keeps one context. Development WordPress/facilitator operations remain development records even when their saved native proof uses a testnet network name. They belong in a separate project from actual buyer payments.

Review the retained purchase and return. Bind to the exact existing native payment, or explicitly register the original reviewed merchant purchase carried by the packet. The purchase identity, amount, asset and payer/recipient must match; subsequent packets for that original order keep the same expense target. Native returned units and Woo store-currency credit remain independent original values. An APPLIED store credit is not used as a substitute for the original reverse-transfer proof.

Allocate the purchase, then allocate each return against its remaining original cost-center, project and account dimensions. The sum must equal the original native returned amount. Cumulative returns cannot exceed the purchase or its original dimensions, and one original reverse-transfer event cannot be allocated twice. Assign the recognition date explicitly; original approval and transfer timestamps keep their own source meaning. Saved allocation editions retain their predecessors.

Period review shows gross purchases, native returns and net expense by original network/asset. Pending packets need an acceptance/rejection decision; uncoded or changed returns need coding or an explicit period disposition. Reopen a closed period before changing its return coding. Each corrected close retains the earlier close, original source packets, coding and named review. A later-period return can produce a negative net amount without changing the original period.

The accountant ZIP includes original purchase captures, each used refund manifest/member byte, return allocations, original store-credit outcomes and exact net native totals. Complete project receiving includes the same SQLite decisions, request history, original packet bytes and the original reader source closure. Its trusted receiver verifies all four new native tables and feature metadata; earlier projects without buyer-credit tables remain supported. No original ledger, quote database or signer is needed to open retained state.

### Native HTTP controls

- `POST /api/refund-packets`: capture `{name, provenance, data_context, directory, manifest_sha256, site_url}`.
- `GET /api/refund-packets` and `GET /api/refund-packets/ID`: paged intake history and exact source review.
- `POST /api/refund-packets/ID/decision`: `{decision, operator, reason, purchase_item_id?, register_original_purchase?}`.
- `GET /api/refund-packets/ID/original`: the unchanged original customer packet plus its separate buyer intake description.
- `GET /api/credits`, `GET /api/credits/ID`: paged returns, current purchase binding, related returns and coding history.
- `POST /api/credits/ID/coding`: the existing exact allocation shape with the current return `basis`.

Each mutation uses the existing `{expected_revision, payload, request_id?}` envelope and original transactional request recovery. A received successor packet is imported through Credits; immutable packet sources are not rebound as ledger files. The existing customer MCP and SDK expose these same controls through host-declared refund aliases.

### Original operation exercised

The original Woo order-18 customer packets completed this workflow on 2026-10-12 in a separate development workspace. The USD 2.50 purchase and USD 1.00 / USD 1.50 APPLIED store credits remained distinct from the 2500000 native purchase units and 1000000 / 1500000 returned units. Three immutable issued editions retained net native amounts of 2500000, 1500000 and 0, with the same original purchase and both source packets.

The maintained MCP/customer SDK recovered the same capture and final-close request, reopened the host, exported the accountant and original source packets, and received the complete included-source project at revision 19. A brief desktop/mobile pass read the same received case without a mutation. The first final-close response occurred during shared storage exhaustion; the same retained request completed after capacity returned. This was the original controlled development operation, with no new payment, merchant mutation or independent-adopter count.

The fixed refund-reader file list also includes the maintained Woo basket contract imported by the current original buyer module. It keeps the original SF104/SF88 implementation available in complete receiving; no alternate refund or payment engine is bundled.

## Original merchant adjustments and paid-job returns

Use **Credits and returns → Receive original merchant adjustment export** for the unchanged JSON from the existing `AdjustmentWorkspace.export({runId, format:'json'})` or `GET /api/adjustments/export?runId=UUID&format=json`. Select the original file, exact SHA-256, and one original `events[].original.eventId`. This is a private source intake; the original accounting engine, merchant job and payment operation remain unchanged.

An optional paid-job selection contains the original `job_id` and a `settlement` binding copied from the selected original accounting row: event ID, receipt fingerprint, transaction fingerprint, network, asset and recipient digests, exact atomic amount, route, method and order-reference digest. It is a selection of those ten source fields, not a replacement for the complete native job record. The order-reference digest must be SHA-256 of the original job ID. The reader checks every field; the unchanged export and proofs provide the source authority. The original paid-job merchant exposes this same JSON through `jobs-resolution accountingexport` and its authenticated `/api/jobs/:jobId/resolution/accountingexport` route.

The fixed read-only reader reuses the original accounting compiler and original adjustment/payment/refund validators. The source retains its complete original JSON. Its separate `buyer-selection.json` is explicitly a buyer intake description, never a claimed original merchant manifest.

| Original source state | Buyer behavior |
| --- | --- |
| No independent original payment proof | Accept the export as reference-only context; no expense or credit is created. A later complete source can retain the same origin and supply its actual payment. |
| Independently proved original payment | Select the exact existing buyer payment, or explicitly register the original reviewed purchase. Amounts and parties must match. |
| Requested, verifying or withdrawn refund | Retain the original decision and amount in the period source view; do not count returned units. |
| Recorded cancellation | Retain the merchant's cancellation separately; it is not a reverse transfer. |
| Verified native return | Bind it to the original payment and allocate its exact returned units against the original purchase dimensions. |
| Same native return already allocated through another retained source | Bind the same purchase and retain both source records. Review the existing return allocation, then explicitly exclude the additional representation from the affected period. A corrected edition retains that decision and all earlier editions; the original native return remains recognized once. |
| Return absent from a successor export | Keep the previous original verified return and show its absence from the latest accepted receipt. Earlier issued editions keep their own source. |

Each original export may carry several adjustments. The source review accepts or rejects the selected original event and its decisions together. All eligible returns remain individually addressable and traceable to their original adjustment, native reverse transfer and packet history. An already retained adjustment cannot change its immutable payment, returned amount or buyer binding.

The original API `POST /api/adjustment-packets` accepts `{expected_revision, payload:{name, provenance, data_context, source_file, source_sha256, event_id, expected_job?}}`. Its optional durable `request_id` envelope behaves like every existing mutation. Review, credit coding, period review/close/reopen and export reuse the same original routes. Accountant editions add `original-merchant-adjustments.csv` and preserve the exact source export plus buyer selection. Store-currency fields remain absent when the original source does not supply them.

Complete project version `original-native-refund-v2` includes the new native source adapter, unchanged accounting compiler/reconciler and the full existing Woo reader closure. The trusted receiver also accepts previously issued `original-woo-refund-v1` projects with their original source member set. Receiving opens the retained state without reimporting any original source or starting a payment.

## Governed native MCP purchases

The original source workflow can join an MCP quote directory to the actual native spending owner through a private `stellar-forge.governed-mcp-expense-input.v1` descriptor. It retains original request bindings, the complete shared SF36 ledger snapshot, actual reserved capacity, settled expense and saved native result metadata. The existing browser, source review, allocation, period, accountant export and complete-project receiver handle this source end to end.

Follow [GOVERNED_MCP.md](GOVERNED_MCP.md) to select the actual owner, register and review it, reconcile through the original buyer, count a shared reservation once across source views, issue expense and reopen or reattach a portable project.
