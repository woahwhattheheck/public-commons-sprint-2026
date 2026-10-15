# Compare two retained parcel portfolios

This extension belongs to the existing QGIS parcel workspace. A comparison names two already saved portfolios and keeps their complete original rows, source and review identities. It does not retrieve a new publisher cohort. Earlier portfolios, maps, decisions and request history remain in the same project.

## Open and use the comparison desk

1. Open the existing analyst application and select **Parcels → Portfolio comparison**.
2. Choose two distinct saved portfolios. They can come from the same original source edition, a changed review, or independently reviewed source editions. The working edition selector does not replace either frozen input.
3. Name the comparison and explain the scope and intended period interpretation.
4. Keep **Require identical declared tax year and as-of date** for a same-period comparison. Choose **Explicitly compare different declared periods** only when that is the intended question. The selected policy is part of the saved comparison.
5. Select the desired owner, accountable entity, status and ward group transitions. Every transition also retains its assessment basis, currency, tax period, area basis and units, even when those fields are not selected as group labels.
6. Preview the comparison. Check cohort additions/removals separately from common parcels and inspect rows whose amounts or areas cannot be compared.
7. Save the exact preview. Changing the pair, policy, grouping or interpretation requires another preview. The original analyst journal retains the request and supports the same-request continuation after a listener or transport failure.

The saved list opens the exact comparison. Search by parcel key, owner, responsible entity or ward; filter additions, removals, common rows, changed common rows or common rows with measure attention. The desk shows 50 rows per page. The original JSON, CSV and report contain every retained row.

The comparison does not change source-owner assertions, assign an accountable entity, revise a reviewed valuation, update a map or carry decisions into a later source edition. Those are existing explicit operations in the same desk. Make an additional named comparison after such work to retain both earlier and later questions.

## What the values mean

| Condition | Result |
| --- | --- |
| Original key appears in both portfolios | Common parcel; both complete rows retained |
| Key appears only on the right | Added to the selected cohort; one-sided value retained, delta absent |
| Key appears only on the left | Removed from the selected cohort; one-sided value retained, delta absent |
| Both reviewed amounts exist, basis and currency match, and period policy is satisfied | Exact right-minus-left decimal assessment change |
| Amount absent on either side | Measure attention; absent never becomes zero |
| Identical declared tax year and as-of date | Eligible under either period policy, subject to basis/currency |
| Different declared tax year or as-of date | Eligible only under the explicit different-period policy |
| Tax year or as-of date missing on either side | Period attention under both policies |
| Assessment basis or currency differs | Amount attention under both policies; no automatic conversion |
| Both areas exist and area basis/unit match | Exact right-minus-left area change |
| Area absent, basis changed, or units changed | Area attention; no implicit square-feet/acre conversion |

The computation uses Decimal arithmetic on original decimal text, deriving precision from both coefficient/exponent ranges for each subtraction and group addition. It never converts amounts to floating point. An operation needing more than 16,384 significant expansion digits, or outside Decimal's representable exponent range, retains both original values and reports **numeric-range-exceeded** instead of producing a rounded result. A group total has its own explicit attention if its combined expansion exceeds that range; exact individual row changes remain available. Exact zero is a real observed value. Unreviewed values remain absent as recorded by the frozen portfolio. Assessed value and the 2012 appraisal retain their own source meanings; a difference does not become a market appraisal or a causal explanation.

Changed common rows identify differences in owner, accountable entity/version, status, ward, source claims, geometry selection, source issues, facts identity, review identity, chosen values, bases and periods. A changed review identity may accompany an unchanged numeric amount. An unchanged row means the retained compared fields match; it does not assert that an external publisher has not changed since capture.

### Groups

A group is an exact left-to-right transition. Its two sides retain the selected responsibility/owner/status/ward labels and the complete measurement identities. Amount and area totals sum only comparable common rows within that transition. Each total includes its contributing parcel count. A group with no comparable values has a missing total rather than a zero total. There is no combined money total across different currencies or bases.

## Files and complete receiving

Each saved comparison creates three immutable files beneath its own comparison directory:

- **comparison.json**: complete definition, both portfolio identities, every exact left/right row, changes, groups, summary and preview identity.
- **changes.csv**: every parcel with exact amount/area values, deltas, attention reasons, bases, units, tax periods and source/review hashes. Text formula prefixes are quoted for spreadsheet opening; numeric decimal columns remain decimal text.
- **report.html**: neutral standalone report with normal table columns for values, currency, basis, tax year/as-of date, area attention and expandable original rows.

