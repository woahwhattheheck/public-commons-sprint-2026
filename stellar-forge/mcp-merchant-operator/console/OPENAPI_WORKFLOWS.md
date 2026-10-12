# OpenAPI merchant workflows and complete customer delivery

Use the original Merchant Console to retain a repeatable operating-policy change, review its native candidate, publish the selected package and deliver every original file. The installed command is `starforge merchant-openapi-workflows`; the browser and command line operate on the same profiles, workflow editions, runs and customer records.

The maintenance recipe contains four native steps: policy review, reviewed package publication, package inspection and complete export. It pauses after the first step so the operator can inspect the actual source-bound review. The receiving recipe imports the complete downloaded package through an existing destination handle, reopens its source and optionally stages a named release.

## Start the existing product

Select the `openapi-merchant` distribution. It includes the original OpenAPI/HAR provider, policy library, worksheet, Console, seller releases and this workflow command. The original host must expose an operator URL such as `http://127.0.0.1:8400/operator/` and the corresponding MCP URL. Both use the host's existing bearer token. Keep that token in its named environment variable.

The same workflow can use an operator-authored policy document or a saved immutable library edition. Original source, plan, worksheet, application and policy files stay behind the host's declared handles. A receiving directory must likewise be declared by the destination's original SF61 connection. A workflow never supplies an arbitrary server filesystem path.

For source deployment the entry is:

```sh
node stellar-forge/mcp-merchant-operator/console/openapi-workflow-cli.mjs --help
```

The examples below use `starforge merchant-openapi-workflows`, with `MCP_ACCESS_TOKEN` already provided by the host's normal launcher. Replace the shown URL with its actual operator URL.

## Retain a maintenance procedure

First create or select a Console profile. A new profile request is:

```json
{"id":"api-operations","name":"API operations"}
```

Save it to a private file and run:

```sh
starforge merchant-openapi-workflows profile-save --url http://127.0.0.1:8400/operator/ --input profile.json
starforge merchant-openapi-workflows host --url http://127.0.0.1:8400/operator/
```

A maintenance preparation contains the complete original policy-review request and the new immutable package name. This example selects an existing saved package and a historical policy edition. Supply the actual 64-character SHA256 returned by the original policy library.

```json
{
  "kind": "maintenance",
  "id": "forecast-maintenance-v1",
  "profileId": "api-operations",
  "name": "Forecast operating policy",
  "request": {
    "workspace": "seller",
    "baseName": "forecast-current",
    "policy": {
      "id": "ForecastRead",
      "sha256": "REPLACE_WITH_THE_SELECTED_ORIGINAL_POLICY_EDITION_SHA256"
    },
    "targets": [
      {"method": "GET", "path": "/forecast"}
    ]
  },
  "package": "forecast-maintained"
}
```

The `request` accepts the actual native policy-review fields. A complete new source may use `specFile` plus `planFile`; portable authoring may use `applicationFile`; a retained worksheet uses its original declared packet handle. `targetsFile`, `overridesFile` and `operationPlansFile` carry large explicit inputs. Price, authorization, transport and response behavior come from these original authored inputs and the native compiler. Changing an included top-level input replaces that complete input value.

Prepare against the selected host, read the full saved review, then install that same preparation:

```sh
starforge merchant-openapi-workflows prepare --url http://127.0.0.1:8400/operator/ --input maintenance.json --output maintenance-prepared.json
starforge merchant-openapi-workflows install --url http://127.0.0.1:8400/operator/ --input maintenance-prepared.json
starforge merchant-openapi-workflows installation --url http://127.0.0.1:8400/operator/ --id forecast-maintenance-v1
```

The preparation contains the sealed portable recipe, exact current tool definitions, destination compatibility review and frozen install request. If the review reports `canInstall: false`, resolve its concrete missing tool, input or host difference and prepare again with a new output filename. Explicit `acceptToolChanges` entries select actual differences reported by the original review.

An exact installation retry reopens its original definition and install record. A later workflow edition stays available; it does not replace the installation's first edition.

