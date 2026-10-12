# OpenCage in Applications

Use the installed Applications screen to run the complete OpenCage operator against its existing private workspace. The same workspace keeps its source plan, payment terms, HTTP observations, candidate decisions, merchant packages, release generations and customer deliveries.

The application opens the original OpenCage CLI and browser. Its Save, Start, output, Stop and subsequent Start use the maintained runtime application, managed release and operation history.

## Prepare the workspace

Select a READY installed merchant runtime containing the OpenCage product and this application helper. The runtime needs the original seller and Stellar dependencies used by the merchant product. An installation that predates the managed launcher must be upgraded through the existing runtime installation flow before this application can be reviewed.

Initialize the workspace with the ordinary OpenCage command and your reviewed plan and payment terms:

~~~sh
stellar-forge opencage-workbench init \
  --workspace /srv/starforge/opencage/customer-locations \
  --plan /srv/starforge/opencage/source-plan.json \
  --terms /srv/starforge/opencage/merchant-terms.json
~~~

The original product guide explains the query contract, actual payment network/asset/recipient, provider environment name, and optional host transport profile. The initialized configuration is immutable. Subsequent captures, selections, packages, customer exports and merchant generations belong to that workspace's normal mutable work.

In Applications, select **OpenCage geocoding** and enter:

| Field | Meaning |
| --- | --- |
| Initialized OpenCage workspace | The absolute canonical directory just initialized, or an existing original workspace. |
| Local port | Use 0 for an available private port, or an explicitly chosen local port. |
| Private environment JSON | Optional existing private environment file for the named OpenCage key and selected proxy environment reference. The managed runner handles this file through its existing private environment contract. |

A workspace containing completed observations can open without provider or proxy credentials. A fresh capture uses the source plan's original credential and transport settings. Review the exact query in the operator before initiating a provider request.

## Review, Save and Start

Review shows the original command, initialized workspace, selected source files, environment-file identity and runtime release. The saved command includes the complete original managed selection. That selection records:

- The canonical workspace directory, its filesystem identity and immutable configuration hash.
- The original workspace, source-plan and payment-terms identities.
- The exact twelve OpenCage executable and browser files from the selected runtime.
- The source identity to require again from the adopted managed release.

Save keeps this review in the existing Applications store. Review Start immediately before starting the saved application. The original controller rechecks the current input files and selected release before dispatching its retained managed operation.

Start opens the original workspace under its existing exclusive writer lease. The selected and actually executed source directories must contain the same reviewed bytes. The CLI prints one compact startup announcement after the private operator answers its authenticated instance read. The managed observer verifies that same source/workspace selection and private instance before presenting **Open**.

The browser URL is a private session capability. Use the URL from the current saved application; the original browser's requests use its session token. A later Start creates a fresh process and browser session while retaining the saved workspace.

## Work through the original operator

The managed browser provides the complete merged OpenCage product:

1. Inspect the original source plan, forward or reverse product, query parameters and selected host transport.
2. Review a query and retain its original provider attempt, or import its exact HTTP observation and complete response after an interrupted reply.
3. Review the returned candidates and save an explicit candidate index against the response hash and current decision revision. A zero-result response remains a completed provider outcome with no selected candidate.
4. Export the complete response, CSV, GeoJSON, selection, provenance and returned data licenses. The customer browser reopens those exact delivery files.
5. Prepare the generated merchant SDK and package, compare exact payment terms, and stage the package through the original seller release store.
6. Activate, start, compare prices, restart and roll back using the current original release generation.
7. Recover an existing original Buyer operation through the CLI or merchant MCP workspace and retain its selected package, public origin, terms and response together.

The managed launcher does not dispatch a provider query or start a merchant sale merely by opening the operator. Those actions remain the explicit original workspace operations visible in the product.

Use the existing merchant MCP guide when operating the same saved workspace through its fifteen tools. The original workspace permits one writer at a time: use the current application browser while it is running, or Stop it before opening that workspace through a separate CLI or MCP-owned operator. Multiple browser tabs may use the same running operator.

## Stop, reopen and recover

Stop acts on the original managed operation. The OpenCage server finishes accepted work, closes the original merchant runtime and source transport, and releases the workspace lease. Captures, candidate decisions, packages, delivery files and release history remain in their existing paths.

A later Start uses a new managed process with the same saved application and workspace. Reopen a completed request or delivery by its original ID. After an interrupted provider response, inspect that retained attempt before using the original observation import. The existing capture path requires exact observation and response bytes for reconciliation.

Use the maintained application output and operation history for an interrupted launch. If dispatch never began, the original managed recovery can continue that same request. If an OpenCage process still holds the workspace, open or stop that process through its original operation before starting another writer.

The following errors identify concrete review or launch changes:

| Result | Action |
| --- | --- |
| GEOCODE_MANAGED_WORKSPACE_CHANGED | Reopen the original workspace and review its current configuration. Selecting a replacement directory requires a fresh review. |
| GEOCODE_MANAGED_SOURCE_CHANGED | Select the intended installed runtime and review its original source again. The adopted release must match the selected OpenCage source. |
| GEOCODE_MANAGED_SELECTION_CHANGED | Use the complete saved application selection and current Start review. |
| APPLICATION_INPUTS_CHANGED or APPLICATION_RELEASE_CHANGED | Refresh the original Applications review for the selected inputs or release. |
| GEOCODE_MANAGED_OPERATOR_UNAVAILABLE | Inspect the original managed output and live process. The private operator must answer the authenticated instance read before its URL can be accepted. |
| GEOCODE_MANAGED_OPERATOR_CHANGED | Reopen the current managed operation; its original process, session and saved selection must agree. |

The original host capacity, disk retention and operation recovery remain the managed runner's responsibility. The application helper uses that existing lifecycle.

## Maintainer composition

The complete source-owned helper is:

`distribution/runtime-workspace/application-opencage.mjs`

It exports:

- `opencageApplication(common)`: the existing catalog entry, command `opencage-workbench`, application ID `opencage-workspace`, terminal false, and the private workspace plus common port/environment fields.
- `prepareOpenCageApplication(settings, {inputPath, runtimeDirectory})`: returns the original CLI args, exact workspace/configuration/source inputs, and `createDirectories: []`.
- `opencageStartup(request, text)`: verifies the exact saved managed selection, original selected/adopted source and the authenticated running operator; returns `{url, original}` or null for unrelated output.

The common catalog writer adds the helper import and `opencageApplication(common)`, then routes `type.id === 'opencage-workspace'` to the existing argument/input composition:

~~~js
const original = await prepareOpenCageApplication(settings, {inputPath, runtimeDirectory});
args.push(...original.args);
inputs.push(...original.inputs);
createDirectories.push(...original.createDirectories);
~~~

The original serialized stdout observer routes `request.command === 'opencage-workbench'` and the prefix `{"schema":"stellar-forge.opencage-application-startup.v1",` through `await opencageStartup(request, text)`, then saves the usual application-url record with the returned original identity. The common port, private environment, resource key, review, managed release and process control code continue to own those contracts.

The OpenCage-owned `launch.mjs` exports the read-only selection and startup functions used by the helper. Its compact authenticated `/api/managed-launch` response belongs to the existing private server and contains only the reviewed launch identities, actual instance ID and PID. Original source plans and environment values remain in their normal private custody.

The whole SF30 source component includes the native launcher and its twelve-file source selection. The existing distribution component includes this helper. The original opencage-workbench command and public OpenCage/MCP exports continue from PR1270.
