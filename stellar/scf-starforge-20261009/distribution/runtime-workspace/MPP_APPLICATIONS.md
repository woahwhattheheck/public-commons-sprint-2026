# MPP merchant and customer in Applications

Open the maintained MPP console from **Runtime workspace → Applications**. The saved application keeps its original private workspace, selected source/runtime, managed release and operation history together. The merchant, customer contracts, purchases, response files and spending governor remain the original MPP workbench.

## Prepare the original workspace and native runtime

Choose a READY Starforge runtime whose selected source includes the complete MPP customer workbench and the native console identity announcement. The existing `starforge mpp` command must be present in that runtime. A newly initialized private workspace can be opened before merchant or customer configuration.

Use the installed command to create a new workspace in an existing private parent:

~~~sh
starforge mpp init /absolute/private/mpp-workspace
~~~

For merchant operation and customer purchase preparation, retain the original MPP dependency directory separately from the distribution's base runtime:

~~~sh
starforge mpp runtime-template /absolute/private/mpp-dependencies
npm --prefix /absolute/private/mpp-dependencies ci --ignore-scripts --omit=dev --no-audit --no-fund
~~~

The template copies the maintained package manifest and exact lockfile. The selected merchant/customer profile names this absolute directory in `dependencyRoot`. The native loader resolves that directory's original published packages: `@stellar/mpp 0.7.1`, `mppx 0.6.29` and `@stellar/stellar-sdk 15.1.0`. The distribution's separate SDK 16 selection stays with its original runtime. An existing matching MPP dependency directory can be reused.

For an already received customer workspace, choose its original directory and retained profile. Follow [the native customer guide](../../mpp-charge/customer/README.md) for complete receiving and source-bound recovery.

## Save and open

Select **New application**, enter a useful name, choose the READY runtime and select **MPP merchant and customer**.

| Field | Meaning |
| --- | --- |
| Initialized private MPP workspace | Absolute, real private directory created by the original MPP initializer or receiving workflow |
| Local port | 0 chooses an available loopback port; a specified port is retained as part of the reviewed command |
| Optional console token environment name | An environment variable name, such as MPP_CONSOLE_TOKEN; leave empty to let the original console create its private token |
| Terminal Python executable | Existing executable used by the original managed PTY; defaults to /usr/bin/python3 |
| Private environment JSON | Existing private JSON file with environment names and string values; can supply the selected console token, native secret-variable values and governor environment |

If a console token environment name is selected, its effective value must be exactly 64 lowercase hexadecimal characters. The original MPP server validates it before acquiring the workspace lease. The application configuration stores the name; the private environment stays on the operator host.

**Review application** displays the exact original command, selected runtime/release, workspace creation time, current profile revision and configured merchant/buyer/customer roles. **Save application** retains that reviewed selection and adopts the selected READY runtime through the existing managed-home connection when necessary.

Choose **Review start**, inspect the current saved files and then **Start reviewed application**. The launch uses positional arguments:

~~~sh
starforge mpp serve /absolute/private/mpp-workspace 0
~~~

With the optional token name, the same original CLI receives:

~~~sh
starforge mpp serve /absolute/private/mpp-workspace 0 --token-env MPP_CONSOLE_TOKEN
~~~

The MPP command does not receive the generic `--port` option. **Open application** becomes available after the original console's startup identity has matched the saved run, actual managed wrapper and original private workspace. The private URL opens the existing MPP workbench in a new tab.

## Operate the full merchant and customer workflow

The original **Merchant** form saves the HTTPS public origin, HMAC secret variable name, isolated dependency directory and editable payment routes. Start or stop its merchant listener from that form. The operator console and merchant listener have separate ports; a reverse proxy serves the merchant's configured public HTTPS origin.

**Customer handoff** exposes the current merchant contract, OpenAPI document and complete Node/TypeScript/Python customer package. The retained package and contract keep the actual offer and request bindings used by the original customer.

**Customer workbench** accepts the original merchant contract or customer package, retains its source and reviewed offer, and configures the existing payer/governor/limits. Request preview preserves method, full URL, body and selected offer. Preparation creates the original saved purchase; execution, resume and reconciliation continue that same purchase. Its history and exact response download remain in the same workspace.