## Run and inspect the native review

Save a run preparation input:

```json
{
  "id": "forecast-maintenance-run-1",
  "installationId": "forecast-maintenance-v1"
}
```

Then retain the complete source-bound run request before starting:

```sh
starforge merchant-openapi-workflows run-prepare --url http://127.0.0.1:8400/operator/ --input run.json --output run-prepared.json
starforge merchant-openapi-workflows run --url http://127.0.0.1:8400/operator/ --input run-prepared.json --wait
```

The request pins profile, host configuration, workflow ID, exact workflow revision and complete run inputs. The default uses the original installed edition. To run a later saved edition, set `workflowRevision` explicitly in the run preparation input. Optional `inputs` can replace existing declared input values, including `packageName`; choose a new immutable destination name for new work.

After the first native step, the run is `PAUSED`. In the browser, open the same profile and workflow run, select its completed review call and inspect the full candidate and changes. The returned `review.sha256` binds the original source, base plan, worksheet, policy edition, explicit overrides and native compiler preview.

To continue by command, save the displayed current run revision and that exact native review SHA:

```json
{
  "id": "forecast-maintenance-run-1",
  "expectedRevision": 3,
  "expectedReviewSha256": "REPLACE_WITH_THE_DISPLAYED_NATIVE_REVIEW_SHA256"
}
```

The revision above is illustrative; use the actual current run value.

```sh
starforge merchant-openapi-workflows continue --url http://127.0.0.1:8400/operator/ --input continue.json --wait
starforge merchant-openapi-workflows status --url http://127.0.0.1:8400/operator/ --id forecast-maintenance-run-1 --wait
```

The native package step consumes that saved review SHA. Changed declared source files or policy inputs require a new review. A completed package is reopened through the original immutable writer when the same submitted operation is retried.

## Deliver the full customer package

Once the export step completes, the browser's **Prepare customer** action selects its exact workspace, export ID and complete export-manifest SHA. The OpenAPI customer record displays every original member, total bytes, saved result and receiving state. Individual files and the complete archive use the same retained original manifest.

The command-line equivalent is:

```sh
starforge merchant-openapi-workflows customer --url http://127.0.0.1:8400/operator/ --id forecast-maintenance-run-1 --wait
```

Use the returned delivery ID to download the complete archive:

```sh
starforge merchant-openapi-workflows archive --url http://127.0.0.1:8400/operator/ --profile api-operations --id RETURNED_DELIVERY_ID --output forecast-package.tar.gz
```

The archive contains a `package/` directory with `package-export.json`, the original source and plan, merchant manifest, complete compiled seller files and retained provenance or policy application when present. The server verifies every original member before streaming, retains its original download lease while reading and verifies the bytes during streaming. The client publishes its output filename only after the full response and file sync.

For an interrupted network connection, use the original MCP downloader to resume individual verified chunks into a private destination:

```sh
starforge merchant-openapi-workflows download --url http://127.0.0.1:8400/operator/ --id forecast-maintenance-run-1 --mcp-url http://127.0.0.1:8400 --directory /private/received-forecast
```

Use the exact MCP URL returned by the original launcher. `--mcp-token-env` selects a different existing token variable when required. Repeating this command with the same directory, saved export and original endpoint resumes its retained download. The result is the complete original package folder; the Console profile and customer record remain the normal operating surface.

## Receive and stage on another workspace

Declare the complete package folder in the destination's original SF61 connection under a delivery alias such as `forecast`. For an archive, select its extracted `package/` folder. For the resumable downloader, select its completed package directory.

Use the complete `package-export.json` SHA from the export/customer record, which is distinct from the inner `merchant-package.json` SHA. A receiving preparation is:

```json
{
  "kind": "receiving",
  "id": "forecast-receiving-v1",
  "profileId": "api-operations",
  "workspace": "receiver",
  "delivery": "forecast",
  "package": "forecast-received",
  "expectedManifestSha256": "REPLACE_WITH_THE_COMPLETE_EXPORT_MANIFEST_SHA256",
  "releaseId": "forecast-release"
}
```

