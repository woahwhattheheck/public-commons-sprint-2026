# Managed Public Assistance application

The **Public Assistance portfolios** entry opens the original OpenFEMA application through the installed Applications lifecycle. Its provider is `openfema-public-assistance`; its native command is `openfema-workspace`.

## Select the actual workspace

Supply the existing private workspace directory, or a new directory beneath an existing private parent. Optional fields select the original buyer inbox, merchant runtime JSON and identifying User-Agent. Common Applications fields retain its local port and original environment settings.

Preparation reads the selected release's original workspace/core/schema modules and native store identity reader. An existing workspace is bound by its UUID in `--expected-workspace-id`. Its mutable workspace JSON is not frozen as an input file, so normal capture progress and operator decisions remain valid when the same application restarts.

A new directory is created by the existing Applications launch operation. This adapter does not start a parallel writer or open the store during preparation. Reopening uses the same workspace directory; the native store owns its original one-writer lifecycle.

## Native startup contract

The original command accepts:

~~~text
--workspace DIRECTORY
--startup-format json
--expected-workspace-id UUID       optional for an existing workspace
--inbox DIRECTORY                 optional original buyer inbox
--release-runtime PRIVATE_JSON    optional existing merchant runtime
--user-agent PRINTABLE_TEXT       optional provider identification
--port PORT                       optional; 0 selects an available port
~~~

The startup line has schema `stellar-forge.openfema-workspace-startup.v1` and status `OPENFEMA_READY`. It identifies the exact workspace directory/UUID, inbox, runtime file, source directory, User-Agent, process and original loopback URL. The provider compares these fields with the retained launch request and actual native workspace UUID before recording the original URL.

This is the existing application's startup and connection contract. No extra user login or independent session service is introduced by the launcher. The private original URL remains in the managed application's normal URL record and is not put in public source, reports or work orders.

The managed URL record is the input `applicationUrlFile` used by the complete merchant attachment in [MCP.md](MCP.md). A legitimate native restart can change its port/session while preserving the original UUID and workspace. The tool client reads the current record; no new capture or action identity is needed.

## Staff workflow and receiving

Use the same browser to select a complete retained source cohort, create a portfolio, inspect all six tables, record analyst decisions and compare immutable versions. Dataset creation, publication and completed customer receiving use the original shared engines. New revision and generation inputs are taken from the actual displayed original state.

The merchant tool surface performs the same operations through that running browser service. Typed call payloads, action outcomes, whole source/export receiving and offline verification are documented in [MCP.md](MCP.md). An interrupted action remains associated with its original operation ID; read that record and continue it rather than starting a duplicate.

Complete portable creation/restoration belongs to the original OpenFEMA workspace and receiving guide. The launcher opens the resulting actual directory through its native identity reader. A different restored UUID, if deliberately created by that workflow, must be selected as that distinct workspace in the host connection; never relabel an unrelated store as an earlier UUID.

## Package composition

`distribution/contributions/openfema.json` selects the source-owned application/provider and merchant/provider modules, native browser asset manifest, client/type declarations and operating guides. The maintained distribution composes this contribution with the same original source closure. No central Applications or merchant registry file is forked.

The launcher requires the matching whole product release. The complete source directory contains workspace, core, schema, capture, domain, dataset and exports implementations plus its web assets. Only the original running application performs provider operations; source inspection and launch preparation perform none.
