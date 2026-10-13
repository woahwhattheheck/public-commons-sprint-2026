# Research operator and receiving guide

## 1. Select the source and its scope

Start in Source tables → Sources. Record the original publisher, URL, publication and retrieval dates, edition, applicability period, coverage and reuse terms. A notice copy has its own publication date; it does not replace the original notice's date. Keep conflicting original values in the source record with an explanatory note.

The complete intake contract in sources/ describes current first-party datasets and exact identifiers. An original document or downloaded data release remains the authority for the entered observation. Enter a semicolon-separated source_ids list on each source-derived record. Register the source first so each join resolves.

## 2. Enter the linked research records

Use Providers for the legal or registered provider and its UKPRN. Use Sites for a separately evidenced delivery location, with location_basis identifying whether it is an actual delivery location, administrative address or another explicit basis. A provider address alone must not populate an actual-delivery-site claim.

Use Qualifications for the exact authority and identifier. Keep terminal letters such as X and leading zeroes as text. Use Qualification versions for effective dates, the original status and actual version. A standard and an individual option within it retain their separate identity in the offering. A course offering also needs its provider, observed status, period, delivery mode and original source.

Funding rows bind a specific provider, qualification, qualification version or offering. Preserve scheme, funding year, original eligibility dates and currency/unit. An eligible qualification does not establish that every provider currently delivers it or that an individual learner qualifies for funding.

The New record form exposes every field. Save record retains the complete next CSV source edition. Existing record IDs stay fixed. To import many rows, download the full CSV, preserve the exact header contract, edit it in your ordinary data workflow and choose Import source edition. The original file and earlier mapped outputs remain in Source history. Imported rows must have unique IDs and complete explicit text fields. Sources are bounded by the maintained table engine's limits; large national releases should be reduced through a documented source-native selection before entry.

## Original dataset intake

The application also receives an explicitly mapped original UTF-8 CSV through **Receive source dataset**. Choose its mapping JSON, then use the enabled Choose dataset file button to select the actual original file. Each picker retains the workspace revision and table that opened it; changing that selection requires choosing again. A mapping names the exact source headers, key columns, equality/one-of row filters, target field map, literal constants, source identifier and target ID prefix. Existing record joins can use an explicit recordIds map keyed by the complete ordered original key tuple. An imported ID cannot silently create a second record with the same qualification authority/identifier or UKPRN.

The source-intake receipt retains the complete selected input file, configuration, original record and line origins, exact mapped rows, original source-register review and target-table edition. Each derived row carries origin_intake_id. Receiving requires that receipt even after a later record edit; a historical mapped row cannot lose its original file. A manual change clears the current row's derived-origin identity, while the original receipt and its historical rows remain intact. A directly imported CSV must not retain an old origin identity after changing that row's material values. The mapping re-runs during receiving and must reproduce every selected output row. Following imports update their explicit record IDs and preserve earlier source receipts; a row absent from a following selection is not automatically marked as ended.

For measure mappings, declare exact statusTokens, numericStatus and roundingBase. Thousands separators can be removed only when explicitly declared for the source format; the original token remains unchanged. The complete mapping contracts and source examples are in the sources/ directory. The included documented-identity selection demonstrates the mapper using the actual source catalogue; it contains no learner outcomes.

The CLI equivalent is:

```sh
node cli.mjs intake --project /absolute/project.json --mapping /absolute/mapping.json --csv /absolute/original-selection.csv --out /absolute/new-project.json
```

## 3. Record values without changing their meaning

Every measure includes metric, population, cohort, period, geography, unit, denominator basis, release basis, suppression basis, geography basis, coverage start/end, nonpartition dimension basis and original_token. Record the source-defined value_status. exact, rounded and zero require the actual published numeric string. suppressed, not_available, not_applicable and not_collected leave exact_value empty. Rounded values retain the stated positive decimal rounding_base, including a quantum such as 0.1 for a rate published to one decimal place. A literal empty source cell remains an empty original_token when the explicit source mapping defines it as unavailable or uncollected. Unrounded values use blank or zero rounding base.

