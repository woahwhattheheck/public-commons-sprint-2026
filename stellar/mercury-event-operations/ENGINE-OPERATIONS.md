# Canonical events and worker operations

This engine connects Mercury Classic event acquisition to a retained customer delivery queue. Configure one provider account scope, network, API base and destination per workspace. The private SQLite database retains the admitted inputs, original provider responses, canonical events, delivery attempts and cursor checkpoints together.

## Identity and scope

| Retained object | Identity | Operating behavior |
| --- | --- | --- |
| Notification | SHA-256 of the provider scope and exact authenticated body digest | Identical webhook bodies share a receipt with an arrival counter. |
| Canonical event | SHA-256 of network, provider account scope, API base and Mercury row ID | Equal-looking events in one transaction remain separate when their row IDs differ. |
| Customer delivery | Canonical event ID | Every attempt carries the same idempotency key and immutable event envelope. |
| Transaction operation | Transaction hash plus frozen contracts and topic filters, or an explicit operator operation ID | The complete returned transaction is examined; selected canonical rows enter the outbox atomically. |
| Catch-up job | Explicit operator job ID | Contracts, topic filters, inclusive ledger range and page size are frozen when admitted. |
| Catch-up page | Job ID plus the previous committed Mercury event cursor | Events, outbox records, next cursor and next page task commit in one transaction. |

`provider_scope` should name the account or subscription whose rows are being acquired. Reusing a workspace with another network, provider scope, API base or destination raises `WORKSPACE_BINDING_MISMATCH`. Create a separate private workspace for a different binding. Secret rotation uses the same configured environment variable; credentials do not form event identity.

Contract selection and `topic_filters` can change for later work. Every admitted operation retains its original values across a process restart. Reusing an explicit operation or job ID with different inputs returns an input conflict. New work receives a new operation ID.

Topic filters are an AND mapping from `topic1` through `topic10` to exact XDR-base64 strings. A job with `{}` accepts all topic families in its contract scope. The engine applies predicates to canonical rows locally, after fetching the provider page. It advances a catch-up cursor using every row in that original page, including rows outside the selected topic family. The retained response therefore explains both selected and excluded rows.

## Webhook intake and canonical acquisition

Send Mercury notifications to the configured `/webhooks/mercury` ingress. The server passes original request bytes to `Engine.receive_webhook`. The engine verifies `X-Mercury-Signature` as hexadecimal HMAC-SHA256 over those exact bytes before JSON parsing, using the configured webhook secret. The separate `X-Mercury-Timestamp` value is retained as sender metadata.

A valid intake commits its receipt and transaction task before returning acceptance. The notification's `tx_hash` starts a Classic `/events/by-tx/{hash}` read. Its tagged JSON event body remains attached to the receipt; the original provider row supplies canonical XDR, row ID and event index for delivery.

An empty transaction response, or a response with no visible rows from its admitted contract selection, receives `INDEX_NOT_VISIBLE` and automatic retry. This accommodates notification arrival before the index becomes visible. When configured-contract rows are visible but none match the frozen topic family, the operation completes with zero selected events. The full response remains available in the operations export.

A webhook received during an active transaction read increments that task's arrival generation. The current read can complete and retain its successful attempt, then the same task queues another canonical read. The original source and a later arriving event therefore remain attributable even when the new notification lands between the provider response and its database commit.

## Canonical event envelope

Customer destinations receive the following stable shape:

```json
{
  "schema": "mercury-ops.event.v1",
  "event_id": "sha256-hex",
  "network": "mainnet",
  "provider_scope": "configured-account-scope",
  "provider_base": "https://mainnet.mercurydata.app/rest",
  "provider_row_id": 4201,
  "canonical": {
    "id": 4201,
    "contract_id": "the-original-contract-address",
    "tx": "the-original-transaction-hash",
    "event_index": 0,
    "topic1": "the-original-XDR-base64",
    "data": "the-original-XDR-base64"
  }
}
```

The displayed values illustrate the shape. Actual `canonical` objects retain every provider field. Data and topic values remain their original XDR-base64 strings. The engine validates row IDs, addresses, transaction hashes, event indices and aligned base64 values before committing the page. A nullable event index remains null. Acquisition ledger ranges belong to catch-up records; the engine adds no ledger value to a provider row that does not contain one.

