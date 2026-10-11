# Buyer expense and period workspace

A private operator workspace for taking original SF36 buyer statement rows through source review, expense allocation, named period review, accountant delivery and receiving.

The application uses the maintained `../statement.py` reader and statement calculator. The original buyer continues to own reservations, payment receipts and finalization. This workspace retains operator decisions in its own SQLite database.

## Open the workspace

Python 3.11 or later on a POSIX host is sufficient; the application uses only the standard library.

~~~sh
umask 077
python3 stellar/scf-starforge-20261009/sf36-spend-governor/expense-workspace/server.py \
  --state /absolute/private/buyer-expenses --port 0
~~~

Open the complete private URL printed by the server. It listens on 127.0.0.1 with a fresh capability for that process. Keep the process open while working; use Ctrl-C to finish accepted requests and release its writer lease.

Use a new private directory with mode 0700, separate from the buyer. An existing expense project opens in the same way. Opening a saved project reads its operator state without touching its source ledgers.

## Complete operating flow

1. **Source captures.** Register the exact existing SF36 `reservations.sqlite` path, source name and provenance. The unchanged original reader opens a read-only SQLite snapshot. Review additions, changed fields and rows absent from the new capture. Accept the capture to make it current, or reject it with an accountable reason. Both decisions and the original bytes remain retained.
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
| `amount` | Original reserved authorization maximum |
| `settled_base_units` | Actual recorded by the original native finalization |
| `reserved_base_units` | Outstanding authorization from an unresolved original row |
| `released_capacity_base_units` | Unused authorization capacity; it is not a refund |
| Native `day` | UTC reservation day from the original ledger |
| Recognition date | Explicit date assigned by the expense operator |
| Network / asset | Exact native grouping; totals never combine unlike assets |
| Receipt / proof / request digest | Original statement references retained without running a new verifier |

An unresolved reservation remains visible as exposure when carried or excluded from a period. A row absent from a later capture keeps its original retained row and source edition; the human report and machine export both identify that absence. Captures awaiting review cannot be substituted with a period disposition.

The same receipt reference in several registered rows requires an explicit decision. The application does not infer that the rows are duplicates, that a transfer is refundable, or that a native amount has a particular fiat value.

The operator may define display labels with `network`, `asset`, `symbol` and `decimals` from 0 to 30. The original label validator is reused. Native integer strings remain the authoritative exported amounts; labels perform no currency conversion. Issued editions keep their original labels even after current display settings change.

## Source continuity and revisions

Each capture retains the original snapshot, statement, journal count, last sequence and projection digest. Accepted rows are keyed by source and original request ID. Coding is bound to all original statement columns plus the row's presence state; a changed row requires current coding or a reviewed period disposition.

A source capture has an accepted parent. Another capture cannot replace a changed parent without being captured and reviewed again. Multiple pending captures remain visible until the operator accepts or rejects them.

To move the original buyer, use **Source captures → Open source → Rebind moved original ledger**. The proposed ledger must retain every accepted request ID and its original digest before its path is saved. The resulting capture still requires review. A distinct buyer belongs in a distinct source.

A lifetime POSIX lock keeps one expense writer on the private workspace. Mutations use SQLite transactions, a current workspace revision and retained activity sequence. The original source ledger receives no expense lock or application writes. Saved reviews include a complete source/coding/disposition context digest; issuance rejects a changed context. Closed-period coding can change only after reopening the affected original period.

## Accountant packet

Every issued packet includes:

- `issued.html`: semantic human report with exact totals, allocations, outstanding source status, exception decisions and reviewer conclusion.
- `period.json`: complete immutable issued edition.
- `allocations.csv`: original request/capture/receipt references, dates, exact amounts and operator classification.
- `outstanding-reservations.csv`: unresolved native maxima, original capture and presence status.
- `exception-decisions.json`: retained accountable decisions.
- `sources/*.json`: current captures and any earlier source edition referenced by retained period rows.
- `manifest.json`: each included file's size and SHA-256.

Import amount and identifier columns as text in spreadsheet software. The CSV is fully quoted and prefixes formula-like text values; the unchanged values remain available in JSON. Keep the packet within the intended private operator/accountant relationship.

## Complete receiving project

The **Download complete project** action takes a consistent SQLite backup and includes this application, the original statement/governor source, receiving instructions and a file manifest. Source ledger locators are retained, but the original buyer database, signer and wallet keys are outside this package.

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
| `native.py` | Original read-only statement API |
| `domain.py` | Exact allocations, source differences and period projection |
| `store.py` | Private source/decision editions and close/reopen lifecycle |
| `exports.py` | Frozen accountant HTML, CSV, JSON and source packet |
| `portable.py` | Included-source, consistent private receiving package |
| `server.py` | Loopback capability interface and graceful lifetime |
| `public/` | Operator source review, expense coding and period UI |

The original source contract is documented in [STATEMENTS.md](../STATEMENTS.md). The native buyer ledger remains authoritative for payment and finality.
