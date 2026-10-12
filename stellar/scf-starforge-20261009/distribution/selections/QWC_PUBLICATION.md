# QGIS and QWC publication customer package

Operate a saved native QGIS map through an existing QWC installation, retain
the complete publication and its host history, and give another operator a
portable project that reopens with its original data. The selected package
contains the original STAC customer receiver, QGIS workspace and plugin,
QWC publisher, independent native acceptance operator, browser, CLI,
Applications provider and complete customer journey.

The map viewer is the selected existing QWC installation. The private
publication console reviews the source, native project, generated
configuration and host changes; it also performs refresh, scoped restore,
whole export, independent receiving and a deliberate native reopen.

## Complete package and original identities

The maintained source selection is `qwc-publication`. It uses the existing
distribution builder, source manifest and runtime installer. Each selected
source member keeps its original repository path, Git blob, complete SHA-256,
byte count and mode. The recipe itself is part of the immutable build input.

This package includes the complete original `stac/qgis`, `stac/qwc` and
`stac/qwc-acceptance` directories, the STAC receiving and native buyer
dependencies, installed Applications and native runtime configuration, and
the original source-owned STAC merchant/client entrypoints. The acceptance
engine `stac/qwc-acceptance/qwc_acceptance.py` is an explicit runtime file:
the original native customer journey imports that real collector and receiver.

Publication source was integrated in public PR2051 /2557764925b3580605a8bbb304d7f816aae4dcdc.
Its original saved-project/vector source is QGIS PR1955, and the complete
independent native acceptance is PR1991. A later installed edition uses its
actual complete manifest/source commit, including this recipe and its
explicit runtime declaration. Preserve the actual package manifest with the
workspace and customer handover.

## Prepare one selected source archive

Use the existing complete Git checkout or maintained Git-object receiver for
the repository supplying this package. Select a full commit containing this
recipe and all of its original source, then run the maintained builder:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/complete-merchant-source \
  --ref ACTUAL_FULL_SOURCE_COMMIT \
  --selection qwc-publication \
  --out /absolute/private/qwc-release
~~~

The builder returns the actual source archive, byte count and SHA-256. Keep
its distribution.json, source inventory, original package/manifest.json and
archive together. The complete source files travel through the builder's
original static-import and declared browser-asset checks.

For an interrupted build, use the same output, original commit and selection:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/complete-merchant-source \
  --ref ACTUAL_FULL_SOURCE_COMMIT \
  --selection qwc-publication \
  --out /absolute/private/qwc-release --resume
~~~

The original build state owns the selected source. Use the original completed
archive when the completion record is already present. An intentional source
upgrade gets a new output directory so the current package and workspaces
retain their identities.

## Install and receive the original runtime

Use Node.js 22.16 or later, Python 3.11 or later, Git and util-linux flock on
the receiving Linux host. Keep the source archive and all private customer
workspaces outside each other. The original host profile selects the actual
QGIS Python and ConfigGenerator Python; those existing GIS services and their
software remain part of the selected deployment.

In a new installation directory, install the actual completed source archive:

~~~sh
npm install --ignore-scripts --offline --omit=optional \
  /absolute/downloads/ACTUAL_QWC_SOURCE_ARCHIVE.tgz

npx --no-install starforge runtime-install prepare \
  --dir /absolute/private/runtimes/qwc \
  --archive /absolute/downloads/ACTUAL_QWC_SOURCE_ARCHIVE.tgz \
  --sha256 ACTUAL_COMPLETE_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

npx --no-install starforge runtime-install install \
  --dir /absolute/private/runtimes/qwc

npx --no-install starforge runtime-install inspect \
  --dir /absolute/private/runtimes/qwc --load --source
~~~

When the original selected dependency closure is already present in an existing
npm cache, use the install command's `--offline --cache /absolute/existing/cache`
options. The installer records its exact dependency profile and lock; READY
comes from its original source/runtime receiving, with the actual source root
and executable paths.

Native x402/Stellar and the schema/OpenAPI/MCP peers support the included
original acquisition and operator chain. Existing QGIS, QGIS Server,
ConfigGenerator, ConfigDB and QWC are selected explicitly in the customer host
profile. The source package does not replace that installation.

Run the installed command through the selected runtime:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/runtimes/qwc -- stac-qwc --help

npx --no-install starforge runtime-install run \
  --dir /absolute/private/runtimes/qwc -- registrations --command stac-qwc

npx --no-install starforge runtime-install run \
  --dir /absolute/private/runtimes/qwc -- stac-qgis --help
~~~

The first two preserve the original QWC command entry and selected package
registration. The QGIS command operates the original analyst workspace and
portable native project source.