Download those files from the saved comparison panel. The HTML opens independently. Download the complete project from **Transfers** to carry both original portfolios, their source editions, reviews, comparison files, native project and analyst request history together.

Reopening a comparison verifies its retained JSON and re-derives it from both retained portfolios. A changed comparison body or source identity is rejected. The original retained comparison files are included in the normal project closure and independent receiving checks; there is no separate project database.

## Original command interface

Use the original parcel operator. Its existing workspace path, revision, actor and request identity remain authoritative.

Preview action file:

~~~json
{
  "action": "comparison.preview",
  "payload": {
    "definition": {
      "title": "Reviewed cohort comparison",
      "leftPortfolioId": "REPLACE_WITH_SAVED_LEFT_PORTFOLIO_ID",
      "rightPortfolioId": "REPLACE_WITH_SAVED_RIGHT_PORTFOLIO_ID",
      "periodPolicy": "same-period",
      "groupBy": ["owner", "ward"],
      "note": "Record the actual selected cohort and intended period comparison."
    }
  }
}
~~~

Run:

~~~sh
python -m starforge_stac.parcels.operator --workspace /absolute/original/workspace --action-file /absolute/preview.json
~~~

For saving, use action **comparison.create**, the exact same definition and returned **previewSha256**, plus the current **revision**, original **requestId** and responsible **actor**. Retain the complete action file before submitting it. Repeating that exact original request returns its recorded result; do not invent another ID to recover an uncertain outcome.

The existing analyst API accepts the same inner action under **parcel.command**. Read a saved comparison through:

~~~text
GET /api/parcels/comparison?comparisonId=...&offset=0&limit=50&cohort=changed&query=...
~~~

Limit is 1–250. Supported cohort filters are added, removed, common, changed and attention. Omit the filter to read every row. Original downloads are beneath **/download/parcels/comparisons/{comparisonId}/**.

## Continue the existing native receiving operation

The maintained **parcel-comparison-receiving.py** extends the original **parcel-native-receiving.py** operation. It uses its existing workspace, operation lock, analyst journal, native runtime selection and browser binding. It does not launch another provider service or acquire a new parcel source.

Pass the original operation root, ID, actor and existing browser configuration together with a JSON file containing the complete comparison definition:

~~~sh
python parcel-comparison-receiving.py \
  --operation-root /absolute/original-operation \
  --operation-id ORIGINAL_OPERATION_ID \
  --actor ORIGINAL_ACTOR \
  --definition-file /absolute/comparison-definition.json \
  --browser-config /absolute/existing-browser-config.json
~~~

Supply **--native-runtime-file** only when continuing the same already selected native binding. The comparison itself needs the original retained source rows and Python runtime; the complete project continues to carry its native map history.

The phase records its exact definition and prior complete snapshot under **portfolio-comparisons/{definitionHash}**. It previews and creates through the existing listener, confirms same-request replay, reads every comparison page, downloads all three exact files and operates the visible preview/save controls. It then exports the complete project, receives that actual archive independently and opens the same comparison from the received application's own software.

The existing browser course captures populated desktop/narrow comparison screens, opens the exact downloaded report bytes through its local receiving origin, operates original-row details, and captures the report at both widths. The producing receiver must inspect those actual images and repair any material presentation defect before presenting the resulting product. Preserve the phase's original requests and files after an interruption, then rerun the same command.

Keep a restricted local cohort and its full project on its authorized host. This course creates local complete exports; it does not grant external transfer permission.

## Focused source course

**parcel-comparison-course.py** executes the actual production comparison functions on clearly authored values: membership changes, exact cents beyond binary-floating integer precision, zero versus missing, owner transition, explicit cross-period policy, changed basis/units, missing periods and ordinary report/CSV retention. It makes no publisher or QGIS call and changes no customer project:

~~~sh
python parcel-comparison-course.py
~~~

Its authored values are separate from the existing real receiving operation. The delivered UI source course executes the actual comparison form handlers with explicit injected element/action interfaces. Native browser operation, screenshot inspection, original file downloads and complete project receiving belong to the existing receiving phase described above.
