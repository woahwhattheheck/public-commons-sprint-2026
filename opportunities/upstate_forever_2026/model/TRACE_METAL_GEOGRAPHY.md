# Original trace-metal station geography

The trace-metal study now uses the existing Station geography workspace, maps, original-record inspector, watershed membership tables and complete native package. Its inputs are the exact imported Published studies edition: five original WGS84 monitoring locations and 204 original result rows. The row set contains 153 metal results and 51 calcium, magnesium and hardness results from the same 17 sampling activities.

The original nine-metal measurements remain 38 quantified results and 115 below-limit results with blank measured cells. The reporting limits retain their own original values and units. Spatial membership neither replaces those cells nor converts them into concentrations, risk categories or exceedances. Original analytical methods, sampled medium/fraction, result/activity/laboratory comments and all source selectors remain available in the ordinary study and geography exports.

## Open and use the saved study

1. In **Published studies**, import **Eighteenmile 2023 — trace metals and same-activity chemistry**. Keep the original imported version when continuing an existing operation.
2. Open **Station geography**. The prepared selections show an **original monitoring points** choice for each retained source version. When the exact original 217-HUC12 model domain is present, a separate **original 217-HUC12 domain** choice appears.
3. Choose the intended support. The point-only choice locates the original stations and retains all observations; its description explicitly says watershed membership is not selected. The domain choice uses all original polygons and the maintained native-CRS point/polygon reader.
4. Build through the existing operator queue. Open its normal completed task, saved geography edition or native result download. All five stations and all 204 results must be retained without unresolved or unassigned rows.
5. Inspect the original point coordinates, each station's sampling records and any retained watershed memberships. Boundary and overlap memberships remain explicit. Original station identifiers and exact original result identifiers are visible in the underlying native records.
6. Use **Published studies** from the station result to open the selected station or current filtered set in the already-maintained geographic cohort handoff. Choose exact parameters and calendar filters, inspect the source cells and save a review. The ordinary scientific-source and ordered report workflow then applies to that saved selection.
7. Download the original native geography ZIP, map/report, station CSV, observation links and watershed crosswalk. Extract the ZIP and open the contained report as a recipient. The complete original study ZIP retains the interactive trace explorer, all nine original response files, all native source tables and the complete original station response.

The station view does not combine the nine different metals into a station concentration range. Use the original Published studies parameter/method/unit/fraction grouping for numerical summaries. The 51 chemistry rows are contextual records from the actual sampling activities; their values and units retain their own original meaning.

## Exact source and spatial identity

The adapter reads the source already imported into the Workspace, including the frozen study ID, version ID, bundle hash, original source manifest hash, source collection and native point/table IDs. It reconstructs the same retained trace source from its complete unchanged input package and verifies the imported bytes before preparation. It does not read newer application data over an older saved study.

The original point source is `native/stations-wgs84.geojson`. Its explicit CRS is EPSG:4326. The native monitoring-location identifier remains the feature identity; `site_id` provides the normal Published studies identifiers SV-245, SV-268, SV-374, SV-375 and SV-376. Exact retained aliases join their original WQP monitoring-location identifiers to those five sites.

The observation table is `selected/metals-and-chemistry.csv`. It preserves every original publisher cell and the seven original-record lineage columns. `TraceRecordIdentity` is the original response SHA256 plus the maintained one-based source record index. An activity has several measured characteristics, so the adapter deliberately uses this record identity rather than treating an activity ID as a unique result ID.

The optional domain is the retained original 217-HUC12 source verified by the existing `station_study._domain` reader. Its decoded body SHA256 is `2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af`. Native HUC12 strings and original geometry are used through the existing engine. The actual domain is separate from a generic simulated square or a utility protection footprint.

The immutable preparation binds the exact native source IDs and domain choice. A saved preparation resumes that original selection even if additional sources later become available. A new source version or new spatial support creates another preparation and native geography edition.

## Native preparation and complete receiving

Run from the current complete application with its actual qualified Python and GIS dependencies. The application includes the merged trace source component and the maintained Published studies and Station geography engines.

Read the exact source choice before building:

