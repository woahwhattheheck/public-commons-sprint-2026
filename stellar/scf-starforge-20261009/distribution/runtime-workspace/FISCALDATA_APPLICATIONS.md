# Fiscal Data in managed Applications

Use the installed **Fiscal Data operations** application to reopen the original Treasury workspace with its named operator, complete source history, exact decimal editions, merchant preparation and customer delivery controls. The application uses the same model, browser and portable source packages as the Fiscal command and Merchant MCP tools.

The original application owns one workspace lease. Review, Save, Start, Open, Stop and retained reopen are handled by the existing Applications runtime. The native launch binds the selected source, saved private connection and original workspace identity; Open is offered only after the actual local listener returns the matching identity.

## Prepare the retained workspace

Use Node 22 or later and Linux with the original `flock` workspace lease. Select an installed source runtime containing the Fiscal command, managed launcher, named-operator adapter, browser assets and its original publisher dependencies. The source distribution retains the original SF82, SF88 and SF100 consumers.

Create private directories owned by the local operator. A new workspace can be initialized by the original command:

```sh
starforge fiscaldata state --dir /private/treasury
```

For a delivered workspace, use the original source package instead. Close any existing writer to the receiving directory, then receive the exact package through the retained operation:

```sh
starforge fiscaldata package-inspect --package /private/handover/workspace.fiscal.gz --sha256 PACKAGE_SHA256
starforge fiscaldata receive --dir /private/treasury --package /private/handover/workspace.fiscal.gz --sha256 PACKAGE_SHA256 --operation treasury-receive-01 --operator /private/operator.json
```

The private operator file contains `{"id":"the-actual-staff-id","label":"The actual staff name"}`. Keep the same operation ID and original package digest when continuing an interrupted receive. The receiving engine verifies every member, promotes the original workspace metadata last, and preserves completed immutable files. Unfinished source captures arrive paused. The complete workflow is documented in [Fiscal MCP and source receiving](../../../../stellar-forge/mcp-merchant-operator/FISCALDATA-WORKSPACE.md).

The source directory is mode 0700. Create a separate mode-0700 package/export directory outside all declared source workspaces. The private connection is a mode-0600 regular file. It uses the existing configuration schema:

```json
{
  "schema": "stellar-forge.fiscaldata-workspace-connection.v1",
  "operator": {
    "id": "the-actual-staff-id",
    "label": "The actual staff name"
  },
  "workspaces": {
    "treasury": {
      "label": "Treasury source operations",
      "directory": "/private/treasury",
      "imports": {},
      "merchants": {},
      "buyerWorkspaces": {},
      "runtime": {"port": 0},
      "limits": {}
    }
  }
}
```

Each alias points to one initialized original directory. Paths in the connection can be relative to that connection file and are resolved by the original configuration reader. Configured source imports retain their existing file and SHA-256. Merchant profiles retain their original public origin, path and payment terms; buyer references point to the existing private SF88 workspace. Add these through the existing host configuration described in the MCP guide. The Applications form selects the connection; payment credentials do not belong in its fields.

## Review, save and start

In the original runtime workspace, select the installed runtime and open **Applications → Fiscal Data operations**. Supply the private connection file, its declared workspace alias and the existing private package directory. Use port zero to choose an available local port, or an explicit free port. The common environment and terminal settings remain those of the original runtime. `terminalPython` selects its existing PTY carrier and defaults to `/usr/bin/python3`.

**Review** resolves the selected original source and records the following launch inputs:

| Binding | What is retained |
| --- | --- |
| Connection | Exact private configuration bytes and SHA-256 |
| Workspace | Original workspace ID, creation time, canonical directory and directory device/inode |
| Source | Exact selected managed/model/CLI/MCP/browser/dependency file identities |
| Export directory | Existing private directory identity outside source workspaces |
| Resource | The original Fiscal workspace directory, shared across application aliases |
| Runtime | The installed runtime, adopted source and original launch command |

Save that review, then Start the saved application. A modified configuration, replaced workspace, changed selected source or different executed source requires a new review. Normal source revisions, captures, field edits, editions, comparisons and exports remain writable in the same original directory; those changing record hashes are deliberately not launch identities.

The native process checks the expected workspace inside its original kernel lease before reconstruction or publication. It opens the existing named-operator MCP adapter and borrows that adapter's browser. The original runtime checks the emitted startup record against both selected and adopted source, then reads the actual loopback listener's authenticated identity before offering Open.

The application is served on `127.0.0.1`. Its existing Host/Origin rules, HttpOnly session cookie, mutation token and authenticated file downloads remain active. A startup record alone does not establish listener readiness. The listener's instance, operator, workspace and selected source must match the reviewed launch.

## Work in the original analyst surface

Open shows the complete Fiscal workflow. Source captures retain actual Treasury metadata and each original page. Review keeps dates, identifiers, null markers, field roles, units, scale and notes explicit. Native CSV and JSON contain the selected original values; financial arithmetic uses decimal strings.

The comparison view provides row changes, participating-row counts and exact first/last observations. Debt is a stock series: a sum over selected daily observations is labeled as a row sum, while the first-to-last change is shown separately. Query results and full downloadable archives use the original retained edition identities.

