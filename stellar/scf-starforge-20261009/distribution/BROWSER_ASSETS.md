# Browser assets in the source distribution

Some workspaces serve a shared module under a local browser URL. The MongoDB
workspace serves the original PostgreSQL publisher schedule controls at
`/publisher-schedules.mjs`; the PostgreSQL workspace serves the original release controls
at `/postgres.mjs`. These URLs need not name physical files beside the browser
importer.

Each registered workspace keeps one `browser-assets.json` beside its original
server. The server loads it through `readBrowserAssets`, and the existing
distribution builder reads the same bytes from its immutable Git selection.
The manifest records a relative asset root and exact URL, source file and
content-type entries:

```json
{
  "schema": "stellar-forge.browser-assets.v1",
  "root": "./public/",
  "routes": [
    ["/app.mjs", ["app.mjs", "text/javascript; charset=utf-8"]],
    ["/postgres.mjs", ["../../../../sf82-seller-pilot/release-ui/postgres.mjs", "text/javascript; charset=utf-8"]]
  ]
}
```

The example shows two entries from the PostgreSQL contract; its maintained
manifest also contains the existing HTML and CSS routes. URLs and response
content types remain the server's existing public contract.

## Maintain a workspace

1. Add or change the exact route in that workspace's manifest.
2. Keep the server on the shared `readBrowserAssets` loader. It receives a map
   from each route to `{ url, type }`; the original handler still controls methods,
   authentication, caching, CSP and response streaming.
3. Register its server and manifest paths under `browserAssets` in
   `distribution.json` or its maintained contribution. Select the server through
   the product component, an explicit source entry or an actual dependency.
   The builder then receives that exact server's manifest and complete mapped
   assets, even when the declaration's other capabilities are not selected.
4. Keep every relative or root-relative static browser import reachable through
   that server's route map. An unserved import fails during source selection,
   even when a similarly named physical file exists.
5. Build the chosen immutable commit with the existing `build.mjs` command and
   install it with the existing runtime installer.

The collector includes each mapped asset and follows its actual static ESM
requests in every registered served-URL context. A missing neighboring physical
file can resolve through that exact browser context. This is not a global
missing-path substitution: an unrelated Node module receives ordinary
filesystem resolution and the existing missing-dependency error. A module reached through a native entrypoint or native import retains its
filesystem dependencies, including when those same bytes are also served in a
browser. Merely finding an adjacent physical file does not add a native edge to
a browser-only module. Existing forwarding modules remain compatible.

Mapped paths must stay inside the Git repository. Regular-file, component
exclusion, extension, per-file size and cumulative size restrictions continue
to apply. Each server, JSON contract, helper and original shared asset appears
as its own unchanged-byte file in the existing distribution manifest, with its
Git blob, SHA-256, size and mode. There is no source rewriting, generated
forwarder, extra archive format, install hook or timestamp-dependent output.

## Selected products and dependency declarations

A product can select a complete component containing several maintained HTTP
workspaces without enabling every command or provider belonging to that
component. Browser registrations are therefore also source dependencies.
The builder indexes explicit `browserAssets` declarations from the pinned base
and contribution files, and activates a declaration only when its original
server belongs to the selected or transitively reached source graph.

Borrowing a registration includes its complete original declaration file,
manifest and mapped assets. It does not compose the donor's commands, exports,
components, providers, native peers or runtime dependency groups. The
distribution's selected contribution list keeps its original meaning. The
package manifest's `browserAssetDeclarations` array separately records each
used declaration's path, Git blob, SHA-256, byte count and exact server/manifest
pairs. Its complete source bytes are also ordinary members of `manifest.files`.

For example, the public `merchant-receivables` selection includes the
distribution component. Its declared discovery workspace is collected when
that original server is selected, while the unselected `operator-discovery`
contribution's commands and providers remain disabled. A conflicting declaration for an unrelated, unselected
server does not affect this product. Conflicting declarations for a reached
server are a source error and must be corrected at that original declaration.

