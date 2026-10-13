# Product Sources workspace

Product Sources is part of the existing SCF submission workspace at
`/grant-submission.html`. It edits independent product declarations against the
complete reviewer source edition retained in that application. Answers, native
plans, issuer fields, source files and product authoring use the same draft and
saved version history.

## Prepare a product declaration

1. Open the application or a complete reviewer source package. In **Source
   editions**, receive its four original files, then choose **Author product
   sources**.
2. Start product source editing and select the retained reviewer edition. Its
   complete companion supplies the chapter chooser; its original source index
   supplies the existing source IDs and measured file identities.
3. Choose **Receive indexed product declarations** to edit declarations already
   recorded in that edition. Use **Import registration files** to receive
   complete existing JSON declarations. Imported file bytes remain available
   under **Retained original registration files**.
4. For a new product, enter its stable product ID, select the actual H2 chapter,
   and create the declaration. Read the complete selected chapter in the editor.
5. Add the chapter's original sources. The source chooser uses its immutable
   Git links and original indexed records. Choose an existing source ID when it
   identifies the same original work. The maintained composer retains the
   original label for an existing source record.
6. Select the repository, original path, file or directory, and optional exact
   commit. Empty commit selection follows the chapter's unambiguous immutable
   edition. Required sources must occur when that chapter is present; optional
   sources may be omitted by that edition.
7. Use **Measured file editions** for a file's original Git blob, SHA-256 or byte
   length at a full commit. The source chooser carries measurements only for
   that exact file. Changing the repository, path or source type clears those
   working measurements. Original imported files and preceding versions retain
   their original values.
8. Choose **Preview source changes** to run the same receiver as the command-line
   composer. Inspect added and changed records, or open all retained records.
   The preview names a missing product chapter and any optional source omitted
   from the selected edition.

The form retains incomplete working declarations so an author can save and
continue. Preview and declaration exports validate the whole selected document
set with the maintained source-registration rules.

## Save, reopen and restore

**Save author project** writes the complete application to its existing browser
draft store. **Download full author project** exports that same complete draft,
including all retained application editions, four-file reviewer bundles, native
planning files, imported registration bytes, editable declarations, saved
versions and submission handover.

Use **Open author project** to receive the complete JSON in another browser or
**Saved browser drafts** to reopen its current local revision. The original
cross-tab revision check remains in force. **Version history** restores the
selected product declarations, author notes and selected reviewer bundle with
the answers and other working state. It retains the state from before that
restoration as another version.

Preparing a submission freezes its product-authoring state with the existing
author snapshot. The complete original reviewer files remain in the parent
draft and are reconnected when that prepared edition is reopened or verified.

## Export composer files

**Download this declaration** exports one complete JSON declaration. **Download
all composer files** creates a standard ZIP containing:

- `grant-products/<product-id>.json` for every working declaration;
- `source-index-preview.json`, the complete index computed against the selected
  retained companion;
- `README.md` with the selected source identities and composition command.

The export rereads and verifies the selected original reviewer bundle. It also
verifies each original imported registration. The existing command-line
composer binds the exact newly exported declaration bytes when it receives
those files; a preceding declaration's file identity remains with its original
import.

Extract the archive and select its complete declaration directory:

```sh
node stellar-forge/developer-site/grant-compose.mjs \
  --directory stellar-forge/developer-site/dist \
  --manuscript /absolute/path/to/current-canonical.md \
  --product-registrations-directory /absolute/path/to/extracted/grant-products
```

The directory option selects the complete declaration set. Keep one file per
product and include installed declarations that should remain active. An
additional product with a new ID can instead be appended to the installed
defaults using `--product-registration /absolute/path/to/new-product.json`.

The retained companion determines the authoring preview. The selected current
canonical manuscript determines the final composition. The same composer
continues to produce its complete application reader, application Markdown,
product-and-finance companion and source index.

## Source organization

The shared pure receiver lives in `dist/grant-product-sources-core.mjs`.
The existing `grant-product-sources.mjs` entry point re-exports its original
public API, preserving the command-line composer and installed callers. The
browser chapter chooser uses that receiver's fence-aware chapter outline.

The authoring model, source receiving and workspace are in the three
`dist/grant-product-authoring-*.mjs` modules. Their browser routes are declared
in the existing `browser-assets.json`. The submission core retains authoring
selections in ordinary versions; the original handover receiver verifies the
complete imported files and reconnects a prepared snapshot's source bundle.

See [GRANT_PRODUCT_SOURCES.md](GRANT_PRODUCT_SOURCES.md) for the complete
registration schema and maintained command-line options.
