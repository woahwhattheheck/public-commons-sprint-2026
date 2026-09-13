# Sponsor-fit truth table

This document is a build-time checklist. It does not assert that any sponsor requirement has been satisfied until the referenced live evidence exists.

## Hedera AI & Agentic Payments

Product seam: Lane A exposes a real x402-gated report service and buyer flow on Hedera testnet through the chosen facilitator. Lane C preserves `hedera:testnet`, HBAR `0.0.0`, the 402 boundary, exact tinybar offer, and the verified settlement transaction reference.

**Still requires live evidence:** public project endpoint, actual paid testnet request, exact settlement receipt/transaction, public repository, README and video. Lane C must not synthesize these.

## The Graph — From Scratch AI

Product seam: Lane B obtains live Agent0/provider identity and reputation information from a deployed Graph network and turns it into `BUY`, `SKIP` or `HOLD`; that decision materially changes whether the paid service is called. Lane C verifies the published Lane B receipt/digest and applies an additional stale/future Graph-block fence and specifically HOLDs a packet that claims the Graph provider evidence came from `hedera:testnet`.

**Still requires live evidence:** the exact deployed subgraph/product queried, request/query receipt or source-bound capture, and proof that changing the live provider evidence changes the purchase decision.

## Bazantic

Product seam: the Recipe tells a buyer agent when to use Graph intelligence, when to call the x402 report service, and how to use the returned report only after verified settlement. The A/B verifier requires the Recipe to be the material experimental difference.

**Still requires live evidence:** account attribution, Gateway, Recipe, working multi-service flow, baseline/Recipe captures with identical model/settings/API access and a recording. `release-gate` stays HOLD on known placeholders or absent improvement.

## Cross-sponsor coherence

One end-to-end demo should prove the same product, not three disconnected prize demos:

1. live Graph evidence yields a purchase policy;
2. `REFUSE` / `DEFER` prevents the paid call;
3. `BUY` allows Lane A to make the x402 request;
4. HTTP 402 is handled as payment-required, not success;
5. a real Hedera testnet settlement is independently verified by Lane A;
6. only then does the Recipe expose the report recommendation;
7. the A/B capture demonstrates that enabling the Recipe improves the agent outcome while all controlled variables remain fixed.