Prepare, install and run it through the same commands:

```sh
starforge merchant-openapi-workflows prepare --url http://127.0.0.1:8400/operator/ --input receiving.json --output receiving-prepared.json
starforge merchant-openapi-workflows install --url http://127.0.0.1:8400/operator/ --input receiving-prepared.json
```

Use a new stable run ID and `installationId: "forecast-receiving-v1"` in `run-prepare`, then start its saved request. The original receiving engine validates the complete source/compiled closure, imports it, reopens the received package and stages the explicitly named release. Omit `releaseId` to stop after receiving and inspection. Release comparison, activation, startup and shutdown remain the original seller operations.

## Portable recipes, older profiles and exact recovery

`recipe` exports a sealed procedure without installing it. `export-recipe` exports an existing saved workflow through the original recipe API. `workflow-save` retains a later original workflow definition using its current expected revision. Use the original browser for editing its saved drafts and editions; each step keeps the complete original tool definition and native input schema.

Export and import a complete profile:

```sh
starforge merchant-openapi-workflows profile-export --url http://127.0.0.1:8400/operator/ --id api-operations --output api-profile.json
starforge merchant-openapi-workflows profile-import --url http://127.0.0.1:8500/operator/ --input api-profile.json
```

Import merges the original immutable definitions, calls, recipe installs and run history. Receiving an older archive preserves later editions already held by the destination. A profile carries its original host fingerprint; inspect the destination host and use the original `bind` action with the current profile revision before preparing a new run there. Imported customer records retain their exact export identity; full local package bytes are received through that destination's original customer downloader.

If a connection ends after a write, reopen its retained identity before choosing a new operation:

| Operation | Exact recovery |
| --- | --- |
| Recipe installation | Repeat the saved preparation file and installation ID. |
| Run start | Repeat the saved run request and run ID; starting does not implicitly resume a paused run. |
| Paused policy review | Reopen its current run revision and original completed review before continuing. |
| Package publication | The saved native review and identical complete inputs reopen the same immutable package. |
| Customer receiving | Reopen the same profile/export/manifest selection. |
| Chunked package transfer | Repeat the original MCP download with the same directory. |
| Completed local artifact | Identical bytes reopen the existing filename; different bytes require another name. |

`resolve` and `handover` expose the original workflow engine's explicit recovery actions for an interrupted native step. Their requests use the current run/call identities shown by the original Console. A lost HTTP response is reported with `outcomeUnknown: true` and leaves the stable operation available for reopening.

## Programmatic consumer

```js
import { OpenApiWorkflowClient, writeOpenApiWorkflowFile }
  from './openapi-workflow-client.mjs';

const client = new OpenApiWorkflowClient({
  url: process.env.MERCHANT_OPERATOR_URL,
  tokenEnv: 'MCP_ACCESS_TOKEN'
});
try {
  const prepared = await client.prepare(completeOperatorRequest);
  await writeOpenApiWorkflowFile('/private/maintenance-prepared.json', prepared);
  const installed = await client.install(prepared);
  const run = await client.prepareRun({
    id: 'forecast-maintenance-run-1',
    installationId: installed.installation.id
  });
  await writeOpenApiWorkflowFile('/private/run-prepared.json', run);
  await client.start(run);
  const current = await client.waitRun(run.request.id);
  console.log(current.run.state);
} finally {
  client.close();
}
```

Source consumers can use the relative import above. Installed products expose the same client through their actual package name followed by `/merchant/console/openapi-workflows`.

## Complete original receiving operation

The source command `console/openapi-workflow-journey.mjs EXISTING_PRIVATE_PARENT` extends the original route worksheet and policy journey with one live Console workflow/customer lifecycle. It uses the installed original Node, seller source and browser runtime, retains the real native result and screenshot, and closes the same owned hosts. Its receiving record includes the full original authoring, reviewed publication, profile edition/replay, streamed archive and destination package flow.
