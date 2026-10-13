# Full native model selection and receiving

This entry point carries one explicit source edition, grid, parameter selection and set of land-cover scenarios through the original Workspace and InVEST engines. It writes the completed IDs and delivery choices used by the operator receiver.

Run from the delivered product root with the equipped Python environment. The selected environment must satisfy the native dependencies and original InVEST 3.20.0 source checks described in [README.md](README.md). Keep the model workspace on storage that will survive the worker process.

## 1. Prepare the actual source edition

Complete the original source captures and derived input preparation before writing the native plan. Compose their existing `upstate.sources/v1` manifests with `source_tools/compose.py`; preserve every original capture and declared companion. The composer binds actual retained files and rejects conflicting source IDs.

The reporting selection for this project is the separately retained PlanningBasins2023 **Upper Savannah** feature. The model-domain selection must cover that reporting feature and its actual upstream drainage context. Retain the selected native ToHUC graph, the original geometry edition, and the explicit buffer in metres. The four named utility HUC12 polygons are useful reporting context and keep their own source identities.

The five physical raster roles are `DEM`, `NLCD`, `PRECIPITATION`, `R_FACTOR`, and `K_FACTOR`. Their manifests declare native edition, units, preparation and any conversion. The NLCD reference establishes the common 30 m grid. Original input data and model NoData remain visible through the existing grid and native run summaries.

The seven-map delivery also needs retained vector sources for protected lands, parcels, NHD, NWI, drinking-water areas and high-quality waters. Complete these source selections before starting the native batch so the later operator can build the entire delivery. The LS-factor delivery comes from the original SDR terrain calculation.

## Retained originals in this source release

The original acquisition work continues under the [existing Upstate source/model thread](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791724121853269). Reuse the following observed sources while preparing the complete model edition.

