# Product source selections

The original distribution builder can package a complete product from the same
Git commit as the full toolkit. A committed recipe chooses base registrations,
whole source-owned contributions, component directories and explicit support
files. The existing Git reader, source manifest, runtime profile, installer,
Applications launcher and recovery commands remain the distribution workflow.

## Build through the runtime workspace

The private runtime workspace's **Build a product** view discovers the recipes
at the chosen commit, reviews the complete selected product, builds its original
package, and opens the resulting archive in **Source & profile**. It retains the
same request and output through interruption and provides the original package
download. Follow [the complete browser and CLI workflow](runtime-workspace/SOURCE_BUILDS.md)
for source selection, adapter installation and recovery.

## Build a product

Run the maintained builder from a repository that contains the selected commit:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --ref ORIGINAL_COMMIT \
  --selection water-operations --out /absolute/water-release

node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --ref ORIGINAL_COMMIT \
  --selection woo-merchant --out /absolute/woo-release

node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --ref ORIGINAL_COMMIT \
  --selection openapi-merchant --out /absolute/openapi-release

node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --ref ORIGINAL_COMMIT \
  --selection grant-reviewer --out /absolute/grant-reviewer-release
```

Use any selection ID from the table below in the same build command and give
that product its own output directory.

Replace `ORIGINAL_COMMIT` with the full original commit SHA. Each output directory
belongs to one source commit and selection. The packaged receipt names the
archive, SHA-256, installed/source bytes, source acquisition and materialization.
The manifest adds `sourceSelection`: original recipe ID, title, path, Git blob,
SHA-256 and byte length. Its recipe also appears in the normal file inventory
and `distributionInputs`.

The package version includes both the commit and selection, for example
`0.1.0-source.g0123456789ab.selection.water-operations`. The full package retains
the original `0.1.0-source.g0123456789ab` version form.

| Selection | Product | Original Applications | Complete installed workflow |
| --- | --- | --- | --- |
| `buyer-task-desk` | Original Inbox tasks, saved RPC read editions and complete customer packages | Inbox tasks; Runtime management; Merchant tools | [Installation, original-root launch and independent receiving](../sf88-operator-buyer-cli/node/agents/task-desk/INSTALLATION.md) |
| `merchant-receivables` | Customer invoices, native Stellar collection and refunds, service calendars, payment plans, dated collections and cash planning, Xero handovers and customer closing | Merchant receivables, payment plans, service agreements, receivables Xero, customer closing and Runtime management | [Complete installed financial workflow](../../../products/merchant-receivables/README.md) |
| `merchant-payment-plans` | Reviewed customer installment editions, historical allocations and complete collection schedules | Customer payment plans, Merchant receivables and Runtime management | [Payment-plan operation](../../../products/merchant-payment-plans/README.md) |
| `merchant-service-agreements` | Accepted service quotation and renewal sources, dated recurring billing calendars and original receivables drafts | Merchant service agreements, Merchant receivables and Runtime management | [Service billing operation](../../../products/merchant-service-agreements/README.md) |
| `haystack-turnover` | Native building grids, source-local equipment and points, typed tag review, saved editions and complete editable turnover receiving | Haystack building turnover; Runtime management | [Complete installed operator guide](../../../products/haystack/OPERATING.md) |
| `human-services-directory` | Original HSDS and FHIR directory sources, complete editions and comparisons, reviewed mapping and service selection, Gravity clinical joins and editable customer handoffs | Human Services Directory; Gravity Referrals; FHIR Bulk Data; eLTSS Care Plans; Runtime management | [Complete directory programme and receiving](../../../products/human-services-directory/OPERATING.md) |
| `source-tables` | Complete CSV and TSV source authoring, typed field meaning, retained editions and comparisons, native merchant resources and editable customer handover | Source Tables; Runtime management | [Complete installation and operation](../../../products/source-tables/OPERATING.md) |
| `openlineage-operations` | Native Python and Java producer intake, original compressed/source bytes, job/run/dataset lineage, saved reviews and complete editable customer receiving | OpenLineage operations; Runtime management | [Complete installed operation and producer guide](../../../products/openlineage/OPERATING.md) |
| `dbnomics` | Exact economic series and source revisions, saved analyst reports, native publication, complete editable workspace and customer receiving | DBnomics economic workspace; Runtime management | [Operating guide](../../../products/dbnomics/OPERATING.md) |
| `coastal-operations` | Original NOAA editions, reviewed multi-station studies, complete model-input/source delivery, returned-file comparison, coastal workbooks and native customer files | Coastal source operations; Runtime management | [Operating guide](../../../products/coops/OPERATING.md) |
| `eurostat` | Eurostat official source editions, exact economic reports, native publication and complete customer receiving | Eurostat economic editions; Runtime management | [Operating guide](../../../products/eurostat/OPERATING.md) |
| `water-operations` | USGS observations, editions, Water workspace, merchant and complete customer files | Water, Buyer, merchant console | [Operating guide](selections/WATER_OPERATIONS.md) |
| `woo-merchant` | Existing WooCommerce orders, native checkout, Operations, purchased files and refunds | WooCommerce, Buyer, merchant console | [Operating guide](selections/WOO_MERCHANT.md) |
| `openapi-merchant` | OpenAPI/Postman/HAR authoring, route worksheets, policy editions, seller releases and complete receiving | API merchant authoring, Buyer, merchant console | [Operating guide](selections/OPENAPI_MERCHANT.md) |
| `grant-operations` | Customer adoption and cost plans, issuer terms, account/work records, saved operating procedures, period reporting and complete case/Application handover | Grant planning and delivery; Runtime management | [Complete public installation, operating programme and independent receiving](../../../products/grant-operations/OPERATING.md) |
| `grant-reviewer` | Retained purchase/source review, complete native Buyer results and closed receiving handover | Grant purchase reviewer | [Operating guide](selections/GRANT_REVIEWER.md) |
| `iati-operator` | IATI aid-finance source intake, review, native editions and complete operator exports | IATI aid finance | [Operating guide](selections/IATI_OPERATOR.md) |
| `redis-applications` | Redis/Valkey commissioning, native products, customer clients, complete exports and cutover comparison | Redis, Buyer, merchant console | [Operating guide](selections/REDIS_APPLICATIONS.md) |
| `safe-review` | Original Safe transaction intake, simulation purchase, retained result comparison and portable receiving | Safe simulation buyer, Tenderly, Buyer | [Operating guide](selections/SAFE_REVIEW.md) |
| `study-research` | Source editions, property research, reports, PostgreSQL publishing and complete customer receiving | Study Source Refresh, PostgreSQL workspace and publisher, Buyer, merchant console | [Operating guide](selections/STUDY_RESEARCH.md) |
| `publisher-360giving` | Complete 360Giving publisher source/reviews, native grant datasets, typed SDK/merchant operation and complete customer receiving | 360Giving publisher workspace; Runtime management | [Operating guide](../../../products/360giving-publisher/OPERATING.md) |
| `all` or no flag on a new build | Complete maintained toolkit | All registered applications | [Runtime installation](RUNTIME_INSTALL.md) |

The [API merchant installation and handover guide](selections/OPENAPI_MERCHANT.md)
continues from its selected archive through managed authoring, source-bound policies,
MCP/CLI files, complete package receiving, SF82 releases and customer reopening.

Use the product's installed `starforge --help` and `starforge registrations`
for its included commands. Selected packages expose their explicit named package
exports; the full toolkit's broad root `index.mjs` is excluded. This prevents
its unrelated re-exports from forcing every product into a selected package.
The original modules, their exports and implementations are unchanged.

For Eurostat, use `--selection eurostat` and the [complete operating guide](../../../products/eurostat/OPERATING.md). Its selected source includes the original economic workspace, retained official responses and reviewed queries, full reports, browser and typed client, all 26 Eurostat MCP tools, native publication, merchant releases and complete customer receiving.

For Coastal source operations, use `--selection coastal-operations` and the [complete operating guide](../../../products/coops/OPERATING.md). The selected source includes original station and archive operations, saved receiving mappings, reviewed multi-station studies, complete model-input/source deliveries and returned-file comparisons, full offline analytical workbooks, native query and releases, all 48 coastal merchant tools and complete customer receiving.

For DBnomics economic work, use `--selection dbnomics` and the [complete operating guide](../../../products/dbnomics/OPERATING.md). The original application retains official provider responses, native periods and values, saved analyst reports, reviewed publication, complete editable exports and customer files.

For OpenLineage, use `--selection openlineage-operations` and the [complete operating guide](../../../products/openlineage/OPERATING.md). The selected source includes the original lineage workspace, Python and Java producer configuration, gzip intake with original source identities, browser and typed client, direct MCP and managed merchant tools, complete reports, and independent receiving of the editable application and workspace. The maintained merchant profile is `--native --feature schema --feature openapi --feature mcp --operator`.

## Continue the same build

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --out /absolute/water-release --resume
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /absolute/water-release --status
```

