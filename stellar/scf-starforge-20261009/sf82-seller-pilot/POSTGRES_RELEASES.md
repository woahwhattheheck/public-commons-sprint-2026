# PostgreSQL merchant releases

The PostgreSQL merchant workspace now hands its saved package to the same retained SF82 release store used by the seller console and merchant MCP. Operators can discover an accessible table or view, choose public columns and fixed filters, review the exact payment terms, retain the package, compare it with an earlier release, select and start it, publish its offers, deliver the original customer SDK, and reopen or roll back the merchant.

The release contains the query and seller configuration. **PostgreSQL contents remain live.** An earlier release reads the current database through its retained named queries; rollback does not restore database rows or a database transaction snapshot.

## Create and retain a package

Use the existing PostgreSQL source declaration, credential environment, original production dependencies, and approved database role. The browser does not accept a connection URI, password, or SQL editor. The [original workspace guide](../sf30-seller-sdk/postgres/workspace/README.md) covers metadata discovery and its exact column/filter rules.

From this `sf82-seller-pilot` directory, initialize a new store once:

```sh
node release-cli.mjs init --store /private/postgres-releases
```

From the sibling `sf30-seller-sdk` directory, open the original workspace with that store:

```sh
node postgres/workspace/server.mjs \
  --source /private/existing-postgres-source.json \
  --output /private/postgres-packages \
  --release-store /private/postgres-releases \
  --port 0
```

Choose a source visible to the actual database role, 1–64 public columns, an ordering, optional typed filters, and the route and payment terms. Enter the intended **public HTTPS origin** before exporting. Local onboarding packages can still omit that field, but they must be re-exported with an explicit public origin before being retained. Staging never substitutes a public URL for a local one.

Review and export the original files: `source.json`, `service.json`, `query.sql`, `START.md`, and the selected `ca.pem` when applicable. The native prepare command's source/service/bindings package is also accepted. Exporting or staging starts no seller and makes no payment.

The workspace's **Release handoff** section provides:

- Paged saved exports with their plan identity, immutable file SHA-256 values, public origin, and retained release receipts.
- A complete public query contract: parameter order and types, exact constraints, default presence without private default values, projected columns, row/byte/deadline limits, and exact atomic payment terms.
- Explicit release ID, label, seller port, and optional facilitator settings.
- Staging of the selected export ID. Browser requests do not choose a database connection, executable, or arbitrary replacement package path.
- An action to open the original **Seller releases** console for the same store.

The saved-file receipt is checked before a new capture. The original release adapter checks the reviewed input manifest again before committing a release ID. If an interrupted reply left that same ID committed, recovery verifies the retained source identity, label, and runtime choices and returns the existing release. It does not need the authoring package to remain at its old location.

The workspace retains its export and handoff receipts beneath the configured output directory. Preserve that directory alongside the release store when moving this authoring workspace. Reopening with the same output root and `--release-store` shows those receipts again. Package files themselves remain unchanged.

## Use a prepared package directly

From `sf82-seller-pilot`:

```sh
node release-cli.mjs stage \
  --store /private/postgres-releases \
  --id postgres-v1 \
  --label 'Approved catalog query' \
  --postgres-package /private/postgres-packages/catalog-export \
  --port 8423

node release-cli.mjs console --store /private/postgres-releases --port 0
```

The console also has **Stage a PostgreSQL merchant package**. Enter the prepared directory, review it, then stage its exact input-manifest identity. A lost response offers **Recover same stage** with the unchanged request. An existing ID with different source or launch choices produces a conflict; it is never overwritten.

Without a facilitator the retained seller serves original payment challenges. Add the operator's existing credential-free HTTPS facilitator URL when configuring its native payment runtime. Loopback HTTP requires the explicit local-facilitator option. Keep the original database credential environment available to the process that starts the seller.

## Compare, select, and operate

Choose a candidate in **Prepared releases**. The console compares exact route, receiver, asset, network, atomic amount, request-contract and application identities. Its PostgreSQL section compares named queries and the source, binding, connection-policy, CA and execution hashes. Private SQL, connection address/database/user fields, credential values, and private parameter defaults are absent from these public records. Changes to those private settings still alter the appropriate retained identities.

Selection uses the original current generation. A running seller continues on its own release until an explicit stop/restart. **Restart selected** checks the current selection and the console-owned instance before closing that instance and starting the selected release. Another process's seller remains controlled by its original manager.

The original PostgreSQL launcher, source compiler and seller binder perform startup. The console links to:

