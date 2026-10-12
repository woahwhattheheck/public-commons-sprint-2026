# Managed EPA ECHO application

The `epa-echo-portfolios` application is contributed by the product's original source. It uses the existing Applications catalog, reviewable input selection, process owner, private startup record and stop/reopen lifecycle.

## Source and launch fields

The installed command is `epa-echo-workspace` and its entrypoint is `epa-echo/workspace.mjs`. The separate `epa-echo` command remains the original action CLI.

| Field | Original input |
|---|---|
| Private EPA ECHO workspace | Existing original workspace, or a new directory in an existing private parent |
| Original buyer inbox | Optional existing SF88 inbox holding the selected completed customer page intents |
| Private merchant runtime JSON | Optional original port/facilitator settings interpreted by SF82 |
| Identifying User-Agent | Optional printable provider identification |
| Common Applications settings | The original manager's process and listener settings |

The product-owned `application-launch.mjs` reads the selected installed runtime through `inspectMerchantRuntime`. It adds the original `workspace.mjs`, `schema.mjs`, `core.mjs` and shared store module to the manager's reviewed input set. The application contribution includes every static browser asset.

An existing workspace is identified by its original UUID before opening the writer. The launcher places that UUID in `--expected-workspace-id`. Captures and staff reviews can update the same mutable workspace without invalidating its identity. A different workspace at the original path is reported as a changed selection.

## Operate the full application

1. Select **EPA ECHO facility portfolios** from the installed Applications catalog.
2. Select the private workspace and any existing inbox/runtime files. Review the original input plan.
3. Start through the existing manager and open its returned private application URL.
4. Create or select facility portfolios, retain original EPA searches/reports and inspect the actual source tables.
5. Compare retained editions, save source-linked staff reviews and prepare/query the original dataset.
6. Operate the original publisher generation and receive completed original customer page outcomes.
7. Export the complete workspace, then receive that original package into the selected receiving workspace and inspect its preserved state and files.
8. Stop through the original manager and reopen the same selected application.

The startup observer accepts only the original `stellar-forge.epa-echo-workspace-startup.v1` / `EPA_ECHO_READY` record. It checks the requested workspace, inbox, runtime file, installed source directory, process ID, stable workspace UUID and actual loopback URL. The source store reopens the same UUID before the manager records the URL.

The returned `applicationUrlFile` can be selected by the existing merchant MCP connection. This lets the MCP adapter follow the current original session after a managed restart without taking over the browser writer.

## Browser continuation

The browser places the session capability in the Authorization header and removes it from the address bar. Saved forms and pending actions are keyed by the authenticated original workspace UUID. Reopening that workspace on a different listener preserves the original browser draft; another workspace on a reused port receives separate state.

Every mutation retains its `operationId`, original payload and opened revision before sending. A lost reply keeps the same request for explicit continuation. Revision conflicts preserve the entered form and display the latest selected records for review.

Source and complete-workspace JSON imports retain a small file fingerprint and selected metadata, instead of filling browser storage with the complete bundle. After a reload, select the same original file to reconstruct the exact pending request. The file's original bytes and request-bundle hash remain available in that saved selection.

## Customer and original workspace files

The customer panel downloads the original five SF100 files through the authenticated workspace. Complete workspace export retains original portfolios, source reports, immutable editions, staff review history and working records.

A received workspace remains available as its original state, editions and file manifest. Staff can browse and download the original relative paths. The receiving record keeps the original source workspace UUID, revision and package identity. The source's live merchant processes and private host credentials remain governed by their original owner.

For scripted receiving, use the product's `epa-echo-mcp` client and the original retained file transfer described in [MCP.md](MCP.md). It supports same-directory partial downloads, current authenticated listener changes and offline original-byte verification.

## Source composition

The distribution contribution is `distribution/contributions/epa-echo.json`. Its declarations select:

- original workspace and action CLI commands;
- the browser asset manifest;
- this product's application provider and launch adapter;
- the lazy `epa-echo-workspaces` merchant provider;
- original schema, provider, domain, dataset, portable receiving and file client exports;
- the maintained product and operator guides.

All launch behavior remains inside the source-owned product and the existing generic Applications/merchant registries. The final cumulative source selection must include this complete contribution and its declared imports.
