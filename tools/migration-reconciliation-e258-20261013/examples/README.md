# Three complete migration source editions

These are invented **DEMONSTRATION** exports for the maintained migration workbench. They are not Sagacity, utility or customer records, a capacity benchmark, or an approved migration outcome. Every CSV is included in full, with its original byte hash in the corresponding manifest.

Each edition declares the same ten complete source/target pairs: customers, accounts, premises, meters, reads, tariffs, bills, payments, allocations and balances. Two additional full crosswalk files retain changed customer/account identifiers. The 22 original tables carry 66, 68 and 66 combined source/target/crosswalk rows in editions A, B and C respectively. These small complete source editions exercise operating behavior; they do not establish two-million-row performance.

The frozen dates span 1 January through 31 December 2025. The example is a deliberately small complete selected export, not a fabricated twelve-month time series. No hidden filter, fuzzy match or automatic repair is applied.

## Source meanings

The exact original column definitions, primary keys and foreign-key relationships are in each manifest. The source and target preserve their own actual exported parent identifiers. Explicitly supplied canonical customer/account reference columns allow the selected comparison to inspect parent identity while the original discovery engine independently checks actual parent foreign keys. These canonical values are part of the invented input export; the migration engine does not synthesize a join or rewrite a parent identifier.

Customer IDs C001/C002/C003 become NC100/NC200/NC300. Account IDs A001/A002/A003 become NA100/NA200/NA300. Both crosswalks are complete retained source files. Missing, duplicate and colliding mapping rows remain inspectable original records.

Numeric interpretations are selected explicitly:

| Pair/field | Original meaning | Target interpretation |
| --- | --- | --- |
| Reads / quantity | Cubic metres | Integer litres divided by 1000 |
| Tariffs / rate | GBP per cubic metre | Integer thousandths of GBP divided by 1000 |
| Bills / water charge | GBP water-charge component | Integer pence divided by 100 |
| Payments / signed amount | Negative GBP means received credit | Positive credit pence multiplied by -1/100 |
| Allocations / applied amount | Positive GBP allocated to a bill | Negative credit pence multiplied by -1/100 |
| Balances / balance | Debit-positive GBP; negative means credit | Credit-positive pence multiplied by -1/100 |

Every changed scale/sign carries its own reviewed **demonstration** reference in selection.json. Numeric tolerances are exactly zero; nothing is rounded to force a match. Currency and volume-unit dimensions must agree before numeric comparison. Missing values stay uncomputed. The optional premise unit label has explicit both-null equivalence; no other absent value is silently accepted.

Billing amounts and allocation records are compared as supplied. This product does not calculate a tariff bill, invent a payment allocation, or infer a leak/field finding. The final demonstration ledger is internally interpretable: A001 has GBP20 debit, A002 has GBP20 credit and A003 is zero, with original bill/payment/allocation rows retained.

The quoted multiline customer name exercises actual CSV record ordinal semantics: one quoted multiline record is one data record, not multiple physical lines.

## Edition A — original unresolved export

A retains each of these observable source problems:

- Target customer NC300 is absent. The retained customer crosswalk points to it, and target account NA300's actual customer foreign key remains unresolved.
- Target read R002 is missing and R003's target quantity is the invalid literal `unreviewed`. Neither is replaced by an assumed zero or a selected duplicate.
- Target meter M002 occurs twice with different serials. Both original rows are retained, and the full key group is ambiguous.
- Account crosswalk A003→NA200 is an additional contradictory row beside A003→NA300. It also collides with A002→NA200. Every affected map row and master key remains unresolved.
- Target payment Y002 has a negative target credit amount where the selected target contract is credit-positive. Its exact normalized amount is GBP+60 versus source GBP-60: a GBP120 difference.
- The credit balance's target sign is also wrong. Because the original account crosswalk remains ambiguous, this cannot be promoted into an accepted paired balance simply because an aggregate can be computed.

## Edition B — actual later corrections, ambiguity retained

B supplies the original missing customer/read, replaces the invalid read quantity with the explicit correct value, and corrects the payment/balance signs. It intentionally retains the duplicate meter and ambiguous account crosswalk. Corrected arithmetic in one domain does not turn this edition into a complete accepted migration.

## Edition C — complete corrected source

C retains all B corrections and supplies unique target meter M002 plus the three non-colliding account crosswalk rows. Every selected pair is now comparable under the explicit demonstration selection. All original input records, exact transformed values, source quality and grouped totals remain available through the same row/total index and complete exports.

## Original receiving and later source custody

The adjacent maintained native receiving course opens all three complete editions, packs each into its own immutable archive, verifies the earlier archive identities after each later edition, receives C through the original engine, and invokes the actually received migration source to rerun the exact retained CSV snapshots into a separate cold case.

It reads comparison and aggregate JSONL streams completely, checks their indexed SQLite correspondence and original source references, and operates the actual read-only local server when its original receipt is available. It does not put millions of records into browser fixtures. The retained exact source/row/total files remain the authority.

Use new private receiving directories; preserve partial runs and all prior source editions. Source review and native numeric receipts do not substitute for actual application use. The producing owner must open and LOOK at the actual desktop/narrow views, important controls, downloads/reopened cases and every applicable screenshot, PDF/report page and archive attachment under the full standing instruction in MIGRATION_RECONCILIATION.md. Retain TJLabs attribution and the existing operation.

## Numerical context

The selected dimensions gate numerical comparability before a difference is calculated: meter, reading date and unit for reads; both validity dates, currency and quantity unit for tariffs; account, tariff, billing date and currency for bills; account, payment date and currency for payments; payment, bill and currency for allocations; and currency plus as-of date for balances. Grouped totals retain these exact contexts. Equal nominal quantities in different contexts remain uncomputed as paired differences; the original nonnumeric discrepancy is still visible.
