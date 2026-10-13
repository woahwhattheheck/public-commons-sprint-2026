# Use the completed geographic case in Programmes

The geographic preparation already retains the original upstream domain, South Carolina reporting mask, utility protection geometry, declared simulated inputs and baseline/restoration/matched-control selections. This adapter puts those **same completed native runs** into the existing Programmes desk. Source-update successors, native stage candidates, report controls and native-study delivery then work on the actual geographic case through their maintained APIs.

The original mapped delivery may select either alternative or both. Adoption preserves its nonempty, unique scenario order and every other delivery selection field; the saved Programme and its native report still retain all three reference cases.

## Continue the existing receiving operation

Use the current geographic owner's actual application, qualified Python and Workspace. Preserve any active native writer. The current receiving call remains authoritative; this is one append after its original three reference runs complete. The twelve-member parameter course can keep its own original state and source identity.

Stage these complete additive files at the normal source-install boundary:

- `model/geographic_programme.py`
- `source_tools/adopt_geographic_headwaters_programme.py`
- `source_tools/GEOGRAPHIC_PROGRAMME.md`
- `integration/component_fragments/geographic-programme.json`

The component requires the maintained `geographic-native-receiving` and `programme-activity` families. It adds no server, queue, journal or alternate model implementation. Existing native execution and source creation remain with their current owners.

Read the original identifier from the receiving course's `prepared.json`, or from `geographic-headwaters/<id>/prepared.json` in the same Workspace. Preview is read-only with respect to scientific records:

```bash
"$PYTHON" -B "$APP/source_tools/adopt_geographic_headwaters_programme.py" \
  --workspace "$WORKSPACE" --geographic-id "$GEOGRAPHIC_ID" \
  --preview --output "$RECEIVING/geographic-programme-preview.json"
```

The preview retains each original run and reports incomplete native stages explicitly. When all three original NDR/SDR reference cases are complete, run the same command without `--preview`. Supply its actual preview identity with `--expected-preview-id` if the operator reviewed that preview. Use the existing original mapped delivery's identifier with `--delivery-id` when available; its full scientific source/overlay selection is preserved.

```bash
"$PYTHON" -B "$APP/source_tools/adopt_geographic_headwaters_programme.py" \
  --workspace "$WORKSPACE" --geographic-id "$GEOGRAPHIC_ID" \
  --output "$RECEIVING/geographic-programme.json"
```

The result returns `programme_id`, original geographic/source/grid/profile/run bindings, the existing Programme's report, native-study map selection and measured reconciliation seconds. Open **Programmes** in the same application and select that saved title. Inspect baseline, restoration and matched-control rows, original source reference and report downloads. The original prepared record and native result IDs stay unchanged.

Creation invokes the original ComputeProgrammes comparison/report pathway with a Workspace whose run method can only verify completed native outputs. It cannot dispatch a missing stage. Repeating adoption verifies and reuses the complete saved Programme/report without calling execute again. Corrupt report/native bytes are reported through the existing operation. An existing completed CLI output is verified and returned unchanged, preserving its first measured timings. The callback accepts the same original result through `previous`; this keeps its handover/archive identity stable on resume.

## Join the existing geographic receiver

Current receiving owner C57E can call this additive function after the original reference runs complete, before its normal archive capture:

```python
from model.geographic_programme import adopt

programme = adopt(
    workspace, prepared["id"],
    delivery_id=delivery["id"] if delivery else None,
    previous=read_json(output / "geographic-programme.json")
        if (output / "geographic-programme.json").exists() else None,
)
atomic_json(output / "geographic-programme.json", programme)
```

If adoption runs before maps exist, omit `delivery_id`; the native-study selection already retains the original utility/reporting intersection. The original whole-Workspace backup includes the saved Programme and all its original sources/runs. Retain the returned adoption JSON in the existing receiving handover files, alongside the original prepared and mapped-delivery records. Let the current archive owner include it in that edition's original delivery file inventory.

For a cold-reopen check, use the **restored application's** Python module and actual received Workspace:

