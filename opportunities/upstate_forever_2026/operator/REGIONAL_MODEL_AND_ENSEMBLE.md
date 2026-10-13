# Upper Savannah: regional sources, native calculations and ensemble receiving

Operation: UPSTATE-FULL-PRODUCT-BUILD-BRYCE-20261012  
Application: opportunities/upstate_forever_2026

This guide joins the retained Upper Savannah sources, regional soil preparation, the original InVEST calculation pipeline, saved-profile ensemble work and the existing operator receiving process. It is for the host operator and scientific integrator. The in-application guided journey and meeting desk consume this same Workspace and its actual results.

Use ECD1's complete cumulative application F0C8JNZTURK and its maintained successor, with the selected source additions below. That receiving base contains 252 complete files and 3,892,300 source bytes. Its source manifest retains the original 72-file carrier F0C8F3MKR3M and eighteen-file map/customer receiving carrier F0C8GLD74CT as lineage. The complete current file map supplies the receiving base; its original source manifests and application modules remain the basis of the calculation.

The selected source identity passed to the commands below comes from the delivered source package. Keep that identity with the prepared plan, Workspace, model handoff and received package.

## 1. Open the existing receiving environment

Run from the directory containing model/, operator/, source_tools/ and source/. Set UPSTATE_PYTHON to the accepting host's equipped interpreter and use it consistently for every stage below. Keep the complete original source and prepared input archives available beside the working project. Use an ordinary disk-backed operation directory for retained national archives, working rasters and the final archive.

Two ECO12 seats contribute different components. The single-artifact seat recorded /mnt/data/eco12-source for its additive source; the multi-pollutant seat is host f5dd7c7e9cd6 and recorded /mnt/data/eco12-delivery/opportunities/upstate_forever_2026. Their receiving messages identify /opt/pyvenv/bin/python, /usr/bin/chromium and Python Playwright in their respective cloud containers. ECD1 supplies the complete cumulative application, and the existing Fleet/ESI/405F workers retain their current regional source and native Workspace operations. Transfer the selected complete source and Workspace archives through the already demonstrated connected Drive file bridge, then use the paths returned by the receiving host. Google_Drive.fetch with download_raw_file=true and include_base64=false returns the complete mounted file reference for that host. The source producer supplies reader access for the receiving account identified by the actual handoff, on the same stable Drive file. Retain the selected file ID, source edition, byte count and SHA256 with the application receipt.

The current cumulative receiving dispatch addresses ASTRA-ASSEMBLE12/ECD1 and host f5dd7c7e9cd6; use the application root from its actual source receipt: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791851825377939 .

Earlier receiving route: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791849843511819 . Cross-account receiving and its successful original terrain transfer: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791850855205669 .

The existing htch-runtime inventory records these paths:

| Component | Recorded existing path |
| --- | --- |
| Python | /usr/bin/python3 |
| Node | /usr/bin/node |
| Playwright module directory | /home/hatch/workspace/sim-work/rsd400-cf0907/nm/node_modules |
| Chromium | /home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome |

That host reported Python 3.12.3, Node 24.20.0, Playwright 1.49.1 and Chrome 156.0.8078.4. Use the current installed paths when the receiving host differs. Pass the Chromium path explicitly: the measured Playwright default browser was absent, while the recorded chromium-1248 executable was available.

The existing native model needs its original scientific dependency environment, including the selected InVEST 3.20 installation. The original operator receiver uses the actual Python/Node/browser paths supplied to its command. Keep the model and browser in the same receiving operation so the original Workspace and its local server are accessible.

Source of the recorded runtime inventory: https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791766576205479

## 2. Recover the retained regional inputs

Reuse the completed original files and their companion metadata.

| Input | Retained original | Meaning |
| --- | --- | --- |
| Upstream model domain | libfile_cce17e762e948191be1d226b1dbce00d; complete ZIP 8,800,689 bytes; SHA256 1fc35e5d0986e42d93922527d46e38bc5132653db75863934349dbbfaa352c04 | 217 selected HUC12 polygons, with the original reporting and upstream context |
| Precipitation | Slack F0C8H2FGAUV; original ZIP 62,685,097 bytes; SHA256 763f97b677711112ff7b1082c794476e2d9b7abe1f6e55dd4f1166e32523ccd3 | PRISM 1991–2020 precipitation normal, original 30-arcsecond source |
| Rainfall erosivity | Slack F0C9BC7MKME; original 47,143,128 bytes; SHA256 157bbcaa54b445f96506fb1caffda4bbaea6b28f71bc7199235705e69cd00596 | Retained NOAA R source and its original unit definition |
| Land cover | Existing national Annual_NLCD_LndCov_2025_CU_C1V2.zip receiving operation | Original 2025 categorical land-cover data; local preparation covers the complete selected domain |
| Soil erodibility | The regional capture and preparation in section 3 | Source-native USDA mapunit geometry, ratings, survey editions and a grid-aligned K raster |
| Elevation | The selected retained DEM source in the model plan | Actual elevation and vertical units used by the native terrain calculations |

The equipped receiving host can obtain the complete original domain directly with its existing Library materialization tool:

~~~json
{"items":[{"library_file_id":"libfile_cce17e762e948191be1d226b1dbce00d","file_id":"file_00000000982081f4a357dcf78d83f289","file_name":"dbc61-upstate-model-domain-20261012.zip"}]}
~~~

Pass that object to mcp__codex_apps__library_prepare_materialize. Its successful transfer returns either the actual workspace_path or a GET download_url with required headers. Reuse a returned workspace_path directly; otherwise the equipped host retrieves the complete archive into its actual task directory using that returned transfer. Keep signed URLs and headers in the receiving process. Verify the 8,800,689-byte archive against the domain SHA256 above, then extract it for the source commands. This original-domain transfer is available independently of a separate Drive upload.

The national NLCD acquisition and full-domain preparation belong to the current 25FD/DBC61 source operation. Consume its retained national archive and prepared raster. The static product's original TIFF supplies its actual CRS and transform; retain those values through categorical nearest-neighbor preparation. Its metadata is separate from the earlier WCS service contract.

The source collection must identify the South Carolina reporting area, complete upstream model domain and the four utility focus watersheds separately. The regional domain's source ID is upstate-wbd-upstream-domain-20261012. The earlier local copy was /dev/shm/dbc61-upstate-model-domain-20261012/sources.json; use the same manifest from its recovered archive when that temporary path is unavailable.

Keep precipitation at its original source resolution and normal-period meaning in the source record, even when the model prepares a 30 m working grid. The retained NOAA R source uses its original US-customary units; the existing erosivity preparation applies the documented 17.02 conversion once.

Current original source thread: https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791760162728339  
Shared source metadata: https://app.notion.com/p/3f7dd77231008147bfb0d97e296fda3b

## 3. Capture and prepare regional soil erodibility

Receive the complete maintained soil component F0C88M55E79 as one existing application_assembly --overlay input. It contains eight complete files and 155,606 source bytes: the source, regional capture and coverage modules, their guides, and the original metadata pair. Its application-source-part/v1 gzip/base64 carrier reconstructs a commons.source-bank/v1 document with UTF-8 entries. Preserve the selected application's current core rasters/common modules when composing this component.

The new source_tools.soil_region module has two distinct operations. Capture retains source-native geometry, ratings and metadata for the complete buffered domain and can progress independently of the national land-cover download. It uses Shapely, pyproj, the existing native USDA helpers and Python's SQLite library. Prepare places that retained source on the selected land-cover grid using the existing NumPy, Rasterio, pyproj and Shapely environment.

Select the actual recovered domain-manifest path in UPSTATE_DOMAIN_MANIFEST and a disk-backed capture directory in UPSTATE_SOIL_REGION. Early acquisition uses the original 1000 m buffer already selected by 25FD, 405F and the maintained K pipeline. The soil module preserves this domain and buffer with its own capture. The eventual native grid binds those same values after the physical raster preparation is complete. Run the existing source item through the ordinary USDA provider route:

~~~bash
"$UPSTATE_PYTHON" -B -m source_tools.soil_region capture \
  --domain-manifest "$UPSTATE_DOMAIN_MANIFEST" \
  --domain-source-id upstate-wbd-upstream-domain-20261012 \
  --output "$UPSTATE_SOIL_REGION" \
  --vintage USDA-SDA-2026-10-12-native-capture \
  --buffer-m 1000 \
  --tile-edge-m 15000 \
  --halo-m 60 \
  --page-size 128 \
  --rating-batch 1000 \
  --resume
~~~

The operation can use the existing paired metadata files by adding both arguments:

~~~bash
--attribute-metadata source/soil-interpretation-20261012/soil-erodibility-rule-form.body \
--metadata-capture source/soil-interpretation-20261012/soil-erodibility-rule-form.capture.json
~~~

If that complete pair is omitted, the module captures the current native USDA metadata. Retain the selected metadata edition with the same capture.

The capture emits soil-mapunits.geojson.gz with native identities, kw_choice and kw_si; soil-polygons.sqlite with the original WKB index; ratings.json; geometry-capture.json; survey-editions.json; coverage.json; capture.json; progress.json; original/domain companion trees; and a source-manifest.json entry with role SOIL_K_NATIVE.

Use the prepared original NLCD raster as UPSTATE_NLCD and select UPSTATE_SOIL_PREPARED for the aligned product:

~~~bash
"$UPSTATE_PYTHON" -B -m source_tools.soil_region prepare \
  --capture "$UPSTATE_SOIL_REGION" \
  --reference "$UPSTATE_NLCD" \
  --output "$UPSTATE_SOIL_PREPARED" \
  --null-policy nlcd-water-zero
~~~

The nlcd-water-zero policy supplies zero only where the original valid numeric NLCD class is 11, the native soil rating is absent, and no conflicting native rating exists. Other missing values remain NoData. The coverage summary counts unresolved_land_cells, native_unrated_cells, no_polygon_cells and different_rating_cells separately. Select preserve when the scientific case requires all source missing values to remain unchanged.

