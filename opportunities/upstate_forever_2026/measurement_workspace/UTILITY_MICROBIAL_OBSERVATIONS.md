# Original utility E. coli in Published studies

The installed study `utility-ecoli-2021-2025` brings the complete original microbial cohort into the existing Published studies desk: 730 result rows, 730 distinct original activities and 36 stations sampled during 2021–2025. It uses the same retained agency responses and utility assignments as the native Station geography study.

## Open, inspect and retain the study

1. Run the maintained installer against the existing application:

   ```sh
   python install_published_studies.py --application ACTUAL_APPLICATION
   ```

   The source checkout supplies the full original `source/ecoli_utility_context/20261013/` directory. The installer includes every one of its 22 unchanged files and the microbial study builder. Restart the existing operator and reload its page after installation.

2. Open the intended Workspace, then **Published studies**. Import **Utility-focus E. coli observations, 2021–2025** from the installed sources. The normal retained task creates a study version and its original source collection.

3. Select a station and **Escherichia coli**, followed by the desired year and month. The ordinary calendar filters select actual sampling dates. Inspect original records, method/activity-type series, qualifiers and exact source-row links.

4. Open an original result to inspect its retained values, detection condition, bound value/type/unit, analytical method, sample clock and comments. The original field replicate at `21GAEPD_WQX-LK_01_11` remains a separate activity-type series.

5. Export the selected report or the complete study. Selected exports include one original-field CSV per response and an index connecting each selected row to its original CSV row, activity identifier and source hash. Reopen the retained study version from the same desk. The complete source package contains all six unchanged original WQP result responses, original station metadata and all original companion files, including the interactive source explorer.

6. Use **Station geography** for the native spatial journey: build the original utility microbial study against the retained 217-HUC domain, inspect each station and its original watershed membership, and retain the native report/package. Its source selection uses the original CSV coordinate values in each station's declared datum.

## Original values and sampling support

The complete cohort has 554 quantified results, six above-limit results, 67 below-limit results, 102 not-detected results and one not-reported result. The 176 nonmeasured result fields remain blank; their original limit and unit fields remain available independently.

Series preserve original station, project, activity type, sample fraction, method authority/identifier, result value type, basis fields and support-unit spelling. `MPN/100mL` and `MPN/100 ml` remain as reported. Each quantified mean and sample standard deviation describes only the quantified records within that specific selected series. The existing support report retains below-limit intervals and identifies records without a supported finite interval.

There are 729 routine activities and one original field replicate. Original sample comments and result comments travel with every record, including the publisher's Information Only notes. Station and calendar filters retain their exact original scope in every selected export.

ARJWS contributes 142 observations at five stations selected from the four original upstream HUC12s. PRWD contributes 588 observations at 31 stations with the original Tugaloo HUC8 source assignment. The source index records six complete response identities, date windows and explicit station sets. Overlapping dates are accepted only where the declared original station sets are disjoint, with those sets verified against every response row.

## Coordinates and original source documents

The station table keeps the original CSV latitude/longitude strings and declared coordinate systems. Two native point sources preserve 34 WGS84 positions in EPSG:4326 and two NAD83 positions in EPSG:4269. Each feature retains its original station identifier, all original station attributes and the original CSV row number.

The unchanged WQP display GeoJSON files are retained as source documents. The original offline explorer keeps its entire relative companion tree beneath `original/`. The native point sources and the Station geography product provide explicit coordinate-system metadata for GIS work.

## Build an independent study source directory

The ordinary operator builds the same companion directly from the installed source files. A native session can also materialize it for inspection and the maintained source importer:

```sh
python -B -m measurement_workspace.utility_microbiology \
  --application ACTUAL_APPLICATION \
  --output NEW_STUDY_DIRECTORY
```

The builder verifies the original manifest identity and every declared source hash before deriving the station table, explicit source index and coordinate groups. It preserves the original 63 result columns, the original 37 station columns, all six response counts, the full routine/replicate cohort and the exact 34/2 datum split. A repeated build accepts identical existing output files and rejects conflicting source bytes.

The maintained PublishedStudyStore receives the complete companion, retains immutable version identity, registers source files and produces the ordinary selected reports and full-study ZIP. The same installed provider and native task queue handle all operations.

## Original temporal and same-station flow context

The maintained temporal explorer joins this same study when its complete application source is installed through `microbial_temporal_observed_report.sources.json`. The normal installer retains that manifest, the full original analytical edition, the maintained explorer and its three original inputs. The primary 730-record study remains available in applications carrying the earlier original-data edition.

Open the temporal explorer from the study's source reports. Its original station, method and calendar coverage, comment sensitivity, sampling intervals and same-station USGS flow interpretation remain the author's complete analysis. The calendar panel includes the retained common-month comparisons and their exact original-row memberships. It distinguishes the full observed-date summary from the same-station, same-method calendar comparison; these are separate sampling supports. Study filters continue to select the primary original observation rows; the related temporal report retains its own clearly identified full-source scope.

The complete exported study preserves the original application layout below `application-context/microbial/`. That includes all original relative paths used by `reproduce.mjs`, the unchanged original report recipe and the original analysis/source manifests. The complete ZIP can be reopened through the same Published studies importer.

A separate derived observed-report recipe prefixes the original source-view paths for this retained study. It records the unchanged original recipe hash, the source manifest and every path mapping. The native source collection exposes that recipe to the existing scientific delivery picker, where it can be selected with other observed reports in the desired order. Original recipe text, analytical values, source CSV/JSON bodies, source figures and original interpretation remain retained alongside it.

Selected exports include the complete HTML/report companion tree, so original links and downloads resolve together. The original report document and the derived native recipe each retain all required source companions.