```bash
"$PYTHON" -B "$RESTORED_APP/source_tools/adopt_geographic_headwaters_programme.py" \
  --workspace "$RESTORED_WORKSPACE" --geographic-id "$GEOGRAPHIC_ID" \
  --verify "$RECEIVING/geographic-programme.json" \
  --output "$RECEIVING/geographic-programme-reopened.json"
```

The verification reopens the exact original geographic preparation, input files, native output bytes and saved Programme/report in the received project. It returns the original Programme/report/run identities with `identity: MATCH`.

## Open the original comparison in the existing live Operator

Use `model.geographic_programme.operator_opening(workspace, adoption)` to derive the original grid, profile, scenario, run, baseline, comparison and mapped delivery selections. It chooses the first alternative in the retained delivery's order and retains the saved Programme/source edition in the Guided journey context.

The existing live Operator can save that opening with `save_operator_opening(operator, workspace_key, adoption, expected_revision=observed_revision)`. Capture the revision when the operator explicitly requests this opening, before an asynchronous adoption starts. Pass `None` only when that observed session was absent. Retain the same revision with the original request; do not reread and substitute a newer revision during retry.

```python
from model.geographic_programme import save_operator_opening

opening = save_operator_opening(
    operator, workspace_key, programme,
    expected_revision=original_opening_request["expected_revision"],
)
atomic_json(output / "geographic-operator-opening.json", opening)
```

This extends the maintained session API. It creates no server, model run, queue or alternate session store. A successful save retains existing regional/community views and the API's notes history. Repeating the same selected opening returns `already_selected`. If the user changed that opening's selections or another view was saved after the observed revision, the helper returns `preserved_current` and leaves the current view intact. `selection_applied` says whether this original comparison is selected; a preserved view is not presented as an applied opening. An actual concurrent save during the API call keeps the original revision conflict behavior.

Keep this optional session result separate from the immutable scientific adoption. Include the exact returned session and file descriptor with the existing receiving handover. The original Workspace archive already captures `operator-session.json`. The restored child can call `verify_operator_opening(restored_workspace, adoption, opening)`; it verifies both the original geographic Programme and the exact saved or deliberately preserved session, returning its state, original IDs and `identity: MATCH`. A manual change after capture belongs to a later view; it does not rewrite the original scientific report.

## Source updates and native reuse

The existing **Update sources** control uses this saved Programme. Preview one actual retained source-refresh plan, review original-to-successor run/dependency mappings, and create its explicit successor. The original programme/report remains available. Equivalent native input stages can use the existing candidate mechanism; changed scientific inputs retain their original native execution decisions.

The already-merged whole continuation `source_tools/continue_programme_source_reuse.py` accepts this returned `--programme-id`. Its `--receipt` form is specifically for the separate 1,296 ha headwater teaching case; use the geographic Programme ID here. Any deliberately requested USLE-C sensitivity is a new declared assumption, preserving original source table values and exact Decimal change. Continue only within the current receiving owner's actual process boundary and cutoff.

## Scientific interpretation

The Programme preserves the original 30 m native grid and declared NDR/SDR scope. Reporting-area annual nitrogen/phosphorus quantities use kg/year; sediment uses metric tonnes/year. These are native contributions reaching modeled streams. The retained upstream domain, South Carolina reporting mask and utility focus have different meanings; the utility overlay does not turn a landscape export raster into an intake-load or concentration prediction.

The three reference runs share the original profile. Native comparison products retain their original finite-cell support. This adoption does not substitute alternative-only comparisons, combine pollutant units, add separate intervention benefits or infer a statistical effect from the placement control. The original matching summary and source assumptions remain available through the geographic collection.

Only real verification/reconciliation elapsed seconds are reported here. Native model timing remains in the original stage history; adopting completed results is not a new model runtime measurement.

## Current source and product receiving

Authored against current main `eed034e9c320160b77c0c8f0d07a0df45ab45c4e`, using the actual geographic producer, original Programme replay/artifact contracts and existing native runtime validation. Source review does not replace native receiving.

The producing worker must personally open and use the actual saved Programme, populated report/table/map and every outgoing attachment at desktop and narrow widths, operate exports and reopen the received project. Preserve the existing regional preparation, native computation and archive writer. Return the actual first exception in the existing geographic thread so this same source can be repaired.

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