The prepared soil-k.tif uses the exact reference raster grid. The emitted K_FACTOR source manifest records SI units and the one 0.1317 conversion from the native K values. Keep the complete capture beside this prepared derivative so the operator can inspect the actual mapunit choices and their geographic coverage. Attach the emitted prepared source entry to the selected source manifest and use its actual K_FACTOR source ID in the subsequent complete native plan.

The early capture selection is recorded in the corrected current handoff: https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791849808106779 . Its original 1000 m basis is retained in the 25FD source request, 405F continuation and K execution selection at 1791847432.704279, 1791847717.698919 and 1791847510.685729 respectively.

After preparation, run the maintained per-HUC coverage stage against the prepared K directory:

~~~bash
"$UPSTATE_PYTHON" -B -m source_tools.soil_coverage \
  --soil-source "$UPSTATE_SOIL_PREPARED" \
  --domain /dev/shm/dbc61-upstate-model-domain-20261012/model-domain.esri.json.gz \
  --bindings /dev/shm/dbc61-upstate-model-domain-20261012/feature-bindings.json \
  --reference "$UPSTATE_NLCD" \
  --output "$UPSTATE_SOIL_COVERAGE"
~~~

Use the corresponding recovered domain and feature-bindings paths when the original archive is on another host. This stage consumes the prepared soil-k.tif and its source metadata. It emits the HUC12 GeoPackage/CSV, coverage bitmask, summary and a SOIL_SOURCE_COVERAGE manifest entry. Compose that entry beside K_FACTOR. The complete source_tools/SOIL_COVERAGE.md explains the optional reporting-area/layer/where selections.

## 4. Select the actual native model plan

The original model.native_batch entry point consumes a JSON plan with schema upstate.native-model-plan/v1. The plan is the complete selection of retained inputs, working profiles, cases and requested deliveries.

| Plan field | Actual selection |
| --- | --- |
| title | Human-readable name of the case |
| source_manifest | Retained source manifest, relative to the plan or absolute |
| source_manifest_sha256 | SHA256 of that exact manifest |
| grid.input_sources | Existing source IDs for DEM, NLCD, PRECIPITATION, R_FACTOR and K_FACTOR |
| grid.reporting_area | Actual source_id plus the selected layer/where definition |
| grid.model_domain | Actual upstream source_id plus the selected layer/where definition |
| grid.upstream_buffer_m | Explicit positive buffer distance |
| profiles | Named profile definitions using the selected biophysical_source_id, ndr, sdr and references |
| scenarios | Named source-bound case definitions |
| runs | Named runs, each selecting one named profile and one named scenario |
| comparison | Ordered run names: baseline first, followed by the selected alternatives |
| delivery | baseline_run, scenario_runs, source_roles, overlays, contact and cartography |

The native entry point supplies the imported source_collection_id to each named profile and scenario. Keep that automatic binding intact. The profiles select the actual biophysical table and original NDR/SDR parameters. An alternative land-cover case uses the same intended profile when the scientific question is the effect of the land-cover change.

The retained fifteen-row Duke Forest Table 4 management coefficients have been compared with the indexed original table and match exactly. Preserve the published source, land-cover codes and working-profile meaning when selecting that table. The table's estimates are attributed to Hamel et al. (2015) by Hayashi and Horrigan (2022).

Original coefficient source: https://dukespace.lib.duke.edu/bitstreams/57c6d8cb-9ce3-4740-b1d5-39c92bda284c/download

## 5. Run the original NDR/SDR pipeline

Set the paths to the selected actual Workspace, complete native plan and handoff file. UPSTATE_SOURCE_COMMIT carries the selected delivered application source identity.

~~~bash
"$UPSTATE_PYTHON" -B -m model.native_batch \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  --plan "$UPSTATE_NATIVE_PLAN" \
  --source-reference "$UPSTATE_SOURCE_COMMIT" \
  --handoff "$UPSTATE_MODEL_HANDOFF"
~~~

The original entry point imports the source collection, creates the selected grid, profiles and scenarios, executes the requested native runs, compares them and resolves the complete delivery. Keep its run records, engine arguments, logs and physical output files with the Workspace.

The returned receiving.json uses schema upstate.native-model-receiving/v1. Its canonical location is `workspace/native-model/<selectionID>/receiving.json`. It records the actual completed source, grid, profile, scenario, run, comparison and delivery identities. The explicitly selected handoff path points the next receiving step to that same completed selection.

For the seven map families, retain the current and future nutrient/sediment physical outputs alongside the source-bound protection and combined-priority products. Combined priority meaning belongs with its actual normalization, weights and geography. Keep measured source observations, model estimates and planning scores distinguishable in the result labels.


## 6. Prepare and run paired parameter ensembles

Use the actual grid, saved scenarios and profiles created by the native plan. The ensemble module operates that same Workspace through its original NDR/SDR engines. Each selected parameter member receives its own baseline and every selected land-cover alternative.

Keep the scientific question explicit in the design file. A land-cover comparison uses one member's identical scientific assumptions on both sides. A parameter-sensitivity comparison holds the baseline land cover fixed and compares the member with the first retained reference member.

A parameter-only study can leave alternative_scenario_ids empty and compare the selected profiles or explicit parameter axes against the central baseline. That study needs at least two distinct parameter members after equivalent selections are reused. Land-cover studies include their selected alternatives and preserve one baseline per member.

