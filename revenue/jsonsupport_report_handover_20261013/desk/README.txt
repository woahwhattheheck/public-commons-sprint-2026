JSON SUPPORT — REPORT HANDOVER DESK
Operator guide · 13 October 2026

OPEN THE CORRECT EDITION
Open app.html in a modern browser. The free edition contains SmoothWork. The paid edition contains the five original additional agency profiles. Each edition keeps its own complete working file and browser storage. Original research, contact routes and source URLs remain attached to each agency.

1. SELECT THE ACTUAL REPORT
Use Agency context to review the agency's current workflow. In Report setup, enter the actual client, reporting system, operator, recipient and cadence. Choose the route you intend to operate: browser converter, authenticated API or configured email webhook. Keep the report's existing formulas, transformations and delivery arrangements in the source process.

2. PREPARE A REPRESENTATIVE SAMPLE
Paste or open up to 1 MiB of JSON or JSON Lines. For JSON, a blank records pointer selects the whole value; /records selects a records array. A single selected object becomes one row. JSON Lines treats each nonempty line as one object.

Enter explicit output headings and JSON pointers. /customer/name selects a nested property. Escape ~ as ~0 and / as ~1 inside property names. Use text for references such as 00017. Number accepts finite values within JavaScript's exact integer range. Unsafe integers and nonfinite values are rejected with a correction prompt; quote identifiers and precise decimal values in the source and keep them as text. Date requires an actual YYYY-MM-DD calendar date. JSON serializes an object/list into text. Preserve retains the selected JSON value. Missing optional values become null.

Preview the current fields and resolve every required-field/type issue. Preview shows the first 25 rows; output files retain all mapped rows. The desk allows at most 20,000 sample records, 128 columns and 200,000 selected cells. These are preparation-desk limits, not statements of a vendor account's limits.

3. SAVE AND OPERATE THE SELECTED ROUTE
Save report. Conversion and results provides the exact documented API request, { "data": [ mapped records ] }, and a local review CSV. The review CSV protects spreadsheet formula-like strings with a leading apostrophe. The API request retains the original mapped values.

For an authenticated conversion, use the included conversion-adapter.mjs and its full operator guide with Node 22+. Credentials come from your existing terminal environment. The adapter makes the explicitly selected request, saves the complete returned output and records its operation. Read its --help and included guide before invoking it.

For JSON Support's browser converter or a configured email webhook, use the actual vendor account and agreed recipient. The browser route and service routes have different data-processing contexts. Review the current vendor documentation and privacy terms for the selected route. The desk itself stores data only in its browser session or the working files you download.

Current source reviewed 13 October 2026:
https://www.jsonsupport.com/
https://www.jsonsupport.com/developers.html
https://www.jsonsupport.com/privacy.html
The developer page describes forward JSON-to-XLSX and reverse XLSX/CSV-to-JSON endpoints, x-api-key authentication and a Pro inbound email webhook. Confirm current account entitlements, limits and pricing in the actual account when commissioning a workflow.

4. INSPECT AND RECORD THE ACTUAL RESULT
Open the returned workbook with the intended spreadsheet software and inspect headers, identifiers, dates, numeric values, row totals and delivery. Record the actual output filename, observed rows, time and decision. Enter factual notes about the operation and the remaining changes.

For an actual reverse-conversion response, paste the raw array of records or the vendor's {data:[…]} JSON response. Compare returned JSON checks all row positions, field names, values and types against the saved mapped sample. It shows up to 50 differing rows while counting the full difference. It is an exact structured-data comparison; use the workbook inspection for formatting, formulas and spreadsheet behavior.

A changed report configuration or source marks earlier results as belonging to an earlier report. Their original notes stay in the complete working file.

5. HAND OVER AND CONTINUE
Save a named handover after the report sample is valid. Each handover retains its full configuration, original sample, selected columns and all prepared rows. Download its full JSON and readable HTML report. Later edits preserve earlier handovers.

Download the complete working file after meaningful edits. It contains original research, every agency project, saved proposal history, actual result notes and named handovers. Open working file verifies the original edition and complete operation history before receiving it. The complete saved working file is limited to 20 MiB. A change that would exceed that full export size is refused before saving. Download the current complete copy, then open the original working.json from the selected edition to begin another report with a smaller representative sample; the downloaded earlier copy remains available.

The application uses browser storage when available. Session mode keeps all functionality available when storage is denied or full; download the working file before closing that session. A stale tab refuses to overwrite a newer browser copy. Use Reopen browser copy to continue the latest saved copy. Unsaved form changes require an explicit discard before switching agency or section.

COMPLETE SOURCE
Download application source supplies every file required to rebuild this same edition, its opening working file, complete model, renderer, adapter and guides. Use the included rebuild.cjs under Node 22+:
node rebuild.cjs --source report-sample/application-source.json --output-dir ./received-report-app
Choose the source path from the selected edition and an absent output directory. This receives every complete source file and rebuilds app.html in that new directory. The complete customer ZIP also retains all original agency HTML/CSV/JSON profiles and instructions.
