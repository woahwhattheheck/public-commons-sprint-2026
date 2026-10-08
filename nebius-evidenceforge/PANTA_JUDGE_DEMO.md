# EvidenceForge × Panta — reproducible market-context browser

This demo turns the pre-existing `GET /markets/` adapter's read-only snapshot
into an inspectable product experience: a person can browse market titles,
YES/NO prices and phases, then select a specific market to produce an
independently digest-bound, machine-readable review context. The market never
grants a model extra permissions, approves repository changes, executes a
transaction, or signs a wallet operation.

## Offline demo, no accounts or requests

```bash
cd nebius-evidenceforge
PANTA_SNAPSHOT_FILE=demo/panta-snapshot.json python -m evidenceforge.webapp
# open http://127.0.0.1:8080/panta
# choose a market; inspect /api/panta?market=EXAMPLE-NOT-LIVE-1
```

**The included fixture is entirely synthetic, not Panta market data.** The
`EXAMPLE-NOT-LIVE` IDs and titles intentionally make this obvious. This is a
local UI/selection-format demo, not a qualifying live-integration receipt.

## Actual authorized Panta capture + same browser

An authorized Panta account/API-key operator can obtain a current market page
using the already-merged official adapter, retaining the actual capture log
and timestamp separately:

```bash
cd nebius-evidenceforge
export PANTA_API_KEY='...' # existing authorized key, never commit it
python -m evidenceforge.panta --category technology --phase primary --limit 20 \
  > /tmp/evidenceforge-panta-live.json
PANTA_SNAPSHOT_FILE=/tmp/evidenceforge-panta-live.json python -m evidenceforge.webapp
# open http://127.0.0.1:8080/panta
```

The browser offers `/panta` and `/api/panta` endpoints. Choose a market from
the catalog to obtain `evidenceforge-panta-selection/v1`: exact selected market,
source snapshot digest, and its own selection digest. Inputs are strictly
bounded (1 MB, 50 markets), hash-checked, and HTML-escaped; forged authority,
unknown markets, wrong API hosts, malformed prices and modified snapshots are
rejected. No trading/account writes or model inference occur.

**Important provenance distinction:** A SHA-256 match establishes that a
locally supplied file has not changed relative to its included digest; anyone
can generate a new matching digest. It does **not** authenticate a live Panta
response or demonstrate freshness. The browser explicitly labels API origin
and freshness as unverified. Judges need a separate actual API capture receipt
and working application demo before this can count as a live integration.

## Submission boundary

The Panta sidetrack advertises **5,000 USDG** in competitive prizes. It
requires a meaningful API integration, working demo, official Colosseum Crypto
World's Fair submission, and a second Superteam Earn submission. This source
change is not a submission, prize award, verified payout, or guarantee of
eligibility. Existing submission/account custodians should reuse this source
and register **once** through each correct channel after verifying current
terms and identity. See `PANTA_SIDETRACK.md`.

Official rules: https://superteam.fun/earn/listing/panta-api-side-track
