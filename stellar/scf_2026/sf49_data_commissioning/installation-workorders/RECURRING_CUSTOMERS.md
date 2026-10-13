# Recurring customer installations

The installed Installation desk supports the complete `rumble-fish-prices` and `amberdata-spot-research` customer workflows. The same profile names work in source preparation, native seed preparation and whole-case receiving. The installed recurring composer adds a proposed operating calendar and a complete native task budget to the original Workshare-backed document.

## Operator outcome

| Profile | Whole customer result | Source meaning retained |
| --- | --- | --- |
| `rumble-fish-prices` | A complete approved asset-universe snapshot for one downstream consumer, with original response, field mapping, customer output and prior-edition comparison. | Native XLM, exact classic CODE:ISSUER or Soroban contract identity; decimal strings; observation and snapshot times; carried, unpriced and missing members; original history and source-quality fields. |
| `amberdata-spot-research` | Complete instrument availability and every selected OHLCV page for an explicit interval, the trusted Python summary, and the original Node/Python customer's saved result. | Exchange and instrument, provider version, start-inclusive/end-exclusive UTC bounds, source units, gaps, ordered pages and exact Decimal output. |

The customer selects its actual host, account/source rights, merchant, independent buyer, receiving operator, prices and task allowance in the existing operating case. The full original commercial plan remains attached to the Installation. Its phases, assignments, milestones, correction periods and current relationship state are retained by the native seed and receiver.

The generic profiles describe the repeatable technical outcome. The selected Workshare supplies the actual commercial terms. Keep private customer correspondence, account details and exact customer selections in their original private source/case surfaces.

## Complete original sources to saved installations

The installed tools accept both existing native source forms. For a complete receiving packet containing `prepared_case` and `workshare_input`, keep using `prepare.mjs sources` and its unchanged `source-inputs.py` implementation. For a saved Delivery handover containing `snapshot.version: "dealscout.delivery-handover.v1"`, use `handover-inputs.py`. Both formats produce the same native commissioning input and `SUPPLIER_RECEIVING.json` for `receive.mjs`. Profile selection uses the maintained installed catalogue; `prepare.mjs profiles` lists the current choices.

1. Retain the whole original handover JSON, including its saved Workshare, scope, delivery phases and revisions. Keep the full original commissioning source with the phase-effort table. The selection names every original file's relative `path`, receiving `filename`, exact `bytes` and `sha256`, actual `sourceUrl` and timezone-bearing `observedAt`. Every selected file is retained unchanged in the prepared output.

2. Prepare a complete handover selection with schema `stellar-forge.installation-handover-selection.v1`. Its top-level fields are `operationId`, `requestPrefix`, `receivingName`, `sourceUrl`, `observedAt` and `cases`. Each case contains `caseId`, installed `profile`, one `handover` file descriptor, the original canonical `planSha256`, all `productionEffort` rows, the complete `effortTotal`, additional original `files` and optional existing `bindings`.

Each effort row identifies `phaseId`, decimal-string `hours`, an exact `sourcePointer`, optional selected `sourceFile`, `unit` (`hours` or `minutes`) and the mapping `basis`. The total has the same fields except phase ID and mapping basis. A pointer without sourceFile selects the original saved plan; a pointer with sourceFile selects that complete retained JSON document. Select every original phase once and make the total equal the original complete planning allocation.

```sh
python3 stellar/scf_2026/sf49_data_commissioning/installation-workorders/handover-inputs.py \
  --selection /absolute/private/HANDOVER_SELECTION.json \
  --source-root /absolute/private/original-files \
  --out /absolute/private/prepared-sources
```

The command verifies the complete snapshot hash, original case/Workshare/scope/delivery linkage, original source-and-plan hash and every saved phase against its original Workshare phase. It then invokes the maintained `workshare_intake.load_workshares` on those unchanged source and plan objects, with the explicit original effort mapping. The saved handover's original phase outcomes remain in its full retained source.

The output contains `SOURCE_SELECTION.json`, every complete selected original, `Supplier_Workshare_Commissioning.json`, `SUPPLIER_RECEIVING.json` and `SOURCE_PREPARATION.json`. Its source-preparation record includes the original handover IDs, commercial terms, phase population, complete effort, installed profiles and exact native intake source. The receiving input selects the commissioning file plus all complete original source files; the native reader supports this form directly. Reopening the same command with the same inputs preserves its original output bytes; a changed selection requires its own preparation directory.

