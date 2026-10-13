# Monitoring reports and complete source exports

The original Monitoring export desk offers three formats. Select the saved plan or current campaign revision and, when needed, its matching observed context.

| Format | Delivered file | Contents |
| --- | --- | --- |
| HTML report | monitoring-report.html | The original plan, schedule and field history report, with the exact selected observed context when supplied. |
| Review bundle | monitoring-field-package.zip | The report, network, plan, original geometry, calendar, selected sites, events, source bindings, campaign history, complete original source bodies and companions, and the original member manifest. |
| Editable workspace | monitoring-editable-workspace.zip | The maintained complete native Workspace archive, including intermediates, for independent restoration and continued work. |

## Report and bundle behavior

An HTML request validates the selected source edition and campaign revision, then renders the original report directly. It does not construct the bundle's GeoJSON, CSV files, campaign-history export, or source-export members. The task result's `files` count is one for this single-file download.

Review bundles retain the original `eco.monitoring.export/1` manifest, member names, sorted archive order and exact member bytes. Source files remain on disk and are streamed in 1 MiB chunks. Generated JSON, CSV and report metadata remains in memory. Every streamed source is checked against its retained byte count and SHA256, and its opened-file identity is checked before and after reading. A source change fails the export before the complete archive is published.

The original deterministic fieldwork handoff packet keeps its fixed timestamp and permissions. Review exports retain their existing ordinary ZIP timestamp and permissions. Both use the same checked, atomic archive writer; an interrupted unpublished archive is removed. Disk-capacity or read failures remain visible to the existing operator task.

Standalone observed-context export uses the same streaming source path and keeps `upstate.monitoring-context-export/v1`. Context inspection verifies the exact retained original body, companions, publisher manifest and saved network/plan/campaign identities. The complete original observation document is validated at intake; later inspection checks those exact bytes without parsing that document again. Existing `export_source` and `export_files` callers still receive their original bytes dictionaries.

The complete Workspace export continues through the maintained backup operation and its existing lock and output-location checks. It includes the original saved studies, sources and editable campaign.

## Receiving on an existing original campaign

Use the existing receiving Workspace and its saved campaign revision. From the application's Monitoring desk, export HTML, the review bundle, and any selected observed context. Open the HTML and confirm the selected revision, visits, events and context; compare its report bytes with `report.html` in the matching bundle.

For an already retained bundle of that same revision and context, compare ZIP member names and SHA256 of each uncompressed member with the new export. The manifest and member contents must match. The complete ZIP checksum can differ because review-export timestamps retain their original time-of-export meaning.

The equipped DD6B original course has already retained its original source packet and editable campaign. Continue that same course for this comparison, keeping its original sources and campaign revision. The separate native Gura computation is unaffected.

**For Tim:** Open the saved Monitoring campaign, choose HTML for the report or Bundle for the complete source package, and download the finished file.
