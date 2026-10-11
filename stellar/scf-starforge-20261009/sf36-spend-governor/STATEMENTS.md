# Buyer spend statements

Turn the **existing SF36 ledger** into an operator-usable statement without a
wallet, signing keys, a new database, a server or a dependency install. Python
3.10+ and the sibling `governor.py` are sufficient. The result is a self-contained
HTML workspace with search, filters, actor/service/day breakdowns and selected
CSV/JSON downloads. CLI JSON and CSV are also available.

## Open the statement for the existing buyer

SF81's `operator.ledger` is the database to read; `operator.policy` is the optional
policy to display. Use those **same configured paths**, not a second ledger. The
paths below match the SF81 documentation example; replace them with your existing
operator paths. Run from the repository root:

```sh
umask 077
python3 stellar/scf-starforge-20261009/sf36-spend-governor/statement.py \
  /private/operator/buyer.sqlite \
  --policy /private/operator/policy.json \
  --output /private/operator/buyer-statement-001.html
```

Open the created HTML file in a modern browser. It needs no server, internet,
external font, telemetry, browser extension or model call. A content security
policy permits only the embedded script/style hashes and prohibits network
requests. The statement is a **snapshot**: run the command again with a new output
name to refresh it after more operations or trusted finality reconciliation.
No watcher, scheduled task or automatic payment action is installed.

The filename must be new. Existing outputs, symlinks and the input database are
never overwritten. Missing databases are not created. New output files have
POSIX mode `0600`; Windows operators must use their existing private-directory
ACLs. Keep reports out of public GitHub/Pages, shared demo hosting and email until
the owner has reviewed their actor, service and receipt information.

## Explore, export and use in another operator interface

The top panel always shows the **whole-ledger** exposure and, when supplied,
remaining total/current-UTC-day policy capacity. Search, dropdowns and inclusive
date filters change only the selected view below it. This keeps older unresolved
reservations visible in the portfolio even when reviewing today's operations.
Network and contract identifiers remain visible alongside optional display labels.

```sh
python3 stellar/scf-starforge-20261009/sf36-spend-governor/statement.py \
  /private/operator/buyer.sqlite --actor operator-assigned-agent \
  --state reserved --output /private/operator/unresolved-001.json

python3 stellar/scf-starforge-20261009/sf36-spend-governor/statement.py \
  /private/operator/buyer.sqlite --from-day 2026-10-01 --through-day 2026-10-31 \
  --service operator-verified-api --output /private/operator/service-october-001.csv
```

Supported filters are `--actor`, `--service`, `--network`, `--asset`, `--state`,
`--from-day` and `--through-day`. Identity filters are exact matches. States are
`reserved` and `settled`; networks are the existing `stellar:testnet` and
`stellar:pubnet`. `--format html|json|csv` overrides extension inference.
The HTML controls can narrow the CLI selection but cannot recover excluded rows.
Reset restores that original selection. Browser JSON exports retain whole-ledger
portfolio information, the original CLI filters and the current `view_filters`;
a filtered report is **not** a redacted report.

For an existing Python operator process with this directory on its trusted import
path, consume the same functions rather than duplicating SQL or calculation:

```python
from statement import read_snapshot, build_statement, render_html, write_new

snapshot = read_snapshot(existing_ledger_path)
report = build_statement(snapshot, policy=existing_policy_dict)
write_new(new_private_output_path, render_html(report))
```

`report['portfolio']`, `selected_totals`, `by_actor`, `by_service` and
`by_reservation_day` are ready to display. Each aggregate always retains network
and asset. `render_csv(report['rows'])` exports the same selected rows. Pass
`filters={...}` with underscore names (`from_day`, `through_day`) to
`build_statement`. Neither this API nor the CLI calls `Governor.reserve`,
`reconcile`, a signer or a provider. The existing SF81 buyer, SF82 reconciliation
and merchant-console owners retain their original execution paths.

## What each number means

