# Tourism Series Workspace

This complete offline application retains original tourism observations, maps their actual source dimensions, records attributed corrections, freezes reproducible analyses and compares actual target CSV returns. Open **Tourism_Series_Workspace.html** in a current browser. It runs without a server, account, network request or third-party JavaScript.

The product begins blank. Source facts and commercial/customer material are separate editions loaded by the operator. This source does not embed a prospect list or a procurement response.

## Start and keep the complete record

1. Create a workspace or open an existing complete workspace/recovery JSON.
2. Enter the actual operator name. Retain original reports, source transcriptions and target templates under their explicit stable file IDs. Record the original URL, publisher, displayed edition, actual retrieval time and representation.
3. Import the complete original observation CSV with role **Original observation series**. UTF-8 bytes, headers, duplicate header positions, all literal cells and ragged rows are retained.
4. Load or author a complete registry and save it as an immutable edition. Retain each declared source file before saving the registry.
5. Map every canonical field to an exact zero-based source column or explicit literal constant. Unmapped fields remain findings. An empty constant stays empty.
6. Inspect all projected rows, source findings and coverage. Record corrections against a specific original row and cell with the actual operator and reason. Original values remain available.
7. Select an ordered set of source observations and a calculation. Preview the complete operands and qualification findings; freeze an analysis with an attributed interpretation.
8. Freeze a report from explicitly selected saved analyses. Prepare an actual supplied target CSV template, then import and reconcile the real returned CSV.
9. Download **the complete ZIP**, working HTML and recovery JSON. Open the downloaded working file independently and check its original rows, report and unfinished writing.

The application stores complete local copies in IndexedDB. Browser storage is not a substitute for a downloaded working file. File chooser selections cannot survive a browser reload; choose the original file again if it was not saved.

## Original dimensions and exact values

The source schema is described completely in API.md. Required canonical fields are observation_id, geography_id, period_start, period_end, metric_id, value, unit, multiplier, method_id, population, price_basis, source_id, source_locator, original_display, status and note.

Periods are half-open: the end date is excluded. A calendar 2024 observation is [2024-01-01, 2025-01-01). Original printed years and definitions remain in original_display, the source locator and retained evidence.

Decimal input is an exact string. Grouping marks, exponents and silently rounded values are rejected. Multiplier 1, 1000 or 1000000 is explicit. Missing, suppressed and unavailable observations have empty values, not zero. Literal CSV values and status remain unchanged in original source records.

The registry declares geographic parentage, documented partitions, metric units/currencies, populations, price bases and method editions. It separately records reviewed method comparability, ratio pairs and component relationships. Being in the same file does not make two observations comparable.

### Calculations

| Calculation | Required selection |
| --- | --- |
| Sum | One explicitly additive dimension. Geography requires a documented disjoint partition; selected members and incomplete coverage remain visible. Period sums retain the actual span and gaps. |
| Difference | Two comparable operands, second minus first. |
| Percentage change | Two comparable operands, first as baseline. A zero baseline yields no defined percentage. |
| Ratio | Numerator then denominator, using an explicitly declared pair and its exact dimension exceptions. The complete rational and six-place display are retained. |
| Reconcile | Published total first, then every declared component metric. The result preserves the printed total and reports components minus total. |
 
No calculation replaces a published value. An exact arithmetic discrepancy can be a useful qualified result. A tolerance is an explicit operator choice; it is not a statistical confidence interval. Parent and child geography, incompatible measured populations, incompatible methods and overlapping periods are not silently added. Website users remain a different metric from physical visitors.

A saved analysis retains its complete original operands and source basis. Later mapping or cell corrections do not change a frozen analysis. Save a new analysis/report edition for a later interpretation.

## Actual template and returned CSV

Retain the actual UTF-8 CSV template as an original file. The Target view shows every exact header and position. Map each column to a canonical observation field, normalized_value or rowId, or an explicit literal constant. Select the actual identity-key columns. Keys must be nonblank and unique in prepared rows.

The prepared plan retains the complete template identity, source selection, row identities, column mappings, exact CSV and SHA-256. Download that exact CSV. This action does not invoke a vendor API or execute an import.

