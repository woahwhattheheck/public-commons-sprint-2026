# Saved matched-control outcome groups

TokenJunkieLabs scientific engineering. This feature compares explicitly selected, already completed native control designs. It does not prepare or execute a native model, change a design, select an automatic winner, or turn deterministic placements into independent statistical replicates.

The complete current owner instructions are retained in source/MULTIVARIATE_CONTROL_OWNER_DIRECTION.md together with CURRENT_OWNER_DIRECTION.md v2026-10-13.4. The original equipped receiving course must use and LOOK at the actual final application and every outgoing attachment; source inspection is not rendered acceptance. Keep current source owners, native run identities and existing application/session custody.

## What the analyst chooses

Select the exact saved control designs in the intended display order, the actually produced annual quantities, one quantity scope, a title and a scientific question. All designs must be accepted and adopted through the original matched-control engine. They must bind the same original project, grid, parameter profile, baseline and restoration. Each corresponding control, baseline and restoration must be complete.

The chosen designs may differ in explicit strata, optional aligned slope/connectivity sources, exclusion masks, calipers or other retained design choices. Their full source classifications, physical definitions, bin rules, pair rosters, exclusions and residual balances remain attached. A different title or saved ID does not establish a different spatial placement.

The catalogue distinguishes ready and unfinished adopted controls. Preview verifies the actual current original selections, producing-model versions, artifact units, full file hashes, executed categorical inputs and retained design/adoption bindings. It never silently removes a control or quantity. An unavailable or incompatible member must be resolved explicitly before preparing that exact group.

Selection shape (replace the illustrative IDs with actual retained values):

~~~json
{
  "schema": "upstate.multivariate-control-outcome-selection/v1",
  "title": "Author's explicit placement comparison",
  "reason": "Author's scientific question and selection rationale",
  "design_ids": ["ACTUAL_FIRST_DESIGN_ID", "ACTUAL_SECOND_DESIGN_ID"],
  "pollutants": ["nitrogen_export", "phosphorus_export", "sediment_export"],
  "quantity_scope": "reporting"
}
~~~

No example supplies scientific bin edges, invented native quantities, causal conclusions or default placement rankings.

## Support and signs

The primary report compares every chosen control on **group-common support**. For each pollutant separately this is the exact selected region intersected with finite native values in the baseline, restoration and every explicitly selected control. Its window-addressed mask SHA, complete native run roster, common count/area and every individual valid count are retained.

Separate **per-design** rows use that design's finite baseline/restoration/control intersection. These retain coverage diagnostics and complete unranked totals. Different per-design masks cannot support a direct ranking or subtraction of totals. The report shows the support lost when moving from each triple to the group-common intersection.

| Quantity | Direct calculation on the declared support | Meaning of a positive result |
| --- | --- | --- |
| Baseline minus restoration | B − R | Lower modeled export under the retained restoration |
| Baseline minus control | B − C | Lower modeled export under that selected control |
| Control minus restoration | C − R | Lower modeled export under restoration than that control |

Native finite support is not reduced by missing categorical support. Categorical change/unchanged/unknown partitions remain separately visible. An empty common native mask yields unavailable values and a concrete reason, never zero or a silently dropped design.

The implementation reads original native values as Float64 through the original receiving_waters reader. It accumulates direct cell differences with the original compensated siting accumulator. It does not subtract rounded displayed aggregates or reuse pairwise Float32 difference rasters for a new scientific calculation. Group rows must share the same mask, baseline/restoration mass and B−R; group support cannot exceed its corresponding triple.

## Reporting and model-domain scopes

These are separate saved selections and scientific identities.

* **reporting** uses the original retained reporting mask and original mass-per-pixel artifacts. They are read once without multiplying by pixel area again.
* **model_domain** uses the exact original prepared model_domain geometry, including its admitted buffer, and retained native output rasters. The grid bounding rectangle or valid NLCD pixels are not a substitute for the model polygon.

Full-domain conversion is admitted only with actual observed producing InVEST 3.20.0, original native_units matching the retained per-hectare quantity and the exact native grid pixel_area_ha. Original native density is multiplied by those hectares once. A matching requested-version string is insufficient. This explicit boundary avoids applying current density conventions to historical native releases with other units.

