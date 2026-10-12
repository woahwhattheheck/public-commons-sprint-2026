# Receive the installed Fiscal Data application

This receiving command carries the original Applications workflow through review, save, runtime adoption, native start, a real Treasury analyst session, complete delivery, stop, and reopen. It consumes an already installed Merchant runtime and a sealed Fiscal source checkpoint. The command uses the original Applications controller, Fiscal managed launcher, named operator, source model, HTTP server, and portable receiving API.

## Runtime and source

Use Node 24 or later. The selected Merchant runtime must be an actual READY installation created by the original SF46 installer. Its source must include the Fiscal Applications contribution, this command, and the existing runtime workspace. The command inspects that installation and imports its own modules from the selected source root. The installed source hash, the connection file bytes, the workspace identity, and the native startup identity are compared before an analyst action.

The full browser path also needs an existing Playwright installation and a Chromium executable. Supply their actual absolute paths. The command does not install a browser or create a payment runtime. It uses Linux loopback services, the original Applications terminal supervisor, and that supervisor's existing Python/PTY requirements. Run the whole operation through the maintained native admission helper with one declared source and output footprint.

If the installed runtime already belongs to an original managed home, set `managedHomeDirectory` to that home. Otherwise the original Applications controller creates and adopts its managed runtime using its normal local workflow. A received source workspace is separate from both the original checkpoint producer and the receiving output directory.

## Input contract

Save one private JSON input file and keep its bytes unchanged for retries:

```json
{
  "schema": "stellar-forge.fiscaldata-application-receiving-input.v1",
  "operationId": "treasury-applications-receiving-20261012",
  "runtimeDirectory": "/absolute/ready/merchant-runtime",
  "managedHomeDirectory": "/absolute/existing/managed-home",
  "workspaceDirectory": "/absolute/private/treasury-received",
  "outputDirectory": "/absolute/private/treasury-applications-output",
  "packagePath": "/absolute/sealed-checkpoint/workspace.fiscal.gz",
  "packageSha256": "REPLACE_WITH_THE_ORIGINAL_64_CHARACTER_SHA256",
  "workspaceId": "REPLACE_WITH_THE_ORIGINAL_WORKSPACE_UUID",
  "editionId": "REPLACE_WITH_THE_REVIEWED_READY_EDITION_UUID",
  "comparisonId": "REPLACE_WITH_THE_ORIGINAL_READY_COMPARISON_UUID",
  "exportId": "REPLACE_WITH_THE_COMPLETE_COMPARISON_EXPORT_UUID",
  "exportSha256": "REPLACE_WITH_THE_ORIGINAL_DELIVERY_SHA256",
  "workspaceAlias": "treasury",
  "label": "Reviewed Treasury source and comparison",
  "operator": {
    "id": "original-receiving-operator",
    "label": "Original receiving operator"
  },
  "query": "limit=2",
  "briefing": {
    "title": "Reviewed Treasury comparison",
    "audience": "Internal analyst review",
    "notes": "Compare the two retained source intervals. Values remain exact source decimals."
  },
  "browser": {
    "chromium": "/absolute/existing/chromium",
    "playwright": "/absolute/existing/node_modules"
  }
}
```

The values marked `REPLACE` are placeholders, not accepted identifiers. Obtain the workspace, edition, comparison, export, and file hashes from the original checkpoint and its retained model results. Keep the exact financial values in those original source records. The command reads the original query and comparison results and renders their decimal strings; it does not recalculate amounts in the browser.

`workspaceDirectory` is created as a private directory if absent. It must be empty or already belong to this exact checkpoint receiving operation. The portable receiver preserves every original member and the original header, advances the receiving revision, and pauses any unfinished capture whose previous intent was RUNNING. A retry reuses its original restoration receipt.

`outputDirectory` must be private, owned by the operating account, canonical, and outside the received source workspace. The command retains a private connection file, its own Applications controller, operation histories, the analyst delivery, and a structured result there. The connection identifies the named operator and one workspace alias; credentials and payer configuration are unnecessary for this analyst receiving.

`managedHomeDirectory` and `browser` are optional. Omit the home only when the original controller should create its normal managed home. Omit `browser` for a headless native API receiving; the result then records the native analyst and delivery stages without a browser stage. Include it for the complete desktop/mobile product receiving.

## Optional complete customer briefing

Set `briefing` to include the existing customer-report workflow in this same receiving. Its supported fields are authored `title` (required, up to 240 characters), `audience` (up to 400), and `notes` (up to 64,000). The selected READY runtime must contain the managed briefing action, form, helper and renderer from PR1801 or a compatible current descendant. Keep the existing comparison/export identifiers and hashes in the receiving input; the report uses those original retained objects.

With a browser, the command fills the actual Customer briefing form, selects the original comparison delivery, and clicks its normal create action. It records the browser's own original request ID and complete payload before allowing that POST to reach the model. A process interruption therefore retains the same report intent. A retry uses that saved payload through the original action and then continues the download. The command does not replace the request, inject another renderer, or calculate financial values.

Without a browser, it saves a stable request derived from this receiving's original identity before calling the same `briefings.create` action. Omitting `briefing` preserves the earlier input and workflow: it creates no report and does not require the newer report source. Existing completed results and frozen receiving operations remain on their original input.

