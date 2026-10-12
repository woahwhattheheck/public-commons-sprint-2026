# Native QGIS → QWC publication operator

This component receives one saved map from the maintained StarForge QGIS
workspace and publishes the complete native project through an existing QWC
installation. It keeps the original source edition, native map, configuration,
host before-images and deployment history together. Operators can continue an
interrupted action, restore the previous deployment, export the complete
handover and reopen the received map with actual QGIS.

The browser provides saved editions, native source preparation, publication
review, complete receiving and the selected host. It uses the same Python
methods as the installed command. The existing QWC application remains the map
viewer.

## Start the original operator

Use an existing Python 3.11 or newer for the operator. The host profile selects
the original QGIS Python for native maps and the original ConfigGenerator Python
for native configuration.

~~~sh
starforge stac-qwc --python /absolute/operator/python \
  --workspace /private/customer/qwc-operator init \
  --profile /private/customer/qwc-host.json

starforge stac-qwc --python /absolute/operator/python \
  --workspace /private/customer/qwc-operator serve \
  --connection-file /private/customer/qwc-console.connection
~~~

The installed entrypoint uses the merchant runtime's Node 22.16 or newer. Its
default operator lookup is `python3`; `--python` or `STARFORGE_QWC_PYTHON` selects
an explicit existing executable. The source entry is:

~~~sh
python3 -B stellar/scf-starforge-20261009/sf30-seller-sdk/stac/qwc/cli.py \
  --workspace /private/customer/qwc-operator serve
~~~

Open the private loopback link printed by the running command. API actions use
that original process capability and local origin. The server has eight HTTP
request slots and one native worker. The workspace, tenant and project leases
stay with native children through cancellation and actual process close.

In **Applications**, choose **QWC publications**, select the initialized
workspace and existing operator Python, review, save and start. The provider
checks the complete installed publisher/QGIS source, original workspace marker,
selected native executables and ConfigGenerator source. It checks the actual
`/api/launch` response before returning the live console link.

## Select the existing host

Create the profile from the installation's real paths and effective settings.
Its directories and Python executables must already exist. The original
publisher workspace is a private directory outside the host and software trees.

This is an **input example**. Replace the paths, URLs, selected native theme,
effective permission default and version with the actual installation.

~~~json
{
  "schema": "starforge.stac-qwc-host.v1",
  "id": "customer-qwc",
  "tenant": "default",
  "themeId": "customer-map",
  "mapPrefix": "starforge/customer-map",
  "inputRoot": "/srv/qwc/config-in",
  "viewerRoot": "/srv/qwc/viewer",
  "qgisResourcesRoot": "/srv/qwc/qgis-resources",
  "generatedConfigRoot": "/srv/qwc/config",
  "generatorSource": "/opt/qwc-config-generator/src",
  "generatorCwd": "/opt/qwc-config-generator",
  "tenantConfig": "default/tenantConfig.json",
  "themeInput": "default/themesConfig.json",
  "themePointer": "/themes/items/-",
  "permissionsDefaultAllow": false,
  "qgisPython": "/usr/bin/python3",
  "generatorPython": "/opt/qwc-config-generator/.venv/bin/python",
  "qgisServerBaseUrl": "http://127.0.0.1:9090/ows/",
  "wmsBaseUrl": "https://customer.example/ows/",
  "viewerUrl": "https://customer.example/",
  "qwcVersion": "ACTUAL_INSTALLED_VERSION",
  "environmentNames": ["PGSERVICEFILE"]
}
~~~

