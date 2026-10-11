# Native Gmail capture and standing sales authority

## Capture once, reuse the original provider response

A capture file has `accounts[]`, `cases[]` and `captures[]`. The account table is copied from the verified connected mailbox profile; its local ID is stable across refreshes. Each capture contains the exact tool response, its operation, request arguments, account and capture time.

```json
{
  "accounts": [
    {"id": "business", "linkId": "verified-connector-link", "email": "owner@example.org"}
  ],
  "cases": [
    {
      "id": "BUYER-PARTNER-01",
      "owner": "Original relationship owner",
      "sourceUrl": "https://buyer.example.org/current-opportunity",
      "bindings": [
        {"accountId": "business", "threadIds": ["actual-provider-thread-id"]}
      ]
    }
  ],
  "captures": [
    {
      "id": "operator-chosen-stable-capture-id",
      "accountId": "business",
      "capturedAt": "2026-10-11T15:00:00Z",
      "operation": "read_email_thread",
      "request": {"thread_id": "actual-provider-thread-id", "max_messages": 100},
      "result": {"structuredContent": {"id": "actual-provider-thread-id", "messages": []}}
    }
  ]
}
```

The empty `messages` array above describes the envelope only; replace `result` with the original response. It is not a mailbox example or evidence of any send. Supported actual response shapes are search `emails[]`, a single full Gmail message, thread `messages[]`, batch `responses[]` and batches of threads. Both connected-tool snake_case and native Gmail camelCase fields are accepted. A top-level `structuredContent` or JSON `content[].text` wrapper can be retained.

The importer accepts text MIME parts already decoded by the connector, and base64url body parts returned by native Gmail. It prefers plain text, strips markup from HTML-only content, and does not read attachments or render mailbox HTML. It retains the headers needed for message references, automatic acknowledgements and delivery failures. Body extraction has a 1 MiB text limit and records truncation.

## Exact case binding

Use `bindings[].messageIds` for an individual provider message and `bindings[].threadIds` for a complete known conversation. Bindings always specify `accountId`; identical message IDs in different mailboxes remain different observations.

Some helpdesks and out-of-office systems start another Gmail thread. An imported message is joined to the same case only when its original `References` or `In-Reply-To` points to an already bound original RFC `Message-ID` in the same account. No subject similarity, guessed person mapping, or domain-level grouping assigns a case. An ambiguous reference remains a visible mapping issue. Unbound messages are retained in `mailbox-state.json` and listed in coverage, so adding a binding later does not require downloading them again.

Keep the case `owner` and `sourceUrl` equal to the corresponding opportunity's `owner` and `buyer.sourceUrl`; set `communication.caseId` to its ID. The original board join enforces those exact relationships.

## Incremental refresh and remaining reads

The original capture result is fingerprinted. Reusing its stable ID with different content is rejected; importing the same capture twice is idempotent. A later search can update labels, but cannot erase headers or full body text obtained by an earlier full read.

A saved state contains only normalized messages and capture metadata, not the original mail transport headers. Supply `--previous-mailbox` to the main workflow or `--previous` to the standalone importer. The next input carries the current full case map; it may contain only new captures. Reviewer dispositions from previous state persist unless an explicit new review replaces them.

`mailbox-coverage.json` includes:

- Original next-page tokens with the exact search arguments for continuation.
- Up to 100 message IDs per suggested native `batch_read_email` request for search-only rows.
- Requested messages omitted from a returned batch.
- Thread windows that reached the caller's requested maximum.
- Unbound and ambiguously bound provider messages.

These are read requests for the existing connector. The importer makes no network call. A final page establishes the end of that query, not coverage of an entire mailbox. A capped thread window can be expanded with the original thread read tool; omitted historical content is never inferred.

Inbound search summaries remain in `MESSAGE_CONTENT_REQUIRED` until the full native read arrives; a conversational subject alone never becomes a human response. Failed or missing reads survive restart and appear as concrete continuation requests. A successful retry of the same request or a full read of the missing message clears its corresponding issue. Full bodies and explicit human review annotations survive later search and metadata refreshes.

