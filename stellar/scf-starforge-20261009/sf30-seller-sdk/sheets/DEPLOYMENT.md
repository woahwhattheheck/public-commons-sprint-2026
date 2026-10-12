# Google Sheets merchant deployment

Operate a reviewed, published Sheets dataset through the original SF82 merchant release lifecycle. The existing source workspace adds deployment review, the original five-file dataset package, immutable release staging and access to the same native deployment console from the browser, CLI and MCP.

The original Sheets projector, dataset publisher, dataset version store, seller, buyer and SF82 release manager remain authoritative. The adapter consumes a completed original publication. It does not make another Google request, extract another candidate, migrate the dataset, or create a second merchant manager.

## Before deployment

Use an existing Sheets source workspace with at least one reviewed saved source version and one matching original publisher run in PUBLISHED state. The source version's exact source SHA256 must equal the retained publisher plan and candidate source hash. The original publication review, candidate digest and published snapshot must agree.

The workspace runs on Linux with Node22.16+ and util-linux flock. It requires no new npm package or frontend build. Keep the private source workspace and its original dataset directory outside the source checkout. Merchant operation uses the existing SF82 runtime requirements.

The public origin, fixed route, network, asset, recipient, atomic payment amount and timeout are explicit operator inputs. Use the merchant's reviewed original configuration. The amount remains a decimal integer string; the editor does not convert it through floating-point arithmetic. The original seller compiler validates the supplied configuration.

## Browser workflow

Open the existing source workspace through its maintained command:

~~~sh
starforge sheets-source workspace serve --directory /private/sheets/catalog-source --port 8453
~~~

The repository equivalent is:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/cli.mjs workspace serve \
  --directory /private/sheets/catalog-source --port 8453
~~~

Use the complete capability URL printed by that process. One original source model and its private lease serve all the panels.

1. In **Versions & publisher**, save and select a reviewed source version. Open the original publisher, save its plan, extract the candidate, review against the original target and publish it. Existing plans and published snapshots retain their own source identity when later source versions are selected.
2. Open **Merchant deployment** and refresh the saved deployment state. The publication table is paginated. It shows the original run ID, native state, published snapshot and all saved source versions with the matching exact source hash.
3. Select **Use publication**, then the exact saved source version. Enter the public merchant terms and select **Review original publication and terms**.
4. Inspect the retained review request, source version, candidate snapshot and row count, exact payment terms, merchant configuration hash, package provenance hash and review SHA256. Editing those terms invalidates the current preparation selection. An older completed review remains available in the operation history.
5. Select **Prepare this reviewed package**. The adapter rechecks that same original review and publication before retaining the package. The operation's UUID determines its private package directory. Repeating or recovering that request retains the same bytes.
6. Inspect the package source hash, original snapshot, original dataset directory and five exact file identities. Download any file individually if needed. The download is verified against the original package before returning bytes.
7. Enter a new immutable release ID, label and runtime. Port0 asks the operating system for an available local port. A specified stable port must be available when the merchant starts. Supply an existing facilitator only when required; use the explicit local-facilitator option only for the reviewed native local configuration.
8. Select **Stage original merchant release**. Staging calls the original SF82 dataset release writer and preserves its immutable record. A previously used ID is accepted only when the retained package, label and normalized runtime are identical.
9. Select **Open deployment controls**, then **Go to original deployment controls**. This is the original SF82 console, which owns the merchant it starts. Compare releases, select the intended one and use **Start selected**. Review its native health, offers, OpenAPI, documentation and receiving controls as appropriate.
10. Stage a successor, compare it in the same console and select it. Selection does not replace a running process: the original status becomes RESTART_REQUIRED when the running and selected releases differ. **Restart selected** drains the owned merchant and starts the selected release. Stop and rollback use the same native controls and ownership.
11. When finished, close the deployment controls from the Sheets workspace or close the entire source workspace. The original console drains its owned merchant. Reopen the source workspace, inspect retained operations and release selection, then explicitly open/start the desired service.