- **Merchant operations**, including the original source and request observations.
- **Product availability**, for explicit pause/resume and original in-flight request handling.
- **API explorer and customer SDK**, showing the actual running seller's OpenAPI, exact input contract, payment alternatives, JavaScript client, TypeScript declarations, and integration files.

Integer and decimal values retain the original adapter's text/null representation and PostgreSQL type-OID response contract. The client contract does not introduce floating-point conversion or turn a bounded ordered query into a full table export.

Availability is retained per release under its original private runtime directory. Pausing a release survives stopping and reopening that same release. A newly staged release has its own initial policy; selecting a prior release restores that release's retained policy. The maintained availability control requires the original Linux `flock` dependency.

The workspace owns a console it opens and any seller that console starts. Closing the workspace stops those owned processes. For an independently owned console, launch `release-cli.mjs console` in its own process and reopen the same store. The store retains releases, selections and history in both cases.

## Upgrade and roll back

Export a new package for changed columns, filters, SQL, credentials references, connection policy, CA, route or payment choices. Keep the earlier package and release. Stage a new ID, compare it, then select the intended version at the freshly read generation.

The CLI exposes the same retained lifecycle:

```sh
node release-cli.mjs inspect --store /private/postgres-releases --id postgres-v2
node release-cli.mjs diff --store /private/postgres-releases --from postgres-v1 --to postgres-v2
node release-cli.mjs status --store /private/postgres-releases
```

Use the actual `generation` returned by status for `activate --expect GENERATION` or `rollback --expect GENERATION --to postgres-v1`. Those commands change selection. A foreground `run` or the console's explicit start/restart runs it. If startup fails after stopping the earlier seller, inspect current status and the reported failure before selecting and starting the retained prior release. The public origin and current database role must still support the selected configuration.

## Merchant MCP and customer delivery

From the repository root, create a merchant configuration for an original package:

```sh
node stellar-forge/mcp-merchant-operator/serve.mjs init \
  --dir /private/postgres-merchant \
  --name 'PostgreSQL merchant' \
  --postgres-package /private/postgres-packages/catalog-export \
  --seller-port 8423
```

An existing host configuration can add a named source using:

```json
{
  "catalog_update": {
    "label": "Reviewed PostgreSQL catalog",
    "postgresPackage": "/private/postgres-packages/catalog-export",
    "runtime": { "port": 8423 }
  }
}
```

This entry belongs in `sources`; it is not a whole merchant configuration. Paths are selected by host configuration. MCP calls use the source alias.

| Operator action | Existing MCP tool |
| --- | --- |
| Read public source identities and exact offers | `merchant_sources` |
| Retain a source alias under a new release ID | `merchant_stage` |
| Verify and compare releases | `merchant_inspect`, `merchant_compare` |
| Select using exact digest and current generation | `merchant_activate`, `merchant_rollback` |
| Start, restart, stop, and inspect process ownership | `merchant_start`, `merchant_restart`, `merchant_stop`, `merchant_status` |
| Open the actual Operations and availability controls | `merchant_operations` |
| Read original running-seller metadata | `merchant_catalog` |
| Retain the original five-file customer SDK and completion receipt | `merchant_client_export` |
| Reopen a completed export after shutdown or lost response | `merchant_client_export_status`, `merchant_client_export_manifest` |
| Retrieve the SHA-pinned original files | `merchant_client_export_file` and the existing `download-client` command |
| Review and apply original catalog publication or withdrawal | `merchant_discovery_status`, `merchant_discovery_review`, `merchant_discovery_apply` |

See [customer SDK delivery](../../../stellar-forge/mcp-merchant-operator/CLIENT_EXPORTS.md) for the retained five payloads, exact completion receipt, interrupted download recovery and explicit legacy adoption. This release arm consumes that exporter without replacing its implementation. A database-read or SDK export is not a payment settlement claim.

The fleet companion selector is `postgresPackage`; retained source kind is `POSTGRES_MERCHANT_PACKAGE`. Fleet adoption uses the shared release's public `postgres` contract and original child lifecycle. Keep fleet slot/gateway/drain controls in their existing owner and controller; this package does not introduce a second fleet manager.

## Retention and privacy

The private release contains byte-exact original source/service/optional bindings, query, guide and selected CA material; its relocatable runtime source and normalized original seller service are retained separately. Public release metadata exposes their SHA-256 identities and credential **environment names**, without credential values or connection details. The release source can be inspected after the authoring package moves, and native verification checks the retained files before launch.

Back up the complete release store, the workspace output directory if it is still being used for authoring, the operator's credential provisioning, and its existing managed dependencies. A source-selection backup is not a PostgreSQL data backup. Database data retention remains with the existing database operation.