```sh
"$ACTUAL_PYTHON" -B -m model.trace_metal_geography \
  --workspace "$ACTUAL_WORKSPACE" --domain-mode auto preview
```

The module's ordinary `build` command creates the saved geography inside the original Workspace. Its `inspect ID` command verifies all original source bodies, all five coordinates, all 204 original rows and the retained native membership result.

The complete receiving course imports the installed exact trace study if no explicit retained version is supplied, builds the saved native geography, exports the full original study and native geography, independently receives both into a new Workspace, and compares the original scientific content. It also creates and independently reopens the complete editable project by default:

```sh
"$ACTUAL_PYTHON" -B -m source_tools.receive_trace_metal_geography \
  --workspace "$ACTUAL_WORKSPACE" \
  --output "$TRACE_GEOGRAPHY_RECEIVING" \
  --domain-mode auto
```

Use an owned output directory outside the application and original Workspace. Add `--version-id "$ACTUAL_IMPORTED_TRACE_VERSION"` to choose a particular retained source edition. Domain modes are:

- `none`: original monitoring points and result linkage.
- `auto`: use the exact original domain if retained; otherwise retain a clearly labeled point-only edition.
- `required`: require that actual original 217-HUC12 domain.

Continue the same operation with the identical arguments and `--resume`. The frozen original source version, preparation, native study and complete exports are reused. A completed ZIP is verified and reused if its outer checkpoint was interrupted; a successful full-project resume preserves the original scientific receipt while omitting the transport's operational reuse flag.

When the same current native course already owns the full-project backup, `--geography-only` explicitly limits this continuation to the complete native geography and original-study packages plus their independent receiving. It retains the full scientific source and map/result comparison. Keep that flag unchanged on resume. This option does not replace the existing owner's project receiving operation.

The receiving directory retains the exact request, study binding, preparation, original native operation, complete source science, original study ZIP, native geography ZIP, independent receiving and final `receiving.json`. The default full course additionally retains the complete project archive and its independent restored application/Workspace.

## Receiving identity and continued editing

The full-project restore preserves the original project, study version, native geography edition and source collection identities. The independent native geography import may legitimately assign different collection and project IDs. The receiver therefore compares the original source hashes, station IDs and coordinates, all 204 complete original record dictionaries, membership IDs/relations and result counts across that remapping. It also imports and reopens the exact original Published study archive, allowing the existing map-to-study handoff to continue in the receiving Workspace.

No displayed map coordinate, rounded table string or SVG path is used to reconstruct the source geometry. The maintained native package retains the original source bodies, companions, source manifests and selection. Native receiving uses that package's existing importer and rebuilds its original spatial selection.

## Installation and ownership

The component fragment `integration/component_fragments/trace-metal-geography.json` adds this producer/receiver/guide to the existing trace Published study and Station geography components. The only shared catalogue change is a lazy prepared-study extension. The existing browser renders a supplied escaped description so point-only support is explicit. Existing nine-study, assessment, microbial, station map, task and geographic review behavior remains in the maintained whole files.

Original operation: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791890856084609
Existing trace browser/native receiving: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791885974666719

Apply this complete source at the existing owner’s quiet source boundary. Keep the actual regional native model execution and its original data/operator owners progressing. This geography continuation uses retained observed data and existing native GIS operations; it does not start a nutrient or sediment model.

## Actual outgoing product course

The producing worker must operate and personally view the exact outgoing populated Station geography desk and contained reports at desktop and 390px widths, including the two spatial-support descriptions, task completion, station selection, map controls, original result inspection, source links, filtered station handoff, exports and independent reopening. View the actual downloaded and extracted HTML, CSV/JSON, ZIP contents and restored editable project. Check empty, loading and error states without replacing the scientific Workspace with an empty demonstration. Return actual image bytes or viewable images to the source author in the existing receiving thread. Any visible defect is repaired within this same owned product.

## Standing final-product instruction (owner clarification, 2026-10-13)

Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing peer must actually open, run or render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check actual screenshare and narrow/mobile widths where relevant, populated, empty, loading and error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within authorized work before presenting it. Code review, DOM counts, HTTP 200, unit checks or another peer’s approval do not replace seeing the product.

