# Tenderly in Applications

Open the complete Tenderly merchant from the installed Runtime Workspace. The
existing Applications launcher retains the selected runtime, private workspace,
initial plan, environment reference and original process operation. Tenderly
keeps its own profiles, request tickets, provider observations, operation
generations and complete responses.

## Select the installed runtime and workspace

Use a READY runtime containing the original tenderly-workspace command and
distribution/runtime-workspace/application-tenderly.mjs. The runtime's source
manifest identifies the delivered edition. The receiving host needs Node 22.16
or later and the dependencies selected for its original merchant runtime.

In **Applications → New application**, choose **Tenderly simulation merchant**.

| Setting | Original input |
| --- | --- |
| Private Tenderly workspace | The existing or received complete workspace directory, or one new directory in an existing private parent. |
| Initial merchant plan | Optional original stellar-forge.tenderly-merchant-plan.v1 JSON. Its exact bytes are reviewed before import into the original profile store. |
| Original HTTPS facilitator | Optional existing facilitator for the saved Stellar payment terms. Merchant startup retains its original challenge mode when this is omitted. |
| Local port | Use 0 to choose an available original loopback listener. |
| Private environment JSON | Optional original Applications environment file, owned by the operator with mode 0600. |

The environment uses the exact provider access-key and stable operation-key
names in the merchant plan. Applications retains the environment file's path
and hash. Its existing worker reads values into the child environment when
launching. The operation key must remain the same when reopening issued tickets
and retained merchant operations.

An optional initial plan is validated by inspectPlan from the selected
installed product. Existing saved profiles remain available. When opening an
already populated workspace, the initial plan may be omitted and the operator
can select its original profile in the merchant interface.

## Review, launch and open

1. Select **Review application**. Review the installed source, exact workspace
   directory, original command, environment reference and optional plan path.
   The command carries the original workspace identity file's SHA256; a new
   workspace carries the explicit new initialization selection.
2. **Save application** retains that selection and connects the original READY
   runtime through the existing managed release.
3. **Review start**, then **Start reviewed application**. The worker verifies
   the original inputs again and calls tenderly-workspace in that runtime.
4. **Open application** uses the actual private URL announced by that original
   process. The native startup binds its workspace ID, exact identity-file
   hash, initial-plan bytes, facilitator and selected local port.
5. In Tenderly, review/save the merchant profile, prepare and open it, issue the
   customer's pinned historical request and explicitly start the original
   merchant. The browser's **Drain and stop merchant** control retains that
   profile's original operation state.

The launch checks run before initial-plan profile import or seller work. A
changed identity file, replaced plan or newly initialized directory after a
review returns a conflict for a fresh review. The existing workspace is kept.
Launching the operator interface creates no simulation or native purchase.

The startup line has schema stellar-forge.tenderly-workspace-startup.v1 and
status TENDERLY_WORKSPACE_READY. Applications accepts its URL only for the
selected original command and matching workspace, plan and port. It stores the
private URL in the existing managed operation.

## Retained simulation and customer delivery

Use the [merchant workspace](../WORKSPACE.md) for the complete operating path:

- Prepare a profile with the original provider account/project, EVM network,
  explicit Stellar terms and limits.
- Issue and retain an exact request packet containing the original operation
  ticket, request hash, expiry, customer identity and public request body.
- Hand that private packet to the original [Node/Python customer](../CUSTOMER.md).
  Its own review, approval, payment and result retention remain authoritative.
- Reopen a completed merchant result or inspect the original uncertain
  operation. Retrieve a known saved-provider simulation through the original
  account/project lookup, review its matching observation and current
  generation, then apply that exact observation with its provider reference.
- Download the complete original response. The byte count and SHA256 identify
  the full representation, including bytes beyond the browser preview.

A saved-provider lookup reopens retained observations unless an explicit refresh
is requested. A later provider error remains in the original history alongside
an earlier match. Original EVM execution, native payment and complete response
delivery remain visible in their corresponding records.

## Stop, restart and receive

**Stop application** addresses its original managed operation. It closes the
Tenderly server through the existing shutdown path, drains a running merchant
and retains the workspace. Closing or reopening the Runtime Workspace browser
keeps that original process operation available.

After a lost launch reply, read the saved application and original run. Use
**Continue original start** for its pending operation, or review a new start
after the original process has ended. A new process returns its own private
URL and reopens the same workspace identity and retained data.

To move the merchant, first drain and close the current owner, then receive the
complete private workspace through its existing authenticated backup route.
Preserve workspace.json, all saved profiles and requests, prepared packages,
operation databases and provider observations together. Select the received
directory in Applications and review its current identity.

The original product preparer verifies each prepared package at its current
location. Its reopened paths are derived from that received package, so the
merchant uses the received operation database and retained responses. Keep the
stable operation key available under the plan's original environment name.

For agent operation, stop the Applications-owned workspace and declare that
same directory in the original
[merchant MCP connection](../../../../../stellar-forge/mcp-merchant-operator/TENDERLY-WORKSPACE.md).
The MCP then opens its own browser/model instance; its agent tools and returned
browser URL operate that same saved workspace. Close through
merchant_tenderly_close with the current instance ID before returning the
directory to another original operator instance.

## Original CLI binding

The Applications helper supplies these optional original CLI bindings:

~~~sh
starforge tenderly-workspace \
  --state /private/tenderly-workspace \
  --expected-workspace-sha256 EXACT_REVIEWED_WORKSPACE_FILE_SHA256 \
  --plan /private/tenderly-plan.json \
  --expected-plan-sha256 EXACT_REVIEWED_PLAN_FILE_SHA256 \
  --facilitator https://your-selected-facilitator.example \
  --port 0
~~~

For a deliberately new workspace, the first expected value is new. Omit both
plan options when reopening only its saved profiles. The established direct
launch without expected-hash options remains available; Applications supplies
them to bind its queued launch to the inputs already reviewed.
