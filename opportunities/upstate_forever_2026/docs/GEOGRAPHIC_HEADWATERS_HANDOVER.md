# Geographic native handover

This is the receiving end of the existing Upper Savannah geographic course. It joins the completed native scientific report, mapped delivery, original geography and simulated input assumptions, exact comparison rows, complete customer review and editable application/Workspace in the ordinary native portable archive.

The producer and geographic receiver remain the owners of source selection, native calculations, reports and independent reopening. The handover helper never changes the Workspace, computes a modeled quantity or starts a new native case.

## Integration into the existing receiver

Application-relative source:

- `source_tools/geographic_headwaters_handover.py`
- `source_tools/simulated_headwaters_handover.py` (existing shared monochrome style and small HTML helpers)
- `docs/GEOGRAPHIC_HEADWATERS_HANDOVER.md`

The original geographic component must retain these complete source files alongside its current producer, receiver and cold-reopen helper. Preserve later same-path source editions.

After the existing completed `reviews.export_review` or `reviews.describe_export`, and before defining the native archive edition, call:

```python
from source_tools.geographic_headwaters_handover import prepare as prepare_handover
handover = phase("handover", lambda: prepare_handover(
    workspace, output, state, prepared, scientific, delivery, exported))
save(handover=handover)
```

Add `"handover_id": handover["id"]` to the existing archive edition identity. Preserve the original prepared, ensemble, scientific source, mapped delivery, review and response identities already used there.

The same existing backup call becomes:

```python
portable.backup(
    workspace, archive, include_intermediates=True,
    delivery_root=handover["directory"],
    delivery_files=handover["files"])
```

Use the exact current receiver\'s archive-edition and recovery implementation. Retain the full registered native stage artifacts required for editable reuse; current ECO12/C57E receiving review calls for `include_intermediates=True`. Source locks and transient cache exclusions remain with portable. The helper's directory is named with its actual 64-character identity, as the maintained portable API requires. It supplies original named descriptors and uses a generic delivery snapshot; it does not replace the native mapped-delivery record.

Handover version 3 also publishes `delivery/geographic-operator-choices.json` as the declared `operator_choices` delivery member. Its `upstate.geographic-operator-selection/v1` envelope is accepted by the existing Geographic model case desk's **Reopen choices** control. It carries the original project and geographic edition IDs plus the complete existing operator payload. The immutable handover record contains that same envelope; the handover identity and full portable manifest bind its bytes. Older handovers retain their original files and identity.

The final native ZIP includes `delivery/START_HERE.html`. Its scientific report, figures, maps, source documents and assumed input links point to existing `../workspace/...` members. The complete original customer-review directory is retained under `delivery/customer-review`, including every original artifact and response template. The existing archive captures the whole application and Workspace once; no outer wrapper ZIP or copied scientific raster tree is required. Local review files use verified hardlinks when the filesystem permits, with ordinary copies across filesystems. Portable capture verifies their expected bytes while writing.

After ordinary restore, the opening page is `Path(restored["directory"]) / "delivery" / "START_HERE.html"`. The original restore result also exposes `restored["delivery"]["files"]["opening_page"]`. Keep C57E's isolated restored-application cold checks and all original native/scientific/customer checks.

The existing source/runtime cutoff remains the receiver's responsibility. Continue through its maintained cutoff guard; a handover helper is not a new scheduler or controller.

## Contents and interpretation

The page shows the exact selected complete upstream HUC closure, original South Carolina reporting intersection and separate utility footprint, with original vector areas and pixel-centre coverage. It shows the selected grid's actual resolution, dimensions and CRS.

Every native comparison row comes from the original scientific source's `numeric/report.json`. Baseline, alternative, signed change, physical unit, common valid cells and exact comparison/support identities are retained. The page's filter changes which original rows are visible; it performs no scientific calculation. Original JSON remains linked at full precision; display formatting uses eight significant digits. Each row keeps its own common support. Signed change is alternative minus baseline. The parameter choices are a descriptive case design, not probabilistic draws.

Native nutrient outputs are annual nitrogen/phosphorus mass delivered to streams in kg/year. Sediment is annual metric tonnes/year. Source assumptions, cell areas and the native conversion remain with their original producers. Intake concentrations require additional physical modeling.

The assumptions text is read from the retained geographic input receipt and exact `assumptions.json`. The source selection, topology/binding and complete source record remain directly available. Later source changes create their own native geographic edition; the completed smaller 1,296 ha simulated square remains separate.

The original `inputs/geographic-selection.json` remains the unchanged native `upstate.geographic-headwaters-selection/v1` selection. The additional operator-choices file is a transport for editing that same selection in the browser, not another scientific selection. It preserves the exact source collection/source/member IDs, layers and typed attribute conditions; all additional utility polygons and optional original intake points; question, reporting HUCs, source descriptions, seed and per-side corridor buffer; and any explicitly present matching method and working-memory budget. A legacy selection without matching fields keeps them absent. The receiving operator reconstructs the selection through its existing `geographic_preparation.selection` normalizer and previews the retained sources before preparation.

