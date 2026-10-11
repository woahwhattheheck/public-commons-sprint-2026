# Buyer → qualified partner → paid engineering workshare

The existing Node.js operator workflow connects buyer requirements, partner qualification, authorized contact, actual mailbox replies and collection records on one local board.

The useful sequence is to identify a current buyer problem, select a plausible specialist or prime, qualify the missing requirements with that partner, agree an acceptance-based paid scope, deliver it, and reconcile actual invoices and receipts. Qualification conversations can run under an existing owner sales directive. A complete bid qualification packet or a separately approved price is not required merely to ask a prospective partner about fit.

## Run the complete workflow

Requires Node.js 22 or newer; no dependencies or hosted compute.

```bash
node business/lead-to-paid-work-pipeline-20261010/pipeline.mjs \
  /private/opportunities.json /private/revenue-board \
  --gmail-captures=/private/gmail-captures.json
```

Open `/private/revenue-board/index.html`. The same command produces the original decision, workshare, reply and collection files plus the reusable `mailbox-state.json`, `reply-snapshot.json` and `mailbox-coverage.json`. Actual messages, addresses and provider links are private operator inputs and outputs; the public repository contains source only.

For the next capture, keep the same case bindings and supply the retained state:

```bash
node business/lead-to-paid-work-pipeline-20261010/pipeline.mjs \
  /private/opportunities.json /private/revenue-board-next \
  --gmail-captures=/private/new-gmail-captures.json \
  --previous-mailbox=/private/revenue-board/mailbox-state.json
```

The importer reads native connected-Gmail search, full-message, thread and batch results. It preserves account/message identities, full automatic-response headers and exact RFC message references, enriches search rows with later full reads, retains explicit human annotations, and emits actual remaining read requests. It never infers interest from a SENT receipt or an automatic acknowledgement. See [NATIVE-CONVERSION.md](NATIVE-CONVERSION.md) for schemas and operator instructions.

Existing `--reply-snapshot` and `--outreach-snapshot` inputs remain supported. Choose either native Gmail captures or an existing reply snapshot for one run. `--now=ISO` can reproduce an assessment. Omitting mailbox data explicitly means that replies were not evaluated.

## Contact authority and commercial readiness

Put original owner authorizations in top-level `communicationAuthority.grants[]`, then set each opportunity's `communication.action`:

| Action | Readiness |
| --- | --- |
| `QUALIFY_PARTNER` | Current buyer source, applicable deadline, source-backed named partner, useful workshare purpose and applicable owner contact authority. Missing prime documentation and an unpriced scope become questions for the conversation. |
| `PROPOSE_WORKSHARE` | Documented mandatory prime requirements, acceptance milestones, fee/cost/margin assessment and owner authority covering proposals. |
| `FOLLOW_UP` / `REPLY_TO_PARTNER` | Authority can be recorded for these actions; the existing reply queue supplies the relevant original-thread action. First-introduction eligibility remains separate. |

A standing grant uses `issuedBy: "OWNER"`, `kind: "STANDING"`, the original instruction reference and covered actions. It may constrain recipient domains, exact recipients, opportunity IDs, channels or expiration. Existing per-contact `ownerApproved` and `approvalReceipt` fields retain their legacy meaning; they are no longer the only way to record authority.

Explicit owner exclusions take precedence. Records explicitly attributed to an agent are advisory, not owner contact restrictions. Unattributed legacy `doNotContact: true` remains an exclusion until its origin is recorded; an explicit `restrictionSource: "AGENT"` identifies an agent-created hold. Existing recipient declines, previous SENT messages and provider delivery failures remain visible in the original reply/preflight workflow.

For a proposed fee under standing proposal authority, use `workshare.feeStatus: "PROPOSED"`. The board records `OWNER_STANDING`; it does not represent that amount as personally approved by the owner. `OWNER_APPROVED_PROPOSAL` still means the specific price was approved. Numerical margins by themselves provide no authority. A quote is not accepted work or revenue.

## Buyer and partner records

The case key remains buyer name + solicitation ID + revision. Keep cancelled/reposted editions distinct. Buyer status is explicitly `OPEN`, `CLOSED`, `CANCELLED` or `UNKNOWN`; `sourceCheck` records the issuer review. Dated solicitations require a confirmed offset timestamp. A genuinely continuous opportunity can use `buyer.deadline: {kind: "ROLLING", confirmed: true, originalText: "..."}` when supported by the source.

Mandatory requirements have stable IDs. Partner records map those IDs to `DOCUMENTED`, `SELF_REPORTED` or `UNKNOWN` with source URLs. `DOCUMENTED` is an operator-entered source pointer, not automatic verification of a certificate or procurement qualification. A qualification contact needs a first-party `partner.sourceUrl` or documentary evidence link; asking the partner to resolve gaps is part of the work.

`communication.partnerName` optionally selects the intended existing partner, and `communication.to` holds the verified recipient list. Explicit `caseId` joins the original reply queue. The case's owner and issuer URL must match the opportunity. This prevents a reply for one buyer from silently being attached to another.

## Replies and collection records

A real human reply is worked in its original thread. Automatic acknowledgements stay automatic even when the subject looks conversational: the importer retains `Auto-Submitted` and delivery-status MIME metadata. A departed-contact reply can identify a replacement contact; an existing SENT to that replacement is retained and prevents a duplicate introduction.

Only explicit reviewer annotations `INTEREST`, `DECLINE` or `NEUTRAL` classify the meaning of a human message. Exact account + provider ID scopes the annotation. Automatic text is never promoted to human interest. Search snippets cannot replace a fuller message already captured.

The original stage order and collection reconciliation remain unchanged: `SOURCED → BUYER_CONFIRMED → PRIME_CONFIRMED → PARTNER_REPLIED → SOW_SIGNED → INVOICE_SENT → PAYMENT_CONFIRMED`. Every accepted stage event retains its timestamp and receipt. Invoice installments, refunds, duplicate transaction quarantine and currency-separated integer totals remain in [COLLECTIONS.md](COLLECTIONS.md). No amount is earned merely because it was proposed or sent.

## Existing source and operator guides

- [NATIVE-CONVERSION.md](NATIVE-CONVERSION.md): native mailbox ingestion, continuation, current case bindings and reusable owner authority.
- [REPLY-TRIAGE.md](REPLY-TRIAGE.md): original standalone reply classifier and queue.
- [OUTREACH-BOARD.md](OUTREACH-BOARD.md) and [OUTREACH-PREFLIGHT.md](OUTREACH-PREFLIGHT.md): existing mailbox collision checks.
- [COLLECTIONS.md](COLLECTIONS.md): original invoice and payment reconciliation.

The CLI prepares the current action and concrete workshare. Connected sending remains with the authorized operator and existing provider tools. No new per-contact approval is demanded when the original owner directive already covers the action.