When a native operation needs spending approval, open **Application output** in Applications and read the original governor prompt. Enter the exact requested response with **Send line to original terminal**. Opening the page, reviewing, saving, refreshing and reopening do not send terminal input. The existing governor retains the one accepted decision and native purchase identity.

The legacy **Buyer** form, saved delivery recovery and retained purchase downloads remain available in the original console. Detailed configuration, payment behavior, response status and transaction reconciliation are documented in [Native Stellar MPP Charge](../../mpp-charge/README.md) and [Customer workbench](../../mpp-charge/customer/workbench-guide.md).

## Stop, reopen and receive

Use **Stop application** in Applications to stop the original managed process. Its existing PTY forwards shutdown to the distribution wrapper, which forwards it to the MPP child. The original console drains its owned jobs, closes its merchant listener and releases the original workspace lease.

A browser or runtime-workspace server restart reopens the saved application and its existing operation. **Continue original start** recovers a queued operation using the same request ID. An already launched process is reconciled through the original lifecycle; it is not launched again to recover a missing response. A stopped application needs a fresh **Review start → Start reviewed application**, which creates a new run while retaining the same MPP workspace and purchase history.

A changed merchant/customer profile is expected working data. The next start review reads its current revision and exact saved profile source. If a profile, environment or selected source changes between review and save/start, review that current selection again.

Applications stores its own configuration and run history under the original runtime workspace. The MPP directory separately retains `workspace.json`, `profiles/`, `sdk/`, `purchases/`, `deliveries/` and `reports/`. Keep those original records together with their externally referenced dependency, resource, governor and secret configuration when moving the operator. The source-bound customer receiving commands are the supported path for customer package transfers. A running console owns its MPP directory; a second CLI or independent console uses a different directory or takes over after the original process closes.

For an existing merchant MCP operator, select the same console token environment name and attach that operator to the original running console through its maintained [MPP interface](../../../../stellar-forge/mcp-merchant-operator/MPP.md). The console remains the workspace owner and Applications remains its process owner.

## Maintainer integration

The additive `application-mpp.mjs` exports:

- `mppApplication(common)`: catalog descriptor and original field schema.
- `prepareMppApplication(settings, inputPath, runtimeDirectory)`: exact argv, read-only source/data input pins and `mppBinding` for the original command review.
- `mppStartup(request, line, operationDirectory)`: native ready/identity validation for the existing output observer.

The four existing command-generation paths retain their `runtimeDirectory` and shared Python/event context. The MPP branch adds the helper inputs and `mppBinding`, then skips only the generic final `--port` append. The existing managed request schema, resource lock, launch worker, PTY and recovery remain the common lifecycle.

Input review reads the original private metadata and selected profile wrappers directly. It checks their canonical hash identities without calling `openWorkspace` or acquiring the MPP writer lease. Selected CLI, server, customer-workbench, storage, native-runtime and package-manifest source files are pinned with the reviewed READY source.

The native CLI prints one schema-first `stellar-forge.mpp-console-ready.v1` record. The observer loads the existing application run and start review from the same operation root. It matches the reviewed original workspace creation/metadata/directory identity, actual port and original package versions. It then matches the ready `ppid` to the original PTY's recorded distribution wrapper PID and checks the authenticated `/api/identity` response from that exact loopback console. MPP is a child of the wrapper; direct PID equality would reject the actual command.

The accepted original identity is saved alongside the private URL in the existing `application-url.json`. The ordinary human startup marker remains available in process output, while the structured original record supplies Applications' saved URL.

Useful operator errors:

| Error | Resolve it through the existing workflow |
| --- | --- |
| APPLICATION_MPP_READY_SOURCE_REQUIRED | Select the normal newer READY source containing the original console identity route and announcement |
| APPLICATION_MPP_WORKSPACE_INVALID | Select the original initialized private workspace, or initialize a new one with mpp init |
| APPLICATION_INPUTS_CHANGED | Review the current saved profile, source or environment before saving/starting |
| APPLICATION_MPP_START_WORKSPACE_CHANGED | Reopen the intended original directory and review its current identity |
| MPP_WORKSPACE_TOKEN_INVALID | Correct the selected private environment value or omit tokenEnv for a new original console token |

Source lineage: released Applications PR1345, complete shared customer composition PR1426, original MPP customer workbench PR1387, and native console identity/MCP PR1460. This helper extends those original components.
