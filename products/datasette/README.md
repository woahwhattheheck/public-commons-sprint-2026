# Datasette source and customer workspace

Capture a complete Datasette table or read-only query, review the original values, publish an immutable dataset and deliver the source with its customer workspace. The browser, CLI, merchant agent and maintained publisher use the same original workspace.

## The complete workflow

| Stage | Operator work | Retained result |
| --- | --- | --- |
| Source capture | Select the exact JSON URL and filters; follow its original continuation | Every original HTTP body, request and response metadata, source selection and complete capture |
| Source review | Inspect exact numeric text, nulls, blank strings, labels and structured values; select columns and a key | Full-source column profiles, explicit projection and immutable named edition |
| Edition comparison | Compare complete source editions using their reviewed key, or complete row contents | Added, removed, changed and unchanged rows; source, schema, metadata and projection changes |
| Publication | Save the original plan, extract, inspect the candidate and review its current target | Original publisher plan, candidate CSV, dataset configuration, review and versioned publication |
| Merchant delivery | Prepare and stage the full release; read the original buyer offer | Source edition, original pages, source-bound plan, dataset snapshot, native release and buyer configuration |
| Customer analysis | Receive the same edition in the installed Datasette Analysis application | Original customer database, editable saved queries, reports, workbook and complete receiving archive |
| Portable receiving | Export original files or the entire workspace; receive and reopen independently | Complete source, publisher and customer history with original archive and file identities |

The interface uses a neutral industrial layout. Captures, editions, source rows, publisher history, differences and retained files have their own navigation. Downloading a file reads the identified original bytes; an interrupted operation keeps its original input and native operation identifier.

## Install the product

Build the committed selection from a checkout containing the complete source:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --ref ORIGINAL_COMMIT \
  --selection datasette --out /absolute/datasette-release
~~~

The existing Runtime workspace **Build a product** view runs that same maintained builder. The selection includes Datasette capture/publisher/receiving, the original customer Analysis product, both application providers, the merchant agent, dataset seller/buyer and native runtime installation.

Follow [Installation and receiving](RECEIVING.md) for the exact archive, profile, installer and independent workspace reopening. The emitted source manifest retains the actual commit and complete selected files.

## Open the original workspace

~~~sh
starforge datasette serve \
  --directory /absolute/private/datasette-workspace --create \
  --connection-file /absolute/private/datasette-workspace/connection.json \
  --port 0
~~~

Open the local URL printed by the original command. It also writes a private connection file that CLI and agent clients can use after a restart.

After initial creation, choose **Applications → Datasette source and dataset publisher** in an installed READY runtime. Select that original directory and use the existing Review, Save, Start and Open controls. The managed application records the immutable workspace declaration, its identity and installed source. Captures and publisher history remain operational.

[Operating instructions](OPERATING.md) describe the complete browser workflow, source formats, publication, release and agent connection.

## Original source example

The committed WRI geothermal example retains 189 original rows across four HTTP pages and 26 returned positions: 25 physical fields plus the database rowid locator. Its source is the World Resources Institute's Global Power Plant Database as served by Datasette. The retained publisher metadata carries the original source link and Creative Commons Attribution 4.0 license.

The **Use WRI geothermal source** button selects the public JSON table and the same fuel filter. A new capture records that request's actual returned data and observation window. The committed example remains an independently retained source edition.

Original example files live in:
`stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/sources/wri-geothermal-20261012/`.

The selected installation retains the complete compressed source edition as an explicit original source member. [Continue the retained WRI source](OPERATING.md#continue-the-retained-wri-source) gives its actual archive hash, source.receive input and customer handover. [Prepare an editable customer analysis](OPERATING.md#prepare-an-editable-customer-analysis) carries that edition through original reports, workbook, customer edits and full Analysis receiving.

The source's historical capacity, generation years and data provenance stay with the original columns. Review those fields when defining a customer's dataset or report.

## Maintained components

Datasette source capture and edition review feed the original SF30 dataset publisher and version store. Release preparation uses the maintained SF82 package and release machinery. Customer Analysis uses the original SF88/SF100 analytical database, report and workbook workflow. Installation, managed Applications, merchant MCP and complete workspace archives keep their original owners and record formats.

- [Datasette JSON API](https://docs.datasette.io/en/stable/json_api.html)
- [WRI geothermal table](https://datasette.io/global-power-plants/global-power-plants?primary_fuel=Geothermal)
- [Original merchant Datasette guide](../../stellar-forge/mcp-merchant-operator/DATASETTE_WORKSPACES.md)
- [Runtime Source Build guide](../../stellar/scf-starforge-20261009/distribution/runtime-workspace/SOURCE_BUILDS.md)
