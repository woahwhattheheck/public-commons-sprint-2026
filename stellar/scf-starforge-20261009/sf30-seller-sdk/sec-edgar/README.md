# SEC EDGAR merchant

Turn retained SEC company facts and filing indexes into versioned data products using the existing SF30 seller, native Stellar x402 adapter, generated buyer client and operator tools. The browser workspace imports original SEC JSON, chooses a company and its concepts, previews the actual records, retains product revisions and exports the configuration for deployment.

## Start from a retained capture

Use Node 24 and the existing Starforge source/dependency installation. The entrypoint is `stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/cli.mjs`. Commands below run from this directory. State paths should be private directories owned by the operator.

```bash
node cli.mjs import --store /private/edgar/captures \
  --id apple-facts-20261011 --kind facts --cik 320193 \
  --input /captures/CIK0000320193.json \
  --source-sha256 73a86c6aedc31f77cac2ea4df5f80f0b3bd7e6eb58bb4e01444fbedf3afb9c43 \
  --captured-at 2026-10-11T22:24:01.883557+00:00

node cli.mjs workspace --store /private/edgar/captures \
  --workspace /private/edgar/operator
```

Open the returned local workspace URL. Import other captures through the browser or CLI, select the edition, choose a route and offered concepts, set the payment terms, preview records, then save and download the merchant configuration. The generated URL contains a private session key in its fragment. The operator listener binds to loopback; deploy the buyer service separately through the original SF30 listener.

`merchant.example.json` contains two products pinned to public SEC captures retained on 2026-10-11: Apple facts and Genpact's recent filing index. Import both exact captures to use that complete configuration. It contains clearly marked demonstration payment asset/recipient values; configure the actual Stellar terms through the workspace for deployment. A later SEC download has a different digest and should become a new edition and product revision.

See [the operator guide](WORKSPACE.md) for import, editing, pagination and version recovery.

## Acquire a new source edition

`acquire` uses the existing SF30 upstream transport and original shared supplier-account quota engine. Configure an identifiable organization/contact User-Agent in `SEC_EDGAR_USER_AGENT`. Select the same absolute quota directory for every SEC acquisition process sharing the account.

```bash
node cli.mjs acquire --store /private/edgar/captures \
  --id apple-facts-new-edition --kind facts --cik 320193 \
  --quota-dir /private/supplier-quotas/sec-edgar
```

The default limits are 2 source requests per second and 1,000 per day; the operator can select `--requests-per-second` from 1 to 10 and `--calls-per-day`. The shared quota records reservations and SEC 429 cooldowns before another source dispatch. Reusing an already imported compatible edition returns that edition without another source request. On an interrupted acquisition, repeat the same command and edition ID.

Source URLs are fixed to the selected company's official `data.sec.gov` facts or submissions endpoint. For an older filings shard, pass the exact `--history-file` from the current submissions response. Acquisition uses the original transport's 16 MiB response limit; retained-file imports support 32 MiB. The source bytes are validated and saved before the edition becomes available.

SEC documents a maximum of ten automated requests per second per user across machines. Coordinate acquisition across hosts using the original shared acquisition owner; a directory on one host coordinates the processes using that directory. Source references: [EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) and [SEC developer resources](https://www.sec.gov/about/developer-resources).

## Serve and export the selected products

```bash
node cli.mjs query --store /private/edgar/captures \
  --config /private/edgar/merchant.json --product appleFacts \
  --query '{"concept":"Assets","unit":"USD","filedTo":"2025-12-31","limit":25}'

node cli.mjs export --store /private/edgar/captures \
  --config /private/edgar/merchant.json --out /private/edgar/release-1

node cli.mjs serve --store /private/edgar/release-1/source-store \
  --config /private/edgar/release-1/merchant.json \
  --port 8787 --operations-port 8788 \
  --facilitator https://facilitator.example
```

Export contains the normalized merchant configuration, review, OpenAPI, buyer handoff, the original generated JavaScript client and TypeScript declarations, all selected raw source blobs and edition metadata, and a manifest. The manifest identifies the exact merchant revision and every selected source digest. Export recovery accepts the same bytes and refuses an overwrite by another revision.

The public HTTPS origin belongs to the deployed reverse proxy; the local seller port is explicit. Supplying the configured facilitator uses the original `@x402/core` and Stellar native seller implementation. Without that setting, the original seller operates in `CHALLENGE_ONLY` mode. Payment signing, buyer approval and spending remain in the existing SF31/SF88 buyer; the handoff selects its generated client rather than creating another wallet or approval mechanism.

The optional operations port opens the original SF30 operator application. Existing availability and history directories can be selected with `--availability-dir` and `--history-dir`. Shutdown drains the original seller before closing the source store.

## What buyers receive

Every response includes the edition ID, original SEC URL, capture time, source SHA-256, original company identity, selection, rows, matched count and continuation cursor.

| Product | Records and supported selection |
| --- | --- |
| Facts | Explicitly offered taxonomy/concept identifiers, original unit, form, accession, filing dates and reported period ends |
| Filings | Original accession, filing/report dates, form, acceptance time, document path/link, SEC classification and XBRL fields |
| Both | Configured page maximum, exact edition binding, separate original rows, continuation for the same product and selection |

Numeric facts use their original JSON numeric spelling as strings with `valueType: "number"`, avoiding binary floating-point conversion. Missing `fy`, `fp`, period start and other optional fields remain null. Units are separate records. A fact reported again in another accession remains a separate record. Filing-date and period-end filters are independent and inclusive; the merchant performs no fiscal-year remapping, currency conversion, financial calculation or restatement deduplication.

Current SEC submissions include at least a year or a thousand filings, whichever is more. The response names older history files; their descriptors remain in the edition. Import a named historical file as its own edition to offer its records. The current shard's scope is explicitly `submissions-recent`; a history shard is `submissions-history`.

Continuation cursors bind the source digest, edition, product, offered concepts/forms and all selection parameters. Changing the page size retains the position; changing the source or selection requires a new first page. Native seller mode rejects invalid selections, absent concepts and foreign cursors through the original application admission before that page requests payment. The original challenge-only mode publishes its unpaid offer; local query and workspace preview validate the selected page.

## Implementation

- `config.mjs`: strict normalized product and query configuration; original seller offers and OpenAPI.
- `source.mjs`: original-source parsing, immutable source/edition retention, source acquisition and page queries.
- `merchant.mjs`: existing SF30 seller, native facilitator adapter, admission and lifecycle.
- `cli.mjs`: import/acquire, local query, complete export, generated buyer handoff and operation.
- `workspace.mjs`, `server.mjs`, `public/`: saved operator drafts, capture catalog, record preview and browser UI.

This is an additive merchant adapter. The original SF30 payment protocol, generated client, supplier quota and source package stay authoritative. The public merchant uses public SEC source records; the private issuer-analysis application's analytical code and customer material remain in that original project.

## Focused integration result

On 2026-10-12, a Node 24.19.0 run joined this adapter to the accepted Starforge source `2d790e8c04830040c36191924cde8274b28f78c3` and the current original supplier-quota modules. It imported the exact retained Apple facts capture (25,135 records) and Genpact submissions capture (1,003 filings), preserved 569 observations with missing fiscal fields and 18 assets periods carrying multiple accessions, followed a changed-size page cursor and rejected a cursor for another selection. The same run exercised the actual operator HTTP session, save conflict, preview, source download, revision restore and restart; the original seller's HTTP 402 challenge; the configured application's 409 admission; generated client import; complete source export and byte-identical reopen/recovery. It used the existing installed dependency view and installed no packages.


