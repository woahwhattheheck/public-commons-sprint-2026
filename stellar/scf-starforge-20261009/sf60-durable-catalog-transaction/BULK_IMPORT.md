# Catalog bulk import

SF60 now imports an ordered group of authenticated seller updates and withdrawals as **one atomic catalog transaction**. It uses the existing Bazaar parser, trust boundary, lifecycle history and journal; it does not create a second catalog or payment service.

The local operator workflow is: prepare source rows and separately authenticated seller policies, preview the actual before/after payment terms, apply that exact plan, then query the catalog or reopen after a restart. The read-only HTML review is responsive, printable and contains no scripts or external requests.

## Run

Use Node 22+ in the repository checkout. No installation, credentials, network or hosted Actions is needed by the importer itself. Place private merchant inputs and database state outside the repository and web roots. The parent of each new output directory must already exist.

```sh
ROOT=stellar/scf-starforge-20261009/sf60-durable-catalog-transaction
node "$ROOT/bulk-import.mjs" preview \
  --directory /private/catalog \
  --input /private/batch.json \
  --authorities /private/trusted-sellers.json \
  --out /private/review-001

# Open /private/review-001/review.html locally, or inspect plan.json.
node "$ROOT/bulk-import.mjs" apply \
  --directory /private/catalog \
  --input /private/batch.json \
  --authorities /private/trusted-sellers.json \
  --plan /private/review-001/plan.json

node "$ROOT/bulk-import.mjs" status \
  --directory /private/catalog --plan /private/review-001/plan.json
node "$ROOT/bulk-import.mjs" list \
  --directory /private/catalog --network stellar:testnet --limit 100 --offset 0
node "$ROOT/bulk-import.mjs" search \
  --directory /private/catalog --query weather --limit 20
```

Preview acquires the same single-writer lock as other SF60 operations but does not modify `catalog-commits.json`. It creates only a new private review directory (0700) with `plan.json` and `review.html` (0600). The plan binds the exact input bytes, separate authority file, implementation source fingerprints, original catalog head, normalized operations and resulting head. Any source/policy change requires a fresh preview; an intervening catalog write rejects apply inside the serialized write queue. This is concurrency control, not a new human-approval service or an external authorization policy.

The successful apply response includes `decision: committed`, the resulting head, changed-row count and total journal operations. A batch containing only current exact replays returns `unchanged` without rewriting the journal. An error includes a zero-based `operationIndex` when attributable to one source row; none of its changes are committed.

## Input contracts

### `batch.json`

The following shapes are illustrative. Replace each candidate with the actual admitted native x402 Bazaar entry and retain the original verified source provenance. Do not use an example identity or fingerprint as seller evidence.

```json
{
  "schema": "stellar-forge.catalog-batch-input/v1",
  "operations": [
    {
      "kind": "upsert",
      "candidate": {
        "sellerId": "YOUR_AUTHENTICATED_SELLER_ID",
        "sequence": 1,
        "entry": {"resource": {}, "accepts": [], "extensions": {}}
      },
      "provenance": {
        "authority": "signed_export",
        "sellerId": "YOUR_AUTHENTICATED_SELLER_ID",
        "sourceURL": "https://seller.example/original-export",
        "sourceSha256": "ACTUAL_64_HEX_SOURCE_DIGEST",
        "observedAt": "2026-10-11T00:00:00Z"
      }
    }
  ]
}
```

`entry` above is an intentionally incomplete shape, not a runnable offer. Use the already authenticated original native entry without inventing a recipient, asset, price, signature or source. The existing SF27 and SF21 modules validate the original structure, seller/origin/recipient policy, positive atomic amounts, native resource identity and sequence.

Withdrawal rows use the **original Bazaar catalog key**, not the separate lifecycle key:

```json
{
  "kind": "retire",
  "catalogKey": "http|https://seller.example|/weather||GET",
  "sellerId": "YOUR_AUTHENTICATED_SELLER_ID",
  "sequence": 2,
  "reason": "Seller withdrew this route",
  "provenance": {"authority": "signed_export", "sellerId": "YOUR_AUTHENTICATED_SELLER_ID", "sourceURL": "https://seller.example/original-withdrawal", "sourceSha256": "ACTUAL_64_HEX_SOURCE_DIGEST", "observedAt": "2026-10-11T00:00:00Z"}
}
```

