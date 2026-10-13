# Compare saved interpretations of one original measurement file

Open **Measured observations → Receive sources → Prepare a measurement file** in the existing installed application. A preparation retains the exact original file, every mapping revision, source lineage, reviewer and completed import receipt. This addition compares two saved revisions of that one preparation before the scientist uses the existing import controls.

## Operate the current product

1. Open the original preparation. Keep unfinished fields in its current working copy, or save the intended mapping as another immutable preparation revision. The comparison does not save a draft or replay any pending native request.
2. Choose **Read saved preparation history**. Select the explicit before and after revisions. Both must describe the same original file SHA and source kind. Different file editions are not aligned by row position.
3. Choose **Compare complete original rows**. The native reader holds one consistent SQLite read while checking the full preparation/source graph. It runs each saved mapping through the existing scientific normaliser. The first response contains every outcome; browser pagination only controls visible rows.
4. Read the original position, parsed/rejected/unavailable status, station/date/time precision, quantity or censoring bound, units/basis/fraction, all issues and complete original row. Expand **Every changed preparation field** and individual complete outcomes. Absent properties, null and empty text remain distinct in the full values.
5. Search all retained original/interpreted values, filter changed or rejected rows and use Previous/Next. A whole-mapping error is displayed as unavailable for that side; it is not relabeled as a per-row scientific rejection. A parsed row is not a quality approval, independent observation, native-reach match or calibration input.
6. Download **Complete comparison**, **Readable offline comparison**, **Unchanged original**, and **Complete preparation history**. Every row, all mapping editions/ancestry/receipts and original binary worksheet companions remain in the complete JSON. The standalone HTML contains that complete JSON, searchable paged tables and working complete-source downloads without a service.
7. Open a complete comparison JSON in the comparison panel. The original complete-history validator and unchanged current parser rederive its full identity before publication. A different original, modified outcome or incompatible current interpretation is rejected without replacing the open preparation or earlier comparison. Keep the original selected file if its historical normaliser is no longer installed.
8. Choose **Review this after revision in the original preparation** only when that revision is the identical currently saved working preparation. The callback rejects a different workspace, preparation, revision, mapping or pending/unfinished working copy. It opens the original native preview; the scientist still explicitly confirms and uses **Import reviewed source** in the original form. Historical comparisons remain readable/downloadable and never overwrite current fields or cause bulk import.

The existing preparation download/import remains the supported way to receive its full history into another original workspace. Reopening a comparison alone is read-only and does not create or import a preparation.

## Explicit original characteristic interpretations

The current original normaliser already supports WQP characteristic editions v1 and v2. Guided intake now exposes those exact supported choices and original method/speciation/depth/time/temperature/weight-basis column mappings. Selecting a characteristic edition explicitly selects its required existing detection-condition edition. It does not create another normaliser or change legacy unpinned sources.

Switching to the original characteristic mapping retains unfinished extended column choices in that working copy's browser recovery and removes them from the active native mapping. Selecting a characteristic edition again restores those retained controls. Previously saved native revisions remain immutable. Use the complete comparison to inspect the actual effect. WQP solids v2 keeps SSC versus TSS distinct; NTU versus FNU, microbial count methods, censor bounds and chemical fractions/bases retain the scientific module's original meanings. Recognition does not establish native scientific eligibility.

## Existing API and CLI

The original /intake dispatch gains three read-only operations:

- GET /intake/PREPARATION/comparison-history returns the whole selected preparation and its exact historySha.
- POST /intake/PREPARATION/compare accepts {beforeRevision,afterRevision,expectedHistorySha}. A changed history requires another explicit selection read.
- POST /intake/comparison-reopen accepts the complete downloaded comparison and verifies all original content and outcomes.

There is no new store, writer or shared HTTP dispatcher. Current source-edition, sediment, Flow, recipe and original-file transfer handlers are preserved.

Use the original CLI and actual existing Measurements directory:

~~~sh
node measurement_workspace/engine/cli.mjs intake-comparison-history --workspace ORIGINAL_DIRECTORY --id ORIGINAL_PREPARATION --output complete-history.json
node measurement_workspace/engine/cli.mjs intake-compare --workspace ORIGINAL_DIRECTORY --id ORIGINAL_PREPARATION --file exact-selection.json --format json --output complete-comparison.json
node measurement_workspace/engine/cli.mjs intake-comparison-reopen --workspace ORIGINAL_DIRECTORY --file complete-comparison.json --format html --output comparison.html
~~~

Create exact-selection.json from the returned exact history SHA and the two reviewed revision numbers. The existing CLI owns its normal store lifecycle and exact output publication. No hidden source mapping or import is added.

The native request/output ceiling remains 128 MiB including JSON envelope. Full row publication is bounded while the comparison is built; if it cannot fit, the operation fails without publishing a partial result or changing original source/history. Existing large-file intake and original complete preparation downloads remain available. Rows are never truncated to manufacture a passing comparison.

## Same original receiving continuation

Use the existing completed guided-intake course and its actual Node22/24, native store and isolated browser. Preserve every completed import, original input, source and operation ID. No second customer workspace or scientific solve is required.

The additive engine/intake-comparison-receiving.mjs exports operateIntakeComparison. Its caller supplies the existing Page, original endpoint, preparation ID and a new owned attempt-output directory. It reads the actual full preparation, operates the comparison controls, opens/downloads both full exports, reopens the comparison through the actual UI, checks the original store before/after, captures desktop and 390 px images, and retains every actual output. The caller retains Page/server/process/lock ownership.

~~~js
import {operateIntakeComparison} from './measurement_workspace/engine/intake-comparison-receiving.mjs';
await operateIntakeComparison({
  page: originalPage,
  endpoint: originalEndpoint,
  preparationId: originalPreparationId,
  directory: originalReceivingDirectory + '/interpretation-comparison'
});
~~~

Resume with the same original arguments. Each invocation creates an immutable attempt directory under the source/input-bound output; older downloads and images remain. It performs no import or source decision. An already completed result can be read and its original attachments reopened without issuing another native calculation.

Follow root/project AGENTS and CURRENT_OWNER_DIRECTION.md version2026-10-13.4. The producing worker must personally operate and LOOK at the populated desktop/390px app, offline HTML, original-source and complete preparation/comparison downloads, then reopen the original store. View captured screenshots; capture alone is not acceptance. Repair actual clipping, unreadable values or broken controls in this same course. Source/V8 review is not SQLite execution or rendered completion. Preserve active native jobs, all original scientific owners and client contact controls; no hosted Actions or paid runtime is needed.


---

## Complete current owner direction carried into this receiving continuation

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.4`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build and finish as much of the existing Eco science application as possible before Bryce's call. Bryce renewed this work directly at **October 13, 2026, 10:46 a.m. Eastern / 14:46 UTC**, after the earlier 10 a.m. preservation checkpoint. Resume the existing unfinished work from its actual saved state and preserve completed outputs, active processes and original implementation ownership.

## Direct owner instructions

Latest direct instruction, October 13 at 10:46 a.m. Eastern:

> Get as much of eco science done with the fleet as possible before my call. Try to get it finished its possible im throwing shit ton of agents just get it done

This current instruction supersedes the earlier 10 a.m. Eco work cutoff. Prior cutoff records remain historical evidence. Coordinate at the existing Eco thread, reconcile actual issued handles, complete unfinished integration and native receiving, and publish usable durable handoffs in the existing application. Preserve the distinction between the sender's completed runs and the runs actually included in a received Study. Existing workers keep their current operations; additional workers clear complementary blockers. The recorded call remains unchanged; this direction schedules no meeting or automation and authorizes no client message.

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

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.4` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.