Every successful or failed browser mutation is recorded through the same named-operator action history as the MCP surface. Opening the managed application does not create a second capture worker or model. Retained captures remain idle on reopen until staff explicitly start or resume the original capture operation.

Merchant preparation keeps the complete original `sourceFiles` closure. Publication, seller releases, original buyer sessions and complete acquisition archives remain the existing native consumers. Configured payment actions use the original terminal/approval flow; Applications supplies the same existing PTY. A payment decision is taken in that original flow and is not inferred from starting or opening an application.

## Stop, reopen and recover

Use **Stop** in Applications. The native launcher closes admission, drains accepted browser/model actions, closes the original publisher and releases the same kernel workspace lease. A stop arriving during startup prevents a late READY record. The original runtime retains its launch and terminal history.

Start the saved application again to reopen the same source workspace with a fresh listener instance. Its original records and operator history persist. If staff change the private connection or select a new source runtime, create a fresh launch review; keep the retained workspace as the original data source.

To hand over the complete workspace, Stop first and use the original checkpoint command:

```sh
starforge fiscaldata checkpoint --dir /private/treasury --out /private/source-packages --operation treasury-handover-01 --operator /private/operator.json
```

The package contains every original source/review record, exact raw capture bytes, immutable editions/comparisons, retained downloads, received acquisitions and named-operator history. The sealed package has an explicit file manifest and digest. The same operation ID continues an interrupted copy. Start the application again when the separate checkpoint writer has closed.

Receive that package in a distinct private directory, then declare the destination in its host's private connection and review a managed application for the new directory identity. Original workspace IDs remain part of source provenance; each receiving host binds its own actual directory. Merchant/runtime/buyer credentials remain host configuration and are configured through the existing original consumers.

## Native contract for shared Applications composition

The shared catalog and observer remain owned by the original Applications module:

```js
import {
  fiscalDataApplication,
  prepareFiscalDataApplication,
  fiscalDataStartup
} from './application-fiscaldata.mjs';
```

Add `fiscalDataApplication(common)` to the existing catalog. For its prepare branch, pass the original `inputPath` and selected `runtimeDirectory`, append its returned args/inputs/createDirectories, and preserve its `resourceKey` through the existing resource-key field. The common layer appends the one reviewed `--port` and invokes the original terminal carrier.

Pass each serialized original output line through `fiscalDataStartup(request, text)`. A successful response contains `{url, original}` for the existing saved application URL record. It verifies the actual HTTP identity and retains the original startup fields. Non-Fiscal output returns null.

The original installed command is:

```text
fiscaldata managed
  --connection ORIGINAL_PRIVATE_CONNECTION
  --workspace ORIGINAL_ALIAS
  --exports ORIGINAL_PRIVATE_PACKAGE_DIRECTORY
  --expected-connection-sha256 REVIEWED_SHA256
  --expected-workspace-identity REVIEWED_SHA256
  --managed-source ORIGINAL_SELECTED_SOURCE_ROOT
  --expected-source-sha256 REVIEWED_SHA256
  --startup-format json
  --port REVIEWED_PORT
```

`managed.mjs` exports `inspectFiscalManagedSelection`, `inspectFiscalManagedWorkspace`, `inspectFiscalManagedSource` and `startFiscalManagedApplication`. Inspection opens no model, seller or buyer. The start function returns `{url, identity, closed, close}` and accepts an AbortSignal.

The original model's optional `expectedWorkspace` argument has the exact shape `{id, createdAt, directoryIdentity:{dev,ino}}`. Both device and inode are decimal strings. The model checks that binding only when the original caller provides it; direct CLI and MCP use retain their existing behavior. The borrowed browser accepts a host-created managed identity, exposed by authenticated `GET /api/identity`; ordinary browser instances have no such route.

## Useful recovery messages

| Code | Operator action |
| --- | --- |
| `FISCAL_MANAGED_REVIEW_REQUIRED` | Start from the complete original Applications review. |
| `FISCAL_MANAGED_SELECTION_CHANGED` | Reopen Review for the changed connection, source or workspace selection. |
| `WORKSPACE_IDENTITY_CHANGED` | Select the intended original directory; do not initialize a replacement over it. |
| `FISCAL_MANAGED_ALIAS_MISSING` | Select an alias declared by the retained private connection. |
| `FISCAL_MANAGED_EXPORT_DIRECTORY` | Choose an existing private directory outside all source workspaces. |
| `APPLICATION_FISCALDATA_LISTENER_CHANGED` | Inspect the retained launch and actual local listener, then review the correct original runtime. |
| `FISCALDATA_WORKSPACE_DRAINING` | Let accepted work finish through the original Stop/checkpoint operation, then reopen. |
| Original lease error | Close the existing CLI, MCP or managed writer using that directory before starting another owner. |

Original Fiscal API and field semantics: [DOMAIN.md](../../sf30-seller-sdk/fiscaldata/DOMAIN.md). Source capture and publication guide: [README.md](../../sf30-seller-sdk/fiscaldata/README.md).

