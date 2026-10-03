# ProofTreasury paper workflow

**Needs expert review.** ProofTreasury evaluates one supplied treasury case, records an explicit acknowledgement, and produces a local paper-execution receipt. Every result remains `PAPER_ONLY` with `live_execution_authorized: false`. It does not place orders, move funds, connect a wallet, authenticate an operator, or recommend an investment.

Original product and design credit: **Z-ObliqueLedger-0228**, `public-commons-sprint-2026` issue **#134**. License: **MIT**, under the repository license. No current contest deadline, eligibility, prize entitlement, or competition readiness is established.

## Local operator sequence

Run from the directory containing `proof_treasury/`, using Python 3.12 or newer with SQLite support on a POSIX system. The paper workflow uses the standard library and requires no provider key. Use trusted parent directories and new output names: creation refuses existing files and export directories. Do not concurrently replace a ledger or its parent directory.

These are fictional supplied times. Generate a case, inspect/edit its supplied facts and limits, then open a new ledger:

```sh
python -m proof_treasury template --out case.json --at 2026-10-03T12:00:00Z
python -m proof_treasury propose case.json --at 2026-10-03T12:01:00Z --ledger paper.sqlite
python -m proof_treasury inspect paper.sqlite
```

Read the proposal's reasons and exact metrics. For an eligible proposal, copy its top-level `proposal_sha256` into the shell variable `PROPOSAL_SHA`. Confirmation is a deliberate acknowledgement of that exact proposal:

```sh
python -m proof_treasury confirm paper.sqlite --proposal-sha256 "$PROPOSAL_SHA" --at 2026-10-03T12:02:00Z
```

Copy `last_result.confirmation_sha256` into `CONFIRMATION_SHA`, then record the paper transition:

```sh
python -m proof_treasury paper-execute paper.sqlite --confirmation-sha256 "$CONFIRMATION_SHA" --at 2026-10-03T12:03:00Z
```

For the unchanged template, the paper result has quantity `"12"`; cash `69975`, cost basis `"25025"`, and turnover `5000` are minor-unit amounts. These are fictional arithmetic outcomes.

Retain the resulting top-level `head_sha256` independently as `HEAD_SHA`. Reopen, replay, and export:

```sh
python -m proof_treasury verify paper.sqlite --expected-head-sha256 "$HEAD_SHA"
python -m proof_treasury export paper.sqlite --out paper-review
python -m proof_treasury verify-bundle paper-review --expected-head-sha256 "$HEAD_SHA"
```

Both verifier commands also work without the optional expected-head argument. One ledger represents one opening case/order. For another order, author a new case using the prior `paper_portfolio`, fresh source facts, and an owner-supplied generation identifier; create a new ledger.

Application results are JSON on stdout. Exit `0` means command success; `propose` returns `1` for `HOLD`, and a retained rejected confirmation/execution returns `1`. Input, storage, or replay errors return `2`. A successful verifier can validate a held or rejected history: integrity is separate from eligibility.

## Optional source capture

