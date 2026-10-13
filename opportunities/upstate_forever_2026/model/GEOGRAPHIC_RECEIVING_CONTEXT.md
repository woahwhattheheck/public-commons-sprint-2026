# Original utility comparisons in the geographic native course

The same completed geographic baseline, restoration and matched-control outputs now feed the application's existing Receiving Water analyses and scientific reports. This addition does not execute another native model or calculate a new transport process.

## Scientific product

The report keeps two distinct source relationships:

1. **Original HUC12 study anchors and their upstream ToHUC closure.** Each selected reporting HUC is an explicit analysis anchor. Its original name, twelve-digit identifier, polygon and topology attributes are retained. These are potential contributing areas at HUC12 resolution; a HUC anchor does not locate or delineate a drinking-water intake.
2. **Original published protection footprints.** The selected ARJWS/Pioneer polygons retain the published 1500-foot or 200-foot footprint, original source attributes and intake reference. No new buffer or replacement clipped union is used to define the original source area.

For each relationship, the existing analysis is retained separately for the full original model domain and for the actual South Carolina reporting intersection. Whole source-polygon area, its intersection with the selected quantity scope, selected pixel area and finite valid coverage remain separately available. Nested upstream catchments and overlapping protection footprints must not be added; the maintained family-union result counts each selected land pixel once within that plan.

Each analysis contains the original baseline annual stream export, each alternative's annual stream export, signed alternative-minus-baseline changes and separate positive increased/avoided components. Nitrogen and phosphorus use kg/year, sediment uses metric_tonnes/year. Changes use the original paired finite native pixels, with common-baseline and common-alternative masses retained by the original analysis. Independent full-support totals are not silently substituted for that paired comparison.

These values describe modeled land export reaching streams. They do not calculate intake concentration, reservoir throughput, travel time or treatment removal. The same geographic edition retains its explicit simulated terrain, rainfall, land cover, coefficients, restoration corridor, control matching and actual native parameters. The original 1296 ha teaching square remains a separate geographic edition.

## Existing implementation and source identities

model/geographic_receiving_context.py calls the maintained receiving_waters.prepare, receiving_waters.analyze and receiving_water_report_source.prepare. Original analysis CSV/GeoPackage/raster outputs, source polygons and companions flow into the existing observed-context scientific report and complete source/archive path. The current shared Scientific Reports formatter and projected-geometry renderer remain authoritative.

The helper reads the exact saved geographic-headwaters/<id>/prepared.json, verifies every retained original input receipt member and checks its project, geometry, original native run/grid/profile/scenario selection and per-model producing runtime. It uses the unchanged current public specification at:

source/water_context/20261012/public-water/receiving-waters.public-spec.json

Each selected original protection body must match the original hash declared there. Nested original intake references resolve by exact original bytes/hash to an actually retained source entry, preferring the selected collection and preserving an exact original from another existing collection when appropriate; missing source data is obtained through the same original source course rather than replacing it with an inferred point. The union of original upstream receptor HUC memberships must equal the prepared native model-domain HUC membership.

The result lives under geographic-receiving-contexts/<id>/context.json. Identity includes original preparation bytes, exact run selections/output descriptors, source plan selections, quantity scopes and the producer/report implementation hashes. The original input receipt hash remains bound. Runtime synchronization files ending in .lock are explicitly recorded as the same omissions used by the maintained portable inventory; every scientific input member remains verified. Existing completed Receiving analyses and report sources reopen through their ordinary inspectors. An interruption resumes those retained calculations and report captures.

## Direct existing-run invocation

Run from the current received application, with its existing qualified Python:

~~~bash
"$PYTHON" -B -m model.geographic_receiving_context \
  --workspace "$GEOGRAPHIC_WORKSPACE" \
  --prepared "$GEOGRAPHIC_OUTPUT/prepared.json" \
  --output "$GEOGRAPHIC_OUTPUT/utility-comparisons.json"
~~~

The optional repeatable --scope model_domain / --scope reporting selects an explicit scope; omission retains both. Use the existing one-writer geographic receiving course. This command reduces existing native outputs and generates source reports; it does not start NDR or SDR.

## Integration with the original geographic receiver

C57E owns the current source_tools/receive_geographic_headwaters.py caller and its independent archived-application continuation. Compose these additions at that owner's existing boundary:

~~~python
from model import geographic_receiving_context as utility_context
utilities = phase("utility_comparisons",
                  lambda: utility_context.prepare(workspace, prepared))
atomic_json(output / "utility-comparisons.json", utilities)
save(utility_comparisons=utilities)
~~~

Place that call after the original native parameter course is complete. After the existing ensemble delivery_selection call, preserve every prior source and append the utility sources:

~~~python
selected = utility_context.append_sources(selected, utilities)
~~~

Add utility_context.source_collection_ids(utilities) to the existing review's source_collection_ids, preserving its original order and deduplicating exact IDs. Bind utilities["id"] into the existing archive-edition identity. The independent archived-application verifier must reopen utility_context.inspect(reopened, utilities["id"]), along with all existing original project/run/report/review identities. The same complete workspace archive includes the retained receiving plans, analyses and report sources.

Do not replace the current receiver with an older full file. Its current journal, customer-response generation, original archive reuse, handover and independent subprocess checks remain in place.

## Actual product use

In the same completed geographic Study, open the utility report sources, inspect each original source relationship and both quantity scopes, select restoration and matched control, and read their paired-support rows. Open the CSV, original source geometry, maps, scientific PDF, saved HTML and full extracted project. Reopen the actual completed receiving context in the archived application.

The producing worker must open and view the exact outgoing pages and all attachments as a recipient. Inspect populated desktop and 390 px views, map/source labels, quantity units, clipped/empty support and controls; download and reopen the files. Return actual viewed screenshots and the relevant PDF map/table pages through the existing source/native operation so defects can be repaired. Source review, hashes, successful HTTP, DOM inspection or captured-but-unviewed images are not a visual pass.

## Complete current owner direction

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