An existing row ID returning different canonical content raises `CANONICAL_EVENT_CONFLICT`. The transaction keeps the original canonical event, delivery and cursor. Its failed provider observation is retained for operator inspection. Correct the account/query or reconcile the source discrepancy, then retry the retained task deliberately.

Source links are stored separately from the immutable envelope. Event details expose notification body SHA-256 and provider response SHA-256 along with originating task and attempt. A subsequent catch-up can add provenance to an event without changing the already delivered payload.

## Worker, retry and recovery

`run_once()` acquires the workspace kernel lock, reconciles interrupted attempts, claims one due task durably, performs its original operation and commits its outcome. `run_forever(stop_event)` repeats this behavior. The lock remains held throughout provider or customer network activity. A second process reports `worker_busy` while the original worker is active.

| State | Operator meaning |
| --- | --- |
| `queued` | Retained and ready when its due time arrives. |
| `running` | An attempt is durably recorded and owned by the active worker. |
| `retry` | An automatic retry is due after a retained retryable outcome. |
| `succeeded` | The source or delivery operation finished. Delivery rows show `delivered`. |
| `failed` | The configured retry budget is exhausted or the original error requires correction. |
| `uncertain` | A customer operation could have applied without a durable acknowledgement. |
| `cancelled` | An operator ended this catch-up; its committed pages remain retained. |

Automatic retries use configured exponential backoff and a bounded failure budget. Finite provider or customer `Retry-After` values are accepted up to 86,400 seconds. Invalid and non-finite values fall back to configured backoff. Successful pages and every failed attempt remain separately inspectable.

Recovery starts only after acquiring the same workspace lock. Interrupted source reads can retry. Interrupted SQLite or PostgreSQL deliveries can retry with their original event key; an HTTP destination must explicitly declare idempotency support for automatic replay. Otherwise, recovery records `uncertain` for operator reconciliation. An explicit `retry_delivery(event_id)` records the deliberate continuation while preserving the same event key and attempt history.

Cancelling a catch-up invalidates its active page's commit token. An already running provider response cannot advance the cancelled checkpoint. Completed pages stay available. Submit a new job ID to start a new catch-up query.

## Inspect, export and recover the workspace

The operator lists are paginated using their returned `next_cursor`; the API permits at most 500 rows per page. A task detail shows its most recent 100 attempts. Full operations export includes every retained attempt independently of those interface limits.

`iter_operations_export()` produces versioned NDJSON from one pinned SQLite read snapshot. It contains a header followed by all metadata, notifications, jobs, tasks, attempts, provider observations, canonical events, deliveries and source links. Original body bytes use base64 fields. Its final `complete` record includes counts for every table. The HTTP and CLI default exports use this complete snapshot. `iter_event_export()` produces the immutable canonical envelopes alone when explicitly selected.

Use the operator `backup --out` command to retain the complete operating workspace, then `restore --from ... --into ...` for a new private location. The archive and export contain the actual customer event data and original acquisition bytes; store them in the intended private operating location. Restored tasks keep their original scope, event identity, attempts and cursor progress. Destination acknowledgements and external customer state remain governed by the configured destination's durable idempotency contract.

## Source contracts

The provider implementation follows Mercury's current primary documentation, retained with this project's source acquisition:

- [Classic endpoints](https://docs.mercurydata.app/genaral-info/endpoints): mainnet and testnet API bases.
- [Classic queries](https://docs.mercurydata.app/mercury-classic/queries): bearer-token access.
- [Contract events](https://docs.mercurydata.app/mercury-classic/queries/1.-contract-events): canonical rows, transaction query and event-ID cursor pagination.
- [Webhooks](https://docs.mercurydata.app/mercury-classic/webhooks): raw-body signature and notification fields.

The retained contract-events source is SHA-256 `38c055fb3133e36f9e11469d64d4f032eee0ca9c3cb6c44c27930704534b60db`; endpoint source is SHA-256 `5a88ba85ffc83a4ec65369e29cf7032c0a23a6fe369b0d0f5f86c0a0e7fcc134`.