Read the official [market-snapshot format](https://sodex.com/documentation/for-developers/api-reference/market-data-api/currency/market-snapshot) and [authentication/limits](https://sodex.com/documentation/for-developers/developers/data-api/authentication-and-limits). With a configured `SOSO_API_KEY`, set `CURRENCY_ID` to an actual `/currencies` ID, not a symbol guess:

```sh
python -m proof_treasury fetch-snapshot --asset "$CURRENCY_ID" --quote-scale 2 --cache source-cache --json-out snapshot.json
```

This performs read-only API requests to the fixed official origin, refuses redirects, and checks requested IDs against the currency list. Repeat `--asset` for up to 19 distinct IDs. Missing key returns `NO_KEY`/exit `2` before filesystem or network access. USD scaling is exact, with scales `0`–`8`.

Alternatively, retain an existing unwrapped JSON snapshot fragment without a key or network request:

```sh
python -m proof_treasury import-snapshot-fragment --response supplied-fragment.json --quote-scale 2 --cache source-cache --json-out imported-snapshot.json
```

Imported fragments remain `SUPPLIED_OFFLINE` with asset `UNBOUND_FRAGMENT`. Both commands emit a snapshot plus health/evidence paths; neither supplies quote time. `quote_as_of` remains `null`, so substituting that snapshot into a case produces `HOLD` even after recent capture.

Raw responses, capture metadata, and a manifest remain under `source-cache/sosovalue/`. Cache reuse lasts 30 seconds and preserves acquisition time; stale data is not a fallback. Limits are 4 MiB per response and 32 MiB/512 cache files; evidence is not automatically evicted. The 20-request/minute guard is per process, not a shared-key or monthly quota guarantee. Retain these evidence files separately: ledger/bundle replay preserves the snapshot digest but does not reopen or authenticate the adapter cache.

## Case and arithmetic

The template is fictional, not a market quote or suggested allocation. Its exact top-level fields are `schema`, `snapshot`, `portfolio`, `policy`, and `order`. Snapshot and portfolio currency tokens and scales must agree. Quote prices are already in minor units.

Cash, fees, turnover, and integer policy amounts use nonnegative integer minor units, bounded by `2**53 - 1`. Quantities and prices are positive decimal strings, allowing up to 36 whole and 24 fractional digits. Signs, exponents, leading zeroes, and JSON floating-point numbers are rejected. Cost basis and accumulated realized loss also accept exact nonnegative fraction strings.

Arithmetic is exact rational arithmetic. A fractional-minor-unit trade notional causes `SUB_MINOR_TRADE_NOTIONAL`; no rounding occurs. Purchases consume notional plus fee and add both to cost basis. Sales allocate cost basis proportionally and deduct fees from proceeds. Realized losses accumulate; gains do not offset them. Turnover accumulates gross notional, excluding fees. These calculations are neither tax accounting nor loss forecasts.

The author supplies minimum cash, maximum order notional, cumulative turnover/loss, individual asset value caps, and concentration limits. Concentration uses basis points of total projected value including cash. Held and ordered assets require quotes and individual limits. Missing facts, insufficient cash/holdings, exceeded limits, or nonpositive projected value prevent eligibility. `PAPER_ELIGIBLE` means only that supplied conditions passed this model.

## Time and acknowledgement

All transition times are required UTC whole-second strings. Supplied clocks are not attested. Capture time and quote time are distinct facts; missing quote time produces `QUOTE_TIME_UNKNOWN` and `HOLD`. Recent capture does not establish quote freshness. Future or stale source facts also hold the proposal.

Expiry is the earliest of the confirmation lifetime, capture-age limit, and quote-age limit; equality is expired. Confirmation binds the proposal hash and inherits expiry. Execution requires a retained confirmation, eligibility, unexpired time, and consistent chronology. Each ledger allows one successful paper execution; repeated attempts are rejected. Acknowledgement does not authenticate an operator.

## Retained evidence and limits

SQLite retains original case text and a hash-linked history, including rejected transition attempts. Malformed input or storage failures are errors, not completed events. Writes serialize through a transaction and replay existing history before appending. Replay binds the exact `core.py` bytes; preserve that source version.

An export contains exactly `source.json` (original text), `proposal.json`, `journal.jsonl`, `review.md`, and `receipt.json`. Bundle verification rebuilds and compares every member, rejecting missing, extra, or changed files. Retain these privately when inputs are sensitive.

A self-consistent chain does not authenticate supplied facts or identity. Without an independently retained expected head, coherent history rewrites or removed suffixes cannot be detected solely from their own hashes.

Limits: 4 MiB JSON, nesting depth 32, no duplicate keys or unexpected fields; at most 100 quotes, positions, and asset limits; 10,000 events; 64 MiB SQLite ledger; 32 MiB exported journal. Quotes and limits require at least one entry. Interrupted exports may require inspection and a new output name before retrying.

The model has no settlement, slippage, tax-lot selection, unattended trading, or real-account reconciliation. Expert review and separately authorized engineering would be needed for a different scope. No provider execution or financial outcome is claimed here.