Annual nitrogen/phosphorus quantities are kg/year; annual sediment is metric tonnes/year. GeoTIFF differences retain kg/pixel/year or metric_tonnes/pixel/year. These represent modeled stream export attributed to source pixels inside the declared support. They are not concentration, pollutant delivery to an intake, observed benefits or an isolated causal effect. Flow routing and retention can change outcomes on unchanged source cells.

The frozen report links the official guide for each actual retained producing model/version. Original source records and conversions remain authoritative; full-domain admission is deliberately limited as above.

## Area and spatial identity

Whole-scenario changed area, changed area inside the selected region, and changed area on common native support are distinct denominators. All three remain in the complete result/CSV, with explicitly named normalized rates and unavailable reasons. Equal area/class budgets do not prove equal physical connectivity or causal attribution.

Every executed restoration/control categorical band is compared by exact values and validity to its retained original footprint. Whole changed-cell counts, hectares and baseline-origin class budgets must match the accepted design. The unchanged baseline is checked against the actual prepared categorical grid.

A deterministic placement SHA covers the addressed changed mask and original/destination classes. Identical final placements are explicitly marked even if their saved titles/design IDs differ. Pairwise changed-cell intersection, union and Jaccard are retained. These measures describe spatial overlap; distinct placements are not asserted to be independent random replicates. The report supplies descriptive individual outcomes without confidence intervals, standard errors or a fabricated replicate count.

## Original native API and CLI

The native facade is model.multivariate_control_outcomes:

* catalog(workspace) lists adopted designs, readiness, available quantities, saved groups and concrete issues.
* preview(workspace, selection) returns the normalized selection, exact input binding and proposed identity. State is ready or existing.
* prepare(workspace, selection, progress=None) produces or reopens the exact immutable group. Its progress callback receives one dictionary.
* inspect(workspace, outcome_id) verifies the original stored identity, complete assessment, exact native bindings, source CAS and every retained file.
* files(workspace, outcome_id) returns the original workspace-relative download descriptors.

There is no outcome execute command. Native controls are completed separately through the original accepted experiment lifecycle.

From the actual application root and original environment:

~~~sh
python -m model.multivariate_control_outcomes_cli catalog --workspace ACTUAL_WORKSPACE
python -m model.multivariate_control_outcomes_cli preview --workspace ACTUAL_WORKSPACE --selection AUTHORED_GROUP.json
python -m model.multivariate_control_outcomes_cli prepare --workspace ACTUAL_WORKSPACE --selection AUTHORED_GROUP.json
python -m model.multivariate_control_outcomes_cli inspect --workspace ACTUAL_WORKSPACE --id ACTUAL_OUTCOME_ID
python -m model.multivariate_control_outcomes_cli files --workspace ACTUAL_WORKSPACE --id ACTUAL_OUTCOME_ID
~~~

Native progress is written to multivariate-control-outcomes/ID/progress.json and emitted to stderr by the CLI. The final JSON has state complete. Invalid/incomplete scientific inputs produce their original concrete exception before a completed record is issued. A missing inspect target raises FileNotFoundError. The immutable identity binds the normalized scientific choices, original design/adoption/run/footprint/artifact descriptors, observed execution provenance and the exact producer/renderer source.

If report/source import acknowledgement is lost, the next identical prepare verifies and reuses the already-frozen report recipe and complete report/PDF/map bytes. It does not rerender a previously issued PDF under the same identity. Repeating an existing complete selection verifies and reopens it.

## Reports, maps and complete source

The result directory contains:

| Member | Purpose |
| --- | --- |
| outcome.json | Complete native record and original source choice |
| assessment.json | Complete frozen numerical result, selection, binding and semantic identities |
| selection.json / input-binding.json / identity.json | Authored choices and exact original input/producer binding |
| outcomes.csv | Both support modes, direct masses/differences, all denominators, rates and unavailable reasons |
| partitions.csv | Every changed/unchanged/unknown categorical source partition |
| placements.csv / placement-overlaps.csv | All authored design metadata, exact mask identities and overlap measures |
| report.html / report.pdf / report.md / report-data.json | Complete readable original scientific report in the maintained renderer |
| maps/design-N/SUPPORT/QUANTITY-DIFFERENCE.tif | Full original-grid Float64 signed map for all three differences and both support modes |
| maps/...-support.tif | Exact finite support mask; outside support is NoData, not zero |
| maps/...preview.json / SVG | Bounded display values, source descriptor, CRS/bounds and readable common-legend map |
| scientific-figures.json / outcome-*.svg | Original native figure specifications and complete plotted values |
| originals/DESIGN_ID/design.json / adoption.json | Exact accepted scientific design and original native adoption records |
| implementation/ | Complete source bodies used to produce the assessment, report and figures |
| report-source.json / sources.json | Ordinary OBSERVED_CONTEXT document and full original companion inventory |