After the intended platform operation, import its actual returned CSV with role **Actual returned target CSV**. Select the original plan and map every prepared column to its exact returned column position. The retained result exposes matched, missing, unexpected, duplicate and differing rows. Native extra columns survive. An unsuccessful or partial comparison remains a complete receiving edition; it does not rewrite the original observations.

## Unfinished writing, two tabs and reopening

Each form retains literal strings and checkbox booleans per browser tab. Saving snapshots the form and selected files at click time, disables controls during asynchronous reads, applies the complete engine operation and commits the new workspace plus deletion of only the submitted draft in one IndexedDB transaction.

If another tab saved first, the application retains the full prior, current and candidate workspaces and unfinished writing. It presents both branches. Continue one as an independent copy or open the current saved copy. No branch is silently overwritten.

An old working HTML reopens the newer local descendant where its exact saved copy already exists. Its embedded unfinished writing is restored when the new tab has no newer writing. Different embedded/local drafts remain separately recoverable in History. A different workspace branch opens as a new local copy.

A recovered form that began at an earlier workspace head requires explicit review and **Use these values for the current revision** before submission. This preserves the raw writing while avoiding silent rebinding.

Complete engine workspace JSON is limited to 128 MiB of actual pretty-printed UTF-8. The entire recovery envelope is also limited to 128 MiB including raw form drafts and selection. A workspace at its engine ceiling may therefore require downloading unfinished values separately; the additional recovery envelope must fit its own limit. Each original file/CSV is limited to 32 MiB. Source ceilings are not throughput claims. Raw unfinished values can be downloaded separately if a complete recovery reaches its limit.

## Full source and command line

Node.js 22+ is suitable for the maintained source. Keep the complete services/tourism-series-workspace/ selection together, including its API, CORE_OPERATING guide, blank CSV template and native callback. The original services/migration-receiving/continuation.mjs is its one receiving dependency. Complete ZIPs preserve these relative sibling directories under source/.

Build a blank complete application:

    node build.mjs --out /absolute/new-blank-directory

Build a complete working delivery from original engine JSON or recovery JSON:

    node build.mjs --out /absolute/new-delivery-directory \
      --workspace /absolute/Working_Recovery.json \
      --copy-id original-browser-copy-id

The output includes the working HTML, complete original engine handover, recovery JSON, full source and a ZIP. Outputs publish create-only; an identical completed output can be adopted after a lost reply. A different existing edition is rejected.

The existing cli.mjs operates the same pure engine and original saved workspace:

    node cli.mjs init --workspace /absolute/workspace.json \
      --id original-workspace-id --title "Source review" --at 2026-10-13T17:00:00.000Z
    node cli.mjs apply --workspace /absolute/workspace.json \
      --request /absolute/saved-operation.json --file /absolute/original.csv
    node cli.mjs inspect --workspace /absolute/workspace.json
    node cli.mjs project --workspace /absolute/workspace.json \
      --input /absolute/selection.json --out /absolute/project.json
    node cli.mjs analyze --workspace /absolute/workspace.json \
      --input /absolute/calculation.json --out /absolute/calculation-result.json
    node cli.mjs report --workspace /absolute/workspace.json \
      --out /absolute/report.html
    node cli.mjs handover --workspace /absolute/workspace.json \
      --out /absolute/complete-engine-handover
    node cli.mjs receive --workspace /absolute/independent-workspace.json \
      --input /absolute/workspace.json

Use build.mjs for the full working application ZIP in addition to the engine handover. cli.mjs uses a kernel-held same-workspace lease on Linux/Windows. Its saved request must retain action and the complete original input including operationId, expectedRevision and at. The exact completed request is replayed before revision comparison. Completed import replay can recover the original bytes after a staging file disappears. A changed request under the same ID is rejected.

## Delivery and installation boundaries

The offline application prepares source-qualified files and records a real returned file. Hosting, licensing, permissions, paid/live feeds, integration credentials and target import execution are separately defined partner/platform responsibilities. Keep the complete original evidence and contract with any actual implementation workshare.

Follow BROWSER_OPERATING.md for the original receiving programme. Producing workers must actually run and use the exact outgoing files and inspect the rendered screens/attachments before calling them ready. Preserve the same programme and explicit source edition when continuing a native run.
