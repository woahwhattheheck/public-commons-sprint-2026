# WRI geothermal source edition

This directory retains the complete geothermal selection from the World Resources Institute Global Power Plant Database served by Datasette. It is a usable source edition for the Datasette merchant and customer Analysis workflows.

## Source and attribution

- Publisher: World Resources Institute, [Global Power Plant Database](http://www.wri.org/publication/global-power-plant-database).
- Host project: [global-power-plants-datasette](https://github.com/simonw/global-power-plants-datasette).
- License: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
- Original selection: [all geothermal rows, native array pages of 50](https://datasette.io/global-power-plants/global-power-plants.json?primary_fuel=Geothermal&_shape=arrays&_size=50).
- Retained observation window: 2026-10-12 14:31:08–14:41:57 UTC. The deployment identified itself as Datasette 1.0a41.

The four original response bodies contain 189 rows across 22 countries and 26 ordered columns. The complete source review found 189 distinct, nonblank `gppd_idnr` values. The native database declares no primary key; its response `rowid` remains a database locator. The saved review deliberately uses `gppd_idnr` as the edition's candidate business key.

These are historical plant attributes. Keep capacity in MW separate from generation in GWh, retain each generation year, and preserve estimated generation as its own field. Missing values remain missing. A country or owner selection operates on this retained edition.

## Receive the completed edition

From the repository root, use Node 24 and an absolute private workspace directory:

```sh
DATASETTE_SOURCE="$PWD/stellar/scf-starforge-20261009/sf30-seller-sdk/datasette"
node "$DATASETTE_SOURCE/cli.mjs" --directory /private/geothermal --create \
  --operation source.receive \
  --input "{\"archiveFile\":\"$DATASETTE_SOURCE/sources/wri-geothermal-20261012/wri-geothermal.sfds.gz\",\"sha256\":\"53f2486406d61f18c9e1c9ceaac659c265bbad7afe2fe54b1a17f43307cb0ca0\",\"id\":\"wri-geothermal\"}"
node "$DATASETTE_SOURCE/cli.mjs" --directory /private/geothermal \
  --operation editions.inspect --input '{"id":"wri-geothermal","limit":250}'
node "$DATASETTE_SOURCE/cli.mjs" --directory /private/geothermal \
  --operation source.select --input '{"editionId":"wri-geothermal"}'
```

The 59,792-byte archive contains all 17 source-edition members. Its edition SHA256 is `ee34942e0c4c090d4e5cab66eeb51dda49c5cf8852f86d9dfa299913b4115616`. The exact original responses, request/continuation records, metadata, approved projection and key review remain inside the received edition.

## Original complete programmes

`native-result.json` records the completed native source programme: retain two pages, reopen the saved continuation, adopt all four original responses, review every row and column, create an edition, export, independently receive and reopen, then compare every original row. Reopening a completed capture made no new source request. Both repeated export and repeated receiving reused their original complete operation.

The complete original input is `source-carrier.json`; its SHA256 is `b903dd5d148cdcc6286481f8a1365755dcddb2481a6d76ac73929d8635cc2857`. The standalone command is:

```sh
node "$DATASETTE_SOURCE/acceptance.mjs" \
  --packet "$DATASETTE_SOURCE/sources/wri-geothermal-20261012/source-carrier.json" \
  --directory /private/geothermal-source-programme
```

`workspace-native-result.json` records complete workspace export and receiving, an operator edit, replay preserving that edit, and a second complete transfer retaining both receiving histories. The programme is `archive-acceptance.mjs`; it consumes the already completed source archive.

Each programme uses a new destination for a new run. Normal operation should reopen the retained workspace and continue its saved IDs. Publisher and customer receiving guides describe their corresponding existing native operations.

## Acquisition records

`manifest.json`, the four page bodies, `table-metadata.json`, `publisher-metadata.json`, and `qualification/` retain the original source and schema observations. Pages 1 and 2 have native HTTP observations. Pages 3 and 4 retain their completed provider-file import records and original bodies. The capture preserves the recorded observation window and native continuation chain.