For an existing receiving-packet source, use schema `stellar-forge.installation-source-selection.v1`, select its complete `packet` descriptor and run the original entrypoint:

```sh
node stellar/scf_2026/sf49_data_commissioning/installation-workorders/prepare.mjs sources \
  --selection /absolute/private/SOURCE_SELECTION.json \
  --source-root /absolute/private/original-files \
  --out /absolute/private/prepared-sources
```

That original format also retains its complete `Supplier_Complete_Receiving_Packets.json`. Keep whichever full source form the original customer operation actually produced.

3. Give the one current owner of the original Operations workspace the prepared source directory and exact current case/plan identifiers. Run the original receiving operation with that owner's actual identifiers:

```sh
node stellar/scf_2026/sf49_data_commissioning/installation-workorders/receive.mjs \
  --operations-cli /absolute/original/operations/cli.py \
  --workspace /absolute/original-workspace \
  --case ORIGINAL_OPERATION_ID \
  --plan ORIGINAL_PLAN_ID \
  --inputs /absolute/private/prepared-sources/SUPPLIER_RECEIVING.json \
  --source-root /absolute/private/prepared-sources \
  --out /absolute/private/recurring-installation-receiving \
  --receiving-workspace /absolute/private/received-workspace \
  --actor ORIGINAL_OPERATOR \
  --receiving-actor RECEIVING_OPERATOR
```

Choose the original CLI's real path; the example's uppercase IDs name required selections. The receiver reads the current case version itself, attaches the full original files by content identity, obtains the source-backed Installation seed, performs native preview/save and reads back the saved edition. It exports the complete case and reopens each same Installation ID/revision in the distinct receiving workspace.

An existing Installation for the same Workshare case is updated through its original seed. Its operated observations and later fields remain with that record. An unchanged document reuses the saved edition. Resume an interrupted operation using exactly the same input, paths and receiving directory; its original checkpoint retains the original archive/import intent.

The output contains each original seed, selected bindings, full document and readable Workorder, followed by the complete case archive and `RECEIVED.json`. Use the original desk to resolve any remaining host, source-rights, payment or receiving selections against the actual customer case.

## Proposed operating calendar

`recurring.mjs` uses the existing complete calendar/composition engine. It is installed beside the native preparation core and the profiles, so an operator needs one maintained checkout.

```sh
node stellar/scf_2026/sf49_data_commissioning/installation-workorders/recurring.mjs calendar \
  --input /absolute/private/calendar-input.json \
  --out /absolute/private/new-calendar
```

The input schema is `tjlabs.scf-purchase-calendar-input.v1`. Required fields are an explicit UTC `startDate`, `days` from 1 to 366, UTC `weekdays` numbered 0–6, and the complete `participants` array. Optional `blackoutDates` are explicit ISO dates. Every participant has a unique installed `profile`, an actual proposed `merchantRole` and `buyerRole`, `kind` set to `SNAPSHOT` or `CLOSED_WINDOW`, and distinct `sessionsUtc` in HH:MM form.

The result contains the original input, every dated proposed task, useful-task counts by profile and day, and every complete seven- and fourteen-day window within the requested period. `calendar.csv` includes all rows; `calendar.json` retains the full source bounds and summary.

For a snapshot, the task records its requested observation time. For a closed window, a later daily review begins at the previous review; the first review of a working day begins at the preceding working day's last review. Blackouts and weekends therefore remain inside the next closed source interval. A Monday 09:00 UTC review after Friday 17:00 UTC covers 64 hours. This calendar describes proposed useful work; actual customer completion and purchase counting comes from the existing native operating records.

Keep this calendar with the original customer adoption/commissioning plan. Refine the real customer cadence, blackout dates and participant roles there before scheduling actual work. Reopening or recovering an existing result retains that same task.

## Compose a fresh original seed

The composer can prepare the entire native document and its calendar before the original desk saves it. Obtain a fresh `installation-workshare-seed` from the current original case with the complete commissioning and receiving-packet sources. Use the actual whole seed returned by that command.

