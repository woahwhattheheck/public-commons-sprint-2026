# Review and adopt workbook editions

The **Review workbook updates** section belongs to the existing dataset publisher. Select an earlier retained workbook and its saved mapping, then compare it with a newly retained workbook. The comparison reads both complete source selections through the original workbook reader, preserves row and cell details, and saves the replacement mapping through the original workspace index.

This gives a merchant one continuous workflow: original workbook → explicit public-field mapping → complete update review → retained replacement mapping → original typed CSV candidate → publication → pinned buyer delivery.

## Review an update

1. In **Workbook sources**, retain the replacement XLSX. Keep the earlier original and its saved mapping available.
2. In **Review workbook updates**, select the earlier workbook, saved mapping and replacement workbook, then choose **Review replacement**.
3. Inspect worksheet and column changes. A uniquely matching original header suggests a replacement column. Duplicate, missing or changed headers require an explicit coordinate. Review the actual worksheet, range and header row; **Read headers** rereads those exact coordinates.
4. Review each declared public field. The saved mapping selector includes retained historical editions. The earlier blank/formula/error/date/whitespace/literal-mapping decisions carry forward. A newly declared native field receives explicit default choices for review. Choose one or more **Row key** fields that together identify each record in both selections.
5. Choose **Compare complete selections**. The workspace reads every selected record and retains the complete union of keys, including unchanged records. A null or duplicate key returns the side, worksheet and original rows that need a different key or selection.
6. Review the complete totals, column/conversion changes and paginated rows. **Inspect cells** shows the original coordinates, public values, XML tokens, saved formula/cache information and formats. Filter rows by added, removed, value changed, source changed, unchanged or moved.
7. After reviewing the selection and totals, select the review checkbox and **Save replacement mapping**. This saves a new mapping on the replacement workbook. **Open saved mapping** returns to the original workbook controls.
8. Prepare the original native candidate, query its typed rows, and use the existing review, publication and buyer controls. The saved comparison remains available independently of the screen page.

The form captures the earlier mapping edition, replacement source revision and current native publication at the time headers are inspected. A status refresh does not replace those captured values. If the selected mapping, source or publication changes, reopen the replacement review against its current displayed state.

## What the row comparison means

The original reader makes both complete CSV projections and their source-row maps. A temporary SQLite join uses the selected typed public fields as the compound key. Long identifiers remain strings when the native schema declares strings. Native integer and number behavior follows the existing dataset loader.

| Row kind | Meaning |
| --- | --- |
| Added | The key exists only in the replacement selection. |
| Removed | The key exists only in the earlier selection. |
| Value changed | At least one typed public value differs. |
| Source changed | Public values are equivalent, while original tokens, formulas, saved caches, formats or other retained cell details differ. |
| Moved | The same key is at another original row with otherwise equivalent values and retained cell details. |
| Unchanged | Public values, retained cell details and original row are equivalent. |

Each row also has a separate **moved** flag. The **Moved rows** view includes every moved record, including records with changed values or source details. The displayed moved total is therefore independent of the mutually exclusive change-kind counts.

A numeric source token can change while its native number remains equivalent; that appears as a source-detail change. Package-local shared-string or style index changes do not by themselves change a cell's meaning; the exact original indices remain in its retained cell details. Saved formulas are read from the actual workbook and their stored results. The existing reader's reviewed formula policy determines which value enters the public projection.

Row-key fields must exist in both public schemas with the same native type. Keys must be present and unique throughout both complete selections. Choosing a worksheet row number as identity would hide insertions and deletions, so keys are selected from the declared public data instead.

The comparison is limited by the original workbook and native CSV limits and a 128 MiB retained row report. It has a two-minute processing budget per complete comparison. Capacity errors identify the operation that needs a smaller actual selection. No partial comparison is adopted as a completed review.

## Retained review and restart

Every comparison has a caller-supplied UUID, a complete input identity, original source identities, exact plan editions, native schema pins, complete row totals and a digest of the retained row report. The browser displays the UUID while the operation is running. If a response is interrupted, **Reopen this comparison** reads that same operation.

The server retains the comparison request, metadata and complete JSONL rows in the original private workspace. Renaming the completed review directory is the completion point; partial staging directories are removed on reopen. The row report is checked against its recorded bytes and digest before it is read, adopted or exported.

**Saved update reviews** reopens earlier completed comparisons after a workspace restart. Page offsets count rows in the selected view. Downloads contain the complete report and row union; **Download displayed rows** contains the current page and its parent comparison identity.

Mapping adoption checks the exact comparison digest, replacement source revision and native publication revision. The original source store adds the comparison origin to the saved mapping record. If the save succeeds but the response is lost, repeating the same adoption resolves that original saved mapping, including an earlier retained plan edition. It does not create a second mapping.

A later publication can make an earlier unadopted comparison stale. Reopen the replacement selection and make a new current review. An already adopted mapping can still be reopened through its retained edition and continued through the original workbook preparation controls.

## Native CLI

All commands use the same authenticated local publisher session and its existing private session file. The original workbook guide explains [starting and reopening that workspace](../workbook/README.md).

~~~sh
starforge dataset-publisher workbook editions \
  --session-file /private/publisher-session.json

starforge dataset-publisher workbook edition-suggest \
  --session-file /private/publisher-session.json \
  --input /private/selection.json --out /private/headers.json

