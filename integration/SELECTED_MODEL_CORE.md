# Selected NDR and SDR execution

This source overlay lets the retained Upper Savannah application start each native model as its own regional computation. It carries 22 exact source edits across `model/common.py`, `model/profiles.py`, `model/workspace.py` and `model/native.py`.

| Selection | Physical rasters | Native exports |
| --- | --- | --- |
| `["ndr"]` | DEM, NLCD, PRECIPITATION | Nitrogen and phosphorus |
| `["sdr"]` | DEM, NLCD, R_FACTOR, K_FACTOR | Sediment |
| Omitted or `["ndr", "sdr"]` | All five inputs | All three pollutants |

## Apply to the maintained application

Place the installer and JSON overlay beside one another. Point the installer at the complete application already retained by the source and runtime owners:

```sh
python3 apply_selected_model_overlay.py /absolute/path/to/application --check
python3 apply_selected_model_overlay.py /absolute/path/to/application
```

The installer parses the resulting Python before writing, retains the actual previous files, and applies unique matching source contexts. It preserves unrelated additions in the current application. If another owner has modified the same context, merge that one source change against their current implementation. The packet contains every before/after edit and four complete postimages for review.

## Native API

`common.selected_models(value=None)` accepts a list of model names or a profile/grid/run dictionary containing `models`. It returns names in the stable `ndr, sdr` execution order. `required_roles(value=None)` returns the selected physical input roles; `output_models(value=None)` returns selected native output registry mappings.

Pass `"models": ["ndr"]` on both the parameter profile and grid spec. `Workspace.prepare_run` inherits the selection from the grid. Explicitly selecting both models canonicalizes to the original omitted-model form, preserving the prior default profile, grid and run identifiers.

A partial profile validates the relevant native parameters and CSV columns. Native preparation loads, checks, executes and summarizes only its selected models. Comparisons require the same model selection and retained grid, and compare only those exports.

When combining independently completed NDR and SDR cores, their grid IDs differ because their selected inputs differ. Match the actual grid geometry, reporting mask, DEM and NLCD content, scenario land cover and parameter lineage when joining them. The existing full seven-map delivery continues to require completed outputs from both models. The additive regional-job orchestration can run a core first and attach contextual data afterward.

## Source and scientific interpretation

The base is the retained original application at `woahwhattheheck/commons@7c4223a111581935b494d5ac4b9357ef86992d67`. Original and resulting SHA-256 values are carried per file, so newer spatial/workspace overlays can be composed without replacing whole old files.

Native InVEST remains pinned to 3.20.0 with its official NDR and SDR module identities. Its export rasters are annual mass per hectare; the existing conversion to annual mass per 30 m pixel multiplies by 0.09 hectares. This patch preserves that conversion. Official model descriptions: [NDR](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/ndr.html) and [SDR](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html).

Source review and original/postimage hash reconstruction completed in the source lane. The native regional execution proceeds in the equipped model runtime against the retained physical rasters. Scientific interpretation of production outputs needs expert review.
