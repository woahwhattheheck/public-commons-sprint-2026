# Operate an economic edition through customer delivery

Keep one World Bank source workspace for continuing acquisition and a separate
Analysis workspace for the customer's saved queries, reports and workbooks.
A new edition has its own capture, review, export and analytical operation.
A continuation uses the same identities and directories.

## Source acquisition

~~~sh
starforge worldbank-product workspace --directory /srv/starforge/worldbank
~~~

Open the printed private URL. Source selection, captures, reviews, comparison,
export and merchant operations share one saved model. The command closes its own
server and capture children on interruption.

The equivalent command workflow starts with selection.json:

~~~json
{
  "id": "north-america",
  "title": "North America GDP and population, 2018–2024",
  "expectedRevision": 0,
  "spec": {
    "sourceId": "2",
    "countries": ["CAN", "MEX", "USA"],
    "indicators": ["NY.GDP.MKTP.CD", "SP.POP.TOTL"],
    "date": "2018:2024",
    "perPage": 20
  }
}
~~~

~~~sh
starforge worldbank-product action save-selection \
  --directory /srv/starforge/worldbank --input selection.json
starforge worldbank-product action capture \
  --directory /srv/starforge/worldbank \
  --json '{"id":"north-america-2026-10","selectionId":"north-america"}'
starforge worldbank-product action observations \
  --directory /srv/starforge/worldbank \
  --json '{"captureId":"north-america-2026-10","offset":0,"limit":100}'
~~~

Use the actual current selection revision for later edits. The original engine
retains response bytes, request/final URLs, acquisition times, page metadata and
hashes. Every selected indicator has its individual metadata group. Source,
countries, metadata and all data pages must complete before the capture completes.

The original import-pages and import-package actions also receive complete
source captured by another authorized operator. After interruption, repeat capture
with the same ID and selection to use the retained continuation and provider timing.
Cancel through the original running session URL. See the complete
[native action contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/NATIVE.md).

## Review and export

Inspect complete observations and compare the capture with a selected earlier
capture. Save original-row choices and exclusions in the review. The review
retains the exact capture digest and its own revision.

~~~sh
starforge worldbank-product action review \
  --directory /srv/starforge/worldbank \
  --json '{"id":"north-america-reviewed","captureId":"north-america-2026-10","title":"North America economic edition","note":"Reviewed original coverage and values.","excludedKeys":[],"expectedRevision":0}'
starforge worldbank-product action export \
  --directory /srv/starforge/worldbank \
  --json '{"id":"north-america","reviewId":"north-america-reviewed"}'
starforge worldbank-product action export-read \
  --directory /srv/starforge/worldbank --json '{"id":"north-america"}'
~~~

The original export contains dataset.csv, dataset.json, source metadata, review,
capture closure, manifest and handover.zip. Read and retain the returned paths
and hashes. A later accepted export uses its own export ID.

## Native dataset service

Prepare the accepted export using the actual seller origin, route and existing
payment terms. The native bridge verifies the export manifest and creates the
original SF30 dataset seller, publisher draft and source closure.

| Original action | Continue with |
| --- | --- |
| merchant-prepare | Accepted export ID, origin/path and actual payment terms |
| publisher.reviewDraft / publisher.publish | Returned draft, expected snapshot and revision |
| publisher.release.stage | Original draft and stable release ID |
| publisher.release.activate | Reviewed release and current generation |
| publisher.release.start | Current generation and the original process owner |
| publisher.buyer.review | Selected snapshot and exact customer query |
| publisher.buyer.prepare | Retained review, buyer intent, accepted offer index and offer SHA |
| publisher.buyer.session | Returned buyer ID, original workspace and explicit spending/page limits |

Use the exact original payloads in
[NATIVE.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/NATIVE.md).
For managed operation, register the READY runtime in the original Runtime
workspace and select its worldbank-agent application. Review/save the private
connection, Start, Open, Stop and reopen through that same Applications controller.

The [MCP guide](../../stellar-forge/mcp-merchant-operator/WORLDBANK-WORKSPACES.md)
documents init-worldbank-workspaces, inspect-worldbank, original tool schemas
and download-worldbank. Browser and agent share one model. The retained downloader
verifies its manifest, resumes original files and invokes the original package
importer at the receiving workspace.

## Analytical customer edition

Install Python's original workbooks extra as described in
[RECEIVING.md](RECEIVING.md). The product selects its own adjacent Python package
and original World Bank core:

~~~sh
starforge worldbank-product analysis --python /srv/starforge/python/bin/python \
  prepare --handover /srv/starforge/worldbank/exports/north-america/handover.zip \
  --workspace /srv/starforge/worldbank-analysis \
  --operation-id 13c281c36fca40fe8377af367911bb4d \
  --prefix north_america --resume
~~~

This prepare command creates an initial analytical customer edition. An omitted
operation ID derives from the handover digest. Continue interruptions with the
same command and directory. For a later approved edition of the same customer's
monitoring workbook, use the [recurring customer workflow](RECURRING.md): it keeps
the same view, edited SQL, report definition and workbook while retaining prior
editions. Use a separate prepare operation/view only for an independent analysis.

The maintained adapter first runs the original package importer and World Bank
review/export engine. Its regenerated CSV must match the customer CSV byte for
byte. The original handover and typed projection become source documents in the
existing Analysis workspace.

| Section | Interpretation |
| --- | --- |
| Observations | Every reviewed row, original numeric token, null, unit, status and source position |
| Coverage | Counts and missing values by source, country, indicator, aggregate status and unit |
| Annual change | Consecutive selected years, with explicit gap, duplicate, missing or zero-denominator outcomes |
| GDP per person | Current-US-dollar GDP divided by positive population at matching selected identities |

Raw values remain exact text. Calculations use original SQLite numeric rules and
retain source terms beside the result. Annual calculations require four-digit
years; other periods remain in the source observations. The current adapter
supports fewer than 100,000 reviewed rows and original handovers up to 32 MiB.

The result names actual publication, workbook, archive and operation IDs,
byte lengths, SHA256 hashes and delivery directory. The full analytical rules,
customer files and export formats are in
[ANALYSIS.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/ANALYSIS.md).

## Customer reopening

Deliver the complete WorldBank_Analysis_Delivery.zip or the individual files
named by its manifest. It contains HTML/JSON reports, section CSVs, Excel,
original workbook handover, complete Analysis workspace and receiving guide.

Receive its workspace through the original engine:

~~~sh
starforge worldbank-product analysis receive \
  --archive /srv/customer/incoming/WorldBank_Analysis_Workspace.zip \
  --sha256 ACTUAL_WORKSPACE_ARCHIVE_SHA256 \
  --workspace /srv/customer/economic-analysis \
  --operation-id 431e21b8c6e44f65a3d6c279f5b8e012
starforge worldbank-product analysis serve \
  --workspace /srv/customer/economic-analysis
~~~

The printed private URL opens the original Analysis browser. Inspect sources,
run saved SQL, read report/workbook history and save the customer's own queries.
Repeating the same completed archive receive preserves those later edits.
Another archive uses its own identity and the original destination rules.

The workbook ZIP has an independent WorkbookDelivery receiver and verified file
stream. Keep the workspace, workbook package, original source handover and
delivery manifest together for later operation.
