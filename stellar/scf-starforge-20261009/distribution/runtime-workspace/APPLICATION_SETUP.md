# Application setup snapshots and receiving

The Applications console keeps unfinished setup in its existing tab draft editor.
Complete setup snapshots add named browser storage, portable source documents, and
comparison with newer saved application settings. They feed the same Review and
Save controls used by the original application.

Open the private runtime workspace and select **Applications**. Choose a saved
application and **Edit settings**, or create a new application from the existing
library. In **Configure application**, expand **Complete setup snapshots and
receiving**.

## Keep a complete setup

The existing editor automatically retains changed fields in this tab. Its
**Retained setup drafts in this tab** selector resumes each unfinished application
or tool variant, including fields from a tool temporarily absent from the catalog.
Its **Download current draft** command exports the selected variant in the
original retained draft format.

For a named setup that should remain available after the tab closes:

1. Enter a **Snapshot name**. A blank name uses the application name or tool title.
2. Select **Save complete setup in this browser**.
3. Select the snapshot under **Saved setups in this workspace** when it is needed
   again.

Each save creates a separate complete snapshot. It includes the selected fields,
all retained variants from this setup task, the opening saved revision for each
variant, original field descriptions, available runtime source identifiers, and
previous receiving and reconciliation history. Current empty selections, empty
text and unchecked values remain present in the original raw form records.

**Download complete current setup** exports this complete family directly from the
editor. It works independently of browser snapshot storage. **Download selected
setup** exports a saved or imported complete document without changing the active
editor.

Complete snapshots use this browser's IndexedDB, partitioned by workspace ID.
The tab editor continues to use its original session storage. Browser storage is
local to the current browser profile and origin; changing the private console
origin or clearing browser data can remove access to those copies. Download the
complete JSON file when moving work to another browser or host.

**Refresh saved setups** picks up complete snapshots written by another tab.
**Remove selected browser snapshot** removes the selected snapshot; it does not
discard the active tab draft or a downloaded setup file. IndexedDB version checks
protect the removal and storage of an existing snapshot from concurrent changes.

## Reopen in the original workspace

Select a saved snapshot, or choose its JSON file in **Import a complete setup or
retained draft JSON file**, then select **Reopen selected setup**.

The editor opens the selected variant with its original application ID and opening
revision. Other retained variants return to the original draft selector. A new
setup context keeps other drafts for the same saved application available.

If the application has changed since the snapshot opened, the draft keeps its
fields and displays the revision difference. Use **Compare saved changes**, keep
the complete draft through the existing explicit control, or load the current
saved settings. The original Review action uses the draft's selected revision.

A setup from a different workspace uses **Receive as new application**. The
workspace ID in the document identifies its source; it does not select or change
the currently opened workspace.

## Receive on another host

1. Transfer the complete JSON file to the receiving operator.
2. Open **Applications** in the receiving runtime workspace.
3. Select the file under **Import a complete setup or retained draft JSON file**.
4. Select **Receive as new application**.
5. Select a ready runtime on this host. Inspect host-specific directories,
   installation selections and connection settings in the retained form.
6. Use **Review application**, inspect the native configuration, and **Save**.

Receiving assigns a new setup context in the current workspace. It clears the
saved application binding and runtime selection for every retained variant.
The fields remain available for the receiving operator to configure, and the
source workspace, opening revisions, full original variant records and prior
history remain in the next complete document.

The importer also accepts the original **Download current draft** JSON format.
That file contains its one selected variant. A complete snapshot contains the
whole retained family.

Files are limited to 2 MiB of UTF-8 JSON. Parsing checks the document schema,
workspace and active draft relationship, duplicate variants, raw field shapes,
and agreement between the complete configuration and selected original form.
Setup files can contain operator paths and connection configuration entered in
the form; transfer them using the same private working channel as that setup.

When a source tool is absent on the receiving host, the original draft editor
keeps its fields and shows the retained selection. Install the intended source
catalog, or choose another available tool and continue its separate variant. The
native review reports requirements for the runtime and host paths actually
selected.

## Reconcile concurrent edits

Choose **Compare saved changes** when a saved application has a newer revision.
The comparison reads the current saved application from the original local API
and shows five columns: field, opening value, current saved value, draft value,
and the value to retain.

The comparison handles each field as follows:

| Opening value | Current saved value | This draft | Result |
| --- | --- | --- | --- |
| A | A | B | Keep the draft edit B |
| A | B | A | Keep the saved edit B |
| A | B | B | Keep the shared value B |
| A | B | C | Choose the saved value B or draft value C |

Display name, runtime and settings are compared individually when the application
type is unchanged. Port defaults and checkbox values use their declared field
semantics, so equivalent saved and form representations do not create a conflict.