No donor browser workspace key, session capability or cached numerical preview is copied into this portable file. The original project ID is the browser's admission check, and full-Workspace cold restoration retains that same ID and original source collections. Its `preview` is null so the current received application's installed producer supplies the next actual preview. Reopening fills the form without preparing inputs or running models.

The production-time table uses the first completed timestamps and intervals captured by the actual receiver. It does not add overlapping phases into a fabricated total or substitute recording duration for modeling time. The page is prepared before final archive/reopening; it presents that actual phase history without claiming later steps have already happened.

Scientific rendering may advance to a new presentation edition while retaining original quantities. The handover identity binds the exact scientific file descriptors, map delivery, review generation, source helper and shared style. Operational `updated_at`/latest-pointer metadata is excluded so a same-result retry does not create a new handover merely because it was reopened.

## First completed reference edition

The same native handover can deliver the original completed baseline, riparian alternative and matched control while later parameter profiles remain pending. Use the current geographic receiver's explicit reference-report mode at a returned or stopped native boundary. Its saved scientific source remains a rendered report with the actual partial native-course state.

Pass the unchanged dictionary returned by `reference_report_basis(workspace, ensemble_id, course)` to this helper as `reference_basis=basis`, and pass that same basis to the existing reference archive binding and cold-reopen calls. The helper reads the original saved course and verifies the supplied basis, original ordered run selection and scientific progress before writing its immutable edition. The default call continues to require the complete parameter course.

The opening page labels the reference edition, shows every saved profile's actual baseline/restoration/control states, and links the original all-alternative decision reports and complete decision packages. Each native profile is visible with its original parameter assignments and run IDs. The original pairwise comparison table remains available with its own finite support. Scientific values stay in their existing producers.

The handover record keeps the exact `reference_basis` plus a read-only `course_snapshot`. Pending native records and the complete source design stay in the editable Workspace; subsequent native continuation uses the original saved ensemble and completed runs. A later completed sensitivity study creates its own scientific/handover edition. Use the maintained geographic receiver for continuation and archive recovery, preserving earlier downloaded editions.

## Recipient workflow

1. Restore the complete native archive with its contained maintained application:

   `python application/model/cli.py restore GEOGRAPHIC_STUDY.zip NEW_DIRECTORY`

2. Open `NEW_DIRECTORY/delivery/START_HERE.html`.
3. Read the selected geography and assumptions. Open the original scientific report/PDF, inspect the actual comparison rows and maps, and use the row filter.
4. Open the complete customer review. Inspect its selected evidence, enter decisions and export the response JSON for the original review-import workflow.
5. Use the contained application's current start guide to reopen the sibling Workspace without `--create`. Open **Geographic model case**, choose **Reopen choices**, and select `delivery/geographic-operator-choices.json` or its **Download editable choices** link from the opening page. The original project identity must match the current received project.
6. Inspect all source/member/layer/typed-filter selections, optional intake points, reporting HUCs and declared matching options in the populated form. Choose **Preview selected coverage** to reopen the actual original geography. Keep upstream domain, South Carolina reporting and utility focus distinct.
7. For a revision, edit the question, source choices or declared assumptions, then preview again. **Prepare selected source** uses the maintained original queue to retain the resulting edition. Open its prepared native runs/programme and execute the selected calculation. Existing completed runs and reports remain available alongside the new edition.
8. Save and export the resulting complete project through the same existing portable course.

## Actual outgoing product use

At the existing independent receiving boundary, physically open the exact final `delivery/START_HERE.html` at desktop and 390 px. Use its native-row search and Clear control, every primary report/map/review/project link and the original customer response export. Download the exact delivered `geographic-operator-choices.json`, reopen it in the actual restored Geographic desk, inspect the populated selectors and optional matching/intake fields, and preview the original coverage. The existing browser receiving course may then save the form again and compare its normalized original selection. Continue an actual requested revision through the normal preparation/run controls; do not start an extra model solely to inspect this file transport. Open and inspect every outgoing attachment, including full PDFs, HTML, data/source downloads, GIS packages and the editable native archive. Extract/reopen the same delivered package and operate the restored application against its original Workspace. View actual populated screenshots; a screenshot that was only saved has not been reviewed.

Repair layout, missing-source, download or control defects in the maintained owner source and retain the corrected edition. Return the actual completed archive/restore/hand-over identities, full first exception if one occurs, and original viewed screenshots through the existing native thread. Use the proven Library or Slack original file parameters to Adobe asset upload and inline preview when sharing pixels with source-only reviewers. Preserve any active native process or recording.

If a recording accompanies the package, use the actual working app and natural generated narration, and watch/listen to the final export. Keep its existing media owner; this helper does not manufacture a recording.

## Complete current owner direction

The following brief is retained unchanged from `CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.3`.

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
