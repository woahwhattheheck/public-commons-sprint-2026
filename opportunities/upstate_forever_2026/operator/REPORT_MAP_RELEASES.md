# Watershed report to map release

Open **Watershed reports**, select a saved report, and choose **Build map release**. The atlas desk receives the original reference, every alternative in its saved order, the report title, and the exact saved report edition.

Complete the original source-water and high-quality-water overlay choices, the responsible GIS metadata contact, and the map layout. Build the release through the existing task queue. Open the resulting atlas, individual maps, technical report and GIS package from the same retained release.

The saved watershed report shows its associated releases and their current state. **Open release** returns to the retained map products. The atlas can open the source watershed report through the same extension host. Reopening the project or restoring its working archive retains these links and the original project identity.

## Use a scientifically compatible report

A seven-map release uses an original baseline and one or more explicit land-cover alternatives, with completed native NDR and SDR outputs on one grid and one parameter profile.

The report panel identifies the particular case that needs attention when the saved report contains a reference alone, an unfinished native model, a parameter-sensitivity alternative, or a different grid. Keep the scientific comparison you already saved and create the appropriate report from the completed common-profile cases.

The builder preserves every selected alternative. Changing the reference or alternatives is an explicit independent release; remove the source-report link in the atlas before changing that cohort. A linked release records the original report SHA-256 before assigning its release identity.

## Original report products in the release

The normal release package includes a reports directory containing the source report JSON, its offline HTML, annual totals, comparison CSV, watershed GeoJSON and original decision record. The source-report.json file identifies the source edition, cases, grid, profile and watershed selections. These are the original saved products; opening or packaging them does not repeat the native calculation or watershed aggregation.

The standard delivery manifest lists these files with the other project assets. The normal workspace archive and receiving workflow carry the same source report and relationship.

## Integration contracts

- The scenario-reports extension exposes GET /api/scenario-reports/release?report_id=ID through the existing authenticated operator. Its response contains ready, selection, cases, issues, releases and source_report.
- The existing report response includes the same release context.
- The browser bridge invokes openExtension('map-atlas', 'create', {workspace_key, selection}) and openExtension('map-atlas', 'open', releaseId, {workspace_key}).
- The report controller exposes open(reportId, {workspace_key}) for the reverse link and retains the request through navigation into a previously unmounted desk. Navigation failures clear that request, and changing projects cancels it before the other workspace loads.
- model.report_release.bind_report(workspace, selection) checks the saved cohort before release identity is computed. The returned report_sha256 is retained as selection.source_report_sha256.
- model.report_release.retain_report(workspace, directory, state, binding) carries original products into the normal delivery file catalogue. Its source_report_ entries are included in the manifest project_assets.

Operation: UPSTATE-REPORT-ATLAS-7BF6-20261013.
