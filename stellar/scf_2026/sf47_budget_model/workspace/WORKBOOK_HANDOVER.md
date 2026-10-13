# Editable planning workbook handover

Export a selected saved plan from **Source tables → Export saved plan workbook**. The download contains an editable XLSX, the exact saved native planning ZIP, a complete source project, the four worksheet mappings and their original-reader CSV projections. Open the complete source project when receiving the edited workbook.

The workbook uses the existing work-package, milestone, contributor and assignment fields. Grant Operations continues to calculate the reviewed plan, retain named revisions and export the complete editable case.

## Browser workflow

1. Save the plan revision you want the recipient to edit. The workbook panel identifies that saved revision.
2. Open **Export choices**. Select exact text or spreadsheet numbers, how to handle values outside the numeric precision policy, whether hours-priced amount cells contain saved values or formulas, and a handover note.
3. Select **Export saved plan workbook**. Keep the complete downloaded ZIP. Its planning.xlsx is the recipient's editable copy.
4. Select **Use exported source project**, or reopen planning-source-project.json from the downloaded handover later. Opening a different project downloads the previous working source project first.
5. After the recipient returns their XLSX, open **Receive an edited workbook**. Choose merge or replacement separately for all four collections, decide how to handle references to removed rows and hidden rows, and enter the receiving note.
6. Select **Receive returned workbook**. All four sheets are inspected and mapped using their exact exported names and headings. The retained original bytes, cell values, formulas, source positions, exclusions and selected policies remain available.
7. Review each role with **Review current table mapping**. Review the source-edition comparison and every changed row. Update **Plan settings** if the requested award, scenario description or completion day also changes.
8. Select **Calculate native preview**. Review the complete work, hours, prices, milestones, capacity, cash timing and changes. Apply the reviewed result to the working plan, then use **Save revision**.
9. Export a new complete workbook handover for the saved result. The original XLSX editions and their source selections remain in the retained planning case.

The workbook is drawn from a saved revision. Working edits enter it after saving. Downloading an earlier selected revision uses that immutable revision and its earlier history, even if another operator has saved a newer current revision.

## What the recipient edits

| Worksheet | Existing record key | Editable fields |
| --- | --- | --- |
| Work packages | id | Tranche, start and end days, estimated hours, assumed rate, amount, category, remaining work, measurable completion assessment and pricing mode |
| Milestones | tranche | Submission day, review and payment delay, deliverable and measurable completion assessment |
| Contributors | id | Name, weekly hours and capacity note |
| Assignments | costId + contributorId | Assigned hours |
| Read me | Reference information | Identifies the saved plan, number choices and operating instructions |

Keep the four planning worksheet names and exact first-row headings. Add rows immediately below the header or at the bottom. Keep existing identifiers when changing existing records. The complete observed source range is used, so added rows are retained. A changed column layout can be received through the existing individual worksheet selector with an explicit mapping.

The Read me sheet is reference information. Change the requested award, scenario description, completion day, calendar and other plan settings in the existing planning application. Their saved values and the full native plan accompany the workbook.

**Merge** applies the listed identifiers and retains other existing records. **Replace** uses the returned rows as that entire collection; an empty returned sheet therefore clears that collection. Choose replacement explicitly. The separate dependent-record choice determines whether assignments and payment settings affected by removed inputs remain for review or are removed. Every decision is retained in the source project and native preview.

Hidden worksheet rows are excluded unless the receiving profile explicitly includes them. Completely blank rows are skipped. Merged cells, unexpected headings, error cells and formulas in unsupported fields require an explicit individual worksheet selection.

## Decimal and formula choices

**Exact text** preserves the saved spelling of every decimal. It is the default and is appropriate when exact decimals must survive spreadsheet editing. Identifiers, descriptions and other nonnumeric fields are always text.

**Spreadsheet numbers** makes integer and decimal fields ordinary numeric cells only within the selected policy: at most 15 significant decimal digits and decimal magnitude from -307 through 307. The profile separately chooses whether an out-of-policy value remains exact text or stops the export. WORKBOOK_EXPORT.json records every affected cell, original value and storage decision. This policy does not round the source.

