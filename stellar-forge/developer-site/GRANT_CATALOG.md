# Search the retained catalog and open its original request

The SCF application includes a working catalog reader. It opens one complete
provider page, applies maintained Bazaar ranking and exact payment filters, and
produces a complete selection for the installed Atlas workspace.

## Review the advertised operation

In **Search the catalog**, choose **Load the retained catalog**. The reader checks
all 45,753 original UTF-8 bytes against SHA-256
`7d088b72500e47da56170296de80aad2321bc5f707d8e074755d9059f4e4eebf`.

The source was acquired on October 12, 2026 at 21:44:51.728 UTC from Vellar's
testnet discovery endpoint with limit 100 and offset zero. It contains all 27
reported resources, their original declarations and offered payment alternatives.

Search a description or declared input, such as `topic`, `mode`, `original` or
`address`. Apply separate type, network, scheme, asset, recipient and extension
filters. Payment filters must occur together in one original accepted option.
Clear the query to browse source order.

Edited controls remain separate from the last applied results. Previous/next
continue the applied query and filters. Each result retains its zero-based source
row and its rank. **Inspect** shows the full original declaration and terms.
Choose an option, name the request, prepare the complete review and download it.
Its own exact byte count and SHA-256 are displayed.

The complete source is at
`stellar-forge/developer-site/dist/grant-data/catalog-source-vellar-20261012.json`
in the checkout and `./grant-data/catalog-source-vellar-20261012.json` beside the
running grant page. The original `catalog-parameter-evaluation-20261012.json`
comparison alongside it retains its separate 33-query results and method.

## Receive in the installed product

The maintained `grant-reviewer` source selection includes Atlas's application,
both commands, typed workspace/review APIs and complete browser dependencies.
The full merchant package includes the same source.

In Applications, open the existing **Atlas** workspace. Expand **Receive a catalog
review** and choose the complete downloaded JSON. Inspect its source and exact
terms, then choose **Receive and open this request**.

Atlas retains the original page and review. Its request editor opens the selected
resource and payment option. Enter the intended concrete URL, advertised method,
headers and body/ticket inputs required by the operation. Preparation and handoff
preserve that request. The configured buyer supplies its authority and approval.

The saved request provides **Download original catalog review**. Complete export
and receiving carry the source, review and request revisions to another host.

## Terminal opening

Use actual absolute file and private workspace paths on the receiving host.
Close the browser process before the CLI opens the same single-writer directory.

```sh
starforge atlas-workspace inspect-review \
  --input /data/atlas-catalog-review.json
starforge atlas-workspace receive-review \
  --workspace /private/atlas --input /data/atlas-catalog-review.json
starforge atlas --workspace /private/atlas --port 0
```

Inspection opens no workspace. Receipt returns the saved capture and selection
IDs. Open the exact local URL printed by the final command.

Source-checkout equivalents use Node 22.16+:

```sh
node stellar/scf-starforge-20261009/sf61-bazaar-explorer/workspace-cli.mjs \
  inspect-review --input /data/atlas-catalog-review.json
node stellar/scf-starforge-20261009/sf61-bazaar-explorer/workspace-cli.mjs \
  receive-review --workspace /private/atlas --input /data/atlas-catalog-review.json
node stellar/scf-starforge-20261009/sf61-bazaar-explorer/server.mjs \
  --workspace /private/atlas --port 0
```

For a raw provider page use `atlas-workspace receive-page`, then search its returned
capture ID. The complete installed
`stellar/scf-starforge-20261009/sf61-bazaar-explorer/CATALOG_REVIEW.md` guide covers
the typed API, native receiving journey and source contract. `CAPTURE_SEARCH.md`
in that directory covers paginated captures and explicit native request inputs.

## Source and operating scope

The reader fetches its same-origin retained page and searches it locally. It
shows the acquisition time and coverage. The downloaded selection contains every
original source row and the exact selected alternative.

The operated testnet XLM purchase shown in the film and original Grant purchase
reviewer retains its own history. This October 12 catalog advertises its original
USDC alternatives. An installed buyer evaluates its actual service, asset, limit
and authority when continuing a selected request.

The existing application answers, six funded packages and $38,000 prospective
budget remain the grant plan. This reader and Atlas continuation form part of the
delivered product foundation.

## Materialize the complete static reader

The installed source server resolves every declared browser route through
`browser-assets.json`. For the existing static publication, materialize that same
complete mapping:

```sh
starforge grant-application export --out /private/new-static-grant-reader
```

The output contains the full current reader and every declared original asset,
including shared catalog modules whose source files live outside `dist`. Publish
the complete output and open `/grant.html`. A bare copy of `dist` does not include
those mapped source aliases.

`starforge-static-reader.json` records each route, content type, copied filename,
source path and complete byte/hash identity. Its explicit `rootRoute` retains the
server's original `/` alias without overwriting the distinct `/index.html` file.
Use that mapping if the publishing host needs the same root route. The grant
entry itself remains `/grant.html`.

The export reads the currently selected original manifest and source files,
streams each complete asset, and rejects source changes during the operation.
The output directory must be new; failed output retains completed files for
inspection. Select a new output after correcting any missing or changing source.
No remote source is refreshed. Serve the output through the existing HTTP/HTTPS
publisher so browser modules and the retained-source request use their normal
same-origin routes.

The application API is
`@tokenjunkielabs/starforge-merchant/grant/static-reader`:
`exportGrantStaticReader({ directory: absoluteNewDirectory })` returns the entry,
complete route/file counts and exact static-manifest identity.
