# Huwise / Opendatasoft customer workspace

This browser application connects the original Opendatasoft provider, retained research editions, the original dataset publisher, seller release management and original SF88 buyer preparation. It operates one saved project from discovery through a complete customer handoff.

The interface uses a plain grayscale layout. Original provider values remain available throughout record review, notes, comparison and export. A field mapping and publication policy produce the customer dataset from the selected retained edition.

## Open the application

Use Linux with util-linux `flock`. Run these commands from the installed Stellar Forge source root, the directory containing `sf30-seller-sdk` and `sf88-operator-buyer-cli`. Use the Node runtime required by that distribution; the original native operator uses Node 24 or newer. Python 3 and the distribution's original native runtime dependencies are needed for the publisher and buyer workflows. The package download action uses the host's `tar` command.

Create a private project once:

```sh
node sf30-seller-sdk/opendatasoft/cli.mjs init \
  --project /absolute/private/huwise-project \
  --origin https://public.opendatasoft.com
```

Open an existing project:

```sh
node sf30-seller-sdk/opendatasoft/cli.mjs serve \
  --project /absolute/private/huwise-project \
  --port 0
```

Open the complete printed loopback URL, including its fragment. The server chooses an available local port when `--port 0` is used. The link's capability is retained in the browser tab's session storage and removed from the visible address after opening. Keep this link private because it grants access to this project.

Each project keeps the portal origin supplied during initialization. For an authenticated portal, make its existing API key available in a server environment variable and name that variable during initialization:

```sh
node sf30-seller-sdk/opendatasoft/cli.mjs init \
  --project /absolute/private/customer-huwise-project \
  --origin https://customer-portal.example \
  --auth-token-env CUSTOMER_HUWISE_API_KEY
```

Set `CUSTOMER_HUWISE_API_KEY` in the serving process's environment through the existing private credential mechanism. The UI receives the saved portal address and research data. The server owns provider authorization.

Keep one owning process open for each project. Use Ctrl-C to close the serving process before operating the same project with another CLI command. Reopening the project reads its persisted edition and operation state.

## 1. Discover the portal and inspect a dataset

**Catalogue** offers two entry points:

- Search the portal catalogue using an optional ODSQL filter, sort expression, language and refinements.
- Open a known original dataset ID directly.

Catalogue pages retain the provider's own page totals, dataset IDs, titles, publishers, rights labels and source field metadata. **Inspect dataset** opens the native metadata, source fields, rights and receipt for the selected dataset. Provider descriptions and metadata are displayed as text.

Refine and exclude inputs accept one original expression per line. Keep the provider's syntax. The application sends each nonempty line as a repeated query parameter and preserves that selection in the capture.

Use the portal's actual field names when entering ODSQL. The [official Explore API documentation](https://help.opendatasoft.com/apis/ods-explore-v2/) describes catalogue discovery, record queries, export endpoints and the query language.

### Preview the selection

The dataset screen lets you preview records with the same where, order, language, timezone and refine/exclude values used by the capture. Preview pages are read directly from the provider and display their total, page information and receipt.

The additional ODSQL preview supports selected columns and grouped queries. Use it to inspect a question before capture. These preview expressions belong to that preview request. The complete capture preserves the original native record fields for its selected dataset and filters.

### Retain the complete selection

Choose **Capture complete edition** to retain the selected export. The capture engine uses the provider's complete JSON export and opening and closing dataset metadata. It records the dataset's native identity, all fields, selection, rights and original response information.

Set the row and byte capacities for the actual project. The displayed defaults permit 250,000 rows and 268,435,456 bytes. Exceeding a selected capacity produces an explicit operation result. The operation strip reports the current operation and exposes **Stop operation** while it is running.

A completed capture becomes a saved edition. An interrupted edition exposes its existing resume operation. Resume uses that retained capture and its original selection; it continues the existing project record.

## 2. Review every retained record

**Retained editions** opens a complete saved edition. The edition summary identifies the original dataset, row count, fields, completion time and source manifest. Source metadata and rights travel with the edition.

The record table pages through the retained full export in original absolute row order. A row index is zero-based: source row 0 is the first retained provider record. Select a row index to inspect all of its fields and open its row note. Long strings and structured values expand inside their cells.

Original values are distinguishable:

| Original value | Presentation and retained meaning |
| --- | --- |
| Null | `null` |
| Missing field | `[missing]` in the review table |
| Empty string | Empty source text |
| Text label such as `FALSE` or `FAUX` | The exact source text |
| Array or object | The full original JSON value |
| Number requiring exact native representation | The engine's exact safe display representation; original export remains retained |

### Count field values

**Exact field-value counts** reads the retained edition, so it remains useful without another provider request.

Choose a field and one of the two explicit interpretations:

- **Complete original values** counts each scalar, array or structured object as its entire original value.
- **Array members per record** counts each distinct native member once for each source row containing it. Strings remain complete strings; the application does not split text labels into inferred categories.

