# CoCart in managed Applications

This entry runs the original CoCart customer workspace inside the maintained
Applications lifecycle. It preserves the same saved guest carts, native response
objects, operation identities, checkout previews and original Woo order handoffs.
Setup receives an existing complete workspace or creates one from the original
merchant profile. Review and Start read the saved state locally.

The console and shared merchant MCP provider can select the same private
directory. Both use the original CartWorkspace version check and per-operation
writer lock. Opening the console reopens the existing customer case. Cart
creation, native mutations, checkout and order attachment remain explicit
original actions.

## Select the installed source and SDK

Use the sourceRoot of the selected installed merchant runtime. Its source entry is:

    stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/cocart/managed.mjs

The installed distribution command is starforge cocart-managed. The direct source form is:

    COCART_SOURCE=/absolute/source/stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/cocart
    node "$COCART_SOURCE/managed.mjs" help

Use the pinned original @cocartheadless/sdk 1.2.1. An installed package resolves
normally; a separately retained SDK uses its absolute module entry. The original
SDK archive contains package/dist/index.js. The managed reader verifies the SDK's
own version and retains the entry path, bytes and SHA-256. The original SDK
commit, Community 4.9.7 plugin profile and SF104 source remain in SOURCE.

Keep the original merchant profile contract described in README.md: selected
store and checkout origins, native product mapping, exact minor-unit amounts and
Woo/SF104 payment terms. The managed layer uses that existing native validation.

## Receive an existing complete workspace

Choose an operator-owned private directory and the complete original CoCart
receiving JSON. It contains the native workspace, original version, all referenced
objects and the complete receiving digest.

    node "$COCART_SOURCE/managed.mjs" setup \
      --directory /private/cocart-customer \
      --input /private/inputs/CoCart_Receiving_Workspace.json \
      --sdk /opt/cocart-sdk/package/dist/index.js \
      --connection /private/config/cocart-workspaces.json \
      --alias customer \
      --label "Original customer cart" \
      --merchant-directory /private/cocart-merchant

The connection's parent must already be a real mode-0700 directory. First
receiving uses an empty directory. The original receiver checks every object
and the complete reachable closure before selecting the workspace; an
interrupted receiving operation can resume the same input using its native
marker. Original workspace bytes and revision survive receiving.

The optional merchant directory is initialized through
initializeCocartWorkspaceMerchant in the existing shared merchant provider.
Setup returns the exact merchant-mcp.json path. Repeating setup can reopen the
same connection and completed merchant configuration. An existing configuration
for a different connection remains intact; select its intended original path.

The receiving export retains its original transport URL. When a real local
receiving server moves, use the original transport.rebind workspace action with
its new loopback store URL, checkout URL and reason. The original workspace
records that change. Its canonical merchant origin, native mapping and complete
source history remain selected.

## Create from the original profile

Creation uses the same native CartWorkspace constructor and profile validation.

    node "$COCART_SOURCE/managed.mjs" setup \
      --directory /private/cocart-customer \
      --profile /private/inputs/native-store-profile.json \
      --sdk /opt/cocart-sdk/package/dist/index.js \
      --connection /private/config/cocart-workspaces.json \
      --alias customer \
      --handoff checkout=/private/inputs/Woo_Checkout_Handoff.json \
      --receiving-input previous=/private/inputs/CoCart_Receiving_Workspace.json \
      --merchant-directory /private/cocart-merchant

Repeat --handoff name=FILE and --receiving-input name=FILE with distinct aliases
to declare additional original host files. The merchant provider resolves these
names for its original inspect, receive and attach actions.

Initial profile creation can also select
--receiving-transport /private/inputs/receiving-transport.json. Its fields are
store_url, checkout_url and reason. The original constructor validates the
loopback transport and records its selection. Omit that creation-only option
when reopening a saved profile; use the retained transport.rebind action for a
later change. Reopening a created profile checks its exact original source bytes.

The emitted private file follows the existing provider contract:

    {
      "schema": "stellar-forge.cocart-workspace-connection.v1",
      "workspaces": {
        "customer": {
          "label": "Original customer cart",
          "directory": "/private/cocart-customer",
          "sdkModule": "/opt/cocart-sdk/package/dist/index.js",
          "profile": "/private/inputs/native-store-profile.json",
          "handoffs": {
            "checkout": "/private/inputs/Woo_Checkout_Handoff.json"
          }
        }
      }
    }

The raw merchant configuration field is cocartWorkspaceConnection; the provider
reads it as config.cocartWorkspaces. Connections authored through the original
configuration workflow can declare multiple aliases. The native configuration
reader remains the authority for aliases, private paths and input selection.

## Review, save, start and open

Select **CoCart customer workspace** in the installed Applications page.

