# Receive the already-rendered field report editions

The completed field campaign keeps its two original QC reviews and three original corrective-action reports. A presentation repair creates five new native report editions with readable HTML and the same complete scientific, sample, plan, decision and source content. This receiver copies those **existing** editions from the original presentation context into the campaign's working project, then captures an explicit presentation selection for the maintained recording course.

Use this when the actual presentation producer retained its outputs under a separate `field-report-context`. Its source receipt alone does not put those reports into the original scientific Workspace. The original five reports remain available with their original IDs and action-to-QC relationships.

**Needs expert review.** The practice's scientific reviewer retains responsibility for sampling interpretation, QC applicability, intended use and corrective-action conclusions. This adoption preserves the original recorded values and decisions; changing the presentation does not establish new scientific or customer acceptance.

## Inputs from the existing presentation operation

Use the same completed operation's:

- Original editable Workspace and field operation ID from `inspect_campaign`.
- Complete `ecosystems.actual-attachment-presentation-successors/v1` receipt. The actual producer's receipt includes `owned_field_context`, original/new report IDs, native report directories and revisions.
- Complete original field-report context, including the original retained plan revision bank and original QC/action reports as well as the five presentation successors.

The original report directories are `implementation/plans/PLAN_ID/reports/REPORT_ID/`. Preserve all their original filenames and complete inventories. The separate engineering-handback entry in the presentation receipt belongs to its existing customer workflow; this operation selects only the two QC and three action entries.

The current original renderer's `handoff-receipt.json` may include recipient-use records and viewed-image notes in addition to the producer's source fields. Retain the **whole exact file**. Its complete bytes and SHA-256 bind this adoption request; do not reconstruct or truncate it.

## Run the maintained native adoption

From the complete installed application, with its existing scientific Python:

~~~text
python -B -m model.field_report_adoption adopt --workspace /absolute/original/workspace --field-operation ORIGINAL_FIELD_OPERATION_ID --receipt /absolute/actual-presentation/handoff-receipt.json --output /absolute/new-field-presentation.json
~~~

Replace these paths and the operation ID with the original native values. The destination is the same saved project that completed the field campaign; this command does not create a Workspace, execute native hydrology, author a measurement or render another report.

If the complete field-report context was transferred to another machine, give its actual new root explicitly:

~~~text
python -B -m model.field_report_adoption adopt --workspace /absolute/received/workspace --field-operation ORIGINAL_FIELD_OPERATION_ID --receipt /absolute/retained/handoff-receipt.json --source-context /absolute/received/field-report-context --output /absolute/new-field-presentation.json
~~~

The override relocates the original context root while preserving every original relative report path, report ID, file hash and saved revision. The receiver checks each old receipt path against its exact original `owned_field_context` and native report path before using the corresponding new location. A path override never changes the original source identity.

The optional `--output` creates the full plain `upstate.field-report-presentation/v1` selection that the existing `--field-presentation` option consumes. It must be outside the Workspace. An existing byte-identical output is reusable; a changed selection needs a new output path. The command's normal JSON result contains that same document under `presentation`, plus its original adoption ID and Workspace-relative journal directory.

### What admission checks

Before the first native report copy, the receiver checks **all five** source pairs:

1. The actual original field campaign is complete in the destination project and names exactly the original two QC and three action reports.
2. The complete presentation receipt names each original report once, with five distinct successors and the same native plan.
3. Original report inspections in the source context and destination project are equal, including the original numerical/decision bodies and full file descriptors.
4. Every selected manifest/member validates against the destination's exact saved native plan revision. Complete original plan bytes are retained.
5. The presentation selector verifies the full original and selected scientific/reviewer content, manifest metadata and exact permitted HTML/source-descriptor substitutions. Every original scientific file remains unchanged; action reports still refer to the original QC review.

The receiver then invokes the maintained `ImplementationStore.retain_report` for each missing presentation. That native store owns its plan lock, stages and synchronizes a complete original report, rechecks its identity and publishes its immutable report directory. An identical already-retained edition is reused.

