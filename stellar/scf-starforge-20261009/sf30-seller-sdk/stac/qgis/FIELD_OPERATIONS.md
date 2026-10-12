# Field collection and office receiving

This edition adds a **Field** tab to the original Starforge QGIS Receiving dock. It takes a saved native map through field commissioning, a complete QFieldSync cable export, actual device-file receiving, office review, native synchronization and the next collection round. The existing GIS workspace remains the project record: sources, saved maps, requests, revisions, event history and complete receiving archives use the original store.

The implementation invokes the installed QGIS and libqfieldsync engines. GeoPackage offline editing and its change log belong to QGIS; this plugin retains the selected source, field configuration, device export and office decision around those native operations.

## Install in the existing QGIS environment

Use QGIS **3.40 or later**, its Python environment, and the installed QFieldSync/libqfieldsync dependency. Install the complete Starforge plugin through the original package command:

~~~sh
python3 plugin-package.py --out /your/delivery/starforge-field.zip
~~~

In QGIS, open **Plugins → Manage and Install Plugins → Install from ZIP**, select that complete file, enable Starforge STAC Receiving and open its dock. The package contains the original source/vector workflow, the four field modules, all three operator guides and the license.

Open the original workspace or receive its complete original ZIP. Import a retained source and save a native map through **Saved maps and receiving** if a map has not already been saved. The field project begins with that actual saved map and its original source/layer bindings.

In **Field → Native runtime**, select:

| Setting | Meaning |
| --- | --- |
| QGIS Python or wrapper | The actual Python executable or configured wrapper supplied with the selected QGIS installation. |
| Wrapper arguments | Additional fixed arguments as a JSON array. Use an empty array for a direct Python executable. |
| QFieldSync folder | The installed QFieldSync or libqfieldsync directory; leave empty when that same Python environment already imports it. |
| QGIS prefix | The prefix used by the installed QGIS provider environment. The dialog starts with the current application's prefix. |

On Linux, use the system Python that imports the installed QGIS package. On Windows, use the configured QGIS/OSGeo4W Python environment. The first project inspection uses this selected runtime. Field operations run in one separate process with their own QGIS configuration directory, allowing the original QGIS map to remain open.

The wrapper receives only the original request-file path. Source titles, attributes, device names and office notes do not become shell commands. Python dependencies and native providers must come from the selected existing installation; this plugin does not install packages or start paid cloud jobs.

## Commission the real field project

Select a saved map and choose **Commission field project**. Native inspection reads its real layers, fields, feature counts and complete relation key pairs.

### Project instructions

Enter the field project title, collection instructions and attachment instructions. Record the agreed collection purpose, who may change the data, what attachments may contain, transfer method and office receiving responsibilities. These are project instructions. Application passwords, provider tokens and account recovery material belong in their existing credential stores.

### Layers and forms

Each original map layer has one field role:

| Role | Native behavior |
| --- | --- |
| Exclude | The layer is omitted from this field project. |
| Reference only | The retained local native data travels as a read-only reference. |
| Editable feature layer / table | A derived office GeoPackage carries the selected source records and commissioned field form. |

Use **Configure fields** on each editable layer or existing related inspection table. The form allows:

- Selecting the stable record identity.
- Enabling actual addition, deletion and geometry-editing permissions.
- Choosing which original or newly added attributes field operators may edit.
- Setting field labels, group order, required values and native widgets.
- Adding typed inspection fields without altering the retained source.
- Configuring text, multiline, choice, numeric range, date, file attachment and image widgets.
- Preserving inspectable read-only source attributes and original feature bindings.

A new text identity receives deterministic technical UUIDs for the existing source records and native UUID defaults for new field records. This does not create customer observations. It identifies the records already in the selected native source. If an existing identity is selected, it must be unique and nonempty. Existing identity values stay read-only.

The derived layer also retains an explicit read-only original provider feature ID, its original source ID, layer ID and source project digest. Native GeoPackage feature numbering may change during copying; this retained source field carries that original relationship.

Choose allowed values from the actual agreed field protocol. Choice values use visible labels and separately typed stored JSON scalar values. Numeric ranges use explicit minimum, maximum and step. New record addition requires a text identity that can receive a native UUID default.

