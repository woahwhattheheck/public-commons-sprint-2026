# PostgreSQL merchant workspace

Choose an accessible table or view, select its public result columns, define request filters and payment terms, and export a runnable **original SF30 seller** package. The browser workspace uses the maintained PostgreSQL adapter and seller; the exported files run with `postgres/start.mjs`.

## Start with your existing connection policy

Use Node 22.16 or later. From the `sf30-seller-sdk` directory, install the original PostgreSQL adapter's pinned production dependency once:

```sh
npm ci --prefix postgres --omit=dev --ignore-scripts --no-audit --no-fund
node postgres/workspace/server.mjs \
  --source /private/existing-source.json \
  --output /private/merchant-packages
```

Open the printed `http://127.0.0.1:8428` address. `--port` selects a different local port. The source file is the canonical `stellar-forge.postgres-source.v1` declaration, using either its existing environment-held URI or supported explicit connection profile. The workspace resolves credentials and TLS through `config.mjs`; it does not accept database passwords, connection URIs or SQL in the browser.

For a first source, the adapter's `create-example.mjs --directory NEW_DIRECTORY` creates a canonical starter. Configure its connection environment and TLS settings, then pass its `source.json` to this workspace. The starter query does not need to match your database for workspace discovery: metadata discovery does not run source queries or perform query preflight. See the [original adapter guide](../README.md) for connection, certificate, database-role and facilitator setup.

## Build and run the merchant API

1. Select a schema, then an accessible table, partitioned table, view or materialized view. Discovery uses the role's schema and table privileges. It shows up to 500 relations and 256 columns per relation; use the schema selector to narrow large catalogs.
2. Select 1–64 public result columns. Select 1–4 scalar columns for ordering; include a unique key when stable ordering matters. Columns remain unselected until you explicitly include them. Unusual database identifiers are safely quoted and receive ordinary API aliases where needed.
3. Add optional equality, range or text-prefix filters. Each becomes a typed positional parameter in fixed SQL. Integer filters preserve exact signed 64-bit values; decimal filters use text cast by PostgreSQL. Dates, times and UUIDs carry their PostgreSQL string format. Missing filters bind null and leave that restriction unrestricted. Booleans accept `true` or `false`. The UI does not concatenate caller values into SQL.
4. Enter the route name, path, description, public HTTPS origin if applicable, exact atomic-unit price, asset identifier, and receiving account. These are the existing seller's terms. Parameter documentation contains format examples, never sampled database rows.
5. Review the fixed query, canonical source declaration, and original seller declaration. The actual original query and seller compilers must accept them. Export writes a fresh directory with `source.json`, `service.json`, `query.sql` and `START.md`. A selected custom CA is copied as `ca.pem`, so a relative certificate path keeps working in the new directory. The browser shows the exact launch command for that export.
6. Run the command with the same credential environment. The original seller exposes its developer explorer at `/_seller/docs`, OpenAPI at `/_seller/openapi.json`, and original operations console on port 8424. Add the original launcher's facilitator option when enabling its native payment runtime; without it, the original service returns HTTP 402 challenges.

Exports have private directory/file permissions (0700/0600). Each export uses a new name; it never replaces a previous merchant package. The source connection configuration is captured at workspace startup; restart the workspace to change it. A preview must match the current choices, and metadata is read again before export: schema changes require a new source selection and review.

This produces one capped ordered GET query, with at most 1,000 rows and the configured query timeout, using the original adapter's byte and concurrency limits. It does not scan the database for example records, replicate tables, infer prices, install schema objects, or start a seller as a side effect of export. Use approved database views and normal role/row policies for access restrictions. Request filters are public query inputs, not customer authentication or row authorization. PostgreSQL results preserve the original adapter's text/null and type-OID contract.

## Retain, operate and roll back the merchant

Initialize an SF82 release store once, then add `--release-store /private/merchant-releases` when opening this workspace. Enter the intended public HTTPS origin before exporting the package. The **Release handoff** section shows all saved exports with paged file identities, their retained release receipts and the exact named-query contract. Select a saved export, choose the release ID and launch settings, then stage it. The original release adapter pins the reviewed input-manifest SHA before committing that immutable ID.

**Open Seller releases** opens the original operator console for this store. Compare query, source and exact payment changes; select at the current generation; start or restart explicitly; inspect the original Operations and availability controls; and open the actual developer explorer and customer SDK downloads. This workspace owns the console and seller it starts, and closes them on shutdown. An independently launched `release-cli.mjs console` can reopen the same retained store.

A lost stage reply can recover the same release ID and exact source/runtime choices, including after the authoring package moves. Keep the workspace output directory to reopen its saved-export receipts, and keep the complete release store for immutable configurations, selection history and per-release availability. Database contents remain live; rollback restores configuration against the current database.

Use the [complete PostgreSQL release guide](../../../sf82-seller-pilot/POSTGRES_RELEASES.md) for initialization commands, direct CLI staging, MCP source aliases, customer delivery, upgrades and recovery. Existing direct `postgres/start.mjs` exports still work without a release store.

## Integration surfaces

| File | Purpose |
| --- | --- |
| `catalog.mjs` | Fixed, parameterized metadata reads inside short read-only transactions, with connection/time limits and close cleanup. |
| `plan.mjs` | Explicit operator choices to a schema-qualified query, output aliases, typed inputs, and original seller terms. |
| `package.mjs` | Canonical compiler validation, credential-free source policy capture, certificate preservation, and private create-only export. |
| `server.mjs` | Loopback HTTP server and CLI, exact Host/Origin checks, session CSRF token, preview/export and retained-release lifecycle. |
| `release-handoff.mjs` | Saved-export receipts, original hash-pinned staging/recovery and owned release-console handoff. |
| `public/` | Dependency-free, neutral industrial operator interface. |

`main(['--source', sourceFile, '--output', directory, '--port', '0'])` returns `{url, server, close}` for embedding. Lower-level callers may provide a catalog and a `workspaceProfile` built from the original `readPostgresSourceFile` / `resolvePostgresConnection` pair to `startMerchantWorkspace`; its optional `releaseStore` points to an existing SF82 store. Those are operator-process APIs, not browser configuration endpoints.

## Focused integration exercise

For development only, install the original adapter's existing development dependencies (`npm ci --prefix postgres --ignore-scripts --no-audit --no-fund`) and run:

```sh
node postgres/workspace/exercise.mjs
```

This one workflow uses the existing disposable PostgreSQL WASM fixture over actual PostgreSQL TCP, then discovers its real catalog through the workspace HTTP API, exports files, opens those files with the original source, queries exact numeric/Unicode values through generated parameters, and launches the original seller for its unsigned 402/documentation path. It also exercises schema drift rejection and private repeated exports in that same flow. It performs no payment operation and launches no GitHub Actions job. It is an application integration exercise, not a PostgreSQL load benchmark or a payment settlement simulation.

If Playwright and Chromium are already installed, set `SF30_WORKSPACE_CHROMIUM` to the existing browser executable to drive the same export through the real UI, including a 390px layout check. `SF30_WORKSPACE_SCREENSHOT` optionally names a local screenshot path. The exercise does not download a browser or install another dependency tree.
