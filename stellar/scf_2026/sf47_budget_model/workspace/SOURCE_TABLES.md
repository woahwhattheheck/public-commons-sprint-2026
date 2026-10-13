# Plan from source tables

Open **Source tables** in the original Grant Operations planning application. The tab turns complete work-package, milestone, contributor and assignment tables into a reviewed native planning revision. It uses the existing plan, calculator, saved versions and export.

A complete workflow is:

1. Select the intended saved plan.
2. Create source tables from that saved plan, receive CSV/TSV files, select worksheets from an original XLSX, or receive an already-reviewed Source Tables document.
3. Map the source columns and exact member identities. Review every included row and any exclusions.
4. Calculate the complete native preview. Read the proposed changes, prices, work windows, contributor capacity and conditional payment schedule.
5. Apply the reviewed changes to the working plan and save a named revision.
6. Download the complete native planning ZIP. Receive it in **Planning edition** inside **Prepare submission**, then prepare and apply its budget and roadmap text.

## Start with the complete existing plan

**Create source tables from saved plan** exports the existing package and milestone fields into complete editable CSV source editions. Nonempty contributor and assignment tables are included too. Their fields, exact decimal values and native identities remain present. Empty capacity tables can be added later when actual contributor inputs are available.

The saved plan is the comparison baseline. Its complete scenario metadata, source identity, current revision and planning settings stay in the source project. The original native plan retains its source, deployment details and saved history.

**Rebase on saved plan** deliberately chooses the currently saved native revision as the next comparison baseline. It preserves all source editions, mappings, row choices and prior source-import reviews. Save other changes in the native draft before rebasing and preparing another table import.

## Receive source material

Choose **Work packages**, **Milestones**, **Contributors** or **Assignments**.

**Open CSV or TSV** receives a complete UTF-8 file. Select the delimiter and whether the first record contains headers. The source parser handles quoted delimiters, doubled quotes and line breaks inside a quoted cell. It retains the original source text and the original record and line numbers.

**Open reviewed Source Tables project** receives one selected complete document from an existing Source Tables project. Every edition, reviewed mapping and original source byte stays with that document.

**Receive next source edition** adds a successor to the same table. Previous editions and reviews remain available. Selecting another source edition leaves its existing mapping editable; review that selected combination before calculating the plan.

**Download original source** reproduces the selected source text. The complete portable source project retains the original filename, byte length, acquisition time and source hash for every edition.

## Receive an Excel workbook

Choose **Excel workbook selections → Open Excel workbook** in **Source tables**. Select the complete original `.xlsx` file. The retained source includes every worksheet, shared string, formula, stored result, hidden row, merged range, defined name and workbook date-system setting that the original workbook contains. The workbook is kept once by its byte identity and can supply all four planning tables.

The workbook structure table lists every sheet, its visibility, stored range, formula and error counts, hidden rows and merged ranges. Choose the intended sheet, including a hidden sheet when it is an intentional source. The cell preview is paged over the complete selected range. A cell shows its original value, stored formula, cache availability and display format.

1. Choose the original worksheet.
2. Enter its rectangular **Original range**, such as `A1:K9`.
3. Enter the original **Header row**, or leave it empty when the selection has no header. Rows before a selected header are retained as an explicit excluded range.
4. Choose **Use this range and header**. This rebuilds the projected column list from those source cells.
5. Review the projected field names and the choices below. Include the columns that belong in this planning table.
6. Choose **Prepare selected worksheet values**. Read the prepared rows and the retained header, hidden-row and blank-row decisions.
7. Choose **Use selection for work packages**, **milestones**, **contributors** or **assignments**.
8. Finish the existing source-column and planning-field mapping, then choose **Review current table mapping**. Continue through **Calculate native preview**, the complete result review, **Apply reviewed changes to working plan**, and **Save revision**.

The chosen sheet and range are explicit. A workbook can contain additional notes, control totals, sheets and source material outside that selection; the complete original XLSX remains downloadable.

### Workbook choices

