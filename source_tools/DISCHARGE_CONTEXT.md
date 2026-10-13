# Original thirteen-gauge discharge in the existing Workspace

This receiver uses A74F's complete 2020–2025 source packet and the original Upper Savannah 217-feature WBD domain. It adds a complete source collection and three dated views to the existing Observed water quality desk: original daily discharge, means of observed daily discharge by calendar year, and numeric-day calendar coverage. It uses the same Workspace source/observation API as the maintained v3 observed-context intake.

## Original data and completed source reproduction

Original source is Slack Canvas F0C8JQJ943V, operation A74F-USGS-DISCHARGE-20261013:
https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8JQJ943V

Its fourteen full files materialize into source/hydrology-huc05-07-20261013/. The complete source-bank JSON is 3,611,890 bytes, SHA256 0e0c01a96ac57361238578f786e1952f0a5a1fbd9ec395ce7bf53d83b3be8db0. The receiver pins every original/derived member's length and SHA256, including the source manifest, source processor, README and all eight original government responses.

The original derive-discharge.mjs was executed against all eight retained source bodies in this continuation. It reproduced daily-discharge.csv, station-year-coverage.csv and station-year-coverage.json byte for byte against the publisher's packet:

| Quantity | Actual retained source |
|---|---:|
| Selected original daily-mean series | 13 |
| Daily source rows | 26,242 |
| Numeric daily values | 26,241 |
| Estimated numeric values | 654 |
| Provisional source rows | 14 |
| Station/calendar-year support rows | 78 |

The original USGS02196690 / TS_ID126845 record on 2024-09-24 contains reported_value=Rat and qualifier=P; source line2549 in original/usgs-huc05-07-daily-discharge-2024.tsv. That row remains visible with its original text and flag. It contributes no numeric value. Thirteen other provisional rows are numeric.

The companion 2023 acquisition is already merged at PR2968 / c993f601e618bd3331a01cad2c739e4c3bae7348 under source/calibration-coverage/20261013. Its differently timed original responses retain their own hashes. This receiver uses the complete six-year A74F edition as one cohort; it does not mix original response editions.

## Receive on the existing scientific application

The existing application supplies model.common, Workspace, the maintained nlcd_wcs original-domain reader and its original Esri polygon helper. Use its GIS interpreter with pyproj and Shapely. The current observed-context v3 ingest and dated plot are the existing source/import_observed_context.py / observed_series.mjs component, not a new desk. A73C's coherent source-bank Git blob is 7bc0ff5820df474aa71ea9a385ea560f2755fe18; the current complete component is also retained at:
https://chatgpt.com/space/page_7708ce8eb1a08191a3b46177383e4746

From the actual application root:

    python -B -m source_tools.receive_discharge_context \
      --source-root source/hydrology-huc05-07-20261013 \
      --domain /actual/original/model-domain.esri.json.gz \
      --scope selected49 \
      --output /actual/scientific-workspace/discharge-context-huc05-07 \
      --workspace /actual/scientific-workspace

The original domain archive is also accepted. Its unique model-domain.esri.json.gz member is retained and checked against A74F's source manifest; the decoded original body must be the exact 11,220,042-byte cohort whose SHA256 is 2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af. The receiving code binds the actual supplied archive/file hash separately.

Without --workspace, the command finishes the ordinary model-sources.json collection and selection first. That complete prepared source can enter A73C's existing regional receiver through --context-manifest /actual/output/model-sources.json. Running the same command with --workspace also creates the three dated observation editions and records their actual IDs in workspace-import.json.

Repeat the same command after an interrupted step. Retained input/output bytes must agree; original acquisition is never repeated. Each source entry retains its main file once: the original coverage CSV is the coverage entry's body and remains a companion of the other entries. If an earlier prepared manifest repeated that body as its own companion, the receiver preserves that exact prior manifest under preparation-history/ and migrates only this known duplicate-body shape. The migrated history travels with the report source and working archive. An existing output directory is bound to its original source and domain selection. Choose a distinct output directory for another scope.

