# CoCart customer workspaces in the merchant MCP

Operate an original CoCart workspace through the same merchant MCP installation that already manages stores, releases and customer delivery. The browser application and this provider read and save the same workspace. A native cart, prepared operation, checkout preview and Woo buyer handoff keep their original identities across both interfaces.

The provider adds 18 tools, a host connection and the `init-cocart-workspaces` initializer. It calls the maintained CoCart workspace and original `@cocartheadless/sdk` 1.2.1. The original cart and checkout implementation is in [the CoCart application](../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/cocart/README.md); its [native receiving guide](../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/cocart/native/README.md) operates WordPress, WooCommerce, CoCart and the SF104 checkout together.

## Connect a workspace

Choose a real private directory for each customer workspace. An empty directory can receive an original export or be created from the merchant profile; an existing directory reopens its saved state. Declare paths in a mode-0600 connection file:

```json
{
  "schema": "stellar-forge.cocart-workspace-connection.v1",
  "workspaces": {
    "customer": {
      "label": "Headless customer checkout",
      "directory": "./customer",
      "sdkModule": "/installed/cocart-sdk/package/dist/index.js",
      "profile": "./inputs/merchant-profile.json",
      "handoffs": {
        "checkout": "./inputs/Original_Woo_Checkout_Handoff.json"
      }
    },
    "receiver": {
      "label": "Received customer workspace",
      "directory": "./receiver",
      "receivingInputs": {
        "customer": "./inputs/CoCart_Receiving_Workspace.json"
      }
    }
  }
}
```

Paths are resolved relative to the connection file. The SDK may also be the installed package name `@cocartheadless/sdk`; the original module verifies version 1.2.1 when a live cart action loads it. Review, receive, export and saved-state reads work without loading the SDK.

Create the mode-0700 workspace directories and initialize the merchant host:

```sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-cocart-workspaces \
  --dir /private/cocart-merchant \
  --connection /private/customer-workspaces.json \
  --name "CoCart customer operations"

node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /private/cocart-merchant/merchant-mcp.json \
  --port 3211
```

The existing authenticated listener reads `MCP_ACCESS_TOKEN` from its environment. Configure the existing client with that token and the returned loopback URL. An existing merchant can add `cocartWorkspaceConnection` to its private configuration; the general `init` command also accepts `--cocart-workspaces`. Reload that host to adopt a changed connection.

The connection accepts up to 32 workspace aliases and 128 declared file aliases per input kind. Tools select these aliases. Source intake validates the exact original UTF-8 JSON bytes before creation, reception or attachment. The tool response includes their SHA256 for the subsequent operation.

## Start or receive the customer work

1. Call `merchant_cocart_workspaces` to select a configured alias and its available original inputs.
2. For a new workspace, call `merchant_cocart_source` with `kind:"profile"`. Review its native mapping, then call `merchant_cocart_create` with the returned `sourceSha256` as `expectedSourceSha256`.
3. For a complete existing export, inspect `kind:"receiving"` and its input alias, then call `merchant_cocart_receive` with the same exact source hash. Reception checks the original workspace revision, complete content digest, every object and all reachable object references before publishing that state.
4. Reopen saved work with `merchant_cocart_state`. Keep its returned `workspace.version` for the next change.

Receiving the same original file into its already received directory reopens that operation. The complete export contains the original merchant profile, product catalogs, native exchanges, cart history, prepared operations, checkout previews and attached Woo buyer handoffs.

For an owned native local store, the host may add this optional entry to the workspace connection:

```json
{
  "receivingTransport": {
    "store_url": "http://127.0.0.1:18737",
    "checkout_url": "http://127.0.0.1:18737/checkout/",
    "reason": "Owned native WooCommerce receiving instance"
  }
}
```

Select the actual running instance and its actual permalink path. The original canonical merchant profile is retained alongside this explicit transport. Creation saves it; `merchant_cocart_transport_rebind` applies a newly selected host transport to a received workspace with its current `expectedVersion`. Rebinding a transport does not recreate a cart in another store. Retain the original store database when continuing its native cart keys or checkout.

## Operate the native cart and checkout

Every change takes the current `expectedVersion`. A concurrent browser edit returns a revision conflict; read current state and review the intended change against it.

| Tool | Operation |
| --- | --- |
| `merchant_cocart_catalog` | Fetch and retain an actual native catalog page, original response and server pagination. |
| `merchant_cocart_cart_create` | Create a native guest cart or attach an explicitly selected original cart key. |
| `merchant_cocart_cart_refresh` | Read and retain the selected cart's current native snapshot. |
| `merchant_cocart_cart_prepare` | Prepare add, quantity, remove, restore, calculate or clear against a fresh native snapshot. |
| `merchant_cocart_cart_apply` | Apply the selected prepared operation and retain its response and result. |
| `merchant_cocart_cart_reconcile` | Inspect an interrupted operation and save the selected disposition. |
| `merchant_cocart_checkout_prepare` | Prepare explicit replacement or merged Woo checkout and inspect the current mapping/admission result. |
| `merchant_cocart_woo_attach` | Attach the original checkout's Woo buyer handoff with its exact source hash and preview ID. |

Preserve a stable `requestId` for each prepared mutation and the returned `operationId`. After a lost reply, read the cart's saved operations before continuing that operation. A completed apply reuses its retained outcome. If dispatch was interrupted, inspect the same operation and current native cart using reconciliation. The operator can record `accept_current` or `confirmed_not_applied` with the reason supported by the observed native state.