| Choice | Result retained with the source |
| --- | --- |
| Hidden rows: include | Hidden source rows participate in the projected table. |
| Hidden rows: exclude | Each excluded worksheet row is retained in an exact range with the exclusion reason. |
| Blank rows: keep | A completely blank source row remains a CSV data record. Existing planning identity and required-field rules still apply. |
| Blank rows: skip | The original blank worksheet row positions remain in the selection. |
| Merged cells: require ordinary data | A selected data cell intersecting a merged range must be resolved before projection. |
| Merged cells: keep original anchor | The original anchor keeps its value. Other positions covered by the merge become empty; values are not filled across the merged region. |
| Formula: require ordinary values | Formula cells require a different explicit formula policy or a revised source. |
| Formula: use stored result | The value already stored beside the formula becomes the projected value. The original equation, cache availability and calculation settings stay with the workbook. |
| Formula: keep original text | The stored equation becomes text beginning with `=`. A shared-formula follower without its own equation requires its stored result or a revised source. |
| Empty cell: keep empty text | The projected cell is empty. The later planning mapping decides whether that native field is optional. |
| Empty cell: require a value | The original cell must contain a value under the selected formula and conversion policies. |
| Workbook error: keep original error text | The source error token remains text. A numeric planning field continues to require a valid numeric value. |
| Keep original spelling | Numeric coefficients, leading zeros, significant decimal spelling and scientific notation stay as source text. |
| Expand exact decimal text | A finite token such as `8.0E+1` becomes `80`. The expansion uses decimal arithmetic and retains its exact before/after values. |
| Date: keep original serial or text | The source serial or ISO date remains unchanged. |
| Date: calendar date | The workbook's 1900 or 1904 date system determines the date. A time fraction requires another explicit policy. |
| Date: date and time | The source serial is converted to a date/time at the nearest millisecond, with ties rounded to even. The original numeric token remains in the selected cell. |

Workbook display formatting remains separate from the stored value. A displayed currency symbol, thousands separator, percentage or rounded display is not silently applied to a planning number. For example, a stored `0.1` with a percentage format remains `0.1` unless the operator supplies another explicit source or mapping.

**Use stored result** selects the value saved in the file. If the workbook's equations need recalculation, open it in its originating spreadsheet application, recalculate, save, and receive the resulting complete workbook as another source edition. The preview exposes missing stored results and the original workbook calculation settings. External relationships stay in the original source file; intake uses the values supplied in that file.

Date serial 60 in the 1900 system represents Excel's fictional 1900-02-29. Keep that serial as source text or correct the originating source before calendar conversion. A date-only choice never silently discards the time fraction.

**Exact value replacements** accepts a complete JSON array, for example:

```json
[
  {"from": "development", "to": "Implementation"},
  {"from": "operations", "to": "Delivery operations"}
]
```

The replacement applies after the selected formula/date handling and optional whitespace trim. Exact decimal expansion then applies to the resulting text when selected. Empty-value rules are explicit. Planning member maps remain available in the ordinary planning-field editor for source-to-native identifiers.

### Retain and reopen workbook editions

**Use selection** retains the original workbook, complete column policies, original header and selected cell positions, projected CSV, worksheet row map, and exact numeric conversions. The CSV enters the same source-edition and table-review workflow used by CSV/TSV intake.

Receive a revised workbook, prepare the intended worksheet with its explicit choices, and use that selection for the same planning role. The prior workbook and prior CSV editions remain available. **Saved selection for this planning table** reopens a specific retained worksheet and selects its corresponding CSV edition. If two worksheet selections produce identical CSV bytes, select the intended original worksheet explicitly; both retained selections remain available.

The complete row review shows both the projected CSV record/line and its original worksheet row. The native import review includes the workbook identity, selected sheet and range, original row, source cell addresses and selected worksheet identity beside each included or excluded planning row.

**Open source project** restores the workbook materials from `planning-source-tables.json`. The native plan retains that complete project inside its saved revision. Native estimate, save and planning-ZIP receiving replay the saved selection against the original XLSX with the maintained workbook reader before accepting the projected values. A compatible updated reader must reproduce the same selection, original cells, conversions and outputs.

The original project and request limits still apply: the complete retained planning source project must fit 32 MiB, and a projected CSV must fit the existing 16 MiB source-table allowance. Workbook sheets and original sources can be received in separate planning projects when their complete retained material exceeds those limits.

### Workbook handover files

The ordinary complete planning ZIP carries the native plan, revision history and full retained source project, including the original workbooks. Reopening that ZIP restores the editable workbook selections on the same **Source tables** tab.

The headless save also publishes convenient standalone material beside the native ZIP:

