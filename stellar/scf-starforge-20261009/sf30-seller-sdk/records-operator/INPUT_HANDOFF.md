# Records operator — original input contract

Supply the actual records policy, custody, service and invoice sources for the selected operation. The application uses the original reconciliation engine, retaining V1 compatibility and adding the explicit OFFSITE_RECORDS_STORAGE_INVOICE_RECONCILIATION_V2 contract in the same source. CORE_CONTRACT.md defines the complete saved workspace and native API; PRICING_V2.md defines exact quantity, rate, credit and fee arithmetic.

## Choose the actual scope once

Identify one legal entity, one storage provider, one currency and one closed review interval of no more than 90 days. State the original timezone and meaning of every source timestamp. The normalized engine uses whole-second UTC and intervals whose start is included and end excluded. A displayed date without timezone or an invoice month without a charging rule remains a mapping question.

Define the selected universe: sites, accounts, carton population, service classes, source systems and any excluded records. A complete selected partition can be useful; it must not be labelled a complete national account. Provide the actual source export/query and selected record counts so the operator can reconcile the import.

The four ledgers can retain multiple explicit source layouts in each saved edition. A later edition may be an actual subsequent supplied export or a clearly recorded operator correction. Keep that distinction, the original selected scope and the receiving field layout with the saved source. The technical customer-map limit is 100 unique nonempty columns.

## Files to supply

| Input | What the source must establish | Useful original formats |
| --- | --- | --- |
| Executed contract/rate authority | Actual provider/account, currency, sites, rate codes, units, effective dates, event requirements, scope and commercial exceptions | Original agreement/rate card and its machine-readable export |
| Custody inventory | Stable carton ID, site, actual admission and terminal withdrawal/destruction event, and original evidence references | Provider inventory export, barcode register, movement ledger |
| Service events | Actual event ID, time, charge code, quantity/unit, account/carton association, and original supporting record | Retrieval/transport/refile/destruction service export |
| Invoice rows | Stable invoice and row IDs, service date, code, billed quantity/unit/rate/amount, and source event/carton/account references | Original invoice file and AP/provider line export |
| Receiving layout | Customer-owned column names, identifier conventions, accepted types/encoding and actual import method | Original ERP/AP/inventory import template plus one accepted example when available |
| Transition instructions | Selected cohort, expected origin/destination, sequence or wave, ownership of acceptance, and what each checkpoint means | Actual transition plan and successor manifest specification |

The original source file is retained once with its filename, byte length and SHA-256. The source register records who supplied it, when it was obtained, its export parameters, selected period and coverage statement. Hashes bind those bytes; they are not substitutes for the actual provider or agency's source authority.

An operator mapping relates an original column and raw value to a normalized field. Keep the source row locator beside every mapped row. Do not edit the original CSV/JSON/PDF to make an input fit; save a reviewed correction or transformation with its rationale.

## Retained V1 normalized request and explicit V2 extension

The request contains only:

```json
{
  "schema": "OFFSITE_RECORDS_STORAGE_INVOICE_RECONCILIATION_V1",
  "policy": {},
  "custody": {},
  "services": {},
  "invoices": {}
}
```

The empty objects above show the outer structure only; they are not a runnable example or an assertion that missing ledgers are complete.

Every generation contains these common fields:

| Field | Meaning and representation |
| --- | --- |
| `authority_id` | Stable identifier for this supplied generation |
| `entity_ref` | Exact agreed entity ID; equal across all four generations |
| `provider_ref` | Exact agreed provider ID; equal across all four generations |
| `period_start`, `period_end` | Canonical UTC `YYYY-MM-DDTHH:MM:SSZ`; same selected interval |
| `captured_at` | Actual source generation capture time, not an artificial current date |
| `complete` | Boolean describing completeness of the declared source partition |
| `evidence` | Object with exact keys `evidence_ref` and `evidence_sha256` |

The engine's opaque references match `[A-Za-z0-9][A-Za-z0-9._:-]{0,95}`. Currency is three uppercase letters. Charge and unit codes match `[A-Z0-9][A-Z0-9_-]{0,47}`. Preserve original identifiers separately when a deterministic mapped ID is needed; a display name is not a safe join key. Evidence hashes are lowercase 64-character SHA-256 values of the actual referenced source.

