# Regional biophysical library and original-case operation

This desk belongs to ECO-POSTCALL-20261013 WO-10. It uses the existing scientific Workspace, original source importer, profile materializer, coefficient evidence writer, serial task queue, native experiment runner and complete-workspace backup/receiving. It adds no solver, observation generator or replacement source store.

Current owner direction is retained at `CURRENT_OWNER_DIRECTION.md` version `2026-10-13.4` and the application/repository `AGENTS.md`. Continue actual scientific execution and full original handover, preserving active jobs and native owners. Source review is not rendered-product acceptance. Every receiving worker must read those original instructions and actually view the outgoing product and attachments.

## What the installed source contains

The installed catalogue retains 128 individually attributed choices:

* 120 numerical coefficients from the complete 15-row Albright et al. 2023 Upstate South Carolina biophysical table: nutrient loads, retention efficiencies and critical lengths, and SDR C/P factors.
* Eight explicitly labelled model defaults reported by Vickery and Quinn 2023 Appendix 1. The publisher states that regional values were unavailable for these defaults. They are not calibrated regional measurements.
* Two editable source families: the full published table with the original baseline's algorithm settings, and the same table with the eight published defaults.

The original 829-byte CSV and complete study-definitions JSON are retained without rewriting. Each library entry records land-cover code, units, source location, publication/observation period, geography, land management, method and evidence classification. No distribution or uncertainty range is inferred from differences between classes. Neither paper supplies a new nitrogen subsurface fraction here; the actual selected baseline value remains unchanged and unattributed to these papers.

Laura Reid's 2008 Clemson thesis is retained as regional context for storm-event observation interpretation. Its event concentrations and developing-catchment exports are not silently treated as annual per-LULC loading coefficients. Additional regional evidence can be imported as a new library edition only with explicit native-compatible meanings and original source companions.

### Primary sources and native meaning

* Albright, Vickery, Bower and Quinn (2023), Appendix 1, DOI 10.1080/1747423X.2023.2234903: https://www.tandfonline.com/doi/full/10.1080/1747423X.2023.2234903
* Vickery and Quinn (2023), Appendix 1 **Default Parameters**, DOI 10.1007/s00267-023-01861-6: https://link.springer.com/article/10.1007/s00267-023-01861-6
* Reid (2008), Upper Piedmont storm-event study: https://open.clemson.edu/all_theses/361/
* Exact native NDR guide: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html
* Exact native SDR guide: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html
* Native version comparison: https://github.com/natcap/invest/blob/3.9.0/src/natcap/invest/ndr/ndr.py and https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py

The original published table was used with InVEST 3.9.0. Selecting native 3.20 `measured-runoff` retains that older direct load mapping. This compatibility choice does not assert that every table value was locally measured runoff. For genuine `application-rate` evidence, preserve the rate and label it as such: the original native model applies the rate × (1 − efficiency) adjustment. The library never pre-reduces a load. A catchment yield, concentration, gross fertilizer application and parcel runoff are different quantities even when some share related units.

The fixed catalogue version is InVEST 3.20.0, matching model.common.INVEST_VERSION. There is no automatic migration to a different model version.

## Open and operate the desk

Install the whole selected application source edition and start the existing operator normally. Its existing extension registry discovers `operator/extensions/regional-biophysical.json`; the navigation label is **Regional coefficients**. All new routes/actions use the existing authentication, workspace identity and task queue.

1. Choose the original saved baseline profile. Its exact table and algorithm settings remain retained.
2. Choose the complete published library family. Entries outside the profile's model or land-cover scope cannot be applied.
3. Write the scientific purpose and the regional/management applicability decision. Do not call a published default or an operator hypothesis a measured coefficient.
4. Inspect individual citations. Select the exact entries to apply. To change a choice, use **Inspect / edit choice** and provide its new source or explicit hypothesis attribution, method, geography, period, management and rationale. A changed value never overwrites the original published entry.
5. Optional numerical endpoints require both lower and upper values, a specific original source and a range basis. They do not become confidence intervals or guaranteed lower/higher pollution outcomes.
6. Preview the exact source-bound profile. The preview shows the full selected choices, original table identity and inherited values.
7. Prepare the profile. The original materializer creates at most one derived joined profile. Selected numerical cells receive their own original coefficient evidence through the existing evidence writer. Unselected cells keep their original text and unknown evidence stays unknown.
8. Open the saved selection and export the readable HTML, complete JSON and source ZIP. The package includes the selected and baseline native profiles/CSV, original library companions and coefficient evidence.
9. Select an actual completed baseline run belonging to the original central profile and any retained land-cover scenarios. **Prepare original native experiment** uses model.experiments. Execute, resume, inspect maps and compare results through the existing Experiments workflow with the current native owner.

