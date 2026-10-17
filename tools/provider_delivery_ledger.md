# Reconcile provider sends and delivery status

A later Gmail search can omit a message that was already read with the SENT label. A subsequent delivery failure also leaves that message in SENT. Replacing a local count with each search response loses known sends; treating the SENT label as recipient delivery conceals failures.

This offline module maintains the union of confirmed Gmail sends and joins structured delivery status notifications to the original RFC Message-ID and recipient. The CLI preserves its exact local inputs in a new output directory. It does not send messages or schedule retries.

## Run

```sh
node tools/reconcile_provider_delivery.mjs - observations.json Delivery-Reconciliation
node tools/reconcile_provider_delivery.mjs Delivery-Reconciliation/ledger.json later-observations.json Next-Reconciliation
node tools/provider_delivery_ledger.test.cjs
```

The second invocation adds observations to the existing ledger. An empty or partial batch cannot erase previously confirmed sends. Duplicate reads reuse the provider identity. Conflicting sender, recipient, time or message identity raises an error.

An input has `observations` and optional quota `windows`:

```json
{
  "observations": [
    {
      "kind": "sent",
      "account": "sender@example.com",
      "observed_at": "2026-01-02T12:01:00Z",
      "source_ref": "gmail:sender@example.com/ACTUAL_MESSAGE_ID",
      "message": {}
    }
  ],
  "windows": [
    {
      "account": "sender@example.com",
      "start": "2026-01-02T00:00:00Z",
      "end": "2026-01-03T00:00:00Z",
      "limit": 75
    }
  ]
}
```

Replace the example values and `message` with the actual Gmail full-message object. Both connector snake_case and Gmail camelCase field names are accepted. Use `kind: "dsn"` for the original delivery status notification. Required body data must already be decoded into `body.content`; fetch absent body content before supplying the observation. The decoder handles delivery-status child parts as returned by the connected Gmail reader.

The quota window has explicit UTC boundaries, so callers can calculate the intended local operating day without assuming UTC midnight. Each unique confirmed message consumes one slot even if it later fails. A multi-recipient message also counts once. Reserved drafts are coordinated separately: this count covers observed sends only.

## Outputs and decisions

- `ledger.json`: persistent sends and notifications with observation source references.
- `delivery-status.json`: per-message and per-recipient states, diagnostic fields, and unmatched notifications.
- `quota-summary.json`: sends, remaining slots, over-limit count and outcome counts for each supplied window.
- `observations-input.json` and, when supplied, `previous-ledger.json`: exact local input copies.

A send starts with status `sent`. Structured reports can mark it failed, delayed, delivered, forwarded or partly failed. `relayed` and `expanded` are reported as forwarded, because those actions do not establish final recipient delivery. Conflicting terminal reports remain explicit. Plain message text, matching subjects, references to an earlier thread ancestor, and matching Gmail thread IDs alone do not attach a failure.

Notifications arriving before their original send is added remain in the ledger and are reconciled after later observations. Matching requires the same account, an unambiguous original RFC Message-ID, and the original or final recipient in the original send. This avoids assigning a bounce to another introduction in the same conversation.

The parser follows [RFC 3464](https://www.rfc-editor.org/rfc/rfc3464) recipient/action/status fields and unfolded diagnostic lines. Its input is retained provider output; it does not authenticate a third party notification independently. Missing structured bodies or unmatched originals remain visible for the existing case owner to resolve.

Keep operational observations and generated ledgers with the existing private customer/source records. This repository contains only generic code and example fixtures. The library has no external dependencies and also executes in a JavaScript-only connected runtime.
