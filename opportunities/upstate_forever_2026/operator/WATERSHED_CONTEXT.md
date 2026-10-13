# Regional watershed context

The Regional watersheds desk brings the full watershed source edition into the existing Upper Savannah operator. It uses the original workspace, task queue, navigation, retained records, and verified download tickets.

## Operator workflow

1. Import the completed regional source edition through the source preparation bridge, or register its directory with the existing server's repeated --source-root option.
2. Open Regional watersheds after Receiving waters in the operator navigation.
3. Choose the retained source edition and select Build regional context. The operation appears in the original task history.
4. Search by watershed name or HUC12. Combine HUC8, state, NRCS priority, selected source class, and classification coverage filters.
5. Open Details for the original NRCS state rows, priority reasons, source class counts, source references, and any supplied downstream attribute.
6. Export the matching watersheds, one watershed, or download the complete saved regional report. Selection exports retain the full report identity and source-byte hashes.
7. Choose a Saved watershed selection to reopen its exact HUC12 membership and download the retained JSON, CSV, and selection manifest. The desk restores the last report, saved selection, filters, and watershed detail for this workspace during the browser session. Show all watersheds returns to the full regional report.

All source-defined watersheds remain available. The table renders the complete filtered set without a hidden row cap.

## Source interpretation

The completed source edition covers the 217-HUC model domain. The precise counts shown in the desk are read from the built report. The model retains the original NRCS state rows while counting each watershed's total area once. A state filter selects watersheds touching that state; its displayed area remains the whole-watershed area. The detail panel preserves the original state area values.

The selected-class SCDES query includes ORW, ONRW, TN, TPGT, and TPT. Query completion is shown only when the model binds the original query companion to the exact watershed domain. A complete query can return zero selected records for a watershed. The view retains the separate source jurisdiction and query coverage fields for watersheds outside South Carolina.

Classified-water reach counts use the agency's HUC12 attributes. Receiving-water geometric intersections, upstream contributing land, protection-area geometry, and designated-water calculations remain in their existing source-native modules. The default watershed role is model_domain. When the optional native-network.json companion is retained with the edition, the model uses its original ToHUC records and explicit reporting/upstream assignments; watershed details and selection exports carry those source-derived roles and downstream links.

## Install into the current application

The application must already have the shared extension host installed. From the complete source package:

    python operator/install_watershed_context.py \
      --application /path/to/current/application \
      --source-root /path/to/upstate_forever_2026

The installer adds its declared model, source bridge, provider, browser assets, manifest, and documentation. It reads and parses the complete prepared source before replacement, compares the current bytes at replacement boundaries, and saves the prior bytes for changed files. Repeating the same installation leaves matching files in place.

The registered source edition lives separately from installed extension manifests. For a directly registered edition, start the original server with --source-root pointing at the edition directory or its containing source tree. The source bridge's complete-sources.json supports original Workspace imports and reconstructed companion files after workspace transfer.

## Integration contract

The provider is watershed_context.WatershedContextActions(operator, fault, source_roots). The installed extension id and browser view id are watershed-context.

| Operation | Original transport | Result |
| --- | --- | --- |
| Discover sources and reports | GET or POST /api/watershed-context/catalog | Original workspace source choices, configured source choices, saved report summaries, and saved selection summaries |
| Build full regional context | watershed.context.analyze task | Saved regional report using source_tools.prepare_watershed_context.load_source_edition |
| Read report | GET or POST /api/watershed-context/report?report_id=ID | Complete model report, exact input hashes, and verified downloads |
| Read one watershed | GET or POST /api/watershed-context/huc?report_id=ID&huc12=HUC | Original per-watershed record and source references |
| Export selected watersheds | watershed.context.export task | Source-bound JSON and CSV selection in the original download transport |
| Read export | GET or POST /api/watershed-context/export?export_id=ID | Retained selection manifest and verified downloads |
| Original item alias | /api/item?kind=watershed-context&id=ID | Same saved report |
| Workspace state | data.watershed_context_reports | Saved report summaries |
| Browser factory | createWatershedContextDesk(host) | mount, update, detach, refresh, openWatershed |

The browser uses the shared host's api, getState, submitAction, refresh, toast, navigate, showTask, and fileList capabilities. Source selection uses registered directory identifiers and relative members, or original workspace collection/source identifiers. The provider resolves original workspace sources with Workspace.source_file and loads their reconstructed edition companions.

The source bridge verifies the complete domain membership response, the additional-HUC8 zero result, the original classified-water ID set, and the retained source manifests. The provider snapshots the exact source bytes beside the report. Report reads verify the retained model report hash. Exports contain exact selected rows, the parent report SHA256, the source fingerprint, source references, the domain query interpretation, and model methods.

## Retained paths

- watershed-context/REPORT_ID/operator-report.json: operator record and exact source manifest.
- watershed-context/REPORT_ID/watershed-context.json: complete source-derived regional report.
- watershed-context/REPORT_ID/source/: original edition file snapshots.
- watershed-context-exports/EXPORT_ID/export.json: selection identity and downloadable file descriptors.
- watershed-context-exports/EXPORT_ID/selected-watersheds.json and selected-watersheds.csv: selected source rows.

The standard portable application/workspace archive can carry these files with the rest of the original workspace.
