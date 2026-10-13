# Observed station studies

Five prepared studies connect the original gauge, lake and outfall sources to the maintained Station Geography desk. The existing saved edition, editable location choice, map, table, source download and portable receiving operations apply to these studies.

| Prepared study | Stations | Linked context rows | Original location candidates |
| --- | ---: | ---: | ---: |
| Regional USGS inventory | 67 | 1,267 | 67 |
| Retained USGS flow and stage | 17 | 1,267 | 17 |
| Eighteenmile lake study | 5 | 254 | 5 |
| Eighteenmile agency outfall locations | 10 | 740 | 18 |
| Eighteenmile indexed flowline locations | 10 | 740 | 18 |

The two regional selections retain the same original 67-point NAD83 source. Their site lists distinguish 16 gauges with retained daily flow, one Chauga stage station and 50 inventory-only stations. The 1,267 rows comprise 96 calendar-year flow summaries, 1,152 calendar-month summaries, 16 lake-study-period summaries and three Chauga stage summaries. The original point properties retain flow/stage coverage and the original source IDs.

The five lake stations retain two WGS84 points and three NAD83 points. Their 254 linked rows comprise 75 individual chlorophyll observations, 26 printed seasonal summaries, 14 continuous-pH summaries, 14 continuous-DO summaries, five surface ranges, 96 routine SWS nutrient observations and 24 same-activity total-nitrogen records. Original laboratory censor fields, reporting units, source project, sample clocks and measurement IDs survive unchanged.

Each combined Eighteenmile study selects the gauge, five lake stations and four permitted outfalls. It adds 12 gauge-month records, 240 facility-month records, 230 original DMR reporting periods and four source-bound network relations. All 740 rows have an exact selected station or permit identity. Linked context rows include measurements, summaries and network relations; the source-specific fields distinguish them.

## Agency and network location choices

Both combined studies retain all three representations of each outfall: native state EPSG:26917, agency-projected EPSG:4326 and NLDI-indexed EPSG:4326. The agency study explicitly chooses each native state feature. The network study explicitly chooses the corresponding indexed feature. Each choice binds the actual imported source, native state object ID and original feature index. The desk can inspect or change that choice while preserving all alternatives.

An indexed point describes the network attachment used in the original reach/measure analysis. The original gauge relation, reporting feature, permit identity and distance between the supplied and indexed coordinates remain visible in the source properties and linked relation table. Changing a displayed location does not recalculate discharge quantities or the retained network relation.

Every study selects the original 217-HUC model domain already used by the maintained assessment studies. The three Eighteenmile studies also select the actual full-resolution USGS whole-catchment basin using its original gauge_id field. The native map produces point-to-polygon memberships for both sources. Current dated USGS WBD service comparisons are an additional source at observations/wbd_station_join_20261013; they retain their own source date and join results.

## Install into the maintained application

Receive this complete component beneath the existing application directory opportunities/upstate_forever_2026. The installer adds one catalogue extension to the current model/station_geography.py and retains its existing content, including later assessment and microbial study support. It checks every supplied original source byte before installation and preserves an existing differing source for explicit reconciliation.

```sh
python operator/install_observed_station_studies.py --application . --source-root .
python -m model.observed_station_studies --workspace /mnt/data/gis12/original-workspace --source-manifest observations/station_context.sources.json --list
```

The original 217-HUC model-domain source is imported through the existing application source intake. It is the same domain required by the maintained 87- and 159-station assessment studies. The supplied native observation manifest contains all 22 original point and table bodies used by these recipes.

In the existing operator, open Station Geography after importing observations/station_context.sources.json. The prepared selections appear alongside the existing assessment and microbial studies. Build either original agency or indexed Eighteenmile study, inspect the saved map, select an outfall, and compare its retained source candidates and linked observations. Use the existing portable archive download to carry the complete study into another workspace.

## Native build and receive

```sh
python -m model.observed_station_studies --workspace /mnt/data/gis12/original-workspace --study-id eighteenmile-observed-context-agency-10 --build
python -m model.observed_station_studies --workspace /mnt/data/gis12/original-workspace --study-id eighteenmile-observed-context-network-10 --build
python -m model.observed_station_studies --workspace /mnt/data/gis12/original-workspace --study-id upper-savannah-usgs-observed-17 --build --receive-workspace /mnt/data/gis12/received-observed-stations --create-receiving-workspace
```

The third command builds the actual observed17 study, exports the ordinary geography ZIP, receives it into the second workspace and compares original coordinates, candidate properties, native feature choices, watershed memberships and observation counts across the two editions.

## Integration details

The component adds model/observed_station_studies.py and its JSON source recipes, observations/station_context.sources.json, this guide and an additive installer. The application catalogue adds this code immediately before its existing station-geography-catalog return:

```python
    # Original observation station study catalogue extension
    from .observed_station_studies import prepared_studies as observed_station_studies
    studies.extend(observed_station_studies(workspace, original_studies=studies))
```

The current assessment recipe remains the source of the original model-domain selection. The catalogue shares that resolved domain reference so the new recipes avoid repeatedly decoding the 11 MB boundary. The CLI resolves the same original domain itself.

The receiving application packages its model, operator, observation and source directories through the existing portable application builder. Include the two new model files and observation manifest when composing a narrower Station Geography source inventory.

The authored component has been checked against every retained point/table body and the exact native station ID, alias, reference and choice contract. Source-level execution linked all rows above with zero unmatched or ambiguous aliases, and confirmed all22 bodies against their original hashes. Native Python build and receive results belong to the executing workspace operation.
