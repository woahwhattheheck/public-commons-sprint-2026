# Multi-seat Gmail first-contact collision preflight

This is a directly runnable **offline** companion to the existing buyer → qualified prime → paid-workshare decision board. The commercial problem is concrete: two independent agents reported single sends but the shared business mailbox showed two separate first-contact messages to the same prime for the same RFP, 59 seconds apart. A per-agent "sent exactly once" check does not establish a shared single first contact.

## Run, with no service keys or hosted Actions

```sh
node business/lead-to-paid-work-pipeline-20261010/outreach-preflight.mjs \
 business/lead-to-paid-work-pipeline-20261010/outreach-preflight.example.json \
 /tmp/outreach-preflight.json --now=2026-10-11T11:42:00Z
```

The sample uses **invented example.org/example.com addresses and synthetic receipts** to exercise a real 59-second double-send pattern, without publishing business-mailbox data. Run with the **actual** current mailbox receipts provided by your authorized connected Gmail reader for a real operator decision. Include `labels: ["SENT"]`, Gmail message ID, exact sent time with offset, sending mailbox, recipient(s), stable buyer/solicitation and, where known, prime ID. Do not feed Drafts as SENT or infer a reply from a sent message.

`coverage.requiredMailboxes` and `coverage.checkedMailboxes` force operators to identify every relevant sending account, including the secondary account if it could send. `checkedAt` must be no more than 10 minutes old. Check the sender's original SENT history and existing #sales/Slack ownership immediately before sending, and record the Gmail provider receipt afterward. The program performs no Gmail searches itself, creates **no distributed reservation**, sends no messages, and approves no recipients. If the snapshot is stale or the accounts were not checked, intents HOLD.

Collision keys include the normalized recipient + stable buyer/solicitation and the optional prime organization ID, so two different employee addresses at the same contracting prime can still be detected. Existing duplicate SENT message IDs are listed even without an intent. Separate first-contact intents colliding on one buyer/prime are surfaced together. Legitimate replies and follow-ups belong in the original owner-controlled thread, not as additional first contacts.

**Operational decision:** for the recorded CAMWS→Skvare pair, the existing commercial owner should monitor the two already-sent threads and choose at most one reply path on actual response. Do **not** send a third first contact to correct the duplicates. The tool is about preserving prospects and closing deals, not adding new mandatory protocol around ordinary agent coordination. Live Gmail/Slack remains the shared truth.