**Refresh deployment state** reads current native ownership; it does not alter form drafts, start a process, extract or republish. Historical console-open receipts may contain an old URL. Only the current console ownership and its current link establish a live console.

### What rollback changes

The package binds to the original host-local dataset version store. Its baseline snapshot identifies the reviewed original publication, and the original seller retains snapshot-selectable reads and the native dataset contract. Later publications continue in that same version store.

Merchant rollback changes the selected release configuration. It does not rewind the dataset's current version, delete later snapshots or replace the dataset directory. Retained snapshot cursors keep their original semantics while their snapshots remain available under the original retention rules.

A package copied alone to another machine is not a complete dataset-store migration. Preserve the original source workspace, publisher state and complete dataset state in the host's existing backup/migration process. Review a separate destination explicitly before opening it. The five-file package's binding.json contains its original host-local absolute dataset directory.

## Package contents and custody

Each completed package request retains these files under the source workspace's deployments/packages/REQUEST_UUID directory:

| File | Original content and check |
|---|---|
| dataset.csv | Exact public candidate CSV bytes and SHA256. |
| dataset.json | Original dataset configuration, with only its local CSV filename set to dataset.csv. |
| seller.json | Original seller compiler output for the explicitly reviewed public merchant terms, including the native snapshot query parameter. |
| source.json | Saved source-version/hash identity, reviewed candidate and publication identity, public projected schema and merchant hash. |
| binding.json | Original dataset release binding, native contract hash, reviewed baseline snapshot, source manifest hash and same host-local dataset directory. |

The deployment export includes only the already reviewed public projection. It does not copy raw Spreadsheet CellData, workbook IDs, OAuth material, environment token references or private source declarations into these files. The retained original source workspace still contains those private source inputs. Treat the host binding and complete workspace as operator material.

Preparation streams the candidate CSV and checks its original size/hash and file identity. Existing target files are reconciled by exact bytes; conflicting files are preserved and rejected. Partial creation resumes into the same request directory. Reserved abandoned staging directories are checked before cleanup. The original dataset release inspector validates all five files and their binding before preparation is considered complete.

The original candidate limit is256MiB. MCP file reads retain the existing shared reader's separate256,000,000-byte maximum,196,608-byte chunk maximum, four-snapshot limit and two-minute idle expiry. Larger permitted CSVs use the original browser or CLI download. No additional archive or file transport is introduced.

## CLI review, prepare and stage

Stop the browser/MCP owner before opening the same source workspace through a separate CLI. Do not remove or bypass its native lease. All examples below use placeholder paths and UUIDs that must be replaced with the inspected original values.

Prepare a private REVIEW.json containing:

~~~json
{
  "versionId": 1,
  "runId": "11111111-1111-4111-8111-111111111111",
  "terms": {
    "origin": "https://merchant.example",
    "path": "/data",
    "payment": {
      "scheme": "exact",
      "network": "REPLACE_WITH_REVIEWED_NETWORK",
      "asset": "REPLACE_WITH_REVIEWED_ASSET",
      "payTo": "REPLACE_WITH_MERCHANT_RECIPIENT",
      "amount": "1",
      "maxTimeoutSeconds": 60
    }
  }
}
~~~

The displayed values are a shape example, not a configured payment destination. Use the exact real merchant terms.

~~~sh
starforge sheets-source workspace deployment-status \
  --directory /private/sheets/catalog-source --limit 25

starforge sheets-source workspace deployment-review \
  --directory /private/sheets/catalog-source --input /private/review.json \
  --request 22222222-2222-4222-8222-222222222222

starforge sheets-source workspace deployment-prepare \
  --directory /private/sheets/catalog-source \
  --review 22222222-2222-4222-8222-222222222222 \
  --sha256 EXACT_RETURNED_REVIEW_SHA256 \
  --request 33333333-3333-4333-8333-333333333333

starforge sheets-source workspace deployment-package \
  --directory /private/sheets/catalog-source \
  --package 33333333-3333-4333-8333-333333333333
~~~

RELEASE.json contains the original immutable ID, label and optional runtime:

~~~json
{
  "id": "catalog-2026-10",
  "label": "Reviewed public October catalog",
  "runtime": { "port": 0 }
}
~~~

~~~sh
starforge sheets-source workspace deployment-stage \
  --directory /private/sheets/catalog-source \
  --package 33333333-3333-4333-8333-333333333333 \
  --sha256 EXACT_INSPECTED_PACKAGE_SOURCE_SHA256 --input /private/release.json \
  --request 44444444-4444-4444-8444-444444444444

starforge sheets-source workspace deployment-export \
  --directory /private/sheets/catalog-source \
  --package 33333333-3333-4333-8333-333333333333 \
  --file source.json --out /private/catalog-source-provenance.json

starforge sheets-source workspace deployment-console \
  --directory /private/sheets/catalog-source \
  --request 55555555-5555-4555-8555-555555555555
~~~

Deployment-export creates one new private output file; it does not replace an existing file. Deployment-console stays alive with the original console until SIGINT/SIGTERM and then drains its owner. The returned current console state distinguishes an old completed request from a newly live console. Reusing a historical completed open request never silently starts a new console.

The repository entry for every command above is the same sheets/cli.mjs workspace command. Original direct lifecycle commands remain under starforge releases or sf82-seller-pilot/release-cli.mjs. For example, with the source workspace closed:

~~~sh
starforge releases diff --store /private/sheets/catalog-source/deployments/releases \
  --from catalog-2026-10 --to catalog-2026-11

starforge releases console --store /private/sheets/catalog-source/deployments/releases --port 0
~~~

That directly opened original console is a separate explicit owner; the closed Sheets process does not claim or close it. Keep the native owner and its original release-store lease intact.

## MCP: the same original workspace

The existing merchant_sheets_open opens the same source model/browser. No new configuration file, credential provider, command alias or transport is required. See the original [MCP authoring guide](../../../../stellar-forge/mcp-merchant-operator/SHEETS_WORKSPACES.md).

| Tool | Input and retained result |
|---|---|
| merchant_sheets_deployment_status | workspace alias, optional run/operation offsets and limit. Returns original runs, matched saved source versions, operation history, current console and original release status. |
| merchant_sheets_deployment_review | versionId, runId, terms, requestId. Returns reviewRequestId and reviewSha256. |
| merchant_sheets_deployment_prepare | reviewRequestId, expectedReviewSha256, requestId. Returns packageRequestId and exact public source/file hashes. |
| merchant_sheets_deployment_package | packageRequestId. Re-inspects the original five-file package. |
| merchant_sheets_deployment_stage | packageRequestId, expectedSourceSha256, immutable id, optional label/runtime, requestId. Returns the original immutable release. |
| merchant_sheets_deployment_compare | to, optional from. Returns the native difference and current selection generation. |
| merchant_sheets_deployment_console_open | requestId. Returns the historical receipt separately from currentDeployment. |
| merchant_sheets_deployment_console_close | exact current console instanceId and requestId. Drains that console and its owned merchant. |
| merchant_sheets_deployment_command | action, consoleInstanceId, expectedGeneration, requestId, and original action-specific fields below. Uses the current original console. |
| merchant_sheets_deployment_file_read | packageRequestId, one of the five filenames, optional readId/expectedSha256/offset/limit. Returns original verified base64 chunks. |
| merchant_sheets_deployment_file_release | readId. Releases that alias's original reader snapshot only. |

Every tool also requires the declared workspace alias. File reads accept package IDs and named filenames, never arbitrary host paths. Current source/console summaries omit local storage paths. Explicit file downloads return the original bytes, including binding.json's host-local dataset binding.

For native commands, use the current consoleInstanceId and expectedGeneration from deployment_status. For activate, supply id and that target's inspected expectedDigest. For rollback, supply to (or use the original previous release) and its exact expectedDigest. Run/restart use the selected release's exact expectedDigest. Stop/restart also require the exact currently managed merchant instanceId. The original receiving review can be supplied as receiving; the original console validates it.