Attachment and image fields use native External Resource widgets with relative storage under `attachments/`. The native QField naming settings produce distinct file names. Existing referenced source attachments are copied only from the original workspace's retained file inventory. Their original location and byte identity stay in the commissioning lineage.

### Devices

Add the actual named device profiles. Each has a label, operating system/device description and operator instructions. The first delivery may include two or more profiles, but a campaign has one open collection round at a time. Each export is assigned to one selected profile.

### Relations

Check the existing native parent/child relations needed by the field forms, or configure the actual relation keys. Both layers must be included. Composite native keys are preserved as their complete field-pair list. The original native Association or Composition strength is also preserved. Composition carries native child duplication/deletion behavior; configure the parent and child edit permissions consistently. New relations explicitly select that behavior. Related inspection tables use their selected source records and identifiers.

Confirm **Commission selected project**. The operation creates a complete first office edition with its own native project, working data, forms, attachments, source lineage and feature snapshot. The original imported sources and saved map remain in the same workspace.

## Export and collect

1. Select the commissioned field project and the next device profile.
2. Choose **Create next native export**. The original libqfieldsync `OfflineConverter` and `QgisCoreOffliner` create the native QField project and logging GeoPackage.
3. Select that round and choose **Copy package to device folder**. Select a new directory outside the retained office workspace.
4. Transfer the entire resulting directory to QField. Open its `field.qgz`, use the configured forms and save actual collection changes.
5. Close QField before copying the complete saved folder back. Include the offline data, project, original binding file, references and attachments.

The package binds workspace, campaign, round, device profile, office base edition and field configuration. An old completed export cannot be attached to a newer office edition after an interrupted save.

This cable workflow follows the upstream rule: synchronize an export back to its original office workflow **once**, then create a fresh export for the next collection round. Do not use the same package as a new round. QFieldCloud has its own project/account and delta/job lifecycle; an agreed Cloud integration must use the customer's selected existing account and project. The cable package does not impersonate that account or claim a Cloud synchronization.

The supported retained editable data uses local OGR-backed feature layers/related tables, and local OGR/GDAL references from the complete original workspace. A remote layer must first be received through the existing source/vector/PostGIS workflow. The field converter does not silently fetch a new remote dataset or expand the selected source scope.

## Receive and review the actual return

Choose **Receive saved device folder** for the matching open round. The UI inventories the complete folder and shows its file count and size before receiving. The original saved action binds that exact inventory. A changed folder requires a fresh reviewed selection.

Receiving retains the actual device files, then inspects them in an owned native copy:

- The original exported project provides the trusted provider and layer configuration.
- Only the declared native logging data is substituted from the actual returned folder.
- Returned project settings cannot redirect office writes to another database.
- Original references and export metadata must retain their byte identities.
- The real native records are compared with the exact office base edition.
- Attribute, addition, deletion, geometry, required-value, choice and range rules are checked.
- Attachment paths must remain relative to `attachments/`; the actual file bytes are retained.
- A replacement image or document at the same path is a visible attachment change.

Open **Review selected return**. Filter by native layer, change kind or **Problems**. Read pages of actual changes; open a row to compare office and returned attributes, inspect its complete geometry/source record, or open its retained attachment. The global summary includes added, changed and deleted records, attachment changes and edit/file problems.

A return with problems remains retained. Correct the actual device copy and receive it as another return for the same open export. Earlier returns are kept in the original history. The office operator explicitly chooses which ready return to accept.

Enter the office receiving decision and choose **Accept this return into office**. Acceptance binds the exact review digest and the still-current office base edition.

## Native office synchronization

Acceptance makes a fresh owned copy of the original office edition. It opens the trusted original export with the selected returned logging data, points the native remote layer URIs only to that new office copy and invokes the original `QgsOfflineEditing.synchronize(True)` once in that staged attempt.

The native engine's completion, warnings and actual offline state are observed. The resulting complete office feature snapshot must match the reviewed returned snapshot. Reviewed attachments are copied, the native import checksum is retained, and the full project is saved as a new office edition.

Only after that result is complete does the existing workspace transaction:

