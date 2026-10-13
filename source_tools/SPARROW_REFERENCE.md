# Original Southeast annual reference targets

This workflow receives the complete original nitrogen, phosphorus and sediment calibration tables published in the USGS Southeast SPARROW mapper, joins their published COMIDs to that same service's original river network, and admits selected annual targets into the existing Upper Savannah Workspace. It uses the existing catchment validator, observation importer, calibration selection and residual-map workflow.

## What the observations mean

The source is USGS release [10.5066/P9A682GW](https://doi.org/10.5066/P9A682GW), documented by its complete original FGDC XML. The mapper is the publisher's Southeast service, identified as “Republished with 10.06.2019 data update -ESM”. The source package retains the entire original service definition, layer 42 network definition, original calibration query responses and all reach-query responses. Original bytes have SHA256 and byte-length pins in `FILES`.

| Source | Original table | Reference field | Units admitted |
| --- | --- | --- | --- |
| Total nitrogen, 00600 | layer 37, 598 rows | ACTUAL | kg/year |
| Total phosphorus, 00665 | layer 36, 589 rows | ACTUAL | kg/year |
| Suspended sediment, 80154 | layer 39,CONSTITUEN=SUSPSED | ACTUAL_MT | metric_tonnes/year |
| Total suspended solids, 00530 | layer 39,CONSTITUEN=TSS | ACTUAL_MT | metric_tonnes/year |

Layer39 contains 395 rows across its two original constituents. `PLOAD_TOTA` and `PLOAD_MT` remain in the retained original attributes as regional SPARROW predictions. They never become observed/reference loads. The source's `TSS_CONV` is a regional model term, retained unchanged; this workflow does not apply it to the original calibration targets or convert a TSS series into SSC.

The XML explicitly gives the global model calibration-target horizon as 1999-10-01 through 2014-09-30. The annual CSV stores 1999-10-01 inclusive and 2014-10-01 exclusive, with `temporal_basis.scope="source_global"`. That is the published shared target horizon. The mapper does not expose each individual station's sampling window or final estimator selector. A target is one long-term annual mass rate, not fifteen separate yearly observations, and it is never multiplied by the fifteen-year horizon.

The regional targets describe 2012 reference conditions. Their source-era land cover and climate remain distinct from current native scenario inputs. Comparability notes survive in the original observation record and should explain the intended historical-versus-current comparison. The source provides no target standard error in these mapper tables; `uncertainty.value` is null. SPARROW prediction errors cannot fill that gap. The existing published-SE sensitivity workflow therefore identifies these source rows as uncovered.

## Published reach attribution and current basin geometry

Every source target retains its literal original station identifier and COMID. Combined records such as `comb600_6269342` and `comb665_6269342` remain separate source identities. A current numeric USGS station identifier is not substituted.

The original mapper's layer 42 provides the published-network `REACHCODE` for each calibration COMID. Its first eight digits supply HUC8. The retained crosswalk covers all 665 unique COMIDs across the complete three calibration tables, so the seven Upper Savannah HUC filter is an exact source-network selection rather than a coordinate box or station-name guess.

Current NLDI basins are a distinct geometry edition. A selected published COMID must resolve to its actual current NLDI feature and full upstream basin. Their complete raw responses, URLs, byte lengths and hashes are retained. This does not assume that the regional publisher's revised network and current NLDI routing are identical.

The maintained `usgs_annual._retained_catchment` checks the actual NLDI identifier, response URLs, CRS, valid polygon components and intersection with the source feature. It computes area from ellipsoidal geometry, preserves every original component, and requires a specific explanation for any explicitly omitted component. The helper updates the catchment context to the correct regional release DOI and retains the original publisher-network attribution. One original series is selected per catchment/native pollutant; TSS and SSC cannot both occupy the same sediment objective unit.

## Use the prepared source edition

Run from the actual `opportunities/upstate_forever_2026` application root:

```sh
python -B -m source_tools.sparrow_reference receive --output /mnt/data/southeast-reference-original
python -B -m source_tools.sparrow_reference inventory \
  --original-root /mnt/data/southeast-reference-original \
  --huc8 03060101 03060102 03060103 03060104 03060105 03060106 03060107 \
  --output /mnt/data/southeast-reference-inventory.json
```

`receive` first adopts the complete packaged source at `source/usgs-southeast-sparrow-2012`. It verifies every original file against its exact pinned bytes. Only a missing packaged entity uses its original public URL through the maintained receiver. A changed upstream response requires a deliberate new source edition; it is not silently accepted as the old edition.

A selection has schema `upstate.sparrow-regional-reference-selection/v1`, the returned `source.id`, a title and a nonempty records array. Each selected row has its exact inventory `record_id` and either `retained_catchment` or `catchment`. The complete accompanying regional selection is generated from the actual published records and retained geometry.

For an existing original basin, `retained_catchment` uses the unchanged annual-reference contract:

```json
{
  "source": "comid",
  "identifier": "6280111",
  "station_role": "published_reach",
  "split_catchment": false,
  "feature": {"path": "nldi/comid-6280111.json", "bytes": 878, "sha256": "37714639a340507c5cb759f665c0e6468c9d9b88ed320cd05db12496a68180ab", "uri": "https://api.water.usgs.gov/nldi/linked-data/comid/6280111?f=json"},
  "basin": {"path": "nldi/basin-comid-6280111.json", "bytes": 63709, "sha256": "444ef5e5987fb5b834333c83a356c71e8e02aad486d6d8dd9e1f1a4ef54d17cb", "uri": "https://api.water.usgs.gov/nldi/linked-data/comid/6280111/basin?f=json&simplified=false&splitCatchment=false"},
  "component_indices": [0]
}
```

These are the actual retained Bell / Broad River source identities. Files named in a retained choice are relative to the receiving original source root. Copy the complete packaged source directory, including its `nldi` members, when adopting the provided regional selection. The source receiver adopts the pinned `CATCHMENT_FILES` as a separate geometry edition. Those responses do not change the immutable regional reference `source.id`.

A direct `catchment` choice contains `source,identifier,station_role,split_catchment`. It requests the exact published COMID's current NLDI response through the existing capture function and then passes those received original bytes through the same geometry validator. It does not substitute a nearby gauge or intersect the basin with the project boundary.

```sh
python -B -m source_tools.sparrow_reference prepare \
  --original-root /mnt/data/southeast-reference-original \
  --selection /mnt/data/southeast-reference-selection.json \
  --output /mnt/data/southeast-reference-prepared
python -B -m source_tools.sparrow_reference bind \
  --workspace /path/to/the/actual/workspace \
  --prepared /mnt/data/southeast-reference-prepared
```

Preparation retains its immutable plan, selected original inventory, all original source entities, annual CSV, native observation metadata, complete catchments and context. Its result shape matches `usgs_annual.prepare`; its bind operation is the same maintained `usgs_annual.bind`. The resulting actual observation ID and catchment source descriptor can open the existing calibration desk directly. Run candidates remain original completed native baseline runs. Sediment comparisons require a completed SDR output; N/P-only native runs remain usable with the corresponding positive-weight objectives.

## API for the existing annual-reference desk

- `FILES`: filename-keyed immutable source descriptors, each with `uri,bytes,sha256`.
- `DEFAULT_SOURCE_ROOT`: packaged exact original source directory.
- `CATCHMENT_FILES`: the ten exact current NLDI feature/basin descriptors, adopted alongside the original reference files.
- `CATCHMENT_CHOICES` and `COMPONENT_REVIEWS`: explicit original component selections and geographic review for the five published reaches.
- `receive(directory)`: adopt/capture and verify the original edition.
- `_source(directory)`: verify and return source schema, release, files and deterministic ID.
- `inventory(directory, *, huc8=None)`: original records, selected HUCs, counts, original tables and source attribution.
- `prepare(directory, *, original_root, selection_path)`: native CSV, observation metadata, vector source collection and immutable preparation result.
- `bind(workspace_path, prepared_directory)`: existing actual Workspace source/observation admission.

Inventory records retain `record_id,series,parameter,parameter_code,station_id,station_name,flow_station_id,comid,huc8,value,unit,value_unit,uncertainty,final_method,selected_load_field,temporal_basis,issues`. `flow_station_id` is empty because the mapper does not expose it. The exact source row lives in `original_attributes`; `original_reach` links its original network query. The desk should display both units and the source-global temporal label, and keep this edition separate from F7DN436B.

## Verification and delivery

This implementation reuses the maintained original geometry and native admission paths. Source row counts, unique object IDs, field sets, exact original bytes, reach joins and selected pollutant units are checked against the full original responses. Native preparation additionally performs geometric validity and original-feature intersection checks. Completed bind output provides the retained Workspace observation and source IDs for actual calibration, uncertainty coverage and original-geometry residual maps.

## Exact Upper Savannah inventory

The complete 665-COMID publisher-network join has no missing or duplicate COMIDs. Eleven calibration targets occur in the seven selected Upper Savannah HUCs:

| Published reach / HUC8 | Original station identities | Nitrogen kg/year | Phosphorus kg/year | TSS metric tonnes/year |
| --- | --- | ---: | ---: | ---: |
| Chattooga 6269342 /03060102 | comb600_6269342; comb665_6269342;02177000 |270438.4381|96111.0042|7201.8484|
| Broad 6280111 /03060104 |02192000| |223025.1307|141611.9058|
| Stevens 11730084 /03060107 |scSV-354|139789.3642|19086.9896| |
| Savannah 22724211 /03060106 |scSV-366|4002243.7871|626063.2658| |
| Savannah 22726623 /03060106 |scSV-368|4031255.2943|636588.0865| |

The complete cohort includes five catchments. The separate tributary selection contains the seven targets on Chattooga, Broad and Stevens. The two mainstem upstream basins nest tributary basins; the calibration engine's actual spatial-group construction must keep overlapping references together. A full-cohort ranking can therefore have fewer independent spatial groups than there are stations. The source does not create extra validation groups from repeated constituents or overlapping catchments.

Full catchment coverage by each actual native run remains required. An observation located inside the project boundary is not sufficient if its upstream basin extends beyond the modeled raster.

## Received geometry and ready selections

All ten complete original NLDI feature/basin responses are packaged alongside the eleven original regional reference files. The source does not need another national archive download. The native receiver adopts the pinned package bytes before considering original URL retrieval.

- `upper-savannah-all-targets-selection.json` selects all 11 targets at five published reaches.
- `upper-savannah-tributaries-selection.json` selects seven targets at the three tributary reaches.
- `geometry-review.json` retains the bounds and exact component indices of each original response.

Chattooga, Broad and Stevens each have one original Polygon component. Jackson has two components; its prepared choice retains Savannah component 0 and records the omitted remote Virginia triangle. Cohens has three components; its choice retains Savannah component 0 and the small local component 1 near longitude−81.4223, latitude32.8047, while recording the same remote Virginia triangle at original index2. The remote triangle's original bounds are[-80.460739101,36.693154613,-80.460283095,36.693418822]. The complete source responses remain intact. Native preparation retains omitted geometry and computes its ellipsoidal area through the maintained validator.

The original regional reference source ID is:
`430f1c2185f2cf14a88c992f270b729e81d9de5cecd20ec67def1c26ff86cc03`.

After receiving the source directory, use the packaged actual selection directly:

```sh
python -B -m source_tools.sparrow_reference prepare \
  --original-root /mnt/data/southeast-reference-original \
  --selection source/usgs-southeast-sparrow-2012/upper-savannah-tributaries-selection.json \
  --output /mnt/data/southeast-reference-tributaries
python -B -m source_tools.sparrow_reference bind \
  --workspace /path/to/the/actual/workspace \
  --prepared /mnt/data/southeast-reference-tributaries
```

The immutable source edition and record IDs in that selection are computed from the actual published response bytes. The native preparation recomputes and checks them, validates the original selected geometry, writes the annual CSV and admits it through the maintained Workspace API.