A same-valued selection may reuse the original baseline profile instead of inventing a numerically identical new profile; the separate retained source selection and evidence still record exactly what was reviewed.

## Unfinished work and interrupted requests

Each opener owns an independent browser working copy. Earlier copies remain explicitly selectable. Changing source family/profile preserves the previous full copy. Every per-entry unfinished edit is retained separately, including source attribution fields; opening another entry does not discard it.

**Download complete working copy** includes the full definition, unfinished entry edits and original requests. Reopen that JSON only in the same project. Imported task observations are not treated as proof of completion: the original operation ID is retried through the server.

Before dispatch, the exact request is retained. A lost response does not authorize a replacement UUID. **Reopen same request** sends the original action/payload/operation ID. The original task queue decides whether it is already complete, queued, failed or resumable. Returned tasks are bound to the exact workspace/action/payload/request SHA and accepted task ID; an original server alias may carry a different task operation ID. Task-state hints are resolved through the existing decorated task reader before showing saved results. Browser storage failure stops dispatch until the exact working file has been downloaded and the operator confirms retaining it. Keep that file; a browser download request alone is not a receiving receipt.

The editor supports an explicit automatic native masked mean for optional `ndr.runoff_proxy_av=null` in a supplied native-parameter library. A null selection is not replaced by the old value in the displayed choice. All other numeric limits remain with the original profile validator.

Source files imported in another workspace, stale asynchronous results and late outcomes cannot replace a different visible project/copy. Original task outcomes remain attached to their originating copy.

## Add a sourced library edition

Import a JSON document plus its complete declared original companions through **Original sources** using `upstate.sources/v1`. Choose that retained document in Library source. The original source importer owns byte retention and immutable collection IDs.

The JSON schema is `upstate.regional-biophysical-library/v1`. Retain title, edition, native_version, notes, originals, entries, families and context_sources. Each entry has:

```json
{
  "id": "an-explicit-stable-source-cell",
  "target": "table.load_n",
  "lucode": 82,
  "land_cover": "The source's actual class label",
  "value": "THE ORIGINAL REPORTED NUMBER",
  "units": "kg/ha/year",
  "load_type": "application-rate",
  "range": null,
  "source": {
    "title": "Actual original publication or retained source",
    "uri": "https://the-original-source.example/",
    "locator": "Exact table, row and parameter",
    "period": "Original measurement/publication period",
    "geography": "Original study geography",
    "management": "Actual land management represented",
    "method": "Original measurement or modelling method",
    "classification": "application_rate",
    "notes": "Limitations and explicit applicability"
  }
}
```

This is a field-shape example, not a usable numerical coefficient. Use only actual source values. Supported classifications distinguish published model inputs, published defaults, measured plot runoff, application rates and explicit operator hypotheses. An unsupported catchment/event observation cannot be imported as a native coefficient. Exact native units are required; conversion must be sourced and retained before intake, not inferred by the editor.

A family lists distinct entry IDs; it cannot change the same target/code twice. Its selected entries can be narrowed for a model-specific baseline. Original companion descriptions carry exact relative filename, byte count and SHA256. Companion bytes must be retained with the same original source entry.

## Native CLI

Use the selected original application's Python environment and its installed native dependencies. The catalogue/preview/materialization path itself does not call the native solver.