## Installed declaration admission

The installed specification reader keeps two distinct inventories.
`distributionInputs` contains the selected base, contribution and recipe
documents that define enabled product capabilities. `browserAssetDeclarations`
contains the original declaration documents used by reached browser servers,
including a donor contribution outside the recipe. A donor may also already be
a selected input; that does not duplicate or expand its enabled registrations.

On reopening an installed source package, the reader verifies every recorded
browser declaration against its complete original bytes, SHA-256, Git blob,
byte count and ordinary `source/` member identity. It reconstructs the exact
server/manifest pairs from those original documents using the same declaration
reader as the builder. Each referenced server and manifest must be present in
the retained source inventory. Missing, altered, duplicate or invented donor
evidence is rejected, as is any extra contribution that has no authenticated
browser dependency. Unrelated registrations in a retained donor remain
unselected.

For example, `merchant-receivables` retains the complete distribution
component, including the discovery server. The original `operator-discovery`
declaration supplies that server's route manifest even though its capabilities
are outside the recipe. The installed package authenticates that complete
donor document while its composed commands, providers and
`distributionInputs` still follow the original receivables recipe.

Earlier archives without the browser-dependency field retain their original
selected-only admission rule. A repaired source edition uses a new immutable
build output and the existing customer's explicit source-adoption workflow;
it does not change a retained build's commit, recipe, manifest or operation.
This admission check performs no application execution.

## Shared modules and complete dependency errors

One physical module may be served at several URLs in one server, or by several
servers. Each `./relative.mjs` request is resolved separately in every active
server/URL context. All resulting original targets must be present. A later
discovered server can add a context to an already parsed module, so parsing a
file once is not a reason to stop following its new browser requests.

The collector recalculates discoveries from the immutable initial selection
until both the reached source files and their active server contexts settle.
This removes a provisional filesystem dependency when a later declaration
establishes that its importer is browser-only. Original component selections
are never removed. A native path actually reached from a native entrypoint
remains a native dependency. A source/context cycle that cannot settle fails
with `DISTRIBUTION_SOURCE_CONTEXT_CYCLE`; the original entrypoint or declaration
must resolve that ambiguity.

The settled graph reports its missing source paths, unserved static requests
and invalid module syntax together under
`DISTRIBUTION_SOURCE_CLOSURE_INCOMPLETE`. These errors name original importers
and serving contexts. Fix the original server contract or source selection;
do not add generated forwarding files or erase an import to make packaging
pass. Syntax belonging solely to a discarded provisional discovery is not a
failure in the final selected package.

## Build and continue the original operation

Use the existing immutable build command with the intended selection:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --ref FULL_COMMIT \
  --selection merchant-receivables --out /absolute/new-package
```

For an interrupted output, inspect and continue that same retained selection:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs --out /absolute/package --status
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --ref ORIGINAL_FULL_COMMIT \
  --selection merchant-receivables --out /absolute/package --resume
```

Resume retains the original source commit and selection. A repaired source
commit needs its own package output; it must not replace the input of an
already retained customer operation. The customer operation's existing owner
reconciles its checkpoint and adopts the resulting package through its
maintained receiving path.

A successful source build verifies packaging closure. Installed native use and
actual rendered browser use remain separate observations. Before describing a
customer interface as ready, open the installed browser output and inspect its
important controls and populated, empty, loading, error, download and reopened
states at desktop and narrow sizes. Source parsing or HTTP responses alone do
not establish those rendered outcomes.

## Retained source inspection

`inspectDistributionSourceImports` remains the read-only public source inspection API. It uses the same original parser and serving index. An adjacent selected file does not create a native execution context for a browser-only import. Explicit `nodeEntrypoints` retain their complete physical import chains, including modules also served in a browser. Invalid syntax in any inspected source is reported as `DISTRIBUTION_SOURCE_IMPORTS_INVALID`; inspection never suppresses a syntax failure as a provisional build discovery.
