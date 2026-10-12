# Merchant operator in Applications

**Merchant operator** opens the existing authenticated merchant console from a saved Applications selection. The same process owns the MCP listener, native tool calls, retained request history and customer file transfers. The interface uses the original merchant configuration and the operator workspace you select.

The console’s [operating guide](README.md) covers Host, Tools, Requests, Workflows and Customers. [Saved workflows](WORKFLOWS.md) connects original request revisions into complete merchant operations, with retained inputs, native result conditions, pause/recovery, named receiving ownership and complete profile return.

## Save the original merchant

Select a READY runtime that contains the merchant console and its product registration. In **Applications**, choose **Merchant operator** and enter:

| Setting | Value |
| --- | --- |
| Merchant configuration | Absolute path to the original merchant configuration, normally `merchant-mcp.json`, with its existing release store, source aliases and provider connections. |
| Saved operator workspace | An existing private console directory, or one new directory inside a private parent. This directory retains the SQLite store, request revisions, native returns and customer transfer checkpoints. |
| Merchant token environment name | The existing token name, normally `MCP_ACCESS_TOKEN`. Enter the name here; keep its value in the selected private environment file or the host environment. |
| Original OAuth configuration | For an OAuth resource host, the absolute path to its original resource configuration. Leave the fixed bearer token empty, as required by the original OAuth host. |
| Private environment | An existing private JSON environment file when the host needs explicit credentials. Its contents remain with the local application. |
| Port | Zero selects a free loopback port. An explicit port selects that port for the original listener. |

Use **Review**, inspect the selected paths, then **Save**. The original Applications connection adopts the selected installed runtime into its existing managed home. Review does a read-only inspection of the console identity. Save creates a requested new private directory after rechecking the reviewed inputs.

The merchant configuration is selected as a whole. Its referenced connection files and fleet plan are retained as original file inputs. A changed file requires a new current review before starting.

## Start, Open and Stop

After the runtime is connected, use **Review Start** and **Start**. Applications invokes the existing `merchant-mcp serve` command with the exact reviewed configuration, console directory, source identity and authorization selection.

**Open** leads to the original `/operator/` page on that same listener. For a fixed bearer host, the private Open address supplies the token in the URL fragment. The original page removes that fragment and keeps the token in memory. For an OAuth host, Open displays the original token sign-in interface, and the original resource host applies its configured authorization to each native operation.

The Host view gives a lightweight snapshot of configured tools and provider ownership. Searching tools and reopening history use the original console. Running a saved request sends its exact original arguments through the configured merchant provider. Workflows arrange those immutable request revisions into complete operations and retain each native call before continuing. Customer transfers retain the original export identity, file hashes and resumable transfer state.

**Stop** closes the owned listener and drains the original console and provider lifecycle. It requests workflow pauses and retains each accepted native request's original outcome. Saved workflow editions, run inputs, ordered progress, request revisions, completed returns, customer files and the SQLite workspace remain in the selected directory. Start the same saved application to reopen that workspace, inspect the retained run and choose **Continue same run**. A new process gets a new instance identity while the workspace keeps its original identity.

Applications uses the existing merchant configuration resource key to prevent conflicting managed owners. The native console also retains an ownership lease in its selected private directory. These controls keep multiple launchers from acquiring the same saved console at the same time.

## What the launch identity binds

The product-owned adapter passes a complete selection to the original native command. It binds:

- The normalized original merchant configuration and the exact configuration/connection/plan file bytes.
- The selected private console directory and its existing SQLite workspace ID, when present.
- The original fixed bearer or OAuth authorization choice.
- The selected runtime’s original merchant, console, transport and lifecycle source files.
- The accepted child process, its startup instance, actual loopback port and actual browser source.

The native host includes the managed binding in its original console snapshot. The Applications observer verifies the returned startup record, selected source files, configuration files and SQLite identity before exposing Open. Fixed bearer starts also verify the authenticated original host snapshot. OAuth starts retain the native host’s internal binding and use the original authorization flow when the user connects.

Installed-source adoption can change the source directory path while retaining the selected source bytes. The binding records both the selected runtime source directory and the adopted release directory.

## Move an unfinished workflow between Applications

Open the destination **Merchant operator** application with its own private console workspace. Its **Host** page supplies the actual destination workspace ID and configuration fingerprint. Review an imported profile and bind it to that host before receiving execution ownership.