The examples below use `starforge` as the installed entrypoint. Through a
selected runtime, place those same arguments after
`runtime-install run --dir /absolute/private/runtimes/qwc --`.

## Editable customer inputs

The original source contains these complete input examples:

| Original source file under stac/qwc/examples | Use |
| --- | --- |
| host-profile.json | Select the existing tenant, theme, input/viewer/generated/resource roots, original native executable paths and actual service routes. |
| original-publication-request.json | Select the first original saved QGIS workspace/revision/project and its real role and print choices. |
| refreshed-publication-request.json | Select the actual refreshed saved map with the same customer operation and a distinct request ID. |
| native-receiving.json | Join both requests, their exact native review profiles, the original host and existing browser executable into one customer journey. |

These files are editable input templates. Copy them into the private customer
directory, set the actual displayed project revision and ID, and keep the same
operation ID and actor across both requests and the native customer config.
The examples' zero revision and selected-project placeholders are replaced
by the actual original GIS workspace values.

For a portable source, first receive the complete original STAC/vector/GIS
handover through its original reader. Inspect the saved map through
`stac-qwc inspect-gis`. Native publication uses that complete original
workspace, rather than a path to a detached QGZ whose layers are elsewhere.

Use private environment-variable names for the host database settings and
existing role request headers. The profile records those names; the actual
credentials stay in the original operator environment. The QWC installation's
existing administrator maintains its real users, groups, roles and resource
grants.

## Installation, browser and handover sequence

1. Receive the full source package through the original runtime installer and
   keep its READY/source tuple. Initialize the private QWC workspace with the
   actual existing host profile.
2. In Applications, choose **QWC publications**, select that initialized
   workspace and the existing operator Python, then Review, Save, Start and
   Open. The binding checks the original workspace, full installed QGIS/QWC
   source, native executable identities and ConfigGenerator source.
3. Select one saved native map. Prepare the edition and read the complete
   review, original layers, native names and actual host change plan.
4. Use the existing QWC administration workflow for its selected service and
   roles. Publish the reviewed original edition and retain the actual native
   generator and host results.
5. Capture the real role/map/feature/print responses while that edition is
   deployed. Publish and capture the actual saved refresh as a second edition.
6. Restore the selected original host change plan. Keep its original before
   images and the same edition/tenant ownership.
7. Export the complete source/configuration/history handover. Receive it into
   a separate private directory, verify all original members and deliberately
   reopen the relocated map through actual QGIS.
8. Open the received publication as its own console. A fresh Verify or Reopen
   starts a new retained inspection invocation; Resume keeps the original
   returned job input and invocation.
9. Stop the same console or managed application. Its private connection and
   workspace/native leases remain present through the original child and HTTP
   drain. Continue later with the same saved workspace and original bindings.

The complete commands, exact input fields and operational decisions follow.

## Native publication and operating workflow

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

## Complete customer journey and original outputs

The original native journey joins the complete publisher, the original saved
QGIS editions, the independent QWC acceptance operator, and the portable
recipient. It calls the maintained product interfaces throughout and keeps one
customer operation and one original native job lifetime.

The selected host supplies its existing QGIS Python, QGIS Server, QWC
ConfigGenerator and ConfigDB, original viewer and service routes, and original
role sessions. The journey publishes two actual saved map editions, captures
each while deployed, restores the first edition, and operates both receiving
applications over those exact results.

## Original source and runtime selection

Keep these complete source directories from the same published source cut:

- stac/qwc/: native publisher, host/source model, console, CLI, this guide and
  the two native journey files.
- stac/qgis/: the original QGIS workspace, archive receiver, native project
  reader, plugin and selected vector adapters.
- stac/qwc-acceptance/: original publication-plan adapter, actual service
  collector, browser operator, native capture/finish driver and complete static
  files.

The original base distribution includes the entire sf30-seller-sdk component.
The stac-qwc contribution adds its installed command, Applications entry and
exact browser asset map. Keep the published distribution manifest with an
installed package; the native receiving input also records the full files and
SHA-256 values of all three directories.

The joined original interfaces are:

| Source owner | Exact interface used |
| --- | --- |
| Original QGIS workspace | QgisWorkspace.export_package, receive_package and original native map verification |
| QWC publisher | QwcWorkspace.create, prepare, publish, inspect and rollback |
| Original ConfigGenerator | Actual ConfigGenerator.write_configs and write_permissions under the retained host input/environment |
| Independent acceptance operator | native_journey.py capture for each deployed edition; native_journey.py finish for the complete operator and portable receiving |
| Original publisher browser | Native console, retained jobs, streaming export/download/upload, original receiving and actual QGIS reopen |
| Portable publisher receiver | Original whole archive preflight, original GIS receive, exact native project read and a new received-console instance |

