# CoinGecko in Applications

Applications opens CoinGecko's existing research workspace from a selected READY runtime. The saved application retains the original workspace, optional project, private buyer configuration, installed source, managed release and original process operation. The browser, CLI and merchant MCP tools use the same projects, sources, research records and native buyer jobs.

## Open a retained research project

1. In the runtime workspace, select the READY runtime that contains the CoinGecko managed application and open **Applications**.
2. Choose **CoinGecko market research**. Give the application a name and set **Private CoinGecko workspace** to the original directory containing `market.sqlite`.
3. Set **Project to open** to the existing project ID if the application should always open that project. Leave it empty to use the workspace's ordinary project selector. The ID is visible in the original project and its exported handover.
4. If native buyer operations are needed, select the existing **Private buyer profile configuration** described below. Retained research can be opened without configuring a buyer.
5. Keep the port at **0** to use an available local port, or select the intended fixed loopback port. The optional environment file is handled by the existing Applications environment control.
6. Select **Review**, inspect the original paths and selected runtime, then **Save**. If this runtime has not been adopted, finish the application’s existing connection operation. The existing SF46 installer owns that adoption.
7. Select **Review Start**, then **Start**. **Open** becomes available after the original CoinGecko server publishes its retained launch and its live response matches the selected workspace and installed code.

The selected project opens in the original research interface. Source capture, request collections, response import, rows, snapshots, comparisons, notes, provider plans, native jobs, handover and restore continue through their original routes. Opening an existing project does not run a new acquisition or purchase.

A new workspace can be created by selecting one missing directory whose immediate parent already exists and is private. Save creates that directory. Review Start then binds the newly created directory before any process launches. Select a project only after that project exists in the chosen workspace.

## Private buyer configuration

Use the same `buyerProfiles` JSON accepted by the original CoinGecko CLI:

```json
{
  "buyerProfiles": [
    {
      "id": "research-testnet",
      "name": "Research operator",
      "network": "testnet",
      "configPath": "/home/operator/buyer/config.json",
      "workspacePath": "/home/operator/buyer/operations"
    }
  ]
}
```

Keep this JSON and every referenced buyer configuration as ordinary private files owned by the operator, with mode `0600`. The selected CoinGecko workspace and native buyer operation directories must be real private directories with mode `0700`. Use canonical absolute paths.

Review binds the configuration file, each referenced original buyer configuration and each native buyer operation directory. The saved launch contains file hashes and original profile/path metadata; it does not embed the buyer configuration’s secret values. Original buyer preparation and execution remain responsible for interpreting that configuration and approving the particular native request.

**Allow the selected local merchant** enables the original workspace's local-development merchant setting. Use it when this application deliberately operates a local merchant. It does not create a new buyer engine or change the original request approval flow.

The complete serialized launch selection must fit the existing managed command's 8,000-byte argument limit. Select a configuration containing the profiles this application needs. Large source datasets remain in the original workspace and are not command-line arguments.

## Review and source changes

A saved application binds its original runtime installation, profile, lockfile, source commit and manifest. Review Start also captures the chosen workspace's directory identity, existing database identity, selected project revision, source files and current private configuration.

Start rechecks the original inputs and adopted release through the maintained Applications lifecycle. Inside CoinGecko's original workspace lease, the server rechecks the selected workspace and project before opening the write-capable model. A project edit between Review Start and Start requires a fresh Start review.

The reviewed runtime and its adopted release have different filesystem paths. The startup observer verifies the actual release source against the reviewed files, then accepts the launch from that installed release. A matching source digest alone cannot substitute another workspace or a different project.

After upgrading the runtime, reopen the application's settings, select that READY runtime, review and save the application, complete any required connection, and review Start again. Existing projects and buyer operations remain in their selected directories.

## Stop, reopen and recover

**Stop** uses the existing managed operation. CoinGecko stops accepting new browser operations, lets accepted requests settle, closes its original job runner and database, and releases the original workspace lease. The private launch record becomes `CLOSED` after that shutdown. The original worker retains process outcome, logs and cancellation history.

Closing a browser tab does not stop the original application process. Reopen the existing application and operation to regain its current link. To edit settings or move to a different runtime, first stop or reconcile that same operation.

After a process interruption, inspect and reconcile the existing Applications operation. Once its original process is ended, review Start against the retained workspace and start a new application run. CoinGecko's original lease recovery reopens that database; its native job recovery retains the original job, intent, request and saved response. Use the original job's Resume or Receive controls when applicable. Permanent cancellation stays canceled.

The launch observer checks all of the following before advertising Open:

- The original saved application run and its Start review refer to this command, home and release.
- The actual installed release contains the reviewed CoinGecko files.
- The selected workspace and database are the original directories and file identities.
- The selected private configuration still matches the review.
- The loopback URL names the selected project and intended port.
- The original private launch record and live `/api/managed-launch` response describe the same instance.

A prior launch record is retained as history. It cannot supply a current Open link without a matching live instance and original managed operation.

## Original files and portable handover

The application's settings and runs remain in the runtime workspace's existing Applications store. Research data remains in the chosen CoinGecko directory. CoinGecko adds only a private `managed-launches/` directory of its own launch records; it does not add a second research database.

Use the original **Handover** action to deliver the complete research project. Its runtime source closure includes the managed launcher so the exported original CLI remains complete. Native buyer credentials and external operation-directory contents remain under their original host paths. A restored project can be selected by a saved application in its receiving workspace.

The complete agent operation is documented in [the CoinGecko merchant MCP guide](../../../../stellar-forge/mcp-merchant-operator/COINGECKO-WORKSPACE.md). All 32 tools act on the same original model and project. Coordinate one active writer for a workspace through its original lease and operator process.

## Native integration

The original CLI accepts a managed startup only when Applications supplies `serve --state ABS --startup-format json --managed-selection JSON`, with its optional project, configuration and local-merchant flags. It prints one compact `stellar-forge.coingecko-managed-launch.v1` record after its original server is listening.

The additional native module is `partners/coingecko-stellar-market/workspace/managed.mjs`. Applications uses `application-coingecko.mjs`; the catalog and serialized output observer integrate it into their existing lifecycle. There is no additional scheduler, process manager or payment implementation.

The launch hashes cover the original CLI, common definitions, managed launcher, server, model, store, jobs and browser application. The existing runtime manifest and SF46 release verification cover the complete installed source package.

## Receiving the installed product

Exercise the saved research project through the real Applications lifecycle: Review/Save and connection, Start/Open, source and research readback, an ordinary saved research edit, Stop, reopen the same project, interrupted process recovery and complete original handover/restore. Retain the original application and process IDs while completing each stage.

The preceding standalone and merchant MCP receiving already preserve all five source families and all 15 original input hashes. This Applications integration continues that original project; it does not replace the source intake or repeat a paid acquisition.
