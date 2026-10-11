# Complete operator workflow

## 1. Create the project and retain original source

Enter the operator/reviewer name and choose a stable project ID. Use **Project** for actual authorized conversion work or **Practice** for generated demonstration data. Set the project's original IANA timezone.

In **Sources & mapping**, choose the utility table and original CSV/JSON export. Review observed headers before retaining the mapping. Identity columns remain strings, including leading zeroes, punctuation and separate account/location/customer meanings.

Typical source order:

1. Accounts and physical addresses.
2. Services and meter inventory.
3. Meter assignment history and offset timestamps for readings.
4. The predecessor bill export.
5. Original payment, bank and portal exports.
6. Field work, backflow and GIS exports.

An account is a customer identity; an address is a physical location; a service links a customer/location to a billing obligation; a meter has its own inventory and assignment history. The original values remain available even when the mapping changes.

The account opening balance includes postings through opening_as_of. Enter the actual predecessor cutoff; subsequent local ledger entries form the continuation. A historical aging request before that cutoff needs the corresponding earlier original balance source.

Choose an observed column or an explicit text constant. A blank mapping stays blank. Review duplicate canonical keys and invalid monetary/date values before using a table in a dependent operation.

Open any retained dataset version to search, download its mapped CSV, download the exact original bytes or correct a source record. Corrections create a new version and keep the earlier source/version. Ordinary CSV/JSON sources can be remapped directly. Native provider sources should be reimported through their selected native profile so their original positional and identity bindings remain intact.

## 2. Select the actual native file contract

The native source dictionary form maps the published MuniBilling Customer, Bills, Payments, Meter Readings or Backflow Device export. Select the actual customer identity, opening-balance field, payment type crosswalk and clock interpretation required by that source.

The separate native template form handles positional import configurations, including duplicate and blank headers. Choose the exact PDF layout or observed CSV header, inspect the file, map positions into the canonical table, and retain it. The 49-column customer CSV and 30-field PDF template stay separately selectable.

For a corrected native source, **Build corrected native provider CSV** or **Build corrected native template CSV** applies reversible direct-field changes. A combined display name or a read-only native identity has no automatic inverse mapping; change its original provider field(s) and reimport the original file. Template correction preserves every untouched CSV character, including original duplicate headers, quoting and record separators.

**Build a new provider-format handoff** selects one exact dataset or original billing candidate, maps every desired native position to an observed canonical column or explicit constant, and records the selected receiving format. Provider import/posted flags are explicit source/configuration values. The result records local file generation.

## 3. Prepare the billing cohort

In **Billing**, select the bill issue date and the actual monthly/bimonthly start and exclusive end dates. Select:

- Original timezone.
- Half-up or half-even line rounding.
- Full base fee or actual active-days proration.
- Register difference or exact interval coverage.
- Exact local-midnight boundary or the last accepted reading on the date.
- The route and any explicitly reviewed estimated-reading or rollover interpretation.
- Source-referenced tariffs for historical or contract-specific rates.

The source rate snapshot accompanies each candidate. Published residential and irrigation rates are directly selectable. Commercial/manufacturer thresholds need the receiving implementation's reviewed progressive versus whole-volume treatment. At the published overlapping manufacturer bimonthly boundary, the lower/upper choice is explicit. A wholesale or earlier contract rate needs its own source reference and reason.

The current residential formulas are:

- Water use in ccf = exact original meter consumption × multiplier, divided by 748 when the source unit is gallons.
- Usage cents = selected exact ccf × published/source-approved cents per ccf, rounded at the declared line boundary.
- Base cents = the selected meter/cycle fee, optionally multiplied by active days / full cycle days before rounding.
- Total = base + usage + explicitly retained other charges + approved bill adjustments.

The code retains rational consumption through the monetary calculation. The six-place displayed ccf value does not replace the underlying numerator/denominator.

An assignment history must cover the entire active billing period without gaps or overlaps. A replacement meter contributes its own original segment. A scheduled stop needs the actual accepted final reading on its boundary. Interval mode requires contiguous interval coverage with no overlapping or boundary-crossing intervals.

Every incomplete service is listed with its concrete finding. Correct the source and create a new candidate; earlier runs remain available.

## 4. Compare and accept the exact candidate

Select the original candidate and predecessor bill dataset. Choose the amount components present in the retained exports and run the comparison through the original reconciliation worker.

