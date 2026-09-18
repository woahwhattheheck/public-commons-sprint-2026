# MarketLedger for OpenMarkets

**Competition carrier:** OpenMarkets Hackathon, Sep 15–23 2026  
**Operation:** `OPENMARKETS-HACKATHON-MARKETLEDGER-20260918`

MarketLedger is a small B2B/AI evidence plane for OpenMarkets' normalized cross-venue liquidity. It reads the documented **read-only** Flow liquidity endpoint, converts each position into a deterministic reconciliation receipt, highlights fee-adjusted dispersion and price moves, and can create a **data-only staged action** only after an operator-supplied confirmation token is supplied.

It intentionally contains **no order-placement or execution function**.

## Why it fits the hackathon

OpenMarkets' hackathon explicitly calls for B2B reconciliation reporting, AI/automation, and cross-platform analytics. MarketLedger combines all three:

1. **Usefulness:** an operator can see which venue is cheapest after a supplied analytical fee adjustment, whether enough quoted USD liquidity exists, and how far venues diverge.
2. **Network leverage:** the product only becomes interesting because OpenMarkets normalizes many partners into one `position_hash` and one liquidity response.
3. **Evidence:** every report is canonicalized and SHA-256 receipted for replay/audit.
4. **Safety:** the core is pure computation. Live access is GET-only and host-locked to `api.openmarkets.ai`. Staged actions are confirmation-token-gated records, not provider mutations.
5. **Business path:** a partner book, trading desk, creator tool, or internal risk function can use the same evidence plane for routing review, fee impact, and reconciliation.

## OpenMarkets contract used

The adapter targets the documented endpoint:

```text
GET https://api.openmarkets.ai/flow/v1/contests/{contest_id}/liquidity
X-API-Key: ...
```

The documented position fields used are `position_hash`, `contest_id`, `title`, `market_key`, `side_key`, `participant_id`, `consensus_price`, and `partner_liquidities[]` with `partner_id`, `partner_name`, `price`, `available`, and `liquidity_hash`.

MarketLedger does **not** assume venue fees are supplied by this endpoint. Optional `fee_bps` values are user/operator-supplied analytical adjustments and are recorded in every report.

## Commands

Normalize a saved OpenMarkets response:

```bash
python -m marketledger_openmarkets.cli normalize marketledger_openmarkets/fixtures/openmarkets_liquidity.json \
  --fee-bps venue_alpha=10 \
  --out snapshot.json
```

Evaluate it:

```bash
python -m marketledger_openmarkets.cli evaluate snapshot.json \
  --as-of 2026-09-18T06:20:30Z \
  --dispersion-threshold-bps 75 \
  --min-available-usd 100 \
  --out report.json
```

Read live liquidity (requires a self-serve OpenMarkets API key):

```bash
export OPENMARKETS_API_KEY='...'
python -m marketledger_openmarkets.cli live YOUR_CONTEST_ID \
  --as-of 2026-09-18T06:20:30Z \
  --fee-bps kalshi=10 \
  --out report.json
```

Create a confirmation-token-gated, non-executing action record:

```bash
export MARKETLEDGER_CONFIRM_TOKEN='human-confirmation-value'
python -m marketledger_openmarkets.cli stage report.json POSITION_HASH PARTNER_ID --out stage.json
```

There is no command that sends an order.

## Deterministic fail-closed boundaries

- snapshot age is bounded and future timestamps fail;
- duplicate positions or duplicate partners fail;
- price must be finite in `[0, 1]`;
- USD availability and supplied fee bps cannot be negative;
- fee bps cannot exceed 10,000;
- minimum-liquidity filtering is explicit;
- live base URL is HTTPS + exact-host locked to `api.openmarkets.ai`;
- live response bytes are bounded;
- input files must be regular non-symlink files under a size cap;
- outputs use exclusive create and refuse overwrite;
- confirmation tokens are hashed, not persisted in plaintext;
- core evaluation has no network/provider mutation path.

## Tests

```bash
python -m compileall -q marketledger_openmarkets marketledger_openmarkets/tests
python -m unittest discover -s marketledger_openmarkets/tests -v
python -O -m unittest discover -s marketledger_openmarkets/tests -v
```

The suite covers the published OpenMarkets liquidity shape, deterministic receipts, freshness, duplicate identity, price/liquidity/fee validation, fee-adjusted selection, liquidity gates, move detection, confirmation-token staging, host locking, GET-only live reads, and file/symlink boundaries.

## Submission status

This carrier is implementation/proof for the competition lane. A valid final submission still needs an actual self-serve OpenMarkets key, one live contest run, and the competition's three-minute presentation/upload flow. Do not claim a live run or submission until those provider-side receipts exist.