## Geographic selection

The default selected49 scope applies the exact 49 original HUC12 identities in A74F's domain_context.selected_parent_huc12s. The model217 scope selects station points inside any of the complete 217 original polygons. all-candidates retains all thirteen original source candidates as the observation selection.

The actual original Esri domain declares WKID102100 / latestWKID3857. The receiver uses the existing nlcd_wcs._domain_geometry and source.capture_upstream_network.esri_polygon implementation to preserve original rings/holes and object IDs, projecting them into EPSG5070. Every original station's declared NAD83 coordinates are independently transformed from EPSG4269 with always_xy and no ballpark transformation. Original coordinate text, datum, transformation description and declared accuracy accompany the result. If a future explicitly supplied source declares NAD27 or WGS84, its matching source CRS is used instead.

Point membership uses the exact unbuffered polygons and covers semantics; all memberships at a shared boundary remain visible. station-membership.csv records full-domain and selected-parent memberships separately. Original HUC8 labels are retained beside these computed HUC12 matches.

Station-point membership is different from a gauge's contributing catchment. A74F owns the original NLDI feature/basin continuation for these same gauges. Its independently retained COMID/reach/measure and full basin geometries can join using site_no; the receiver does not manufacture catchment IDs from point HUC12 membership. The source operation and basin continuation remain linked in selection.json.

If no candidate points meet the selected footprint, the ordinary source collection still imports with all original candidates and the empty selection explained. No empty observation edition is created. The all-candidates scope remains available as explicit broader hydrologic context.

## Quantities and support

Daily values retain reported cubic feet per second, source TS_ID, date, exact qualifier, original response pathname and original line. The displayed numeric field is parsed from the unchanged reported text. Missing dates remain absent and the maintained daily plot breaks across gaps.

Calendar-year summaries retain every original station/year, including years with no observations, then apply the same selected-station footprint. Annual means are the means of available numeric daily values. A complete annual flow claim requires the explicit numeric-day count to equal the Gregorian calendar-day count; partial years remain partial.

The receiver adds two distinct water-volume columns:

- observed_numeric_days_volume_m3 sums only the quantified daily means × 0.028316846592 m³/ft³ × 86,400 seconds.
- complete_calendar_volume_m3 is populated only where every calendar day is quantified.

There is no extrapolation from observed days into absent days. Approved, estimated and provisional counts, original nonnumeric cells and exact missing-date ranges remain in the same annual rows. These are volumetric-discharge quantities. The existing annual NDR/SDR comparison continues to require independently derived pollutant loads with their own original catchment, period and estimation method.

## What the operator receives

The source collection contains the selected daily table, selected annual support/volume table, complete original 78-row coverage table, thirteen-station membership table and original station-point GeoJSON. Every entry retains the complete original fourteen-file packet and original domain/selection as companions.

workspace-import.json records the real project ID, source collection ID, three observation IDs, station selection, row counts and original manifest hash. All three observation editions use value_basis=context and the established v3 metadata fields. The complete source contains the excluded candidates as well as selected points, so another analyst can reproduce or change the footprint explicitly.

Open the existing Observed water quality desk and choose the new original daily-discharge edition. Select station and TS_ID group, then use date filters and the existing original-row CSV/SVG downloads. Open the calendar coverage edition alongside the annual means before comparing station years. The same source collection is available to Sources. After actual observation import, the receiver also builds the scientific report source described below; its source binding selects the content for the maintained report collector and working archive.

Primary source queries and methods are retained in source-manifest.json and the eight unchanged responses:
https://waterservices.usgs.gov/nwis/site/
https://waterservices.usgs.gov/nwis/dv/
https://waterservices.usgs.gov/docs/site-service/site-service-details/
https://waterservices.usgs.gov/docs/dv-service/


## Scientific report and working archive

