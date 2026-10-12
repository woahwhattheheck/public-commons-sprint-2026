# Buyer expense and period workspace

A private operator workspace for taking original SF36 buyer statements and native MCP purchase records through source review, expense allocation, named period review, accountant delivery and receiving.

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

## Customer requests and native receiving

The same Store now supports an optional `request_id` on the existing POST envelope. It fingerprints the exact fixed route, payload and expected workspace revision, and saves the successful response in the same SQLite transaction as the original operation. Recover through `GET /api/requests/ID`; `GET /api/requests?offset=0&limit=50` pages committed request identities. Exact retry returns the original response before another source capture or close. A changed payload under that ID is a conflict. Calls without the optional field retain their original behavior.

Known version-1 workspace opening adds only the trusted `api_requests` table. The complete-project snapshot now retains that table and advertises its successful-request count, exact workspace ID and revision. `GET /api/complete-project?expected_revision=N` binds the export to the operator's inspected revision.

The trusted `receive.py --archive ABS_ZIP --directory NEW_ABS_DIRECTORY --expected-sha256 SHA256` verifies the complete package and known native database schema, then retains the included source and database in a new private directory. An interrupted receive can continue only with the same archive SHA. It executes no archive code or SQL, imports no original ledger and replays no source capture or payment. Older complete projects without request history remain explicitly identifiable as legacy. New projects advertise `mcp_quote_capture: native-readonly-v1`; receiving requires the complete original reader files and verifies that manifest source kinds match the native database.

The maintained merchant MCP host now exposes the same full capture/allocation/review/close/export/receiving workflow. Its [buyer expense guide](../../../../stellar-forge/mcp-merchant-operator/BUYER_EXPENSES.md) documents host-declared ledger and quote-source aliases, exact tool schemas, SDK/CLI use and retained request/export recovery. No additional accounting or payment engine is involved.
