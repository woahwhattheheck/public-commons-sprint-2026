# SEC EDGAR merchant

Turn complete SEC Company Facts and filing-index captures into retained data
products. The SEC EDGAR merchant keeps the original source bytes, the operator's
saved selections, the native Stellar/x402 seller and the complete customer
receiving path together.

Use the same product from the local browser, command line or original merchant
MCP provider. **Applications → SEC EDGAR** opens the original retained workspace
through the installed runtime's existing controls.

## Complete a customer task

A financial-data operator can retain an issuer's official capture, select the
concepts or filing forms needed by a customer, inspect the actual rows, set the
merchant's payment terms and publish a stable edition. Customers receive the
original selected data through the generated client and native buyer workflow.

| Work | Result |
| --- | --- |
| Import or acquire source | Complete original SEC JSON, source URL, capture time, issuer CIK and exact source identity |
| Review facts | Original numeric text, taxonomy, concept, unit, accession, period and filing variants |
| Review filings | Original recent or named historical submission shard and its complete indexed records |
| Save a product | Retained configuration, source bindings and append-only revision history |
| Operate the merchant | Original HTTP seller, native Stellar/x402 payment options and operations listener |
| Deliver to a customer | Complete merchant configuration, source editions, OpenAPI, buyer handoff and generated JavaScript client |
| Continue a customer download | Original MCP transfer inventory, retained byte prefix and offline reopening |
| Move an operator workspace | Full ZIP with the original workspace identity, every saved revision and every imported edition |

The customer package contains the selected merchant and sources needed to use
it. The operator handover carries the complete authoring workspace, including
older revisions and imported editions outside the current product selection.

## Install the complete selected product

Use the existing source repository and one immutable commit:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/tjlabs-stellar-merchant-workspace \
  --ref FULL_SELECTED_COMMIT \
  --selection sec-edgar \
  --out /absolute/private/sec-edgar-release
~~~

The build receipt names the complete archive and its SHA-256. Prepare that exact
archive in a new private runtime:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /absolute/private/sec-edgar-runtime \
  --archive /absolute/private/sec-edgar-release/ORIGINAL_ARCHIVE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /absolute/private/sec-edgar-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /absolute/private/sec-edgar-runtime --load --source
~~~

Use Node 24 and Python 3.10 or later. The source recipe supplies the SEC engine,
browser, complete receiving command, archive engine, merchant MCP provider,
generated-client support and selected native runtime dependencies. The existing
installer and receiving commands handle interrupted installation and transfer.

The selected installation exposes sec-edgar, sec-edgar-workspace,
sec-edgar-download, the original merchant MCP commands and runtime management.
The [operating guide](OPERATING.md) carries the complete source-to-customer and
operator receiving workflows.

## Open the operator

~~~sh
starforge sec-edgar workspace \
  --workspace /absolute/private/sec-edgar/operator \
  --store /absolute/private/sec-edgar/captures
~~~

Open the returned local URL. Import the complete original SEC JSON in **Captures**,
choose its edition in **Products**, preview the selected rows and save the draft.
The existing **Merchant JSON and draft recovery** controls also accept a complete
saved configuration.

In **Handoff → Whole workspace handover**, choose **Review saved workspace** and
**Save complete handover**. Download the full ZIP. The page displays the exact
receiving command and saved archive identity. **Open retained export** recovers
the same named download after a lost browser return.

~~~sh
starforge sec-edgar-workspace receive \
  --archive sec-edgar-workspace.zip \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --out /absolute/private/received-sec-workspace

starforge sec-edgar-workspace open \
  --root /absolute/private/received-sec-workspace
~~~

The receiving operator opens the same original workspace and saved history.
Repeating a handover accepts existing identical files. Receiving an older
handover preserves later local revisions. A conflicting original file is
reported before any differing history is replaced.

## Original documentation and source

- [Complete operating and receiving guide](OPERATING.md)
- [SEC source, query and merchant contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/README.md)
- [Browser authoring and draft recovery](../../stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/WORKSPACE.md)
- [Complete MCP operator and customer workflow](../../stellar-forge/mcp-merchant-operator/SEC_EDGAR.md)
- [Source-owned product selection](../../stellar/scf-starforge-20261009/distribution/selections/sec-edgar.json)
- [Portable operator implementation](../../stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/receiving/operator.mjs)

Source acquisition uses the existing SEC transport and supplier-quota directory.
A changed official capture receives a new edition. The native parser and query
engine preserve source numeric text, filing variants and missing fields.
