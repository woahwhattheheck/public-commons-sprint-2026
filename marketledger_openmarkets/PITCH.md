# MarketLedger — three-minute pitch spine

## 0:00–0:35 — The problem
Cross-venue pricing looks simple until fees, liquidity, timing, and auditability matter. A trader or partner book can see two prices, but still lack a durable answer to: *which quote was actually best, was there enough size, what changed, and why was an action staged?*

## 0:35–1:20 — Why OpenMarkets changes the economics
OpenMarkets already normalizes every venue into a shared contest/market/position model. MarketLedger does not rebuild adapters. It consumes the normalized liquidity plane and turns each position into a deterministic evidence record: partner prices, operator-supplied fee adjustment, available USD, best eligible venue, cross-venue dispersion, and a SHA-256 receipt.

## 1:20–2:05 — Demo
1. Read `/contests/{id}/liquidity`.
2. Show two venues quoting one `position_hash`.
3. Apply fee assumptions and minimum-liquidity policy.
4. MarketLedger highlights the best eligible venue and an anomaly when dispersion crosses policy.
5. Compare two receipts to show a price-move event.
6. Stage a confirmation-token-gated action record. Point out: there is no execution method in the product.

## 2:05–2:40 — Business
The same evidence plane can serve a trading desk, partner book, creator product, or internal risk/reconciliation team. The value is not another odds screen; it is a replayable decision record across every partner OpenMarkets supports. Marketplace distribution can start with analytics, then add paid policy packs, team audit, and enterprise retention/export.

## 2:40–3:00 — Vision
OpenMarkets makes cross-venue execution programmable. MarketLedger makes the reasoning before execution inspectable. The long-term product is the audit and policy layer between normalized market data and any human-approved action.