| Field | Meaning |
| --- | --- |
| `settled_base_units` | The native ledger's reconciled `actual` for settled rows; zero for unresolved rows. |
| `reserved_base_units` | The full native maximum still reserved; zero after native reconciliation. |
| `accounted_base_units` | Settled actual plus unresolved maximum for the same network/asset. |
| `released_capacity_base_units` | Settled maximum minus settled actual. Unused authorization capacity, **not a refund**. |
| `today_accounted_base_units` | Native accounted amount for reservations created on the snapshot's current UTC date. |
| `remaining_total_base_units` / `remaining_today_base_units` | Supplied native policy limits minus whole-ledger native usage, floored at zero. Over-limit amounts have separate fields. |
| `age_utc_days` | Calendar-day age of an unresolved reservation, or null for settled/future-dated rows. Never a release instruction. |

All money values are canonical decimal **strings** in base units. Python integer
arithmetic and browser `BigInt` preserve exactness, including sums beyond the
per-reservation signed-64-bit ceiling. Network/asset pairs are never added together;
testnet tokens are not real-money revenue. Remaining capacity is not new purchase
authorization: original per-request, actor/day, service/day, allowlist and consent
checks still apply, and another process can change usage immediately after capture.

SF36 stores a reservation day but **no settlement timestamp**. Dates and daily
breakdowns therefore refer to reservation creation, following the original
Governor's budget semantics, not settlement dates or accounting recognition.
The statement reads the ledger projection; it does **not** verify the journal
HMAC, detect whole-database rollback or independently validate Stellar finality.
Continue using the existing trusted reconciliation and audit paths for those jobs.
The projection fingerprint identifies a capture; it is not proof of a payment.

CSV preserves decimal bytes and prefixes formula-leading text cells with an
apostrophe. When using spreadsheet software, import **all base-unit columns as
text** to avoid the application's own rounding. JSON and the HTML interface retain
exact integers without that import step.

## Optional local display labels

`--labels private-labels.json` accepts exactly an `assets` array whose entries
contain `network`, `asset`, `symbol` and integer `decimals` (0–30). For example:

```json
{
  "assets": [{
    "network": "stellar:testnet",
    "asset": "REPLACE_WITH_THE_EXISTING_56_CHARACTER_CONTRACT_IDENTIFIER",
    "symbol": "YOUR_LABEL",
    "decimals": 7
  }]
}
```

Replace the placeholder with the exact contract identifier from your ledger.
Symbols/decimals are supplied by the operator, **not registry-verified metadata**.
Without a matching label the display explicitly uses base units; exports always
retain the base-unit strings and the full network/asset identity.

## Snapshot and runtime behavior

The reader opens an existing SQLite file with `mode=ro`, `query_only=ON` and one
explicit transaction for both rows and journal metadata. It includes the live WAL;
it deliberately does not use `immutable=1`, copy only the main database file, issue
a checkpoint or open a writer. SQLite can maintain its shared-memory sidecars,
so this is a no-data/schema-write promise, not a byte-unchanged filesystem claim.
The transaction stays open only while taking the snapshot, not while a user views
or filters the resulting page. This follows SQLite's documented WAL snapshot
behavior ([SQLite isolation](https://www.sqlite.org/isolation.html),
[WAL](https://www.sqlite.org/wal.html)).

Unknown states, inconsistent settlement fields, invalid amounts and incompatible
schemas produce an error instead of a misleading statement. CLI exit status is
0 on creation, 2 on failure. The reader holds one snapshot in memory; for unusually
large ledgers use the machine's available memory as the practical constraint.

## Focused native check

```sh
python3 stellar/scf-starforge-20261009/sf36-spend-governor/statement_check.py
```

Four small workflow groups execute the **original Governor** through actual
SQLite WAL: reserve/reconcile and budget parity; a concurrent committed write;
large-integer/export escaping; and the CLI's empty/invalid/output-preservation
paths. They use disposable fixture keys and fictional local operations, not a
wallet or a real customer. No historical repository suite or hosted Actions runs.

Executed in cloud Linux with Python 3.13.5 against unchanged Governor Git blob
`9d0a5e58accdf8078b85f42a49561eefb1cda7bc`. Actual Chromium additionally exercised
filtering, reset, reversed dates, selected downloads, exact large amounts,
escaping and responsive 1440px/390px layouts with no script errors or outgoing
requests. The managed browser rejected `file:` navigation; authored HTML bytes
were rendered with Playwright `set_content`, not claimed as an installed operator
browser test. No dependency install was needed.