- Mark the original field round accepted.
- Retain the actual receiving note and analyst.
- Add the accepted native map to **Saved maps and receiving**.
- Advance the campaign's office edition.
- Retain the synchronized data, attachments, source bindings and native result.
- Commit the original request, new revision and history event.

Open **Open accepted office map** to receive that actual map in QGIS. The original `reopen_project` interface continues returning `(QgsProject, readback)`; field editions use its specific native delegate while normal saved maps keep their existing source verification.

Select the next device profile and create a **new** export for round two. This is the normal continued collection workflow. Closing an unused export requires a recorded reason; it keeps the original package and any returns while allowing the next fresh round.

## Recovery and simultaneous work

Field mutations use the original workspace's stable request IDs, SQLite transaction, revision and pending-action retention. **History and recovery → Resume pending action** continues that same selected action.

Each native action also has one request-bound operation directory:

~~~text
field/operations/REQUEST/
  input.json
  native.lock
  bridge/request.json
  bridge/response.json
  bridge/native-ATTEMPT.log
  product/field-bundle.json
  product/...
~~~

The native child inherits the operation lock on POSIX systems. A live operation cannot be started again under the same request. The parent observes its exit and closes its owned child before releasing custody.

If conversion or synchronization stops before completion, the interrupted stage is retained with its failure record. A retry begins another fresh owned stage from the same retained original input. It never replays a partially synchronized office copy. If the native product completed but the workspace transaction did not, the same request can adopt that completed product only when the selected source, round and office edition still match.

An unrelated workspace revision may advance during a completed native action. Rejoining uses the current workspace transaction and rechecks the action's exact source/round/base relationship. If another accepted round changed the office base, the old prepared export remains available but cannot be recorded as a new-edition export.

The current native field workflow keeps one logging GeoPackage per export and one open round per campaign. Split independent simultaneous field work into explicitly commissioned campaigns with separate selected office ownership; do not merge two sets of offline logs by copying files over one another.

After an actual interrupted attempt is inspected, its owned incomplete working directory may be retired to reclaim space. Keep the original source, completed `product`, saved request, selected return and accepted edition. Completed temporary analysis/synchronization copies are retired by their own operation after their native files have closed and the complete result has been read.

## Complete project handover and independent receiving

Use the existing **Export complete project** action. It includes:

- Every original source edition and companion file.
- Native maps and current/historical style resources.
- Field commissioning source/configuration, office editions and source lineage.
- Every retained export and return, including actual attachments.
- Accepted native office maps and synchronized data.
- The original state, event history, stable requests and all field file descriptors.
- The complete installed plugin, original operator guides and this guide.

Use the original **Receive archive** command on the receiving workstation. It verifies and copies the complete file set, then restores the same workspace identity, events and requests. Accepted field projects reopen from their received native files. The same field campaign can continue with a fresh export from its received current office edition.

Office/control logs may contain selected filesystem locations and operator-entered notes; the receiving archive's selected source and state are the operative handover. Credentials are not part of field profiles or project configuration.

## Existing CLI integration

The original Python CLI adds a single `field` entry:

~~~sh
PYTHONPATH=/path/to/installed/plugin-parent \
python3 -B -m starforge_stac.cli field \
  --workspace /path/to/original-workspace \
  --input /path/to/retained-field-action.json \
  --progress
~~~

Read operations use the same actual source and state:

| Action | Payload |
| --- | --- |
| `field.state` | Empty object; returns workspace ID, revision and campaigns. |
| `field.inventory` | `directory` for the complete saved device copy. |
| `field.copy` | `roundId`, new `destination` directory. |
| `field.review` | `roundId`, `returnId`, optional `offset`, `limit`, `layerId`, `kind`. |
| `field.inspect` | `projectId`; requires the selected native runtime. |
| `field.reopen` | Accepted field `projectId`; requires the selected native runtime. |

Mutations use `action`, `payload`, current `revision`, stable `requestId` and `actor`. The native actions also carry `nativeRuntime`:

~~~json
{
  "action": "field.export",
  "revision": 12,
  "requestId": "field-export-retained-round-2",
  "actor": "Actual office operator",
  "payload": {
    "campaignId": "THE_RETAINED_CAMPAIGN_ID",
    "profileId": "THE_SELECTED_DEVICE_PROFILE_ID"
  },
  "nativeRuntime": {
    "native_command": ["/path/to/qgis-python"],
    "qfieldsync_path": "/path/to/installed/QFieldSync",
    "prefix_path": "/path/to/qgis/prefix"
  }
}
~~~

