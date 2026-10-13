# RL-18151 original lake observations

The Published studies desk includes **Lake Keowee — RL-18151 original observations, 2018–2026** as the installed cohort `scdes-rl18151-water-quality-2018-2026`. It uses the original agency source family at `source/rl18151-lake-phosphorus-20261013` and the maintained source-owned scientific report.

## Source and analytical support

The cohort contains 498 distinct original ResultIdentifiers and 40 activities. Its three original NarrowResult profiles have disjoint characteristic scopes:

| Profile | Result records | Activity metadata rows | Reporting-limit rows |
| --- | ---: | ---: | ---: |
| Physical | 296 | 40 | 245 |
| Nutrient | 159 | 38 | 159 |
| Microbiological | 43 | 40 | 43 |

ActivityIdentifier joins preserve original project, sample type and activity depth. ResultIdentifier joins preserve original quantitation-limit type, value and unit. Every join retains the original source row, byte identity and native Workspace selector. The 51 unqualified physical results without a reporting-limit row remain valid original observations.

All 498 original result rows remain individually available. The source has 327 unqualified results and 171 below-limit results. The latter retain the reported value and unit exactly as returned, including blank fields and numeric tokens. Their original detection condition and reporting limit remain separate fields. The adapter does not replace censored results with zero, half a limit, or an asserted measured concentration.

MethodSpecificationName remains part of the native comparable-series identity: phosphorus is reported as P, ammonia as NH3, nitrogen species as N and total alkalinity as CaCO3. Blank specifications remain blank. Distinct fractions, methods, depths and sample-support dimensions retain their existing comparison boundaries.

The source query runs from 2018-01-01 through 2026-10-13. Returned observations occur in 2018 and 2024–2026; the latest returned sampling date is 2026-06-11. The source's calendar and scientific report keep the absence of returned 2019–2023 observations visible.

## Open and inspect the study

From **Published studies**, select the installed RL-18151 cohort and import it into the current Workspace. Choose a characteristic and calendar period, then inspect the original observations and their source records. Use the existing saved-review controls to retain the exact edition and selection.

The retained-report list includes **RL-18151 original lake observations — offline inspector**. This is the original source-owned `report.html`, with its original interactive analytical-cohort and reporting-limit context. Its native source entry keeps the source's existing report-recipe identity in metadata. The report uses its own source scope; filtering the desk does not rewrite that original report.

The five original native source entries and the complete scientific source family are preserved. An additional HTML entry points to the unchanged original report for the existing report viewer. Original source roles, metadata, companion identities and application-relative paths survive intake and reopening.

## Install or materialize

Use the complete maintained application or its current Published studies family inventory. The installer includes the complete source closure and the original scientific inventory:

```sh
python3 install_published_studies.py --application /path/to/receiving/application
```

To materialize the exact native cohort separately:

```sh
python3 -m measurement_workspace.rl18151_observations \
  --application /path/to/application \
  --output /path/to/new/rl18151-cohort
```

The source-owned scientific importer remains `source/rl18151-lake-phosphorus-20261013/import_rl18151.py`. It creates the original three observation-context editions and scientific-report recipe. The Published studies adapter retains those same originals in its source-bound comparison desk.

## Native receiving and project reopening

Run the maintained course from the complete application:

```sh
python3 -B source_tools/receive_rl18151_study.py \
  --application /path/to/application \
  --workspace /path/to/rl18151-workspace \
  --output /path/to/rl18151-receiving \
  --create-workspace
```

The default selection is 2025 phosphorus at RL-18151. `--year` and `--parameter` select another original cohort. Omit `--create-workspace` when using an existing Workspace.

The course imports the installed source, checks all 498 result identifiers, 40 activities and 447 reporting-limit joins, exports the selected report and complete study, reopens the study with the same edition and source collection, creates the complete Workspace archive, restores it independently, and reads an original result body through the restored native source selector. Each completed phase is recorded in `operation.json`; a retry reuses identical completed archives and refuses an unrelated source edition or selection.

The original SV-833 command remains available and retains its original defaults and operation identities. Both station commands use the shared `source_tools/receive_original_study.py` implementation. Its optional `--saved-review` continuation preserves the existing saved-review course: after the original phases complete, invoke the same station command and arguments with `--saved-review` to save, reopen, export and receive the selected review and independently restore its review-containing Workspace archive.

## Source closure

The adapter accepts the source-owned `sources.json` only through the registered nested application path. It checks every declared byte count and SHA256, then checks the original `study-files.json` against the exact same source closure. Paths resolve relative to their original manifest and remain within the declared RL-18151 source directory. The original inventory is also retained in exports.

The existing source reader preserves all 78 original NarrowResult columns and exact Activity/Result metadata lineage. The existing Published studies provider, report viewer, selected-row exports, complete-study export and Workspace portability provide the downstream lifecycle; there is one maintained desk and one cohort identity.

## Station geography and ordered scientific delivery

The maintained scientific source now includes `RL_NATIVE_RECEIVING.md`. Its original `import_rl18151.py` can build the saved Station Geography edition and compose the RL report into an existing ordered delivery request. Those operations reuse the source owner's original observation editions and station coordinates. Open the retained receiving guide for the exact `--station-output`, `--build-station` and delivery-selection options. Published studies retains this guide, importer and complete updated report closure alongside the same 498-result cohort.

## Original sampling-support edition

The cumulative scientific source from PR3502 supplies the original sampling explorer, its machine-readable result, all three CSV exports and the complete 50-file source family. Import the installed cohort again to retain that source edition in the same Workspace; existing saved editions and review selections keep their original identities.

The retained-report menu exposes both **RL-18151 original lake observations — offline inspector** and **RL-18151 sampling support — original results and activities**. The sampling explorer keeps original versus compatible cohorts, result versus activity weighting, every leave-one-activity-out selection and the programme/month calendar. Its 2019–2023 coverage gap stays visible. It uses the source-owned calculations and exact original ResultIdentifiers; the native observation table remains the same 498 records and 40 activities.

Both HTML entrypoints retain the complete original source family, including the source recipe, metadata joins and original 16 response bodies. Choose either retained report for its exact selected-report ZIP, or export the complete study and Workspace. Reopening retains the original relative links and each native source selector. The second entrypoint is optional when opening an older scientific source edition, preserving the original inspector's behavior.
