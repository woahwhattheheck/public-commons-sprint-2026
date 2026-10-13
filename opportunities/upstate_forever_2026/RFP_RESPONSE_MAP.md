# Original RFP → complete workshare response

Original sources: [18-page issuer RFP and appendix](https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf), [SCBO notice 69283](https://scbo.sc.gov/printad?a=69283). The exact retained issuer PDF is SHA256 `04313cdda0b19f98b4081ef1eeec2f52707437759f9058f8d0e5abc8d83d6dbf`.

This matrix maps the issuer's practical requirements to the original application, retained inputs and the prime's decisions. The requirement descriptions are compact summaries; the issuer's full document governs proposal preparation.

| Requirement or decision | Maintained implementation and receiving output | Source / prime input |
| --- | --- | --- |
| Study covers the SC Upper Savannah basin with upstream modeling context | Separate reporting-area and hydrologic-domain selections; original ToHUC closure and explicit positive context; delivered reporting mask | Whole original PlanningBasins2023 Upper Savannah feature, current native WBD and the prime's extent review |
| Identify future sediment loss and nutrient runoff priorities | Saved baseline and explicit source-polygon land-cover alternatives; original NDR/SDR runs and quantitative scenario differences | Reviewed change assumptions, polygon masks, source land-cover codes and replacement classes |
| Current N/P and sediment export quantities | Original model outputs and declared physical conversions to 30 m pixel values; retained units, NoData and source grid | Native aligned DEM, NLCD, rainfall erosivity, soil erodibility, runoff proxy and referenced biophysical profile |
| Critical drinking-water protection | Original utility-focus geography and declared drinking-water overlays; physical loads and scenario context in the release | Actual utility watershed/intake or protection-area source and the prime's interpretation |
| Protect designated high-quality waters | Source-bound water designation/context overlay, declared spatial relationship/buffer and map publication | Original effective designation source, hydrographic geometry and reviewed name/identifier mapping |
| Seven map families for useful publication | Seven original map roles, configurable map settings, legends/scale/north arrow, complete PDFs and operator downloads | Prime's title, study contact, intended audience and consolidated cartographic comments |
| Quantitative combined prioritization | A separately identified planning index with saved normalization and nonnegative pollutant weights; physical pollutant layers retained | Reviewed decision weights and scenario interpretation |
| Current regional input information | Original source editions, acquisition receipts, native views, parameter lineage and exact selection manifests | Approved source vintages and meaningful regional parameter choices |
| Protected land, parcels, hydrography and wetlands | Original vector roles and optional parcel GIS/CSV inventory with actual coverage, overlap and source identifiers | Native data-source terms, whole-basin/focus-area selection and county coverage |
| Scientific model and validation explanation | Pinned original InVEST runtime/modules, saved arguments, actual stage logs, observation qualifiers and comparison metrics | Prime's model suitability, local calibration and uncertainty assessment |
| Sampling and emerging-contaminant context | Original contextual observations retained; annual mass comparisons require original qualified load/period/catchment semantics | UF/utility laboratory and field data; no conversion from bacterial counts or concentration alone to annual nutrient mass |
| Metadata and understandable final report | Maintained CSDGM/lineage outputs, source inventory, technical report and complete editable project material | Final scientific interpretation and publication approval |
| Editable full GIS/working delivery | Complete original workspace backup, source objects/sidecars, native outputs, application, delivery package and independent reopen | Receiving host/operator and client-specific GIS project assets |

## Exact seven-family release roles

The original `audit.py` contract uses the following identifiers. The model and operator build and retain that same release:

| Release role | Reviewer question |
| --- | --- |
| `future_sediment_loss` | Which actual scenario changes increase sediment loss/export relative to the saved baseline? |
| `future_nutrient_runoff` | Which scenario changes alter nitrogen and phosphorus export and by how much? |
| `critical_drinking_water` | How do original source-water areas relate to physical exports and reviewed alternatives? |
| `high_quality_waters` | Which areas influence the source-designated high-quality-water context? |
| `current_nutrient_export` | What are the current absolute N/P export rates on the retained source grid? |
| `current_sediment_export` | What are the current absolute sediment export rates? |
| `combined_pollutant_export` | How does the saved planning-weight scheme combine the separate pollutant priorities? |

## Source decisions to complete with the prime

The four utility-focus HUC12s remain their exact native selections. They support the initial parcel and utility context; the whole Upper Savannah reporting feature remains the basin scope. WBD `ToHUC` relationships determine the separately retained upstream network, including contributing land outside South Carolina.

The Georgia 2019 N/P and Duke 2022 C/P rows are a declared regional reference profile. The profile's sources, original model context, measured-runoff interpretation and current native parameters are retained. The prime selects the scientifically appropriate local revision when actual observations or regional evidence justify it.

Water protection designations must be joined to their actual source geography. Protected-land categories, legal water classifications and utility operating areas carry different meanings and retain their original fields. Optional overlay buffers, weights and parcel-area coverage are exposed as study decisions.

An annual-load comparison binds a real station, catchment, complete period and source method. Concentrations, microbial results and incomplete periods are retained as their original measurements. The recipient can inspect both accepted comparison rows and the original contextual source.

## Proposal preparation and release sequence

The November 6, 2026, 5 p.m. ET proposal is the prime's submission. The technical workshare supplies the useful source/method plan, operating application, fee/schedule and complete receiving result for the prime's proposal narrative.

The final project release follows source/method review, actual baseline/alternative operation, one consolidated correction and independent receiving. Its delivery record links the actual native result and final project archive to the exact source revision used. The original technical QA command remains part of that release rather than a separate substitute for the scientific work.
