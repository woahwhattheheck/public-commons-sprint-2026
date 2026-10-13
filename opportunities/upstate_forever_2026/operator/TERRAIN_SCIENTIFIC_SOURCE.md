# Terrain native response → scientific source and editable Study

TokenJunkieLabs · Original Upper Savannah application · 13 October 2026

## Complete analyst workflow

Open the original **Terrain editions** desk. A saved terrain case retains the original DEM, any original hydrography, explicit conditioning choices, derived terrain editions and original native run bindings. Open its **saved native response** after the native runs complete.

The source-promotion form gives that completed response a report title and scientific purpose. **Preview scientific source** binds the exact original case, response, source classifications, native output coverage, producing versions and retained native files. **Prepare scientific source** submits the immutable original queue request. It reads the completed native response and renders the original scientific HTML/PDF/Markdown/structured-report companions, numeric response figures, original CSVs, map legends and full-resolution difference/support rasters.

Open the saved source to download its complete verified files or send the exact retained source collection/entry pair to the existing ordered scientific-report composer in Sources. This keeps terrain interpretation beside the other original native model studies. The request body is durably retained before dispatch; interrupted submissions recover the same original operation identity.

## Scientific meanings

The response direction is **alternative minus baseline**. Positive change increases modeled annual export; negative change decreases it. For each pollutant, every changed terrain alternative is compared on the same finite-cell intersection of the baseline and all those alternatives. Original full-support native totals remain separately labeled. Pairwise lost/gained counts versus baseline are separate from that all-alternative intersection.

Inputs retain their actual classification and original source metadata. A simulated or model-derived hydrography case stays labeled accordingly. Input burn depth is an explicit metre-valued conditioning choice followed by spill-level filling, and therefore differs conceptually from the final local elevation change. Original all_touched line rasterization can produce a different number of changed DEM cells from an input line/stream-cell count. Geometric fill volume is elevation adjustment. Local adjacency diagnostics are separate from routed connectivity.

Tables use the original annual mass units. Original map pixels retain annual mass per pixel. The adapter uses the existing normalized native quantities and does not multiply by hectares again. Nutrient and sediment changes can have different signs. Original source/model assumptions and analyst interpretation stay alongside the results.

## Retained source and source history

The immutable record kind is `terrain-conditioning-report-sources`. Each complete output lives under `terrain-conditioning-report-source-output/<id>/`. `selection.json` is the complete original immutable record, including project/case/response identity; `input-binding.json` retains exact scientific and source bindings.

The ordinary source URI is `urn:upstate:terrain-conditioning-report-source:<id>`. Its metadata carries `terrain_conditioning_report_source_id`, `terrain_conditioning_response_id` and `terrain_conditioning_case_id`. The original generic `upstate.observed-report/v1` recipe imports the report/figure/companion roster into Sources. Original input classification is preserved explicitly; this source role does not relabel simulation as measured observation.

Historical run metadata comes from the immutable original copies retained by the completed response. Later unrelated live-run stages do not invalidate the report. The selected Study closure retains the full original terrain case, bindings, completed response, native runs, input CAS objects and output trees. Report companions retain original copied run metadata; native raw rasters remain with the original response closure.

## Native interface

`model.terrain_conditioning_report_source` exposes `catalog(ws)`, `preview(ws, selection)`, `prepare(ws, selection, progress=None)`, `inspect(ws, id)` and `files(ws, id)`.

Selection is exactly:

```json
{"response_id":"<original response SHA>","title":"<report title>","reason":"<scientific purpose>"}
```

Preview is read-only. It computes the same explicitly schema-bound identity that the original immutable Workspace writer uses. Prepare resumes its saved report/recipe/import checkpoint. Source files are verified against their original descriptors before issuing original download tickets.

```text
python -m model.terrain_conditioning_report_cli preview --workspace ORIGINAL --selection choices.json
python -m model.terrain_conditioning_report_cli prepare --workspace ORIGINAL --selection choices.json
python -m model.terrain_conditioning_report_cli inspect --workspace ORIGINAL --id REPORT_SOURCE_ID
```

The original provider adds POST `/api/terrain-conditioning/report-source-preview` with `{workspace,selection}`, the queued action `terrain.conditioning.report-source.prepare` with `{selection,expected_id}`, and the original GET read `action=report-source&id=<id>`. Its catalogue includes `report_sources`.

The existing desk exposes `openSavedCase({workspace_key,case_id,isCurrent})` and `openSavedResponse({workspace_key,response_id,isCurrent})` for the original Study selector. Both preserve the editable current draft and admit only exact original project/record results.

## Original receiving continuation

Compose these source bodies with the current complete application and the original terrain Study closure. Use the existing completed terrain response and its actual unchanged native cases. Preview/prepare the source, open the ordinary Sources composer, build the selected scientific report, download the original companions, export the selected typed Study and reopen it in the receiving Workspace.

Open and LOOK at the populated report/PDF, signed quantity tables, common-support labels, map legends, source classifications, downloaded files and relevant desktop/narrow/loading/error/reopen states. Apply actual product corrections in this original workflow. Preserve TJLabs attribution and the existing original native source identities.
