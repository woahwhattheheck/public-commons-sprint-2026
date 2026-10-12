# Google Sheets source authoring in Applications

The maintained **Applications** workspace can open the original Google Sheets source editor as a saved application. It retains the same workbook observations, draft revisions, reviewed source versions, publisher plans and runs, dataset versions, deployment packages and merchant release store. Opening or reopening the application makes no Google request and does not start a merchant.

The application is **Google Sheets source authoring** (`sheets-authoring`). Its original command is `sheets-source workspace serve`. **Google Sheets dataset publisher** remains the existing separate application for an already configured publisher; choose the source-authoring entry when you need workbook/range selection and projection editing.

## Select the original workspace

Use Linux with Node 22.16 or later, util-linux `flock`, and an installed merchant runtime containing this application and its original Sheets launch module. In Applications, choose a runtime that is already **READY**. Installing a runtime does not create a source workspace or choose a Google account.

For a new source workspace, initialize it once with the original command in the selected installation:

```sh
starforge sheets-source workspace init --directory /private/sheets/catalog-source
```

The directory must be new and its parent must be under your control. The original command creates private state and prints its status. An explicit `--state /private/sheets/catalog-dataset` chooses the original dataset location at initialization; that binding stays in the workspace. For an existing workspace, use its exact directory without `--create` or `init`.

In Applications, enter:

| Field | Value |
| --- | --- |
| Initialized private Sheets workspace | The absolute original workspace directory, such as `/private/sheets/catalog-source`. |
| Private Google connections file | Optional existing private JSON file containing the original alias-to-grant references. Leave empty to use retained observations. |
| Original seller origin / paid resource URL | Optional matching pair for the original publisher's buyer handoff. These do not change saved merchant terms. |
| Local port | Use `0` for an available loopback port, or a fixed available port. If omitted, the original command uses 8453. |
| Private environment JSON | Optional existing Applications environment file. Keep token values there when using an environment-backed original connection. |

A connections file uses the original provider contract. For example, a host with an existing renewable read-only Google connection can provide:

```json
{
  "catalog": {
    "label": "Reviewed catalog source",
    "oauthDirectory": "/private/google/catalog-reader"
  }
}
```

The connection directory must already belong to the authorized original Google setup. This example does not provision an account. Alternatively use `accessTokenEnv` with the existing environment variable name, as documented in [WORKSPACE.md](workspace/WORKSPACE.md). Raw tokens are not connection-file values. The Applications review stores the file identity and hash, not its contents or grant tokens. Grant refreshes continue through the original Google provider.

## Review, save and start

1. Choose **Google Sheets source authoring**, the READY runtime and the fields above.
2. Review the exact original command and selected paths. The review reads only the original immutable workspace settings; it does not acquire a new workbook observation or modify a source revision.
3. Save the application using the existing Applications save flow. Complete its original managed-runtime adoption if this READY runtime has not yet been attached.
4. Review **Start** and start that saved application. The worker launches the original installed command, acquires the original Sheets workspace lease and checks the reviewed workspace identity before opening its database for writes.
5. Open the private application URL from the retained run. It points to the original Sheets browser. Keep the complete fragment token private.

The selected runtime and its adopted executable release can occupy different directories. Their original `launch.mjs`, `model.mjs`, `cli.mjs` and `server.mjs` must match byte for byte. The original CLI checks that match and announces its actual launch source, current PID, fresh browser instance and exact workspace identity. The existing Applications observer validates that announcement before retaining its Open URL.

Normal source editing does not invalidate the saved application. The binding uses the original database device/inode and immutable settings, including the original source, publisher and dataset paths. It deliberately excludes the mutable SQLite file hash, size, timestamps, selected version and draft revision.

## Complete the source-to-merchant workflow

Inside the original browser, select an existing connection and workbook, then choose its original tab and range. Inspect the cells, choose only the intended public columns and their original typed conversion, and review the preview before saving a source version. Existing observations can be inspected and reused without another provider read.

The original publisher remains the owner of extraction plans, publication requests, schedules and dataset versions. Open it from the source editor, review the selected saved source and publish through its existing controls. A source-version save alone does not publish a dataset.

After a matching publisher run is **PUBLISHED**, use the source editor's managed-deployment panel to review explicit merchant terms, prepare the original five-file dataset package and stage an immutable release. The original SF82 console owns comparison, selection, run, restart, drain and rollback. See [DEPLOYMENT.md](DEPLOYMENT.md) for the complete same-store workflow, required terms and its original CLI/MCP commands.

The optional seller/resource fields in Applications configure the original publisher's buyer handoff. Merchant quote/network/payee terms still come from the explicit deployment review. Reopening an application or replaying a completed source operation does not start a merchant or repeat an acquisition.