The design uses the actual IDs from the native Workspace. It has these fields:

| Field | Selection and effect |
| --- | --- |
| title | Name displayed for the ensemble |
| reason | Scientific question and reason for these selected cases |
| grid_id | Retained grid whose available native models cover the selected study |
| models | Optional native model selection; omission inherits grid.spec.models |
| baseline_scenario_id | Saved observed-land-cover baseline |
| alternative_scenario_ids | Ordered saved land-cover alternatives; an empty list selects a parameter-only study |
| base_profile_ids | Ordered retained scientific profiles; central reference first |
| design | factorial for all declared combinations, or one_at_a_time for separately changing each axis |
| axes | Explicit parameter choices; an empty list compares the selected retained profiles |

Grid, scenario and profile IDs are the actual 64-character hexadecimal Workspace IDs. Use the schema in model/ensemble-design.schema.json and the detailed operating reference in model/ENSEMBLES.md.

Each parameter axis contains id, targets, values, reason and references. Targets identify actual native parameters. Values carry the scientific decision and its original citation or retained source. A single axis can apply a deliberately shared value to several targets, such as the NDR and SDR stream thresholds; each target belongs to only one axis.

Read the exact native names, definitions and units:

~~~bash
"$UPSTATE_PYTHON" -B -m model.ensemble_cli catalog
~~~

The source-bound catalogue provides three retained studies:

| Study ID | Declared models | Native parameter choices |
| --- | --- | --- |
| routing-lmax-v1 | ndr and sdr | Linked routing mfd/d8; SDR maximum L factor 122/333 |
| routing-ndr-v1 | ndr | NDR routing mfd/d8 |
| routing-lmax-sdr-v1 | sdr | SDR routing mfd/d8; maximum L factor 122/333 |

The source retains the exact primary reference, version, locator and reason for every axis. The complete and SDR studies have four declared factorial combinations per base profile, with the original reference values also retained and equivalent selections reused. Read the actual member/run/pair counts from preview. The full native recipe in model/ENSEMBLES.md retains those counts in ensemble_results/<id>/study-preview.json.

The optional design.models field inherits the selected grid when omitted. The full-model retained plan and native requests canonicalize both models to the historical omitted representation, preserving their original IDs. Partial plans and case requests retain their explicit models. The selected-model engine uses common available N/P/sediment outputs on the same retained grid; native comparison records retain common_artifacts and per-run model scope. An existing NDR-first grid can therefore supply the NDR study while the original source operation completes the full model inputs. This requires the maintained model/model_selection.py implementation in the same application. The maintained selected-model/native-stage source is revision 3, F0C8JRS1PM3 and its current public successor, succeeding F0C8N3YVA5U and F0C8JJQ2JBX. It includes Workspace.combine_runs and composes with the current Communities methods and shared application joins.

Study dispatch and complete recipe: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791850228723799 .

The selected base profiles supply the retained biophysical tables and original parameter values. The complete table source collection, source ID, SHA256 and load semantics travel with each member. Original profiles stay available; the module records derived working profiles and their parents.

A factorial design evaluates every declared combination. A one_at_a_time design changes each declared axis separately. Both retain the original profiles; duplicate scientific parameter selections are reused. Preview reports the actual member, native-run, land-cover-pair and parameter-pair counts so the operator can understand the requested computation.

### Execute the sourced study and its delivery in one operation

The complete headless workflow is documented in [model/ENSEMBLE_OPERATIONS.md](../model/ENSEMBLE_OPERATIONS.md). It uses the same Workspace, source catalogue, original native runs, scalar reports and paired raster products as the browser. The public command implementation is retained in the complete application; receive its current study CLI, cohort adapter and operation module together.

Read the actual saved selections first:

~~~bash
"$UPSTATE_PYTHON" -B -m model.ensemble_cli \
  --workspace "$UPSTATE_MODEL_WORKSPACE" context
~~~

This returns retained grids, profiles, scenarios, native runs, ensemble records and available source-backed studies. Set UPSTATE_GRID_ID, UPSTATE_BASELINE_ID and UPSTATE_PROFILE_ID to the actual selections in this project. For a land-cover study, set UPSTATE_ALTERNATIVE_ID to its saved alternative. The selected grid and profiles must include the models required by the chosen catalogue study.

~~~bash
"$UPSTATE_PYTHON" -B -m model.ensemble_cli \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  run-study routing-lmax-v1 \
  --grid-id "$UPSTATE_GRID_ID" \
  --baseline-scenario-id "$UPSTATE_BASELINE_ID" \
  --base-profile-id "$UPSTATE_PROFILE_ID" \
  --alternative-scenario-id "$UPSTATE_ALTERNATIVE_ID" \
  --with-raster-products
~~~

Use routing-ndr-v1 for the prepared NDR study or routing-lmax-sdr-v1 for SDR. Repeat --base-profile-id to include other retained source profiles and --alternative-scenario-id for additional saved land-cover changes. Omit the alternative option for parameter-only sensitivity. Optional --title and --reason describe the study; the source catalogue supplies their defaults. Equivalent saved selections reuse the same design identity and original completed native stages.