| Selection | Native meaning |
|---|---|
| `generatorSource` | The original ConfigGenerator **src directory**, containing `config_generator/config_generator.py`. |
| `generatorCwd` | The existing working directory for native configuration references. |
| `tenantConfig`, `themeInput` | Existing files relative to `inputRoot`. Their complete trees are retained. |
| `themePointer` | An RFC 6901 pointer to the existing theme; a final `/-` inserts into the original array. Existing themes must have the selected `themeId`. |
| `mapPrefix` | Owned namespace under the original resource root. Its native service is `mapPrefix/current/project`. |
| `permissionsDefaultAllow` | Actual effective original boolean, checked against the native generator and its output. |
| `qgisServerBaseUrl` | Native OWS route used by ConfigGenerator to read real capabilities/project metadata. |
| `wmsBaseUrl` | Corresponding selected external route. Its path prefix matches the native route. |
| `viewerUrl` | Existing QWC viewer, selecting the original theme with its native `t` query parameter. |
| `environmentNames` | Names of existing environment variables required by the selected host. |
| `reloadCommand` | Optional literal argument array for the installation's existing reload executable. |

The native QGIS Server must serve `.qgz`, including the actual
`QGIS_PROJECT_SUFFIX=qgz` setting where that deployment uses it. ConfigGenerator
must select `qgis_project_extension: ".qgz"`, the original resources root and the
matching OWS route.

The original ConfigDB supplies users, groups, roles and resource grants.
**Prepare edition** exposes stable native layer names. Before publishing a new
service, use the installation's original QWC Admin/ConfigDB workflow to assign
that service and its selected native layers to the intended existing roles.
When replacing an existing theme, preserve its restrictions through that same
administration workflow.

The publisher invokes the original permission generator and retains its exact
output. It changes no ConfigDB user, group or role rows. Deployment rollback
restores its recorded files and project pointer; separately administered ConfigDB
changes stay with the installation's existing administrator.

Layer names are `sf_` followed by the first 24 SHA-256 hex characters of the
original layer ID. The native project preserves original layer/source custom
properties and adds `starforge-publication:PUBLICATION_ID` to its WMS keywords.
The independent acceptance operator binds actual served responses to that
edition.

Keep selected templates, theme documents, viewer configuration and index files
within the declared original input/viewer trees. The entire viewer is copied
into a private candidate for native generation. The original runtime's
`CONFIG_PATH`, `OUTPUT_CONFIG_PATH` and `INPUT_CONFIG_PATH` select that candidate
and output. Existing database and service settings stay in the original inputs
and environment.

## Prepare one saved native map

In **Prepare edition**, enter the original QGIS workspace and select one
explicit saved map. Each map retains its own layer list and source identities,
including when the workspace contains other later layers.

~~~sh
starforge stac-qwc --python /absolute/operator/python inspect-gis \
  --directory /private/customer/original-qgis
~~~

The request below illustrates the input shape. Use the actual displayed
revision, original saved project ID and prepared native names.

~~~json
{
  "schema": "starforge.stac-qwc-request.v1",
  "operationId": "customer-map-delivery",
  "requestId": "edition-20261012-original",
  "actor": "Customer GIS operator",
  "qgis": {
    "directory": "/private/customer/original-qgis",
    "revision": 7,
    "projectId": "project-original-native-save"
  },
  "theme": {"title": "Customer map"},
  "print": {
    "mode": "map-page",
    "name": "Customer map",
    "paper": "A4",
    "orientation": "landscape"
  },
  "roleViews": [
    {
      "id": "customer-editor",
      "role": "editor",
      "headersEnvironment": "CUSTOMER_EDITOR_HEADERS",
      "expectedLayerNames": ["sf_ACTUAL_NATIVE_LAYER_NAME"]
    }
  ]
}
~~~

A role view names its existing role and the environment variable containing its
private JSON request headers. Header values are never part of the request or
publication. An anonymous view can omit `headersEnvironment`. A view expecting
no visible layers uses an empty `expectedLayerNames` list.

The `theme` object merges explicit native options into the selected existing
theme. Its identity and route stay bound to the original host. Print can select
an existing named layout or create one native A4/A3 map page. Omitting `print`
preserves the selected map's saved layouts.

~~~sh
starforge stac-qwc --python /absolute/operator/python \
  --workspace /private/customer/qwc-operator prepare \
  --request /private/customer/edition-original.json