After all five commits, the complete selector is inspected again against the destination Workspace. Only then does the operation publish its immutable completion record.

## Continue after interruption

The operation identity binds the destination's original project, original field operation and the exact presentation receipt bytes. Before the first native report mutation, it retains `receipt.json` and `request.json` under:

~~~text
implementation/field-presentations/ADOPTION_OPERATION_ID/
~~~

That folder also carries exact per-report retention records and `completed.json`. It belongs to the original Workspace, so the ordinary complete project inventory carries the adoption and report bank together.

Reissue the same `adopt` command after interruption. The operation holds its original advisory lock and checks the retained request and all already-present report editions. A report copied before a lost response is recognized by its exact native identity. Missing reports are copied from the same verified source context; no completed report is replaced. If all five reports already exist and only the completion write was interrupted, the operation can finish without the old external context.

The original receipt remains the admission input for `adopt`. Once its native journal exists, `inspect` reads the retained copy directly:

~~~text
python -B -m model.field_report_adoption inspect --workspace /absolute/received/workspace --operation ORIGINAL_ADOPTION_OPERATION_ID
~~~

A completed inspection returns the verified whole presentation without opening source-machine paths. A partial inspection returns the exact retained IDs and missing pairs, with status `partially_retained` or `retained_pending_completion`. It does not claim the five-report receiving operation is complete. Changed existing report bytes, invalid manifests, aliases and mismatched source identities raise the original error.

The five native report commits are individually durable. The receiving operation intentionally leaves a useful verified partial state after interruption and resumes it under the same admission. Preserve that state rather than deleting it or issuing unrelated reports.

## Use the chosen reports in the original course

Pass `new-field-presentation.json` to the maintained recorder along with its same original receipt, Workspace, output and browser configuration:

~~~text
python -B source_tools/simulated_headwaters_rehearsal.py --receipt ORIGINAL_DEMO_RECEIVING_JSON --workspace ORIGINAL_WORKSPACE --output NEW_REHEARSAL_DIRECTORY --browser-config EXISTING_BROWSER_CONFIGURATION_JSON --field-presentation new-field-presentation.json --run
~~~

Keep all remaining options from the original authorized recording. Customer presentation selection continues through its separate `--customer-case` argument.

The field browser opens original results and original corrective-action history, then explicitly opens and exports the selected readable reports through the existing controls. Original report IDs remain visible in the course result alongside selected presentation IDs. It never makes an action report point to a different QC review merely to display newer HTML.

The complete operating course, callable/standalone choices and browser recovery behavior are in `docs/SIMULATED_FIELDWORK_BROWSER.md`. Its private browser-draft recovery stays with the original recording owner.

## Deliver and reopen the complete project

Retain the five selected report directories and the original five reports, saved plan history and adoption journal in the ordinary whole-Workspace archive. The source-owning producer must build the new complete project edition after adoption; an earlier archive cannot acquire later reports by receiving a separate selection JSON.

On the independent received project:

- Run `inspect_adoption` using the returned original adoption ID. No original context path is required.
- Inspect the returned presentation through `model.field_report_presentation` and open both original and selected native records.
- Open every selected report and complete native ZIP, operate table scrolling/print/download controls at desktop and 390px, and reopen the extracted files.
- Operate the existing field, QC, corrective-action, customer and project receiving controls with the original case identities. Preserve the original distinction between customer responses and engineering disposition.

The producing peer must actually open, render, LOOK at and use the exact outgoing application and **all attachments**. Personally view the actual screenshots; source review or image capture alone is insufficient. Extract the outgoing archives and open the contained editable project, HTML, PDF, data and reports. Watch/listen to any final media; use actual application recordings and natural narration. Repair unreadable, cramped, clipped, broken or unstyled output in the maintained original source, preserve industrial design and original scientific content, and continue the existing owners' operation. Keep this instruction in the consumed build/receiving guidance and delegation. No new model run, controller or broad review suite is required by adoption.

## Complete current owner direction

The complete application brief below carries the current scientific scope, native execution priority and delivery direction. Its original maintained source is `CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.3`.

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

