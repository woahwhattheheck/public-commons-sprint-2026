# Saved field choices → editable implementation plan

The **Field assignments** desk receives the original selection already saved by the monitoring field-planning desk. Choose **Saved native field selection → Use retained selection** to read a selection from the existing Monitoring desk directly, or load its original saved JSON file. Choose its matching original field-support document, load the saved selection, inspect the assigned stations and original calendar, and create the editable native plan. The ordinary task queue saves the plan and its original report. Open the saved assignment to download its report, original selection and tables, or continue through **Open editable implementation plan**.

## What moves into the application

Every selected search area becomes a planning task. An explicit original station choice becomes a site with its WGS84 planning coordinates, full original station object, original coordinate family and source identifiers. Each selected original round becomes a planned visit at that station. Calendar metadata retains the original crew, local start/finish, deadline and visit key. Empty station choices remain visible unassigned-area tasks; their calendar slots remain in the original selection and preview. Historical observations remain original context in the attached field-support data.

The native budget is the **full original programme budget**. The original USD cents, all-round scope, overhead and cost statement remain attached. Choosing fewer rounds does not estimate savings or prorate the programme cost. Users can make explicit later changes in their editable plan using the normal native revision workflow.

The original field-support JSON and exact saved selection bytes are native managed attachments. The original plan, attachment revisions, source-family metadata, selected original rounds, source hashes, unassigned areas and original report are preserved. Later edits create ordinary plan revisions. Reopening this assignment keeps its original report and opens the current editable plan on request.

The source support’s original project identity stays visible even when the source was received into another Workspace; the new plan belongs to the receiving project. The source collection, source ID, body hash, complete field-support hash and original support ID bind every assignment. Source-file intake uses the maintained Workspace verifier.

## Direct native saved-selection handover

The existing **Monitoring design → Saved field selections** product owns the retained review choice and its working desk. Its maintained reader verifies the original native Monitoring network, budget frontier and plans, every source companion and the exact saved selection JSON/HTML. Field assignments consumes that verified original record; it does not replace the reader or recompute the budget selection. The new assignment records the native selection ID and original selection SHA alongside the exact source binding. Changing a station, note or round remains an explicit new selection in the original desk, then a separately reviewed editable assignment.

In the native command below, replace `--source-collection-id … --source-id … --selection-file …` with `--native-selection-id ACTUAL_SAVED_FIELD_SELECTION_ID` to use that complete original record directly. Other output/title/receive options stay unchanged. On resume, the original recorded choice remains frozen.

The original RIVER receiving case already has the operated `Monitoring_4800_Field_Selection.json`, SHA256 `29a31882db493664d955bb4872209eb1791f999704a163f5fe36ccbf64dc98dc`, retained in its source companions. Use its actual Saved field selections record from the existing receiving operation rather than constructing a replacement.

## Native receiving in the same original operation

Use an installed application containing the complete `monitoring-field-assignment` component. The original RIVER source receiver already imports the document `monitoring-field-planning` and its complete companion inventory. Import that original manifest through Sources if it is not yet in the selected Workspace.

```sh
python -B APP/source_tools/receive_monitoring_field_assignment.py \
  --workspace ORIGINAL_WORKSPACE \
  --output NEW_EXTERNAL_RECEIVING_DIRECTORY \
  --source-collection-id ORIGINAL_FIELD_SOURCE_COLLECTION \
  --source-id monitoring-field-planning \
  --selection-file ORIGINAL_SAVED_FIELD_SELECTION.json \
  --title "Selected monitoring field assignments" \
  --receive-directory NEW_INDEPENDENT_RECEIVING_DIRECTORY
```

Use actual existing paths and the user's saved selection. Both output and independently received-project directories must be outside the app and original Workspace. The received project uses a distinct directory from the course output. The command creates the native plan and original report, retains a complete Workspace/application archive, restores it into a new directory, then runs the received application's own inspection command to reopen the exact original assignment/report. The archive retains the complete original project, source companions and editable implementation histories.

Repeat the same output directory to resume; the retained selection replaces external source-file arguments. Completed native task/report identities remain unchanged. An already-published receiving directory is reconciled through `portable.resume_restore` with the original archive SHA. Later receiving-side edits stay in place. Original report paths rebind to the received root. Current receiving revision is separate from the immutable original report revision.

Report selection and its original rendering-source identities are frozen before rendering. A completed original report is reused after interruption; a partial report can finish only with its original retained renderer. Existing complete report members are preserved and missing members are published from the same original source. Ordinary native report validation binds every file to the saved plan digest and as-of date.

For source-only inspection in a received application:

```sh
python -B RECEIVED_APPLICATION/source_tools/receive_monitoring_field_assignment.py \
  --workspace RECEIVED_WORKSPACE --inspect-assignment ORIGINAL_ASSIGNMENT_ID
```

## Original RIVER case and source meaning

The demonstrated original field-support edition is `e62688692e78bc7cb1551d15cff73afa2a6e3db47b44e78a06e34a89656b51aa`, project `b9d5d257-c6bb-4f07-b975-8e8c63705db3`, source collection `371fca0c31de80d7309e6b7793ca56ac4563a7135409f667e240340957b098a3`. Its three original plans retain USD 4,800 / 9,000 / 13,200, 6 / 12 / 18 search areas and three original rounds. The fixed programme formula in that edition is USD 600 overhead + USD 250 per area + USD 150 per visit.

