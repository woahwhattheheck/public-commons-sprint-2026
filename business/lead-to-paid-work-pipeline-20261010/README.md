# Buyer → qualified prime → payable engineering workshare

A small **actual Node.js 22** operator tool for converting publicly posted requests for proposals into tightly defined specialist work. It is an offline, read-only decision process, not a bidder account, outreach bot, procurement scraper or payment processor.

## Why this exists

The reusable commercial motion is: (1) identify an active first-party buyer problem; (2) read the original terms, amendments, dates and exclusions; (3) identify an existing prime that can meet every mandatory qualification; (4) offer a separable deliverable with measurable acceptance and positive unit economics; (5) obtain owner approval before first contact; (6) preserve provider-backed acceptance, contract, invoice and paid-cash receipts. A human relationship owner owns every external communication. A compelling demo does not mean a qualified bidder, award or earned revenue.

Use the **same workflow** for vendor integration QA, accessibility remediation, source-data validation, CRM automation, compliance migration and agency web modernization. Do not recreate one software product for every public bid.

## Run immediately, no dependencies or cloud CI

```bash
node business/lead-to-paid-work-pipeline-20261010/pipeline.mjs \
  business/lead-to-paid-work-pipeline-20261010/opportunities.json \
  /tmp/lead-decision-board --now=2026-10-10T22:46:00Z
```

Open `/tmp/lead-decision-board/index.html` locally. `decisions.json` and `decision-board.md` have identical decision state. `workshare-sheet.md` is an additional **unsent, internal** prime-led acceptance/scope sheet; it deliberately withholds any fee not explicitly owner-approved. `--now` is optional and exists to make the same deadline assessment reproducible. No network call occurs, no account, API key or browser extension is needed, and no workflow is created.

Two current cases are included **as continuation examples for their existing owners**:

* Atlanta Regional Commission [RFP804(v2), WordPress and Website Support](https://procurement.atlantaregional.org/opportunities/rfp804v2-wordpress-and-website-support/). Repost is open, original RFP804 cancelled, requires registration/application approval before proposal, and the issuer page lists October 28, 2026 at 5 p.m. The explicit time-zone ambiguity is left unresolved rather than inferred from GA registry conflicting metadata. Its original ARC commercial owner retains all outreach/qualification/cost decisions.
* Oregon DEQ [S-34000-00018168](https://oregonbuys.gov/bso/external/bidDetail.sda?docId=S-34000-00018168&external=true&parentUrl=close). Original solicitation reviewed by original buyer owner; Oct 14, 2026 4 p.m. Pacific clarification cutoff, Oct 21 4 p.m. Pacific offer cutoff. Published Sourcemap traceability does **not** establish SOC 2 Type II/ISO27001 scope, offline/IoT, or 24-hour support. Existing OR-DEQ owner keeps all qualification and outreach.

The inputs deliberately price neither case and authorize no contact. One sample has a confirmed time zone; the other must be resolved from the actual issuer amendment or procurement reply. This difference is a useful demonstration of the hard gate.

## Contract for operators

Each `opportunities[]` has a unique (buyer name, solicitation ID, revision). Do not conflate a cancelled request and a revised repost. Mandatory requirements each have a stable `id`. Partner evidence maps requirement IDs to `DOCUMENTED` plus a public HTTPS citation, or `SELF_REPORTED`/`UNKNOWN`, which do not satisfy a mandatory requirement. `DOCUMENTED` means the operator supplied a document pointer, **not that the tool verified the provider or inspected certification scope**. Review each source manually and replace out-of-date or ambiguous pointers.

`workshare.milestones` must contain deliverables and objective acceptance. Set real `feeUsd`, `costUsd`, and a defensible finite `minimumMargin` in [0, 1) (25% default). `feeStatus: "OWNER_APPROVED_PROPOSAL"` must be explicitly set by the commercial owner after reviewing actual economics, **separately** from contact approval. All other fee statuses remain HOLD even with favorable numerical margins. Owner approval creates neither an offer nor a send. A positive model is **not** an invoice or customer. A named owner must explicitly set `communication.ownerApproved:true`, `doNotContact:false` and provide an approval receipt before even the `OWNER_APPROACH_CANDIDATE` state. That state is not permission for an automated send. The tool has no sending capability.

Recorded workflow stages are strictly ordered: `SOURCED → BUYER_CONFIRMED → PRIME_CONFIRMED → PARTNER_REPLIED → SOW_SIGNED → INVOICE_SENT → PAYMENT_CONFIRMED`. Each step must reference a concrete HTTPS receipt and ISO timestamp with an explicit offset; ordering must be chronological. Only the accepted `PAYMENT_CONFIRMED` event contributes its recorded amount; earlier invalid or out-of-order events are ignored. Payment also needs a recorded transaction identifier and amount. These are **operator-entered receipts**, not live Stripe or bank verification; independently check the provider before claiming cash. No network changes, bid submission, invoice creation or customer contact is performed by this code.

## Next real conversion move

For each held case, the first owner should resolve missing prime qualifications and choose **one** bounded paid-work slice rather than accumulating prototypes. A qualifying prime can then validate contract authority, price and schedule. Only the relationship owner chooses a recipient, approves the exact approach and supplies a provider receipt. Once the first payable scope is agreed, use that accepted packet as the delivery baseline for the engineering seat. Do not contact Michael Clark or the paused external demo on this pipeline's behalf.

### Example specialist offer structure (not sent or quoted)

* **Discovery and acceptance design**: receive real client samples and incumbent-stack documentation; deliver a signed-off evidence/acceptance matrix.
* **Contained implementation or audit**: resolve only the supplier's verified blockers, exercise actual provided schema or platform, and submit owner-reviewable artifacts.
* **Transfer and payment milestone**: client/prime signs off reproducibility and handover, and pays against the named acceptance events.

Use original buyer clauses and provider outputs for each client. Never represent this illustrative structure as awarded work or promised compensation. MIT.

## Owner-approval and workshare-export follow-on (October 10)

The original Linux implementation is hardened so an owner-entered *estimate* cannot accidentally release a prospect approach. The engine separately requires a nonnegative minimum margin below 100%, an explicitly `OWNER_APPROVED_PROPOSAL` fee, and explicit contact authorization. The additional `workshare-sheet.md` carries a customer-specific buyer-source pointer and objective payable acceptance milestones, but stays **internal/UNSENT**, with price withheld until approved. The program never sends or posts a quote. This reduces repeated boilerplate across buyer leads without assuming contracting authority.

## Collection balances and installment receipts

The same command now also writes `collections.json` and `collection-queue.csv`. See [COLLECTIONS.md](COLLECTIONS.md) for the explicit invoice/receipt input, partial payments, refunds, global duplicate quarantine, currency-separated integer totals and a synthetic runnable example. Use `evaluateAll` for batch totals; standalone `evaluate` is explicitly not duplicate-cleared. Actual payment records remain private operator inputs, never included in public source.


## Optional outreach snapshot on the same board

Add `--outreach-snapshot=/private/current-mailbox-snapshot.json` to run the existing collision checker in the same command. Map each opportunity to its exact intended contact using `communication.intentId` and `communication.to`; see [OUTREACH-BOARD.md](OUTREACH-BOARD.md). A snapshot HOLD can only reduce approach readiness. Without the option, existing commercial decisions are unchanged and the board shows NOT_EVALUATED. The command now writes seven outputs, including a preflight result or explicit not-evaluated record.