A suppressed small value is not zero. A missing value is not a suppressed count unless the source says so. A true published zero remains zero. Preserve apparent metadata conflicts in source notes and use the full source contract to choose a documented interpretation.

The current research application groups only identical metric/population/cohort/period/geography/unit/denominator/rounding definitions. Adding several records additionally requires one explicit aggregation_group and distinct partition_key values that the analyst has established as nonoverlapping. These declarations must come from the source and research method; distinct keys alone cannot establish that people are distinct. A suppressed observation makes that selected group unaggregated. A sum of rounded published values stays labelled as rounded published values. Several rates, percentages or other nonadditive units remain separate; a single published rate retains its own value and denominator basis.

The application does not divide certificate counts by unrelated starts, infer a completion rate across different cohorts, or extrapolate a selected source subset to a national total. Use the issuer's actual published rate as a separately defined observation if required; preserve its denominator and methodology. The lead researcher owns any additional statistical method and written interpretation.

## 4. Establish source coverage

Coverage records identify the source population, period, geography, grain, inclusions, exclusions, missingness and completeness. Record the actual assessor and assessment date. The analysis lists coverage limits. An absent provider, qualification or location in a partial source means not observed in that source; it is not automatically a geographic or occupational provision gap.

## 5. Review actual heritage content and mappings

In Research reviews, choose the actual target record, topic, decision, reviewer and rationale. The saved review binds the entire selected target and relevant linked sources, provider, site and qualification material. The review remains in history after an edit. If that material changes, Overview and the next analysis mark the old decision needs_review. Record a new actual review to establish the updated decision.

Research reviews and saved runs are append-only. The portable receiver compares all retained historical IDs and rejects a current project that omits or rewrites one. It also validates each historical decision's original source material before showing it.

## 6. Save an analysis

Choose an analysis label, named analyst and actual as-of date. Select the exact measure IDs. With no measures selected, an analysis still provides the actual provision/source baseline and coverage worklist. Recorded offering dates yield future, ended, within-recorded-dates or undated status; they do not independently prove current delivery.

Save complete analysis retains every selected data table, original source/mapping identity, complete ordered research-review roster, definition, result and hashes. Source history remains editable through following editions, while the saved result stays attached to its original inputs. Receiving recomputes the result against those original inputs. Download its complete HTML report or immutable JSON record.

## 7. Working edits, multiple tabs and recovery

The active form is authoritative for a working-copy download, including undoing a change back to its original values. The browser retains working edits separately by record. Ordinary navigation keeps those drafts until their matching save or explicit discard. Navigation stores the current edit before leaving. Receiving shows retained edits, and Download working copy includes the visible form and complete project.

Every project save compares the browser's current revision with the revision opened by this tab. If another tab saved first, the stale write is rejected and the retained edit remains downloadable. Reopen the saved project and review the change against the current record. A recovered edit cannot silently replace a different current source record. Browser-storage failure is shown while the editor remains available for a working-copy download.

A project with the same original identity but different received content opens as a separate local receiving branch. It does not overwrite the current local project. The original project ID, history and source hashes stay unchanged.

## 8. Complete receiving

Download complete work from the source application. Transfer the whole ZIP to the receiving operator. Extract its index.html and open it. In Receiving, import the ZIP or project.json; check the project identity and saved analyses, open the complete report, inspect an original CSV and download the received project. This operation validates every member hash, original mapping and historical analysis before adoption.

The application ZIP contains the complete editable program and work. Source history includes original CSV bytes and mapped outputs in project.json; data/ gives the selected raw tables; runs/ gives the complete saved JSON and readable HTML reports. manifest.json binds every member. The archive receiver accepts this application's original stored UTF-8 ZIP format; for other archive tools, extract and receive the original project JSON.