| Setting | Meaning |
| --- | --- |
| Original private CoCart workspace | The created or received native directory. |
| Original CoCart SDK module | Optional absolute SDK 1.2.1 entry; otherwise use the runtime's installed SDK. |
| Private CoCart merchant connection | Optional original connection selecting the same directory and SDK. |
| Connection workspace alias | Select an alias when the connection contains several workspaces. |
| Local port | Zero selects an available loopback port. |
| Private environment JSON | Existing Applications environment mechanism; values remain on the host. |

Review and Save retain the original directory identity, selected source files,
current workspace version, SDK entry and optional private connection. The
application uses the existing runtime adoption and source release. Review start
reads the native workspace again: each Start has its own current reviewed
version, and the saved application remains reusable after ordinary cart work.

Start forwards serve to the original managed CoCart entry. It compares the
reviewed source fingerprint with both the selected runtime and adopted command
source. The native server emits one startup line with schema
stellar-forge.cocart-workspace-startup.v1, status COCART_WORKSPACE_READY, the
workspace/source/SDK/connection identities and a new live instance ID.

The existing serialized Applications observer verifies that line and reads
/api/identity from the same token-bound listener. Open is retained only after
the actual live instance, source and directory match. The console uses the
canonical loopback origin, including port 80. Its token stays in the private
application URL and is excluded from the retained identity object.

The additive helper contract is:

- cocartApplication(common) supplies the existing catalog card.
- prepareCocartApplication(settings, {inputPath, runtimeDirectory}) returns
  args, inputs, createDirectories and resourceKey.
- cocartStartup(request, text) returns {url, original} after native live readback.

The shared preparer adds its one ordinary --port option. Its original serialized
observer records the returned identity in application-url.json. The common
managed worker remains the process and stop authority.

## Operate the same customer case

The console keeps its existing complete workflow:

1. Read the selected profile, original guest cart and full native history.
2. Load a catalog or refresh a selected cart when the configured store is live.
3. Prepare and apply a cart change with the original operation identity and
   reviewed version. An uncertain dispatch uses the original reconciliation.
4. Compare the current exact cart with the merchant product/payment mapping,
   then explicitly choose replace or merge checkout.
5. Open native Woo checkout and attach its original SF104 handoff to the same
   checkout preview.
6. Export the complete original receiving JSON and reopen it on the selected host.

Amounts retain original minor-unit integer strings. The original native
buyer/handoff validator remains the order and payment contract.

The shared merchant provider supplies retained catalog/cart/history pages,
native cart actions, original Woo attachment and immutable receiving exports.
Its CLI includes init-cocart-workspaces, inspect-cocart, download-cocart and
reopen-cocart; the shared CLI help supplies their exact argument forms.
cocart-download.mjs exports parseCocartManifest, inspectCocartExport,
downloadCocartExport and reopenCocartExport over the maintained retained-download
and CartWorkspace receiving interfaces.

## Stop, reopen and continue

Stop uses the existing managed worker. The original console stops accepting new
actions, drains accepted requests and closes its listener. An in-flight SDK
exchange completes under the native per-operation writer lock. Its saved
response, cart, source objects and preceding application runs remain available.

Reopen the saved application, Review start and Start again. The new listener has
a fresh token and instance ID while the original directory and customer history
remain selected. Earlier snapshots and checkout previews retain their original
source and workspace versions.

After a carrier interruption, reconcile the original Applications operation and
native writer.lock process before resuming the retained operation. Use the
existing worker's recovery actions and saved process state. Receiving and
reopening continue the existing cart/order case.

Setup is separable from live console start. A downstream configuration failure
leaves the received workspace available:

    node "$COCART_SOURCE/managed.mjs" inspect --directory /private/cocart-customer

Select the original directory and connection when continuing. A connection is
created only when absent, or reused when its bytes match exactly. Named inputs
remain the original host files. Native setup accepts complete regular input
files up to 64 MiB; its connection reader accepts private JSON up to 1 MiB.

## Delivered source and installation

managed.mjs owns setup, original inspection and console launch. server.mjs keeps
the existing actions/assets and adds optional managed identity plus request
draining. application-cocart.mjs supplies catalog, preparer and startup hooks.

The launch fingerprint covers the managed/native entry files, browser assets, the original route manifest/loader
and immediate buyer interface. The enclosing installed release manifest retains
the full source and dependency closure. Its selected identity carries through
source packaging, runtime adoption and the original Applications request.

The original server's three unchanged browser routes are registered in browser-assets.json.
Both server and distribution use readBrowserAssets from the existing shared collector.
The cocart contribution registers the same server/manifest pair, SDK feature and
native command/import entrypoints, so the installed console retains its complete assets.
