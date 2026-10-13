# Command finder

Find the maintained command for an operating task, inspect its source-owned
registration and declared runtime groups, and carry a complete selection into
another tool.

The command finder reads the same effective distribution specification as
`starforge`. It includes base registrations and the installed source
contributions. The CLI, browser, Applications entry and JavaScript API share one
catalog and search implementation.

## Search the installed toolkit

```sh
starforge discover dataset --kind command
starforge discover "dataset delivery"
starforge discover --source ckan
starforge discover --feature postgres --kind command
starforge discover show command:buyer-dataset
```

Terms are case-insensitive and combined with AND. An exact name ranks first,
followed by name prefixes, name substrings, descriptions and the remaining
registration metadata. Use double quotes within the query for an exact phrase:

```sh
starforge discover '"complete customer"'
```

Use `--kind` to select `command`, `source`, `feature`, `export`,
`application` or `merchant`. Sources refer to original contribution IDs,
including `base`. A feature filter selects registrations whose source declares
that runtime group. The default page has 50 entries; `--page` and
`--page-size` select another page. The response always records the total,
selected page and number of pages.

A command result supplies its original name and entrypoint, source ownership,
native help arguments, and other command names using that exact entrypoint.
Copy the native help command to inspect the selected implementation's arguments.

From a source checkout, use the same CLI directly:

```sh
node stellar/scf-starforge-20261009/distribution/discovery/cli.mjs dataset
```

## Open the browser

```sh
starforge discover serve --port 0
```

Open the printed local URL. The monochrome interface provides:

- Search across commands, sources, runtime groups, exports and provider registrations.
- Independent type, original-source and source-runtime filters.
- Paginated results with exact counts and selection details.
- Native help commands, entrypoint aliases and original source inspection.
- Declared package versions and their import probes.
- Conditional JavaScript/TypeScript export targets.
- Complete filtered JSON download, independent of the visible page.
- Shareable local query/result URLs and source refresh.

Search runs over the loaded package metadata. Refresh reads the original
selected package again. A failed refresh keeps the prior catalog available and
shows the actual read error. Stop the foreground process with Ctrl-C.

The maintained **Applications** catalog also includes **Command finder**.
Select the intended runtime, choose its local port, and use the normal
Review/Save, Review Start, Start, Open and Stop operations. The provider starts
this same command and reads its exact listener status. Saved application and
runtime identities stay with the original Applications lifecycle.

## Export the complete selection

```sh
starforge discover export --kind command --out /absolute/new-command-catalog.json
starforge discover export --source ckan
starforge discover dataset --kind command --json
```

`export` includes every match; the search command's `--json` represents its
selected page. An output file is written through a synced temporary file and
published without replacing an existing destination. Use a new filename for a
different export.

The exported JSON records the actual package name, version, original manifest
commit and source selection when installed, the catalog read time, query,
filters, total and complete entries. A checkout retains its
`source-checkout` version and a null manifest commit.

The local HTTP interface uses the same data:

| Route | Result |
| --- | --- |
| `GET /api/health` | Exact listener instance, selected package, catalog time and counts |
| `GET /api/catalog` | Fresh complete catalog from the selected source |
| `GET /api/search?q=dataset&kind=command&page=1&pageSize=50` | Paginated search |
| `GET /api/export?source=ckan` | Every selected entry as a JSON attachment |

Search and export also accept `source` and `feature`. Filters are combined.
The catalog is generated from declarations and package manifests; provider
modules are not evaluated during catalog reads.

## Runtime declarations

Runtime groups show the declared packages and versions from the maintained
`featurePeers`, `nativePeers` and original
`runtimePackageManifests`. For a manifest-backed group, its original
`dependencies` supply the versions and its source path remains visible.
An installed package verifies those manifest bytes against its original source
inventory before presenting them. An unavailable optional manifest keeps its
group and the specific read error in the catalog.

A source may own several commands, exports and runtime groups. Their
`featureIds` record that shared source relationship. Select the actual feature
profile through the existing runtime profile and installer when preparing a
runtime; `starforge doctor --feature NAME` inspects available dependencies.


## Products covering required capabilities

Use **Build a product** in the original Runtime workspace to select a complete capability requirement and compare maintained recipes. The original product catalog supplies search and comparison; the requirements extension adds exact coverage, source owners, committed runtime versions and native build review request exports.

~~~sh
starforge discover requirements --repository /srv/starforge/source \
  --require command:grant-workspace --require command:grant-source-tables

starforge discover review-request grant-operations \
  --repository /srv/starforge/source --out grant-review-request.json \
  --require command:grant-workspace --require command:grant-source-tables
~~~

[Choose a product by required capabilities](./PRODUCT_REQUIREMENTS.md) explains exact IDs, complete and partial coverage, dependency locks, native review handoff and typed APIs.

## JavaScript and TypeScript

The installed package exposes the dependency-free projection and search API:

```js
import {
  searchCommandCatalog,
  exportCommandCatalog,
  findCatalogItem,
} from '@tokenjunkielabs/starforge-merchant/operator/discovery';
import {
  loadCommandCatalog,
} from '@tokenjunkielabs/starforge-merchant/operator/discovery/source';

const catalog = await loadCommandCatalog();
const page = searchCommandCatalog(catalog, {
  query: 'dataset',
  kind: 'command',
  page: 1,
  pageSize: 25,
});
const complete = exportCommandCatalog(catalog, { source: 'ckan' });
const selected = findCatalogItem(catalog, 'command:buyer-dataset');
```

Use the package name recorded by the installed distribution when it differs
from the example. `loadCommandCatalog` also accepts an explicit
`sourceRoot`, `selection`, or an already-read `distribution`.
`buildCommandCatalog` accepts the maintained specification and optional
original feature-package metadata for applications already holding those bytes.

## Source-owned integration

The contribution is `distribution/contributions/operator-discovery.json`.
It registers the command, typed exports, browser assets and Applications
provider together. New declarations appear automatically when received in the
selected package and its Applications host is reopened.

A selected-product recipe can include `operator-discovery` in its existing
`contributions` array. The contribution supplies this complete component and
the builder follows its original imports and browser asset map. The catalog then
shows that selected product's effective registrations. Use the maintained
distribution builder, runtime installer and managed package receiving workflow
for the resulting source edition.

The implementation uses the installed Node runtime. Browser rendering uses text
nodes for original metadata and exact registered static assets.

## Complete operating procedures and returned work

The original Runtime workspace includes **Operating procedures** for editable customer steps, retained source captures, complete carried files and returned-work receiving. See [Runtime operating procedures](../runtime-workspace/RUNTIME_PROCEDURES.md) for the installed browser and `starforge runtime-workspace procedure-*` commands.

The discovery component supplies the shared typed engines through `./operator/operating-plans` and `./operator/operating-plan-returns`. [Complete files in operating procedures](./OPERATING_PLAN_FILES.md) explains original bytes, saved file editions, limits and downloads. [Review returned operating procedures](./OPERATING_PLAN_RETURNS.md) explains complete history comparison, carried-result grouping, decisions, replay and the Runtime receiving workflow. Existing Command finder search and product requirements remain available through their original routes above.
