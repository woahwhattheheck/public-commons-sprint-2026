# IATI 2.03 finance and source interpretation

## Amounts and financial categories

Every reported value retains its original lexical text and an exact decimal string. Python Decimal performs report additions with sufficient precision for the mapper's declared decimal and record capacities. The dataset exposes money as strings so JavaScript number conversion cannot change an amount.

Transaction types 1–13 remain distinct. Incoming funds, commitments, disbursements, expenditure, interest, principal repayments, reimbursements, equity movements, guarantees and pledges describe different financial events. Report groups partition by reporting organisation, activity hierarchy, currency, transaction type and value date. There is no combined total across these categories.

Budget groups additionally retain original/revised type, indicative/committed status and the complete start/end period. Both omitted budget type and omitted status resolve to code 1 under the standard; the mapper retains the raw record and marks each resolved value's source. Original and revised budgets remain separate. Budget sums need not equal commitment sums under IATI's published definition.

Currency comes from the financial value when specified and otherwise from the activity's default-currency. A missing or malformed currency creates an explicit record finding. The mapper checks three-letter syntax and the complete 176-code IATI 2.03 Currency page snapshot retrieved on 2026-10-12. Unlisted codes remain visible as financial review findings. Nine codes marked withdrawn by that snapshot remain separate historical-currency review findings; their recorded amounts and value dates are preserved. It does not consult a live exchange-rate service or convert currencies.

The source's value-date is retained separately from transaction-date. IATI uses value-date for exchange-rate conversion. Transaction selection uses transaction-date. All reported currency and date values remain inspectable in the native editions.

Hierarchy defaults to 1 under the activity standard. IATI recommends reporting financial transactions at the lowest hierarchy level when multiple levels exist, to avoid double counting. This report keeps the reported organisation and hierarchy as separate dimensions so that the operator can see and review the publisher's levels.

Sources:
- https://iatistandard.org/en/iati-standard/203/codelists/transactiontype/
- https://iatistandard.org/en/iati-standard/203/codelists/currency/
- https://iatistandard.org/en/iati-standard/203/activity-standard/iati-activities/iati-activity/
- https://iatistandard.org/en/iati-standard/203/activity-standard/iati-activities/iati-activity/transaction/value/
- https://iatistandard.org/en/iati-standard/203/activity-standard/iati-activities/iati-activity/budget/

## Period selection

The operator accepts dateFrom and dateTo as inclusive calendar dates. Transactions are selected by their reported transaction day. For budgets, a period is selected when it overlaps the requested window, and its full reported amount is retained. The operator does not prorate a budget by days or treat an annual amount as monthly expenditure.

Every budget needs exactly one start and end, with start before end and a duration of at most one year. Missing, invalid or inconsistent financial dates remain in unfiltered editions and review files. A dated selection requires valid dates for candidate records so it cannot silently discard an undatable amount.

XML date timezone text remains in the raw date field; calendar selection uses its reported calendar day. The mapper does not shift a date-only financial period into another day by converting its timezone.

Sources:
- https://iatistandard.org/en/iati-standard/203/activity-standard/iati-activities/iati-activity/budget/period-start/
- https://iatistandard.org/en/iati-standard/203/activity-standard/iati-activities/iati-activity/budget/period-end/
- https://iatistandard.org/en/iati-standard/203/activity-standard/iati-activities/iati-activity/transaction/transaction-date/

## Associations and language

Repeated sectors retain each vocabulary, code, percentage and narrative together. The mapper resolves sector vocabulary 1 when omitted and records the source of that default. It reviews within-vocabulary percentages, required sector codes, publisher-defined narratives and activity-versus-transaction placement.

Sector percentages describe allocations within a vocabulary. The report does not multiply one financial amount by the number of sector, country, region, provider or receiver records. Those associated records remain JSON arrays in their original activity or transaction row.

All narrative text and attributes remain available. Displayed titles prefer the requested language, then the activity's declared language, then the first published narrative. A narrative's language resolves from its own xml:lang and otherwise from the activity default; missing language is a review finding.

The Datastore documentation explains that flattened parallel arrays cannot reliably associate repeated sector codes and percentages. This source adapter therefore takes original publisher XML. A future structured iati_json adapter must preserve the same associations rather than positionally zipping flattened arrays.

Sources:
- https://iatistandard.org/en/iati-standard/203/activity-standard/iati-activities/iati-activity/sector/
- https://iatistandard.org/en/iati-standard/203/activity-standard/iati-activities/iati-activity/transaction/sector/
- https://iatistandard.org/en/iati-standard/203/activity-standard/iati-activities/iati-activity/title/narrative/
- https://docs.datastore.iatistandard.org/en/latest/api/

## Identity and comparison

Activity rows use the published IATI identifier. A source with a missing or repeated activity identifier can be profiled, and its findings remain available; a native edition requires the ambiguity to be resolved in its selected complete source.

A transaction's unique nonempty publisher ref is used within its activity when present. Budgets use a unique type/start/end tuple within their activity. These are explicit comparison choices. The budget tuple is an operator matching rule, not a claimed publisher-issued budget identifier.

Other financial records use the hash of their complete associated content plus an occurrence number for identical repeated records. A change to an unidentified record therefore appears as removal and addition. Record ordering alone does not alter projected identities. Original publisher XML bytes remain separately retained even when indentation is omitted from a derived content identity.

Within one portfolio revision, each selected activity identifier occurs in exactly one source edition. This avoids adding two overlapping publisher files for the same activity. A later revision can replace the source. Comparison pairs unchanged source IDs automatically, then pairs a replacement only when the reporting-organisation signature is unambiguous. The operator can provide explicit source pairs.

Full native field comparisons run when the earlier and later datasets share an identical mapping. Source additions, removals and selection changes remain separate coverage facts. The comparison output retains every original changed row through the existing dataset comparison engine.

Sources:
- https://iatistandard.org/en/iati-standard/203/activity-standard/iati-activities/iati-activity/iati-identifier/
- https://iatistandard.org/en/iati-standard/203/activity-standard/iati-activities/iati-activity/transaction/

## Review and provenance

The source profile and full editions expose targeted financial, identity, association and language findings. The official IATI Validator remains the standard's full validation service. Financial eligibility in this operator means the amount, required currency, financial category and required dates are usable for its defined report; association findings remain attached to the reported record for review.

Each report exposes the count of selected records, records with review findings and financial records excluded from grouped amounts. The excluded records remain in the complete CSV and review JSONL. Planned disbursements are retained in the original XML and counted in the activity edition; they are distinct from the transaction and budget datasets.

Retain the publisher URL, retrieval time, byte count, hash and published licence alongside an acquired file. Publisher and data-file metadata now belong to IATI Account and the Dashboard; do not assume a historical Registry API is the current authoritative route.

Sources:
- https://validator.iatistandard.org/
- https://account.iatistandard.org/
- https://iati-iati-account-docs.readthedocs-hosted.com/en/latest/
- https://dashboard.iatistandard.org/
