# Product catalogue and installation planning

Choose a maintained product from the repository's own source recipes, compare its
capabilities, and continue through the original Source Builds workflow. The
catalogue uses the source commit resolved by the original Git reader. Its CLI and
the Source Builds browser share the same search, comparison and planning views.

## Find a product

From an installed full toolkit:

~~~sh
starforge product-catalog list --repo /srv/starforge/source --query "water quality"
starforge product-catalog list --repo /srv/starforge/source --query "graphql"
~~~

From a source checkout, use the original source entry:

~~~sh
node stellar/scf-starforge-20261009/distribution/product-catalog/cli.mjs \
  list --repo /srv/starforge/source --ref HEAD --query "merchant"
~~~

Search matches the original selection ID, title and description. Separate words
must each match; double-quoted phrases match together. Results rank an exact
selection ID first and then use deterministic text relevance. An empty search
keeps the committed catalogue order.

The default view retains recipes that need correction, including their original
error message. Add --available-only to show syntactically available recipes.
Inspecting a product composes its actual selected declarations and reads its
original guide and licence through the maintained source-build engine.

The default source mode uses local Git objects. Supply --fetch-sources when the
original reader should obtain missing objects from the checkout's configured
promisor remote. Every invocation resolves one commit before describing products;
a branch update during a comparison cannot mix source revisions.

## Inspect and compare complete product choices

~~~sh
starforge product-catalog inspect --repo /srv/starforge/source \
  --ref HEAD --selection graphql-workspace --format markdown

starforge product-catalog compare --repo /srv/starforge/source \
  --ref HEAD --selection graphql-workspace --selection openapi-merchant \
  --format markdown
~~~

Each product view includes its package identity, original guide, commands and
entrypoints, package exports, Applications, merchant providers, source components,
runtime feature declarations, and the exact source input identities. Comparison
shows the union of these capabilities across the selected products. A shared
command is shared only when it points to the same original entry; a shared package
export must retain the same complete conditional target. Native package
requirements and feature declaration differences remain visible.

All products in a comparison belong to the same repository and source commit.
Choose the same --ref for one comparison, or use the catalogue's resolved full
commit when continuing a prior selection.

Runtime package manifests take precedence over the generic feature declarations,
as they do in the original installer. A manifest-backed feature displays its
committed manifest path. The original runtime-profile workflow reads the real
dependency body and resolves its exact selected versions during preparation.

## Prepare an installation plan

~~~sh
starforge product-catalog plan --repo /srv/starforge/source \
  --ref HEAD --selection graphql-workspace \
  --output /srv/starforge/builds/graphql \
  --runtime /srv/starforge/runtimes/graphql \
  --feature graphql --feature schema --feature openapi --feature mcp \
  --native --operator --format markdown
~~~

The plan supplies the exact original build command and retains the chosen
features. Run that command or continue through the existing Source Builds
browser. Its completed build returns the archive, SHA-256, selected source
identity and package identity.

Use that original JSON build receipt to complete the installation commands:

~~~sh
starforge product-catalog plan --repo /srv/starforge/source \
  --ref ORIGINAL_FULL_COMMIT --selection graphql-workspace \
  --runtime /srv/starforge/runtimes/graphql \
  --receipt /srv/starforge/builds/graphql/receipt.json \
  --feature graphql --feature schema --feature openapi --feature mcp \
  --native --operator --format markdown
~~~

Replace the receipt path with the original receipt file returned or saved by the
builder. The plan accepts a direct PACKAGED receipt or the build field of the
original Source Builds result. Its archive must match the selected commit,
selection, package name and package version. Preparation passes that archive and
its hash to the existing runtime installer, which verifies the bytes and source.

The output names the working directory and complete argument vector for every
step. The sequence is original build, runtime preparation, dependency installation
and source inspection. Steps with missing inputs identify those inputs instead of
printing a command containing invented archive values. Installation retains the
original runtime directory, source, dependency profile and recovery workflow.

To add an original product command after installation, use --command followed by
its unchanged arguments after --:

~~~sh
starforge product-catalog plan --repo /srv/starforge/source \
  --ref ORIGINAL_FULL_COMMIT --selection graphql-workspace \
  --runtime /srv/starforge/runtimes/graphql \
  --receipt /srv/starforge/builds/graphql/receipt.json \
  --feature graphql --feature schema --feature openapi --feature mcp \
  --native --operator --command graphql-workspace -- --help
~~~

The command must exist in that selected product. Its arguments remain separate
strings in JSON and are shell-quoted in the Markdown command. Planning leaves
execution with the original builder, installer and product command.

## Programmatic use

The package export ./product-catalog selects catalog.mjs. That module contains
pure JavaScript with no Node or browser side effects and operates on the original
source-build values.

| Function | Input | Result |
| --- | --- | --- |
| searchProductCatalog(catalog, options) | Original sourceBuildCatalog result; query and availableOnly | Original product rows, deterministic search order, total, available and matched counts |
| productSourceSummary(review) | Original describeProductSource result or retained source review | Source and package identities, full capabilities, requirement declarations, guide and source input identities |
| compareProductSources(reviews) | At least two distinct descriptions from one repository and commit | Products, selection IDs, named sections and flattened comparison rows |
| planProductInstallation(review, options) | Original description plus directory, runtime selection, optional original receipt and command | Original command vectors, required inputs and step dependencies |
| formatProductCatalogMarkdown(view) | A search, product, comparison or installation plan view | A complete portable Markdown representation |

A comparison row has name, values and shared. Values follow the product order;
null means absent. Command and export values contain the original target. Named
capabilities use true. Runtime feature values contain manifestPath and
dependencies. The shared field compares the complete value, including nested
conditional exports, independent of object property order.

The optional runtimeRequirements field is supplied by
describeProductSource(source, { ..., includeRequirements: true }). It carries the
original nativePeers, featurePeers, runtimePackageManifests and featureNames.
Existing saved source reviews keep their original content and identity.
The read-only product detail endpoint enriches the same description for display.

The CLI export ./product-catalog/cli provides readProductCatalogCommand(args) and
main(args). readProductCatalogCommand returns {format, value}. It calls the
maintained sourceBuildCatalog, opens the resolved commit once, and reuses the
original describeProductSource for each chosen product. The catalogue adds no
parallel source composer, package builder or workspace store.

## Source and package integration

The contribution file contributions/product-catalog.json registers the
product-catalog command, both exports, and the complete source component. Full
toolkit packages discover this contribution through the original registration
composer.

Source Builds serves catalog.mjs through its explicit browser source route. Its
browser-asset declaration carries that same source into selected packages using
the ordinary static import and browser-asset closure. Product choices continue to
use their original recipe, source review, stable request, builder, output archive
and runtime receiving workflow.

The original operating guides are
../runtime-workspace/SOURCE_BUILDS.md, ../SOURCE_SELECTIONS.md and
../RUNTIME_INSTALL.md.