If either operator changes the application type, its type and complete settings
are compared together. This keeps one tool's fields from being combined with
another tool's configuration. If the selected type already has a retained draft
in this setup, the reconciled family opens in a separate context. The earlier
variant remains available in the draft selector with **Before reconciliation**,
and its full raw source remains in the complete setup history.

An older retained draft that lacks complete
opening settings requires an explicit choice for that group while the known
display name and runtime can still be reconciled individually.

Select a value for every conflicting field, then choose **Apply reconciled fields
to this draft**. The application is read again before applying the comparison.
If its revision changed again, the screen presents the new comparison and clears
the previous choices. If the active draft changed, compare its current fields
again.

Applying the comparison moves the retained draft to the current saved revision
and carries the selected values into the existing form. The complete setup history
retains the previous baseline and selected source for each field. Use the original
**Review application** and **Save** to save those settings. Those controls retain
their existing request IDs, save tickets and interrupted-request recovery.

## Headless receiving and operator handoff

The installed `starforge runtime-workspace` command uses the same complete setup
codec as the browser. Installation and fleet operators can receive the exported
JSON directly, select their host bindings, inspect the original application
review and save its exact request. Each operation keeps its full source document,
all retained variants and its result in a private directory.

Use the current source CLI instead of `starforge runtime-workspace` when working
from a checkout:

```sh
node stellar/scf-starforge-20261009/distribution/runtime-workspace/cli.mjs --help
```

### Inspect or export a complete setup

Inspect a browser export, a received complete document or an original one-variant
retained draft:

```sh
starforge runtime-workspace application-setup-inspect \
  --document /srv/starforge/handoffs/merchant-setup.json
```

The result includes the complete document and a summary of every retained variant,
its opening application revision and its field names. Inspection works without
opening a runtime workspace.

An operator can also export an application's actual saved settings:

```sh
starforge runtime-workspace applications \
  --workspace /srv/starforge/runtime-workspace

starforge runtime-workspace application-setup-export \
  --workspace /srv/starforge/runtime-workspace \
  --application-id SAVED_APPLICATION_ID \
  --output /srv/starforge/handoffs/merchant-setup.json \
  --name 'Merchant receiving setup'
```

Replace `SAVED_APPLICATION_ID` with the ID returned by the first command. The
output's parent directory must already exist as a private directory owned by the
operator; for example, create it with `mkdir -m 700 /srv/starforge/handoffs`.
Choose a new output filename for each snapshot. This export captures the saved
application and its opening revision. Export from the browser editor when the
handoff should include that browser's unfinished edits and retained variants.

### Receive on a new host

Read the receiving workspace's actual ready runtime IDs:

```sh
starforge runtime-workspace status \
  --workspace /srv/starforge/runtime-workspace
```

Create a private UTF-8 JSON bindings file using the receiving runtime's ID. This
example shows the binding shape; replace the placeholder with the actual ID:

```json
{
  "runtimeId": "READY_RUNTIME_ID",
  "label": "Received merchant"
}
```

The accepted keys are `runtimeId`, `label` and `settings`. Omitting `settings`
retains the selected variant's fields. If host paths or connections must change,
provide the complete intended settings object under `settings`; it replaces
that variant's settings as a group. Values use native application types, including
JSON booleans for checkbox fields. The native review checks the actual provider,
runtime, directories and selected configuration.

Prepare a new receiving operation:

```sh
starforge runtime-workspace application-setup-prepare \
  --workspace /srv/starforge/runtime-workspace \
  --operation /srv/starforge/handoffs/receive-merchant \
  --document /srv/starforge/handoffs/merchant-setup.json \
  --mode new \
  --bindings /srv/starforge/handoffs/receiving-bindings.json
```

The operation directory is created privately under an existing real parent.
`--mode new` clears the source application's ID and its original runtime
selection. Select a ready receiving runtime in the bindings file. The setup's
active variant is used by default; `--kind TYPE` selects another variant retained
in that same document. Inspection lists those type IDs.

Preparation retains the source and host choices together, then invokes the
original native application review. The returned `review` includes its normalized
settings, selected command, runtime and managed-home choice. Inspect this actual
review before saving:

```sh
starforge runtime-workspace application-setup-status \
  --operation /srv/starforge/handoffs/receive-merchant

starforge runtime-workspace application-setup-save \
  --workspace /srv/starforge/runtime-workspace \
  --operation /srv/starforge/handoffs/receive-merchant
```

Saving calls the original Applications writer with the retained review and request
ID. The saved application appears in the existing Applications console. Its result
contains the application ID, revision and original managed-connection outcome.
Use the existing application connection and start controls to operate it.

### Reopen the source application

Use `--mode reopen` in the source workspace to apply a setup to its original
saved application. It retains that application's ID and opening revision. A host
bindings file is optional when its retained runtime remains ready.

