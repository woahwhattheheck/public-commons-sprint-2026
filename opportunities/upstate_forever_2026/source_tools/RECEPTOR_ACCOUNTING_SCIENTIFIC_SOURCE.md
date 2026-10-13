# Add selected watershed accounting to Scientific Reports

`receptor_accounting_scientific_source.py` turns an existing completed accounting result into the application's standard scientific source collection. It preserves the original result, original network/profile/geometry, tables, editable GIS layers and the original-area figure specification. It registers that source in the selected existing Workspace and renders it with the retained Scientific Reports collector and formatter.

## Operate the existing result

From the application root:

```sh
python -B source_tools/receptor_accounting_scientific_source.py \
  --workspace /path/to/existing/workspace \
  --accounting /path/to/completed/accounting/RESULT_ID \
  --output /path/to/delivery/accounting-scientific-source
```

The `--accounting` directory must contain the completed `upstate.receptor-accounting/v1` result produced by `model.receptor_accounting`. That result binds the original source-water network, all exported member files and the optional measured-polygon product. The receiver verifies those files before using them. It reads completed quantities directly rather than repeating geometry calculations or native model solves.

Use `--title` to name another source region. To add the source after an existing ordered selection, pass `--previous-selection /path/to/selection.json`. Existing selections retain their order and identities. The new source is appended only when absent; the first selected source remains the primary `OBSERVED_CONTEXT` role. All selected source bindings are then collected by the existing composer.

The completion output includes the actual `source_collection_id`, `source_id`, original network/accounting IDs, absolute output directory and file descriptors. These are the selectors to give the cumulative report owner. For the original Upper Savannah receiving result, the source document is `selected-watershed-accounting-scientific-report`; the collection ID is specific to its retained edition.

## Receive the finished source elsewhere

Extract `scientific-source.zip` and import its `sources.json` through the existing Sources manifest intake. Its one document has role `OBSERVED_CONTEXT`, schema `upstate.observed-report/v1`, and the standard `upstate.sources/v1` collection wrapper. The original scientific-study report selector can include it alongside other retained sources. This works through the existing consumers and needs no replacement UI or report engine.

The source's companions preserve their relative relationships. The complete standalone watershed explorer remains at `accounting/index.html`; its CSVs, original source body and optional four-layer GeoPackage are beside it. Retain the whole source ZIP, not just its recipe JSON.

`scientific-report.zip` contains the rendered PDF, offline HTML, Markdown, structured report data, bound `selection.json`, native figure and every original source companion. The SVG retains a numeric figure specification that the PDF renderer redraws as native vectors. Its paired x positions separate symbols for readability; source-area y values remain exact. The table and figure use published areas. Projected polygon areas are shown in a separate section with their own CRS and units.

## Receiving and repeatability

A deterministic output identity binds the accounting result, original project, previous ordered selection, source producer, collector, formatter and figure renderer. A completed identical product reopens without rendering again. A newer formatter or producer yields a separate derived edition. The source registration uses the original result's captured time, keeping the same source package stable across receiving operations.

The retained original project `b9d5d257-c6bb-4f07-b975-8e8c63705db3` received the accounting source in the cloud runtime and rendered all ordinary companions. The report records the specific formatter bytes used for that execution rather than assuming another installation has identical code. The saved source format was checked against the current collector at merge `88f9ecb43bb9e792d2467d75a69ca7e37d56f750`.

The actual original-source output retains four anchors, 38 anchor-membership entries, 36 distinct HUC12s, and the 17,681-hectare difference caused by summing overlapping anchor totals. ARJWS's four-unit union and PRWD's 32-unit union retain their independent definitions. These planning footprints remain distinct from intake-specific delineations, clipped physical-model masks and reservoir/in-stream process quantities.