```bash
GIS_PYTHON APPLICATION/source_tools/regional_biophysical.py --application APPLICATION --workspace ORIGINAL_WORKSPACE catalog --baseline-profile ORIGINAL_PROFILE_ID
GIS_PYTHON APPLICATION/source_tools/regional_biophysical.py --application APPLICATION --workspace ORIGINAL_WORKSPACE preview --definition AUTHORED_SELECTION.json
GIS_PYTHON APPLICATION/source_tools/regional_biophysical.py --application APPLICATION --workspace ORIGINAL_WORKSPACE prepare --definition AUTHORED_SELECTION.json
GIS_PYTHON APPLICATION/source_tools/regional_biophysical.py --application APPLICATION --workspace ORIGINAL_WORKSPACE inspect --id SAVED_SELECTION_ID
GIS_PYTHON APPLICATION/source_tools/regional_biophysical.py --application APPLICATION --workspace ORIGINAL_WORKSPACE export --id SAVED_SELECTION_ID
```

The definition may be the complete working JSON downloaded from the actual editor. The CLI checks its original project identity. It never substitutes a made-up baseline ID or generated observation.

To prepare the original native experiment, use `experiment --selection-id ... --baseline-run ... --scenario ... --title ... --reason ...`. Add `--execute-native` only when the original equipped owner is carrying that same native operation. The existing runner owns solver admission, source reuse and resumed results.

## Complete original-case receiving course

The reusable course takes actual original Workspace/definition paths and an independently chosen output directory:

```bash
GIS_PYTHON APPLICATION/source_tools/regional_biophysical_course.py \
  --application APPLICATION \
  --workspace ORIGINAL_WORKSPACE \
  --definition AUTHORED_SELECTION.json \
  --output NEW_OPERATION_DIRECTORY \
  --operation-id ECO-WO10-REGIONAL-PROFILE-B43A-20261013 \
  --baseline-run ORIGINAL_COMPLETED_BASELINE_RUN \
  --scenario ACTUAL_RETAINED_SCENARIO_ID \
  --execute-native \
  --browser-result ACTUAL_BROWSER_OPERATION/result.json
```

Leave native arguments out for a source/profile/complete-receiving operation; its result explicitly records that no native execution was requested. An omitted browser result is equally explicit and never becomes a visual acceptance claim. If either is added later, use a separately named actual continuation bound to the prior immutable selection, rather than repurposing a completed operation's input.

The course retains the exact authored input and selected source inventory before work, obtains the source preview, prepares/reopens the same profile, exports all complete attachments, optionally prepares/executes the original native experiment and scientific report, verifies the original baseline/table unchanged, exports the entire actual Workspace including application, restores or resumes a fresh cold receiver, compares full source selection and all exported bytes, and records the actual outcome. Its original lock and immutable input prevent a competing or repurposed operation.

The complete archive is the original scientific Workspace format. The smaller Regional_Profile.zip is a selected-source handover, not a substitute for the complete application/Workspace archive.

### Actual browser leg

`source_tools/regional_biophysical_browser.mjs` exports `runRegionalBiophysicalCourse(page, options)`. Pass an existing authorized operator page and its exact URL, authored definition, output directory, operation ID and the existing receiving owner's `python` executable. The borrowed-browser course holds an ordinary POSIX flock with that same Python in a small stdin-bound child; process/pipe exit releases it automatically. It never removes or takes a live owner's lock. This function does not launch a browser, select an unrelated host, start a new source capture or run a solver. The current browser owner controls admission and `allow_navigation`.

The course operates actual UI controls: original library/definition intake, exact preview, one accepted original profile request with deliberately withheld response, retained-request download and reload/retry, saved selection, actual JSON/HTML/ZIP downloads, unfinished-title save/reload/reopen, desktop/390px screen captures, and the readable report. It records the exact download bytes; the native course compares those bytes against its same saved source selection and cold receiver.

Read the screenshots and every attachment as a user would. Full source review or JavaScript parsing does not establish visual/native success. Keep existing scientific jobs and unrelated browser tabs intact. No current source delivery claims a new native run or browser execution until its actual retained result exists. Preserve TokenJunkieLabs attribution and every original source/license notice in the application and outgoing attachments; a prospect request does not authorize removing them.

## Source and receiving verification

All new files live under the existing model/operator/source/source_tools families, which the original complete Workspace backup already includes. The extension registers its verifier with the original receiving flow; the native operating course also calls it explicitly after cold restore. It recomputes the source preview, checks selected and untouched table cells, exact native settings and original evidence identity.

Only the explicitly selected cells change. The package and complete working files retain original source values alongside edits. No range, geographic applicability, scientific approval, calibration or measured outcome is inferred from a title, general bibliography or a successful file save.
