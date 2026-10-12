# Installed SEC EDGAR merchant

The installed `sec-edgar` command opens the original SEC source store, operator
workspace and Stellar/x402 merchant. It imports complete Company Facts or
submissions captures, saves the operator's selected products, and exports their
original source editions with the generated buyer client.

Use Node 24 and a completed Starforge customer runtime containing the native
seller and original schema dependencies. The [runtime installation guide](RUNTIME_INSTALL.md)
describes selecting those features from the supplied archive. Keep the source
store, merchant configuration, operator workspace and delivery state in private
directories outside the installed package.

The examples use the selected installation's `starforge` launcher. The existing
runtime runner also forwards these commands directly:

```sh
starforge runtime-install run --dir /srv/starforge/runtimes/sec-edgar -- sec-edgar --help
```

## Import and review a source edition

Import the exact original capture and retain its source identity. A new download
belongs to a new edition when its bytes change. The optional digest and timestamp
should come from that capture's acquisition record.

```sh
starforge sec-edgar import --store /srv/starforge/sec-edgar/captures \
  --id apple-facts-20261011 --kind facts --cik 320193 \
  --input /srv/starforge/sec-edgar/inputs/CIK0000320193.json \
  --source-url https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json

starforge sec-edgar editions --store /srv/starforge/sec-edgar/captures

starforge sec-edgar workspace --store /srv/starforge/sec-edgar/captures \
  --workspace /srv/starforge/sec-edgar/operator --port 0
```

Open the returned local URL. The operator's session key stays in the local
browser flow. Choose the imported edition, a product identifier and route, its
offered concepts or filing forms, page maximum, public merchant origin, and actual
Stellar payment terms. For the following example, save a facts product named
`appleFacts` with the offered concept `us-gaap:Assets`. Preview its actual records,
save the draft, and download its configuration as
`/srv/starforge/sec-edgar/merchant.json`.

The [original workspace guide](../sf30-seller-sdk/sec-edgar/WORKSPACE.md)
covers concept selection, capture downloads, concurrent save recovery and earlier
revision restoration. Importing a submissions capture uses `--kind filings` and
its issuer CIK. The recent shard and any named historical shard are separate
source editions.

To acquire a fresh official capture through the original transport, set the
organization/contact User-Agent in `SEC_EDGAR_USER_AGENT` and select the existing
shared SEC quota directory:

```sh
starforge sec-edgar acquire --store /srv/starforge/sec-edgar/captures \
  --id apple-facts-next --kind facts --cik 320193 \
  --quota-dir /srv/starforge/supplier-quotas/sec-edgar
```

The source adapter retains its original acquisition limits and 429 cooldown
handling. Repeating an already completed compatible edition returns that edition.
An older submissions shard can be selected with the exact `--history-file` named
by the current source. The [source guide](../sf30-seller-sdk/sec-edgar/README.md)
defines the original endpoint, response limits and cross-host acquisition policy.

## Query, export and serve the saved products

Review the saved terms and inspect a selected page before preparing its complete
portable release:

```sh
starforge sec-edgar review --config /srv/starforge/sec-edgar/merchant.json

starforge sec-edgar query --store /srv/starforge/sec-edgar/captures \
  --config /srv/starforge/sec-edgar/merchant.json --product appleFacts \
  --query '{"taxonomy":"us-gaap","concept":"Assets","unit":"USD","limit":"25"}'

starforge sec-edgar export --store /srv/starforge/sec-edgar/captures \
  --config /srv/starforge/sec-edgar/merchant.json \
  --out /srv/starforge/sec-edgar/release-1
```

Keep the entire export directory together. It contains `merchant.json`,
`review.json`, `seller-openapi.json`, `buyer-handoff.json`, `client/`,
`source-store/`, `export-plan.json` and `manifest.json`. The original source
store contains every selected raw capture and its edition metadata. The generated
client's own README and TypeScript declarations describe its callable request
interface. The handoff carries the selected product request and its compiled
payment options for the original customer workflow.

Start the merchant from those exported source editions and the same saved
configuration. Use the actual facilitator and existing merchant HTTPS ingress:

```sh
starforge sec-edgar serve --store /srv/starforge/sec-edgar/release-1/source-store \
  --config /srv/starforge/sec-edgar/release-1/merchant.json \
  --port 8787 --operations-port 8788 \
  --facilitator https://facilitator.example
```

The command prints the original seller and operations snapshot. The configured
facilitator selects native Stellar x402 operation. Omitting it selects the
original unpaid `CHALLENGE_ONLY` offer. The generated client and original buyer
retain payment approval, signing, spending limits and acquisition state.

Keep the same existing `--availability-dir` and `--history-dir` when those
operator stores are used. SIGINT or SIGTERM closes the original seller and source
store through their normal lifecycle.

## Receive and reopen the complete source

Copy the complete exported directory to its receiving location. The receiver can
inspect the same immutable source without contacting the SEC:

```sh
starforge sec-edgar editions --store /srv/starforge/received/sec-edgar/source-store

starforge sec-edgar query --store /srv/starforge/received/sec-edgar/source-store \
  --config /srv/starforge/received/sec-edgar/merchant.json --product appleFacts \
  --query '{"taxonomy":"us-gaap","concept":"Assets","unit":"USD","limit":"25"}'

starforge sec-edgar workspace --store /srv/starforge/received/sec-edgar/source-store \
  --workspace /srv/starforge/received/sec-edgar/operator --port 0
```

A new receiving operator workspace starts with an empty draft. Open **Merchant
JSON and draft recovery**, choose **Import configuration** for the exported
`merchant.json`, choose **Apply JSON to draft**, then **Save draft**. The source catalog already contains the exact editions.
An existing operator reopens with its same `--workspace` and `--store` paths and
retains its saved revision history.

Repeated export to the same destination accepts the same bytes and rejects
another merchant revision. A changed source or selection starts a new query;
a continuation cursor retains its original edition and selection while allowing
a different page size. Preserve original numeric value strings, units, accessions
and missing fields when consuming the rows.

## Installed JavaScript interfaces

Each import resolves to the original installed module.

| Package subpath | Original module | Main entry points |
| --- | --- | --- |
| `@tokenjunkielabs/starforge-merchant/seller/sec-edgar/cli` | `sec-edgar/cli.mjs` | `main`, `exportEdgarMerchant`, `buyerHandoff` |
| `@tokenjunkielabs/starforge-merchant/seller/sec-edgar/config` | `sec-edgar/config.mjs` | `compileEdgarMerchant`, `readEdgarMerchant`, `merchantReview`, `merchantOpenApi` |
| `@tokenjunkielabs/starforge-merchant/seller/sec-edgar/source` | `sec-edgar/source.mjs` | `parseEdgarCapture`, `openEdgarStore`, `acquireEdgarCapture` |
| `@tokenjunkielabs/starforge-merchant/seller/sec-edgar/merchant` | `sec-edgar/merchant.mjs` | `createEdgarSource`, `startEdgarMerchant`, `edgarNativeFactory` |
| `@tokenjunkielabs/starforge-merchant/seller/sec-edgar/workspace` | `sec-edgar/workspace.mjs` | `openEdgarWorkspace`, `emptyEdgarDraft` |
| `@tokenjunkielabs/starforge-merchant/seller/sec-edgar/server` | `sec-edgar/server.mjs` | `startEdgarWorkspace` |

For an embedded receiver, use the retained export's configuration and store:

```js
import { readEdgarMerchant } from '@tokenjunkielabs/starforge-merchant/seller/sec-edgar/config';
import { openEdgarStore } from '@tokenjunkielabs/starforge-merchant/seller/sec-edgar/source';

const compiled = await readEdgarMerchant('/srv/starforge/received/sec-edgar/merchant.json');
const product = compiled.products.find(item => item.id === 'appleFacts');
if (!product) throw new Error('Choose a product from this saved merchant.');
const store = await openEdgarStore('/srv/starforge/received/sec-edgar/source-store');
try {
  const page = await store.query(product.editionId, product, {
    taxonomy: 'us-gaap', concept: 'Assets', unit: 'USD', limit: '25',
  });
  console.log(page.body);
} finally {
  await store.close();
}
```

The existing complete SF30 and distribution components carry the source modules,
plain browser assets, example configuration and both original guides. Updating
the installed package preserves the operator's separate source and state paths.
