# Agency cost allocation and bill-back

Agency billing runs inside the existing Commons BI Migration Operator. It retains original cost and usage files, applies an explicit agency allocation policy, prepares a monthly review, and produces a complete agency statement handoff. It uses the same workspace identity, version history, operation recovery, loopback host, structured CLI and encrypted backup as the report migration and support workflows.

The SANDAG/ARJIS source brief identifies the later cloud phase and twelve-agency usage/cost allocation and bill-back. That scope is recorded in [the original solicitation brief](examples/sandag/SOLICITATION_SCOPE.md). The customer's billing agencies are explicit workspace entities. The public report example's crime-report jurisdictions remain geographic data.

## Start and complete the supplied operating example

Use the dependencies and Python version in [README.md](README.md). From the operator directory:

    python BI_OPERATOR.py --workspace ./billing-example billing-example
    python BI_OPERATOR.py --workspace ./billing-example serve

Open the complete private localhost address printed by the original host. Select **Agency billing**. The example has twelve named example agencies, 83 cost rows, 36 usage rows and sixteen rules. It includes direct resources, shared reporting by runs, shared storage by GB-months, shared support by agreed weights, a prior-usage refund, invoice-scope rounding, small costs and Azure's internal allocation rows.

All agency identities, usage quantities, costs and policy choices in examples/billing are Commons-authored software example inputs. Native Azure column names and the original product's operating contracts are used.

The loader performs separate stable original actions. Repeating it reopens the same input records and the current period, including any completed staff review or correction. It does not reset the operator's edits.

Open the prepared draft, inspect its agency totals and full source rows, add a review note, record the review, and finalize. Build the statement handoff and open the accounting workbook and agency HTML/CSV files. Use **Open correction** to retain a reason and prepare a restatement of the same period. Every finalized statement revision remains available.

## 1. Define the receiving agencies

Under agencies, enter each agency's billing name, finance-system code and optional notes. The workspace ID distinguishes agencies even when their display names or finance codes are similar.

Use actual client-authored payer identities and agreed allocation terms for a working case. The number of agencies is not a default equal split. Direct policies identify one agency; fixed policies use the approved weights; usage policies use the selected original quantities.

An agency can be made inactive for future policy selection. Existing policy and period snapshots retain their selected agency revisions and names. A period is reproducible after later agency edits.

The structured action is billing.agency.save:

    {
      "operation_id": "agency-north-2027-01",
      "id": "agency-north",
      "label": "North agency",
      "code": "FIN-104",
      "active": true,
      "notes": "Finance-system billing identity."
    }

For an edit, supply the existing ID and its expected revision. A stale revision returns a conflict instead of replacing a newer staff edit.

## 2. Import the original monthly cost export

Import a complete UTF-8 or BOM-marked UTF-16 CSV. A ZIP may contain complete CSV partitions; original member names and bytes remain retained. The original host and object store accept up to 64 MiB per input, including expanded ZIP content, with up to 250,000 data records per import. Larger estates can retain separate original partition imports and select their intended monthly scope.

Choose:

- Billing month in YYYY-MM form.
- Actual or amortized cost basis.
- Supplier or existing allocated view.
- Provisional or closed supplier period.
- Optional invoice reference.

The default field mapping recognizes current Azure cost-detail names and their usual aliases. Explicit mappings must refer to actual headers. Native mapping fields are:

| Field | Native/default source |
|---|---|
| amount | CostInBillingCurrency, Cost, PreTaxCost |
| currency | BillingCurrency, BillingCurrencyCode, Currency |
| resource_id | ResourceId, InstanceId |
| resource_group | ResourceGroup, ResourceGroupName |
| subscription_id | SubscriptionId, SubscriptionGuid |
| service | ConsumedService, ServiceName, MeterCategory |
| date | Date, UsageDateTime, UsageDate |
| charge_type | ChargeType |
| tags | Tags |
| billing_period_start | BillingPeriodStartDate, BillingPeriodStart |
| cost_allocation_rule | CostAllocationRuleName |
| invoice_id | InvoiceId |
| description | ProductName, MeterName, Description |
| billing_account_id | BillingAccountId, AccountId |
| billing_profile_id | BillingProfileId |

Map a field to an empty string to omit an optional source column explicitly. Amount and currency are required. Billing-period dates default to ISO forms; the structured date_format option also accepts month_first or day_first for a deliberately selected regional format.

The import checks a supplied billing-period column against the selected month. A usage or purchase date can fall outside that month, as with a later refund. The importer retains it and does not silently filter it away. If the source has no billing-period column, the saved import identifies the operator's selected month as its explicit scope.

Amounts remain signed, finite decimal strings. Negative refunds, zero-cost resource usage and blank-resource billing-level adjustments remain in the source. Malformed tag text is retained through the original file and marked for review when a tag rule would need it.

### Cost meaning and Azure's internal allocation rows