## Stop and reopen the same work

Use the saved application's **Stop** action. The maintained worker signals the original CLI; the original source service drains its outstanding operation, closes its publisher, stops its owned SF82 console and merchant, closes SQLite, and releases its original workspace lease.

Wait for that same retained run to reach its stopped/terminal state before starting again. If Stop's reply is lost, inspect that operation and recover its status. Do not create a second Start intent to infer whether the first process stopped.

A later Start uses the same saved application and original workspace. It prints a new private browser URL and instance ID. Captures, reviewed versions, request UUIDs, published dataset versions and staged releases remain at their original locations. Reopening does not reactivate a prior merchant; use the original deployment controls when you explicitly want it running.

The direct CLI and MCP also use the same original source lease. Stop an Applications-owned source editor before opening that workspace through another host. An original `PUBLISHER_ALREADY_OPEN` means there is already a real process holding that workspace; use its existing UI/run, or stop that process through its owner.

## Recover a lost reply

| Situation | Continue the original operation |
| --- | --- |
| Applications Save reply was lost | Reopen the existing saved application/review and recover the same save request. The original Applications CAS and request identity remain authoritative. |
| Start reply was lost | Open the retained Applications operation. Its private startup URL and process receipt belong to that run; do not start a second process. |
| A source action reply was lost | Use the original browser's recovery control or `workspace operation/resume` with the exact original UUID. The saved request, input hash and status decide whether any action can continue. |
| Stop reply was lost | Inspect the same managed run until its original drain is terminal; then review a fresh Start. |
| Connection JSON changed | Stop, review the new private connection-file bytes, save the application settings and review Start again. A pending old launch will not silently read a different file. |
| Workspace was restored/replaced | Review that original received workspace again. A new database inode or immutable path binding intentionally changes the launch identity, even if its historical records match. |
| SQLite needs crash recovery | With its original owner stopped, run `starforge sheets-source workspace status --directory /private/sheets/catalog-source`. This opens the original database through its normal engine and lock. Then review the application again. |
| Selected runtime source changed | Use the original READY-runtime refresh/adoption and re-review. The selected and executed four-file launch source must match. |

Browser recovery and source operations remain described in [WORKSPACE.md](workspace/WORKSPACE.md). Applications does not implement another journal or rewrite a source operation's status.

## Portable source and receiving

Use the original source version export/import flow for a private source-authoring packet. It includes the selected retained CellData and exact source projection; keep it private. On another authorized host, initialize its original source workspace, import the reviewed packet using one request UUID, inspect the retained projection and save a source version. Then add that workspace to Applications.

A source packet is not a complete merchant backup. The original publisher, dataset and managed release/recovery tools retain their own state and receiving contracts. Preserve their complete paths and bindings when transporting the full merchant; use their original receiving/recovery tools rather than copying a live SQLite file. This Applications entry supplies process ownership and reopen continuity, not a second export store.

## Original launch interface

Applications supplies the following existing-command extension:

```text
starforge sheets-source workspace serve
  --directory ORIGINAL_PRIVATE_WORKSPACE
  --managed-source SELECTED_RUNTIME_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/workspace
  --expected-source-sha256 ORIGINAL_FOUR_FILE_DIGEST
  --expected-workspace-identity ORIGINAL_WORKSPACE_IDENTITY
  --startup-format json
  [--connections PRIVATE_CONNECTIONS.json --expected-connections-sha256 REVIEWED_FILE_SHA256]
  [--seller ORIGINAL_ORIGIN --resource ORIGINAL_RESOURCE_URL]
  [--port 0]
```

These hashes come from the installed native reader and the saved application review. Do not hand-fill them from another workspace or edition. The unextended `workspace serve` command retains its ordinary direct startup output.

The machine startup is one JSON line with schema `stellar-forge.sheets-authoring-startup.v1`, status `SHEETS_AUTHORING_READY`, exact workspace/settings identities, selected and executed source identities, private connection-file identity, PID, instance ID and `sheetsWorkspace` URL. It contains no workbook ID, CellData, grant token or provider response.

For the existing shared Applications composer, the additive helper ABI is:

```js
sheetsApplication(common)
prepareSheetsApplication(settings, { inputPath, runtimeDirectory })
sheetsStartup(request, startupLine)
```

Preparation returns original `args`, `inputs` and an empty `createDirectories`. Startup returns `{url, original}` for the existing serialized observer and private URL receipt. The existing Applications catalog, managed adoption, run/save/stop operations and observer stay authoritative; this helper does not launch a process itself.

