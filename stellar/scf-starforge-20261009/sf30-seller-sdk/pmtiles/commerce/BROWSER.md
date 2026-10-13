# Operate paid map delivery in the original workspace

The **Paid map delivery** panel manages an existing PMTiles publication through
the same merchant that serves its MCP tools. It prepares immutable prices,
stages and operates the original SF82 seller, receives original SF88 objects,
adopts purchased resources, reopens complete customer operations, and continues
their original accounting.

## Open the configured merchant

Use the complete [PMTiles merchant installation](../../../distribution/selections/PMTILES_OPERATIONS.md)
with native, operator, schema, OpenAPI and MCP features. The host's existing
PMTiles connection selects the saved workspace and map runtime, seller runtime
aliases, buyer aliases, and receiving targets. Configure those selections using
[PMTILES_COMMERCE.md](../../../../../stellar-forge/mcp-merchant-operator/PMTILES_COMMERCE.md).

Start its existing authenticated merchant MCP server. With the installed
`starforge` command and its selected private configuration:

~~~sh
starforge merchant-mcp serve \
  --config /private/regional-merchant/merchant-mcp.json \
  --port 3211 --token-env MCP_ACCESS_TOKEN
~~~

Save an alias request such as `{"workspace":"regional"}` in a private JSON file,
then open the original workspace and read its console link:

~~~sh
starforge pmtiles-mcp call open \
  --url http://127.0.0.1:3211 --request /private/regional-workspace.json

starforge pmtiles-mcp call console \
  --url http://127.0.0.1:3211 --request /private/regional-workspace.json
~~~

Open the exact returned private URL, including its current access-token
fragment. The paid panel appears in that same map authoring page. Its calls use
the same selected alias, original request queue and authoring owner.

An ordinary standalone map authoring server has the map editor, preview and
portable delivery tools. Open the workspace through the configured merchant
when using paid seller and customer controls. The map operations ZIP includes
the same browser assets; the full merchant installation supplies the configured
payment and buyer runtime.

## Select outputs and prices

Choose **Offer** and **Use current publication**. The displayed release and
manifest identify the exact map publication used by this draft.

Add a published archive, style, sprite, glyph or other original resource.
For complete source/runtime/workspace sales, choose **Prepare complete operations
package**, then select that retained package and **Add output**. An operations
package must contain the same published release selected by the offer.

Every output row has a public ID, download filename, and price in atomic units
for each request. Choose a configured buyer's public payment terms or enter
the merchant's HTTPS origin, network, asset, recipient and timeout. Additional
payment fields use the original offer compiler's JSON input.

The panel displays both the price per request and the complete file cost:

~~~text
requests = ceil(original file bytes / bytes per paid request)
complete cost = requests × atomic units per request
~~~

Prices and totals use exact integer arithmetic. An offer can contain at most
64 outputs, 32 GiB of original bytes and 131,072 aggregate paid requests.
The default request size is 921,600 bytes; the maximum is 1,048,576 bytes.
Choose a larger request size when a small chunk size would exceed the original
index limit.

**Prepare priced offer** captures the complete original files, their hashes,
fixed chunk boundaries, rights, release identity and payment terms. The result
is a retained offer. Editing the draft afterward does not change that offer;
prepare another request when the intended terms or source selection change.

**Download offer draft** saves the current public form and selected source
identities. A later publication leaves the earlier draft intact. Select the
new publication deliberately before preparing an offer from its resources.

## Review and operate a seller

In **Seller**, open the retained offer. Review its complete costs and original
source identities. **Verify retained files** reads the complete selected bodies;
**Download buyer catalog** saves the exact public acquisition descriptor.

Select a configured runtime alias, seller release ID and label, then choose
**Stage selected offer**. This composes the existing SF82 release store and
native seller. The browser selects a configured runtime; its fields do not
accept arbitrary executable paths or facilitator credentials.

Choose the staged release, then **Compare with active seller**. **Activate
reviewed seller** checks the actual active release and generation again.
If another operation changes the selection, compare the current state before
activating.

**Start selected seller** starts the selected original release and retains its
native instance. **Stop owned seller** names that exact owned instance and
drains the accepted native work. Current runtime status controls these buttons.
A saved start response describes that earlier operation; reopening it does not
make a stopped process run again.

The source publication and priced seller release remain distinct selections.
Stopping the paid seller leaves the original map workspace and its saved
editions available.

## Receive a complete customer purchase

In **Customer**, select a retained offer, its exact output and a configured
buyer. The panel shows the complete byte count, immutable snapshot, file hash,
request count, per-request price and full cost. The selected buyer's host
configuration retains its original origin, payment terms and per-request cap.