### Policy generation

Additional fields are `currency`, `max_authority_age_days`, `sites` and `rates`.

| Collection | Exact row fields |
| --- | --- |
| `sites` | `site_ref`, `active_from`, `active_until` |
| `rates` | `charge_code`, `unit`, `scope`, `rate_minor`, `event_required`, `effective_from`, `effective_until` |

End dates may be null when the original authority has no terminal bound. `scope` is `CARTON` or `ACCOUNT`; `event_required` is boolean. `max_authority_age_days` is the original policy value, from 1 through 3,650. An operator must not invent a new date/age policy to turn an old authority into a current one.

The source must yield one effective rate for an applicable charge-code/unit/time. Ambiguous or conflicting effective rates need source interpretation, not arbitrary first-row selection. Preserve an actual exception, discount or amendment as a separate authoritative source.

### Custody generation

The collection is `cartons`:

| Field | Meaning |
| --- | --- |
| `carton_ref`, `site_ref` | Stable carton and storage site identifiers |
| `admitted_at` | Actual start of the recorded custody interval |
| `terminated_at` | Actual terminal event time, or null |
| `termination_kind` | `WITHDRAWN`, `DESTROYED`, or null consistently with the record |
| `evidence_ref`, `evidence_sha256` | Original source for this custody record |

Temporary retrieval/return is a service sequence, not automatically terminal withdrawal. Re-entry, duplicate carton identifiers, changed locations and file/folder hierarchies require an explicit mapping appropriate to the original source. Keep the source movement history even when the engine's selected carton model cannot represent every step.

### Services generation

The collection is `events`, with exact fields:

`event_id`, `site_ref`, `carton_ref`, `charge_code`, `occurred_at`, `quantity`, `unit`, `evidence_ref`, `evidence_sha256`.

Account-scoped services can have null site/carton fields when the actual contract says so. Carton-scoped services require the appropriate stable binding. A name match or equal amount does not create an event relationship. Preserve IDs from the source; if a mapping must create an internal reference, retain the original ID and mapping record.

### Invoices generation

The generation adds `currency` and a collection named `rows`. Each row contains:

`row_id`, `invoice_ref`, `site_ref`, `carton_ref`, `event_id`, `charge_code`, `service_at`, `quantity`, `unit`, `rate_minor`, `amount_minor`, `evidence_ref`, `evidence_sha256`.

Null entity references must follow the actual charge scope and event rule. Retain the billed amount rather than replacing it with quantity × rate; that difference is material to reconciliation. A posted invoice is not proof that cash was paid. Credit notes, write-offs and settlements remain distinct source records with their actual status.

## Money, units and quantity interpretation

The unchanged V1 contract accepts nonnegative integer minor-unit rates/amounts and positive integer quantities. For the current operating workflow, use V2 and supply `policy.minor_unit_digits` plus an explicit `policy.rounding_mode`. Quantities and rates accept unsigned exact decimal text with up to 18 fractional places; quantities must be positive. Billed amounts remain signed integer minor units. Each normalized value and summed amount stays within `9007199254740991`.

V2 rates declare `pricing.kind` as unit, fixed, graduated, volume or percentage, with optional integer `minimum_minor`/`maximum_minor`. Tier boundaries and tier rates remain exact decimal text. Percentage policies declare the percentage, included charge codes and INVOICE/PERIOD basis scope; invoice lines name the exact included `basis_row_ids`. Source tax and nonqualifying lines stay outside that basis unless the actual contract explicitly includes them.

A credit has `line_kind:CREDIT`, a nonpositive amount, positive credited quantity and an exact `credit_of` original CHARGE ID. A prior-period original can be retained with `row_role:REFERENCE`, so it supports the credit without becoming current billed sales. The policy must declare CONTRACT_QUANTITY or ORIGINAL_PROPORTION; the latter reverses the original amount proportionally without applying a minimum twice. Cumulative excess or unresolved original pricing remains a review finding.

EXACT retains a fractional-minor-unit result for review; HALF_UP, HALF_EVEN, DOWN and UP apply only the supplied rounding convention. The calculation retains its exact rational value and any rounding effect. No automatic FX, proration, tax-rate discovery or unit conversion is assumed. Preserve original cubic feet/hours and source price text instead of changing units to make input admissible.

