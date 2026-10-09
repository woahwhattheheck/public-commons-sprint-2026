# PayPal AI Hackathon 2026 — judge-entry guide

Reviewed October 9, 2026 against the [official rules](https://paypalaihackathon.devpost.com/rules) and first-party public README files. This document is an entry preparation checklist, not a submission receipt.

**Deadline:** November 12, 2026, noon PST. Required: meaningful PayPal developer platform **and** AI use, a runnable working project, public open-source source code with repository-root license, public YouTube demonstration shorter than three minutes, and a Devpost submission by the authorized entrant. Clear setup/run instructions can replace public hosting for judges. Multiple projects from one entrant must be substantially distinct.

The public repository contains a [root MIT license](../LICENSE). These projects are runnable source candidates, not verified provider-backed executions or contest entries.

| Project | Actual developer integration / AI role | Offline local judge start |
| --- | --- | --- |
| [ClaimProof Commerce](../claimproof-commerce/README.md) | PayPal Orders-v2 buyer-consent checkout, deterministic risk advice and optional AI advisory | `cd claimproof-commerce && npm start` (Node 22+) |
| [DisburseLens](../paypal-disburselens-2026/README.md) | Payouts-v1 read-only reconciliation and locally trained review classifier | `cd paypal-disburselens-2026 && node src/server.mjs` (Node 22+) |
| [RenewalGuard](../paypal-renewalguard-2026/README.md) | Subscriptions-v1 read-only review, optional AI-generated unsent note | `cd paypal-renewalguard-2026 && npm start` (Node 22+) |
| [CartWitness](../paypal26-cartwitness/README.md) | AI-recommended bounded catalogue; separately approved Orders-v2 sandbox checkout | `cd paypal26-cartwitness && DEMO_FIXTURE=1 python3 server.py` (Python 3.10+) |
| [DisputeLedger](../paypal26-disputeledger/README.md) | Disputes-v1 read-only evidence review; optional AI draft | `cd paypal26-disputeledger && npm start` (Node 22+) |

**Separate real-world activation:** Choose finalist entries; have existing authorized operators run actual sandbox and AI paths and retain redacted status/evidence; capture genuine running-product footage; publish and verify a public YouTube video under three minutes; verify a fresh-clone judge installation; and have the authorized entrant submit and retain Devpost receipts. Explicit human consent is required for the two Orders-v2 sandbox checkout demos. A fictional offline fixture is not proof of provider execution. The read-only apps require the proper Payouts, Subscriptions, or Disputes access. Avoid unnecessary deployment spend: official rules permit functional local setup instructions.

**Entry differentiation:** ClaimProof and CartWitness both use Orders-v2 but solve different buyer workflows; an entrant must still determine whether they are substantially different under the organizer's rules. DisburseLens, RenewalGuard and DisputeLedger respectively cover payouts, subscriptions and disputes.

**First-party README Git blob pins:** ClaimProof `aeed2c92495a57d5806df5735aa152a03a5528a5`; DisburseLens `78ec048f15e8ad455050831a65bcfe8c27540720`; RenewalGuard `06559bffa48cc202fff6395f98f3fc8f2ab95dcd`; CartWitness `a17cd0623a17d3d6d7be19f27f31543274963e0c`; DisputeLedger `154505bc898c82b1ee6425b91f737114d303350e`. Original [root MIT license](../LICENSE) blob `2d2a35a69e3896b7c6b885c1faebae2f2f8bc9c1`.

A source merge, mocked test, Slack handoff or draft is not a Devpost entry. Recheck first-party readmes for ongoing source changes. Official criteria: https://paypalaihackathon.devpost.com/rules .
