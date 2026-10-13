# Return a paired result review to the scientific Workspace

This additive receiver imports a recipient's saved modeled-result-cell review into the existing Sources and Spatial Review tools. It uses the original paired consumer for the actual GIS mask and numerical CSV. It does not prepare a treatment, change a scenario, or execute InVEST.

## Receive the actual saved review

Install the complete `paired-review-workspace-adoption` component with its existing `paired-spatial-review` and `retained-application-source` dependencies. Use the same qualified scientific Python as the existing paired consumer. Select an existing Workspace; this command never creates or substitutes a project.

```sh
PYTHONPATH=/absolute/application /absolute/python -B \
  /absolute/application/source_tools/adopt_paired_spatial_review.py \
  --workspace /absolute/workspace \
  --atlas /absolute/original-spatial-reader \
  --review /absolute/downloaded-spatial-review.json \
  --output /absolute/new-returned-review \
  --title 'Returned riparian result review'
```

`--atlas` accepts the original standalone reader directory, its exact atlas.json, or the enhanced native paired product directory/spatial-review-atlas.json. Keep the original chosen product and all its raster/source files. The output must be a new sibling outside both the original atlas and the Workspace. An explicitly empty saved review is valid and imports a zero-cell mask.

The optional `--pollutant` chooses nitrogen_export, phosphorus_export or sediment_export from that original product. By default the saved reader's pollutant is used. Optional `--previous-review-id` links an actual existing native SpatialReview in this same Workspace. A changed request uses a new output directory; the original receiving edition and previous saved view remain available.

## Use the actual returned project

The printed result and `result.json` contain the real project_id, source_collection_id, receipt_source_collection_id and spatial_review_id. Open that saved view in the existing Spatial Review desk. Its left panel is the original mean reduction for the selected pollutant; the right is the original-grid review mask (1 selected, 0 unselected). Each retains its own units. The view uses compare mode, with no subtraction between these different quantities.

The literal note stays in original-review/review.original.json; long notes have an explicitly shortened map annotation. Every original row-major cell index, atlas/analysis identity, three physical-output units, profile support, full-precision CSV and all chosen-product statistical TIFFs are retained. Mean-reduction sums retain the original receiver's meaning; they are not whole-catchment quantiles. Positive reductions mean baseline minus alternative. Selected area means modeled result-cell area and is not restored land.

Sources contains the editable original review, its numerical table, GIS mask, native receiving report and the original mean-reduction rasters. The complete original atlas bytes are retained unchanged as a companion. This adoption intentionally bundles only the selected product from that atlas; other products named there need their own original handoff. The selected product's original `products/<id>/...` relative paths remain usable beside its retained atlas, including after source-view creation or cold restore.

The separate ordinary receiving-record source contains the immutable input, actual source/view linkage and complete selected-product source closure. For an editable selected Study, use the existing chooser to include that receiving-record source and the actual saved SpatialReview. The existing source and SpatialReview transfer machinery carries their bound originals. A full Workspace backup already retains both source collections and the saved view. Use the original Study/Workspace export, independent receive and reopen paths; this feature adds no alternate archive format.

## Repeat and recover

The adapter freezes the source selection in adoption-input.json before import, uses create-only exact files, and preserves differing existing outputs. The same input produces the same source collection and saved view IDs. If interrupted after saving the view, the existing native content identity is reused; after a receiving record exists its exact saved view is reopened and validated rather than recreated. Repeating the same completed command verifies/reuses the complete original selection. Keep result.json with the human handoff.

At the existing receiving boundary, personally open the actual saved view at desktop and narrow width, inspect an original raster cell and its units, read the full note, use the original CSV/JSON/GeoTIFF downloads, export the selected Study and reopen it independently. Verify the returned result.json IDs against that actual received project. Preserve the original native model job and current source owners; this is the returned review of an already-complete product.

---

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
