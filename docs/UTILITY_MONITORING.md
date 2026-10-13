# Original utility source report to an editable monitoring programme

Regional watersheds now prepares the actual selected utility footprint as a source-bound Monitoring network. It reuses the original receiving-water geometry, native network, optimization, calendar, campaign, FIELD12 and Transfer workflows. The utility report supplies the original geography and observation context; the user supplies the actual programme budget, costs and dates.

## Operator journey

1. Open **Regional watersheds** in the existing scientific Workspace. Open the saved regional report with its original HUC12/ToHUC network.
2. Save and export the utility's contributing watersheds. ARJWS retains its four original HUC12s; PRWD/Pioneer retains its 32 original HUC12s. The original profile, topology membership, source report and complete observation packet remain with that saved export.
3. In **Saved watershed selection**, choose **Prepare utility monitoring network**. The station option includes the utility's original microbial station locations. Clear it for an explicitly station-free planning edition.
4. Open the resulting **Design a monitoring campaign**. The existing Monitoring desk selects the exact saved native network and visibly fills candidate exclusions for context HUCs. It preserves the complete 217-HUC graph.
5. Enter and review the real budget, setup and visit costs, overhead, site limit, calendar, rounds, crews and travel assumptions. Choose local catchment coverage or the original outlet-context objective. Review advanced constraints, including the visible exclusions and any actual existing-station credit.
6. Solve the ordinary native design or budget frontier. Review its actual feasibility/optimality status, selected HUC search areas and schedule. Create its editable campaign.
7. Bind actual retained station locations to planned visits, record real field events and samples, and use the existing Monitoring → Implementation transfer. Actual meeting decisions from the utility source briefing can be received into the same editable fieldwork plan through **Receive briefing follow-up**.
8. Export the existing field package/report and complete editable study or Workspace. Reopen the retained network, campaign and exact fieldwork revision in the receiving Workspace.

Each step preserves its own original source or decision identity. Preparing the network does not solve a design or choose a budget.

## Geographic meaning

The footprint is the union of the selected original whole HUC12 polygons. It is saved in EPSG:5070 with original attributes and native feature IDs. Keeping that projected geometry through receiving-water preparation avoids a WGS84 round trip that could create tiny positive boundary intersections.

The existing source-only receiving-water plan records the footprint as a selected source area in the critical-drinking-water family. Its classification explicitly says **Utility whole-HUC planning footprint**. Published intake-protection polygons and within-HUC drainage remain separate source boundaries.

The maintained receiving-water Monitoring engine assigns each original HUC its EPSG:5070 overlap hectares with that footprint. All original domain HUCs and downstream links remain in the network. Context HUCs receive zero target weight and appear in the editable candidate exclusions.

| Quantity | Meaning |
| --- | --- |
| Target weight, ha | Projected vector overlap with the selected whole-HUC utility footprint |
| Network area, km² | Existing Monitoring engine's geodesic area of the complete original domain |
| Candidate count | Exact number of selected utility HUC12 planning units |
| Original NRCS acres | Publisher whole-HUC/state-portion fields in the retained utility report |
| Microbial result, original MPN/100 mL spelling | Original sampled concentration and detection/quantitation condition |
| Native N/P export, kg/year | Separate InVEST land-origin annual mass outputs |
| Native sediment export, metric tonnes/year | Separate InVEST land-origin annual mass output |

The adapter does not substitute one of these quantities for another. The planning weight is an area objective. It does not measure detection probability, microbial concentration, pollutant removal or intake concentration.

The saved utility report uses its original 303-record topology to determine upstream membership. The native monitoring network uses the retained 217 polygon records and their original ToHUC links. The preparation reports both the native reverse-graph membership and any differences from the saved utility selection, together with original external upstream HUCs. Review outlet-context coverage when a path leaves that retained graph. Local coverage retains the selected planning-unit meaning.

## Original station coordinates and source observations

When selected, the adapter uses the maintained utility microbial receiver to receive or reuse the complete original station/result source edition. It selects ARJWS's five or PRWD's 31 station IDs by the original publisher-derived utility assignment.

