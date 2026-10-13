# Complete source contracts

## Shared original input

Every input includes:

| Field | Meaning |
| --- | --- |
| kind | retail-payout-reconciliation or odoo-contact-import-preparation |
| source.publisher | Actual customer/source-system owner |
| source.url | Original service/export source URL, with credentials omitted |
| source.title | Human-readable selected source |
| source.selection | Exact store/account/window or database/export selection |
| source.retrievedAt | Original timezone-qualified retrieval time |
| complete | true after all pages/files in the stated selection are retained |

Additional original fields are preserved. source.originals can contain complete original response bodies, requested URLs without credentials, page cursors and actual response identities. Preserve all fields needed to resume and explain the source; omit secret values.

The complete original input file is retained byte for byte. Its parsed content is separately bound by canonical JSON SHA-256. Every successor preserves the old input and chooses a new output directory.

## Retail: Shopify Payments

The complete input adds policy, balanceTransactions, payouts and orders. These arrays contain the original selected objects, including any additional original fields. Use the selected GraphQL API version and the customer's existing authorization.

policy.currencyScale maps each actual currency code to its reviewed decimal scale. Do not assume every currency uses two decimals. policy.transactionRoles explicitly maps each encountered Shopify type to contribution or transfer. Unknown types remain exceptions; no default classification is invented.

For every balance transaction, retain:

| Original field | Use |
| --- | --- |
| id | Original unique transaction identity |
| type | Actual transaction type, mapped explicitly by the policy |
| test | Actual boolean distinguishing test activity |
| amount.amount / currencyCode | Original signed gross decimal and currency |
| fee.amount / currencyCode | Original fee decimal and currency |
| net.amount / currencyCode | Original signed net decimal and currency |
| associatedPayout.id | Exact associated payout identity |
| associatedOrder.id | Optional original order identity |
| sourceId / sourceType | Underlying original source reference |
| sourceOrderTransactionId | Original order-transaction identity, retained in the full input |
| transactionDate | Original transaction timestamp |
| adjustmentReason / adjustmentsOrders | Actual adjustment explanation and references |

The current Shopify object permits transactions without an associated order. Such rows remain present. CHARGE without an order reference is flagged for review; adjustment/transfer rows can legitimately use other source identities.

Payouts retain id, net.amount, net.currencyCode, status, transactionType, issuedAt and any other original source fields. The starter only marks a clean PAID DEPOSIT as MATCHED_SOURCE_TOTAL. Withdrawals and other directions stay visible for the commissioned customer's explicit native sign/settlement review.

orders is the original selected order index with id and name. It supports reference coverage; this first profile does not equate an order's sale total with payment balance. Orders may have multiple payments, partial refunds, other gateways, duties, adjustments or periods. Those cases are handled through the actual transaction references and agreed selected scope.

Outputs:

- transactions.csv: every original transaction, financial values, source references and row-level review state.
- payouts.csv: separate contribution/transfer/unclassified totals by payout, currency and test mode; original payout amount/status/direction and actual difference.
- orders.csv: original order coverage and reference counts.
- exceptions.csv: complete original identity, cause and useful detail.
- Review.html and preparation.json: all outputs plus source and summary.
- Native Analysis: complete editions, saved queries, published report and editable receiving archive.

The commissioned adapter acquires complete original selected records. It retains true pagination, the initial/final selection, and a stable boundary or re-read reconciliation when the source changes during extraction. It applies the actual provider's rate policy and the customer's app scopes. Partial acquisition remains a source continuation, not a complete selected result.

## Contacts: original company/person source to Odoo

The complete input adds:

- namespace: stable lowercase source-system namespace, beginning with a letter.
- fields: unique list drawn from name, email, phone; name is required.
- companies: complete selected source companies.
- people: complete selected source people.
- targetExisting: complete selected target export for the namespace/mapped records.
- targetBaselineComplete: true only for that complete declared target baseline.

Each source company/person has string sourceId and name. It can also have email, phone, explicit targetExternalId and clearFields. Each person can have companySourceId. For a new person, omission creates a standalone contact. For an existing target, omission preserves its exported parentExternalId; the complete baseline includes that parent company. An explicit empty companySourceId clears an existing relation only with parent in clearFields. Existing target rows must include parentExternalId, including an actual empty string. New company-to-company hierarchy selections remain explicit review items for the commissioned target ordering.

Each targetExisting row has externalId, kind (company or person), parentExternalId, and the actual baseline values of every owned contact field. A baseline field used for preservation must exist. Keep the corresponding original Odoo export in the input's source originals.

Example source record:

    {
      "sourceId": "original-system-customer-104",
      "name": "Original customer name",
      "targetExternalId": "__export__.res_partner_104_actual_suffix",
      "email": "",
      "clearFields": ["email"]
    }

That explicit target ID must appear in targetExisting with the same record kind. The clear is a deliberate operator choice retained in the original input. Leaving email absent instead preserves the target's baseline email.

Existing target names/emails do not automatically match source identities. Supply an explicit reviewed targetExternalId mapping where the partner has established the relationship. New IDs are deterministic from the stable namespace, record kind and complete original source ID.

Output CSV uses the exact documented company/person import structure:

    External ID,Name,Is a Company,Related Company/External ID

Email and Phone are included only when fields declares them. Companies precede people. Every excluded row remains in mapping.csv and exceptions.csv with the original ID, target ID and reason.

An optional targetAfter adds the actual selected target receiving:
    
    {
      "complete": true,
      "receivedAt": "ACTUAL_TIMEZONE_QUALIFIED_RECEIVING_TIME",
      "scope": "SAME_INPUT_TARGET_SCOPE",
      "source": {"url": "ACTUAL_TARGET_EXPORT_URL", "description": "Actual selected target export"},
      "nativeResult": {"originalResult": "THE_COMPLETE_ACTUAL_NATIVE_IMPORT_RESULT"},
      "rows": [
        {"externalId": "ACTUAL_EXTERNAL_ID", "kind": "company", "parentExternalId": "", "name": "Actual imported name"}
      ]
    }

input.targetScope and targetAfter.scope must match. Each resulting row includes parentExternalId and every owned field, including actual empty strings. The complete original target result stays in the input. reconciliation.csv compares every import-ready record; exceptions retain changed/unexported fields, changed parents, duplicate or missing External IDs, unexpected new records and original baseline records lost from that same selected scope.

Acceptance includes the customer's actual selected Odoo version/module/schema, complete mapped source counts, relation counts, native Test/import result, same-ID re-import and one retained correction. The commissioned implementation partner retains database administration and the production cutover decision. This reusable source component performs source transformation and reports; the original importer performs database writes.

## Capacity and business boundaries

The original Analysis query preview is capped independently from exported source and query files. Always inspect the actual export manifest and result status. Commissioning sizes the real full selected source, attachments, pagination, daily changes and concurrency. Large exports are selected and continued through the existing source worker.

All money comparisons preserve actual source currencies and exact decimal strings. A source-total match does not replace the customer's accounting or bank-receipt process.

All contact fields follow the operator's owned-column contract. The supplied import files cover companies and people; adding products, invoices, attachments or another original data family is a separate explicit mapping inside a selected workshare.