Checkout preparation returns the original checkout preview. Review its exact total, currency, lines, mapping and `admission`; open the returned URL when ready to continue that checkout in Woo. The preview records whether the selected headless cart replaces or merges with the existing Woo session. Complete the original Woo form, download its payment instructions, declare that original file under `handoffs`, inspect it through `merchant_cocart_source`, and attach it to the preview that produced the order. The attached handoff retains the original order, attempt generation and buyer intent for the existing SF104 payment workflow.

## Read retained work

`merchant_cocart_state` supports:

- `summary`: original profile, source identity, revision and record counts.
- `carts` or `cart`: saved native cart summaries and current projections.
- `events`: the workspace event history.
- `catalogs`: retained native catalog pages and original exchange references.
- `catalog` with `catalogId`: the selected saved page's complete product rows.
- `operations`, `snapshots` or `checkouts` with `cartId`: the selected cart's full retained history.

Paged views use `offset`, `limit` and `nextOffset`. Continue with the first page's `version` as `expectedVersion`; a changed workspace requires a fresh first page. Saved catalog reads use the original retained products without another provider request. The receiving export includes the complete original native object bytes referenced by these views.

## Deliver the complete export

Call `merchant_cocart_export` with a stable `exportId` and the reviewed `expectedVersion`. It produces:

- `manifest.json`, containing the exact workspace version, source and file identity.
- `CoCart_Receiving_Workspace.json`, containing the complete original workspace and every retained object.

Both live beneath the merchant's private customer-exports directory. The export result contains `manifestSha256`; `merchant_cocart_export_status` reopens and validates that same export. A repeated export ID retains the same file bytes and original version, including after later workspace changes. Use a new export ID for a newly reviewed version.

Use the maintained complete-file receiver from the merchant CLI:

```sh
node stellar-forge/mcp-merchant-operator/serve.mjs inspect-cocart \
  --url http://127.0.0.1:3211 --workspace customer --export-id delivery-1

node stellar-forge/mcp-merchant-operator/serve.mjs download-cocart \
  --url http://127.0.0.1:3211 --workspace customer --export-id delivery-1 \
  --out /private/cocart-delivery

node stellar-forge/mcp-merchant-operator/serve.mjs reopen-cocart \
  --workspace customer --export-id delivery-1 \
  --input /private/cocart-delivery --root /private/received-cocart
```

For a previously reviewed export, supply its exact `--manifest-sha256`. Repeating `download-cocart` with the same output directory resumes the original saved byte prefix, verifies every file and completes the same manifest. A provider restart resumes at the same endpoint with the original file selection. Repeating `reopen-cocart` reopens that original receiving operation. The complete source is in `cocart-download.mjs`, using the shared retained download implementation and original `CartWorkspace.receive`.

To download either file through MCP directly, call `merchant_cocart_file` with the workspace alias, export ID, file name and `expectedManifestSha256`. The response contains original file metadata, base64 data, `readId` and `nextOffset`. Decode each chunk and append its bytes at the returned offset. Continue with that `readId`, the original `file.sha256` as `expectedSha256`, and `nextOffset` until it becomes null. Confirm the completed local file's length and SHA256 against the manifest.

Reads use the existing provider-owned retained file reader: at most four active snapshots, a 256 MB aggregate snapshot capacity, chunks up to 196,608 bytes, and a two-minute idle expiry. The final chunk releases its snapshot. `merchant_cocart_file_release` ends a read early. After expiry or a provider restart, reopen the same original file with its expected manifest hash, file hash and current byte offset.

If a process stopped after writing the receiving file but before its manifest, repeating the same export ID validates the retained file and completes its manifest. This preserves the original file. An active `export.lock` identifies the writer of that export directory; check that process before intervening in an interrupted local operation.

## Browser and managed use

The original browser server accepts the same `CartWorkspace` directory. MCP actions use its existing per-operation writer lock and revision checks, so a browser and merchant host can open one workspace concurrently. Saved reads reload current state. Closing the MCP host drains its accepted operations and temporary file reads; closing the browser releases its server. Reopening either returns to the original saved workspace.

Applications integration is maintained with the CoCart managed entry and the merchant installation catalog. It uses the same connection, model and original browser rather than copying the customer state. Follow the installed application's start, status, stop and reopen controls for its owned server.

## Source and customer operation

The original CoCart application and full native WordPress/Woo receiving workflow were integrated through [PR1618](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1618). The shared provider here preserves that implementation and factors its complete receiving validation into `inspectReceiving` for source inspection and immutable export recovery.

The native runner operates an owned store and the actual SDK, then saves its full original cart/checkout workspace, Woo handoff and browser receiving output. Keep source inputs and saved customer exports when continuing an existing native operation.

The complete receiving operation on 12 October 2026 used the original 309,276-byte customer export with 48 objects, 27 native cart snapshots and its attached Woo order. The shared host registered all 18 CoCart tools. The operation created and inspected host-declared workspaces, transferred the full export through the shared file client, stopped after the first 65,536 bytes, restarted the original merchant host at the same endpoint, and resumed the original download to its exact manifest. Both MCP receiving and the installed `reopen-cocart` command opened the same saved workspace and original order.