Choose a total budget covering every request, then **Prepare purchase**. That
retains one original SF88 object plan and its exact catalog/configuration.
**Receive purchased file** continues that same object and assembles its original
bytes. **Recover original purchase** reads and reconciles its retained native
payment and response state after interruption.

A completed map resource can be added through **Adopt received map source**.
A completed operations ZIP can be reopened through **Receive complete
operations**, using one of the host's receiving-target aliases.

The adoption and receiving request IDs stay with the selected purchase.
Keep the same ID when reopening the same imported resource or customer
installation. Enter a new ID only when deliberately creating a separate
customer receiving operation. Reopening the original operations request
preserves that customer's later saved edits and release selection.

The complete portable receiver verifies its original package, declared source,
native runtime, frozen workspace and retained object bytes. The returned
workspace and original serve command are the customer's actual operating
handover. See [PORTABLE_HANDOVER.md](../PORTABLE_HANDOVER.md).

## Continue original accounting

A buyer's configured `operatorWorkspace` selects the original financial
workspace. The panel never asks for signer secrets or creates a replacement
accounting database.

Use **Read accounting range** to inspect a selected original range. Ranges
start at offset zero, default to 100 entries, and allow at most 250 entries.
**Use next range** selects the original returned `nextOffset`; a null value
means that response has no next range.

**Recover accounting command** reads the original retained command and its
latest complete native response. **Finalize this range** reads that recovery
first. A matching complete finalization is reused. Otherwise the same original
range continues through the native idempotent finalizer.

A response is complete only when it belongs to this purchase and exact range,
reports an uninterrupted zero-exit native operation, includes every selected
entry, and has finalized/idempotently-finalized outcomes. A partial command
stays recoverable in its own original records. The browser keeps its selected
request and range so a lost response does not turn a partial report into a
finished page.

The [native environment and accounting guide](NATIVE_ENVIRONMENT.md) describes
the original funded operator, facilitator, private transport selection and
full CLI/MCP continuation.

## Reopen drafts and saved work

The panel retains its public offer draft, selected records and original
pending requests in browser storage, keyed by the browser origin, actual
workspace ID and configured alias.

After an interrupted request, choose **Recover this request**. The exact
saved arguments and original request identity are reused. To continue editing
another draft, choose **Keep request and continue editing**; the request remains
in **Saved work**.

Saved work reads the original offer, purchase, seller-operation and package
directories with bounded pages. It also lists retained browser requests.
Use an exact request ID to reopen an older record that is not on the current
page. **Resume selected original request** calls its original operation with
the stored arguments. A currently unavailable buyer alias is identified in the
record so the operator can restore the intended host configuration.

Changing the selected offer, customer or seller disables its controls until
the selected original record has loaded. Late responses remain bound to their
own workspace and request. A completed older operation does not replace a
later selected purchase.

A merchant close drains its owned work and closes the authoring server. Open
the same workspace again and use its new private console link in the original
tab. The saved authoring port preserves the browser origin; the new fragment
updates the access token while the draft remains available. Keep the full
customer workspace backup as described in the existing Object Buyer
[OBJECTS.md](../../../sf88-operator-buyer-cli/OBJECTS.md) when moving a customer
to another host.

## Read-only workbench API

The additional MCP tool is `merchant_pmtiles_output_workbench`. Its required
field is `workspace`; its sections are:

| Section | Additional selectors | Returned original material |
| --- | --- | --- |
| `summary` | none | Current map publication, public buyer terms, runtime aliases, receiving targets and fresh seller status |
| `sources` | optional decimal `after`, `limit` 1–50 | Exact resources from the current publication |
| `offers`, `purchases`, `operations`, `packages` | optional stable-ID `after`, `limit` 1–50 | Bounded original saved records and continuation cursor |
| `request` | `kind`: offer/purchase/operation/package; `requestId` | Exact public request, retained result and original resume arguments |

This reader adds no second product ledger. Native execution continues to verify
the selected file bodies and original engine identities.

## Same original native receiving

The complete native PMTiles driver supplies the original persistent
`browserDirectory` and its existing `openBrowser({url,directory})` callback
to the paid-output phase. That phase calls
`exercisePMTilesCommerceBrowser` from the complete installed merchant source.

The browser phase reopens the existing priced offer, deliberately loses one
successful preparation response and recovers that exact saved request,
stages/reviews/activates the original seller, starts and stops its owned
instance, and reopens both original customer purchases. It reuses the exact
map-adoption and complete-package receiving IDs and the original finalized
accounting ranges. The edited price draft and map notes are retained through
merchant close/open and the actual token change.

The phase records complete original HTTP requests/results, current native
status, browser storage and a screenshot. Its checkpoint completes only after
the actual response passes the original operation checks. A resumed native
carrier reads the same saved request before continuing. It shares the original
producer, funded environment and purchased assemblies with the whole journey.