```sh
starforge runtime-workspace application-setup-prepare \
  --workspace /srv/starforge/runtime-workspace \
  --operation /srv/starforge/handoffs/reopen-merchant \
  --document /srv/starforge/handoffs/merchant-setup.json \
  --mode reopen
```

If another edit has changed the saved revision, import the complete document in
Applications, use **Compare saved changes**, choose the intended fields and
download the reconciled complete setup. Prepare that file in a new operation
directory. The headless path retains the same original revision check and native
review as the browser.

### Continue an interrupted operation

Each operation has one request UUID. `--request-id UUID` can supply an existing
automation's request ID at first preparation; otherwise the operation creates
one. The operation's workspace, mode, selected variant, source bytes, host
bindings and native request remain fixed after preparation.

Continue preparation using just the original workspace and operation directory:

```sh
starforge runtime-workspace application-setup-prepare \
  --workspace /srv/starforge/runtime-workspace \
  --operation /srv/starforge/handoffs/receive-merchant
```

Once the complete source and request are retained, this works even if the incoming
files have moved. Repeating preparation after review returns that original review.
Repeating `application-setup-save` continues the same request and returns its
retained outcome. A changed document, binding, mode or variant belongs in a new
operation directory.

The native Applications writer retains accepted save requests under the original
application lease. If a save completed before its operation directory received the
response, repeating the same save recovers the accepted result. If another save
has since changed the application, the recovered result identifies the original
revision with `replayed: true`, `superseded: true` and the current revision. The
current application remains on its newer settings.

A receiving operation has three phases:

| Phase | Available work |
| --- | --- |
| `DRAFT` | Complete source and host selection are retained; continue preparation to obtain the native review |
| `REVIEWED` | Inspect the retained native review and save its original request |
| `SAVED` | Read the accepted application result and continue in Applications |

The operation directory contains `operation.lock` and a `setup/` directory:

| File in `setup/` | Contents |
| --- | --- |
| `source-setup.json` | Exact incoming UTF-8 bytes, including all original variants and history |
| `complete-setup.json` | Complete normalized document accepted by the browser; a one-variant source is expanded once |
| `host-bindings.json` | Exact selected bindings file, or an empty JSON object when omitted |
| `operation.json` | Workspace binding, selection, original review/save request, phase and saved result |
| `review.json` | Full native review |
| `save-request.json` | Original native save request |
| `result.json` | Accepted save result |

The last three files are materialized after their native operation finishes.
Repeating prepare or save restores those files from the retained operation if a
process was interrupted while writing them. Initialization commits the complete
`setup/` directory before starting native review.

Retain the whole operation directory for an operator handoff. Status reads its
complete source and outcome without opening a workspace. A receiving operation
continues in its original workspace; to install on another host, prepare its
`complete-setup.json` as a new operation with that host's explicit bindings.

The same functions are available to local operator integrations:

```js
import { openRuntimeWorkspace }
  from '@tokenjunkielabs/starforge-merchant/runtime-workspace';
import { prepareApplicationSetup, saveApplicationSetup, applicationSetupStatus }
  from '@tokenjunkielabs/starforge-merchant/runtime-workspace/application-setup';

const workspace = await openRuntimeWorkspace({
  directory: '/srv/starforge/runtime-workspace',
});
const prepared = await prepareApplicationSetup(workspace, {
  operation: '/srv/starforge/handoffs/receive-merchant',
  document: '/srv/starforge/handoffs/merchant-setup.json',
  mode: 'new',
  bindings: '/srv/starforge/handoffs/receiving-bindings.json',
});
// Present prepared.review in the operator's existing review flow.
const saved = await saveApplicationSetup(workspace, {
  operation: prepared.operationDirectory,
});
const handoff = await applicationSetupStatus({
  operation: prepared.operationDirectory,
});
```

## Source layout

The implementation extends the existing Applications components:

| Path | Responsibility |
| --- | --- |
| `public/application-drafts.mjs` | Original tab draft editor, full opening application capture, family receiving and applying reconciled fields |
| `public/application-setup.mjs` | Complete JSON document, source history, field reconciliation and versioned browser snapshot storage |
| `public/application-setup-codec.mjs` | Shared complete-family validation, document creation and retained-draft import |
| `application-setup-operations.mjs` | Native operator export, receiving, retained requests and recovery |
| `cli.mjs` | Complete setup inspection, export, preparation, status and save commands |
| `applications-core.mjs` | Original native review/save writer and retained save-request outcomes |
| `public/application-setup-library.mjs` | Named snapshot, import, receiving and comparison controls inside the original editor |
| `public/applications.mjs` | Fresh saved-state read and opening the existing configuration form |
| `server.mjs` | Local serving of setup modules and their shared codec |

The existing Applications library supplies its catalog browsing, search, pins,
recents, selection and operations navigation. The native application writer,
runtime process lifecycle and source-specific settings review remain the original
product's implementations.
