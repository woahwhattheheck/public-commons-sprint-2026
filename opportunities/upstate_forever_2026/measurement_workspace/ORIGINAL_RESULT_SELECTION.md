# Original result selections in Published Studies

A native study can retain every original WQP source body and show a source-bound subset of its original ResultIdentifiers. This supports multiple analytes from the same sampling activity. All full-source census and exact Activity/reporting-limit joins are verified before the subset is applied.

## Original source layout

Keep the existing complete `observation-sources.json` (`upstate.observation-sources/v1`) and original CSV files under the retained study root. Declare each full body's bytes, SHA256, actual row count, whole source-query dates and disjoint station/characteristic scopes. NarrowResult entries use `wqp-narrow-result-csv` with both original `wqp-activity-csv` and `wqp-result-limit-csv` metadata descriptors. The complete index count remains the count of all original rows, including rows outside the chosen review window.

Add `result-selection.json` to the same source inventory. Its schema is `upstate.original-result-selection/v1` and its fields are:

- `observation_index_sha256`: SHA256 of the exact retained observation-sources.json bytes.
- `original_record_count`: complete parsed result count.
- `record_count` and `activity_count`: chosen result count and distinct original (station, project, ActivityIdentifier) count.
- `date_start`, `date_end`: inclusive ISO YYYY-MM-DD sampling window.
- `records`: the exact original result selectors described below.

Every selector includes `original_source_path`, `original_source_sha256`, `source_csv_row`, `monitoring_location_id`, `activity_id` and `original_result_identifier`. The source path is relative to the retained study root. `source_csv_row` uses the native CSV reader's header-inclusive record numbering (first data record 2); preserve that original record selector rather than computing byte or display offsets. All six fields must match the parsed original row. Source bodies may be copied to a portable `original/` layout without changing their bytes; index and selector paths must name that same retained layout, and original source URLs remain in the source descriptors.

The reader requires distinct original result IDs and source-row identities across the complete cohort, rejects unknown or duplicate selectors, and checks chosen dates and both counts. It returns chosen rows in the full original source order. Values, units, qualifiers, raw cells, Activity joins and reporting-limit records remain those of the original rows.

## Agreeing results from the same activity

A study can explicitly declare `observation_statistic_basis: "agreeing_original_activity_characteristic/v1"`. The observed result table and original-cell exports retain every selected ResultIdentifier. Statistical summaries give one weight to each station/project/activity/characteristic only after all original raw cells agree except ResultIdentifier and ResultDetectionQuantitationLimitUrl, and normalized numerical, unit, censor, method, depth, date and activity support agree. Conflicting repeated values are rejected for this declared basis.

The desk shows original result and measurement counts separately. Quantified means/sample SD and supported concentration intervals use the measurement cohort. The selected report ZIP includes `activity-weighted-measurements-selected.csv`, whose rows retain all original result IDs and source selectors in each group. Structured context retains both the original rows and statistical rows. Studies without the explicit basis keep their existing inclusion rules.

## Composition and export

The existing observation reader retains this selector through `observation_files`; include it in the study's complete inventory and native manifest companions so source export and cold reopening preserve the same selected cohort. A study declares either this result selection or the existing microbial `observation-selection.json`; declaring both is rejected as ambiguous. The microbial exported-review contract remains unchanged.

The Three/Twenty2026 family is a concrete consumer: its full source index has 766 original results while the retained selection has 242 results and 15 station/project/activities, from 2026-01-07 through 2026-07-08. The application receives the actual original source family through its maintained Published Studies provider. Existing queued study, saved-review, scientific report, editable selected Study and Workspace export/reopen flows remain the product route.

## Receiving

Run the exact installed source edition through the existing operator and inspect the populated original results, selection and exports. Preserve a current running operation; apply source successors at its saved boundary. The original source and receiver owners retain the same task and Workspace identities. Open the exact delivered report, selected CSV and extracted Study/Workspace with the recipient's normal controls, and fix concrete defects before presenting.

## Owner instruction: inspect the actual outgoing product

Before calling a client/prospect-facing app, website, dashboard, demo, report,
presentation or export ready, the producing peer must actually open, run or
render the exact outgoing version, LOOK at the rendered screen or its real
screenshots, and operate the important user controls. Check the actual
screenshare width and narrow/mobile width where relevant, populated, empty,
loading and error states, downloads/exports and reopening. Capturing screenshots
without viewing them is insufficient. Fix ugly, broken, unstyled, cramped,
clipped, overflowing or unreadable output within the authorized work before
presenting it. Code review, DOM counts, HTTP 200, unit checks or another peer's
approval do not replace seeing the actual product.

ALL ATTACHMENTS count. Literally open, view, play and use the final delivered
HTML, PDF, report, slides, spreadsheet, map, image, video, audio, archive and
project as its recipient would. For archives, extract and open the actual
contained deliverables and working project. Tests, checklists and screenshots
merely captured are not substitutes. Use available high-quality generative media
models and natural voice generation/TTS for videos; avoid robotic default
voices. Watch and listen to the final export for pronunciation, pacing, timing
and audio alignment. Keep building and fixing; inspection is not review/test
performance theatre.

For the Ecosystem product use plain industrial design: readable tables, clear
hierarchy, consistent typography and spacing, restrained controls, useful labels
and responsive layouts. No decorative template slop. Keep the real workflows,
data and computation. Reviews must lead directly to repairs and must not replace
hard implementation/integration or become endless rechecking. The existing
focused-validation policy remains; do not run broad suites or build a separate
verification product. Prior empty-Workspace screenshots are not acceptance of a
completed scientific Workspace.

PERSISTENT PROPAGATION REQUIRED: copy this rule into every active owner-controlled
policy/instruction surface the provider and workers actually read: global and
project AGENTS, CLAUDE, GEMINI and rules files, provider-specific boot instructions,
Commons source mirrors, cloud repository instruction copies, and current build
and receiving guides. Every delegating peer includes this complete rule in child
assignments, including its all-attachments and final-media clarification. Return
exact changed paths, source/version and readback. A Slack ACK alone is not
propagation. Preserve all existing owner controls and do not alter historical
evidence or third-party/vendor policies. No forced restarts, new watchers or
revival of owner-stopped work.

Continue the same Ecosystem Sprint Integration assembled product and its original
scientific, run, browser and receiver owners. Continue native source, runtime and
archive joins rather than diverting everyone to cosmetic review. Preserve the
October 13, 2026 fleet cutoff at 10:00 a.m. Eastern (EDT), 14:00 UTC. This project
cutoff does not expire the standing inspection rule or change other projects'
owner-directed schedules.


## Current Ecosystem direction

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