starforge stac-qwc --python /absolute/operator/python \
  --workspace /private/customer/qwc-operator review \
  --request-id edition-20261012-original
~~~

Preparation retains the exact source snapshot, selected project, original
software and host file before-images. It calls the original
`QgisWorkspace.export_package` and `receive_package`, reopens the actual QGIS
map, writes its native publication projection, then calls the original project
verifier. The resulting complete review has an exact SHA-256.

Review shows source revision, native layers and layouts, role views, original
host files, prior/next project, effective permission default, native generation
and selected reload.

## Publish and continue

Choose **Generate and publish reviewed edition**, or use its exact review SHA:

~~~sh
starforge stac-qwc --python /absolute/operator/python \
  --workspace /private/customer/qwc-operator publish \
  --request-id edition-20261012-original \
  --review-sha256 ACTUAL_REVIEW_SHA256
~~~

The release contains the native `project.qgz` and its intact `gis/` directory.
Relative source and style paths resolve in the selected host release and after
portable receiving.

Publishing selects that complete release and calls the original
`ConfigGenerator.write_configs()` and `write_permissions()`. Both must return
actual success. Original generated files are retained before selected host
postimages and the existing reload are applied.

Permissions stay byte-exact. The sole generated configuration derivation is
`mapViewerConfig.json` at `/config/qwc2_path`: private candidate viewer to the
selected original viewer root. Both exact files/hashes and the derivation stay
with the publication.

File contents, intended mode and service group are present on the inode before
it becomes visible. New target directories receive their selected host mode and
group before publication. The full original native owner drains before its
leases release.

On interruption, reopen the **same** workspace, request and original inputs.
**Continue same operation** reuses the console's retained input; the CLI uses the
same command and IDs. Completed native generation is verified and reused.
Existing release and host files reconcile against their original before/after
images. A changed target returns its affected path for actual host
reconciliation.

`publication.json` is immutable and binds source/project, native theme,
layers/layouts, service routes, selected QWC version, permission default,
generated files and complete original source. `deployment.json` records the
actual published or restored state separately.

The maintained `../qwc-acceptance/` operator consumes the raw publication SHA and
original manifest bytes. It retains actual capabilities, map, feature-info and
print responses for the selected role views. Native service acceptance joins
the publication's complete handover.


### Fresh inspection and same-invocation recovery

Each deliberate **Verify retained publication**, **Verify every received file**
or **Reopen with native QGIS** request receives a new invocation ID. A new
verification reads the selected files again; a new native reopen starts the
actual selected QGIS reader again. **Continue same operation** keeps the original
invocation ID and reuses its completed native outcome after interruption.

The receiving CLI prints its invocation before starting QGIS. To resume it,
retain that ID:

~~~sh
starforge stac-qwc --python /absolute/operator/python \
  --received /private/recipient/qwc-publication \
  --qgis-python /absolute/recipient/qgis-python reopen \
  --invocation-id THE_ORIGINAL_PRINTED_INVOCATION_ID
~~~

Omitting --invocation-id requests a fresh reopen. Its original input, native
process record and result remain together under
native-reopenings/INVOCATION_ID/. The native result includes invocationId.

API callers can send invocationId with verify, verify-received and reopen.
Retain the full action body before sending it and reuse that body for recovery.
An omitted invocation ID creates a fresh inspection request. Publication,
restore and export continue to use their existing request/publication/export
identities.

## Refresh and restore

Select the refreshed original QGIS map/revision under a new request ID. Stable
original layer IDs retain their native WMS names. Every edition keeps its own
source, map, native output and host before-images.

~~~sh
starforge stac-qwc --python /absolute/operator/python \
  --workspace /private/customer/qwc-operator rollback \
  --request-id edition-20261012-refresh \
  --publication-sha256 ACTUAL_REFRESH_PUBLICATION_SHA256
~~~

The original plan restores its selected host files and prior project pointer,
then invokes the selected reload. If a later publication owns the pointer,
restore that later edition first. Reentry returns the same original restoration
receipt.

