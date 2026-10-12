# Load forecast review workspace

Use **Load forecasts** in the original Commons BI Operator to turn published forecast files into a retained analyst review and a complete, editable delivery. Sources, mappings, review plans, decisions, packages and received copies use the same local workspace, version history, object store, action journal and encrypted recovery as the other operating views.

## Start and open a source

Run the ordinary application from this directory:

    python -m venv .venv
    .venv/bin/python -m pip install -r requirements.txt
    .venv/bin/python BI_OPERATOR.py --workspace ./load-workspace serve

On Windows use .venv\Scripts\python.exe. Open the complete localhost address printed by the host, then select **Load forecasts → Sources**.

Retain the actual published XLSX workbook, comma-separated UTF-8 CSV, structured load-source JSON packet or reference PDF. Supply its source URL, publication date, publisher, vintage and publication role. Annual forecasts, informational updates, observed data, adjustment detail and reference documents remain distinct roles. The source record keeps its complete original bytes, filename, byte count and SHA256. **Download original** and **Source history** reopen those inputs.

A source edition moves through UPLOADED, MAPPED and ACCEPTED. Accepted editions remain fixed. **Create revised source edition** starts a linked copy for a changed mapping; uploading a replacement file may name an existing parent edition and requires a change note. The prior file and accepted observations remain available.

## Map exactly what the publisher reports

The source screen pages through original workbook cells and shows their original row numbers and column letters. Add one explicit mapping per selected table.

| Mapping choice | Meaning |
|---|---|
| Years across columns | A period heading row, first and last value columns, first and last data rows, and a geography column. |
| One observation per row | Explicit period and value columns with selected data rows and a geography column. |
| Geography column 0 | All selected values use the stated single geography. |
| Geography aliases | An explicit original label = reviewed label mapping. The original label remains on every observation. |
| Planning area and geography | Distinguish an RTO total, LDA, utility, zone or other source-defined area. |
| Metric and physical unit | Peak demand or energy, with the original kW/MW/GW or kWh/MWh/GWh/TWh unit. |
| Signal | Forecast, actual observation, weather-normalized observation or signed adjustment. |
| Peak coincidence | Coincident, noncoincident, or not applicable for energy. |
| Comparable definition / basis | The meaning needed for a valid comparison, such as unrestricted coincident system peak. |

Do not select chart labels, totals and their components as though they were one additive series. Each canonical geography/metric/period/definition/signal must be unique within a source edition; overlapping mapped tables are rejected.

Power values normalize to MW and energy values to MWh with decimal arithmetic. Source quantities support up to 60 coefficient digits and 60 fractional places, with absolute magnitude at most 1e18 in their original unit. JSON fractional numbers are parsed directly as Decimal; decimal-text fields preserve the same digits. Conversion, differences and accumulated adjustments use a shared 128-digit context sufficient for the supported source bounds and row count. Ratios, WAPE and CAGR use 40 significant digits with half-even rounding. Computed fixed-point output is bounded to 2,048 characters before formatting. Energy and power stay separate. The XLSX reader consumes the numeric value actually retained in the workbook, including cached formula results. It does not calculate workbook formulas or run external workbook links. A selected formula without a cached numeric result must be resolved in the original workbook before that field can be mapped. The complete file stays retained throughout.

Blank, dash and the configured missing markers stay in **Missing original cells**. They do not become zero. Review the missing-cell count before accepting an edition. The accepted review binds both the original file and normalized observations.

### Preserve the published period

A calendar or summer year remains its labeled year. Winter and delivery periods accept an explicit consecutive-year span such as 2026/27. When a publisher uses only one winter or delivery year, choose whether it names the start or end year. This retains the actual year span; it does not assign invented seasonal months. Monthly inputs use YYYY-MM and their calendar boundaries. Keep distinct period definitions distinct even when they end in the same year.

## Prepare an analyst comparison

Open **Review plans**, select exact accepted baseline and current source editions, name the client or research question, and state the comparison assumptions. Filter the actual planning areas, geographies, metrics, seasons and years as needed. A cleared selection includes all values in that dimension.

Two review modes have different meanings:

- **Compare forecast vintages** compares forecast values from two retained editions.
- **Compare forecast with observations** compares a retained forecast with explicitly selected actual or weather-normalized observations. It is the mode that calculates accuracy.

The join uses planning area, reviewed geography, metric, season, exact period, period definition, peak coincidence, comparable basis and canonical unit. Every compatible matched observation appears once. Rows present in only one source remain baseline-only or current-only. Coverage gaps and differing source publication roles are explicit review issues.

For a matched observation, change is current minus baseline. Percentage change divides that difference by the absolute baseline. A zero baseline has no percentage change. Forecast accuracy uses weighted absolute percentage error: the sum of absolute forecast errors divided by the sum of absolute observed values, reported within a compatible geography/metric/season/definition series. A forecast-vintage revision is not described as forecast error.

Growth uses the first and last **common** selected periods of each compatible series. Its amount is the change between those endpoints; CAGR uses the actual year interval. Missing intermediate common periods are listed. The application does not sum coincident/noncoincident peaks, zones, subzones, RTO totals or different physical quantities.

### Attach a sourced explanation

A published adjustment is a separate input with signal **Signed adjustment**. Retain, map and accept that original file. On a prepared comparison choose **Explain** beside an actual matched observation. Select the exact adjustment source edition and original cell, choose addition or subtraction, and explain the relationship.

