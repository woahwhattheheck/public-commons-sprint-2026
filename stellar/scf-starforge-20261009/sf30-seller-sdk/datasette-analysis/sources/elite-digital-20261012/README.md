# Original Elite Digital pricing and catalogue source

These files are the complete original public inputs for the installed
WORKFLOW_SUPPLIER_EXAMPLE.json profile. They were acquired on October 12, 2026
from Elite Digital AI Solutions Ltd's published open-data collection. The
publisher's original datapackage identifies its August 12, 2026 edition,
version 1.0.0 and Creative Commons Attribution 4.0 license.

Attribution: **Elite Digital AI Solutions Ltd — Elite Digital Agency Open
Knowledge Datasets**. Original source: https://elitedigitalagency.io/open-data/.
License: https://creativecommons.org/licenses/by/4.0/.
The three publisher files are retained byte-for-byte; SOURCE.json and this
guide describe their use in the installed native workflow.

## Complete selected files

| Original file | Native content | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| [published-pricing.csv](published-pricing.csv) | 23 complete price records, nine original columns | 3,558 | 6891cc62b1341ee0cdf601a78e9e04b6232f1c26cc1cdeb8f021a5edc1fa5dcb |
| [services-catalogue.csv](services-catalogue.csv) | 29 complete catalogue records, five original columns | 4,964 | c225a1e081f783ce20eaf5de222449c03a3d01130ebb9d123b29fcb3673034c9 |
| [datapackage.json](datapackage.json) | Entire original publisher metadata and field declarations | 3,780 | 6c758cf191a670985e7195752565c8d16169d6be8941f707a50ebd6638adefe2 |

[SOURCE.json](SOURCE.json) records their exact original URLs and source
selection. The original datapackage also describes the publisher's separate
crawler-policy resource; this report profile selects the complete pricing and
catalogue family above.

Prices use the original name key. Repeated paths represent distinct published
price tiers. Catalogue entries use their original canonical URL key. GBP
amounts, separate charity rates, billing period, display wording, source URL
and capture date stay in their original fields. Blank charity pricing remains
blank and original zero amounts remain zero text.

## Use the selected installed source

Read the actual sourceRoot from the installed runtime binding. The selected
directory beneath that root is:

~~~text
stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/sources/elite-digital-20261012
~~~

The source-owned supplier parser reads these complete CSV files. The native
Analysis importer retains the original strings, ordered schema, original row
and line positions, publisher metadata and source identities. The profile's
six SQL sections use named prices and catalog sources in the existing Analysis
database.

Run workflow configure from [WORKFLOW_SUPPLIER_EXAMPLE.json](../../WORKFLOW_SUPPLIER_EXAMPLE.json)
with these original files, the matching complete supplier review workspace,
actual native Analysis owner and complete built product archive. The review
workspace's candidate source must match published-pricing.csv exactly.
The original supplier review keeps its own request ID, revision and status
and is explicitly linked to the workflow business request.

[The installed product operation guide](../../../../../../products/datasette/OPERATING.md#operate-a-complete-source-workflow)
contains the complete installed command and Applications launch.
[WORKFLOW_RECEIVING.md](../../WORKFLOW_RECEIVING.md) carries the same original
source family through all six native report sections, complete supplier
delivery, independent receiving and a real report successor.

A subsequent publisher edition receives a new selected source identity and
matching review workspace. Preserve these original bytes so an earlier
customer delivery can reopen its exact source.
