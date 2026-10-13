# Implementation and field monitoring operating guide

Version 1.0.0 — 12 October 2026  
Companion formats: `upstate.implementation-methods/v1` and `upstate.implementation-plan/v1`.

## Purpose and fit

The workbench turns a selected conservation or restoration candidate into an assigned implementation plan and a portable field record. It connects the practical work: site preparation, design records, funding, installation, inspections, recurring maintenance, sampling and handover.

The public Upper Savannah GIS announcement describes identifying lands whose development could disproportionately affect source water and locating current nutrient and sediment export priorities. It names Anderson Regional Joint Water System and Pioneer Rural Water District and relates the work to E. coli and cyanotoxins. The announcement is dated 7 October 2026 and gives a proposal deadline of 6 November 2026 at 5:00 p.m. Eastern. [S1]

Ecosystem Sciences' service list and project portfolio include watershed planning, GIS, water monitoring, restoration, riparian assessments and land-management monitoring. Those public activities are the basis for this operational extension. [S3–S4] The five methods below are configurable workbench templates. A selected site can use more than one method, provided their installed quantities and costs remain separately identified.

## Three records that answer different questions

A candidate's source-model reference answers why the location or action was selected. Keep the source project, run/version, original row ID, scenario, metric, units, spatial extent and time basis. A model estimating annual nutrient export or avoided development has its own assumptions and date. A revised run creates a new source reference.

An implementation record answers what the team did. Examples include an effective protection instrument, hectares planted, metres of access barrier installed, a commissioned stormwater asset, a paid invoice and a completed visit. Tasks carry dates, assignees, progress and evidence. Completing a task changes implementation status.

A field or laboratory record answers what was observed at a particular place and time using a particular procedure. It retains the monitoring location, activity, characteristic, result, method, units, fraction and qualifiers. A photograph can document visible condition. A water sample can report a measured concentration. Link these records to the plan without overwriting the original modeled value.

EPA's source-water evaluation framework distinguishes measurable action achievements from indicators of water condition and connects them to milestones and monitoring. [S6] This workbench implements that distinction in its data model. It leaves model fitting, forecast comparison, portfolio optimization and causal-effect analysis to the existing analytical modules, which can consume its exported observations.

## Start a practical plan

1. Import the selected candidate rows with their original IDs and source versions. Include any source document or model-result URL in `source_links`.
2. Choose one of the five method templates. Instantiate its `task_templates` with unique task IDs and translate each dependency to the new task IDs.
3. Assign the named roles to the people performing the work. The catalog names responsibilities; the saved plan records the actual assignee.
4. Enter the proposed start date, work calendar, holidays and task durations. Catalog durations are `null`: this means unscheduled work, not zero elapsed time. Add site-specific timing such as planting windows, access windows or event sampling in `start_not_before` and notes.
5. Add separate budget, commitment and actual-cost entries. Attach their funding, order or invoice references.
6. Create the station/site register, monitoring plan and visits before field collection.
7. Export the field package with the plan revision, site directions, procedures, required forms and local copies of needed attachments.
8. After work or collection, import the returning records, resolve any version conflicts, assign follow-up tasks and export the updated handover.

The work calendar uses ISO weekday numbers: Monday 1 through Sunday 7. The plan's `working_days` and `holidays` describe availability, while `duration_days` describes planned effort on that calendar. A task with zero duration is a milestone. A task with `null` duration still needs an estimate. A site visit has an actual timestamp and time zone regardless of the planning calendar.

## The five workflow templates

### Protect priority land and establish stewardship

Confirm the footprint and conservation objectives; document property baseline and repeat photo points; record the chosen protection approach and funding; attach the effective instrument; transfer responsibilities into a stewardship schedule; complete and record later visits.

The measurable implementation outputs are protected area, the instrument reference and completed stewardship visits. Upstate Forever's public land-conservation description couples permanent protection with annual stewardship and land-management support. [S5] The catalog keeps the visit cadence configurable for the project and instrument being used.

A land-protection plan should include a baseline property record, mapped conservation features, the precise footprint, effective date, stewardship role and any continuing obligations. Maintain instruments and sensitive access information under the project's existing access arrangements. A field export should include the directions needed for that visit and omit unrelated personal details.

### Establish and maintain a riparian buffer

Record actual runoff pathways and site condition; attach the site design; establish baseline photo points and any separately planned water sampling; record material and installation commitments; capture planted quantities and dates; inspect work against the specified acceptance criteria; schedule establishment and maintenance visits.

The form retains the number of planted individuals inspected and the number living within that same inspected set. It also records the count or sampling method. That lets an analyst calculate a survival measure without treating uninspected plants as dead or alive.

The applicable local practice/design reference belongs in each saved plan. NRCS directs users to the local Field Office Technical Guide for planning, designing or installing practices; national practice pages identify the practice family. [S14, S16] Buffer width, species, density, maintenance triggers and acceptance measures are therefore site-specific configuration fields.