The directly viewable map previews use nearest-neighbour display sampling only and preserve the original geographic aspect ratio. They may omit small features. Full-resolution GeoTIFFs are the scientific maps. Preview palettes use the same full-raster absolute range for a pollutant across selected controls: blue positive C−R means lower export under restoration; red negative means higher; gray remains outside support. Every map retains its quantity, support definition, design, native run roster and units.

The PDF/HTML uses the original scientific_report and scientific_figures renderers. Its primary tables use group-common results, explicit signs/units, all three area denominators, and complete design rules/residual balance. Long rosters are continued across report sections without dropping rows. Scientific-source recipes use the maintained observed-context figure specification/companion contract; no generic source validator is relaxed.

The new source is an ordinary kind=document, role=OBSERVED_CONTEXT entry. Its exact body and every companion are preserved through original source CAS. Select it in the original Sources composer to build an ordered scientific edition. Source/report selection does not rerun native models or infer a new saved edition.

## Editable selected Study and independent receiving

The typed root is **multivariate-control-outcomes**. Use the original Study selector to select the exact saved group. It retains the entire outcome directory and every selected original editable control design. Existing design visitors retain source collections, exact grid/profile, original B/R runs, compiled footprint completion tree and the adopted C scenario/run/footprint/experiment, including current legitimate native progress.

The shared Study engine dynamically consumes the existing control helper's root/document/lock/label exports. This feature adds an owned outcome adapter to that helper; it does not replace the original generic closure or portable writer. Outcome and design writers retain their existing operation locks, and original source/file identities are verified by the same frozen export process.

A selected scientific edition containing this exact same-project outcome source follows the same typed outcome root. Equivalent reimports under a different collection selector are accepted only with the complete identical original native body/companions. Foreign report sources remain contained CAS documents; they never borrow local project IDs. Existing archives without this new outcome root/source retain their original receiving semantics.

Export through the existing Study workflow; restore through the original portable/Study receiving workflow into an independent destination. On the recipient open the actual saved outcome, each original design and native experiment, all report/data/GIS members, and the original source choice. No design is reconstructed from prose and no model is executed to verify receiving. Full Workspace export remains available as the broader original workflow.

## One original equipped receiving course

Extend the already accepted matched-control native/browser course on its actual complete restored workspace. Preserve the original regional/teaching and later completed cases, current native handles, source writer and application identity. A555's actual completed teaching workspace is supported by the original matched-control receipt; do not fabricate a Geographic preparation ID to enter a browser chapter.

Use an explicitly authored group of actually adopted complete controls. Preview it, prepare the report-only comparison, record actual outcome/source IDs, open/reopen the saved desk, download and inspect complete reports/maps/CSV/JSON, and export/restore its selected Study. The primary table and same-pollutant support hashes must match the native frozen result.

The producing receiver must personally open/run/render the exact outgoing application and LOOK at it at desktop/screenshare and narrow390px. Operate important controls, saved reopening, authored selection edits, populated/empty/loading/error states and every download. Open/view every attachment: HTML/PDF, tables/spreadsheets, JSON, maps/SVG/TIFF and archive contents, including the restored working project. Capturing screenshots without viewing them is insufficient. Fix unreadable, clipped, overflowed, cramped, broken or unstyled output in this original course.

Source review, API inspection and V8 checks are not native/GDAL or visual acceptance. This authoring seat does not claim execution it has not performed. The equipped owner reports the actual completed course or its first concrete exception.

## Ownership and attribution

Current owner direction v2026-10-13.4 and the complete standing rendered-product instruction remain in the consumed source family. Work continues under the original expanded post-call orders; preserve native work rather than repeating cases. Keep TokenJunkieLabs attribution on the application, source/report and attachments. Scientific interpretation and the client relationship remain with the prime and scientist.

This implementation authorizes no provider purchase, payment, contract signature, private repository, hosted Actions or extra fleet session. No external customer/prospect messages are sent by the outcome engine. Existing actual source rights, scientific choices and native execution owners remain authoritative.
