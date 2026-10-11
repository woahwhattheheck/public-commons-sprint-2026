# From verified outreach to paid-work next actions

`reply-triage.mjs` is a zero-dependency Node 22 operator extension to the existing buyer-to-prime pipeline and `outreach-preflight.mjs`. It advances actual SENT receipts and returned email into an action queue. It neither discovers prospects nor emails anyone; no new lead database, credentials, paid runner, workflow or automatic schedule. Keep case-specific messages private.

## Usage

```bash
node business/lead-to-paid-work-pipeline-20261010/reply-triage.mjs \
  /private/actual-gmail-message-export.json /private/reply-queue \
  --now=2026-10-11T13:00:00Z
```

Output: `reply-queue.json` and `reply-queue.md` sorted with human interest first, urgent human review next, and already-routed/awaiting contacts later. Use an existing local authenticated Gmail/Slack owner to supply the provider data. This program makes no network calls; no hosted Actions jobs or recurring triggers are needed. Case messages must be explicitly mapped to `caseId`, including separate-thread out-of-office replies, to avoid guessing that unrelated mail belongs to an opportunity.

## Small input contract

```json
{
  "cases": [{
    "id": "DEMO-CASE", "owner": "EXISTING_RELATIONSHIP_OWNER",
    "sourceUrl": "https://example.org/original-buyer-rfp",
    "deadline": "2026-10-22T17:00:00-04:00"
  }],
  "messages": [{
    "caseId": "DEMO-CASE", "id": "verified-gmail-message-id",
    "from": "Someone <someone@example.org>", "to": ["owner@example.com"],
    "email_ts": "2026-10-11T12:10:00Z", "labels": ["INBOX"],
    "subject": "Automatic reply: RFP inquiry", "body": "For assistance contact alternate@example.org",
    "display_url": "https://mail.google.com/mail/u/0/#all/verified-gmail-message-id"
  }]
}
```

`from_`/`from` and `display_url`/`displayUrl`/`receiptUrl` mirror current Gmail connector output. Every message needs real unique provider message ID, explicit-offset provider timestamp, provider URL, case mapping, sender/recipient and labels. `SENT` label is authoritative for outbound; drafts do not count. Automatic replies and delivery failures are never counted as human interest. Human messages with unknown intent are prioritized for human review rather than guessed as qualified buyers. Owner may annotate an actual reviewed inbound message with `humanDisposition: "INTEREST"`, `"DECLINE"`, or `"NEUTRAL"`; otherwise it stays `UNREVIEWED`. Interest is a conversation signal, **not** signed scope or paid revenue.

An out-of-office message saying the employee left and providing an updated address becomes `CONTACT_ROUTING_AVAILABLE`. If the updated recipient already has a verified SENT message within the same case, it becomes `CONTACT_ROUTED_AWAITING_REPLY` instead of prompting a duplicate send. The tool never sends, schedules or grants approval. A first contact still younger than 48 hours is kept in `OUTBOUND_AWAITING_REPLY`; older unanswered cases move to `FOLLOWUP_REVIEW`. Expired buyer deadlines are surfaced without erasing the actual message history.

## Worked original-data use

In the internal October 11 Decide DeKalb/InterDev case, live provider messages show an initial SENT to the former employee, his automatic reply naming a current InterDev contact, and a later SENT to that updated contact. With these three actual Gmail receipts on one case, the output is `CONTACT_ROUTED_AWAITING_REPLY`: one alternate email was already sent; further contact should not be duplicated. Original provider message IDs and body remain inside the private owner input, never in this public source. This is a direct next-action consumer for the existing lead-to-paid engine, not a replacement for `pipeline.mjs` or first-contact `outreach-preflight.mjs`.