With --workspace, the same operation creates a second ordinary source collection after the three observation editions exist. Its document uses the maintained upstate.observed-report/v1 recipe and OBSERVED_CONTEXT role. This sequencing records the actual source collection and observation IDs without creating a circular source identity.

The report includes the actual observation identities, selected station names and coordinate datum, full-domain and selected-parent HUC12 memberships, station/year numeric coverage and A/e/P counts, means/minima/maxima of the observed daily means, observed-days water volume, and complete-year volume where support is complete. Original nonnumeric source records have their own table. The human report uses six significant digits; the retained CSV keeps the full calculated values.

A/e/P are source flags and may overlap. The report never adds these columns as mutually exclusive groups. January-to-January periods remain exclusive at the upper bound. The selected 49-HUC footprint and the complete 217-feature model domain remain separately named throughout.

The report source retains all prepared original and derived members, including all fourteen A74F files, the unchanged original domain, selection, station geometries and selected daily/annual CSVs. observation-editions.json contains the actual imported observation IDs, original metadata, original table descriptors, row counts and a digest of each complete Workspace observation record. The complete observation records remain in the Workspace; their original row data also remains in the retained source CSVs. This avoids multiplying the large JSON row representation in each report companion.

workspace-import.json now contains scientific_report with the actual report source collection/source IDs, complete binding, retained member count/byte total and the paths to its ordinary source manifest and delivery-selection.json. Report editions live in the preparation's report-editions/<identity>/ directory. Repeating the same input resumes exact retained files and imports the same source identities. The prepared five-entry source manifest remains unchanged.

### Preserve the existing observed-water report

Pass the operator's existing delivery selection to the same command:

    python -B -m source_tools.receive_discharge_context \
      --source-root source/hydrology-huc05-07-20261013 \
      --domain /actual/original/model-domain.esri.json.gz \
      --scope selected49 \
      --output /actual/scientific-workspace/discharge-context-huc05-07 \
      --workspace /actual/scientific-workspace \
      --report-selection /actual/original-delivery-selection.json

The receiver verifies the original OBSERVED_CONTEXT document through the existing observed_context source reader. It carries its sections forward, copies every original member under existing-context/, and rebases the original figure specification, SVG references and source links to those retained paths. The unchanged original recipe itself travels as a companion. Discharge sections are appended, preserving the existing measured-water figures and tables. No shared renderer or delivery source is replaced.

The returned delivery-selection.json preserves every unrelated field of the supplied selection, replaces only source_roles.OBSERVED_CONTEXT with the composed document, and records the binding obtained from the actual imported source. Reusing that generated selection reconnects the same discharge composition instead of appending the identical discharge sections again. An explicitly different original observed-water source or discharge footprint produces its own report edition.

If no delivery selection is supplied, the returned JSON contains only the source role and its binding; it is a source-choice overlay for the existing operator's actual delivery selection. It does not invent model run, grid, study, receptor or publication IDs. With an existing full selection, use the returned full selection for the same native delivery operation.

### Select the report in the existing operator

In the existing complete map delivery form, choose the imported document in **Observed science context**. Its source entry carries the maintained metadata.report_schema tag used by that picker. The label names either the selected original daily-discharge report or the composed original observed-water context and discharge edition. Saving the delivery retains the same source collection/source IDs and the existing collector verifies its binding. The returned delivery-selection.json is also available to the native receiving command.

### Delivery and restore continuity

The maintained observed_context.collect verifies the complete document and companion hashes, copies them into the native delivery, rewrites report links and supplies the original sections and scientific figures to the current report formatter. The existing delivery builder adds every copied observed-context member to its saved file inventory before its ordinary portable.backup working-archive snapshot. This is the existing route through the scientific PDF/HTML, delivery source links and working archive.

Keep that delivery's original working/scientific-workspace.zip and its ordinary delivery file manifest together. Restoring through the existing portable/operator workflow reopens the original source collection and observation editions, while the retained delivery files preserve the exact report source members. The original CSVs, coordinate/domain selection and report recipe remain inspectable alongside the human report.