```sh
node stellar/scf_2026/sf49_data_commissioning/installation-workorders/recurring.mjs bindings \
  --seed /absolute/private/ORIGINAL_SEED.json \
  --profile rumble-fish-prices \
  --out /absolute/private/new-bindings
```

The binding template retains the exact case/plan selection and Workshare identity. Fill the existing source IDs, source authority and reference, selected merchant and buyer deployments, payment terms and receiving host/operator from the original case. Empty template text retains the maintained technical instruction; it does not create an observation or choose a customer on the operator's behalf.

```sh
node stellar/scf_2026/sf49_data_commissioning/installation-workorders/recurring.mjs compose \
  --seed /absolute/private/ORIGINAL_SEED.json \
  --profile rumble-fish-prices \
  --bindings /absolute/private/SELECTED_BINDINGS.json \
  --calendar /absolute/private/calendar-input.json \
  --out /absolute/private/new-composition
```

Use `amberdata-spot-research` for the second workflow. The calendar must include the selected profile. Outputs are the complete `installation-document.json`, `installation-preview.json`, `composition.json`, readable `receiving.md`, full calendar JSON/CSV and a manifest of output byte lengths and hashes.

The composer verifies that native `workorder`, `assignments`, `checks`, `workshare`, `workflowPeriods` and `coordination` remain identical to the original seed. It delegates document semantics to the installed `prepare-core.mjs`. Save and reopen through the original Installation desk or complete receiver; the composer itself prepares files.

Fresh output directories use mode 0700, files mode 0600 and create-only writes. A fresh planned seed is required for this preparation command. Continue an already saved Installation through its current native draft or the complete receiver.

## Whole-task price allowance

For a task containing multiple native priced operations, pass `--task-budget /absolute/private/task-budget.json` to `compose`. The budget has:

- The actual original `network`, `asset` and `recipient`.
- `maximumAtomic`, an integer string matching the Installation's approved `taskBudgetAtomic`.
- `lines`, one per distinct priced operation, each with `operation`, the original integer-string `priceAtomic`, and the complete integer `quantity` of reads/pages/calculations.
- Optional `feeTreatment` describing the selected original network/facilitator charges.

The engine multiplies prices and quantities with exact integer arithmetic, sums the entire selected task and rejects a total over the original approved maximum. The original payment tuple and maximum must match the Installation document. The full reviewed lines, total and remaining allowance are retained in `task-budget.json`.

Use all required provider continuation pages and research operations when choosing quantities. A prepaid allowance retains the original settlement and its consumed capacity. Each separately purchased operation retains its native intent. The useful customer result, original settlement record and delivery/recovery identities stay available to the same operator.

## Source and adoption

`recurring-core.mjs` is the unchanged complete calendar, native composition and task-budget engine from the original recurring commissioning implementation. The installed CLI imports its local native core and the current `profiles.mjs` reader, and removes the second-checkout argument. Any complete installed profile may use its compatible proposed calendar. The generic profile edition keeps the complete source semantics and derives commercial/receiving commitments from the selected original Workshare.

The core is byte-identical to original Git blob `50ecf2804e736c1587723f034b245997e0603fb2`, SHA256 `a748c2b73f980ea28b196508142d8b778ccc91048fcc28349b8a656930057dbc`. Complete original customer selections and calendars remain in the original private commissioning source. The installed and original CLIs produced byte-identical complete JSON and CSV for the retained two-customer, forty-task calendar; its Monday closed interval remained 64 hours.


## Joined commercial and customer programme receiving

The original receiver can now carry the complete commercial source, recurring calendar, task spending and native customer programme through the same Installation save and complete case handover. Both saved Delivery handovers and the earlier complete Workshare packet format use this path.

The original Workshare remains the source of the quoted fee, milestone amounts and triggers, commencement conditions, complete scope, phase effort and agreed receiving. The Customer use, Customer commissioning, Console, Buyer, accounting and bank desks retain their existing records and controls.

### Select complete programme sources

Add the complete source files to the customer's existing `files` array using their actual file descriptors, SHA-256, media type, source URL and observation. Add this optional selection to that same customer:

```json
{
  "programme": {
    "schema": "stellar-forge.installation-customer-programme.v1",
    "calendarFile": "Recurring_calendar-input.json",
    "selectionFile": "Recurring_selection.json",
    "taskBudgetFile": "Selected_complete_task_budget.json",
    "nativeChangeFile": "Original_native_programme_change.json"
  }
}
```