The result reports source rows, distinct values, nulls, missing values and each displayed count. Displaying fewer facet values changes the report's visible list, while the counts are calculated over the complete edition.

### Inspect original geography

**Geographic review** plots coordinates from the chosen original geographic field for the current record page. It uses a local longitude/latitude view and does not load external map tiles. Select a point or shape to inspect its original source row.

The field selector includes the provider's geographic types. A `geo_point_2d` object uses its native longitude and latitude. GeoJSON geometry is displayed from its original coordinates. The plot is a view of the current page; the complete GeoJSON download contains every retained row.

Use the actual geographic source field for geographic export. Separate numeric-looking strings stay strings until an explicit field mapping says otherwise.

### Save findings and row notes

**Analyst notes** retains both edition findings and notes attached to original row indices.

Select a row from the record table or enter its source row index. **Apply row note to draft** lets you collect several row notes before saving. **Save notes** also includes the row note currently being edited. Clearing a row note removes it from the saved note set.

Notes use the exact capture manifest hash and expected note revision. If another operation changes the notes first, refresh the edition and reconcile against that saved revision. A rejected save keeps the current form draft available. Reports contain the saved note revision.

### Download a complete research edition

| Format | Contents |
| --- | --- |
| JSON | Complete retained records, source and rights, edition information and saved notes |
| CSV (JSON value cells) | All original columns and retained rows; each original value is encoded as JSON inside its CSV cell |
| GeoJSON | Every retained row as a feature, all native properties, source and rights, and saved notes |
| HTML | A complete readable edition report, including source, rights, all records and saved notes |

For the CSV, parse the CSV structure first and then parse each native value cell as JSON. This preserves the difference between `null`, an empty string, a nested array and a textual label. A spreadsheet may display JSON quotes inside cells; those quotes are part of the exact representation.

GeoJSON uses the explicitly selected geometry field, or the sole original geographic field when it is unambiguous. Rows with absent or malformed geometry remain features with `geometry: null` and their original properties; the exported result carries the corresponding warnings. A reviewed field selection resolves ambiguity when several geographic fields are present.

## 3. Compare exact saved editions

When two complete editions identify the same native dataset, the edition screen offers a comparison.

Choose the earlier edition and a unique original source key. The comparison requires the key in every row and rejects duplicate or null keys. Use a verified dataset identifier such as a source URL when it is unique in that dataset.

The comparison reports added, removed, changed and unchanged records, plus whether the native field schema changed. Added and removed results carry their original rows. Changed results carry both exact saved versions. The browser pages through the complete change list; both saved editions remain available.

## 4. Define the customer field mapping

At the bottom of the retained edition screen, review the complete original field list and save a typed source selection.

Each selected field has:

- An original provider field name.
- A customer-facing alias.
- A published type.
- An explicit `native`, `text` or `json` encoding.
- A nullable setting.

The engine supplies suggestions from the actual retained values and metadata. Review arrays, nullable values and textual flags according to their actual representation. The UI lets you include or exclude fields, edit aliases and choose the output type and encoding.

Saving binds the selection to the exact retained capture hash. The complete original edition remains available alongside the selected customer mapping.

The original source selection can be downloaded from **Data products**. It identifies the retained capture used by the native publisher.

## 5. Prepare, review and publish the dataset

**Data products** operates the original dataset publisher.

Select a saved field mapping. Choose the aliases customers may use for equality filters, range filters and sorting. Set the default and maximum page sizes. The default page size must fit within the maximum.

Choose the primary extraction field and direction. An optional JSON array adds ordered tie-breaker fields:

```json
[
  {"column": "url", "direction": "asc"}
]
```

Use selected aliases and include each field only once. Configure the complete extraction's row limit, byte limit and timeout for the intended dataset.

**Prepare dataset candidate** extracts from the retained source into the original native publisher. A ready candidate exposes its full native inspection, candidate digest and customer-query preview.

The upstream provider and the published customer dataset have separate query formats. The provider uses ODSQL, for example `where=country = "United States"`. A published source with a `country` equality filter uses the original dataset parameter `where_country=United%20States&limit=250`. Enter the original parameter string in the customer-query field; the browser passes it intact to the native dataset engine.

Use **Preview customer query** to check the intended query against this candidate. The response includes the exact snapshot and page details. Query parameter names come from the selected publication policy; the original dataset API remains authoritative.

Record a reviewer and a substantive review note covering the source, rights, mapping, query policy and intended use. **Record dataset review** binds that decision to the displayed candidate digest.

**Publish dataset version** uses the existing review ID and the original publisher. If the project reopens with an interrupted or uncertain publication state, **Recover this publication** inspects and continues the retained candidate and publication history.

## 6. Create and stage a merchant release

For a reviewed or published candidate, enter:

- The public HTTPS merchant origin and resource path.
- The payment scheme, network and asset.
- The exact payment amount in base units.
- The merchant pay-to address and payment timeout.