starforge dataset-publisher workbook edition-compare \
  --session-file /private/publisher-session.json \
  --input /private/comparison.json --out /private/comparison-result.json

starforge dataset-publisher workbook edition-read \
  --session-file /private/publisher-session.json \
  --id COMPARISON_UUID --offset 0 --limit 50 --kind changed

starforge dataset-publisher workbook edition-apply \
  --session-file /private/publisher-session.json \
  --input /private/adoption.json --out /private/saved-mapping.json

starforge dataset-publisher workbook edition-export \
  --session-file /private/publisher-session.json \
  --id COMPARISON_UUID --out /private/complete-review.json
~~~

Use the original source UUIDs, mapping edition and current native pins returned by the workspace. Each input file contains the corresponding API object below. Output files are created exclusively in private directories.

## API

These routes run inside the original loopback workspace, its session authentication and its mutation lock.

| Route | Method | Input and result |
| --- | --- | --- |
| /api/workbook/editions/list | GET | Returns saved comparison summaries and per-entry read warnings. |
| /api/workbook/editions/suggest | POST | Earlier source/plan edition and replacement source, plus optional sheet/range/headerRow; returns actual header choices, proposed mapping, workbook changes and native schema pins. |
| /api/workbook/editions/compare | POST | Complete reviewed request; returns retained comparison metadata and its first page. |
| /api/workbook/editions/read | POST | Comparison ID, logical view offset, limit and row kind; returns metadata and one page. |
| /api/workbook/editions/apply | POST | Exact displayed comparison identity and revision pins; returns the saved original source/plan and adoption outcome. |
| /api/workbook/editions/export | POST | Comparison ID; streams the complete private JSON review and all rows. |

A suggestion request:

~~~json
{
  "sourceId": "EARLIER_SOURCE_UUID",
  "planId": "EARLIER_PLAN_UUID",
  "planRevision": 1,
  "targetId": "REPLACEMENT_SOURCE_UUID"
}
~~~

Optional sheet, range and headerRow select the actual replacement coordinates. The baseline always uses its retained saved mapping edition. A null headerRow means that every selected row is data.

A comparison request extends the reviewed selection:

~~~json
{
  "id": "NEW_COMPARISON_UUID",
  "sourceId": "EARLIER_SOURCE_UUID",
  "planId": "EARLIER_PLAN_UUID",
  "planRevision": 1,
  "targetId": "REPLACEMENT_SOURCE_UUID",
  "expectedTargetRevision": 1,
  "expectedSnapshot": "REVIEWED_NATIVE_SNAPSHOT",
  "expectedRevision": 1,
  "keys": ["ACTUAL_PUBLIC_KEY_FIELD"],
  "plan": {
    "name": "Reviewed replacement",
    "notes": "",
    "sheet": "ACTUAL_WORKSHEET",
    "range": "ACTUAL_SELECTED_RANGE",
    "headerRow": 1,
    "hiddenRows": "include",
    "blankRows": "skip",
    "mergedCells": "reject",
    "columns": []
  }
}
~~~

Replace every placeholder and fill plan.columns with every declared public field using the original [mapping contract](../workbook/API.md). Preserve the reviewed conversion choices returned by the suggestion. Reusing a completed comparison ID with the same exact input returns its saved result; a different input requires a new ID.

An adoption request uses the values from the saved comparison:

~~~json
{
  "id": "COMPARISON_UUID",
  "sha256": "DISPLAYED_COMPARISON_SHA256",
  "expectedTargetRevision": 1,
  "expectedSnapshot": "REVIEWED_NATIVE_SNAPSHOT",
  "expectedRevision": 1
}
~~~

After adoption, use the returned source.id, plan.id and plan.revision in the original workbook prepare command. The resulting candidate continues through the existing native publication and buyer flow.

## Source organization

The original workbook bridge constructs this module with the same source store, original reader, native status reader and mapping-save operation. The comparison engine uses held source descriptors and the retained original parser. It uses private temporary projection files and SQLite join material during computation, then removes them.

The browser extension owns its separate workbook-editions UI and monochrome stylesheet. The main workspace adds only its assets, lifecycle hooks and authenticated routes. The existing workbook CLI adds the edition operations to its original session client.


## Repeat the actual annual Census update

[census-example.mjs](census-example.mjs) continues an existing merchant workspace that already retains the original Census 2023 Jam Values workbook and its reviewed Jam Values!A20:G36 mapping. It accepts the original session file and publishes the actual 2024 replacement through that same merchant.

Use the [official 2024 workbook](https://www2.census.gov/programs-surveys/acs/tech_docs/jam_values/2024_Jam_Values.xlsx) as --target-file. The example verifies both annual originals by their captured SHA-256 and uses the earlier declared public mapping. It compares the full sixteen original records, reads a filtered page through the installed CLI, exports all rows, adopts the replacement mapping, prepares and publishes the original native candidate, and reopens the same saved adoption after publication.

~~~sh
node workbook-comparison/census-example.mjs \
  --session-file /private/publisher-session.json \
  --operation-dir /private/census-annual-update \
  --target-file /data/2024_Jam_Values.xlsx
~~~

When multiple eligible baseline mappings exist, pass --baseline-source, --baseline-plan and --baseline-revision from the original saved mapping. The exported function also accepts explicit public keys and a publisherDirectory for an existing source installation. Reuse the same operation directory to recover the same comparison request. It retains the operation inputs, complete comparison, original candidate review and completed result in that private directory.