The independent acceptance source was integrated at
PR1991 / 1648a78c73649532ca3be33c5ba1c4dedef6cc61. Its complete native driver is
92aaaeb95fdb88ee37a24634995fde2bc0154a1b and its operating guide is
e6223c8e03848a1921a71aaadf091cf6e97cb154. The producer consumes the complete
saved-project/vector source from QGIS PR1955 /
07f4140edbd01ceb32b01507995db11d6f0d514b. Later source selections must carry
their full compatible original directories together.

Use an actual existing operator Python 3.11 or later, native QGIS Python,
native ConfigGenerator Python and software, Node 22.16 or later, and the
existing Playwright module and Chromium executable. The browser helper imports
that selected Playwright module directly. It installs no browser or dependency.

## Select the original saved GIS editions and host

Prepare the actual original and refreshed QGIS projects through the original
QGIS application. Each publication request selects its complete saved workspace,
the exact currently displayed revision, and an original retained project ID.

Both requests use the same customer operationId and actor, and distinct
requestId values. The second request selects the actual saved GIS refresh.
Original workspaces can be separately received copies of those full original
editions. Keep their real source history and native paths.

The native host profile follows README.md and
PUBLICATION_CONTRACT.md. Select the existing input, viewer, generated tenant
configuration and QGIS resource directories; original ConfigGenerator src
directory and working directory; the actual Python executables; exact theme
JSON pointer; and actual viewer/OWS URLs.

The native ConfigGenerator source root contains
config_generator/config_generator.py. Its source configuration must select
.qgz projects. The original ConfigDB remains authoritative for users, groups,
roles and publication permissions. Configure the selected new map resource
through that host's existing QWC administration workflow. Retain its actual
permissions_default_allow value in the host profile.

The publisher prepares stable native WMS names from the original layer IDs.
The original profile and actual saved project/layout selection determine the
service requests; GetProjectSettings supplies the native layout and ComposerMap
names. The complete acceptance profile describes the real selected extent,
CRS, image size, query pixel, fields and print layout for each edition.

Keep any existing role headers in their selected private environment variables.
Publication and review files carry those environment names and the original
nonsecret principal references. The native collector resolves those exact
existing sessions when a selected request needs transport.

## Create the complete journey config

Create one private UTF-8 config with absolute paths:

~~~json
{
  "schema": "starforge.stac-qwc-publication-native-journey.v1",
  "operationId": "SOURCEPOLE-STAC-QWC-CUSTOMER-DELIVERY-20261012",
  "actor": "THE_ORIGINAL_SELECTED_OPERATOR",
  "title": "Sourcepole native QWC publication and receiving",
  "directory": "/absolute/private/original-qwc-customer",
  "workspace": "/absolute/private/original-qwc-publisher",
  "profile": "/absolute/private/original-qwc-host-profile.json",
  "editions": [
    {
      "id": "original-edition",
      "request": "/absolute/private/original-publication-request.json",
      "reviewProfile": "/absolute/private/original-native-review-profile.json"
    },
    {
      "id": "refreshed-edition",
      "request": "/absolute/private/refreshed-publication-request.json",
      "reviewProfile": "/absolute/private/refreshed-native-review-profile.json"
    }
  ],
  "browser": {
    "node": "/absolute/existing/node",
    "playwrightModule": "/absolute/existing/playwright/index.mjs",
    "chrome": "/absolute/existing/chrome-headless-shell"
  },
  "browserTimeoutSeconds": 900,
  "maxArchiveBytes": 17179869184,
  "maxDeliveryBytes": 51539607552
}
~~~

These are selection placeholders. Use the exact original host, source and
runtime paths before the first admitted execution. The archive values are
upper input allowances; the native job declaration must account for the
selected actual data volumes and working copies.

The two review profiles use the original
starforge.stac-qwc-review-profile.v1 schema in
../qwc-acceptance/OPERATIONS.md. Each has a distinct run_id and selects:

- GetCapabilities and GetProjectSettings for the selected native map,
  publication keyword, layers, CRS and layouts.
- GetMap with its actual layer names, CRS and wire-order extent, native size
  and image format.
- GetFeatureInfo with the actual queryable layer selection and query pixel.
  Through the QWC OGC proxy, LAYERS equals QUERY_LAYERS and INFO_FORMAT is
  text/xml.
- GetPrint with the actual native ComposerTemplate and ComposerMap extent
  fields and application/pdf output.
- The agreed role-specific permitted/denied layers and visible/protected
  feature fields.