The command prepares the source-backed design, runs its native members, writes the printable scalar release and builds paired raster products and portable ZIPs for the selected land-cover alternatives. Each raster cohort binds a member's baseline and alternative under the identical profile, retains the planned population and pending original run states, and derives its pollutants from the available selected-model outputs. Parameter-only sensitivity stays in the scalar report.

To retain a reviewable design before executing, use study-design with the same study ID and selection flags and redirect stdout to UPSTATE_ENSEMBLE_DESIGN. Its brief workload notice goes to stderr. The existing preview and prepare commands below then operate that exact JSON.

### Continue or export the retained operation

The command prints the saved ensemble identity and operation path before the first native run. Recover that same ID with list or context when continuing an interrupted receiving session:

~~~bash
"$UPSTATE_PYTHON" -B -m model.ensemble_cli \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  continue "$UPSTATE_ENSEMBLE_ID" --with-raster-products

"$UPSTATE_PYTHON" -B -m model.ensemble_cli \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  export "$UPSTATE_ENSEMBLE_ID" --with-raster-products
~~~

Use continue to resume the original native stages and paused paired selection. Use export after the native models have already completed through the operator or another process. Export refreshes missing physical summaries, writes the report release and computes the requested raster products from those actual completed artifacts. Independent native members continue after ordinary failures; --stop-on-error retains the completed results and stops at the first member failure.

Every complete command returns one JSON result on stdout and sends progress to stderr. The saved ensemble_results/ENSEMBLE_ID/operation.json records the actual producing hostname, PID and interpreter, original selection, native progress, report release, paired product identities and archive paths. The original ensemble and native run files remain the execution state. This gives a successor the concrete operation to continue after a terminal or receiving session ends.

| Retained output | Use |
| --- | --- |
| ensemble_results/ENSEMBLE_ID/operation.json | Current command state, actual process and delivered product paths |
| ensemble_results/ENSEMBLE_ID/paired-selections/SCENARIO_ID.json | Original paired selection for each chosen land-cover alternative |
| ensemble_reports/REPORT_ID/ | Printable report.html, pairs.csv, sensitivity.csv, robustness.csv, report.json, METHODS.md, release.json and ensemble-report.zip |
| ensemble-products/ANALYSIS_ID/ | Original paired raster result, reports and retained tile outputs |
| ensemble_results/ENSEMBLE_ID/paired-exports/ | Complete portable paired-product archives |

Read an exact paired selection with cohort ENSEMBLE_ID --scenario-id SCENARIO_ID. Its response includes the original paired run IDs, available pollutants, planned and selected counts, pending members and readiness. The same cohort function supplies the shared paired browser view and headless consumer.

The command reuses an existing archive when its recorded report revision and actual file hash still match; an updated release receives a new exclusive filename. Exit 0 means the requested operation completed, exit 2 retains an incomplete operation or selection/runtime error, and exit 130 preserves progress after keyboard interruption. Repair the affected original input or native environment and continue the same ensemble ID.

Set UPSTATE_ENSEMBLE_DESIGN to the completed design file:

~~~bash
"$UPSTATE_PYTHON" -B -m model.ensemble_cli \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  preview "$UPSTATE_ENSEMBLE_DESIGN"

"$UPSTATE_PYTHON" -B -m model.ensemble_cli \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  prepare "$UPSTATE_ENSEMBLE_DESIGN"
~~~

Use the ensemble ID returned by prepare for UPSTATE_ENSEMBLE_ID. Preparation saves the selected member profiles, native run selections and immutable ensemble plan. It preserves the original source and model calculation pathways.

~~~bash
"$UPSTATE_PYTHON" -B -m model.ensemble_cli \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  run "$UPSTATE_ENSEMBLE_ID"

"$UPSTATE_PYTHON" -B -m model.ensemble_cli \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  report "$UPSTATE_ENSEMBLE_ID"
~~~

Running the same ensemble ID continues the retained operation. The original engine stages, run files and progress records stay with each member. Independent members continue after a member failure; actual errors and completion states remain visible. A partial run returns exit code 2.

After native runs are completed outside the ensemble worker, or when a paired summary needs recomputation, request the explicit refresh:

~~~bash
"$UPSTATE_PYTHON" -B -m model.ensemble_cli \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  report "$UPSTATE_ENSEMBLE_ID" --refresh
~~~

Ordinary inspect/report reads use retained JSON metadata and the cached summary. They do not scan the full rasters on each operator poll. The report states current, pending, stale and partial describe the relationship between the retained summary and the underlying run records.

Native source versions used by the ensemble catalogue:

- NDR 3.20.0: https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py
- SDR 3.20.0: https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py

## 7. Operate the browser and interpret the results

Receive the maintained selected-model core and ECSA extension host into the same application before applying the five-file ensemble operator contribution. The current installer requires model/model_selection.py and the shared install_extensions.py. Its ensemble descriptor is operator/extensions/ensembles.json; the browser adapter uses the host's existing lifecycle and task services. Its DOM namespace is ensemble-design-, while the existing backend ensemble.* actions and model/ensemble_cli.py remain unchanged.

