# Use a saved pricing decision in merchant accounting

Import the original SF97 pricing report to use its exact payment options, USD
quotes and per-fulfilled costs in the existing merchant accounting engine and
workspace. The import keeps the complete original report and the assumptions
behind the pricing decision.

## Save the pricing decision

Use the [merchant pricing workspace](../sf97-merchant-revenue-ops/WORKSPACE.md)
to review the merchant's current session or retained history, enter the
commercial assumptions, and save a version. Download **Report JSON** from that
saved version, or use its private `versions/VERSION/report/report.json` file.

Select the original report, not `terms.json`. Both pricing files use the SF97
schema name, but the report contains the normalized payment options, source
hashes and calculated route values needed by this import.

## Create the accounting import

From a source checkout:

```sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/pricing-cli.mjs \
  --report /private/merchant/pricing/versions/VERSION/report/report.json \
  --out /private/merchant/pricing-import-2026-10-11
```

Use an absolute path to a new output directory whose parent already exists.
The command validates the entire selection before creating that directory. It
does not replace an existing import. The resulting directory is private
(0700), and each file is private (0600):

| File | Purpose |
| --- | --- |
| `accounting-terms.json` | Validated original accounting terms, including the pricing source and commercial context |
| `pricing-report.json` | The exact original report bytes, including all option metadata and observation detail |
| `manifest.json` | The original report and generated terms identities, sizes and import summary |

The command prints the generated terms path, original report hash, terms hash,
route and option counts, unknown-cost option count, and selected source range.
Keep the import directory with the pricing and accounting review it supports.

### Preserve a long or descriptive quote basis

Pricing accepts a descriptive quote basis up to 300 characters. The original
accounting format uses a shorter reference: 3–100 letters, numbers, spaces or
`_ . : / -`. If a pricing basis cannot be used directly, provide the accounting
reference explicitly:

```sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/pricing-cli.mjs \
  --report /private/merchant/saved-pricing-report.json \
  --out /private/merchant/pricing-import-2026-10-11 \
  --reference "Approved merchant quote October 2026"
```

The reference applies to the imported options. Every full original route basis
is retained in `pricingProvenance.routes`, and the complete report stays beside
the generated terms. Text is never shortened or silently substituted.

## Use the original accounting workspace

For an existing workspace, open **Sources & imports**, select
`accounting-terms.json` under **Merchant accounting terms**, and choose
**Import & select terms**. Capture a new reconciliation from **Reconcile &
review**. Earlier runs keep their own original terms and source snapshots, so
the existing comparison can show the effect of the changed pricing decision.

For a new workspace:

```sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/server.mjs \
  --workspace /private/merchant/accounting-workspace \
  --outbox /private/merchant/sf98-outbox \
  --proof-dir /private/merchant/sf86-results \
  --terms /private/merchant/pricing-import-2026-10-11/accounting-terms.json
```

Reopen that directory with `--workspace` alone. The [accounting workspace
guide](workspace/README.md) covers source selection, reconciliation, review
notes, comparison, retained exports and restart.

The original accounting CLI consumes the same imported terms:

```sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/cli.mjs \
  --outbox /private/merchant/sf98-outbox \
  --proof-dir /private/merchant/sf86-results \
  --terms /private/merchant/pricing-import-2026-10-11/accounting-terms.json \
  --out /private/merchant/new-accounting-review
```

## What is mapped

Every original payment option becomes one accounting option in source order.
The original `compileTerms` implementation validates each option and the
complete result.

| Original pricing report | Accounting terms |
| --- | --- |
| `routeId`, `method` | The same route and method |
| `paymentOptions[].network`, `asset`, `payTo` | The same network, asset and recipient |
| `paymentOptions[].atomicAmount` | `amountAtomic`, unchanged as a decimal string |
| `quoteUsd` | `unitPriceUsd`, unchanged |
| `variablePerFulfilledUsd` | `unitCostUsd`, unchanged; unknown remains `null` |
| `priceBasis` or the explicit accounting reference | `priceBasis` |

SF97 applies one commercial quote and fulfillment-cost schedule to all
configured alternatives on that route. The import preserves that scope. It
does not choose the first option, derive an exchange rate, or allocate request
counters to a particular payment option.

The original accounting limits still apply: at most 200 distinct options,
supported Stellar networks and exact payment schemes, accounting-compatible
asset/recipient addresses, and its existing decimal precision and input-size
limits. A rejected option identifies its route and index. Duplicate accounting
identities fail as a complete selection; no option is silently removed.
Nonpayable example asset or recipient markers must be replaced in the
merchant's actual seller configuration before producing an accounting import.

## Retained context

`pricingProvenance` retains the original seller, commercial-terms and observation
hashes; the exact report hash when original bytes are supplied; merchant and
generation identity; session or retained-period range; the full original quote
bases; monthly targets; challenge costs; and shared fixed costs. The original
report file retains the complete source detail.

The retained pricing range describes the pricing observation. The
reconciliation's event scope comes from its selected native journals and
verification inputs.

Only the route quote and per-fulfilled variable cost become unit accounting
terms. Shared monthly costs, payment-challenge costs, monthly demand targets and
HTTP traffic remain pricing context. The existing settlement engine determines
which native events and independent network verifications match the imported
payment terms.

## Application integration

```js
import {
  createAccountingTermsFromPricingReport,
  preparePricingReportImport,
  writePricingReportImport,
} from './merchant-settlement-accounting/pricing.mjs';

// For a parsed original report. No original-byte hash is inferred.
const terms = createAccountingTermsFromPricingReport(report, {
  accountingReference: 'Approved merchant quote October 2026',
});

// For the exact file bytes or UTF-8 JSON received by an operator interface.
const prepared = preparePricingReportImport(originalBytes, {
  accountingReference: 'Approved merchant quote October 2026',
});
// prepared: terms, reportBytes, termsBytes, reportSha256, termsSha256, summary.
// Retain reportBytes and termsBytes together, using the existing private store.

// Complete create-only filesystem import used by the CLI.
const imported = await writePricingReportImport({
  reportFile: '/private/merchant/saved-pricing-report.json',
  outputDirectory: '/private/merchant/new-pricing-import',
});
```

These functions perform no payment or provider operation. The pure mapping
returns a new object without changing the input report. The byte preparation
retains exact source bytes; the filesystem writer adds regular-file, size,
stability and private-output checks. A changed saved report fails before
publication of an import.
