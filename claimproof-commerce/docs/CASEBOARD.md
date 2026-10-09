# ClaimProof Review Operations — AG Grid caseboard

A read-only review triage dashboard integrated with ClaimProof Commerce through its existing genuine pre-purchase JSON exports. No sample orders are created or required.

## Use

1. Run the existing ClaimProof app on loopback port 3159 with `cd claimproof-commerce && npm start`.
2. Complete a cart review and select **Save pre-purchase review** to export its review JSON.
3. Start the independent local dashboard: `node claimproof-commerce/src/caseboard.mjs` (Node 22+, port 3160).
4. Open http://127.0.0.1:3160 and import one or more exported files. Interactively sort/filter the AG Grid, drill into cases, inspect buyer-supplied terms and advisory findings, and export filtered CSV.

There are no server uploads: the browser parses and checks review schema, recomputes line-item totals, and recalculates the same SHA-256 cart fingerprint as `src/core.mjs`. Invalid, contradictory and unsupported review records are rejected. Browser data is not persisted on the server. Review total is a *proposed purchase amount*, not a sales/settlement ledger; PayPal sandbox order creation/capture remains in the existing app with its separate user approvals.

The dashboard loads official AG Grid Community 36.2.0 through the pinned jsDelivr CDN, so the browser needs CDN access. The browser content policy disallows fetch and network uploads. Only `/` and `/health` are served; no purchase, claim or payment endpoint exists in this dashboard.

PayPal AI Hackathon: https://paypalaihackathon.devpost.com/rules (November 12, 2026 deadline). Official AG Grid sponsor tool details: https://paypalaihackathon.devpost.com/details/aggrid . The competition advertises $5,000, $2,000 and three $1,000 sponsor awards, contingent on an eligible submission and judging. More advanced AG Studio dashboard polish and evidence of actual PayPal sandbox+AI usage would improve competitiveness. Original entrant ownership and applicable reward rights stay intact.