On the current owner, pause the unfinished workflow and let its accepted native request return. Use **Hand over and export profile** with the destination identity and a concrete note, then import the complete resulting profile into the destination. Only the named owner continues its remaining native steps. The same process supports a later return to the original source workspace.

Select transfer checkpoints that fit the provider lifecycle. For the original seven-step merchant operation, transfer after staging and after the seller's own Stop result, keeping Start and Stop with the same native merchant owner. The complete [workflow operating guide](WORKFLOWS.md#hand-over-a-paused-run-and-return-it) covers review-copy import, original call recovery, owner release, append-only history receiving and return.

A port change or Applications Stop/reopen preserves the saved console identity. A changed merchant configuration or adopted runtime still goes through the original current-source review and profile binding. Keep the native release/provider state with its existing maintained transfer operation.

## Continue the original customer receiving operation

The maintained receiving command accepts the existing READY runtime, its runtime operator workspace and the original console receiving directory:

```sh
starforge merchant-console-application-receive \
  --runtime-workspace /private/runtime-operator \
  --runtime-id ORIGINAL_RUNTIME_ID \
  --directory /private/original-console-receiving \
  --chromium /absolute/original/chromium \
  --playwright-module /absolute/original/playwright \
  --source-commit COMPLETE_SOURCE_COMMIT
```

The direct source entry is `stellar-forge/mcp-merchant-operator/receiving/console-applications.mjs`. Use the original equipped receiving worker, Chromium and Playwright module, and the source commit selected for that worker’s runtime.

When the directory already contains a completed `console-native-run.json`, the command continues that exact customer. It reads the retained original profile archive and, through Applications, opens the local console, stops and reopens it, then opens the existing imported console. It receives the original saved return bytes, every original customer file and the original customer archive. It also opens the real Requests and Customers pages, including the mobile customer view. This continuation preserves the existing native operation and customer exports.

For the first original receiving operation, the same command supplies the Applications session owner to `receiveConsole`. The original browser workflow initializes its merchant, creates and edits saved requests, stages and starts the selected seller, generates and receives its five-file customer plus manifest, exercises transfer continuation, stops and reopens, and imports the original portable profile. The entire original workflow uses the saved Applications lifecycle.

Both paths retain the saved application IDs, adopted release identity and original run IDs before dispatch. They write a private `console-applications-receiving.json` next to the original receiving files. The record contains the accepted host/workspace identities and completed Stop outcomes; its startup copy omits the private Open token.

A completed command returns its original record on another invocation with the same inputs. If a worker is interrupted, use the retained application and operation IDs to continue its existing work. The original Applications **Recover** and **Stop** actions remain the controls for accepted runs. The first native customer workflow keeps its own receiving checkpoints.

## Product-owned source extension

The contribution `distribution/contributions/merchant-console.json` registers `console/application-provider.mjs` with the existing Applications provider loader. The provider delegates preparation and startup observation to `console/application.mjs`; the selected runtime executes `console/managed.mjs` through the original merchant CLI.

The managed helper exposes `prepareMerchantConsoleSelection`, `startManagedMerchantConsole` and `verifyManagedMerchantConsoleStartup` for original callers that already own their selected runtime and private state. The original `startMerchantMcp` API keeps `consoleDirectory` optional and accepts a managed binding for the same console instance.

The existing distribution component includes the complete merchant operator source, browser assets and receiving modules, including `console/workflow-records.mjs`, `console/workflows.mjs`, `console/public/workflows.mjs` and `receiving/workflow-journey.mjs`. Its recursive source selection carries these files with the original merchant component. The product contribution adds the managed receiving command and its public module exports. The shared Applications catalog, lifecycle, permission checks and managed runtime builder remain the integration surface.

## Complete customer families and retained host review

The saved source selection includes the full Console request, workflow, recipe,
host-comparison and customer modules with their browser assets. A runtime
upgrade therefore reviews the complete installed operating surface before
Start. Earlier work remains in the same selected operator directory.

A configured grant reviewer adds **Customers → Reviewer customer delivery**
with original packet intake, complete Buyer results, closed export, full-file
receiving and reusable delivery or receiving recipes. Its
[complete operating guide](CUSTOMER_REVIEWER.md) follows that whole workflow.
OpenAPI packages, merchant releases and OpenSearch deployments retain their
own original export identities and file owners in the same Customers view.

Use **Host → Review host** to inspect the current configuration, actual tool
contracts and provider declarations against an earlier saved binding. Saving
the displayed review retains a new binding revision with the original drafts,
workflows, calls and customer records. The complete profile archive carries
that history through receiving and return.