A source workspace UUID prevents duplicate adapter actions. SF82 remains responsible for the original selection generation, merchant instance, receiving review and lifecycle. The adapter never constructs another manager or takes ownership of a process started by another console.

## Lost reply, restart and recovery

The source workspace's existing operation journal retains each deployment input, request UUID, status and result. The browser writes its small recovery marker before dispatch and removes it only after applying both the original receipt and refreshed current state. A committed POST followed by a failed refresh therefore keeps the same original request.

| Situation | Original continuation |
|---|---|
| Review or preparation reply lost | Read operation with the same requestId; resume the same retained operation if interrupted. Preparation rechecks the original review/publication and reconciles the same package bytes. |
| Stage reply lost | Recover the same source operation. The original immutable release ID and exact package/runtime determine reuse or conflict. |
| Native command reply uncertain | Resume reads only original current release state. It returns OBSERVED_ORIGINAL_STATE and commandReplayed:false. It does not replay the uncertain command or infer its historical outcome. Inspect that state before requesting a new deliberate command. |
| Native console still processing | Resume keeps the same request interrupted until the original console is idle. It does not dispatch another action. |
| Console-open receipt belongs to an ended process | Inspect currentDeployment. Recovery does not reopen the historical console. A new explicit open needs a new requestId. |
| Old console-close request reaches a successor | Only its exact original instance can be closed; a successor is preserved. |
| Source/publisher/package bytes changed | Preserve them and inspect the specific original conflict. A stale review is not silently rebound to different source or terms. |
| File reader expires or MCP restarts | Resume the same package, filename, expected SHA256 and offset with a new read snapshot. |
| Entire source process closes | Drain the original publisher and console/merchant, preserve dataset/source/release state, reopen explicitly and inspect prior requests. |

CLI receipt recovery uses the existing commands:

~~~sh
starforge sheets-source workspace operation --directory /private/sheets/catalog-source --request ORIGINAL_UUID
starforge sheets-source workspace resume --directory /private/sheets/catalog-source --request ORIGINAL_UUID
~~~

A browser or MCP uses GET /api/operation or merchant_sheets_operation; resume uses POST /api/resume or merchant_sheets_resume. Reopen and recovery do not make a new Google observation or silently start a merchant.

## HTTP and embedding

The existing source server uses its exact loopback Host/Origin and x-sheets-workspace-token capability. Deployment endpoints are inside that same server:

| Method and path | Original model method |
|---|---|
| GET /api/deployment/status | deploymentStatus({runsOffset,operationsOffset,limit}) |
| GET /api/deployment/package?id=UUID | inspectDeploymentPackage(packageRequestId) |
| GET /api/deployment/compare?from=ID&to=ID | compareDeployment({from,to}) |
| GET /api/deployment/file?packageId=UUID&file=FILENAME | deploymentFile(packageRequestId,filename) |
| POST /api/deployment/review | reviewDeployment({versionId,runId,terms,requestId}) |
| POST /api/deployment/prepare | prepareDeployment({reviewRequestId,expectedReviewSha256,requestId}) |
| POST /api/deployment/stage | stageDeployment({packageRequestId,expectedSourceSha256,id,label,runtime,requestId}) |
| POST /api/deployment/console/open | openDeploymentConsole({requestId}) |
| POST /api/deployment/console/close | closeDeploymentConsole({instanceId,requestId}) |
| POST /api/deployment/command | commandDeployment({action,consoleInstanceId,expectedGeneration,...originalFields,requestId}) |

The reusable sheets/deployment.mjs exports reviewSheetsDeployment, prepareSheetsDeployment, inspectSheetsDeployment, stageSheetsDeployment and readSheetsDeploymentFile. A direct embedder supplies the original openSheetsPublisher and original saved source version. The same-store package is compiled and staged through original sf82-seller-pilot/release-dataset.mjs and releases.mjs.

The source model serializes temporary publisher access with its owned publisher open/close. Browser and MCP borrow the same instance when it is already open. The original console is the single owner for deployment lifecycle, and source shutdown waits for its close. No additional source store, scheduler, release engine, native worker or generic download transport is implemented here.