The source retains 36 microbial station records and 87 draft assessment stations. Their original coordinate datums, coordinate strings and spatial joins remain separate from the WGS84 planning display. A chosen historical station is a proposed field location; access and field suitability remain editable project decisions. Selection of a historical station does not populate new laboratory observations or mark a visit completed.

This component accepts the source schema and complete selected plan, rather than hardcoding those RIVER counts or dates. Original scientific calculations, monitoring optimisation, existing campaign bindings and offline source editing remain with their maintained producers.

## Installation and original ownership

The additive operator extension registers `monitoring.field-assignment.save`, its catalogue/preview/detail routes, saved items, original task downloads and the new desk. No shared application controller or original RIVER template is replaced. Its component requires the maintained `implementation`, `extension-startup` and `monitoring-field-selection` components and travels with selected Study application source through the existing component fragment.

A selected implementation Study retains its native plan/history/reports and managed original attachments. The original assignment catalogue and source collection also travel in the complete Workspace archive produced by this receiver. Use that full project for the complete source desk and assignment catalogue, and the Implementation desk for a selected-plan Study.

## Producing-peer handover

Follow the existing RIVER/DD6B receiving operation. Use the complete installed app to load the actual saved field selection, review both station families and raw coordinate columns, save, open the report and editable plan, edit a note and save a new native revision, then reopen the original report and independent received project. Exercise desktop and 390-pixel layouts, keyboard access, locally scrolling tables and every outgoing report/CSV/JSON/archive link. Personally open and inspect the actual artifacts before calling the recipient package ready. Preserve the active regional GIS/native computation and the original owner's 14:00 UTC checkpoint.

The original field-support publisher owns its eight-source product and its offline selection template; this additive native consumer provides the existing file→editable-plan handover. Source maths and original cost/calendar bytes remain unchanged.

## Retained current owner direction

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.3`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build without arbitrary feature/scenario caps. Preserve today's cutoff: **October 13, 2026, 10:00 a.m. Eastern / 14:00 UTC**. Do not pause work or extend the sprint.

## Direct owner instructions

> do the simulated model

> just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it

> just checking dont pause anythi g

> and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast

## Build for an experienced scientific practice

Ecosystem Sciences lists GIS, hydrology/monitoring, ecological modeling, watershed assessment, statistics, visualization, optimization and publishing. Tim Maguire's practice includes GIS, modeling and water resources. Its South Platte work assembled data, mapped natural capital and produced watershed investment decision support. Do not assume it lacks these capabilities. Its unmet tooling, InVEST or production-capacity gap is unknown until the call. Sources: [Services](https://www.ecosystemsciences.com/read-me), [Firm](https://www.ecosystemsciences.com/firm), [South Platte](https://www.ecosystemsciences.com/).

Show concrete delivery and engineering offload on the actual Upper Savannah RFP workflow: source assembly, reproducible native calculations, editable scenarios, useful decisions and a complete working handoff. The prime retains scientific direction, method choices, interpretation/review and the client relationship. Relevance comes from useful work they can inspect, adapt and receive; do not promise Tim's reaction or claim an unconfirmed need.

## Execute the prepared simulated case now

Native execution is the immediate hard priority. Issue the prepared simulated case on the verified scientific runtime, retain its actual run identity and progress, and obtain the real native outputs. Continue the source/runtime/application integration needed to make that happen. Further plans, stock demonstrations, policy reviews and cosmetic inspection do not replace execution. Do not introduce a bid decision or a prime's yes as a gate.

Demonstrate the scientific operation in the actual application:

1. Use the RFP's 30 m GIS selection. Keep the upstream contributing model domain distinct from the South Carolina reporting mask and the four existing utility focus anchors; retain their actual source geometries and identities.
2. Run the baseline, a realistic riparian alternative and its matched control with explicit, editable source editions, assumptions, parameters and scenario changes.
3. Show active run/progress/logs and completed native annual NDR/SDR results: nitrogen and phosphorus in **kg/year**, sediment in **tonnes/year**, representing delivery to streams. Do not present these modeled stream loads as intake concentrations.
4. Compare the actual maps, tables and report, preserving matched scientific support and original units. Keep source/assumption edits and their consequences inspectable.
5. Export the editable GIS/project and complete scientific working package. Cold-reopen the delivered application/project and show the retained sources, selections, results and useful controls.

Identify the simulated case as modeled. Never invent measurements, completion or customer acceptance.

## Present the real work and real speed

Actually open, see and use the outgoing app and every attachment as its recipient would. Repair defects and ship a plain, readable product. Apply the standing inspection rule without review/test theatre or parallel bureaucracy.

If producing video, record the actual working application and use available natural generative voice/TTS. Watch and listen to the final export. Generated frames must never pretend to be a working app. Explain speed using actual elapsed start, commit, run and package history; do not invent delivery times or guaranteed reactions.

## Carry this direction with the work

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.3` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.
