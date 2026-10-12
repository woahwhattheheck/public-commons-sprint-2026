# Customer service period statements

Use two retained exports of the same original API pass to explain the service activity between them. The customer document keeps the original purchase, complete opening and closing balances, route totals, call changes, earlier reservations and recovered results.

## Operate the workflow

1. Open **Customer statements** in the existing merchant accounting workspace. Select the customer and assign the original purchased order reference.
2. Retain the complete opening API-pass export under **Import service usage**, then retain the later closing export. Keep both actual returned import IDs. The original exporter is documented in the [native API-pass component](../../sf101-merchant-receiver/api-access/README.md).
3. Choose **Activity between two native snapshots** in statement preparation. Select the closing capture and the opening native capture. **Inspect service period** opens their interval, balances, route totals and activity before an accounting report is needed.
4. Select the original completed accounting run containing the customer's purchase. Leave the recorded-purchase dates empty when the prepaid purchase happened before the service period. Purchase dates and service snapshot dates are separate selections.
5. Choose **Prepare statement**. Review the original purchase and transfer outcome, allowance movement, newly consumed or released work, recovered results and earlier calls still reserved.
6. Choose **Retain statement**. The existing register assigns a number and freezes the reviewed source pair with that customer and accounting projection. Download the customer document and complete files from the same retained entry.
7. To correct a source selection, open the document and choose **Prepare correction**. The original opening and closing IDs and purchase selection return to the form. Retaining the correction links the editions through the existing replacement history.

Reopen the same accounting workspace after a restart to continue these records. The existing process, private state, lease, customer assignments and retention requests own the operation. The maintained merchant-accounting and merchant-receivables source selections include the new module through their original complete accounting component.

## Select the actual observation interval

The opening source's capture timestamp is the displayed start; the closing source's timestamp is the displayed end. The closing observation must be later and must preserve the original order, event, entitlement, plan, payment identity and purchased allowance.

The calculation compares complete native database snapshots, using their membership and durable call states. Call admission and update timestamps remain their native timestamps. A later cumulative capture is not cut into an inferred earlier period.

For a calendar cycle, retain opening and closing exports at the intended reporting boundaries and review their actual times. A later capture describes that later observation. Existing captures remain useful for their actual interval.

The aggregate service-usage format remains available for cumulative statements. Period activity requires complete native call histories in both original API-pass exports.

## Read allowance movement

| Value | Meaning |
| --- | --- |
| Opening and closing balances | Original purchased, consumed, reserved and available units at each snapshot |
| Admitted units | Original route units for calls present at closing and absent at opening |
| Consumed units | Newly consumed allowance, including earlier reserved work that completed or was reconciled as performed |
| Released units | Allowance released from new or previously reserved calls |
| Results recovered | Original results attached to previously consumed work, with its consumption counted once |
| Carried reservations | Opening calls still reserved at closing |
| Unchanged calls | Opening calls whose durable metadata is unchanged at closing |

All unit calculations use exact integers and conserve the same purchased allowance:

- Closing consumed = opening consumed + consumed during the interval.
- Closing reserved = opening reserved + admitted − consumed − released.
- Closing available = opening available − admitted + released.

Every route retains its purchased method, path and unit price. Reserved and available deltas keep their signs. A completed native HTTP application error can still consume allowance; the original stored outcome determines that treatment.

A clock-derived display change from in-flight to recovery-required leaves the durable outcome and units unchanged. A native `CONSUMED` → `COMPLETED` recovery attaches the original result with zero additional consumed units.

Opening calls cannot disappear from the closing snapshot. Original request identities and terminal outcomes cannot be rewritten, and call revisions cannot move backward. A source-pair mismatch identifies the original continuation that needs to be selected.

## Download the complete statement

| File | Contents |
| --- | --- |
| `statement.html` | Standalone printable purchase and service period document |
| `statement.json` | Full retained customer document, period, balances, route totals, activity and closing call history |
| `statement.csv` | Original purchases and closing balances |
| `usage.csv` | Complete closing call history |
| `period.csv` | New and durably changed calls plus carried reservations, opening/closing states, source hashes and signed unit movement |
| `period-summary.csv` | Per-route opening/closing counts, allowance movement and result recoveries |
| `usage-opening.json`, `usage-closing.json` | Complete customer-safe usage projections with their original retained source references |
| `manifest.json` | Exact retained file bytes and SHA-256, report identity and source-pair identity |
| `status.json` | Current register status and history, generated when downloaded |

The source projections contain request metadata and response hashes. Internal recovery notes, raw response bodies and private access material stay in the merchant workspace. Each projection has its own file hash and identifies its original import through `source.sha256`. The original imported bytes remain in the accounting workspace inputs for merchant recovery.

Period activity is paged in groups of 50 in the browser. Downloads contain the complete selected population. The closing history preserves unchanged completed historical calls as well.

## CLI and HTTP

Import both original captures with the existing `usage-import` command. A period selection identifies the actual returned imports:

~~~json
{
  "usageOpeningId": "OPENING_IMPORT_UUID",
  "usageId": "CLOSING_IMPORT_UUID"
}
~~~

~~~sh
node customer-statements/cli.mjs usage-period \
  --workspace /absolute/merchant-accounting-workspace \
  --input period.json
~~~

For a customer document, add the customer's actual `customerId` and original `runId` to that selection and call `preview`. Optional `from` and `until` select original purchases; optional `replacesId` selects a retained document for the same customer.

~~~sh
node customer-statements/cli.mjs preview \
  --workspace /absolute/merchant-accounting-workspace \
  --input selection.json
~~~

Pass the returned exact selection to `retain` with its `previewSha256`, current `revision`, operator `actor` and stable `requestId`. An exact retry returns the same retained document. A changed source pair needs a fresh reviewed preview and request.

| Method | Route | Request |
| --- | --- | --- |
| POST | `/api/customer-statements/usage-period` | `{usageOpeningId, usageId}` |
| POST | `/api/customer-statements/preview` | Existing selection plus optional `usageOpeningId` |
| POST | `/api/customer-statements/retain` | Exact reviewed selection plus existing retention fields |

Use the existing retained-file route or CLI to download:

~~~sh
node customer-statements/cli.mjs export \
  --workspace /absolute/merchant-accounting-workspace \
  --id RETAINED_STATEMENT_UUID --file period.csv \
  --output /absolute/new-customer-period.csv
~~~

The original immutable-input checks, preview hash, revision checks, request recovery, staged file writes, manifest and register status apply to the period files.
