# Upper Savannah class-pathway reading edition

Open `Upper_Savannah_Class_Pathways_Reading_Edition_20261013.html` in a browser. The complete reader, original four CSV tables, complete analysis and saved review project are inside that one file. Select a watershed or utility group. The six queued watersheds display their exact saved question and an expandable original review note beside the original class pathways.

The separate `Upper_Savannah_Class_Pathways_Original_20_20261013.zip` is the complete original native delivery. Extract it into a new directory. Its `native-sources.json`, original `OPEN_FIRST.html`, original twelve source documents, six generated report/table files and manifest are unchanged. Existing receiving owners can register that original manifest in their existing Workspace. The reading edition is additive and does not create a competing Workspace or alter the saved project.

## Recreate the reading edition

Use Python 3.9 or later. The command refuses an existing output and refuses to write inside the native delivery:

```sh
python make_portable_class_pathway_reader.py --delivery ORIGINAL_DELIVERY_DIRECTORY --output NEW_READING_EDITION.html
```

All embedded files are checked against the original delivery manifest. The saved project must use the same source edition, and each queued question must match a watershed already in the reader. All six downloaded files preserve their original bytes and filenames. The displayed native cell area is rounded for reading; analysis.json preserves full precision. The input delivery stays unchanged.

## Original data and computation

Original native source ID: `upper-savannah-utility-class-attribution-07abf5e96876140b`.
Original source edition: `4b2efdbd79bce5f9327f7c2a94e46d41bd6a975dcd10c2739b66f284c394365e`.

The original Node producer was executed once from all twelve exact retained inputs: 217 watersheds, 55,552 full class-matrix rows, eleven reader subjects, 88 group rows, 764 criterion-pathway rows and 1,303 positive class-pair rows. Its complete twenty-file output reproduces the published manifest `978a363006e70406bf23e723b5672c649f6df175` exactly.

```sh
node ORIGINAL_DELIVERY_DIRECTORY/originals/source_tools/watershed_review/build_attribution.mjs ORIGINAL_DELIVERY_DIRECTORY/originals ORIGINAL_DELIVERY_DIRECTORY/originals NEW_ORIGINAL_OUTPUT_DIRECTORY
```

The final reading edition was supplied unchanged to Chromium 144's document renderer, operated at 1440- and 390-pixel widths, downloaded all six files, and reopened from its saved bytes. The actual desktop and narrow-screen images were viewed. The local managed browser rejects file and loopback URL navigation, so those transports are not part of this recorded operation.

For the scientific interpretation and active integration controls, retain the complete `originals/CURRENT_OWNER_DIRECTION.md` version 2026-10-13.3 included in the original delivery. Whole-HUC utility groups are the original classification supports; actual reporting masks and native geographic model results remain separate source products.
