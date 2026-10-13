# Original tributary annual-reference course

This command joins the complete retained USGS Southeast SPARROW reference edition to **existing completed native baseline runs**. It imports the seven original annual targets and three complete upstream catchments, retains every original comparison, and opens the maintained Calibration workflow with an explicit coverage-based reference selection. It runs no new NDR or SDR case.

Current owner direction is [CURRENT_OWNER_DIRECTION.md](../../CURRENT_OWNER_DIRECTION.md), version 2026-10-13.4. The later post-call production-input work continues with the original source and model owners. Preserve their active processes, original completed cases and source IDs.

## Run in the existing completed project

From the complete application root, supply the actual retained ensemble ID and a fresh course directory:

~~~sh
python -B -m source_tools.sparrow_candidate_course \
  --workspace "$ECO_WORKSPACE" \
  --ensemble-id "$ECO_ENSEMBLE_ID" \
  --output "$ECO_COURSE"
~~~

The ensemble supplies each member's explicitly tagged baseline. Restoration and matched-control alternatives remain in their original ensemble and are not candidates for fitting model parameters. Every selected baseline must be complete and use the same original grid and baseline land cover; the maintained engine verifies its actual producing versions and stage output identities.

For an original cohort outside an ensemble, use repeated --candidate-run-id instead. An optional --reference-run-id must identify one of those exact baselines. It is never inferred from file order or a profile label.

The first source admission uses source/usgs-southeast-sparrow-2012/prepared-tributaries. The original preparation ID is 4deee902904529bf1f1ecac709451de7a67158174edd1e4cde0811e431be6ddb. All 25 described members are checked by the maintained binder; its returned native observation and source-collection IDs are used directly. The command preserves all seven original source rows.

Rerun the **same command and output** to continue an interrupted course. A retained lock prevents two writers. The immutable course-input.json fixes the original reference edition, candidate runs, native execution fingerprints, model source bodies, prepared geometry/masks, optional input contract and executing implementation. Existing exact source comparisons are reused. A changed source or implementation receives a fresh output directory, preserving the prior course.

## Original source quantities and holdout

| Original basin | COMID | Nitrogen, kg/year | Phosphorus, kg/year | TSS, metric tonnes/year |
|---|---|---:|---:|---:|
| Chattooga River | 6269342 | 270438.4381 | 96111.0042 | 7201.8484 |
| Broad River | 6280111 | — | 223025.1307 | 141611.9058 |
| Stevens Creek | 11730084 | 139789.3642 | 19086.9896 | — |