The CLI explicitly rejects `authority` or `signer` fields in a source row. These identities come from the separate operator file, not from a seller-controlled assertion embedded in imported data.

### `trusted-sellers.json`

```json
{
  "schema": "stellar-forge.catalog-operator-authorities/v1",
  "sellers": [{
    "sellerId": "YOUR_AUTHENTICATED_SELLER_ID",
    "signer": "EXISTING_AUTHENTICATED_PUBLIC_IDENTITY",
    "allowedOrigins": ["https://seller.example"],
    "allowedRecipients": ["EXISTING_MERCHANT_RECIPIENT"],
    "allowedNetworks": ["stellar:testnet"],
    "allowedSchemes": ["exact"]
  }]
}
```

This file is privileged configuration prepared by an already authenticated operator. It is **not** cryptographic proof. The importer does not validate signatures, query settlement, acquire trust from a hostname or issue wallet signatures. Reuse the existing admission/withdrawal verification before producing these files. Never place wallet seeds, access tokens or private signing keys here. Merchant source data, payment terms and identities can still be commercially private.

## Application API

```js
const db = await DurableCatalogTransaction.open(privateDirectory);
try {
  // The exact existing ingest and retire arguments, in transaction order.
  const operations = [
    {kind: 'upsert', candidate, authority, provenance}, // authority policy fields are Sets
    {kind: 'retire', ...authenticatedWithdrawal}
  ];
  const review = await db.previewBatch(operations);
  // review.changes contains native before/after terms, identity and sequence.
  const result = await db.commitBatch(operations, {
    expectedHead: review.baseHead,
    expectedPlan: review.planId
  });
} finally { await db.close(); }
```

Both APIs snapshot caller inputs before yielding to the queue. `expectedHead` is mandatory for a batch commit; `expectedPlan` is optional at the library boundary and always provided by the CLI. The exact same normalized input at the same catalog state produces the same plan. Retirements and upserts may be mixed, including a higher-sequence revival after an authorized retirement. A stale version is still rejected, even if that older entry once existed. A *current* byte-equivalent normalized retirement can be a batch no-op; legacy `retire()` semantics are unchanged.

## Atomicity, recovery and limits

All new rows are applied to isolated native projections. If any row fails, nothing is published. On success the original hash-chained journal records are extended, written to a private temporary file, fsynced, renamed and the containing directory fsynced once. Only then does live state switch. There are no observable intermediate catalog revisions. Existing journal schema and single-operation APIs remain compatible; original backups, discovery readers and retirement callers continue to work.

If an I/O failure might have occurred after rename, the original instance becomes unusable and must be closed/reopened. A process crash may leave the existing writer lock; verify that the old writer is gone before manually removing that lock. Never automatically steal it. If apply committed but output was lost, `status --plan` distinguishes `at_reviewed_head`, `at_planned_result` and `changed_since_review`. This reports the current head, not an invented remote receipt. Do not blindly rerun a stale plan; inspect current state and preview any remaining changes.

Each batch accepts at most 1,000 rows and 8 MiB normalized operations. Existing 128 KiB per-operation, 10,000-record total and 32 MiB journal limits remain. CLI input is limited to 8 MiB, authority configuration to 1 MiB, and review files to 32 MiB on read. Larger migrations can use multiple independently atomic batches; they are **not** one cross-batch transaction. Prior history is still rebuilt once per preview/commit and the entire journal rewritten, so this is not an unbounded-scale database. Use the existing single trusted writer on a local POSIX filesystem.

## Focused verification

```sh
node --test "$ROOT/acceptance.test.mjs" "$ROOT/bulk-import.test.mjs"
```

The original acceptance remains unchanged. One additional integrated journey runs a 200-offer native import against sequential ingestion and compares exact journal bytes, then exercises bad-row rollback, exact replay without a file rewrite, contention at one reviewed head, caller mutation, native identity/sequence rejection, price changes, retirement/revival, restart, source-bound CLI apply, and discovery queries. The offers are explicitly fictional development inputs, not merchant captures, payments or competition results. The timing is printed for the executing host; it is not a production performance promise.
