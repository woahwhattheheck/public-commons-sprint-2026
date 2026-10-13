# Retained observation reports in Published studies

The installed Eighteenmile study includes the maintained full-study sampling report and its original observation and cohort companions. The same study store, immutable versions, Workspace source collections and complete-study exports carry these files.

## Open the report

1. Start the current complete operator and choose the intended Workspace.
2. Open **Published studies** and select **Import installed study**. This queues the normal study import. Existing older versions remain selectable.
3. Open the completed retained study. **Original sampling report** opens the original HTML, including its figures, observation filters, record inspection, CSV downloads and print controls.
4. **Sources and methods** exposes that report and every registered original file. **Download original HTML** returns the unchanged source bytes.
5. **Export complete study** retains the report, its generator, source manifests and both observation/cohort directories. Extract the archive and open `source/wqp_20261013/lake-observations-report.html` for the same report with its local source links.

The report presents its own complete cohorts. Its controls are independent of the station, parameter and continuous-series filters in the Published studies table view. The maintained report retains 88 original lake records and the separate 75-record chlorophyll study cohort, with their 45 shared chlorophyll records explicitly identified.

## Selected report package

**Export selected report** supplies `selected-study-report.zip` alongside the individual output files. Extract it and open `study-report.html`. Selected table CSVs keep the current table filters, while the original observation reports remain complete. Their declared companion groups are copied under `original-sources/` with their original relative paths and verified recorded bytes/hashes, so linked cohort files and source CSVs remain adjacent. The exporter includes every retained HTML report declared by the current study, including the paired-analysis report when installed.

## Source registration and exact companions

Installed import follows `eighteenmile_lake_observation_report.sources.json` alongside the maintained study manifests. Its six original source identities and 22 unique report/source files remain authoritative. The two original directories are `wqp_20261013/` and `cohort_reconciliation_20261013/`.

The original application-root report manifest is retained without rewriting its bytes. During Workspace registration, its `observations/eighteenmile_2023/` prefix is resolved into the retained study directory. Primary files and companions retain their original SHA256 and byte counts. Repeated source IDs merge compatible companion inventories; conflicting original bodies fail through the existing source checks. The report and original lake table each carry the complete declared companion group, so either Workspace source selector retains the cross-directory context.

Source registration edition `upstate.published-study-sources/v6` also registers HTML documents when an older complete bundle is imported again. Study record and complete-export schemas remain unchanged.

## Interactive transport and reopening

The existing authenticated extension file transport serves:

`/api/file/published-study/{workspace_key}/{collection_id}/{member_path...}`

The collection must belong to exactly one retained study version in that Workspace. Every requested member resolves through `PublishedStudyStore.source_file`, which accepts registered source inventory entries and asks the existing Workspace to verify their retained bodies. A report's relative source links keep the same collection and resolve sibling directories normally. The source bytes are served directly; the provider does not generate or rewrite the report.

The report runs with an opaque sandbox origin. Inline report scripts, CSV downloads and print work while operator API calls, external script loads and forms remain unavailable. The shared server and authentication flow are unchanged.

For a portable round trip, export the complete study, import that ZIP through **Import another source or reopen a study** in a receiving Workspace, and open the retained report there. Its new local collection URL resolves the same original relative member paths. Whole-Workspace backup/restore likewise retains the existing study records, sources and report.
