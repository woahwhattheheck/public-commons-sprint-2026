# Continue customer workbook columns after an Event source changes

This is the existing Event programme's worksheet continuation. A customer's later
source may rename, remove or reorder a field that their saved workbook uses.
The original native programme retains its complete proposal, original columns
and new source. The operator reviews those actual choices in the same Event
browser, saves or reopens them, and continues the original pending apply.

The customer workbook, its earlier definitions, source identities, report,
native conversion rules and whole workspace archive remain in the original
Analysis workspace. This editor supplies complete reviewed column arrays to
that existing writer.

## 1. Open the original pending worksheet proposal

Complete the original source review and apply using the customer's real event
pair and accepted payload mapping. If the native result says
WORKBOOK_COLUMN_CHOICES_REQUIRED, the same page opens **Continue the customer
worksheet**. Reopening that saved action or the original programme brings back
the full proposal.

Each unresolved sheet shows its original name and zero-based worksheet index.
The complete source panel retains its new source kind, ID, SHA-256, full column
inventory and complete preceding column definitions. Report columns also retain
their original zero-based ordinals, so two identically named report columns
remain distinguishable. Query-export columns use their actual unique names.

The initial editable rows are the complete original columns. An unavailable or
ambiguous old source is labelled for explicit selection. It is not substituted
with the first new column.

The same original apply decision remains in force. Keep its original note when
continuing. For deliberately changed customer report/workbook/view definitions,
use the existing **Review current customer edits** workflow, inspect its new
review and select the new proposal. The preceding attempts stay in the native
programme history.

## 2. Review the complete worksheet

Select a worksheet, then work through its retained output columns. Twenty rows
are displayed at a time; every row remains in the complete editable selection.
The controls let the operator:

- Select the exact new source column, with report ordinal where required.
- Keep or edit the customer's full Excel heading.
- Keep or explicitly change the existing native conversion type.
- Retain a complete null label or select a blank Excel cell.
- Preserve exact precision or explicitly choose Excel numeric precision.
- Move a column earlier or later, remove an output column, or add a new one.
- Restore that sheet's complete original choices after an explicit decision.

A newly added column begins unfinished. Removing an output column changes the
selected workbook projection; the complete acquired event table and original
source files remain in their existing full delivery.

The editor retains headings, conversions, null labels and precision when the
operator selects a replacement source. Alternative null text remains saved
even while blank null cells are selected. Source fields and headers remain
complete original strings.

All ten existing native conversion choices are available: native, text,
integer, number, decimal-text, boolean, date, datetime-utc, datetime-local and
binary-base64. Exact event identifiers and payloads normally remain text.
Decimal-text preserves the original decimal spelling and scale. Preserve keeps
values beyond Excel precision as text; excel-number is an explicit choice.

The local form checks references, required headings, selected enums, exact
UTF-8 byte allowances and XML-safe text (2000 bytes per heading and 1000 per
null label). Its full review explicitly carries pending native checks. The original native WorkbookRefresh remains authoritative for full
source-row conversion, source revisions, case-folded heading uniqueness and
the complete workbook definition. The editor does not infer that every source
value converts merely from a valid selection.

If an earlier call already supplied complete arrays for other sheets, those
arrays remain attached. The interface exposes their complete JSON and carries
them through save, reopen, readable review and apply. Only the unresolved
sheets need the new source-selection controls.

## 3. Retain and independently reopen all choices

**Download complete choices** saves one full JSON handover. It includes the
original customer workspace, programme, pending operation, exact review hash,
whole native worksheet proposal, every preceding column definition, all new
source identities and every current selected column array. Unfinished headings
or absent old source choices may be saved and resumed.

Use **Reopen complete choices** to select that whole file. The complete original
binding must match the displayed proposal before any current choice changes.
Replacement requires an explicit operator decision. A corrupt file, another
workspace/review/source, a concurrent source selection or an edit made while
the file opens leaves the current working choices intact.

The browser retains a supplementary copy under this exact source binding. If
that saved copy differs from the opened original choices, it offers **Restore
browser choices**. Restoring is explicit. Downloading the complete file remains
available if browser storage is unavailable.

**Download complete readable review** produces a standalone HTML document with
all selected worksheet rows, original source identities, preceding definitions,
remaining incomplete choices and retained additional arrays. Open that exact
file in a browser or print it. Its whole rows are independent of the page
currently shown in the editor.

The advanced panel retains the complete native proposal and column JSON.
**Review these complete column arrays** loads a complete object into the same
structured review, preserving every unresolved sheet. Invalid arrays leave the
current editor intact. The ordinary controls and full JSON describe the same
selected work.

## 4. Continue the original apply and delivery

After every required sheet has at least one resolved output column and complete
headings, use the existing **Apply reviewed window** button. The browser supplies
the full selected arrays with the existing programme, source operation, exact
review digest and customer note. The existing action table retains that request
before native execution.

The original programme checks current source/view/report/workbook identity,
reviews complete conversions and saves through the original workbook API.
An uncertain response continues through the same saved action and request.
If that native operation reports a conversion or customer-definition issue,
read its retained result and correct the actual selected choices or explicitly
refresh the current customer review.