The native vector reader transforms each original coordinate group from its declared datum: 34 WGS84 and two NAD83 stations in the complete source family. The transformed planning points retain the original coordinate strings, datum fields, source row, station identifier and utility-membership basis. The source collection retains all original coordinate files and companions.

The existing Monitoring engine performs actual point-in-polygon assignment. Boundary ambiguity and outside-domain locations remain visible as station-assignment issues. A publisher utility assignment does not override those spatial findings. No centroid, invented station or unverified outlet flag is added.

Historical sampled stations are available source locations. They are not automatically selected as currently operating stations or granted existing-programme coverage. Those choices remain explicit in the original design.

The complete original utility report ZIP accompanies the planning source. It preserves 142 ARJWS and 588 PRWD microbial records, methods, activity types, qualifiers, detection/quantitation limits, source comments and exact source-unit spellings. The 589 regional nutrient records and their flow context remain explicitly regional; they are not reassigned to either utility.

## Native operation

From the complete application and its existing GIS environment:

~~~sh
python -B -m model.utility_monitoring \
  --workspace /absolute/existing/scientific-workspace \
  prepare --export-id ACTUAL_SAVED_UTILITY_EXPORT_ID
~~~

For a station-free edition, add --without-microbial. The saved utility report must already exist in the same Workspace, and the original 217-HUC polygon source must be imported. Automatic domain selection verifies the decoded original body SHA256 2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af. This avoids substituting a generalized display outline.

The Python API supports an explicit retained domain when several editions are present:

~~~python
from model.utility_monitoring import prepare
record = prepare(workspace, {
    "export_id": actual_saved_export_id,
    "include_microbial": True,
    "domain": {
        "collection_id": actual_original_domain_collection,
        "source_id": actual_original_domain_entry,
    },
})
~~~

The source-only operation returns the actual operation ID, source collection, receiving-water plan, Monitoring bridge and native network ID. It also returns its method, target/candidate summary, station assignment issues and recommended exclusions.

~~~sh
python -B -m model.utility_monitoring --workspace /absolute/workspace \
  inspect --operation-id ACTUAL_OPERATION_ID
python -B -m model.utility_monitoring --workspace /absolute/workspace list
~~~

The operator queue action is watershed.context.monitoring. Its payload contains export_id, optional domain and include_microbial. The existing authenticated regional route reads the result through /api/watershed-context/monitoring with monitoring_id. The native catalogue includes utility_monitoring rows; no second task service is introduced.

## Interrupted work, receiving and originals

The preparation is retained under utility-monitoring/<operation-id>/. Its identity binds the exact export/selection/packet, original domain source, selected geometry, transformed station view, native coordinate sources and current composing modules. intent.json keeps the first preparation timestamp. Repeating an unchanged operation reuses completed native products and the exact final record; a changed source or implementation creates its own edition.

The source manifest retains the footprint, optional station view, original domain and its sidecars, original coordinate source editions and companions, complete utility report packet, selected-watersheds.json, original utility profile and method. Original files are copied in bounded chunks, checked against their byte counts/hashes and atomically published. Both footprint and station source entries carry the complete original context.

The existing receiving-water Monitoring engine retains its own original plan, derived catchment source and complete native network. It recovers an already completed network import if a process stopped before its final result was saved.

Workspace backup takes the same .utility-monitoring.lock as preparation before inventory. This prevents a capture from silently interleaving the source composition. The ordinary complete Workspace retains all operation files and native source objects. Inspecting a restored operation verifies its original export, saved source files, receiving plan and monitoring network.

Use the original Monitoring design/campaign and FIELD12 receiving commands on the returned IDs. The guide docs/UTILITY_SOURCE_BRIEFING.md covers the source report and actual meeting-note path. operator/RECEIVING_WATER_MONITORING.md and model/MONITORING.md cover native cost/calendar/solver semantics.

## Delivery

Install the complete cumulative application, preserving the existing registry and current Monitoring implementation. The maintained watershed installer now includes this adapter and guide. Its source selection uses the already retained original microbial edition or the complete bundled original manifest; it does not download another source family.

The original DD6B/640a regional project remains the native receiving course. Record its actual returned operation/network/plan IDs and first exception when operating this continuation.
