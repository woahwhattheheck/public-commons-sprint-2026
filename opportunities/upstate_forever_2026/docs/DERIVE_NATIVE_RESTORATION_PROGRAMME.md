# Derive a programme from an actual native treatment footprint

This command creates a **separate simulated programme** for one original native run. It reads the maintained scenario footprint and reuses the existing pricing function. It does not run NDR or SDR, replace the original 635-cell programme, create an Economic edition, or claim that field work has occurred.

The purpose is to let an analyst use a newly completed regional restoration or matched-control case with its actual treatment quantity. A reporting-zone area, upstream model-domain area, or previously authored 57.15 ha demonstration is never substituted for the selected run's changed cells.

## Inputs and scope

Use the same application and Workspace that contain the completed native run. The application needs the existing scenario_footprint and apply_simulated_restoration_programme modules, the original programme JSON, and its complete SC cost catalogue.

The derivation admits only a 30 m grid with nonempty net changes from original classes 81 or 82 to class 41. It verifies the footprint's exact run selection, grid resolution, source transition counts and changed-cell area. Different land-cover transitions require a separately reviewed design. The native footprint compiler may retain its normal footprint report and raster; it does not launch an NDR/SDR solve.

Role and title are always explicit. Choose either:

- **riparian_restoration**: an authored restoration role. The selected footprint does not itself prove minimum buffer width, site suitability or programme eligibility.
- **matched_control**: a comparative planting benchmark. The historical 391 row does not establish that the control is riparian or eligible for support.

The resulting programme retains the original planting method, spacing, species allocation, source rows, preparation/layout allowance, contingency, recurring maintenance, exclusions, horizon and discount rate. These are inherited simulated planning assumptions, not newly observed prices or incurred costs.

## Derive a separate programme

From the application directory, use the actual completed run ID:

~~~sh
python -B -m source_tools.derive_native_restoration_programme \
  --workspace /actual/original/workspace \
  --run-id ACTUAL_RESTORATION_RUN_ID \
  --scenario-role riparian_restoration \
  --title "Regional simulated riparian restoration programme" \
  --inherit-schedule \
  --output-directory /actual/owned/derived-programmes
~~~

Here --inherit-schedule explicitly retains the base programme's start date and all six original durations. Its meaning and exact source SHA are recorded. It does not silently assign dates from the native run or imply that the schedule has been approved.

To author a different schedule, replace --inherit-schedule with all of:

~~~sh
--start-date 2026-11-16 \
--task-duration review=2 \
--task-duration design-layout=3 \
--task-duration site-preparation=5 \
--task-duration planting=10 \
--task-duration contingency=0 \
--task-duration maintenance=1
~~~

Explicit schedule mode also describes the selected initial maintenance duration; the original recurrence wording remains in the retained base programme. It does not infer recurring dates from that duration.

These are example choices, not inferred regional durations. The command requires all six task values in explicit mode. Use a separately reviewed schedule for actual work. Optional --base-programme, --catalogue and --footprint-id select exact existing sources; they do not relax source/quantity checks.

The command returns operation_id, programme_path, original run/footprint IDs, actual expected_footprint, selected schedule and both hand/machine price estimates. It writes an immutable operation directory containing:

- programme.json: the new programme, with full native selection/footprint provenance and the original base programme.
- base-programme.json: the complete unchanged original parsed programme.
- footprint.json: the complete retained native footprint.
- pricing.json: recalculated simulated quantities/costs using the original pricing function.
- catalogue.json: the complete reviewed source catalogue.
- derivation.json: exact source hashes, native binding and explicit choices.

All members have SHA-256/byte descriptors. Repeating identical inputs reconnects to exact matching files. A different existing member is rejected. The original base programme and Workspace plans remain unchanged.

To review the design in the existing programme HTML, use **Load original programme** and select the returned programme.json. The current page shows the selected title and footprint. Review the complete assumptions and exported JSON before binding; a rendered preview alone does not create a native plan.

## Use the unchanged native binder

Take programme_path from the result. Select an **actual accepted scenario-decisions report**, its exact zone, and the same run. Then preview:

~~~sh
python -B -m source_tools.apply_simulated_restoration_programme \
  --workspace /actual/original/workspace \
  --programme /actual/derived-programmes/OPERATION_ID/programme.json \
  --report-id ACTUAL_REPORT_ID \
  --zone-id ACTUAL_ZONE_ID \
  --run-id ACTUAL_RESTORATION_RUN_ID
~~~

The existing binder verifies that the original report/zone alternative and footprint use the same grid, profile and scenario. Only after reviewing that actual result, repeat the command with --apply --expected-operation-id EXACT_PREVIEW_OPERATION_ID.

If the original completed cohort has no scenario-decisions report, use the existing scenario-decision source operation on those retained runs. Do not rerun physical models or synthesize a decision-report ID. The binder produces the existing original Economic edition, candidate, six work tasks, budget-only lines and explicit alternate-method cost review. Its existing native and browser receiving courses can continue from the returned plan/candidate/review path.

## Interpretation and handover

Annual native nutrient and sediment changes describe the modeled established land-cover endpoint as an annual equivalent. A class-41 endpoint does not predict first-year seedlings, growth, mortality or establishment lag. Cost quantities are an authored planting design on the verified treatment footprint. Material-only and assistance subtotals remain separate from the complete planting benchmark; no grant/payment availability or eligibility is inferred.

Keep the original upstream model domain, South Carolina reporting mask and utility focus distinct. A selected reporting_area zone can be a narrower anchor area than a whole regional SC mask. Use original report labels, units, support and signs when presenting outputs.

The governing direction is CURRENT_OWNER_DIRECTION.md v2026-10-13.3: demonstrate choose inputs → run → inspect differences → revise → editable handover, relevant to Tim's experienced practice, while the prime retains scientific methods and client direction. Preserve actual elapsed history. Under AGENTS.md v2026-10-13.1, the producing worker must operate and **personally view** the outgoing product at desktop and narrow widths and inspect all PDF/HTML/data attachments. This source addition is not evidence that a native programme has run or that its rendered handover has been viewed.

## Complete governing owner brief

The following is the complete retained CURRENT_OWNER_DIRECTION.md v2026-10-13.3, unchanged. Keep it with the derived programme and receiving handoff.

```markdown
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

```
