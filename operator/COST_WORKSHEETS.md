# Bulk implementation-cost worksheets

The Economic desk exports the alternatives from the selected original report
and reporting zone as a CSV worksheet or a complete JSON worksheet. A reviewed
worksheet can be imported, compared row by row with the current form, and applied
to the existing economic decision workflow.

## Operator journey

1. Open **Economic desk**, select the completed native report and reporting zone,
   and retain the intended edition title, budget and physical targets.
2. Choose **Download cost worksheet CSV** for spreadsheet editing, or
   **Download cost worksheet JSON** to continue with a structured document.
   Both formats carry the selected project, original report, report-file SHA256,
   zone, scenario run IDs and scenario labels.
3. Fill in the actual implementation estimates. Set **include_cost** to **yes**
   for reviewed CSV estimates; JSON uses the cost value's boolean **enabled**.
   Keep the exact run IDs, original labels and identity columns. A row can stay
   unchecked while its estimate is incomplete.
4. Under **Review completed worksheet**, select the finished file. Inspect the
   proposed changes for every row. The preview shows old and new values,
   included estimates, other unchanged alternatives, and any row errors.
5. Choose **Apply reviewed worksheet**. Then use **Calculate decision preview**,
   **Save inputs to workspace**, or **Build and open complete edition**. The
   existing completed-edition **Prepare client report** action carries the same
   economic edition into the client-report workflow.

Applying a worksheet updates the working form. Saving or building through the
existing queue retains those inputs in the Workspace. **Cancel worksheet
preview** leaves the form as entered. Any change to economic inputs after the
preview requires a fresh preview before the worksheet can be applied.

## Columns and units

| Column | Meaning |
| --- | --- |
| worksheet_schema | Original worksheet format identifier |
| project_id, report_id, report_sha256, zone_id | Exact original project, report bytes and reporting zone |
| run_id, scenario_label | Original compatible alternative |
| include_cost | yes or no |
| currency | Three-letter currency, such as USD |
| capital | Full upfront implementation expenditure |
| annual_operating | Constant annual operating expenditure |
| horizon_years | Positive service horizon in years |
| discount_percent | Nonnegative real discount rate in percent; 3 means 3% |
| cost_scope | whole-scenario or reporting-zone; exported retained scopes keep their original record |
| source_title, source_uri, source_as_of | Actual estimate title, document reference and ISO calendar date |
| note | Footprint, installed quantities, assumptions and estimate explanation |
| retained_cost_json | Original complete cost-form record; preserve this exported cell |

All amounts apply to the cost footprint stated in the row. The reporting
watershed's area does not prorate them. Capital and annual operating expenditure
need explicit zeroes when the corresponding amount is zero. The backend performs
the existing annualization and physical comparison after the worksheet enters
the ordinary workflow.

Program assistance is a funding contribution. Use an actual gross implementation
estimate for the ordinary capital and operating fields. Keep assistance,
eligibility and practice references in the original estimate notes where
relevant. [Cost source intake](../model/COST_SOURCE_INTAKE.md) describes the
published South Carolina assistance and charge components.

The CSV uses quoted UTF-8 fields and a byte-order mark. Exported cells carry a
leading apostrophe as a literal-text marker to keep identifiers and references
from becoming spreadsheet numbers or formulas. The importer removes one such
marker. It accepts ordinary unprefixed values entered by the reviewer as well.
Quoted commas, quotation marks and multiline notes remain intact. Decimal values
use a period and can use scientific notation; currency symbols and thousands
separators belong outside numeric cells.

## Original source and repeated operation

Every import is tied to the selected original report bytes and reporting zone.
A worksheet from another report, changed report file, other project or other
zone must be reopened with its own source selection. Duplicate scenario rows,
unknown runs, altered labels, missing columns, invalid dates and invalid enabled
costs are shown as errors. The form applies all valid reviewed rows together only
after the complete worksheet passes. A subset of the original scenarios is
supported: rows omitted from the file preserve their current estimates.

Existing complete cost records and their provenance survive the update. Current
retained metadata takes precedence over an older worksheet's metadata; editable
amounts and source-entry fields use the reviewed incoming values. JSON worksheets
preserve full records directly; CSV retains them in **retained_cost_json**. A fresh
desk adopts the worksheet's retained record on the verified report/hash/zone
binding. The preview exposes additions and changes to source and estimate
provenance separately from the editable amounts.
Enabling a zone-specific estimate after an earlier zone change records its prior
footprint in the retained review provenance.

Imported original UTF-8 file text, filename, file SHA256, import time, original
report/zone identity and affected run IDs are retained under
**selection.cost_worksheets**. They travel through the existing saved input,
complete economic edition and client-report economic package. The form exposes
**Download original** for every retained worksheet. Downloaded original text
preserves its byte-order mark and line endings. Reimporting identical bytes keeps
one source record while allowing a new preview of current inputs.

A file can contain up to 1 MiB. Split a larger table into subsets of original
scenario rows; each applied source stays with the edition. Worksheet intake is a
browser-side operation. Model results, quantities, parameters and run states stay
with their original retained report.

## Installation

The extension manifest registers **economic_cost_worksheet.mjs** through the
existing web-asset allowlist. **install_economic_desk.py** installs it with the
desk module and existing backend. Install the complete current feature source so
the browser import, manifest and receiving inventory remain together. Full
repository installation includes these same files.

The worksheet module contains pure parsing, export, preview and application
functions. The operator supplies the existing source, current draft and browser
file read, then reuses the normal authenticated economic preview and queue
actions.