### Manage livestock access to sensitive water areas

Map entry points and sensitive reaches; specify barriers, gates, crossings and alternative watering arrangements; establish the baseline; record procurement and installation; inspect the completed layout; maintain barriers and operating watering systems.

Record the barrier length inspected, observed defects, watering-system condition, visible disturbance and whether livestock access was observed during the visit. A single inspection is limited to what the observer saw in the stated period. If the project needs a bacteria or nutrient comparison, collect the relevant observations under the separately saved monitoring plan.

NRCS Access Control practice 472 supplies the method-family reference and directs site design to the applicable local guide. [S15] A saved implementation record should make repairs assignable: who will fix which location, by when, and how the next inspection will close the task.

### Deliver stormwater source or treatment work

Confirm drainage routing and the intervention footprint; attach the site design and acceptance criteria; document pre-work condition; record the construction commitment; capture as-built dimensions and changes; complete commissioning observations; transfer the asset into an inspection and maintenance schedule.

Inspection forms record inlet/outlet condition, visible bypass or erosion, ponding, sediment/debris, and the visit's dry-weather or runoff-event context. Any quantitative treatment comparison needs its own sampling locations and design. The workbench records site-design values as supplied by the project; it does not introduce pollutant-removal coefficients.

### Run a targeted source-water field investigation

Save the question and decision it supports. Specify sites, target characteristics, sample types, timing and any reference or comparison design. Agree collection, handling and analytical procedures, then establish repeatable site records. Collect separately identified activities and samples, track custody, reconcile laboratory results and export the campaign for analysis.

EPA's nonpoint-source monitoring guide starts with the management question and uses that question to determine sample type, station placement, frequency, collection methods and data management. [S7] Consequently, the template has no universal sampling frequency. A source investigation and an intervention-effect study can require different designs.

## Field preparation and capture

Keep the master site register separate from visits. Each site has a stable ID, location description, waterbody/site type, coordinates when available, coordinate method and accuracy, spatial reference and alternate source IDs. A station can be used in several visits or monitoring plans. Coordinates alone do not automatically prove two station records are interchangeable.

A visit records its `observer`, `planned_date`, actual `visited_at` time, `status` and notes for field conditions, access outcome and procedure deviations. Within that visit, create a distinct activity for each sample collection, set of in-situ measurements or defined field observation. An activity identifies its site, medium, collection method and sample type. Each result links to `activity_id`. Use `parameter` for the measured characteristic and `original_text` for the result as reported.

This structure follows EPA WQX's organization of locations, activities and results. [S10] It also makes one visit capable of carrying several bottles, duplicates, blanks and probe observations without confusing them.

For repeat photographs, retain the permanent photo-point ID, camera location/landmarks, viewing direction, height if relevant, date and attachment. Note any shift in position or view. The EPA photo-point guidance emphasizes repeatable camera/photo points and site documentation. [S8]

For sampling, use the campaign's actual procedures for containers, preservation, transport and holding time. Retain the sampling and handling references, the sample ID and any deviations. Record each custody transfer with sample IDs, time, releasing party, receiving party and condition. EPA monitoring guidance connects handling and custody procedures to reliable field/laboratory continuity. [S9]

## Result capture that survives handover

Preserve `original_text` exactly as supplied or entered. Store a separate `value` only when the report provides a numeric result. Choose `result_type` explicitly:

- `numeric`: a numeric result with unit and method metadata.
- `censored`: a detection or quantitation condition, with any reported bound and limit information.
- `text`: a qualitative observation.
- `missing`: collection or analysis produced no result; include the reason.

For nutrients, retain the exact characteristic, `basis` such as as N/as P, and `fraction`, including whether filtration occurred in the field or laboratory when known. EPA's nutrient guide explains why speciation and filtration affect interpretation. [S12]

For a nondetect, keep the detection condition and the associated limit type, value and unit. Leave the measurement's numeric value empty when none was reported. EPA's detection-limit guidance provides the basis for retaining censored-result metadata. [S13] Substitution choices for later statistical analysis belong to a separate, documented analysis.

Keep E. coli count units and analytical method as reported. Keep the identity of the specific cyanotoxin or reported toxin group. Keep suspended-sediment concentration, total suspended solids and turbidity as their distinct reported characteristics. Preserve units and method information across import and export.

The recommended `qa_status` vocabulary has four explicit states: `unreviewed`, `accepted`, `qualified` and `rejected`. A review status belongs with its reason and reviewer. A qualified result remains available with its `qualifier`. Correct a record through a recorded plan revision, retaining the previous snapshot and source reference.

## Budget and schedule interpretation

`budget_lines` is a typed cost ledger. Each line has a stable ID, optional task link, kind, label, integer `amount_minor`, date and source reference. In USD, 12500 means $125.00. Use separate lines for the planned budget, a commitment and an actual cost; label any amount that represents an estimate.

