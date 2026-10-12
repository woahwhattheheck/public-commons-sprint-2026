# QWC publication and acceptance interchange

The publisher operates the original QGIS saved-map/portable receiver and QWC ConfigGenerator. The acceptance operator reads the completed publication and the actual selected service. Both retain the same original source edition.

## Immutable publication

The UTF-8 file is publication.json, schema starforge.stac-qwc-publication.v1. It is written only after the original native project and native configuration generation are complete. Its raw SHA-256 is the acceptance input binding. Publishing, rollback and acceptance produce their own retained results; they never rewrite this original manifest.

Fields:

- operationId and requestId: the retained commissioning/publication operation and edition request.
- publicationId: the SHA-256 of the normalized original request plus host profile and reviewed input/source inventories.
- qgis: workspaceId, revision, projectId, sourceIds, original package descriptor and native projectFile descriptor. The package is the original complete QGIS export, including sources, native maps/styles and history.
- theme: id, mapName, title, layers and layouts. Each layer retains layerId, nativeLayerId, wmsName, sourceId, kind, title, visible, opacity and CRS. The native WMS short name is sf_ plus the first24 hexadecimal SHA-256 characters of the original layerId. Native QGIS writes and reopens that property. Layout entries retain the actual native name and map items with id/CRS/extent/page measurements.
- service: viewerUrl with the selected native t query, wmsUrl and wmsVersion:"1.3.0". These are the selected existing public QWC routes.
- qwc: tenant, version, permissionsDefaultAllow, native generator source binding, native generated file descriptors, deployed file descriptors and any exact filesystem-path derivation.
- roleViews: selected original role-view requests, as described below.
- files: the complete original, native and generated file descriptors relative to the publication operation. Each descriptor has path, bytes and sha256.

The native project keeps a WMS service keyword starforge-publication:PUBLICATION_ID. The publisher adds it through QGIS's WMSKeywordList project entry, preserving other service keywords. A fresh original GetCapabilities response can bind the selected service to this publication without guessing from its URL or cache state.

## Deployment result

deployment.json belongs to the same publicationId and retains its input publication SHA, prior project pointer, every original changed-file preimage/postimage, completed native generation, reload command result and actual phase. PUBLISHED means that original file operation completed. ROLLED_BACK identifies its restored prior pointer and exact original config/viewer bytes. The acceptance operator independently records actual service responses and the operator decision.

A host's QGIS data and QWC services can cache project/configuration files. The selected host profile may name its existing reload command as a literal argv array. The publisher retains and invokes that command within the same operation. The acceptance reader fetches fresh capabilities and compares the actual publication keyword.

## Role request contract

roleViews is an array of objects:

~~~json
{
  "id": "existing-analyst-view",
  "headersEnvironment": "QWC_ANALYST_HEADERS",
  "expectedLayerNames": ["THE_ACTUAL_NATIVE_WMS_NAME"]
}
~~~

headersEnvironment is optional for an anonymous request. When present, it names a private environment value containing one JSON object of HTTP headers. The private header values are neither manifest fields nor portable source. Retain the customer's original authorization and cookies; the publisher creates no roles or user records.

expectedLayerNames are the agreed native names visible through that original role view. QWC ConfigDB and its native generated permissions remain the authority. The profile explicitly retains the existing effective permissions_default_allow boolean; no default is substituted.

The acceptance operator selects the exact original WMS request parameters, including CRS/BBOX axis order, dimensions, query layer/format, and native print layout/map items. Each retained response belongs to its original request, role view and publication SHA. An HTTP200 XML service exception remains an actual error response, and an authentication redirect is retained as that route outcome.

## Native source interfaces

The original QGIS source is stac/qgis/starforge_stac/model.py and qgis_project.py. QgisWorkspace.export_package, receive_package and reopen_project supply original acquisition/data/native history and source verification. The publication projection calls QGIS itself to rebase relative file paths, assign stable WMS short names and optionally add an explicitly selected native map-page layout.

The existing QWC source is qwc-services/qwc-config-generator. Its ConfigGenerator.write_configs and write_permissions methods return native success booleans. The original standalone CLI does not propagate those booleans as a failing process exit, so the small native adapter checks the methods directly and retains their returned configuration, source metadata and original role projection.

A native generator may write viewer assets while producing configuration. Generation uses a retained private viewer copy. Its original mapViewerConfig.json is kept byte-for-byte; a separate deployment copy changes only /config/qwc2_path from that retained staging directory to the selected original host viewer directory. Every other native generated file stays unchanged, including permissions.json.

## Original project ownership

The generic publisher is stac/qwc/. The complementary acceptance/change-review product is stac/qwc-acceptance/. C94 retains stac/qgis/ and its saved-project/source/desktop engine; the original vector source operator retains its complete GeoPackage/Shapefile materialization. A received project can carry either original source kind through the same native project interface.
