# Installed OData source, merchant and customer workflow

The maintained `@tokenjunkielabs/starforge-merchant` source distribution includes
the original OData provider, retained operator, dataset publisher, live merchant
and SF88 customer receiving. Use **Node.js 24 or later** for this feature: its
JSON parser retains the exact original Decimal and Int64 number text.

Install the supplied maintained archive using the original
[distribution guide](../../distribution/README.md), then use these commands from
the application directory:

```sh
npx --no-install starforge odata --help
npx --no-install starforge odata-live --help
npx --no-install starforge odata --workspace ./orders-workspace serve
```

`odata` opens the retained operator and its source, edition, publisher and live
controls. `odata-live` operates a portable live merchant package directly. Both
commands invoke the maintained modules with their original arguments. Keep the
workspace and merchant state directories outside the installed source release.

## Receive an original workspace

An `odata-workspace.json` transfer includes the original metadata, queries,
response pages, reviews, normalized rows, dataset exports and prepared live
packages. Restore it into a new workspace:

```sh
npx --no-install starforge odata --workspace ./received-orders restore \
  --input ./odata-workspace.json
npx --no-install starforge odata --workspace ./received-orders serve
```

The browser's source, query, capture, edition and merchant views operate that
same directory. `status` prints retained IDs for terminal operation. Use
`resume --id EDITION --pages 10000` to continue a paused source import and
`backup --out NEW_FILE.json` to create its next portable transfer. The original
server continuation governs the end of capture; a page-size preference does not
guarantee a returned page size.

## Embed the maintained API

The installed exports include ESM declarations for TypeScript `NodeNext` /
`Node16` module resolution. Node's standard types supply Buffer, HTTP and abort
types. Application callers use the package subpaths, with no source checkout:

| Import suffix after `@tokenjunkielabs/starforge-merchant` | Maintained API |
| --- | --- |
| `/seller/odata` | Provider, workspace, server, publisher, live controller and `live` namespace |
| `/seller/odata/source` | `discoverService`, `compileQuery`, `fetchPage`, `parsePage`, metadata and entity selection |
| `/seller/odata/workspace` | `openODataWorkspace`, `fieldValue`, `rowKey` and retained state interfaces |
| `/seller/odata/server` | `startODataServer` and original listener lifecycle |
| `/seller/odata/publisher` | `openODataPublisher` with original SF82 releases and generations |
| `/seller/odata/live` | Merchant plans, saved-query template, portable packages, original seller and SF88 receiving |
| `/seller/odata/live-operations` | `openODataLiveOperations`, the controller used by the existing operator |

This example opens a received workspace and reads its accepted edition:

```ts
import { openODataWorkspace, fieldValue }
  from '@tokenjunkielabs/starforge-merchant/seller/odata/workspace';

const workspace = await openODataWorkspace({ directory: './received-orders' });
try {
  const state = await workspace.state();
  if (!state.activeEdition) throw new Error('Select an accepted source edition.');
  const edition = await workspace.edition(state.activeEdition);
  const rows = await workspace.rows(edition.id);
  console.log({ rows: rows.length, pages: edition.pages.length,
    freight: rows[0] ? fieldValue(rows[0], 'Freight') : null });
} finally {
  await workspace.close();
}
```

`fieldValue` distinguishes `value`, `null` and `missing`; source rows retain
nested properties and original annotations. Decimal and Int64 values are strings
such as `"32.3800"`. Provider counts are `string | null`. The dataset export adds
a state column for every projected property and preserves exact numeric text.

For direct source capture, call `discoverService({url, authEnv})`, then
`compileQuery(catalog, {entitySet, select, filters, orderBy, top, pageSize})` and
`fetchPage({catalog, query})`. Pass each returned `nextLink` as the next `url`.
Retain a page before advancing. `parsePage` reopens the same original bytes without
fetching them again. `authEnv` names a host environment variable containing the
complete Authorization header; transfers retain its name. Transport options
include an AbortSignal, timeout and response-byte ceiling. The retained workspace
implements page commitment, pause and restart over these same calls.

## Prepare and operate the live product

In the existing operator, select a reviewed query and open its live service
controls. Set the public HTTPS origin, Stellar network, asset, recipient and
atomic amount per successful provider page. The controller prepares a durable
package and starts or reopens the original live merchant. The same operation is
available with `odata --workspace DIRECTORY live prepare --input PROFILE.json`,
`live run --id SERVICE`, `live detail --id SERVICE`, `live buyer` and `live receive`.

For an embedding application, `templateFromWorkspace(workspace, {planId,
publicOrigin, payment, amountAtomic})` derives the merchant from the selected
saved entity and query. `prepareFromWorkspace` consumes that template and the
same saved plan. Its declared source filters and Boolean mode retain the selected
scope. `writePackage` and `readPackage` carry the resulting catalog, merchant
contract, offers and selected request. `startODataMerchant({plan, catalog,
directory, nativeFactory})` opens the original seller, supplier runtime,
operations listener and delivery journal. Reuse the private `directory` when
reopening so the merchant continuation identity remains available.

`pageSize` is the provider preference, `maxPageRows` is the hard response ceiling,
and `top` limits total rows across the query. The response reports `seenRows`,
exact `count`, and `completion: continue | provider | limit`. Submit the original
returned cursor by itself for each following paid page. Configure the existing
facilitator/native factory for payment execution; the original seller reports
its current runtime mode and operations address.

## Customer handover and recovery

`prepareBuyerHandoff` writes the original SF88 offers, pinned request, buyer
configuration and handoff manifest. Its `requestDirectory` option sets the final
body/response destinations when writing the files into a staging directory.
Execute the original buyer request with that retained configuration. Feed its
saved response to `receivePage`, or use the existing operator's live response
receiving control. Each receipt retains the original response, JSONL rows and
next request. Use a stable intent for each exact request and the returned next
request for the next purchase.

The portable workspace carries prepared live packages. The running merchant's
private identity/history and the buyer's execution records remain in their
original retained runtime directories. Keep those directories through upgrades
and reopening. The complete source/provider and live operator contracts are in
[PROVIDER.md](PROVIDER.md), [README.md](README.md) and [live/README.md](live/README.md).