`calendarFile` is the complete original R24C calendar input. The other three files are optional. Every named file must be present among that customer's original sources. Use actual source filenames; the last two names above illustrate the selected operator files.

The selection file contains the complete original `tjlabs.scf-recurring-commissioning.v1` document. The consumer compares this profile's fee, milestone amounts, quoted business days and full base-plus-allowance effort with its exact original Workshare. It retains the original stage labels, triggers, scope and all phase bodies in the output. Correct a changed selection against its original source before receiving its successor.

The task-budget file uses the existing complete-task contract: `network`, `asset`, `recipient`, `maximumAtomic`, all `lines` of `operation`, `priceAtomic`, `quantity`, and optional `feeTreatment`. The unchanged recurring engine multiplies exact atomic strings by complete request/page quantities. The receiver checks that result against the current original Installation's native payment tuple and task maximum immediately before preview.

| Commercial value | Existing source |
|---|---|
| Customer commissioning fee and due conditions | Complete original Workshare and its milestones |
| Included corrections and handoff | Original phase descriptions, acceptance and source-selected customer terms |
| Total commercial effort | Every original phase's explicit source effort |
| Price of one complete recurring task | All selected original priced operations and page quantities |
| Funding-group and aggregate budget | Saved Customer commissioning selection and native report |
| Original settled amount, fees and collection | Existing Buyer, accounting and commercial records |

For the retained Rumble Fish and Amberdata source, the original offered prices are USD 4,800 and USD 3,600, with two equal milestones each. Their selected original effort remains 40 and 32 hours. The source keeps Rumble Fish's following seven-day acceptance-correction period and Amberdata's two reviews, one-hour handoff and ten-business-day scoped correction. The current receipt and scheduling desks continue to record the actual acceptance and dates.

The original R24C two-week input contains twenty complete Prices snapshots and twenty complete Amberdata interval reviews. It retains both review times and every original source interval, including the 64-hour Friday-close to Monday-opening interval. Its full proposed task count travels with the customer source.

### Retain an edited native programme

Use the current Installation's original Customer use and Customer commissioning editors or their existing typed/CLI preparation operations to prepare its dated work, DIRECT/prepaid funding groups, original Console periods and output correspondence. Save the complete original seed and the complete edited native document.

Create the portable change from those actual documents:

```sh
node recurring.mjs change \
  --seed /private/original-native-seed.json \
  --document /private/edited-native-document.json \
  --out /private/new-original-programme-change
```

For a new Installation whose initial profile/bindings were already prepared, pass `--base-document /private/original-prepared-document.json` to retain that exact starting draft. The resulting `native-programme-change.json` includes the complete base and proposed documents, original case and plan selection, Workshare identity and Installation revision.

This change carries the existing `useCalendar`, `commissioning` and `workflowPeriods` fields. The current Installation seed remains the source for the other fields. Existing customer bindings apply through the original receiver.

When the case has advanced, the consumer joins the proposed edits against the retained base and the current saved document. Unchanged draft fields keep later saved values. Independently added or edited task, funding, entry and cycle rows retain their original identities. A change to the same field on both sides returns that exact field for an explicit resolution in the existing editor. A recovered new-Installation change can continue against its saved identity when the selected programme was already applied. If that first save succeeded but its reply was lost, the receiver reopens the native first edition and its exact case-history event. It matches the original request prefix and deterministic request ID, recording operator, case/plan/Workshare selection, original programme fields and saved edition digest before binding the formerly unsaved draft to that Installation. The accepted change is then treated as completed; later independent calendar, commissioning and workflow-period edits remain current. An unrelated first-save event cannot authorize that continuation.

The original native validator still validates every source, deployment, purchase, cycle, file and review basis. The original preview SHA and save request control the transaction.

The same receiving directory retains the complete immutable evidence as `customer-programmes/<selected-customer>/accepted-first-save.json`. `RECEIVED.json` includes that full accepted-save record with the current received programme. The native complete-case archive already carries the original first edition and matching event; the receiver reads them through the existing Installation and history commands. Reopening does not replace the original draft, request ID or earlier source files.

