# SF97 / Merchant Revenue Operations

**Product:** a runnable seller-to-commercial-decision workbench. It consumes the existing **SF30 native seller-service JSON and its actual operator traffic snapshot** from `operations/launch.mjs`, joins merchant-owned USD prices, real costs and monthly targets, and exports a private, readable merchant pricing/acceptance review (`review.html`) plus machine-readable report (`report.json`). Both outputs are built from the same calculation. Standard-library Node 22+, no new payment or data collector, no npm install, hosted Actions or background jobs.

**Local merchant workspace:** [WORKSPACE.md](WORKSPACE.md) provides the complete browser workflow for editing actual quote/cost assumptions, reviewing all original payment choices, saving private report versions, reopening history and downloading CLI-compatible merchant terms. It uses the same analyzer and optional native companion described here.

This is a distinct commercial adoption layer. Use **SF87** for cross-rail x402/MPP cost comparison. Use **SF93** for merchant incident/support export, **SF96** for seller+dashboard launch composition and **SF10** for the single grant application. SF97 changes none of those sources or payment logic.

## One merchant pilot, start to finish

1. Configure and start the original SF30 seller and its existing operations observer. It can use a static/CSV/SQLite backend or the already-shipped `--upstream` composition; no second service implementation here.
2. Inspect the real seller `/_seller/offers` and the existing operator `GET /api/snapshot`, then copy `example-terms.json` to a **private** file. Add one commercial entry per **actual** seller route: every offered payment option, independently quoted USD per fulfilled request, owner-approved variable fulfillment/challenge cost (use `null` for unknown), and the merchant's *own* monthly paid-volume target. The quote and cost schedule apply to every approved alternative on that route.
3. Use **live** snapshot input while the seller is running, or an original export collected by the existing operator. The tool checks route ID, method, path, original counter conservation, native seller mode, and exact seller payment identity to catch a mismatched config.
4. Open the resulting local HTML to review demand, 402 quote friction, service completions, failure/disconnect counts, actual native latency bound, per-route planned gross/contribution, missing pricing inputs and the original source hashes. Use the findings to negotiate a small paid pilot, scope operating thresholds and set concrete owner acceptance milestones. Actual paid revenue must be reconciled separately to confirmed settlement and contractual billing records.

### Commands

From repository root (shell example):

```sh
S=stellar/scf-starforge-20261009/sf30-seller-sdk
R=stellar/scf-starforge-20261009/sf97-merchant-revenue-ops
node "$S/operations/launch.mjs" --operations-port 8424 -- \
  --config "$S/examples/service.json" --port 8423
# Separate shell with an original running seller:
cp "$R/example-terms.json" ./PRIVATE-owner-terms.json
# Replace illustrative asset, recipient, cost, price, targets with genuine seller data.
node "$R/analyze.mjs" \
  --config "$S/examples/service.json" \
  --terms ./PRIVATE-owner-terms.json \
  --ops-url http://127.0.0.1:8424 \
  --output ./merchant-review-20261011
# Open merchant-review-20261011/review.html in a local browser.
```

Alternatively, use the **original** dashboard's `/export.json` download:

```sh
node "$R/analyze.mjs" --config ./seller-service.json \
  --terms ./PRIVATE-owner-terms.json \
  --snapshot ./original-operations-export.json \
  --output ./merchant-review-unique-case
```

The tool prints a JSON status line, not the merchant data. Output directory **must not exist** (non-overwriting `mkdir`, files `wx`, directory `0700`, files `0600` on POSIX). The HTML shows every option's network, atomic amount, timeout and asset/recipient SHA-256. Raw asset, `payTo` and `extra` remain in the private JSON report for owner comparison. Every input file has a SHA-256 in output. All paths are local, and live URL is restricted to HTTP loopback with redirects prohibited and a four-second timeout. It does not poll, schedule anything, call external URLs or send messages.

### Approve every payment alternative

The analyzer reads either original `definition.payment`, original `definition.paymentOptions`, or every entry of an imported `offer.accepts`. It uses the exported `normalizeSellerPaymentOptions` from the original SF30 seller, including its network, amount, duplicate-rail, timeout and JSON-extra rules. It does not compile a replacement resource or infer a payment choice from the first array entry.

For multiple choices, replace the commercial entry's singular `expectedPayment` with `expectedPayments`. Copy the entire ordered option set from the same seller configuration, changing the native `amount` field name to `atomicAmount`. Include `maxTimeoutSeconds` and include `extra` exactly when the configured option has it. The following is the commercial-entry shape for a route offering two alternatives; replace the illustrative values with the actual merchant configuration and quote:

```json
{
  "expectedPayments": [
    {
      "scheme": "exact",
      "network": "stellar:testnet",
      "asset": "COPY_FIRST_ASSET",
      "atomicAmount": "10000",
      "payTo": "COPY_FIRST_PUBLIC_RECIPIENT",
      "maxTimeoutSeconds": 60
    },
    {
      "scheme": "exact",
      "network": "stellar:pubnet",
      "asset": "COPY_SECOND_ASSET",
      "atomicAmount": "2500",
      "payTo": "COPY_SECOND_PUBLIC_RECIPIENT",
      "maxTimeoutSeconds": 60,
      "extra": { "areFeesSponsored": true }
    }
  ],
  "priceBasis": "Illustrative common route valuation; replace with the merchant's actual quote",
  "unitPriceUsd": "0.01",
  "perFulfilledUsd": null,
  "perChallengeUsd": null,
  "monthlyPaidTarget": 3000
}
```

