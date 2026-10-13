# Receive the original RL-18151 study into the existing workspace

Use the original `A73C-RL18151-PHOSPHORUS-20261013` study and its current complete source directory. The importer retains the existing five source IDs and the nutrient, physical and microbiological observation editions. It now also prepares a directly usable Station Geography selection and can update an existing scientific delivery request.

## Import, locate and compose the selected report

Run from the installed Upstate application with its maintained `model` package and scientific dependencies available. Supply the actual current workspace and complete current delivery request:

```sh
PYTHONPATH=/actual/upstate_forever_2026 python -B \
  /actual/rl18151-lake-phosphorus-20261013/import_rl18151.py \
  --workspace /actual/existing-workspace \
  --source-root /actual/rl18151-lake-phosphorus-20261013 \
  --output /actual/receiving/rl18151-native-receipt.json \
  --station-output /actual/receiving/rl18151-station-selection.json \
  --build-station \
  --delivery-selection /actual/current-delivery-selection.json \
  --delivery-output /actual/receiving/delivery-with-rl18151.json
```

The output paths must be distinct and outside the retained study files. The original delivery request stays available. Omit the two delivery options together when importing into a workspace that has no selected delivery request yet. The returned `observed_context_source` is available for the application's existing ordered report picker.

The actual native receipt contains:

- The saved source collection and original manifest SHA256.
- The three actual observation edition IDs, or an explicit original empty response for a group with no rows.
- A usable `station_selection`, plus its saved path when `--station-output` is supplied.
- The actual `station_geography.id`, build identity, summary and registered source collection when `--build-station` is supplied.
- The original report source pair and recipe SHA256.
- The complete updated delivery request's location, ordered report selection and fresh verified report binding when the delivery options are supplied.

The station selection connects the retained original GeoJSON to the observation IDs returned by this import. Its point reference uses `collection_id`, `source_id`, `source_sha256` and the actual `MonitoringLocationIdentifier` property. The study station `RL-18151` has the explicit original alias `21SC60WQ_WQX-RL-18151`. The maintained geography engine reads the retained CRS, preserves the original coordinates, and links all imported observations once through their observation editions. Additional watershed or assessment selections can be made through the existing editable Station Geography workflow.

## Preserve the current scientific delivery

The optional delivery composition changes only this study's report selection and the corresponding report binding:

- If the current request has one report with ID `rl18151-phosphorus-observed-report-2018-20261013`, its current list position receives the newly imported source collection.
- If this report is absent, it is appended after the existing reports.
- The other report choices, their order, and all other delivery settings are preserved.
- If the existing request declares a primary `source_roles.OBSERVED_CONTEXT`, it remains aligned with the first ordered report.
- If multiple prior RL-18151 editions were deliberately selected, choose the one to update in the existing request before composition.
- Every selected report and companion is verified by the maintained `observed_context.bind` function before the new request is written.

Build the resulting delivery through the existing application command:

```sh
PYTHONPATH=/actual/upstate_forever_2026 python -B -m model.cli \
  --workspace /actual/existing-workspace \
  delivery-build /actual/receiving/delivery-with-rl18151.json
```

When a station edition was built, inspect its actual returned ID:

```sh
PYTHONPATH=/actual/upstate_forever_2026 python -B -m model.station_geography \
  --workspace /actual/existing-workspace inspect ACTUAL_RETURNED_STATION_EDITION_ID \
  --complete --verify
```

The existing import APIs derive their saved identities from retained contents. The original station build verifies and returns its existing edition for the same complete selection. Repeating the same source import and request composition preserves one selected RL report entry rather than appending another copy.

## Keep the source closure current

Run the original study builder against the current complete code and response edition before importing. Include this guide in the current additive sampling-support closure when that companion is applied. The observed report retains all original responses, normalized observation tables, analysis code and report files as companions; the guide travels with that complete edition.

After any source, analysis or report change, refresh `sources.json`, `observed-report.json` and `study-files.json` through the maintained producer. A current importer copied into an older hashed source directory is a changed source edition and must be rebuilt before it is imported.

The observation import keeps original numeric and blank values, qualifiers, units, dates, species and source rows. Nutrient and microbiological measurements remain discrete concentration context; physical measurements remain physical context. The station build and report composition consume those same retained editions.