An omitted selection on resume inherits the saved selection. An explicit
different selection, including `--selection all` for a selected output, returns
`DISTRIBUTION_SOURCE_SELECTION_CONFLICT`. Use a new output for a different
product. A completed build returns its original verified archive without another
pack. The retained source commit, original output lock and partial-file recovery
retain their existing behavior.

For offline builds add `--offline` after the original source objects have been
acquired in that repository. Recipes and selected contributions are read in
small batches before product sources; unselected contribution JSON does not
travel in the selected archive.

## Install and operate the original product

Use the returned archive path and SHA-256 with the original installer. Select
its dependency profile from the complete installed workflow linked above:

| Selected product | Profile flags for the complete installed edition |
| --- | --- |
| `haystack-turnover` | `--operator`; install the selected product with `--offline` |
| `openapi-merchant`, `safe-review`, `water-operations`, `woo-merchant`, `eurostat`, `coastal-operations`, `dbnomics` | `--native --feature schema --feature openapi --feature mcp --operator` |
| `redis-applications` | `--native --feature redis --feature schema --feature openapi --feature mcp --operator` |
| `study-research` | `--native --feature schema --feature openapi --feature mcp --feature postgres --operator` |
| `grant-operations` | `--operator --feature mcp`; preserve the selected profile and supply original optional native inputs for buyer/support receiving |
| `grant-reviewer` | `--native --feature mcp --operator` |
| `publisher-360giving` | `--feature mcp --operator` |
| `iati-operator` | `--operator` |

