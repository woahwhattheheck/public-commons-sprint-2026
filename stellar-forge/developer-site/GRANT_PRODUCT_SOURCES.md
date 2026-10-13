# Product source declarations and cumulative composition

The existing `grant-compose` command receives product declarations from `grant-products/` while preparing its four established reviewer files. A product author owns its complete chapter and declaration; the publisher selects the current manuscript and composes all accepted contributions into the same application. The original customer, A2A, finance, Datasette and delivery-plan receivers remain part of that composition.

## Complete reporting workflow

[Grant Reporting](GRANT_REPORTING.md) describes the complete existing managed-case workflow: original case and Source Tables selection, portable preparation, native capture, frozen reopening, original procedure save, full case export, independent receiving and attributed returned revisions. Its seven source records select the maintained Merchant implementation at one immutable commit. The declaration records those original repository identities, rather than treating this application-authoring checkout as an installed native Grant workspace.

The same declaration reader also receives the existing document-processing, CFCE GiveCredit and Stellarcarbon files when their corresponding accepted chapters are present.

## Receive the current manuscript

Keep the complete existing dist directory and all its source selections. Run the original composition command with the current complete canonical manuscript:

```sh
node stellar-forge/developer-site/grant-compose.mjs \
  --directory stellar-forge/developer-site/dist \
  --manuscript /absolute/current-canonical.md \
  --source-pins-output /absolute/current-reader-pins.json
```

This reads every ordinary JSON file in the default `grant-products/` directory in sorted order. The accepted manuscript supplies the exact H2 chapters and their immutable source links. A chapter owns its H3 and deeper content up to the next real H1 or H2; fenced examples remain chapter content.

The composer retains the same output paths:

| Output | Complete delivered content |
| --- | --- |
| `grant.html` | Existing reviewer page, full application, original saved-submission and review controls |
| `grant-data/application.md` | Nine complete application answers |
| `grant-data/product-and-finance.md` | Complete accepted customer chapters and funded-delivery material |
| `grant-data/source-index.json` | Original source records, selected editions, declaration identities and application metadata |

Receive these full outputs through the existing cumulative publisher and saved application. Each source edition receives its own normal review in that same operation.

## Select additional declarations

To receive an author's complete declaration before it is installed, add `--product-registration /absolute/received-product.json`. Repeat that option for distinct product files. The current installed directory is still included.

To choose another complete declaration set, use `--product-registrations-directory /absolute/received-grant-products`. The directory must exist; errors retain the original output files because declaration loading finishes before composition writes them. Repeating the same file path reads it once. Two declarations with the same product ID, or source IDs assigned to different products, require an explicit source selection.

Each declaration follows `stellar-forge.grant-product-registration.v1` and contains `id`, the complete `heading`, and a `sources` array. Each source supplies its stable `id`, reader `label`, original `repository`, `path`, and optional `kind` (`blob` or `tree`). An optional full `commit` selects one edition when the chapter contains more than one link to the same path. Known file editions may include complete `bytes`, `sha256` and `git_blob` measurements.

Use [grant-products/grant-reporting.json](grant-products/grant-reporting.json) as a complete measured example. Its chapter links all seven original source bodies, so the default required-source checks apply.

A declaration whose chapter is absent leaves its product sources unchanged. When a chapter is present, required source links must select immutable original Git identities. A new source edition clears stale byte measurements and applies only its matching declared measurements. Existing unrelated source records and grant allocations stay in the same index.

## Existing API and public reader

`composeGrantApplication({ ..., productRegistrations })` accepts the same complete declaration documents. Omitting the optional array retains earlier callers. `validateGrantProductRegistrations`, `receiveGrantProductSources` and `grantProductChapters` are available from `grant-product-sources.mjs`; the shared pure implementation is `dist/grant-product-sources-core.mjs`.

Source intake happens before the existing public-link projection, so original repository, path and selected commit remain available when the reader uses an authenticated-source label. The declaration's filename, full byte count and hashes are retained in composition metadata. External parent directory names are excluded from that metadata. The composer also records both the re-export and actual registry-core Git blob identities.

The registry is the unchanged maintained Merchant module; product authors continue to own their source declarations there and can receive the same files in this distribution. Runtime execution continues through each product's existing installed command and customer workspace.


## Author product sources in the saved application

Open `/grant-submission.html` and choose **Product sources**, or **Author product sources** from the current Source editions view. The editor receives complete registration files, reads original chapters and measured source identities from the selected retained reviewer bundle, previews the same registry as the CLI, and exports a complete declaration ZIP. Author notes, original imports and editable declarations use the application's existing saved versions and full-draft export/reopen flow. Prepared submission snapshots retain their selected authoring source through the existing handover.

See [GRANT_PRODUCT_AUTHORING.md](GRANT_PRODUCT_AUTHORING.md) for the full chapter selection, import, preview, save, independent reopening and composer-file workflow.
