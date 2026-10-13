# Customer measurement workbooks

Use **Customer task outcomes → Customer measurement workbook** inside the original Grant Operations case. The workbook covers the same complete comparison and recurring observations as the desk. A returned workbook is reviewed into an existing draft, then calculated and saved by the original comparison workflow.

## Prepare a useful measurement

Open the original saved comparison and choose **Edit this edition**, or continue its retained draft. Check the customer, complete task, output unit and selected installation. Identify the prior method and installed method with the actual input population, period, complete output and source edition.

Record active human effort separately from elapsed turnaround. Two people each working for 30 minutes contribute 60 person-minutes. Browser session duration and agent/tool runtime do not establish that effort. Enter an hourly valuation only when its source and use are explicit. A useful accepted comparison can remain unvalued.

Choose **Download editable workbook** for the complete XLSX, or **Download workbook and original input** for a ZIP containing:

- `measurements.xlsx`: the editable measurement workbook.
- `original-comparison.json`: the complete case, plan and comparison input used to produce it.
- `README.md`: the instructions included for the receiving team.

The export is available for both saved editions and drafts. It does not change the saved comparison.

## Worksheet fields

| Sheet | What to record |
| --- | --- |
| Comparison | Customer, task, unit, currency, review, conclusion and original installation selection. |
| Methods | Prior and installed methods, plus every recurring method: observation time, source edition, population, period, output, quality, counts, elapsed time and notes. |
| Recurring | Stable observation ID, label, comparability review, customer response and conclusion. |
| Effort | Active person-minutes, explicit hourly rate, category and measurement note for every work row. |
| Costs | Other cost amount and its original source note. |
| Selections | Original case source, deployment and purchase identities for the comparison and recurring observations. |
| Original | The complete export basis. Leave this hidden worksheet unchanged. |
| Read me | The complete receiving instructions. |

Each method has a stable ID: `baseline`, `installed`, or `observation:` followed by a recurring observation ID. Add a new observation to both **Recurring** and **Methods**. Add its effort, costs and source selections using the same method ID.

### Exact values and missing information

All exported cells are literal text. Keep decimal measurements as text, with no more than six fractional digits. A blank measure means **unknown**. Entering `0` records a known zero; receiving preserves the difference. Dates remain complete ISO timestamps with their offset and fractional seconds. Currency remains the original explicit currency for the whole comparison.

The receiver uses the original workbook reader and complete selected cells. It rejects formulas and error cells. If a spreadsheet calculation supplies a useful measurement, review it and paste its literal value into the measurement cell before returning the file. The workbook does not infer active effort, calculate an exchange rate or turn unknown costs into zeros.

Keep stable row IDs when making corrections. An omitted existing row stays in the comparison. To remove a work, cost or source-selection row, put `REMOVE` in its action column. Blank action means `UPSERT`. A saved recurring observation remains in the history and can be corrected in the next edition; only an observation marked unsaved in the original export can be removed through the workbook. If another comparison edition was saved after export, retain those observations and export a current workbook before removing one.

## Receive and reconcile the complete return

1. Open the original editable comparison. Choose **Receive returned workbook**, then select the complete returned XLSX.
2. The desk inspects and projects all seven data worksheets. It retains the original file, every selected cell, source row, mapping and projected value. Sheet names and headings must match the original export.
3. Review the proposed field and row changes. Independent desk changes made after export are kept. When the same value changed differently in both places, choose **Current desk** or **Returned workbook** for that conflict.
4. Use the worksheet selector and source pages to inspect exact values and original cell positions. **Download original returned XLSX** retains the file unchanged. **Download complete workbook review** retains all source selections and the current review.
5. Enter the workbook source and review note. Choose **Apply reviewed measurements**. The original XLSX is attached through the existing case source command, and its source ID is linked to the comparison methods.
6. Choose **Review complete comparison**. The original native model validates the measurements, selected installation, deployments, purchases and sources and calculates the comparison.
7. Review the findings and customer acceptance, then **Save reviewed edition**. The earlier saved comparison and its recurring observations remain available.

The workbook source and comparison save are two visible original operations. Applying a return prepares the draft; saving its reviewed edition records the customer comparison. If the draft changes while the source attachment is being received, the source is retained and the desk asks for another review before applying measurements.

Independent source selections merge by original identity. Adding the returned XLSX as a source does not remove another source added at the desk. A later change to the selected plan requires a fresh workbook from that current plan; the original export remains associated with its earlier plan.

## Continue after interruption or transfer

The complete editor recovery includes the original workbook, selected cells, current conflict choices, the completed applied review and its original choices, review note, working comparison and any pending source request. Download **Editor recovery** before moving to another browser or when browser storage reports that it is full.

A pending source request is recovered with its original request identity in the original case. Use **Recover original workbook source**; the desk preserves the same request while the response is uncertain. The recovered request cannot be moved into a different case. Once the source is saved, its receipt is reused when applying the reviewed draft.

An editor recovery without a pending request can be received into the same case or its original-case receiving continuation, with the same selected plan. The desk validates the complete workbook review; before applying a recovered review it reprojects the original XLSX through the native reader. Different retained drafts or workbook reviews are kept distinct until the operator reconciles them.

The original complete case export carries the saved comparison and attached XLSX. The editor recovery also carries unfinished selections and conflict choices. Retain both when unfinished work must travel with a saved case.

## Limits and existing operating behavior

The original case source allowance remains 8 MiB per attachment, 24 MiB total and 200 files. Complete editor recovery remains at most 32 MiB. The original model allows up to 100 recurring observations, and up to 100 effort or cost rows per method. These limits are shown when the complete file or draft would exceed them.

The workbook uses the current signed-in case, source commands, revision checks and save recovery. It adds no separate customer database, case, calculation model or automatic customer acceptance. The existing human-readable report, effort CSV, cost CSV and complete case receiving remain available after saving.
