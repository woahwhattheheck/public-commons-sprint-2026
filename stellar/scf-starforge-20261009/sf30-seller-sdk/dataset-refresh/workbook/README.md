# Workbook intake and retained publication

Use the existing dataset publisher to turn a local XLSX into a reviewed, versioned dataset. The workspace retains the exact workbook, its selected sheet and row coordinates, mapping editions, prepared CSV, publication review and buyer preparation. The running SF30 dataset service remains the sole version writer.

## Open the existing workspace

Use the installed merchant command, or the same source entry point in a complete checkout:

~~~sh
starforge dataset-publisher \
  --state /srv/dataset-state --workspace /private/merchant-work \
  --port 8431 --seller http://127.0.0.1:8430 \
  --resource https://your-api.example/data \
  --workbook-python python3 \
  --session-file /private/publisher-session.json
~~~

Node 22.16+, Linux util-linux flock and the existing versioned seller are required. XLSX extraction additionally uses Python 3.10+ and only its standard library. No spreadsheet package installation is needed. CSV, native query, publication and buyer operations still use their existing Node implementation when Python is unavailable.

The optional session file is created exclusively, mode 0600, in an existing private directory. Choose an unused path. It contains the current local session capability, stays outside the public proxy and is removed when that process closes normally. A crash can leave the expired file; preserve any uncertain operation's result, then remove that old session file or choose another filename when reopening. The original retained workspace path stays the same.

Open the printed private URL on the same computer. **Workbook sources** is part of the existing publisher page.

## Original source to native candidate

1. **Retain the original workbook.** Upload an ordinary XLSX. The original bytes and SHA-256 remain private, separate from the public CSV. Re-uploading identical bytes reopens the retained source. The source list shows sheet count and saved mappings.
2. **Inspect the real worksheet.** Choose its actual name, range and optional header row. A header is an original row number; data begins on the following row. With no header, every selected row is data. Duplicate labels stay distinguishable by coordinates. The preview includes missing cells and hidden-row markers, pages original worksheet rows and opens each cell's literal value, XML value token, formula, saved cache and number format.
3. **Map the declared public fields.** The current native generation supplies field names, types, nullability and limits. Choose one original column coordinate for each public field. Unselected workbook columns stay private. Review blank, formula, error, date, whitespace and exact-value mapping choices. No header-name guess creates a saved mapping.
4. **Save the reviewed mapping.** The plan records its source ID/SHA, plan edition and the displayed native snapshot/revision/configuration hash. Another browser changing that source or the current publication causes a stale review rejection. Refresh/reopen the actual source and make the review explicit.
5. **Prepare the native CSV.** The extractor writes a private CSV and a complete JSONL source-row map. The original loadDatasetConfig validates those actual bytes. The original retained-candidate API adopts the result. Repeating the same successful source/plan/parser preparation returns its existing candidate. It does not create another publication.
6. **Inspect and publish through the original controls.** Run the original typed query, filters, ordering and pagination. Save candidate notes, then publish the reviewed native snapshot/revision. The existing compare-and-swap, retention, rollback, offer and buyer paths remain unchanged.

A candidate's **Open original mapping** action reopens its exact retained mapping edition. If a later edition already exists, the historical edition is inspectable and downloadable; use **Copy this retained edition** to start a new review without replacing later work.

## Explicit cell decisions

| Decision | Behavior |
| --- | --- |
| Hidden rows | Include or exclude the actual hidden rows. |
| Empty selected rows | Keep or skip rows whose selected original cells have no literal value/formula. A numeric zero remains a value. |
| Merged cells | Reject an intersecting data merge, or keep the actual top-left cell and leave other original coordinates empty. Values are never filled across a merge. |
| Blank → null | Available only for nullable native columns. The original native CSV loader interprets the empty field as null. |
| Blank → empty text | Available only for a nonnullable native string field. |
| Formula → saved cache | Use the value saved in the original XLSX. Missing cache is an actionable cell error. The reader does not calculate formulas. |
| Formula → text | Keep the original equation in a native string field. A shared-formula follower without its own stored equation cannot invent that equation. |
| Excel error | Reject, retain its literal text for an explicit mapping, or map to null in a nullable field. |
| Date → raw | Preserve the original numeric serial or ISO token. |
| Date → ISO date | Use the workbook's actual 1900/1904 system and refuse a time fraction that would be lost. Excel's fictional 1900-02-29 is rejected. |
| Date → ISO datetime | For numeric serials, explicitly round to milliseconds using half-even rounding. No timezone is invented. Original ISO timestamps retain their source token. |
| Whitespace | Preserve it, or explicitly trim it. |
| Exact value mapping | Match a literal original string to a reviewed replacement string or null. No expressions, script or formula evaluation. |

Original numeric tokens remain strings in source inspection. Native integer fields retain the original JavaScript safe-integer limit. Larger identifiers belong in declared string fields. Native number fields retain the existing finite-Number behavior; the original token remains inspectable in the workbook and prepared CSV. The workbook layer does not claim a different arithmetic contract.

XLSX parsing never follows external relationships, loads macros or evaluates expressions. It rejects encrypted archives, macros, duplicate package members and unsupported required XML/relationship structures. The current reader bounds an original to 64 MiB, expanded package content to 64 MiB, 128 worksheets and 500,000 observed cells. One source preview contains at most 100 rows and 64 columns. Native dataset row/cell/CSV limits and the original workspace's retained capacity also apply. Narrow the actual range to inspect a wide workbook.

## Source update and restart

Upload a changed workbook as a **new immutable source**. Select a saved mapping from the original source as a starting point, inspect the new workbook's actual sheet/range/cells, and save a new source-bound plan. Earlier originals, plan editions, candidates, publication outcomes and buyer files remain available.