## Human review

Add explicit `reviews[]` records to the next capture input:

```json
{
  "accountId": "business",
  "messageId": "actual-provider-message-id",
  "reviewer": "Original relationship owner",
  "disposition": "INTEREST"
}
```

Accepted dispositions are `INTEREST`, `DECLINE` and `NEUTRAL`. The original classifier still determines whether a message is SENT, automated, a delivery failure or a human message requiring review. An annotation on an automated ticket does not turn that ticket into interest.

## Reply and referral state

Automatic contact referrals are extracted from the reply's authored routing clause. Quoted original messages, address headers, the former sender, and every known connected mailbox/SENT sender are excluded. A referral already approached remains recorded as contacted rather than returning as a new introduction.

A human message is considered answered only when a later SENT message addresses that sender and links through an exact RFC reference or the same account-scoped Gmail thread. An unrelated later email does not clear the reply. The queue retains the original human message and the answering provider receipt, selects the newest unanswered message for response, and returns fully answered conversations to the existing awaiting-reply/follow-up lanes. A latest recorded decline stays declined after an acknowledgement.

Gmail drafts remain in the retained capture with a separate `draftCount`; they are neither a verified send nor an incoming human reply and never create a follow-up task by themselves.

Conflicting provider thread identities are retained as `MESSAGE_IDENTITY_CONFLICT` with both observed thread IDs and the capture time. An older full read cannot silently erase that issue. The same incremental workflow requests another full provider read, marks the affected conversation for that read, and clears the conflict after a later successful full capture confirms the retained identity. No synthetic message or automatic resend resolves it.

## Reuse an owner directive

Put policy data alongside `opportunities[]` in the existing pipeline input:

```json
{
  "communicationAuthority": {
    "grants": [
      {
        "id": "owner-sales-directive",
        "issuedBy": "OWNER",
        "kind": "STANDING",
        "reference": "Original owner instruction or its durable link",
        "issuedAt": "2026-10-11T14:46:00Z",
        "actions": ["ORDINARY_OUTBOUND_SALES"],
        "channels": ["email"]
      }
    ],
    "exclusions": [
      {
        "id": "reserved-relationship",
        "issuedBy": "OWNER",
        "reference": "Original owner no-contact instruction",
        "actions": ["ORDINARY_OUTBOUND_SALES"],
        "channels": ["email"],
        "recipients": ["reserved-contact@example.org"]
      }
    ]
  }
}
```

The operator records actual instructions; the source does not create them. `ORDINARY_OUTBOUND_SALES` covers the four contact actions exposed by this workflow. Individual actions can be specified instead. Optional `recipients`, `recipientDomains`, `opportunityIds`, `channels` and `expiresAt` narrow a grant. Domain scope matches that domain and its subdomains. Exact grants must name recipients or opportunity IDs. An exclusion matching any intended recipient excludes that message; a scoped grant must cover all intended recipients.

Opportunity configuration:

```json
{
  "communication": {
    "action": "QUALIFY_PARTNER",
    "partnerName": "Existing partner record",
    "to": ["verified-contact@example.org"],
    "authorizationIds": ["owner-sales-directive"],
    "caseId": "BUYER-PARTNER-01"
  }
}
```

A qualification approach can ask about missing mandatory requirements and fee/scope fit without pretending the partner is already eligible for a bid. The original proposal lane still requires documented mandatory requirements, acceptance milestones and viable recorded economics. Under proposal authority a suggested price uses `feeStatus: "PROPOSED"`; it is displayed as a proposal authorized by the standing directive, not as owner approval of the exact amount.

Explicit owner exclusions override grants. Entries explicitly issued by `AGENT` are reported as advisories and create neither authority nor owner restrictions. Legacy untyped `doNotContact` remains in force because its origin is unknown; where the original record identifies an agent-created hold, set `restrictionSource: "AGENT"`. This is an attribution field, not permission to relabel owner restrictions.

No new contact authority changes provider declines, duplicate-send history, contract terms or receipt-backed collection balances. Actual connected sending and final provider readback remain part of the operator's existing workflow.