Spreadsheet applications use finite numeric precision. Even ordinary decimal fractions can change after arithmetic. Exact text retains the original values; the native planner uses its original Decimal calculations. Microsoft's explanation is linked below.

**Hours × rate formulas** is available with spreadsheet numbers. For an hours-priced work package, its amount cell references that row's hours and rate. The formula initially carries the original saved native amount as its cached result. Other amount cells retain their saved values. If an operand or amount exceeds the chosen numeric policy, the selected text policy keeps the original amount; the reject policy stops and identifies the value.

When editing formulas, use a spreadsheet application to recalculate and save the workbook. The receiver reads the selected stored result and retains the original formula. It does not recalculate Excel formulas. The existing native planner recalculates hours-priced amounts from the reviewed hours and rates and shows the complete result.

## Complete handover files

| File | Purpose |
| --- | --- |
| planning.xlsx | Editable five-sheet workbook from the selected native plan |
| planning.zip | Complete original planning ZIP and consecutive saved history |
| planning-source-project.json | Editable source project, original workbook bytes, exact selected cells, mappings, source editions and reviews |
| WORKBOOK_PROFILE.json | Saved export choices |
| RETURN_PROFILE.json | Explicit four-role receiving and reference choices |
| WORKBOOK_EXPORT.json | Selected plan identity, file hashes, source rows and all numeric storage decisions |
| WORKBOOK_GUIDE.md | Instructions specialized to this saved handover |
| mappings/packages.json, milestones.json, contributors.json, assignments.json | Four exact worksheet selections and conversion policies |
| tables/packages.csv, milestones.csv, contributors.csv, assignments.csv | Original-reader CSV projections of the exported sheets |

The complete kit has 15 files. The CLI also writes planning-workbook-handover.zip alongside those files. Previous workbooks and reviews remain inside the source project and complete native planning ZIP.

## CLI workflow

Use the installed grant-source-tables command, or invoke source-tables-cli.mjs from the maintained workspace source. Select the exact saved plan ID and revision from the original planner.

Create complete profile files:

~~~sh
node source-tables-cli.mjs workbook-export-profile --output WORKBOOK_PROFILE.json
node source-tables-cli.mjs workbook-return-profile --output RETURN_PROFILE.json
~~~

Edit the export choices and enter a receiving note. The return profile contains all four collection choices, the dependent-record choice and hidden-row choice.

Export the saved native revision:

~~~sh
node source-tables-cli.mjs export-plan-workbook \
  --workspace PRIVATE_WORKSPACE --plan PLAN_ID --revision SAVED_REVISION \
  --profile WORKBOOK_PROFILE.json --output-directory NEW_HANDOVER_DIRECTORY
~~~

The CLI reads the selected immutable revision, exports its original native ZIP, projects all four workbook sheets through the maintained Python reader and publishes the complete directory. Repeating the same command against that complete directory reopens and checks the original files and archive. Different inputs require a new output directory.

Receive the edited workbook:

~~~sh
node source-tables-cli.mjs receive-returned-workbook \
  --project NEW_HANDOVER_DIRECTORY/planning-source-project.json \
  --file RETURNED.xlsx --return-profile RETURN_PROFILE.json \
  --output returned-project.json
~~~

Review each table, saving its next complete source project:

~~~sh
node source-tables-cli.mjs review --project returned-project.json --role packages --output reviewed-packages.json
node source-tables-cli.mjs review --project reviewed-packages.json --role milestones --output reviewed-milestones.json
node source-tables-cli.mjs review --project reviewed-milestones.json --role contributors --output reviewed-contributors.json
node source-tables-cli.mjs review --project reviewed-contributors.json --role assignments --output reviewed-project.json
node source-tables-cli.mjs preview --project reviewed-project.json --workspace PRIVATE_WORKSPACE --plan PLAN_ID --output native-preview.json
node source-tables-cli.mjs save --preview native-preview.json --workspace PRIVATE_WORKSPACE \
  --note "Reviewed the complete returned workbook and native plan" \
  --request-id ORIGINAL_OPERATION_ID --output-directory NEW_SAVED_EDITION_DIRECTORY