Receive the complete current F0C8JDNF02Z companion and its maintained shared-host successor into the same application. The saved-design study engine uses model/ensemble_cli.py. The multi-pollutant raster product uses model/paired_ensemble/ensemble_cli.py and its retained model.paired_ensemble modules. The shared paired browser view is paired-ensemble; it preserves the existing paired_ensemble.* actions and product identities. Its original prepare/openEdition entries remain available, including host.openExtension('paired-ensemble', 'prepare', selection). The complete maintained component retains the original provider, browser desk and stylesheet. These two maintained consumers share the original completed native runs. The historical external single-artifact model.ensemble_raster_cli/model.ensemble_workspace carrier has its own owner and is outside this public receiving cohort.

Apply both authored integrations from that application root:

~~~bash
"$UPSTATE_PYTHON" -B operator/integrate_ensembles.py --apply
"$UPSTATE_PYTHON" -B operator/integrate_paired_ensemble.py --apply
~~~

The installer defaults to the application root containing its operator/ directory. Use --application with the actual product root when selecting another application directory. The --apply flag writes the composed integration; omitting it returns the composition summary for inspection. The current version migrates the earlier exact ensemble-specific direct registrations into the shared extension host under its existing installation lock. Keep the selected host, ensemble descriptor and browser lifecycle adapter in the application that the receiver will archive. The paired-ensemble installer supplies its namespaced shared-host adapter and paired-ensemble view. The older operator/install_paired_ensemble.py --operator operator entry delegates to this maintained integration; both preserve the original paired operation identities. The completed design cohort uses model.paired_ensemble.designs.design_cohort to bind the actual completed run pairs and declared model scope. Preserve its model.paired_ensemble, paired_ensemble.* actions, paired_ensemble_products collection and /api/paired-ensemble/ routes when composing the current shared host. Its source manifest retains the earlier exact file identities for migration; apply the authored migration against those identities so the saved-design CLI and report producer retain their own paths.

Start the integrated operator on its receiving host using the actual workspace and retained operator-state directory:

~~~bash
"$UPSTATE_PYTHON" -B operator/server.py \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  --operator-state "$UPSTATE_OPERATOR_STATE" \
  --port 0
~~~

When the host's existing route uses an explicit source manifest, add --source-manifest with that actual manifest path. The server binds to 127.0.0.1 and prints operator_url with the session capability. Open that returned local URL on the same host's browser.

In the operator, open Scenario sensitivity and choose New comparison design. Select the complete grid, baseline, alternatives and retained profiles. Add source-cited parameter axes when the scientific question calls for them. Preview cases and run count shows the actual workload. Save design retains the selection; Run submits the existing durable operation. Operations shows its native progress. Completed runs present their results and exports; continuation is available for unfinished runs. Open/Refresh results reads the retained result state. Generate report and exports creates the HTML, CSV, JSON and ZIP downloads from that same selected report. The HTML includes a separate baseline parameter-sensitivity table, and sensitivity.csv carries those parameter-only comparisons. Source references are readable in the report. A current cached export is reused without scanning its original rasters again. The existing Backup/Restore journey preserves the complete Workspace and compatible application source.



The ensemble report reports both complete-output totals and totals restricted to the exact cells valid in each paired comparison. The paired change uses the common valid geographic support on both sides.

| Report quantity | Interpretation |
| --- | --- |
| Nitrogen and phosphorus | kg/year |
| Sediment | t/year, where t is metric tonnes |
| Physical change | Alternative minus baseline on the exact common valid cells |
| Negative change | Lower modeled export under that alternative |
| Percent change | Common-cell physical change divided by common-cell baseline |
| Zero baseline | Physical totals and change remain; percentage is empty |
| Parameter sensitivity | Each member's baseline compared with the first member's baseline |
| Robustness range | Completed selected members grouped by scenario, pollutant and identical common-cell support |

The original Workspace converts the selected native SDR rates to per-cell mass before aggregation. A 30 m square cell is 0.09 hectares. Apply the original version-aware conversion once.

The common_support_sha256 value includes the retained grid, raster dimensions and every bit of the common-valid mask. Equal cell counts can describe different geographic places, so robustness grouping uses the exact mask identity.

A robustness row carries the planned and completed member counts, explored minimum/median/maximum, direction counts and agreement. These ranges describe the selected completed parameter values. Read the associated membership and geographic support when explaining consistency.

The optional NDR runoff_proxy_av is the denominator used for runoff normalization. When omitted, the engine computes the raster average. Uniformly multiplying every precipitation cell while recomputing its average preserves the normalized index. A rainfall case must therefore identify the spatial or normalization change that represents its scientific question.

Keep field measurements associated with their actual station, observation period, units, estimator and model geography. The active USGS archive/qualification work can join compatible observed loads to the same result records. Source-native simulations and internal comparisons can proceed while those independent observations are prepared.

The seven map families connect these quantities to the requested questions:

| Map family | Question supported |
| --- | --- |
| Current nutrient export | Where the selected current-land-cover model estimates nitrogen/phosphorus export |
| Current sediment export | Where the selected current-land-cover model estimates sediment export |
| Future nutrients | How the selected land-cover scenario changes modeled nutrient export |
| Future sediment | How the selected land-cover scenario changes modeled sediment export |
| Drinking-water protection | How the retained source-water and utility geography relate to selected protection opportunities |
| High-quality waters | How the retained water-quality/source categories support priority review |
| Combined pollutant priority | How the explicitly selected normalization and weights combine retained pollutant results |

For a saved ensemble, show the original inputs and scientific profile, the selected alternatives, the member count, the completed paired result, its covered area, and the same report's export. The guide in model/ENSEMBLES.md supplies the detailed source and parameter meanings.

The canonical JSON report uses schema upstate.ensemble-report/v1. Its rows array contains land-cover comparisons; sensitivity contains cross-profile baselines; robustness contains groups on identical support; members contains the actual selected parameter members. Each paired row retains baseline_run_id, alternative_run_id, comparison_id, profile_id, member_id, scenario_id, pollutant and artifact hashes.

## 8. Carry the same Workspace through operator receiving

The existing receiver consumes the completed native handoff directly:

~~~bash
"$UPSTATE_PYTHON" -B operator/receiving.py "$UPSTATE_MODEL_HANDOFF" \
  --output "$UPSTATE_RECEIVING_OUTPUT" \
  --scratch "$UPSTATE_RECEIVING_SCRATCH" \
  --source-revision "$UPSTATE_SOURCE_COMMIT" \
  --node "$UPSTATE_NODE" \
  --node-modules "$UPSTATE_NODE_MODULES" \
  --chromium "$UPSTATE_CHROMIUM"
~~~

For the recorded htch-runtime browser installation, UPSTATE_NODE is /usr/bin/node, UPSTATE_NODE_MODULES is /home/hatch/workspace/sim-work/rsd400-cf0907/nm/node_modules, and UPSTATE_CHROMIUM is /home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome. The CLI arguments also support the current paths on a different receiving host.

The receiver backs up the whole Workspace and the application's model/, operator/, source_tools/ and source/ directories, including the additive ensemble and soil modules placed in those directories. It then reopens the actual received CLI and operator. Keep the completed received application and its actual opening route together with the original handoff and result identities.

The map/customer receiving cohort continues the original selected spatial exports and issuer review, while the community component retains its complete source and plans. Join the current cohort before building the delivered archive so the resulting operator contains all compatible features.

## 9. Reopen and continue the same operation

The complete Workspace retains these original and additive records:

| Retained path | Purpose |
| --- | --- |
| `native-model/<selectionID>/receiving.json` | Original native selection and resolved delivery |
| `ensembles/<ensembleID>.json` | Immutable paired-ensemble plan |
| `ensemble_results/<ensembleID>/state.json` | Current member progress and operation state |
| `ensemble_results/<ensembleID>/summary.json` | Canonical physical result report |
| `ensemble_results/<ensembleID>/pairs/` | Reusable paired summaries |
| `runs/<runID>/` | Original native engine arguments, stages, logs and physical outputs |
| `comparisons/<comparisonID>/` | Original paired differences and their source records |

Create the delivered archive after the intended native and ensemble work has been retained so the receiving operation includes those directories. Use the same completed workspace throughout the original browser, export, backup and transferred-copy opening route. The actual source identity, input collection, grid, profile, scenario and run IDs should remain visible in the received records.

If the host process ends, recover the completed source package, original archives and Workspace first. The soil capture's progress.json and --resume continue its own retained acquisition. The ensemble run command continues the same ensemble ID. Refresh a summary only when underlying runs changed or its retained result needs recovery. The original receiving.json reconnects the native model selection to the portable operator receiver.

The full product's current guided operator journey supplies Bryce's opening, case selection, run, map, export, save and transferred-copy steps. Use its actual received local URL and selected case. The model and source records in this guide supply the scientific meaning and the exact continuation commands behind that journey.

## 10. Source cohort and operating references

The merged public receiving foundation is PR 2711, commit a25edf3d5f16a426ed93b7428bc6d0e738e385b1, under opportunities/upstate_forever_2026. Its retained guide, scientific ensemble, soil and assembler sources compose with the maintained shared host. The subsequent maintained soil coverage join is PR 2716, merge 0cfae283fdbf17e6301b74b6669d625c423fcf7c. The headless study implementation and operating reference were published at a48f08be69fdb388373d0cd6d57395b0f5ca76fb and are included by the current whole-release composition.

The authoritative internal work order and source thread remain:

- Full-product work order: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791845708085279
- Work-order continuation: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791846014898459
- Training requirement: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791846191194349
- Original shared source/model operation: https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791760162728339
- Recorded existing host/browser inventory: https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791766576205479

Retain these compatible carriers in the delivered source manifest:

| Carrier | Source contribution |
| --- | --- |
| F0C8JNZTURK and maintained successor | Complete ECD1 cumulative application receiving base: 252 files, 3,892,300 source bytes |
| F0C8F3MKR3M | Complete original 72-file source cohort |
| F0C8GLD74CT | Current eighteen-file map/customer receiving integration |
| F0C8HMZDJ11 | Original community/report/source and Esri reader closure |
| F0C8FHWRZ43 | Retained original spatial.py and spatial_exports.py bodies where required by the selected cumulative source |
| F0C8JRS1PM3 and maintained successor | Current nineteen-file selected-model/native-stage assembly revision 3 with Workspace.combine_runs; follows F0C8N3YVA5U and F0C8JJQ2JBX |
| F0C8TNEPZB6 and ECSA's maintained successor | Complete shared extension host, typed retained-file routes, programme-aware browser, descriptors and install_extensions.py |
| F0C9J455NP2 | Paired parameter engine and command-line source |
| F0C8JDNF02Z | Complete twenty-four-file ensemble methods, schema and model.paired_ensemble shared-host companion with selected-model profile support |
| F0C88M55E79 | Complete maintained eight-file soil component, including original metadata and guides; receive as one overlay |
| F0C8RM735LH | Complete source_tools/soil_region.py capture and preparation module |
| F0C8HGKG0BD | Full source_tools/SOIL_REGION.md capture, prepare and inspect guide |
| F0C88E1SJQP | Maintained source_tools/soil_coverage.py and SOIL_COVERAGE.md compatible with the regional prepared K source |
| F0C8TDW58G4 | Ensemble browser, durable tasks, source integration and report/export modules |
| This guide's carrier named in the delivery manifest | End-to-end regional model and ensemble receiving procedure |

The maintained study CLI is model/ensemble_cli.py. The completed multi-pollutant streaming product uses model/paired_ensemble/ensemble_cli.py and model.paired_ensemble.EnsembleWorkspace. Pixel benefits named reduction use baseline minus alternative; native physical delta_common uses alternative minus baseline. Convert a benefit to a change only for the same physical quantity, units and exact shared cells, keeping the names and sign explicit.

Quantiles reverse their order under that sign change: q10(reduction) = -q90(change), q50(reduction) = -q50(change), and q90(reduction) = -q10(change). Minimum reduction is negative maximum change. Each pixel's valid paired-member count uses members whose own baseline and alternative are both valid at that pixel; retain the requested population separately. Fraction reduced is the count of positive paired reductions divided by that valid paired-member count. The pixel product's declared support rule and original mask determine where these quantities are reported; whole-area scalar ranges continue grouping by exact common-support masks.

The multi-pollutant companion consumes the actual completed pairs through model.paired_ensemble.EnsembleWorkspace. Its current CLI is:

~~~bash
"$UPSTATE_PYTHON" -B -m model.paired_ensemble.ensemble_cli build \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  --selection "$UPSTATE_PAIRED_RASTER_SELECTION"
~~~

UPSTATE_PAIRED_RASTER_SELECTION is the retained selection JSON built from the original completed baseline and alternative run IDs. Select pollutants explicitly from those runs' shared native outputs: an NDR-only study supplies its available nitrogen and phosphorus outputs, an SDR-only study supplies sediment, and a combined study can supply all three. The companion's omitted pollutant selection defaults to all three. The current profile join accepts the selected model family while preserving the original grid, native masks, source records, case identities and product/result paths. Use the companion's complete retained selection schema in its delivered guide to name those exact run pairs and support rule.

Original paired-raster request contract: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791849843511819 . Paired engine/raster joining guidance: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791849475421189 .

The paired engine, operator and integrated guide use the existing commons.source-bank/v1 carrier. Each files[] entry declares encoding: "utf-8" and retains the original file bytes in content_base64, with its path, byte count and SHA256. The complete twenty-four-file science companion and eight-file soil component use ordered upstate.application-source-part/v1 gzip/base64 blocks around the same complete source-bank representation. Save the full actual carrier text as the local receiving input, including every numbered part when that transport is present. Add each complete carrier to the current application_assembly invocation as --overlay followed by its actual local path. The existing assembler accepts the standard bank and numbered-part formats, reconstructs the inner document and decodes the declared bodies. Preserve the selected current core when composing these overlays.

The operator carrier includes operator/integrate_ensembles.py and operator/extensions/ensembles.json to join the feature into the selected existing application. Run its --apply command from section 7 after the compatible selected-model and extension-host source is present. Use the current complete source package to reconcile original and additive files before starting the receiving operation.

Shared extension-host source: https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/f293e68f7f490346280419ae447748ef95ec76a3/opportunities/upstate_forever_2026 . Historical source-closure banks supply the required original leaves; the cumulative assembler retains the later selected-model, Workspace, server and browser composition.

Public source references:

- Issuer RFP and appendix: https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf
- PRISM original precipitation archive: https://data.prism.oregonstate.edu/normals/us/800m/ppt/monthly/prism_ppt_us_30s_2020_avg_30y.zip
- MRLC national 2025 land-cover archive: https://www.mrlc.gov/downloads/sciweb1/shared/mrlc/data-bundles/Annual_NLCD_LndCov_2025_CU_C1V2.zip
- Duke Forest original coefficient source: https://dukespace.lib.duke.edu/bitstreams/57c6d8cb-9ce3-4740-b1d5-39c92bda284c/download
- InVEST NDR method: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/ndr.html
- InVEST SDR method: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html

Prepared for TokenJunkieLabs' Upper Savannah application. Preserve the existing original-source and dependency license notices in the delivered source and receiving package.