Publishing or rollback may advance the current native revision. A mapping saved against an older publication can reopen an already prepared candidate. Preparing a new candidate requires an explicit new mapping review against the displayed current native schema. A status refresh does not silently rebase the candidate or plan.

Close and reopen the same private publisher directory. Sources and current/history plan editions live under the existing atomic workspace index and kernel lock. A completed rename interrupted before its index commit is recovered by the original retained-state mechanism. Temporary partial files are removed on reopen; completed source records and uncertainty remain inspectable.

An original workbook cannot be removed while any retained candidate references it. Export the private source bundle and explicitly remove those candidates before removing an unused original. Original workbooks, CSVs and row maps all count toward retained source capacity.

## Exact private source bundle

Open a workbook candidate and choose **Export private source bundle**. The ZIP contains:

| Member | Meaning |
| --- | --- |
| original.xlsx | Exact retained source bytes. |
| data.csv | Exact native CSV candidate bytes. |
| dataset.json | Exact original native configuration used to validate the CSV. |
| workbook-projection.json | Frozen original source metadata, reviewed mapping edition, parser identity, CSV/row-map hashes and projection summary. |
| source-rows.jsonl | Complete zero-based CSV data-record → original worksheet row mapping. Header is outside data records. |
| workbook-parser.py | Exact parser source retained when this candidate was prepared. |
| candidate.json | Candidate identity and current retained publication/review metadata at export. |
| review.json | Original stellar-forge.dataset-publisher-review.v1 export. |
| manifest.json | Byte count and SHA-256 for every other member. |

Only the projected CSV enters the original public dataset. The private workbook bundle is merchant source custody; a customer acquisition does not require it. Current review metadata is separate from the frozen prepared projection. Later notes, plan editions or activation do not rewrite the original candidate bytes.

## Native merchant CLI

The workbook subcommand talks to the same running authenticated workspace. It creates no parallel dataset store or version writer:

~~~sh
starforge dataset-publisher workbook status \
  --session-file /private/publisher-session.json --out /private/status.json

starforge dataset-publisher workbook upload \
  --session-file /private/publisher-session.json --file /data/original.xlsx \
  --out /private/source-result.json

starforge dataset-publisher workbook inspect \
  --session-file /private/publisher-session.json --source SOURCE_UUID \
  --sheet "Sheet name" --range A1:G40 --offset 0 --limit 25
~~~

Use the exact API payload below for a plan. Save it in a private JSON file and retain the source/native revision observed during review. Replace the example field with every actual declared native field:

~~~json
{
  "id": "SOURCE_UUID",
  "planId": null,
  "expectedSourceRevision": 1,
  "expectedPlanRevision": null,
  "expectedSnapshot": "REVIEWED_NATIVE_SNAPSHOT",
  "expectedRevision": 1,
  "plan": {
    "name": "Reviewed public projection",
    "notes": "Source selection and reviewed conversion choices.",
    "sheet": "Sheet name",
    "range": "A1:G40",
    "headerRow": 1,
    "hiddenRows": "include",
    "blankRows": "skip",
    "mergedCells": "reject",
    "columns": [
      {
        "name": "native_field",
        "source": "A",
        "blank": "reject",
        "formula": "reject",
        "error": "reject",
        "date": "raw",
        "trim": false,
        "valueMap": []
      }
    ]
  }
}
~~~

~~~sh
starforge dataset-publisher workbook plan \
  --session-file /private/publisher-session.json --input /private/review.json

starforge dataset-publisher workbook prepare \
  --session-file /private/publisher-session.json \
  --source SOURCE_UUID --plan PLAN_UUID --plan-revision 1

starforge dataset-publisher workbook preview \
  --session-file /private/publisher-session.json --target draft:CANDIDATE_UUID \
  --query "limit=5"

starforge dataset-publisher workbook export \
  --session-file /private/publisher-session.json --candidate CANDIDATE_UUID \
  --out /private/workbook-source.zip
~~~

The same CLI exposes the existing publisher review/select/preview/publish/activate and buyer-offer/buyer-prepare/saved-buyer operations. Those operations keep their original API payloads and captured revision or offer identity. See workbook --help and [the publisher guide](../WORKSPACE.md). JSON and binary outputs are created exclusively in private directories; no existing file is overwritten. Session values are not printed by the workbook CLI.

## Original buyer continuation

Inspect the published native version/query, load its actual offer and prepare the original buyer JSON. The existing prepared buyer configuration pins the selected native snapshot. It can be associated with the original publisher-review bytes by the complementary customer packet, then passed into the original Buyer/Dataset acquisition, recovery and SF100 portable delivery.

The optional candidate.workbookSource object supplies merchant provenance. The native dataset snapshot, exact buyer configuration, original offer and acquisition session remain the customer authorities. Publishing a newer workbook or rolling back does not redirect a pinned acquisition; normal seller expiry and original recovery rules still apply.

## Format sources and operating example

The retained [Census 2023 jam-value workbook](https://www2.census.gov/programs-surveys/acs/tech_docs/jam_values/2023_Jam_Values.xlsx) is an actual public source for the operating example. Worksheet Jam Values, source rows 21–36, contains topics and lower/upper interval meanings and special numeric values. A reviewed projection uses A→topic, B→lower_meaning, D→lower_value, E→upper_meaning and G→upper_value, with source header row 20. Numeric lower zero is preserved; meanings remain original strings, including original whitespace. These are published reference codes, not sampled measurements or a new paid transaction.

[Microsoft CellValue](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.cellvalue) describes original cell values and saved formula results. [Microsoft shared strings](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-the-shared-string-table) documents the indexed/rich-text source representation. [Excel date systems](https://openpyxl.readthedocs.io/en/stable/datetime.html) explain 1900/1904 serials and timezone limitations.