The adjustment must match the comparison's area, geography, metric, season, period, peak definition, comparable basis and physical dimension. Each selected source cell is applied at most once. The report retains its original signed amount, chosen direction, explained amount and remaining difference. Published baseline and current forecasts are unchanged.

Supporting PDFs and other accepted source editions can accompany the plan as documentation. They stay in the selected source closure and final delivery.

## Review, finalize and update

**Save plan and prepare comparison** creates a retained calculation. The analyst screen pages through the complete comparison, common-period growth, sourced explanations and issues. Search applies to the complete selected table.

Record a conclusion and acknowledge the listed source and coverage issues. Individual observations can be marked Reviewed, Follow up or Exclude from interpretation with a reason. Those decisions remain visible; they do not rewrite or remove source observations. Save the decisions, then finalize the exact reviewed report.

While a save or complete original-file read is running, the load editor and its selected source remain read-only. The host continues that exact submitted request; completion reopens the committed edition before the editor is available again. A failed request keeps the existing draft for the original retry.

Editors retain the revision from which their local fields were opened. If another change appears, the view offers **Discard local edits and reload**. Saving against the retained older revision receives the original conflict response. Refreshing the screen cannot silently apply old fields to a newer record.

A finalized review can be reopened as a new review edition. Its prior finalized revision remains addressable. A new source or changed plan produces a new prepared comparison. Previously exported packages keep their original identity.

## Deliver the complete work

**Build complete analyst delivery** produces one original ZIP with:

| Member | Contents |
|---|---|
| Load_Forecast_Review.xlsx | Ten editable sheets containing the review, every comparison, series growth, sourced explanations, source issues, decisions, source inventory, original observations, table mappings and missing original cells. |
| tables/*.csv | The same complete table data, with decimal values and ordinary CSV quoting. Text beginning with spreadsheet formula characters is kept as text. |
| Load_Forecast_Review.html | Printable analyst overview, all series growth, source issues, conclusion and decisions. Its comparison preview explicitly states its first-300-row display; the workbook, CSV and JSON retain every comparison. |
| report.json and review.json | Complete source-bound calculation and exact finalized review record. |
| sources/ID-rREV/ | Each exact source record, its original file under original/, and its normalized observations where applicable. |
| manifest.json | Member names, byte counts and SHA256 values, exact review identity and report SHA256. |
| RECEIVING.md | Ordinary open, receive, continue and recovery instructions. |

The complete ZIP, editable workbook and HTML report are also separate normal downloads in the retained delivery list. A source originally named record.json or normalised.json stays under its own original/ namespace and cannot replace package metadata.

The package limit is 64 MiB. Each workbook has at most 300 sheets; a source has at most 100,000 mapped observations, and a selected mapping reads at most two million cells. Very large source collections can be split into meaningful complete reviews while the ordinary encrypted workspace backup retains the cumulative operation.

## Receive and continue the actual package

In a second ordinary workspace open **Receiving** and select the complete original ZIP. The receiving path verifies the manifest and every member, reopens each original source, reruns its retained mapping and recalculates the same prepared review. Source closure, finalized report identity, reviewer decisions and all selected records must agree.

The received package can be inspected and downloaded immediately. **Continue as an editable plan** imports its sources through the original source-upload, mapping and acceptance actions, then saves an ordinary local review plan. It preserves original source identity and links the editable plan to the received package. The delivered finalized review remains retained.

Adoption uses stable child operation IDs for the exact received record. Reopening a completed adoption returns the same editable plan. If an operation loses its response, use the application's **Retry original request**. The original journal first checks the exact action and request digest, then reopens any already committed root or child record. An interrupted adoption or its local source-upload, mapping, acceptance or plan child can resume that same operation when its exact request has no committed record. Existing original source objects are reused by digest, and the journal retains the original operation ID and a resumption event.

## Native automation and recovery

The browser and command line invoke the same original actions:

    python BI_OPERATOR.py --workspace ./load-workspace action load.plan.save plan-request.json
    python BI_OPERATOR.py --workspace ./load-workspace action load.review.prepare review-request.json

Every request accepts a stable operation_id and actor. Existing records use id and expected revision. Source and plan references are objects with kind, id and revision. File imports use the original filename plus complete base64 bytes. The server routes these through its existing authenticated /api/action/* endpoint; /api/load/preview supplies paged read-only views.

The additive action family is source.upload, source.describe, source.map, source.accept, source.revise, plan.save, review.prepare, review.decide, review.finalize, review.reopen, review.export, delivery.receive and delivery.adopt, each prefixed load.

Use **Handoff & recovery → Encrypted recovery** to back up the complete current workspace. Stop its operator before restoring into a new directory:

    python BI_OPERATOR.py restore workspace.bi-backup ./restored-load-workspace
    python BI_OPERATOR.py --workspace ./restored-load-workspace serve

The original backup retains all source bytes, revisions, operation outcomes, adopted plans and delivered packages. Restoring renews the private browser access token while retaining the original business identities.

### Saved edits and receiving size

The Source view shows mapped observations and missing cells for structured source packets as well as workbooks. Save a changed source description before mapping edited tables; the table edits remain in the editor. Accept is available after the description and mappings match their saved edition. Finalize likewise uses the saved conclusion and row decisions. Revision checks still reject a stale editor when another operator has saved the same record.

A complete receiving package supports at most 64 MiB compressed, 6,000 files, 64 MiB per member, 256 MiB expanded and a 2 MiB member manifest. Export and receiving share the member envelope. If a review exceeds it, narrow the selected original source scope and produce separate complete reviews. Editable receiving preserves the source's original acceptance note and binds its provenance through the retained package and source map.