Microsoft defines CostInBillingCurrency and its cost aliases as cost before credits and taxes. This workflow labels that basis throughout the period and statements. A separate manual adjustment can record a documented credit, tax or agreed correction without rewriting the supplier's source amount.

**Supplier view** retains every original row and excludes rows bearing CostAllocationRuleName from the agency-allocation calculation. These are Azure's internal negative-source/positive-target reallocations. The excluded rows remain visible in the complete calculation and source handoff.

**Existing allocated view** includes those rows with their signs. Use it when the supplied scope intentionally represents Azure's already allocated cost view. A period combines only one chosen view, one currency and one actual/amortized basis.

The original supplier export may acquire additional charges and rounding adjustments when its invoice period closes. The saved provisional/closed status travels with the statement. Internal statement finalization preserves the selected edition; it does not change the supplier's invoice status.

### Original row identity and repeated exports

Every data record in a source remains distinct. The source container hash, CSV member name and data-record ordinal identify it. Byte-identical named members within one original ZIP still contribute their separate records.

Selecting overlapping original exports can double count costs or usage. Repeated selected IDs are rejected. Exact repeated CSV partitions across separate selected imports require an explicit allow_duplicate_partitions selection and a retained duplicate_partition_note explaining why the records are distinct. No importer silently drops duplicate-looking cost rows.

Use the newest complete monthly export in place of the earlier complete export when that is the supplier's revision model. Use several imports when they are distinct partitions or separately scoped accounts. The workspace preserves both choices and all prior editions.

## 3. Import agency usage

Usage is a separate retained CSV or partition ZIP with:

| Field | Meaning |
|---|---|
| agency_id | Explicit workspace billing agency ID |
| usage_key | Exact resource ID or a named shared allocation pool |
| quantity | Nonnegative decimal quantity |
| metric | One declared unit, such as runs, cpu_seconds or gb_months |
| period | Optional row-level YYYY-MM; must match the selected import period |
| source_id | Optional original report source ID; pins its current source revision |

A usage rule selects one metric and resource/pool. Quantities with a different metric never enter its denominator. Report runs and CPU seconds can coexist in the same source without being mixed.

An unknown agency ID is retained in the usage input and shown for definition. A calculation that actually needs that recipient keeps the corresponding cost row unresolved until the agency is defined. A supplied source_id must refer to an existing original report source, so the association is navigable and versioned.

## 4. Save an ordered allocation policy

The rule builder supports direct, fixed and usage rules. The first matching rule owns a cost row. The saved order is part of the policy version.

A match can combine resource_id, resource_prefix, resource_group, subscription_id, service, charge_type, billing_account_id or billing_profile_id. Resource and service matching is case-insensitive; tag rules compare the explicit tag key and value. An empty match is an intentional catch-all. Put such a rule after more specific rules.

- **Direct:** the complete row goes to one selected agency.
- **Fixed:** weights are normalized over the selected agencies. They can be percentages or another agreed proportional basis; a positive total is required.
- **Usage:** quantities from the selected month, metric and resource/pool determine the shares. An empty rule usage_key uses the cost row's resource ID.
- **Explicit usage fallback:** optional fixed shares apply only when the selected driver has no positive usage. Without a fallback, the cost remains in the review queue.

A zero-cost source row needs no paid allocation. A nonzero source amount that rounds to zero statement cents still needs a matching rule. The review queue uses the row's explicit reason, not the displayed rounded amount.

Each policy version retains the agency revisions used by its direct and fixed rules. Usage recipients are pinned when the selected period is calculated.

A structured policy example:

    {
      "operation_id": "policy-2027-01",
      "label": "Reviewed report platform allocation",
      "rules": [
        {
          "id": "dedicated-north",
          "label": "North dedicated resources",
          "match": {"tag_key": "agency", "tag_value": "agency-north"},
          "method": "direct",
          "agency_id": "agency-north"
        },
        {
          "id": "shared-reporting",
          "label": "Shared reporting by runs",
          "match": {"service": "Microsoft.Sql"},
          "method": "usage",
          "metric": "runs",
          "usage_key": "shared-reporting"
        }
      ]
    }

## 5. Prepare the monthly allocation

Choose the policy revision and exact cost/usage inputs. Select the currency's statement decimal places, zero through four. The operator calculates all selected rows and displays agency totals, original source amounts, assigned rules, usage weights, statement amounts and unresolved reasons.

The period pins:

- All selected input IDs and revisions.
- Policy ID and revision.
- Agency identity, name, finance code and revision.
- Exact original amount and allocated amount per source row.
- Manual adjustments and their source explanations.
- Provider cost basis, allocation view, supplier period status and currency.
- Complete calculation object and original source references.

Add an adjustment with a stable local ID, signed amount and source description. Assign it directly to an agency or let its resource/charge type select the normal policy. The adjustment remains separate from the original cost file.

Save changes on the current draft with its expected revision. A recalculation creates a new revision of the same period. A reviewed or finalized period is opened explicitly for correction first, preserving its previous review and statements.

