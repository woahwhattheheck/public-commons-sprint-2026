# SQLite merchant workbench

A complete local onboarding workflow for the **existing SF30 SQLite seller**. Select database columns, author named parameterized queries, inspect actual results, set merchant terms, save the workspace and export a runnable seller package. It replaces manual coordination of source JSON, service JSON and handler exports. It does not replace the query engine, payment engine, operations dashboard or deployment tooling.

## Start

Use Node **22.16 or newer**, with the original SF30 source tree present. No npm installation or hosted service is needed for the workbench or its read-only SQLite previews.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sqlite/workbench/server.mjs \
  --database /private/merchant/catalog.sqlite \
  --workspace /private/merchant/setup \
  --port 0
```

The database must already exist. The workspace's parent must exist; the workbench creates the final workspace directory with mode 0700. An existing workspace must be private and bound to the same database. Repeating this command resumes its saved draft and completed release list.

Open the **private launch URL** printed in the terminal. The listener binds only to `127.0.0.1`. The URL fragment authorizes this local session and is removed from the address bar after bootstrap; do not forward it. The browser keeps it in session storage, not a shared account or server log. Do not expose this privileged workbench through the merchant's public reverse proxy.

## Operator journey

1. **Choose data.** Select a table/view, then explicitly select columns. Nothing is selected by default. Schema discovery uses the original read-only SQLite source and returns metadata, not dataset rows. Unusual database identifiers are quoted and output columns receive valid aliases where necessary.
2. **Define the API.** Name each query and fixed GET/POST path, review its SELECT/WITH SQL, and declare the exact output aliases. Use `$name` placeholders with typed parameter declarations. Set an atomic-unit price per route. Up to 64 queries share the merchant's explicitly entered HTTPS origin, network, asset and recipient.
3. **Preview locally.** Enter private preview parameters and run the original source. Its existing parameter binding, worker process, deadlines, row/byte limits, integer precision and result encoding apply. The preview input and rows are not saved in the workspace or exported. This is a privileged local operation, not a paid API request.
4. **Review and export.** Supply deliberately public example inputs separately. Review prepares every SQL statement and runs the existing seller's offer compiler. Save incomplete drafts as needed; export requires a valid complete configuration. Choose a new release name to create the runnable package.

The interface is neutral/grayscale and responsive. Parameter declarations and public examples use JSON editors, while schema selection, route settings, preview tables, review and export use ordinary forms.

### Parameter example

SQL:

```sql
SELECT id, title, price_cents
FROM inventory
WHERE region=$region AND id>$after_id
ORDER BY id
```

Parameter declarations:

```json
{
  "region": { "type": "string", "maxLength": 64 },
  "after_id": { "type": "integer", "minimum": "0", "default": "0" }
}
```

Public example input:

```json
{ "region": "public-example-region", "after_id": "0" }
```

All GET parameter examples must be supplied explicitly, including optional parameters: **private defaults are never automatically copied into public metadata**. POST uses the explicit public JSON body. The original source supports nullable/default/enum/bounds declarations; the original seller imposes its own query-example and header limits. Output examples contain selected column names and an empty row structure, never the actual preview.

## Run the exported service

A successful export prints the exact launch command. The package contains:

| File | Purpose |
|---|---|
| `source.json` | Original named-query declaration and database reference. |
| `service.json` | Original SF30 merchant routes, payment terms and deliberately public examples. |
| `handlers.mjs` | Exports original source handler/admission pairs. |
| `launch.mjs` | Invokes the original `serve.mjs` CLI, preserving native payment options. |
| `RUN.md` | Exact local command, relocation and operational notes. |
| `manifest.json` | Digests of the package files and its saved draft revision. |

```sh
node /private/merchant/setup/exports/pilot-1/launch.mjs --port 0
```

Without `--facilitator`, the **original seller** starts in `CHALLENGE_ONLY`: unpaid requests receive its payment-required offer, not database rows. Native payment operation uses the original seller's documented facilitator/SDK configuration and an operator-managed public HTTPS deployment. The workbench never signs, funds a wallet, makes a payment, deploys a service or authenticates ownership of the supplied payment addresses.

To relocate a package, keep the original SDK tree available and provide local overrides:

```sh
SF30_SQLITE_SDK=/opt/stellar/stellar/scf-starforge-20261009/sf30-seller-sdk \
SF30_SQLITE_DATABASE=/private/data/catalog.sqlite \
node /private/releases/pilot-1/launch.mjs --port 8423
```

The database is **not copied**. Exported SQL, source paths and the source configuration are private operator material. Public service/offer metadata is intentionally public when the seller runs. Review query filters/projections accordingly. A new release never overwrites a prior release or changes an already running seller. SF82/deployment owners retain their existing activation/restart workflow.

## Persistence and operating limits

Draft writes use revision checks, a short cross-process filesystem lock, a synced temporary file and atomic replacement. Two stale browser tabs cannot silently overwrite one another. Reload after a conflict. After an actual writer crash, first confirm that process is stopped before removing its `write.lock`; the lock contains its process ID. Do not remove a live writer's lock.

Workspaces/directories use mode 0700 and files 0600 on POSIX systems. Existing linked/nonprivate workspace files are rejected. API requests require the session token, exact Host and same Origin when present; no cross-origin API access or external assets are enabled. Request bodies are limited to 1 MiB. These are local access boundaries, not a sandbox against another process running as the same operating-system user. Windows ACLs remain the operator's responsibility.

SQL is operator-trusted configuration, not an arbitrary tenant SQL endpoint. Inspect query plans and indexes for real production datasets. The source's result/deadline limits do not impose a total OS memory quota. Each query reads the current SQLite snapshot; separate paid requests do not share an immutable snapshot. Stable multi-page data requires the existing immutable dataset workflow or a merchant-managed snapshot.

## Focused native acceptance

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sqlite/workbench/acceptance.mjs
```

One actual Node/SQLite/HTTP lifecycle exercises schema selection, private preview, GET/POST offer compilation, stale-save rejection, create-only export, original generated handler execution, restart recovery, unchanged database bytes and an exact `9007199254740993` integer. It checks that private preview rows are absent from every exported file. No payment simulation, extra framework or hosted CI is involved.

The browser UI was separately exercised offline at desktop and mobile dimensions for form payload separation and overflow. That component exercise is distinct from a browser navigating a running native seller; the core native HTTP/SQLite lifecycle above is the executable acceptance path.

Commercial use: SF49 can use this existing-source workflow to configure and hand over a merchant-owned database API without bespoke handler coding. Treat the workbench as shipped pre-award SCF engineering, not unperformed future grant hours. A real merchant still supplies the authorized database, suitable query scope, public terms and normal deployment/payment configuration.