The source is USGS [10.5066/P9A682GW](https://doi.org/10.5066/P9A682GW), using original ACTUAL and ACTUAL_MT fields. The separate PLOAD prediction columns remain source context. These already annualized rates describe 2012 reference conditions and a **source-global** water-year 2000–2014 target horizon. The original interval is 1999-10-01 through exclusive 2014-10-01. Values are not multiplied by fifteen; the mapper does not supply each station's sampling window or target standard error.

The catchments are the complete retained NLDI upstream basins for the original published reaches, with simplified=false and splitCatchment=false. Their geodesic areas are 526.7785911475625, 3678.6514593063245 and 1470.2314836203814 km² respectively. They are three geographic groups, not seven independent basins. Source constituent TSS00530 remains distinct from other suspended-sediment series.

The course first compares **all seven references** with each completed baseline. It retains partial totals and exclusions exactly as returned by the original observation engine. Only original observation IDs with complete expected native support in **every** candidate enter the score. This selection uses coverage flags, never residual values, and is recorded before parameter ranking.

The preferred geographic holdout is the entire Chattooga group, but only when the other selected groups collectively have a target for every positive-weight pollutant. Otherwise all supported groups enter a descriptive reference fit, with no held-out evaluation. Shared original station IDs and overlapping upstream polygons remain together under the engine's native spatial grouping. The chosen objective gives equal weight to each supported pollutant; normalization uses the training groups only. Leave-group-out scoring is disabled in this course because, in the intended two-group training split, removing Stevens loses nitrogen and removing Broad loses sediment.

The original model algorithms, scoring, selected source units and uncertainty remain unchanged. The generated course records the exact group assignments, selected and excluded row IDs, comparison IDs, plan ID and result ID.

## Preserve the actual model and catchment relationship

The completed regional twelve-case demonstration retains four actual anchor HUCs and their 36-HUC upstream model domain, with deliberately generated terrain, land cover and other physical fields. Its four-anchor South Carolina reporting mask is a separate reporting support. The present course aggregates **original native stage exports over the full original upstream reference catchment**, including land outside that reporting mask. It does not substitute masked scenario-report totals for a gauge load.

Whole-raster coverage establishes source support; it does not establish that a generated DEM drains to the real gauge. A ranking of generated-input cases is therefore an annual-reference parameter comparison under those retained assumptions. It does not transform the original case into a calibrated representation of the real watershed.

For the production-input continuation, use the same command on the original owner's completed baseline candidates, after their actual DEM and required source editions have been prepared for the complete reference catchments. The NatCap [InVEST3.20 freshwater calibration guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/calibration_freshwater.html) describes matching observation periods and delineating gauge watersheds with the same DEM used by the model. Preserve the original published basin and any actual same-DEM delineation separately, with the comparison and outlet relationship. Reservoirs, point-source contributions, stream-bank sediment and differences between model/source periods remain interpretation inputs. No missing external mass or basin area is invented.

The existing production-input owner provides the actual DEM/NLCD/climate/erosion source IDs and hashes, source periods, retained model domain and downstream gauge relation. The existing case owner prepares any necessary expanded model domain and baseline parameter variants. Those runs enter this course using their returned original IDs. Accepted matching candidates are reused.

## Pin an actual production source edition

An optional --input-contract JSON fixes the actual input-body and geography identities for a selected production cohort:

~~~json
{
  "schema": "upstate.annual-reference-input-contract/v1",
  "grid_id": "ACTUAL_NATIVE_GRID_ID",
  "scenario_id": "ACTUAL_BASELINE_SCENARIO_ID",
  "input_source_sha256": {
    "DEM": "ACTUAL_ORIGINAL_DEM_BODY_SHA256",
    "NLCD": "ACTUAL_ORIGINAL_LANDCOVER_BODY_SHA256",
    "R_FACTOR": "ACTUAL_ORIGINAL_R_BODY_SHA256",
    "K_FACTOR": "ACTUAL_ORIGINAL_K_BODY_SHA256",
    "PRECIPITATION": "ACTUAL_ORIGINAL_PRECIPITATION_BODY_SHA256"
  },
  "model_domain_sha256": "ACTUAL_PREPARED_MODEL_DOMAIN_FILE_SHA256",
  "reporting_mask_sha256": "ACTUAL_PREPARED_REPORTING_MASK_SHA256",
  "catchments_sha256": "35f0376904eb2b17a6f07c19099b9c5772f1ae57df449e9ec362623cff874b04",
  "interpretation": "Original source periods, model vintage and actual same-DEM gauge delineation relationship.",
  "alignment_files": []
}
~~~

This is a field guide, not a ready source declaration. Use **exactly the roles in the actual grid's inputs object**; an extra or missing role is rejected. The values are available in grid.json and its original source collection. Grid/scenario IDs may be omitted for portable matching; every actual input role, prepared model-domain hash, reporting-mask hash and source-catchment hash remains required. Optional alignment_files uses native {path, bytes, sha256} descriptors relative to the Workspace; every supplied body is verified. The command does not manufacture or reinterpret an alignment file.

### Separate same-DEM upstream basin edition

For the production owner's actual DEM-derived gauge basins, add --catchments SELECTOR.json. SELECTOR is the existing native source selector: source_collection_id, source_id, id_field and optional layer/where. Each geometry retains the original reference catchment_id as its join key. The original NLDI source and all seven observations remain unchanged and are retained separately.

Set input-contract.catchments_sha256 to the selected derived source body SHA. Its original NLDI predecessor remains pinned separately by the preset.

This path requires the exact --input-contract above plus a delineation_record {path, bytes, sha256} relative to the Workspace. The original producer record uses schema upstate.annual-reference-delineation/v1 and carries:

- dem_source_sha256 and prepared_dem_sha256, both matched to the actual candidate grid;
- original_catchments_sha256 and derived_catchments_sha256, identifying both editions;
- catchment_selection containing the source-local selector: source_id, id_field and the exact optional layer/where values from SELECTOR, excluding source_collection_id;
- method describing the actual source-native drainage derivation;
- producer_files containing complete native {path, bytes, sha256} arguments/log/producer descriptors;
- outlets, one per original reference catchment: catchment_id, source_record_id, original_longitude, original_latitude, model_outlet_xy and model_outlet_crs.

The source-local selector is written before import. Its companion deliberately excludes the collection ID because that ID is content-addressed from the source and companions. After import, SELECTOR and the saved course retain the actual returned source_collection_id. No guessed collection ID or circular hash is required.

The derived source manifest retains the complete original NLDI catchments body, the delineation record and every producer file as companions. This makes the full original/derived relationship portable through the existing source and selected-Study closure; extra pathname references alone are insufficient.

The source_record_id selects an original annual row within that catchment. Its published longitude/latitude must match that original row. All seven retained source_records dictionaries provide finite JSON numbers for these fields; the native observation reader preserves these numeric types, and the course checks them before geodesic calculation. The model outlet retains its actual native coordinates and CRS, including any producer-declared snapping. The course checks that this point lies in the selected derived basin and reports its geodesic displacement from the original published coordinate. It verifies the actual DEM and complete producer files, then applies the existing source-native polygon validity, grouping and whole-catchment raster-support calculation. A filename, a descriptive label or an arbitrary geometry hash cannot establish the original DEM relationship.

The three derived basin geometries must remain available in the selected source, even when only some are fully covered by a candidate's model domain. The native comparison identifies complete versus partial support; the course retains every result. The original scientific owner supplies the actual derivation and reviews the physical drainage relationship. This contract does not create a delineation or turn an unexplained basin into an observed source.

Use --interpretation to retain an additional explicit source-period/physical-input explanation in the original plan. Its full text and actual source hashes survive with the saved result and the selected-profile continuation.

## Completed working outputs

The output directory retains:

- course-input.json: complete immutable original input, source, candidate and code binding;
- comparison-RUN_ID.json: each complete native comparison, including all original partial/support records;
- original-support.json: whole-catchment admission for every baseline and the predetermined geographic split;
- selection.json and plan.json: the exact maintained Calibration selection and saved plan, when common whole-catchment support exists;
- result.json: the complete maintained parameter evaluation, selected working profile, held-out result where available and original source/vintage interpretation;
- course.json and progress.json: usable native IDs and same-operation continuation.

If none of the reference catchments has complete common native support, all original comparisons and their geographic reasons are still delivered. The owner expands the actual source/domain case from those preserved basin identities and runs the same course on its new completed candidates; partial totals never enter a full-catchment fit.

Open the returned observation edition and exact Calibration plan/result in the running operator. The selected-profile continuation preserves the original result, plan and chosen baseline. The recipient-facing producer must open the actual populated views, reports and downloads, inspect desktop/narrow presentation, and reopen the complete scientific Study before presenting it, following the current application AGENTS.md. Source review is distinct from that actual native delivery.