- `workbooks/<source-sha256>.xlsx`: each complete original workbook.
- `worksheet-selections/<selection-id>.json`: the complete selected cells, source metadata and saved result.
- Matching `.csv`, `.rows.jsonl`, and `.mapping.json` files: projected CSV, original worksheet-row map, and reusable conversion choices.
- `workbook-handover.json`: the original filenames, source identities, selected sheets/ranges and each portable file's size and checksum.

**Download original workbook**, **Download complete worksheet selection**, **Download projected CSV** and **Download original worksheet row map** provide the same material directly in the browser.

### Headless workbook intake

Use the existing `grant-source-tables` command in the installed selection, or the source entrypoint:

```bash
node stellar/scf_2026/sf47_budget_model/workspace/source-tables-cli.mjs inspect-workbook \
  --file current-budget.xlsx --sheet "Work packages" --range A1:K9 --header-row 1 \
  --offset 0 --limit 25 --output workbook-inspection.json

node stellar/scf_2026/sf47_budget_model/workspace/source-tables-cli.mjs project-workbook \
  --file current-budget.xlsx --mapping workbook-mapping.json \
  --output workbook-selection.json

node stellar/scf_2026/sf47_budget_model/workspace/source-tables-cli.mjs receive-workbook \
  --project source-project.json --role packages --selection workbook-selection.json \
  --output workbook-source-project.json
```

Use **Download selection choices** to obtain the complete `workbook-mapping.json` for the actual workbook. The complete example mapping at `examples/source-tables/current-budget.workbook.mapping.json` describes the workbook produced by the operating walkthrough below.

`receive-workbook` also accepts `--file ORIGINAL.xlsx --mapping MAPPING.json` together, allowing native projection and receipt in one command. A portable `--selection` includes the complete original source and selected projection. Receipt replays it against that original workbook.

Continue with the ordinary `configure`, `review`, `preview` and `save` commands. All commands that invoke Python accept `--python PATH`. Reuse the same preview, note, original request ID and output directory when replaying a save.

To export the standalone workbook material from an already retained source project:

```bash
node stellar/scf_2026/sf47_budget_model/workspace/source-tables-cli.mjs export-workbooks \
  --project planning-source-tables.json --output-directory workbook-handover
```

### Complete workbook receiving walkthrough

```bash
node stellar/scf_2026/sf47_budget_model/workspace/examples/source-tables/receive-current-budget-workbook.mjs NEW_PRIVATE_DIRECTORY
```

This operating programme constructs a complete XLSX representation of the retained native six-package budget. It includes five sheets: work packages, milestones, contributors, assignments and workbook notes. The example delivery owner and 40-hour weekly capacity are explicit walkthrough inputs. Replace them with accountable contributors for an operational plan.

The package sheet retains the source amount with each package formula, a scientific-notation hours value, a blank source row and a hidden control total. The saved mapping explicitly selects stored formula results, exact decimal expansion, blank-row skipping and hidden-row exclusion. All four source roles feed the unchanged native planner.

The programme saves the original 400-hour/$38,000 plan, receives a separately authored one-hour workbook edition, reviews its single changed work package, and saves the complete 401-hour/$38,095 result. It replays the original save request, exports the complete native planning ZIP, receives that ZIP in a second workspace, reopens both original workbooks and all five retained worksheet selections, and prepares the next editable source import. Sixteen planning source rows retain their worksheet cell references.

The same programme then opens the original authenticated browser listener, projects the selected worksheet through its existing API, and compares the workbook API used by the browser with the headless projection. `WORKBOOK_RECEIVING.json` records the actual native result and the portable materials produced by that invocation.

### Workbook format references

The shared reader is maintained at `stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/workbook/reader.py`. The native planning adapter supplies string columns to that reader and retains the complete results. The existing planning calculator continues to own prices, rounding, capacity and payment arithmetic.

Primary format references:

- [SpreadsheetML document structure](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document)
- [Shared string tables](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-the-shared-string-table)
- [Formulas and stored calculation results](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-formulas)
- [Workbook date1904 property](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.workbookproperties.date1904?view=openxml-3.0.1)
- [ECMA-376 Office Open XML](https://ecma-international.org/publications-and-standards/standards/ecma-376/)

## Read source editions and reviews

The source selector shows the received date and time, including the local time zone, and a readable file size. Source rows use **Empty** for an empty value and **Not provided** for a field omitted by the mapping. **Download original source** retains the complete source text, and source details contain its recorded timestamp and exact byte count.

Plan changes show labeled before-and-after fields. Contributor names, capacity sources, assignments and payment inputs are readable in the preview. Saved source-import reviews include their dates, notes and complete changes; their source and calculation details remain available within each review.

## Source parsing and column types

Expand **Source parsing and column types** to set the delimiter, header and empty-record choices. Applying new parsing choices rebuilds the source-column mapping; then review the planning-field bindings.

Each source column has an explicit output name, inclusion choice, type, empty-cell handling, whitespace choice, record-key selection and optional unit. Integer text and decimal text preserve values such as long identifiers and decimal scale. Native USD amounts, rates and hours enter the planner as decimal text.

A record key makes a comparison between editions useful: select a stable package ID, tranche number, contributor ID, or the package/contributor pair. The complete reviewed output stays attached to its exact source and mapping.

**Review current table mapping** freezes that source/transform combination. Receiving a changed source or changing its mapping requires a new table review before the native preview.

## Planning field mapping

Every planning field explicitly chooses one source:

| Choice | Result |
| --- | --- |
| A reviewed source column | Read the value from that exact output field. |
| Explicit constant | Apply the entered value to each included source row. |
| Matching existing value | Retain that field from the native row with the mapped identity. |

Row identities come from source columns or explicit constants. Existing-value matching becomes available after the row identity is resolved. A new native row needs its complete required fields.

A **member map** is a complete JSON object mapping source values to exact native identifiers or categories. For example:

~~~json
{
  "T1-resource": "T1-merchant-resource-integration",
  "T1-handover": "T1-merchant-authority-handover"
}
~~~

When a member map is present, every used source value needs an entry. An empty member-map field uses the reviewed source value directly. This prevents an abbreviated spreadsheet label from accidentally creating a second native work package.

### Work packages

| Field | Meaning |
| --- | --- |
| id | Original or newly selected native package identity. |
| tranche | The package's tranche, 1, 2 or 3. |
| start_day / end_day | Relative work window supplied to the original calculator. |
| estimated_hours | Exact planned hours. |
| assumed_hourly_rate_usd | Exact hourly-rate input when using hours pricing. |
| amount_usd | Complete fixed-price input, or the source amount retained alongside hours pricing. |
| category | A category supported by the selected native model. |
| remaining_work | The complete development scope. |
| measurable_proof | The complete completion assessment. |
| pricing_mode | Explicitly select hours or fixed. |

The native calculator determines the final amount. In hours mode, it multiplies hours by rate and applies its original Decimal rounding. In fixed mode, it uses the entered complete amount. The resulting package total must match the explicit requested award under the native model.

The current original model recognizes core-development, frontend-ux, verification and release. Its eligibility choices belong to that selected source model. Review current issuer guidance and the actual application track alongside the proposed work.

### Milestones

A milestone table maps tranche, submission day, modeled review/payment delay, the complete deliverable and completion assessment. The original planner validates the three ordered tranches, relative dates and complete payment model.

### Contributors and assignments

Contributors map native ID, name, weekly capacity and its source note. Assignments map package ID, contributor ID and exact hours. The original planner validates references and assignment totals, then shows unassigned hours, capacity requirements and days above each entered contributor capacity.

Keep actual capacity sources in the contributor note. Empty capacity remains empty until it is entered.

## Include, exclude, merge and replace

All source data rows are shown with their original record and line. An excluded row requires a reason before calculating the native preview. Its source bytes and decision remain in the project. Pagination changes only the visible portion of the table.

Each role chooses one collection mode:

| Mode | Effect |
| --- | --- |
| Merge by identity | Replace matching rows with the included source values, add new identities, and retain other existing native rows. |
| Replace collection | Use the complete included source rows as that native collection. Omitted native rows appear as removals in the preview. |

The source file's row order remains available. Milestone output follows its explicit tranche identities.

If a replacement removes a package or contributor referenced by existing assignments or payment settings, choose how to handle those dependencies. **Preserve existing dependent records** requires resolving the affected source inputs. **Remove dependent records whose package or contributor is removed** deliberately removes the affected assignments, pricing and payment entries; the full changes are shown in the preview.

Unselected table roles retain their existing values. Capital, calendar settings, payment timing and delivery notes continue in the same native plan.

## Read the native preview

**Calculate native preview** sends the complete proposed scenario patch and planning settings to the original native estimate operation. It checks the exact saved baseline revision before calculating.

The preview includes:

- Every resulting work package, with full scope, price, hours/rate, work window and completion assessment.
- All three milestones and their complete deliverables.
- The original four conditional payment amounts, release conditions and modeled receipt days.
- Modeled peak cash requirement and the original capital/payment inputs.
- Complete contributor capacity, assignments and review/payment-lag comparisons.
- Every changed, added or removed native row or setting, with full before and after values.
- Every included or excluded original source record and its selected source edition.

Enter the source-import review note, review this complete result and apply it to the working plan. A later source or mapping edit clears that preview. The existing **Save revision** control saves the original native revision.

A source project can also be saved while its mapping is in progress. Saving that working material preserves the plan's current financial inputs. Applying the reviewed preview is the explicit step that changes those native inputs.

## Save and receive the whole plan

The complete portable project is **planning-source-tables.json**. It includes the native comparison baseline, every original table edition, typed mapping, target/member mapping, row decisions and saved import reviews.

The native planning revision retains that complete JSON text inside its source-table field. Retaining the original text preserves Source Tables review identities through native JSON serialization, SQLite, saved revisions and full ZIP exports.

The headless save command can finish after an interruption between the original native commit and ZIP publication. Repeat the same preview, note, request ID and output directory. It recovers the original saved revision and exports that revision with its complete earlier history. Later saved work stays in the active authoring workspace. A completed original ZIP is reopened and verified before the same delivery is returned.

The original planning ZIP keeps its eleven existing entries, including workspace.json and planning.json. Source-table material is part of that native planning state. **Planning edition** in **Prepare submission** receives the complete ZIP through the same existing importer and retains the original source bytes and native revisions.

To continue authoring after receiving a native planning ZIP, import that ZIP into the original Grant Operations workspace, select the imported plan and open **Source tables**. Rebase on the received plan's current saved identity before preparing further source imports.

The original server and receiving paths retain their existing input/export allowances. Full histories include the source material in each saved revision that uses it; retain complete exports at useful save points and keep them within the selected native receiver's complete-file allowance.

## Use the original six-package budget sheet

The examples directory contains the exact current reader budget CSV and its complete mapping:

- examples/source-tables/current-reader-budget.csv
- examples/source-tables/current-reader-budget.binding.json

The CSV is copied verbatim from stellar-forge/developer-site/dist/grant-data/budget.csv, original Git blob c62afa352e881c2cf81fe937649fe63fea3ceab5. It contains six source rows totaling 400 planned hours at the retained $95/hour assumption. The original current candidate totals $38,000.

The mapping joins these reader labels to the existing native identities:

| Reader package_id | Existing native package ID |
| --- | --- |
| T1-resource | T1-merchant-resource-integration |
| T1-handover | T1-merchant-authority-handover |
| T2-provider | T2-provider-and-ledger-deployment |
| T2-threat | T2-deployed-threat-response |
| T3-mainnet | T3-mainnet-merchant-rollout |
| T3-recovery | T3-production-recovery-and-handover |

It maps the sheet's hours, rate, amount and relative days explicitly. Complete scope, completion assessment and development category remain the matching original native values. It selects hours pricing explicitly. The full original CSV, including its title and basis columns, remains retained even though those columns do not replace the native scope text.

Use this mapping with the corresponding original current plan. Other plans and source editions need their own selected IDs and fields.

## Complete receiving walkthrough

The maintained example opens the original current candidate, receives the exact reader CSV, retains complete milestones, and adds an explicitly selected capacity/assignment input. It saves that complete 400-hour, $38,000 plan through the original writer. It then receives a second table edition, saves a separately reviewed 401-hour, $38,095 operator alternative, replays the identical save request, receives the native ZIP into a second original workspace, and reopens all source materials for the next edit.

~~~sh
node stellar/scf_2026/sf47_budget_model/workspace/examples/source-tables/receive-current-budget.mjs NEW_PRIVATE_DIRECTORY
~~~

The destination must be new. The example's named delivery capacity is an operator planning input; select the actual accountable person and availability before using it for operational commitments. Both original table editions, all complete native previews and saved planning packages remain in the resulting directory. The original current candidate and reader CSV stay unchanged.

## Headless operation

The installed command is **starforge grant-source-tables**. From a complete source checkout, the same entry is:

~~~sh
node stellar/scf_2026/sf47_budget_model/workspace/source-tables-cli.mjs --help
~~~

Use Node 22.16 or later and the original Python planner. Headless commands open the original workspace through its existing exclusive lock; close its browser listener before using that same workspace from the CLI.

Create a source project from the saved native plan:

~~~sh
starforge grant-source-tables snapshot \
  --workspace /private/grant-planning \
  --plan ORIGINAL_PLAN_ID \
  --output /private/receiving/source-project.json
~~~

Receive a successor source file, configure the exact member/field mapping, and review its complete typed output:

~~~sh
starforge grant-source-tables receive \
  --project /private/receiving/source-project.json \
  --role packages \
  --file /private/receiving/revised-costs.csv \
  --output /private/receiving/received-project.json

starforge grant-source-tables configure \
  --project /private/receiving/received-project.json \
  --role packages \
  --binding /private/receiving/package-binding.json \
  --output /private/receiving/mapped-project.json

starforge grant-source-tables review \
  --project /private/receiving/mapped-project.json \
  --role packages \
  --output /private/receiving/reviewed-project.json
~~~

A first source table requires an explicit --delimiter comma, tab, semicolon or pipe; use --no-header when appropriate. A successor keeps the existing parsing and column mapping until it is deliberately changed. A complete --table-mapping JSON file can be supplied to configure.

Calculate the actual native preview and read it before saving:

~~~sh
starforge grant-source-tables preview \
  --project /private/receiving/reviewed-project.json \
  --workspace /private/grant-planning \
  --plan ORIGINAL_PLAN_ID \
  --output /private/receiving/native-preview.json

starforge grant-source-tables save \
  --preview /private/receiving/native-preview.json \
  --workspace /private/grant-planning \
  --note "Reviewed complete source edition and native calculation" \
  --request-id ORIGINAL_SOURCE_IMPORT_REQUEST_ID \
  --output-directory /private/receiving/complete-plan
~~~

The save output contains the exact full native plan JSON, the complete native planning ZIP, the portable editable source project and its operating guide. The CLI opens the ZIP with the same complete receiver used by the submission editor before returning it as the selected result.

Use --python with the desired executable on commands that invoke the original planner. Use rebase with the project, workspace, plan and a new output filename to choose a current saved comparison baseline.

Each output is a complete new file. An exact repeat of save uses the same preview, note, request ID and output directory. The original native writer reconciles that request before comparing the current revision. A completed export can be reopened and returned if its earlier process stopped before returning the result.

## Source integration

The original app.mjs mounts the Source tables tab against its existing current-plan/draft state, API client, status area, busy lifecycle and savebar. server.py serves its assets through the same private listener. model.py accepts the exact portable authoring text as an optional planning.sourceTables field, using source_tables.py to retain its complete source material.

The core imports the maintained Source Tables implementation from stellar-forge/developer-site/dist/source-table-workspace.mjs. The CLI uses the original Python planner and the maintained grant-plan-source.mjs ZIP receiver. The grant-operations selection includes these exact source dependencies and its new command contribution. The selected existing application and native calculator remain the operating entry points. The original Node and Python managed-launch source lists include the same new runtime files and their complete existing table/receiver dependencies.

## Current issuer guidance

Reviewed October 12, 2026:

- [SCF Build budget and deliverable guidance](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines)
- [SCF Build submission criteria](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria)

The issuer guidance ties three delivery tranches to measurable development outcomes, with four conditional grant payments. It requires a self-contained application and a priced, feasible development plan. The original planner and application carry the selected financial assumptions, proposed scope and current source material.

## Editable saved-plan workbooks

Source tables also exports an exact saved plan as a complete editable workbook handover. The browser and grant-source-tables CLI retain the original native ZIP, four worksheet mappings, exact decimals, all source cells, and explicit receiving choices. Receive all four edited sheets, review their current mappings, calculate the original native result, then save and reopen the complete case. See [WORKBOOK_HANDOVER.md](WORKBOOK_HANDOVER.md) for the complete browser/CLI workflow and the production export-to-return operating programme.