Put this entry under the actual route ID in `terms.routes`, retaining the existing top-level schema, merchant name and shared fixed-cost fields. Do not add sponsorship metadata unless it is present in that configuration. Native facilitator capabilities may enhance runtime sponsorship; this worksheet records the specific configuration whose hash is attached to the report.

`expectedPayments` must match every complete normalized option, in seller order, with exact JSON values. A missing alternative, changed recipient/asset/amount, changed timeout, reordered option or changed `extra` stops the report as stale commercial terms. A single-option route may also use this complete binding. Existing `expectedPayment` remains accepted only for a one-option route and retains its five-field scheme/network/asset/atomicAmount/payTo comparison. Specify exactly one of the two fields.

One route still has one USD valuation, cost schedule and monthly paid target. The target is not multiplied by the number of choices. SF30 HTTP traffic does not record which payment option produced each response, so neither demand, costs nor response counts are split across alternatives. If prices or costs differ by selected asset or recipient, use the option-aware [merchant settlement accounting](../merchant-settlement-accounting/README.md) terms for actual source reconciliation; the route-level forecast here does not assume a payment mix or FX rate.

The existing report schema and route counters remain. Each route adds `paymentOptions` with complete terms, `paymentBinding`, `commercialScope: "ALL_CONFIGURED_PAYMENT_OPTIONS"` and `httpPaymentOptionAttribution: null`. The old `payment` field retains its five-field shape for a single option and is `null` for multiple options. Downstream consumers should read `paymentOptions`; treating its first entry as the sole quote loses real alternatives.

### Accounting and pricing conventions

- **Actual observed counts:** attempts, HTTP 402 challenges, 2xx service responses, HTTP 5xx, disconnects and histogram P95 *upper bound* are from the original SF30 route observer. A challenge is not a new customer; a 2xx server finish is not settlement, cash, a unique buyer or even confirmed client delivery. Unknown/unmatched methods stay visible as review flags, not reallocated to products.
- **Merchant assumptions:** `unitPriceUsd` is a **seller-entered fiat valuation or quoted USD price**, not a conversion inferred from an asset's atomic amount. `expectedPayments` binds the complete offered set; the legacy singular field applies only to one option as described above. `priceBasis` records how the route's common USD valuation was established. USD values are **strings with at most six decimal places**, using exact BigInt micro-USD math. Targets are nonnegative safe integer paid requests/month.
- **Nominal 2xx value:** a counterfactual `2xx × owner quote`, never recognized revenue. `modeledObservedContributionUsd` is likewise a counterfactual based on merchant-input fulfillment and challenge costs; it is **not** an accounting P&L. `CHALLENGE_ONLY` cannot be promoted to billable demand.
- **Planned monthly unit economics:** `monthlyPaidTarget × unitPriceUsd` minus `monthlyPaidTarget × perFulfilledUsd`; shared fixed cost is subtracted from the total once. Unknown costs remain `null` rather than assuming zero. HTTP challenge workload overhead has no determined monthly forecast from paid-request targets, so `perChallengeUsd` appears only in observed-response sensitivity, **not** the planned paid-target variable subtotal. Insert a separate original operations forecast before committing to a commercial SLA.
- **Scope:** positive USD prices/costs and nonnegative request volumes; negative rebates, refunds, FX, failed settlement fees, price drift during observation, taxes, channel liquidity, gross-to-net invoices and provider settlement costs are not silently guessed. Account for these explicitly in the actual merchant quote, supplement via original SF87, and reconcile genuine receipts separately. Never substitute this report for a chain/payment ledger.

### Existing-native-schema local exercise

This module was implemented against original source `SF30 operations/traffic.mjs` (`stellar-forge.seller-traffic.v1`), `SF30 examples/service.json` (`stellar-forge.seller-service.v1`), and original SF87 decimal practices. The focused smoke exercise passes a native-shape capture through the whole CLI and inspects report/HTML. It is a deterministic wiring exercise, not competition scoring, external provider traffic, a live paid sale or a new payment verifier. For a full original operator session, run the **live** command above on a worker already running the maintained SF30 seller and use actual merchant costs.

For an existing native SF98 outbox from that same seller/session, add `--native-outbox /private/merchant/sf98-outbox` to the analyzer command. The existing native companion then writes `native-settlement/` alongside the commercial report. It groups actual notices and callback states by complete option, with recipient-aware legacy matching and exact per-option atomic totals. See [NATIVE_RECONCILIATION.md](NATIVE_RECONCILIATION.md) for the source and migration contract.

**Integration surfaces:** original SF49 merchant pilot, SF30 native seller+operations, SF87 price model, SF93 support bundle, and SCF #46 founder technical readiness. SF97 is private operator review, not a public browser app or a replacement for the commercial owner. The HTML is deliberately restrained industrial software, with a printable narrow-screen layout and no scripts or network resources.