| Source | Retained result | Assembly into the native model |
| --- | --- | --- |
| NOAA rainfall erosivity | The complete original CONUS archive is [F0C9BC7MKME](https://tokenjunkielabs.slack.com/files/U0BR9670G2H/F0C9BC7MKME/noaa-r-factor-conus-original.zip), 47,143,128 bytes, SHA-256 `157bbcaa54b445f96506fb1caffda4bbaea6b28f71bc7199235705e69cd00596`. Its completed transfer and original metadata are retained under `source/noaa-r-factor-conus-2013/`. | Receive that exact archive with the retained transfer JSON, then run the existing erosivity `prepare` entry. The original numeric raster, native units, 800 m resolution and historical source vintage remain in the prepared entry. |
| WBD upstream network | The completed capture has 303 topology records, 254 captured geometry records and 217 selected model HUC12s. Capture SHA-256: `0b1ad80e32a843d547ccb4317a1c4ddec7a7878c52b15d127accf1cb00886aee`. The selected set is in the original `network-selection.json`. | `source/prepare_upstream_domain.py` derives the 217-feature `MODEL_DOMAIN` source and binds each feature to its original body/index/ID. The separate PlanningBasins2023 Upper Savannah feature remains the reporting area. |
| USDA whole-soil interpretation | Native AOI `13217298`, result `109629`, contains 34 original Anderson County mapunits. Thirty-two rows supply numeric Choice strings and two retain native nulls. Original ratings SHA-256: `40ab7952f337752ec2860dd0ae12d0ba222b5458f94ba3701cf0987bf51bcf34`. | Reopen the same retained ratings and legend through the published soil source parser. Its exact Choice/Decimal projection and native interpretation parameters are reused when preparing every actual mapunit on the full model grid. |

The NOAA archive transfer and WBD acquisition are complete source operations. Their raster/domain preparation, the USDA retained-result package and the full five-role grid are successive parts of the same native workflow. A completed model run is identified by the original `native-model/<selection-id>/receiving.json` and its actual run IDs.

The PRISM annual precipitation selection remains the original 1991–2020 Norm91m M4 source at nominal 800 m. The current Annual NLCD selection is 2025 Collection 1.2. Their original acquisition owners retain the source requests and returned files. Complete those numeric inputs, the matching 3DEP elevation and whole-domain soil preparation, and the selected overlays before composing the native plan. This source release provides the original acquisition, preparation, model, operator and receiving code for that complete operation.

## 2. Save the source-bound plan

Save a JSON document with schema `upstate.native-model-plan/v1`. Its top-level fields are:

| Field | Content |
| --- | --- |
| `title` | The name of this scientific model selection. |
| `source_manifest` | Path to the complete composed source manifest, relative to the plan file or an explicit absolute path. |
| `source_manifest_sha256` | SHA-256 of the exact selected manifest bytes. |
| `grid` | The original `Workspace.prepare_grid` definition, with its source-collection ID omitted. |
| `profiles` | Named original profile definitions, with source-collection IDs omitted. |
| `scenarios` | Named original scenario definitions, with source-collection IDs omitted. |
| `runs` | Named objects containing exactly `profile` and `scenario`, each referring to a name in this plan. |
| `comparison` | Run names in order: baseline first, then the distinct selected alternatives. |
| `delivery` | The complete original delivery selection, using `baseline_run` and `scenario_runs` names instead of native run IDs. |

Names use letters, numbers, dots, underscores and hyphens, up to 64 characters. Every source selection refers to an actual entry in the composed manifest. The batch supplies the one imported source-collection ID to the original Workspace methods.

The grid definition retains:

- `input_sources`: the five role-to-source-ID bindings.
- `reporting_area` and `model_domain`: source selections with `source_id`, and the actual `layer` or `where` selection when needed.
- `upstream_buffer_m`: the explicit positive context buffer.
- The original grid title and any other fields accepted by Workspace.

Use the profile and scenario fields documented in the original model interface. A profile selects its actual `biophysical_source_id` and recorded scientific parameters. A baseline scenario has `kind: "baseline"`. Every future-service run uses `kind: "landcover"`, an explicit reason, and retained change-mask sources. Future delivery runs share the baseline parameter profile so their reported differences follow the selected land-cover changes. Parameter-sensitivity runs may be included as separately named comparison runs.

The delivery selection retains actual `source_roles`, `overlays`, responsible `contact` name/organization/email, cartographic choices, and any requested parcel-priority selection. Required vector choices must contain a real `source_id`. The batch validates these choices before the native model starts.

The selected land-cover class values and table rows must match. The regional biophysical source is the separately retained 15-class Georgia A1/Duke Table 4 composition; its full field lineage accompanies the original table. Its modern nutrient-load choice is `measured-runoff`. Any changed coefficients, threshold, calibration, or sensitivity choice belongs in a named profile with its supporting source.

## 3. Execute the original native selection

```sh
python -B -m model.native_batch \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  --plan "$UPSTATE_NATIVE_PLAN" \
  --source-reference "$UPSTATE_SOURCE_COMMIT" \
  --handoff "$UPSTATE_MODEL_HANDOFF"
```

These variables select actual paths and the immutable application commit chosen by the worker. The driver also records the SHA-256 of every executed application source file under `model`, `source_tools`, and `operator`, plus the original QA entry points.

One retained directory under `workspace/native-model/<selection-id>/` contains:

- The exact original plan and source/application identity.
- Progress with original source, profile, scenario, grid and prepared run IDs.
- Each completed native run summary.
- The final `receiving.json` handoff.

The driver records each native run ID before invoking it. It delegates source intake, grid preparation, run execution and comparison to Workspace. The existing native engine verifies and reuses completed stages when that same selection is resumed. A second writer for the same workspace is rejected by its existing batch lock.

Native progress is printed as compact JSON. If the worker is interrupted, inspect the original worker and retained progress, then continue the same command, original plan, source selection and workspace. Preserve the prepared run directories. The final handoff is published only after all named runs and their comparison have completed.

The complete source/native workspace can be large. Reserve the actual model intermediates, retained inputs and receiving copies on the equipped worker before execution. A command-private directory may hold reproducible receiving expansion, while the complete model workspace or its verified archive must be retained across worker lifetimes. This driver does not assign compute or modify shared runtime settings.

## 4. Complete the operator and receiving journey

The final document has schema `upstate.native-model-receiving/v1`. It contains actual workspace/source/grid/profile/scenario/run/comparison IDs, the original native outcomes and a fully resolved delivery selection. This is the input to the existing receiver:

```sh
python -B operator/receiving.py "$UPSTATE_MODEL_HANDOFF" \
  --output "$UPSTATE_RECEIVING_OUTPUT" \
  --scratch "$UPSTATE_RECEIVING_SCRATCH" \
  --source-revision "$UPSTATE_SOURCE_COMMIT" \
  --node "$UPSTATE_NODE" \
  --node-modules "$UPSTATE_NODE_MODULES" \
  --chromium "$UPSTATE_CHROMIUM"
```

Select the already-equipped Node, Playwright modules and Chromium. Follow [operator/RECEIVING.md](../operator/RECEIVING.md) for capacity, retained task recovery and the optional native-intermediate archive choice.

The receiver uses the actual operator to inspect sources and completed native runs, build the seven-map delivery, download its audited archive, back up the whole workspace, and restore it through the same application. It then opens the delivered CLI and delivered operator on the received workspace. Original task IDs are retained before browser dispatch, and completed scientific runs are consumed from the native handoff.

Keep the resulting receiving report, full delivery archive and complete workspace archive with the same original work item. Publish the source revision and reusable delivery through the original private project and sales thread.
