# Geographic stations in an original observation review

Open a saved **Station geography** edition in its original Workspace. Filter the station map or table by watershed, location status, original assessment source, use or cause, and choose **Open matching observations**. That action includes every station matching the current view, across all table pages. For one station, choose **Open station observations** in its detail panel.

The existing Published studies desk opens a **Stations from saved geography** preview. It matches the exact retained station identifiers against each retained study edition. Choose the desired source edition and inspect the matched and missing station lists, its observed sampling dates, and its original row counts. The preview keeps observation and original-result counts separate because those source views may overlap.

Choose **Open N matched stations** to use the explicitly displayed intersection. An empty intersection has no opening action. When the original study has not been imported, use the desk's existing **Import installed study** or source importer and then **Refresh station preview**. Exact identifiers are compared without abbreviating agency prefixes, inferring aliases or merging similarly named stations.

## Save and reopen the selected study

Opening the cohort prepares an observation review draft with the matched station filters, the exact study version, and editable notes identifying the original geography edition, build, donor project, analysis checksum and requested station-list checksum. The source selection starts with all original parameters, years and months; choose the desired sampling filters in the normal study form.

Choose **Save review** to retain the exact original study edition, current filters, table and notes together. Choose **Export saved review ZIP** to carry the selected report, complete original study sources and immutable review. Reopen it through **Import a complete review ZIP**. **Restore previous study draft** returns the study selection, title and notes that were open immediately before applying the geographic cohort.

Geographic assessment labels describe why stations were selected. They do not assign a classification to the sampled records. Original censor conditions, units, methods, activity types, source comments and sampling calendars continue through the maintained Published studies reader. The source figures and analytical reports retain their original full-study scope when the observation tables are filtered.

The review ZIP retains the geographic identity in its notes and the exact observation station filter. To deliver the original maps, coordinate records and polygon sources alongside it, use the existing **Complete edition exports** in Station geography or the ordinary complete Workspace archive. A transferred geography keeps the original donor project, build, archive checksum and source map from its received_from record; these are distinct from the current retained analysis project.

## Native receiving in an existing operated Workspace

This command consumes an already saved geography and an already imported original study. It uses the same source resolver as the browser, saves a normal immutable review, exports the original review ZIP, then reopens it through independent Workspace/store objects and the existing review importer. It runs no geographic overlay or model.

From the complete application's root:

```sh
python -B -m source_tools.receive_geographic_study_review \
  --workspace /actual/workspace \
  --geography ORIGINAL_STATION_GEOGRAPHY_ID \
  --study utility-ecoli-2021-2025 \
  --output /actual/receiving/geographic-observation-review
```

Use `--version study-...` to bind a specific retained study version, or let the command resolve the study's current edition and record that exact version in the result. Repeat `--station ORIGINAL_ID` for a chosen subset. A partial match stops before saving unless `--allow-partial` explicitly selects the displayed matched subset.

The result is `geographic-study-review-receiving.json`, with the original geography descriptor, requested/matched/missing IDs, exact study and collection IDs, saved review ID, source row counts, files and `reopened_review_matches`. Each review's existing `saved-review.zip` and `review.json` are beneath its immutable review ID in the receiving directory.

For the already completed original 640a regional project, the actual saved Station geography edition is `3bf6c45056785bedd914d0dc6dd201cbd9cc8222431e4ba7dbf1a7a99b0144a7`. Its original study contains 36 stations and 730 E. coli records; the same-operation Published studies importer must retain that original study before this command is run. Use the latest accepted Workspace path from that receiving operation.

## Installation and source contract

The complete application retains the helper, native receiver, two desk clients, existing provider, descriptors, read-route policy and this guide. The append-only `geographic-study-selection.json` component fragment declares the new Published studies leaves; it does not replace the shared component catalogue.

The standard Published studies installer includes the helper, native receiver and guide. When the target already has the maintained Station geography backend and model, it also installs the corresponding station client and descriptor from the same source family. A target without that geographic component keeps its ordinary observation desk. The full cumulative application already retains both components.

The source resolver verifies the content-addressed station-geography record and original `analysis.json` bytes, checks the analysis build identity, and requires every requested station ID to belong to that saved edition. Opening a matched study checks its retained source-manifest hash again. The operator's normal selected-Workspace authorization applies to both read-only routes. Newer edits, navigation and Workspace changes supersede pending client replies.

The preview and opened selection are read-only. Review persistence, exports and imports stay on the existing queued review operations and immutable review schema.