The full report archive contains its offline HTML entry, every row page, exact dated-measure CSV/JSON, original comparison rows and unchanged original source delivery. The receiving verifies the downloaded file hashes, authored context, original comparison summary, source archive hash, and declared report members. It saves the complete `briefing.tar.gz`, its original manifest, `briefing.json`, `briefing.md`, and `dated-measures.csv` beneath `outputDirectory/downloads/briefing/`. These are the original producer's files.

After the managed application stops and reopens, the receiving repeats the same original report request, requires the same report/export identity with no new export, and downloads the complete archive again to compare its original bytes. This is part of the same Applications operation. The standalone report receiver remains a separate original consumer under its existing owner.

## Launch the original operation

Invoke this file from the selected published source:

```sh
node /absolute/source/stellar/scf-starforge-20261009/sf30-seller-sdk/fiscaldata/receiving/managed.mjs --input /absolute/private/receiving-input.json
```

The module also exports `receiveFiscalApplication(input)` for an existing source-bound receiver. Keep one executor for the stable `operationId`; the Applications controller and portable source receiver retain their original operation locks. A caller retry uses the same input file and output directory. The command holds the original kernel lease on its private output directory while it operates, serializing its input, result, and connection publication. Fully written and fsynced temporary metadata become selected names by rename under that lease; interrupted partial attempts remain private.

For admission, account for the complete Applications controller, original managed Fiscal child, browser, copied source checkpoint, installed-runtime adoption, and output growth. The checkpoint manifest reports the exact source bytes. Reuse an established managed home when it already owns the selected installed runtime. The command does not alter the scheduler declarations or add another launcher.

## Complete workflow

1. Inspect the actual READY installation and the sealed checkpoint. Receive the complete source through the original portable API into the separately declared workspace. Retain the package identity, original workspace identity, member count, and bytes.

2. Create or reopen the receiving's original Applications controller. Attach the selected runtime, review the Fiscal application configuration, and save it through the normal adoption workflow. The configuration binds the operator's connection file, alias, complete source identity, and private export directory.

3. Start the saved application through Applications. Compare the retained native startup with the reviewed connection, workspace, and source. Open the authenticated loopback session and compare `/api/identity` to that same original startup object.

4. Query the selected READY edition through the original model. Read the complete comparison and its exact decimal measures. Locate the original complete comparison export and require its original digest.

5. When a browser is supplied, review the actual source notes as the named operator, query the original rows, inspect capture, edition, and comparison views at 1360 and 390 pixels, and download the complete retained archive. The source review text is saved as an original model revision; the receiving records the intended text before submitting it so a retry can reuse it. The visible operator footer and capture status layout are checked. Browser errors and page dimensions are retained.

6. If the optional briefing is selected, create or resume its original report, download the complete archive and companion files, and retain the actual source/comparison and authored context. The normal browser pass includes its visible Customer briefing form and full archive link.

7. Verify every downloaded archive byte against the original export's size and SHA-256. Stop the original application, wait for its listener to close, close the Applications controller, and reopen that same controller.

8. Start a new original application operation for the same saved application. Its listener instance must be new; its source, captures, reviewed editions, complete exports, operator, and workspace remain the original retained identities. Query the same edition again. When a briefing was selected, reuse its original request and confirm the same export and whole archive after reopening. Then stop and drain that original listener.

## Results and continuation

The final structured result is `outputDirectory/result.json`, with schema `stellar-forge.fiscaldata-application-receiving.v1`. A completed result has `status: "COMPLETED"`, the selected runtime and application, every stage, and the original native run identifiers. Standard output prints a compact final identity summary.

Native `/api/action` replies preserve the original `{result, state}` envelope. The receiving adapter checks that envelope and consumes `result` for the edition, query, comparison, and reopen observations.

The optional customer report adds `complete-customer-briefing` and `customer-briefing-reopened` stages, including the retained browser/native request, original export and archive hashes, all selected file identities, and the unchanged source archive. Its source-derived dated measures remain exact values from the original producer.

The complete analyst download is `outputDirectory/downloads/comparison-delivery.tar.gz`. The receiving compares the full file's size and hash to the original model's sealed export. It does not produce a new financial dataset or replace that delivery.

The source connection, Applications workspace, and exported dataset may contain private operator or business context. Keep them in the original declared private location. Browser screenshots are local receiving intermediates under `screenshots/`; inspect them locally and omit them from a durable source or business handoff.

If interrupted, preserve the input, result, controller, installed runtime, received workspace, and original operation records. Retry the exact command. A live or interrupted application operation must match a run already retained by this receiving before it can be reused or recovered. A stopped attempt remains in the run history; a later start receives a new original request ID linked by `continuationOf`. Repeated sealed checkpoint receiving reopens its original receipt. Completed results return their original outcome.

A changed input, changed installation, unexpected application operation, mismatched startup/listener identity, altered source delivery, failed original runtime adoption, or lost preserved model state is returned as a concrete error. The result retains the original error and source identities. Resolve that original condition and continue the same receiving; do not discard or fabricate the source manifest or native operation history.

## Companion interfaces

- [Fiscal Applications](../../../distribution/runtime-workspace/FISCALDATA_APPLICATIONS.md): installed application settings, source/workspace identity, lifecycle, and faults.
- [Fiscal workspace](../README.md): source capture, field review, edition/query/comparison, exports, and CLI.
- [Named Fiscal operator](../../../../../stellar-forge/mcp-merchant-operator/FISCALDATA-WORKSPACE.md): the original MCP model, browser borrowing, checkpoint, and restore lifecycle.