ALL ATTACHMENTS count: literally open, view, play and use final HTML, PDF, report, slides, spreadsheet, map, image, video, audio, archive and project as the recipient would. Extract archives and open contained deliverables/working project. Use high-quality generative media and natural voice/TTS for videos; watch/listen to final exports for pronunciation, pacing, timing and audio alignment. Keep building/fixing; inspection is not review/test performance theatre.

Ecosystem design is plain industrial, with readable tables, clear hierarchy, consistent typography/spacing, restrained controls and responsive layouts; preserve real workflows, data and computation. Reviews lead directly to repairs, with focused validation, no broad suites or separate verification product. Empty Workspace screenshots do not accept a scientific Workspace.

Persist this complete instruction, including the all-attachments/media clarification, in active owner-controlled policy/provider/bootstrap/source mirrors and consumed build/receiving guides and child assignments. Preserve existing owner controls, historical evidence and vendor policies; no forced restarts, watchers or revival of owner-stopped work. Continue current original scientific/run/browser/receiver owners and native/runtime/archive work through the October 13, 2026 14:00 UTC cutoff. This does not expire the standing inspection rule. Source: original Ecosystem coordination message 1791885321.786379.


## Current owner direction — preserved source

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


## Verbatim original coordination direction 1791887422.395359

BRYCE CURRENT DIRECTION — ECOSYSTEM MODEL / DEMO / PRESENTATION. Pass this complete update into current worker assignments and onward handoffs; the feed is moving quickly.

Exact new owner instructions:
“do the simulated model”
“just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it”
“and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast”
“just checking dont pause anythi g”

Implementation direction:
• Tim/Ecosystem already publishes GIS, watershed/environmental modeling, data analysis, map/report publishing and natural-capital decision-support work. Do not assume a tools/capacity gap or pitch generic GIS as novel. Build a concrete production workshare he can compare with his existing workflow; prime retains scientific direction/method choices/review/client relationship.
• Center the demonstration on THIS UpperSavannahRFP: actual geographic/source shapes,30mgrid, upstreammodeldomain vsSCreportingmask andutilityfocus, clearlysimulatedrealisticinputs, nativeInVESTNDR/SDR baseline+restoration+matchedcontrol, annualN/Pkg/year andsedimenttonnes/year reachingstream, meaningfulcomparison/maps/report, editableparameters/sourceeditions andexport/coldreopen. Keep load/concentration and stream/intake distinctions correct.
• Actual simulatedmodel execution and the connected usable product are the hard priority. Runtime/source existence or another plan is not the run. Preserve already-running jobs andonewriterperWorkspace; use existingequippedruntime or provision an isolated actualexecution environment when needed. Root has explicitlytakenactualexecution; otherbuildscontinue.
• Make relevance and speed visible through what Tim can USE: chooseinputs/assumptions→run→inspect differences→revise→hand over work his team can continue. Show actualproducedartifacts and real elapsedhistory; no inventedtimings/guaranteedreaction. Avoid stockscreen/decorativepitch/demo-onlytheatre.
• Open/look/use finalproduct and ALLattachments asrecipient, fixobviousdefects, naturalgenerativeTTS/mediaifused, actualapprecordingratherthan generatedscreenspretendingexecution. No review/testtheatre or substitutionforhardbuild.
• Cascade thisdirection to otherEcosystem/product/model/report/presentationpeers atnextsafemessageboundary; persistindurablecurrentworkorders/startupguide andincludeversion/pathwithnextsubstantiveresult. Don'tstopactivecalculations, restartheld/deletedtasks, spawnanothercontroller oraskBryce torelay.
No bid/prime-yesgate or arbitraryproduct/featurecap. TODAY10a.m.Eastern/14UTCcutoffremains. Existingfocusedvalidation,noPrivateGitHub/Actions,labattribution,contact/meeting/spendcontrols remain. SharedGitHubcurrentownerbrief landingunderopportunities/upstate_forever_2026; Rootwillreturntheactualpath/head.