The following example uses the common merchant profile. Substitute the flags
from the product's row and keep that product's original runtime directory.
The selected recipe and its contribution declarations determine the available
dependency groups; the installer resolves the actual profile and lock.

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /absolute/customer-runtime --archive /absolute/product-release/ORIGINAL.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 --native \
  --feature schema --feature openapi --feature mcp --operator
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /absolute/customer-runtime
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /absolute/customer-runtime --load --source
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /absolute/customer-runtime -- source
```

The selected archive supplies its own contribution and recipe inputs to the
runtime profile. Exact dependency selection, npm cache use, native probes, READY
state, retained lock, offline transfer and installation recovery remain the
existing installer operations. An existing complete dependency tree can be
received through the maintained `--adopt-existing` option; it must satisfy the
selected original profile and retained lock.

Register that READY runtime in the original Runtime workspace, then use its
Applications tab to review, save, start, open, stop and reopen the product's
existing application. Installed source is separate from the existing customer
project, WordPress site, merchant state, outbox, buyer operation and downloaded
files. Use those original paths and operation identities through upgrades.

## Maintain a recipe

Recipes live in `distribution/selections/ID.json` and use schema
`stellar-forge.distribution-source-selection.v1`. The filename must match the ID.
`base.commands` and `base.exports` explicitly name existing base declarations;
`base.features` names the original feature or package-manifest groups.
`base.applicationProviders` and `base.merchantProviders` name base providers
when the base declares any. `base.browserAssets` selects an existing base browser
server and its original mapping manifest.

`contributions` selects complete existing contribution IDs. The builder composes
them after base selection; a conflict between included owners remains an error.
Unselected contributions do not participate. Their source ownership, command
descriptions, providers, dependencies, browser assets and support files remain
the original contribution's declarations.

`components` selects complete original directory roots; `supportFiles` selects
explicit original files. Optional `excludeFiles` adds exact file exclusions to
the original base exclusions. A required command, export, provider, runtime
manifest or static import cannot be excluded successfully. The optional
`product` object selects existing source README/bin and product metadata through
the maintained product-package contract. When that object omits `repository`,
the selected product inherits only `base.product.repository` when present.
An explicit recipe repository remains authoritative. README and executable
selection continue to use the recipe and the original product-package defaults;
unrelated base executables are not inherited. If the base has no repository
override, the maintained package default remains in effect. This keeps a
standalone product's source identity without bringing other products' bins
into its selected archive.

Optional `managedSourceManifests` selects original JSON source inventories beside their source. The builder retains each selected manifest and every original file it declares. Installed declaration reading checks that complete inventory against the original package entries; it does not substitute the receiving workspace's current files or silently omit an absent declared path.

Explicit support-file declarations retain the complete original file regardless
of extension, including publisher TeX, native input/reference formats and opaque
support assets. They do not broaden automatic component-directory discovery:
undeclared formats still follow the maintained runtime-file heuristic. The
existing hidden-directory, excluded-directory and exact `excludeFiles` rules
remain in force. Only the existing explicit CSV/JSON/TXT/Parquet fixture-data
exception permits a `fixtures` path; declaring an executable fixture does not
permit it. The original Git reader still requires regular source files, exact
object identity and the per-file and aggregate byte bounds. A declaration that
violates those rules remains a missing required entry rather than being silently
dropped from a supposedly complete package.

Required command and export targets, selected provider modules, runtime package
manifests, and browser server/manifests are retained as explicit runtime seeds.
The original static ESM and browser-map closure then includes their dependencies.
Complete component directories retain Python modules, template files, generated
plugin inputs, browser resources and other paths loaded dynamically. A new
product recipe therefore needs its original operational receiving journey,
including restart and downloaded files, as well as a successful build. Static
module closure cannot prove that a dynamically constructed pathname is present.

Installed declaration reading checks the original recipe and every contribution
against the retained file inventory. A runtime cannot switch recipes or add an
unselected registration file inside an existing selected package.

## Receiving and measurements

Build the selected products from the same original commit as a full release.
Compare the receipt's `sourceFiles`, `sourceBytes`, `archiveBytes`,
`installedBytes` and acquisition metrics. Report actual measured results with
that commit; the command/provider counts alone are not a size or memory measure.

Receive each archive through the original unpacker and runtime profile. Confirm
that Applications and merchant provider catalogs contain its selected entries,
that installed command help matches its registrations, and that the original
product can complete its saved native journey. Reopen the same output with
`--resume`, and confirm an explicit different selection cannot reuse it.

## Flowable process operations and customer receiving

Use [flowable-merchant.json](selections/flowable-merchant.json) to compose the
complete installed Flowable workspace, native process source, typed client,
Applications integration and merchant MCP provider. The original process
engine handles deployment, human tasks, native migration validation and
execution; the saved workspace retains complete request and source/history
receiving.

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/tjlabs-stellar-merchant-workspace \
  --ref FULL_ORIGINAL_COMMIT --selection flowable-merchant \
  --out /absolute/flowable-release --offline
~~~

Follow [FLOWABLE_MERCHANT.md](selections/FLOWABLE_MERCHANT.md) for the complete
build/install/Open workflow, actual engine receiving and customer handover.
The recipe includes the source-owned `flowable-workspaces`,
`merchant-provider-flowable-workspaces` and `flowable-product`
contributions, the original browser assets and complete installed guides.

## Haystack building turnover

Build `--selection haystack-turnover` to retain the native grid codec, source-local
equipment and point index, reviewed tag proposals, saved source editions, full
reports and complete editable receiving application. The selected
`haystack-workspace` contribution supplies the `haystack` and `haystack-mcp`
commands, typed native exports, original browser route map, managed Applications
entry and `haystack-workspaces` Merchant provider.

The complete source component includes the original Charlie grid, its source
metadata, the upstream license, operator guides and `RECEIVING.mjs`. The
application, managed Applications lifecycle and registered Haystack Merchant
provider use Node builtins and the maintained local helpers. Select `--operator`
through the original runtime installer for this dependency-free product. The
complete operator guide describes separately selected wider host integrations.

Continue the [complete native operator and receiving workflow](../../../products/haystack/OPERATING.md)
against the same saved building project. A customer package retains every
source byte, proposal and review, saved edition, original request outcome and
portable application file; the received application reopens that original
workspace for continued work.

## Complete Groundwater installation receiving

The existing `groundwater-reports` product is exercised through its original managed source review, package build, selected runtime install, lock-bound offline transfer, independent install and saved-build reopen. The [complete receiving guide](receiving/GROUNDWATER.md) and its caller retain one source-build request and verify all 64 scientific files in both installations. The separate `groundwater-report` selection remains the Report Desk product. Scientific execution continues through its existing workspace and owner.

## Merchant invoicing, collections and customer handover

Build `merchant-receivables` to receive the complete invoice and customer-account product from one source commit. Its Applications entries operate original receipts and credits, verified Stellar invoice collection and refunds, customer payment plans, accepted service calendars, Xero customer handovers and complete statement closing. Collections and Cash planning open within the same Receivables process.

The `merchant-receivables` contribution carries both the invoice server and its eagerly imported payment-plan browser manifest. It also retains the original Stellar network catalogue and native SDK package manifest, so the payment verifier has the same selected dependencies in Receivables, Payment plans, Service agreements and Xero builds. Native features are installed through the original Runtime workflow, using the package's declared versions.

Follow the [financial operating guide](../../../products/merchant-workspace/FINANCIAL_OPERATIONS.md) from original transfer reconciliation through invoices, allocations, refunds, schedules and customer delivery. The [receivables product guide](../../../products/merchant-receivables/README.md) gives the exact source build, Runtime preparation, managed Applications, customer closing and durable CLI/MCP steps. The source selections retain all existing accounting and quotation components; every saved operation continues in its original private workspace.