An empty supplier-price cell is unknown/unpriced. It is neither zero nor permission to use a rate from the old example. A source contract discount is not our service fee. A review value is not a savings forecast.

## Limits and larger source delivery

The exact original engine accepts up to 2,500 cartons, 10,000 service events, 10,000 invoice rows, 100 sites and 512 rates for one period. Its original file reader limit is 12 MiB. The maintained native workspace retains at most 8 MiB per source file, 32 MiB and 512 files per revision. Native previews are at most 1 MiB; the same processor streams complete handoffs outside that preview bound.

For a larger customer export, retain the complete source and define complete, reproducible partitions by actual account/site/period or a customer-approved key range. Include the whole-source identity, partition selection, row count and any continuation index. Never silently take the first N rows and label that the customer account.

The included commercial scope is a complete selected operating use case within these original limits. Any larger-volume engineering should be priced against the actual source size, unit model and receiving-system constraints.

## Saved mapping, correction and review

The operator should be able to inspect the original file and row alongside its normalized fields, retain a mapping, and save an input revision. A correction records the prior raw value, corrected normalized value, affected source row/field, reason, author and time. A later source export is retained as a distinct source edition. An operator correction is not mislabelled as a new provider export.

Run the original engine against the accepted normalized generations and retain their roots with the resulting packet. Show the selected evaluation mode, time, period, original input revision and unresolved source problems. Do not erase source mismatches to make a green status.

Findings and reviewer decisions are different records. The application needs an explicit disposition, reviewer, note and supporting reference. Keep an unresolved or disputed finding in the final operator report. A “reviewed” decision does not change the original billed amount or authorize payment.

The original engine deduplicates identical same-ID rows and rejects conflicting same-ID content. Different invoice IDs with equal economics remain a finding; the operator resolves them against actual source documents rather than collapsing them by name or price.

## Transition and customer export

Define the transition cohort by actual stable IDs. Preserve carton/file level, origin and destination, selected source edition, current custody interpretation, remaining exceptions and the responsible reviewer. A wave assignment and a planned acceptance date are plans. Actual departure, receipt, destruction and final acceptance require their actual supplied records.

The customer projection uses the agreed column names and field paths. Include source edition and stable identifiers when the receiving system permits. Preserve unmapped/missing fields explicitly and compare the customer row count to the selected normalized population. The operator package retains all originals and history; the customer package contains the agreed export and readable field/interpretation guide.

The original source engine does not contain an ERP connector or a national physical-records platform. A file accepted by the customer's normal importer is a useful completed handoff. An unperformed live API submission is not reported as delivered into that system.

## Cooperative reporting inputs

Use the actual governing agreement to establish the fee percentage, qualifying billed sales, tax treatment, credit policy, reporting calendar, agency identifiers, remittance timing and required output fields. The generic application does not supply a contract percentage or reporting deadline.

Supply the actual supplier and contract identifiers, lead-agency and purchasing-agency IDs, qualifying billed sales, tax separation, credit treatment, explicit rounding and IANA reporting timezone, selected month and the required receiving template. Preserve any original workbook cell/form instructions with that source. A reference document is not an actual agency roster or invoice stream.

The original handoff retains these reporting inputs and prepares the configured receiving columns. Ongoing remittance, portal submission, payment collection and a new live integration require their actual configured operation; a calculation is not a submission or payment receipt.

## One complete acceptance journey

A complete source-to-receiving operation follows this sequence:

1. Open the supplied originals, load the agreed mappings and see the selected counts, period and unresolved source values.
2. Save the first named revision; run the original reconciliation and inspect representative flagged/matched records with their true source context.
3. Enter the agreed correction, save the second revision and observe the actual change in the original result without losing the first.
4. Record reviewer decisions and prepare the selected transition manifest and customer/AP export.
5. Export the complete operator package, reopen it using the original application and reproduce the same selected customer output with source and review history retained.

The recorded result describes the selected source operation and delivered files. A finding is not collected cash, a draft response is not a supplier certification, and a planned or digitally accepted transition is not a physical carton movement. Actual commercial acceptance, account obligations and physical services remain with their named parties.