~~~

Review the preview before saving. If the plan's current revision has changed, reopen it and use the existing explicit rebase workflow. Reuse the same preview, note and request ID to recover the same save.

The export and receive commands accept --python for the existing Python reader and planner. Close the browser listener before a separate headless command opens that same private workspace.

## Maintained integration

source-workbook-export.mjs uses the original ROLES, nativeRoleRows, planningRoleCsv, Source Tables mapper and zipWorkspace implementation. The only authored workbook arithmetic is the exported hours × rate spreadsheet formula; the native amount and all stored plan fields come from the original saved revision.

The pure exports are createPlanningWorkbookArchive, preparePlanningWorkbookHandover, receivePlanningWorkbookReturn, both profile validators/defaults and planningWorkbookHandoverGuide. The complete handover function receives the exact native planning ZIP and the original projectWorkbook callback. Receiving uses the original inspectWorkbook and projectWorkbook callbacks. Browser controls mount only through the existing planning listener's context.

The original listener serves the module, both existing native receiver modules and this guide. Its native ZIP route accepts one optional positive revision query. Both managed launch source lists and the grant-operations distribution include the full maintained dependency closure.

## Whole operating walkthrough

~~~sh
node examples/source-tables/receive-current-budget-workbook-handover.mjs NEW_PRIVATE_DIRECTORY --browser
~~~

The programme uses the retained six-package $38,000/400-hour plan, exports its actual empty capacity sheets, makes an explicit one-hour workbook revision with a named example contributor, receives and reviews all four sheets, calculates and saves through the original native writer, replays the exact save request, and imports the complete ZIP into a second workspace. It then performs the actual browser export, returned-workbook selection, four reviews, native calculation/save and reopening. Complete portable outputs are written before browser allocation.

The example contributor and 40-hour weekly capacity are operator-selected walkthrough inputs. Replace them with the accountable people and confirmed capacity in an operational plan.

For a headless-only environment, omit --browser. WORKBOOK_HANDOVER_RECEIVING.json records the native result and any actual browser result; it identifies the entered programme scope.

Continue the browser from a completed portable native case:

~~~sh
node examples/source-tables/receive-current-budget-workbook-handover.mjs COMPLETE_NATIVE_CASE_DIRECTORY --resume-browser
~~~

This reopens the original final-workbook-handover/planning.zip in a private receiving workspace and checks its saved content identity against WORKBOOK_HANDOVER_RECEIVING.json. Each browser continuation keeps its complete views, downloads and saved native files in a fresh browser-review directory beside the original case. The completed result records the selected relative directory in browser.outputDirectory. Keep that directory with the complete case when transferring it. Earlier interrupted browser outputs remain available, and another continuation can finish after a late browser failure without replacing them. Both browser completion paths write their complete result privately and atomically replace the summary, so interruption while saving that result preserves the earlier complete native summary. Repeating the command after a completed browser result reopens that result.

## Format references

- [SpreadsheetML document structure](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document)
- [SpreadsheetML formulas and stored results](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-formulas)
- [Microsoft's explanation of Excel numeric precision](https://learn.microsoft.com/en-us/troubleshoot/microsoft-365-apps/excel/floating-point-arithmetic-inaccurate-result)

## Public distribution

The public distribution registers `starforge grant-source-tables` alongside the existing `starforge grant-workspace` command. Open **Source tables** in that original native planning application, or use the CLI sequence above against the same saved workspace. Its complete source-table document stays inside each native planning revision and the original full planning ZIP.

The original application reader accepts that full ZIP in **Planning edition**. Review its complete source and changes there, select the intended work packages in **Operating plans**, and retain the received plan in the complete application handover.

An explicitly selected earlier revision exports its complete consecutive history through that revision. Later revisions remain in the source workspace. An interrupted workbook handover or save resumes with its original plan, revision and request identity.

The maintained workbook receiving programme in `examples/source-tables/receive-current-budget-workbook-handover.mjs` exercises the complete original workflow, including saved-workspace receiving, workbook return, native preview/save, browser use and independent reopen.