Totals are calculated separately by kind. They answer different questions: planned provision, committed amount and incurred cost. Adding all three produces an invalid project-cost total. An invoice and its subsequent payment describe the same expenditure at different stages; choose and document the project's actual-cost recognition convention so it is counted once.

The canonical nonnegative ledger uses current effective entries. Reducing a commitment means revising that entry with an audit record, or using the implementation engine's documented adjustment operation. Avoid adding a second positive line to represent a release or refund.

A schedule is complete only when each contributing task has a duration and applicable dependencies are resolved. A missing estimate should be visible on the workboard. Completing an installation does not complete a later inspection or maintenance visit. `progress_pct` describes task completion and must not be displayed as measured water-quality improvement.

## Offline handover and recovery

An offline package identifies the plan schema, plan ID and revision. Include the method catalog version, source references, working calendar, roles, candidates, tasks, cost entries, sites, monitoring plans, visits, activities and observations. Attachments have stable IDs and a manifest with filename, media type, byte count, checksum and portable path or retained source URL.

The implementation engine imports saved plan snapshots. Preserve the source plan ID and revision during offline editing. An identical source digest and revision deduplicates. An edited snapshot whose source revision equals the current stored revision becomes the next local revision. A different stale or future snapshot is preserved as a conflict JSON file, with its actual path returned for reconciliation; the current plan remains available.

Keep the original exported snapshot until import finishes. If both office and field copies changed, compare the returned conflict file with the current document and merge the intended edits into a copy based on the current revision. Retain stable site, visit, sample and observation IDs. Device timestamps describe when records were captured; they do not decide which concurrent edit wins. After reconciliation, save the updated export and its new revision.

The desktop handover includes a short operations summary: upcoming tasks, current responsibilities, overdue or unscheduled work, budget/commitment/actual totals, next field windows, open corrections and the location of the source data. The scientific handover includes the monitoring question, design, site register, activities, results, methods, limits, qualifiers and attachments.

## Publication and analysis adapters

The canonical JSON is the workbench's portable exchange format. A CSV export should split tasks, costs, sites, visits, activities and results into related tables using their IDs. A GeoJSON export carries the site/footprint geometry while tabular scientific metadata remains linked by IDs.

A WQX adapter is a separate export step. Map organizations/projects, monitoring locations, activities and results to the current WQX templates and allowable values. EPA describes required fields, validation rules and domain values as parts of the WQX standard. [S11] Retain both the workbench IDs and the destination IDs so a later update targets the same records.

## Source references

[S1] Upstate Forever, GIS mapping and modeling announcement, 7 October 2026. https://www.upstateforever.org/news/upstate-forever-seeks-consultant-for-gis-mapping-and-modeling-services

[S2] Upper Savannah GIS Mapping and Modeling RFP and appendix. https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf

[S3] Ecosystem Sciences, Services. https://www.ecosystemsciences.com/read-me

[S4] Ecosystem Sciences, Work. https://www.ecosystemsciences.com/read-me-1

[S5] Upstate Forever, Land Conservation. https://www.upstateforever.org/land-conservation

[S6] EPA, Evaluate Progress Toward Source Water Protection Goals. https://www.epa.gov/sourcewaterprotection/evaluate-progress-toward-source-water-protection-goals

[S7] EPA, Monitoring and Evaluating Nonpoint Source Watershed Projects, Chapter 2. https://www.epa.gov/sites/default/files/2016-02/documents/chapter_2_draft_aug_2014.pdf

[S8] EPA, Monitoring and Evaluating Nonpoint Source Watershed Projects, Chapter 5. https://www.epa.gov/sites/default/files/2016-06/documents/chapter_5_may_2016_508.pdf

[S9] EPA, Monitoring and Evaluating Nonpoint Source Watershed Projects, Chapter 8. https://www.epa.gov/sites/default/files/2016-06/documents/chapter_8_may_2016_508.pdf

[S10] EPA, WQX concepts and definitions. https://www.epa.gov/waterdata/concepts-and-definitions-storage-and-retrieval-and-water-quality-exchange

[S11] EPA, Water Quality Data Upload with WQX. https://www.epa.gov/waterdata/water-quality-data-upload-wqx

[S12] EPA, WQX Nutrient Best Practices. https://www.epa.gov/sites/default/files/2017-06/documents/wqx_nutrient_best_practices_guide.pdf

[S13] EPA, WQX Detection Limits Best Practices. https://www.epa.gov/system/files/documents/2025-09/wqxdetectionlimitsbestpracticesguide_final.pdf

[S14] NRCS, Riparian Forest Buffer practice 391. https://www.nrcs.usda.gov/resources/guides-and-instructions/riparian-forest-buffer-ac-391-conservation-practice-standard

[S15] NRCS, Access Control practice 472. https://www.nrcs.usda.gov/resources/guides-and-instructions/access-control-ac-472-conservation-practice-standard

[S16] NRCS, Filter Strip practice 393. https://www.nrcs.usda.gov/resources/guides-and-instructions/filter-strip-ac-393-conservation-practice-standard