Original release directories and source remain available. The viewer link opens
the host's **currently selected** theme; a historical receipt records what that
edition published.

## Full export and independent receiving

**Prepare complete archive** freezes the selected source and deployment-history
snapshot. Download streams its ZIP to the browser download system; upload sends
the original File as the HTTP body. Neither creates an archive-sized JavaScript
copy.

The private archive includes original publication, QGIS source/package and
intact received project, native QGZ, host inputs, original/derived generated
configuration, selected publisher/QGIS/ConfigGenerator source, operator profile
and deployment history. It is intended for the chosen receiving operator.

~~~sh
starforge stac-qwc --python /absolute/operator/python \
  --workspace /private/customer/qwc-operator export \
  --request-id edition-20261012-original \
  --export-id original-handover \
  --out /private/customer/delivery/original-qwc.zip

starforge stac-qwc --python /absolute/operator/python receive \
  --archive /private/customer/delivery/original-qwc.zip \
  --sha256 ACTUAL_EXPORTED_ARCHIVE_SHA256 \
  --out /private/recipient/qwc-publication

starforge stac-qwc --python /absolute/operator/python \
  --received /private/recipient/qwc-publication inspect-received

starforge stac-qwc --python /absolute/operator/python \
  --received /private/recipient/qwc-publication \
  --qgis-python /absolute/recipient/qgis-python reopen

starforge stac-qwc --python /absolute/operator/python \
  --received /private/recipient/qwc-publication \
  --qgis-python /absolute/recipient/qgis-python serve \
  --connection-file /private/recipient/qwc-console.connection
~~~

Receiving preflights the complete ZIP inventory and original publication,
streams every member with its exact byte count/SHA-256, and calls the original
QGIS receiver on the nested archive. Same-archive reentry verifies every
retained member.

Native reopen uses the actual recipient QGIS Python and original verifier. It
checks relocated source paths, project identity, selected native layers,
layouts and original publication. QGIS closes before the successful result is
published.

An existing export ID reopens its original snapshot. Use a new export ID to
capture later restore/history changes. The default complete archive allowance
is 16 GiB; `serve` and `receive` accept `--max-archive-bytes` for the selected
whole-job capacity. Archive entry count, normal paths/file type, metadata sizes
and each decoded member are also checked.

## Status, cancellation and Stop

Polling returns compact job metadata. Full results and file inventories are
opened explicitly; native files are paged in groups of 50.

**Cancel operation** requests cancellation and waits for original native
cleanup. **Stop console** drains the same native worker and HTTP transfers,
closes the listener, then removes the original connection file. Repeated
SIGINT/SIGTERM remain handled throughout cleanup.

~~~sh
starforge stac-qwc --python /absolute/operator/python \
  --workspace /private/customer/qwc-operator status \
  --connection-file /private/customer/qwc-console.connection

starforge stac-qwc --python /absolute/operator/python \
  --workspace /private/customer/qwc-operator stop \
  --connection-file /private/customer/qwc-console.connection
~~~

Direct commands retain cancellation exit codes 130/143. An incomplete native
operation returns its actual code/message and retained native stderr path. The
same operation remains available for correction and continuation.

## Source and interfaces

- [Publication interchange](PUBLICATION_CONTRACT.md)
- [Full native receiving](NATIVE_RECEIVING.md)
- [Original QGIS product](../qgis/README.md)
- [QWC Quick Start](https://docs.qwc.app/master/QuickStart/)
- [QWC configuration and permission documentation](https://docs.qwc.app/master/)
- [Original ConfigGenerator API](https://github.com/qwc-services/qwc-config-generator/blob/01721f84b4f5478fd4c0283ba7f14b646ed24adb/src/config_generator/config_generator.py)
- [QGIS Server](https://docs.qgis.org/3.40/en/docs/server_manual/)

The selected QGIS/vector source join is original PR1955,
`07f4140edbd01ceb32b01507995db11d6f0d514b`, following PR1909. The publisher uses
its original package, workspace, saved-project and native verification APIs.
