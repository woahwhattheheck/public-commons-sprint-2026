# Show the existing outreach preflight in the decision board

The original decision board and original offline Gmail collision checker can now run together. A supplied duplicate-contact or stale-mailbox HOLD prevents the same board from showing that opportunity as an approach candidate. This is a local integration, not a sender or mailbox reader.

The option is **off by default**. Without a current mailbox snapshot, the original commercial decision remains unchanged and the board explicitly shows `NOT_EVALUATED`. Do not interpret that status as a passed collision check.

## Connect a real operator snapshot

Use the existing `OUTREACH-PREFLIGHT.md` input contract and approved mailbox-reading workflow to prepare the current snapshot. The integration invokes the original `review()` function; it does not reproduce its collision rules, bypass its freshness window or query Gmail itself.

Add these fields to each opportunity's existing `communication` object:

```json
{
  "intentId": "the-exact-id-in-snapshot-intents",
  "to": ["the-exact-intended-recipient@example.invalid"]
}
```

Retain the real `ownerApproved`, `doNotContact` and `approvalReceipt` fields. The snippet only illustrates additional mapping fields and grants no authorization.

Run:

```bash
node business/lead-to-paid-work-pipeline-20261010/pipeline.mjs \
  /private/owner-opportunities.json /private/owner-decision-board \
  --outreach-snapshot=/private/current-mailbox-snapshot.json
```

The seven outputs include `outreach-preflight.json` and the existing collection/decision outputs. The preflight file is written on every run; when the option is absent it contains `NOT_EVALUATED`, replacing a previous snapshot result instead of leaving stale success data in the same output directory. The HTML and Markdown boards show the preflight state and reasons. JSON retains matching prior message IDs for the relationship owner's follow-up in the existing thread.

## Exact connection checks

The chosen intent must have:

- The same buyer name and solicitation ID as the opportunity.
- The same named relationship owner.
- The same prime organization as the board's selected documented candidate.
- Exactly the intended recipient set from `communication.to`, using the original checker's mailbox normalization.
- A unique mapping to this one opportunity in the batch.

Buyer, solicitation, owner and prime labels use lowercase/trimmed/collapsed-space comparisons. Intent IDs remain exact. If two real systems use different organization labels, the owner must reconcile those identifiers explicitly; the integration does not infer that two aliases identify the same prime. An absent mapping, mismatched identity or recipient, or shared intent produces HOLD. Unknown coverage or malformed snapshot inputs fail through the original checker before any output generation.

For a correctly mapped intent, all intended recipients must receive the original checker's `NO_COLLISION_OBSERVED`. Any existing sent contact, pending-intent collision, stale snapshot or missing mailbox carries its HOLD onto the decision board. This can only reduce readiness; it never turns a missing buyer, prime, pricing or owner approval into approval. The original `outreachAuthorized` field continues to reflect its existing owner-approval record separately.

`NO_COLLISION_OBSERVED` means only that the supplied snapshot contains no matching collision. It remains separate from live mailbox/Slack ownership checks, the existing shared outbound reservation and specific sender authorization. Replies belong in the existing owner-controlled thread. This module creates no reservation, Gmail draft, message, invoice or schedule.

## Local verification

```bash
node --test business/lead-to-paid-work-pipeline-20261010/outreach-board.test.mjs \
  business/lead-to-paid-work-pipeline-20261010/collections.test.mjs
```

Four integration scenarios cover duplicate first contact to another employee at the same prime, clear snapshots with missing owner authority, stale/incomplete mailbox coverage and identity/recipient/shared-intent mismatches. The existing eight collection scenarios remain passing. Tests use only synthetic example identities and Node built-ins.
