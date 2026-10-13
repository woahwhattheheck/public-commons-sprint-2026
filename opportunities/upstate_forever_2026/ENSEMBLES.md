# Scenario and parameter ensembles

The workbench provides two complementary ensemble workflows. Both retain the original grid, source, profile and run choices with their results.

| Workflow | Use | Operator and command entry points |
| --- | --- | --- |
| Scenario and parameter design | Prepare a sourced parameter study, execute its selected native models, compare each land-cover alternative with its paired baseline, and export physical reports. | **Scenario sensitivity** in the existing operator; `model.ensemble_cli`. |
| Paired multi-pollutant rasters | Compare original NDR/SDR raster pairs with shared valid cells, area-aware physical quantities and a retained portable product. | **Paired multi-pollutant ensembles**; `model.paired_ensemble.ensemble_cli`. |

## Design, execute and report a study

Read [the complete design and CLI guide](model/ENSEMBLES.md), or follow [the regional source and native operating workflow](operator/REGIONAL_MODEL_AND_ENSEMBLE.md) from original inputs through reports and reopening the saved workspace.

The scenario-design workflow reports land-cover change as **alternative minus baseline**. Its parameter sensitivity holds land cover fixed and compares **varied minus reference**. Results retain exact shared raster support, original full-coverage totals, annual units and the selected parameter cases. Downloadable releases have their own freshness state, so completing a native study identifies an earlier export for regeneration.

## Compare retained multi-pollutant rasters

Read [the complete paired-raster guide](PAIRED_ENSEMBLES.md). The namespaced workflow preserves existing `ensemble-products` and portable product identities, and accepts explicit pollutant selections for nutrient-only or sediment-only runs. Its original reduction convention is **baseline minus alternative**.

The two workflows have distinct command and operator action namespaces. Their guides record the physical conventions and source selections needed to interpret each product.

Scientific parameter and interpretation choices: **Needs expert review**. The retained source choices, method and original native outputs accompany every exported study.