### Rounding that reconciles

The source precision is retained. The calculation uses a 64-digit decimal context.

The complete source-plus-adjustment total is rounded once to the selected currency precision using half-up rounding. Individual row minor units are assigned by their largest fractional remainder, with original row ID breaking ties. Each signed row amount is then divided by its agency weights using largest remainder and agency ID as a stable tie-breaker.

As a result, allocated agency totals plus the unresolved amount equal the complete rounded monthly total. Tiny source costs remain part of that total. Refunds keep their negative sign. The source-to-statement rounding difference remains explicit per row and for the complete month.

## 6. Review, finalize and restate

Resolve every row with an unallocated reason by changing its policy, usage input, agency definition or documented adjustment. Save a recalculated draft. Record the review and note against that exact calculation, then finalize it.

Finalization records the actor and time for the internally selected statement edition. It does not send messages, change a supplier account or collect money.

For a later export or correction, open the existing period with a reason. The same period becomes a draft. Its previous finalized revision remains intact; the new statement records the revision it supersedes. Replace the selected complete input or add a distinct adjustment, recalculate, review and finalize. An earlier finalized revision can still be exported through the structured action using its revision number.

## 7. Deliver the accounting handoff

Build the finalized statement handoff. Repeating that action returns the same stored delivery for the same finalized period revision.

The ZIP contains:

| File or directory | Content |
|---|---|
| statements/<agency-id>/statement.html | Printable, neutral agency statement with original row references and total |
| statements/<agency-id>/statement.csv | Complete agency allocation lines |
| accounting/agency-totals.csv | All agency totals and finance codes |
| accounting/allocation-lines.csv | Every allocation, rule, driver weight and source reference |
| accounting/source-costs.csv | Original high-precision amounts, statement amounts and row rounding |
| accounting/monthly-allocation.xlsx | Summary, agencies, allocation lines and source costs |
| sources/ | Every selected original CSV/ZIP and its normalized records |
| imports.json | Exact input editions, mappings, warnings and original file identities |
| policy.json, agencies.json | Retained policy and payer definitions |
| period.json, calculation.json | Complete finalized period and allocation, including excluded provider rows |
| MANIFEST.json | Every handoff member's byte length and SHA-256 |
| OPEN_FIRST.md | Receiving and interpretation instructions |

Spreadsheet formula-like text is encoded as literal text in CSV. Original normalized JSON retains its exact text. The workbook preserves source precision as text; currency allocation cells within Excel's fifteen-digit numeric precision are ordinary numeric values. Larger values remain exact text. The generator uses the Python standard library and adds no spreadsheet dependency.

The selected handoff contains the final period and its source closure. Use the original **Handoff & recovery** workflow for an encrypted backup containing all periods, drafts, revisions, sources, provider records and original operations. Restore into a new path; the original archive code verifies its object closure and rotates the browser token while preserving the business identities.

## Structured actions and recovery

Every action is available through the original endpoint:

    POST /api/action/<action-name>

and original CLI:

    python BI_OPERATOR.py --workspace ./working-case action billing.period.prepare request.json

Use a stable operation_id for the intended action. The original dispatcher records its request, result and operation state. Replaying the same request reopens its saved result. Reusing an operation ID with different input is rejected. The browser's **Retry original request** uses that original operation and selects the returned saved record after recovery.

| Action | Required operating input |
|---|---|
| billing.agency.save | Agency label; optional stable ID, finance code, active flag and notes; ID/expected for edit |
| billing.cost.import | Complete file/base64, billing period, selected basis/view and supplier status |
| billing.usage.import | Complete file/base64, period and optional original column mapping |
| billing.policy.save | Label, ordered rules; ID/expected for edit |
| billing.period.prepare | Period, policy ID/revision, cost/usage import IDs, adjustments, currency precision; ID/expected for draft edit |
| billing.period.review | Current period ID, expected revision and review note |
| billing.period.finalize | Current reviewed period ID, expected revision and finalization note |
| billing.period.reopen | Reviewed/finalized period ID, expected revision and correction reason |
| billing.period.export | Finalized period ID and optional exact revision |

Current state includes billing_agency, billing_import, billing_policy, billing_period and billing_delivery. Use the original entity/history routes for full records and revisions. Original and generated files use the same authenticated object download route as the rest of the product.

## Primary input references

The Microsoft source contracts used by the importer and allocation design are:

- [Understand cost details fields](https://learn.microsoft.com/en-us/azure/cost-management-billing/automate/understand-usage-details-fields): billing amount/currency aliases, actual usage dates and billing periods, record uniqueness, refunds and invoice-scope rounding.
- [Create and manage Azure cost allocation rules](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/allocate-costs): internal source/target allocation rows, CostAllocationRuleName, supplier invoice reconciliation and organizational chargeback.

The original issuer brief and original public SANDAG report source remain in examples/sandag. Customer source selection, agency identities and agreed allocation policies belong to their own working case.