For a standalone preparation after this receiving step, add `--accepted-save /private/original-customer-receiving/customer-programmes/ACTUAL_SELECTED_CUSTOMER/accepted-first-save.json` to the `programme` command below, together with the unchanged `--native-change` file and a freshly obtained current native seed/document. Use the actual directory returned by the receiver. The command retains the full accepted-save input and checks its original identity against those documents; it prepares files without making another native save. An incompatible event or changed original programme remains an explicit error.

### Prepare the complete customer output

The installed CLI can prepare the full commercial and recurring output from current originals before receiving:

```sh
node recurring.mjs programme \
  --seed /private/original-native-seed.json \
  --profile rumble-fish-prices \
  --document /private/original-installation-document.json \
  --commissioning /private/Supplier_Workshare_Commissioning.json \
  --calendar /private/Recurring_calendar-input.json \
  --selection /private/Recurring_selection.json \
  --native-change /private/native-programme-change.json \
  --out /private/new-rumble-customer-programme
```

Use `amberdata-spot-research` with its own original seed for the second customer. Add `--task-budget` when that customer's exact native prices and complete request quantities are selected.

The output includes the full original input bytes, complete commercial JSON, a readable commercial handover in Markdown and clean HTML, the full calendar JSON/CSV, customer programme, selected task budget, complete Installation draft and native preview envelope. The manifest names every complete file and its byte count and hash.

### Receive through the original case

Run the existing source preparation with the extended original selection:

```sh
python3 handover-inputs.py \
  --selection /private/HANDOVER_SELECTION.json \
  --source-root /private/original-customer-files \
  --out /private/prepared-customer-source
```

The earlier packet-based `source-inputs.py` accepts the same optional programme selection. Both retain every original file and emit the ordinary `SUPPLIER_RECEIVING.json`.

Continue the current accepted case writer with the same original receiver:

```sh
node receive.mjs \
  --operations-cli /absolute/original-application/workspace/cli.py \
  --workspace /absolute/original-workspace \
  --case ORIGINAL_OPERATIONS_CASE \
  --plan ORIGINAL_PLAN \
  --inputs /private/prepared-customer-source/SUPPLIER_RECEIVING.json \
  --source-root /private/prepared-customer-source \
  --out /private/original-customer-receiving \
  --receiving-workspace /private/original-independent-receiver \
  --actor ACTUAL_OPERATOR
```

Use the original case/plan IDs and the accepting writer's actual source and workspace paths. Retain this same output directory and request prefix for a retry. The receiver first retains the original source and seed, prepares the complete programme sources, and attaches those full files through the original Sources desk. It then reopens the current case, rechecks the same commercial and task-spending selection, joins the edited native programme, previews and saves its original Installation edition.

Open **Customer installations** for each saved customer. The original workorder, complete native Customer use and Customer commissioning records, phase acceptance and original financial bindings remain editable through their existing desks. Open the attached `COMMERCIAL.md`, `commercial.html` and `CUSTOMER_PROGRAMME.md` for the joined customer handover and full task calendar.

A single source selection may contain several distinct Workshares using the same installed profile. The receiver keeps each customer's complete programme in its own directory, selected by the full Workshare case and plan identity. If this operation already retained an earlier programme under the profile-only path, its matching original seed continues there. The other customer's seed, files, native draft and receiving remain separate while both Installations travel in the same complete-case archive. Continue the same original input and output directory after an interrupted multi-customer run; the earlier accepted sources and native requests remain available.

For standalone `recurring.mjs programme`, select the complete original commissioning file whose exact bytes match `seed.document.workshare.sourceSha256`; the command checks that native source digest before composing the customer programme and retains those same bytes in `original-commissioning.json` and the output manifest.

The receiver exports the whole case and imports it into the selected independent workspace. It reopens each exact saved Installation, compares its full native programme and reports, and checks every joined source attachment's identity, byte count, digest and media type. `RECEIVED.json` contains both complete customer terms, all original milestones, phase effort, calendar summaries, selected native task budgets, native calendar/commissioning reports and source-file locators.

Native customer receipt associations, Console cycles and their output files travel in the existing complete-case archive. Continue the received customer through the original Installation editor and native Buyer/Console operation. The quote, calendar, spending selection and actual retained result remain connected across the complete handover.