**Export merchant package** retains the complete reviewed dataset and its original runtime with those public resource and payment terms. A finalized export appears under **Merchant & buyer** and **Receiving**.

**Download complete merchant package** produces a gzip tar archive of the retained package. Transfer that complete archive to a receiving host and use its original receiving guide and runtime installation instructions.

**Stage retained merchant package** binds the selected package manifest hash to a named release in this project's original seller release store. Choose its label and loopback seller port.

When a package has been staged, the screen prints the actual command to open the original seller release console:

```sh
node sf82-seller-pilot/release-cli.mjs console \
  --store /absolute/private/huwise-project/seller-releases \
  --port 8425
```

Use the release console to inspect, activate and run the staged edition. The workspace displays the exact retained release information and leaves release control in that original seller application.

## 7. Read the actual offer and prepare the buyer

In **Merchant & buyer**, select the retained package and enter the running original seller's loopback address, for example `http://127.0.0.1:8423`. Enter a first-page dataset query using the advertised parameters.

**Read live offer** reads the original seller's health and offer metadata, verifies the matching resource and original admission hook, and binds the package's exact snapshot. The screen displays the seller mode, selected URL, full offer and every payment alternative, including amount, asset, network, pay-to address and timeout.

Choose the advertised payment alternative and a unique buyer intent ID. **Prepare original buyer request** rereads the seller, checks the selected offer hash and saves the original SF88 configuration.

Changing the seller or query clears the displayed offer. Read the updated live offer before preparing that selection.

Retained buyer requests appear with their original configuration path, selected snapshot, URL, offer hash and configuration hash. Download the existing configuration and continue that same intent in the original SF88 buyer operator. The original operator owns review, collection, payment execution, receiving, backup and restore. Use the distribution's [SF88 operating instructions](../../../sf88-operator-buyer-cli/README.md) and retain the same operation state when resuming.

## 8. Receive and continue existing work

**Receiving** brings the project's handoff materials together:

- Import an existing original `capture.json` from the receiving host.
- Open and download complete saved research editions.
- Download complete merchant packages and inspect their manifest hashes.
- Download retained original buyer configurations.
- Read the current project inventory and reopen command.

A capture import needs its complete original directory, including the export and metadata files referenced by its manifest. Copy the directory intact to the receiving host before selecting that local manifest path. The engine validates and imports that retained source into this project.

A merchant receiving handoff needs the complete package archive and its original included instructions. A buyer continuation needs its exact configuration and retained original operator state. Keep those artifacts associated with the selected package, snapshot and intent.

Closing and reopening the workbench preserves editions, notes, source mappings, publication history, exports, seller release references and buyer requests. The serving command owns the project lock and releases it on shutdown.

## Reference dataset used for the original integration

The original public source integration used:

- Portal: [public.opendatasoft.com](https://public.opendatasoft.com/)
- Dataset: [Open Data Sources](https://public.opendatasoft.com/explore/dataset/open-data-sources/)
- Native dataset ID: `open-data-sources`
- Native dataset UID: `da_t0o52c`
- Complete retained source on 11 October 2026: 3,763 rows and 18 original fields.
- Provider rights label: Public domain.
- Provider attribution: Made with Natural Earth.

These counts describe the retained edition. A later live portal export can differ.

That edition provides concrete examples of why native values matter:

| Original field | Actual retained representation |
| --- | --- |
| `location` | 3,759 longitude/latitude objects and 4 nulls |
| `thematic` | 3,761 arrays and 2 nulls, despite the metadata's text label |
| `portal_typology` | Original hierarchy text and 17 nulls |
| `has_issue` | 3,660 nulls, 65 `FALSE` strings, 37 `TRUE` strings and 1 `FAUX` string |
| `url` | 3,763 unique original source values |

Use `location` for its geographic view. Use explicit array-member counts to study `thematic`. Preserve the original `has_issue` labels in a customer field mapping.

## Application API

The CLI opens the original engine and injects it into the HTTP application:

```js
import { openOpendatasoftWorkbench } from '../engine.mjs';
import { startOpendatasoftServer } from './server.mjs';

const workbench = await openOpendatasoftWorkbench({
  directory: '/absolute/private/huwise-project'
});
const web = await startOpendatasoftServer({ workbench, port: 0 });
// web: { server, origin, token, url, close }
// Close HTTP first, then release the original project lock.
await web.close();
await workbench.close();
```

The server binds to `127.0.0.1` and uses its private bearer capability for project APIs. It checks the local host and request origin, sends no-store responses, and serves only its fixed static assets. Provider and analyst text is inserted into the UI as text. State changes are routed to the original workbench's persisted operation methods.

The HTTP API returns an operation ID for mutations. The browser follows the corresponding saved operation to completion and keeps form drafts when an operation fails. Navigating cancels obsolete read requests while the original saved mutation continues in the owning server.

Complete package downloads stream from the known retained package directory with backpressure. Closing the HTTP server stops its archive children. The caller retains ownership of the original engine and closes it after HTTP shutdown.