The example identifiers are placeholders for the actual retained workspace records. Keep the original action file for retry. Changing its actor or selected payload creates a different input; do not reuse the old request ID.

`field.inventory` may resolve a path in the caller's working directory and returns its absolute `directory` with the saved inventory. Copy that exact absolute directory into `field.receive`; native receive rejects relative paths before freezing the worker request. The native child has its own workspace working directory, so this prevents the same action from selecting a different returned folder. The field UI already supplies the selected absolute directory. Retained workspace descendants, including paths through an ancestor alias, are not valid device-return or device-copy destinations.

| Mutation | Required payload |
| --- | --- |
| `field.commission` | `configuration`, following the schema below. |
| `field.export` | `campaignId`, `profileId`. |
| `field.receive` | `roundId`, saved `directory`, `expectedFilesSha256` from the original inventory. |
| `field.accept` | `roundId`, `returnId`, exact `reviewSha256`, actual receiving `note`. |
| `field.close` | `roundId`, actual closure `note`. |
| `field.note` | `campaignId`, project `note`. |

### Commissioning configuration

The UI writes schema `starforge.qfield.commissioning.v1`. It contains the selected `projectId`, title/instructions, profiles, editable layer rules, reference layer IDs and relation definitions.

Each editable layer retains its original `layerId`, `identityField`, `editableFields`, addition/deletion/geometry booleans, `formTitle` and ordered `fields`. Each form field specifies name, label, group, widget and required flag; new fields also specify `addType`. Choice widgets carry label/value pairs; ranges carry minimum, maximum and step.

Each relation retains its ID/name, explicit association/composition strength, original parent and child layer IDs and the complete `fieldPairs` array of `parentField`/`childField`. This preserves native composite keys without flattening them into unrelated one-key relations.

The canonical configuration is frozen for the commissioned campaign. A changed collection schema is a new explicit commissioning decision from the actual selected saved map. Existing collected rounds keep their original reviewed configuration.

## Maintained source interfaces

| Module | Responsibility |
| --- | --- |
| `field.py` | Original workspace mutations, exact selected inputs, retained native products, file closure, review paging and transfer. |
| `field_native.py` | Native source/form commissioning, QFieldSync conversion, actual return snapshots, native synchronization and accepted project reopening. |
| `field_bridge.py` | One original request-bound QGIS child, progress, exit and recovery. |
| `field_ui.py` | Full Qt field/operator workflow inside the existing receiving dock. |

The common joins are deliberately small: `project_files` includes retained field descriptors; `reopen_project` delegates field maps; the existing saved-action dispatcher routes `field.*`; the original CLI and packager include the complete field entry and source. Existing vector, source, project and receiving behavior remains the shared implementation.

## Primary native sources

The native implementation was composed from these original interfaces:

- [QFieldSync cable workflow](https://docs.qfield.org/get-started/tutorials/get-started-qfs/): complete export, native offline editing and once-per-export synchronization.
- [libqfieldsync OfflineConverter](https://github.com/opengisch/libqfieldsync/blob/aad2ea69b21b72209db1df5be54c25138a32048f/libqfieldsync/offline_converter.py).
- [libqfieldsync native offliner](https://github.com/opengisch/libqfieldsync/blob/aad2ea69b21b72209db1df5be54c25138a32048f/libqfieldsync/offliners.py).
- [QFieldSync synchronization dialog](https://github.com/opengisch/QFieldSync/blob/f0bfa24a31a59d18db86e7dd89de2e0bd44c5df4/qfieldsync/gui/synchronize_dialog.py).
- [QGIS 3.40 native offline engine](https://github.com/qgis/QGIS/blob/release-3_40/src/core/qgsofflineediting.cpp).
- [QGIS native relation Python interface](https://github.com/qgis/QGIS/blob/release-3_40/python/core/auto_generated/qgsrelation.sip.in).

Selected runtime versions are retained with each actual native result. QGIS, QField and QFieldSync/libqfieldsync retain their own licenses and original documentation; this source composes their public interfaces.