Once applied, use the original complete delivery. Open Event_Analysis.xlsx and
its whole Event_Workbook_Handover.zip, inspect the actual selected headings and
types, and restore the original native workspace. Continue a genuinely later
window through the same customer programme. The source changes, selections,
previous definitions and native result retain their original history.

This continuation does not add a purchase or another source acquisition.
The independent buyer's existing journal and transfer references still own
that original financial operation.

## 5. CLI preparation and agent use

The portable module and CLI are shipped alongside the original Event source
projector under sf88-operator-buyer-cli/event-feed. They need the maintained
Node.js runtime and no additional package. The maintained distribution exposes
**starforge event-workbook-columns** with the same four commands, and exports
the portable core as **./buyer/event-workbook-columns**. The direct source
invocations below run from the installed sf88-operator-buyer-cli directory.

Download the **complete native action record** using the original agent's
event-action / complete_record receiving path, or retain the full
WORKBOOK_COLUMN_CHOICES_REQUIRED result from the existing native CLI. Use that
actual result to create the complete editable handover:

~~~sh
node event-feed/workbook-columns-cli.mjs template \
  --proposal /private/original-column-action.json \
  --workspace "$ORIGINAL_ANALYSIS_WORKSPACE_ID" \
  --programme "$ORIGINAL_PROGRAMME" \
  --out /private/customer-column-choices.json
~~~

The proposal file may contain the complete native result directly or its
original action envelope with result. Keep the actual workspace UUID distinct
from the agent's configured Analysis alias. Retain the original JSON as the
source; the template keeps its full original proposal unchanged.

Open the saved choice file in the existing browser to use the structured
editor, or edit its complete columns object using the documented native column
fields. Inspect it and create the complete readable handover:

~~~sh
node event-feed/workbook-columns-cli.mjs inspect \
  --choices /private/customer-column-choices.json \
  --proposal /private/original-column-action.json \
  --workspace "$ORIGINAL_ANALYSIS_WORKSPACE_ID" \
  --programme "$ORIGINAL_PROGRAMME" \
  --out /private/complete-column-review.json

node event-feed/workbook-columns-cli.mjs html \
  --choices /private/customer-column-choices.json \
  --out /private/complete-column-review.html
~~~

The three original-binding flags are a group. Supplying them checks the saved
file against that selected native source; without them, inspection and HTML
reopen the complete source already embedded in the handover.

After reviewing all choices, derive the full native request field:

~~~sh
node event-feed/workbook-columns-cli.mjs columns \
  --choices /private/customer-column-choices.json \
  --proposal /private/original-column-action.json \
  --workspace "$ORIGINAL_ANALYSIS_WORKSPACE_ID" \
  --programme "$ORIGINAL_PROGRAMME" \
  --out /private/native-reviewed-columns.json
~~~

Pass that object as columns to the original event-apply operation, with its
same operation_id, selected review_sha256 and original note. Retain a new
action ID for the deliberately changed complete column input; continue that
same action ID only with its unchanged request after an uncertain reply.

The CLI accepts complete regular UTF-8 JSON files up to 16 MiB. It publishes
whole outputs using an exclusive temporary file and create-only link in an
existing private directory. An exact existing output reopens; different
existing work is preserved. It never contacts a host or starts a native action.

The shared module exports context, initial, reopen, sourceColumns,
selectedOrdinal, chooseSource, replaceColumns, review, nativeColumns and
reviewHTML for the same portable source-bound flow. The browser mount is
createEventWorkbookColumnReview. The native backend and original workbook
writer are unchanged.

## Complete original receiving and producer inspection

Continue the existing Mercury/Event customer operation and its actual source
pair, workspace, programme and installed source. Use a real later source whose
selected mapping changes a customer worksheet column. Preserve the prior
customer heading, null label, precision and type; review the original source
and select its actual replacement. With an existing report that contains
duplicate column labels, choose the correct retained ordinal explicitly.

Save mixed completed and unfinished choices. Move between worksheets and
column pages, download the full JSON and readable HTML, reopen both, and
restore browser choices only through the explicit control. Open an incompatible
saved file and observe that the current work remains. Change a choice while a
selected file opens; retain the current edit and reopen that file deliberately.

Use the same original note and exact native review to apply. Open the actual
resulting workbook and its complete handover, inspect every column meaning,
receive the whole customer package independently and cold-reopen the restored
original programme. Preserve the original case and all complete sixteen-file
Event delivery members through the existing Installation receiving path.

Before presenting the application, demonstration, report or export as ready,
the producing maintainer must open, run or render this exact outgoing source,
LOOK at its actual screen or returned real screenshots, and operate the
important controls at normal screenshare and relevant narrow/mobile widths.
Inspect populated, empty, loading and error states, all outgoing attachments,
downloads and reopening. Capturing images without viewing them is insufficient.
Code review, DOM counts, HTTP results, checks and a peer's approval do not
replace seeing the product. Play any included final media and inspect its
actual audio/video.

Keep plain industrial presentation: readable tables, clear hierarchy, useful
labels, consistent typography and spacing, restrained controls and responsive
layouts. Repair concrete layout or behavior issues in this same source.
Continue the complete original native operation; use focused checks for actual
remaining risks and retain the owner's October 13, 2026 14:00 UTC cutoff.
An equipped receiver returns exact source, original operation/workspace IDs,
complete files and actual viewed normal/narrow frames to the producer. Carry
this full instruction into any delegated operating course.