The original worker retains both exact input files, mapping, report, source hashes and reviews. Its failed result remains available after a corrected source version produces a passing comparison.

Record **Changes requested** or **Accepted after review**, with a substantive explanation. **Adopt this exact candidate as the migration-ledger baseline** records the accepted batch locally. A review without adoption retains the decision without changing the migration ledger.

A later accepted candidate can replace an existing adopted bill identity. For an overlapping different period, select the original accepted batch for those overlapping services. Only entries overlapping the new candidate's service/period selection are reversed; unrelated accounts in the original batch remain adopted.

Each review is bound to the candidate, original comparison and report. Refresh the original project if another view has advanced its revision.

## 5. Reconcile receipts and returns

Import the original provider, bank and portal exports. Choose transaction or settlement-batch matching, the shared reference field, and which original sources must agree. An explicit crosswalk can relate original reference conventions.

The reconciliation lists missing, ambiguous and amount-differing groups. Only selected **MATCH** groups can enter the local migration ledger. Provider + original transaction ID identifies a receipt. Repeating the exact accepted record does not add another posting. Different content under an already recorded identity requires review.

NSF, ACH return, chargeback and refund rows carry a positive amount and the actual original payment ID. The same account/provider must own that original payment; return dates cannot predate it, and cumulative returns cannot exceed its original amount.

Opening-cutoff rules also apply: old imported transactions may be retained and recorded, while an opening balance already containing them prevents their amount from being counted twice in current balances.

## 6. Customer actions and collections

**Customer service** searches the retained account export and opens its linked services. Preference/contact changes become source versions. A transfer closes the old service and creates a distinct successor ID at the actual effective date.

**Collections** records approved credits, fees, waivers, leak adjustments, installments, due-date extensions and case notes. Enter source-backed amounts and reasons.

For leaks, retain original repair proof and first high bill / repair / written request dates. The published rules require repair within 30 days, a written request within 45 days after repair, and at most two adjustments in 24 months. Declare the original history source and prior adjustments; the workspace includes its own earlier approvals. The credit amount is an approved input because the retrieved source does not publish a calculation formula.

Installment amounts must sum exactly to the selected plan balance, with ordered distinct dates. Extensions preserve their original action and due dates.

Aging uses posting-date age and the explicitly chosen oldest-first allocation. It settles bill corrections against their original debit and returned payments against their original credit before applying general credits. Undated opening balances stay visible.

Create a notice file from a retained aging snapshot, selecting age buckets, minimum amount, date and exact accounts. Emergency indicators, open extensions and installment plans remain in the notice's review fields. A changed financial/customer action history requires a current aging continuation before generating another notice.

## 7. Native readings and field work

Select the exact EZREADER variant, original date/time convention, two-digit-year window, timezone, UTC offset and account crosswalk. The whole original fixed-width file is retained. Account, serial and actual read date must resolve to the retained service/meter assignment.

Type F and Type X have different input/output positions. Review native spelling and field widths; export never truncates. Choose the route's effective date and output record separator.

Field work can be imported directly or prepared from the original collection notice / recorded matching payment operation. Select exact accounts, scheduled date, technician and review reason. These are local reviewed field visits.

Freeze and download the offline HTML route. It carries original order hashes, physical address, customer emergency/contact context, meter, backflow and GIS data. On the field device, record a completion result/reason, exact register and timestamp when applicable, notes, and original JPEG/PNG photographs. Save browser progress and download the return file.

Back in the operator, choose the original route release and import that return. Changed order identities are retained for review. An accepted return updates the field source once, retains original photo bytes and creates accepted readings only for completed visits. Repeat intake reopens the original accepted operation.

## 8. Deliver and continue

In **Delivery**, attach source documents or repair proof and freeze the project handoff.

The ZIP includes original source assets, all mapped/corrected versions, operation history, exact native comparison replay archives, accepted bill baselines and local ledger. The embedded manifest hashes each included entry. Source bodies are stored once by their original hash.

A later ZIP references earlier generated handoffs without recursively embedding their ZIP bodies. The complete encrypted workspace backup retains all earlier handoff bodies for editable restoration.

Use the offline backup/restore commands in [INSTALL.md](INSTALL.md). A restored workspace opens the same project IDs, original source bytes, comparison reports and reviews. Continue the original operation after reopening its state.