The original acceptance adapter adds the exact publication keyword and
role-selected expected native layer names to its metadata checks. A complete
native workflow requires actual successful capabilities, a visible map and a
native PDF among the retained responses. Its review results remain attached to
the original bytes and selected roles.

## Run the one original complete operation

~~~sh
/absolute/existing/operator-python -B \
  /absolute/published-source/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/qwc/native-journey.py \
  --config /absolute/private/original-qwc-customer-config.json
~~~

Run that full command through the selected host's existing native job
controller. Declare the whole source, publisher and receiving output roots,
complete memory and disk/inode allowance, retained artifacts, and actual
process lifetime. Retain its original job record and foreground identity.

The script takes the original customer kernel flock. Native QGIS,
ConfigGenerator, reload, acceptance and browser children inherit that same
lease. The publisher's native worker also retains its original console and
workspace/host leases. The collector and browser phases run serially; the
existing host services keep their own original owners.

The command carries these phases end to end:

1. Retain the literal original config, complete host/request/review inputs,
   source inventory and actual executable identities.
2. Receive the original GIS archive, reopen the map through native QGIS,
   prepare the full publication review, generate native QWC output, publish
   its exact host files/pointer and perform the selected reload.
3. Call the independent original capture driver while that exact publication
   is selected. Retain every native response and publication/profile binding.
4. Repeat the original publication and native capture for the actual saved
   GIS refresh.
5. Restore the refreshed publication through its original host-file plan and
   reload, returning the host pointer to the first retained edition.
6. Run the original acceptance finish operation over the two retained
   captures. This operates its actual browser, map/PDF/feature comparison,
   original response import and independent portable receiving.
7. Open the publisher console. Inspect both exact editions and actual restored
   state, verify the files, export and download the complete refreshed
   publication, stream it back through the receiving UI, and reopen the
   relocated native project with QGIS.
8. Close that console and open the same complete receiving as a separate
   received-console instance. Verify its original archive identity and files,
   deliberately run a new native QGIS reopen, and inspect the responsive UI.
9. Export the complete first publication, freeze the final native member
   manifest, and publish the complete customer delivery ZIP.

The browser controller permits only the original local operator origin.
Existing viewer and OGC service work occurs through the publisher/acceptance
host routes selected in the original input. Both browser phases use the
existing Chromium executable.

## Resume after an observed interruption

Reconcile the actual original native job/foreground and its child state through
the existing host controller, then continue the same complete command, directory,
config and source. A missing tool response by itself is not a process exit.

The controlling config is retained before its dependent files. Resume reads
those exact copied host/request/review inputs, including when the external
delivery has moved. The complete source and selected executable identities
remain bound to that native operation.

Each publication, native capture, restoration, export and browser/receiving
stage retains its original IDs and results. Completed native captures are read
from the original acceptance journal without requesting another live service
edition. The script advances to the refresh only after the first native capture
is retained.

A new deliberate browser Verify or Reopen has a fresh inspection invocation.
The native reader retains that invocation under the received directory.
Continue same operation and an explicit CLI --invocation-id reuse its original
input and process/result record.

A failed browser or input/result write enters the same owned cleanup path.
The console connection stays present while native and HTTP work drains.
Repeated SIGINT/SIGTERM keep the same first cancellation and wait for the
owned children; the original native controller retains final process custody.

The final native report and delivery member manifest are retained before ZIP
publication. If the complete ZIP exists after a lost final receipt, the same
driver checks every original member and restores the receipt. Reopening a
completed delivery verifies its full archive identity.

## Complete original outputs

| Artifact | Complete content |
| --- | --- |
| QWC_First_Publication.zip | Original first GIS/project/source, QWC output, host selection and publication/deployment history |
| QWC_Refreshed_Publication.zip | Original refreshed source/project, complete generated files, exact host restoration history and portable receiving source |
| QWC_Complete_Native_Receiving.zip | Both original acceptance handovers, native service response/report and its actual browser/portable receiving artifacts |
| native-report.json | The exact two publication identities, captures, restore, both publication/received browser outcomes and complete export records |
| native-input.json | Original config/input/source/executable selection and declared receiving allowances |
| QWC_Complete_Customer_Delivery.zip | All three full handovers, native input/report, original selected profile/request/capture inputs, stage receipts and actual browser images |
| complete-delivery.json | Final complete customer archive path, size, SHA-256, manifest identity and original operation/workspace IDs |

The complete customer delivery is intended for the selected receiving operator.
It carries the original GIS and native service configuration source needed for
commissioning, maintenance and another-host receiving. The public product
source remains the maintained generic publisher, console and native driver.
