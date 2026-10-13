# Native input response

Version 1.0.1 — 13 October 2026

This is a complete offline consumer of the original application's **completed
Parameter studies**. The original Workspace and native model modules own the
scientific calculation, input profiles, case identity, paired support, units,
reports and GIS exports. The reader preserves those original files and exact
raster values. It does not approximate a model when a displayed selection changes.

## Produce from a saved native study

Use the application's equipped native Python and an output directory outside its
Workspace. Repeat `--study` for each original completed study to include.

```sh
NATIVE=/absolute/native-runtime/bin/python
APP=/absolute/application
WORKSPACE=/absolute/workspace
"$NATIVE" -B "$APP/source_tools/native_input_response.py" \
  --workspace "$WORKSPACE" \
  --study ORIGINAL_COMPLETE_STUDY_ID \
  --output /absolute/native-input-response
```

The builder opens each study through `model.parameter_studies.inspect`, verifies
its complete state and original result/export descriptors, and retains every
standalone report member, the complete study ZIP, all original annual GeoTIFFs
and native difference rasters. The original affine transform, CRS, valid-data
mask and complete Float64 reading of every raster cell accompany the exact TIFF.
No resampling, new model execution or downstream area multiplication occurs.

`Native_Input_Response.html` is self-contained. Open it in a current browser with
DecompressionStream support. Every included original download works offline.
`native-input-response.json` retains the complete original file bodies, hashes,
selections, result matrices and cell arrays. `all-results.csv` joins the original
result rows with their study/scenario identifiers; each original study CSV remains
separately downloadable. Original native source/report paths remain in `studies/`
and `rasters/`, so the retained original report links also work after extraction.

## Use the saved result

Select the land-cover scenario, calculated parameter case, quantity and annual or
difference raster. Select an exact row and column or click the map to inspect its
unrounded value, units and original cell centre. Download the selected GeoTIFF,
inspected cell, original result CSV/JSON, complete study ZIP or editable design.

The comparison table covers all included scenarios for the selected pollutant.
Every row retains its original reporting-area name and identifier. Reporting
areas can overlap; do not sum their quantities or areas. The map continues to
show the full original saved raster, rather than a table-area crop. Its cached
cells are bound to the saved study, run, pollutant, mode and original raster
path/SHA, so two retained-run studies can reuse a run without reusing a different
study's baseline-difference raster.

Table quantities come from the original per-case paired support. Change is case
minus that study's retained parameter baseline, not necessarily restoration minus
present land cover. The table does not imply that different study pairs have an
identical pixel mask. Full precision, source hashes and run/profile identity stay
in the original files. Nutrient kg/year and sediment metric tonnes/year stay
separate. Map values are mass per original cell per year, not annual basin totals.

Working notes and selections can be saved as a small source-bound review JSON or
as a complete independent HTML reader. Reopen the actual saved HTML directly, or
receive the review JSON through the original reader's file chooser. A review for
a different captured dataset is rejected rather than applied to another study.
The printed dataset hash identifies the captured packet; it is not an external
signature or proof of scientific validity.

## Calculate another input

Use the original native application, not a display selector. In **Parameter
studies**, preview and save an explicit new design, then **Run all cases**. The
original queue invokes official native models and retains separately identified
profiles/runs. Reopen the same saved study to continue an incomplete operation.
`NATIVE_INVOCATION.md` joins a received native interpreter to the existing operator
or model CLI while preserving that queue and its process behavior.

## Operated example

The 13 October 2026 worked package retains three original saved studies in the
simulated 1,296 ha Piedmont teaching project: present land cover, 90 m riparian
restoration, and matched-area off-riparian restoration. Coupled NDR/SDR `k_param`
values 1 and 3 were calculated against retained value 2, with original MFD routing,
SDR Lmax 122, source inputs and 120 by 120 / 30 m grid unchanged. There are nine
complete case references, six newly executed runs, twelve new official NDR/SDR
stages and twenty-seven original quantity rows. Original twelve completed runs
are preserved byte-for-byte in the complete editable native project.

The actual offline reader was operated in Chromium at 1440 and 390 pixels. All
forty-five annual/difference map selections and an original cell in each matched
the retained source value. Original TIFF, CSV, JSON, design and ZIP download bytes
matched their original hashes. Both the downloaded complete HTML and review JSON
were independently reopened with their notes and selected original cells. The
phone edition presents every numerical column in readable stacked rows.

Keep the separately supplied regional geography/model case distinct. These
teaching cases show sensitivity to explicit choices, not a calibrated uncertainty
interval, intake concentration or field validation.
