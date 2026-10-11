# MySQL merchant browser workspace

Build a merchant API from the actual tables and columns of an existing MySQL or MariaDB database. The workspace combines explicit field selection, ordered queries, exact typed filters, native payment terms, private release preparation, the original running seller and operations controls, and a complete customer client export.

It uses the original [MySQL source](../README.md), `information_schema` catalog, query compiler, exact-decimal/scalar admission, merchant-plan compiler, private package preparer, SF30 seller, availability controller and customer exporter. The browser supplies approved choices to these components.

## Launch

Use Node 22.16 or later and the original MySQL component's pinned `mysql2` dependency. The Linux host supplies `flock` for the original availability and release leases, and `tar` for customer archive export. From the repository root:

```bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/mysql/cli.mjs workspace \
  --source /private/merchant-draft/source.json \
  --state /private/mysql-workspace
```

Create the source profile with the original `mysql/cli.mjs init` command when starting a new merchant. Set its connection, database reader and TLS settings, and provide its `passwordEnv` through the host's existing secret injection. The profile remains a valid original `stellar-forge.mysql-source.v1` declaration; its existing named queries provide the initial private source contract. The browser builds a new, explicitly approved query set for each release.

Open the complete URL printed by the launcher. The workspace binds to `127.0.0.1` on port 8439 by default. Its random capability is delivered in the URL fragment, retained in the browser tab's session storage, and required for every private API request. Connection credentials and executable source paths are selected by the host launcher. The browser displays the configured database identity and supports endpoint choices.

| Launcher option | Behavior |
| --- | --- |
| `--source ABSOLUTE_FILE` | Original private MySQL source declaration. Required. |
| `--state ABSOLUTE_DIRECTORY` | Private workspace and prepared-release directory. Required. Existing state reopens. |
| `--port PORT` | Workspace port, default 8439. Zero chooses a free port. |
| `--seller-port PORT` | Original seller port when starting a release, default zero. |
| `--operations-port PORT` | Original operations port, default zero. |
| `--facilitator HTTPS_URL` | Original native x402 facilitator selected by the operator. |
| `--allow-local-facilitator` | Allow the explicitly supplied HTTP facilitator on `127.0.0.1`. |

The native facilitator construction is shared with the original MySQL CLI through `createMysqlNativeFactory`. Install the native seller dependencies described in the [SF30 guide](../../README.md) when using that mode. Keep the launching terminal available for the configured native operator flow.

Without a facilitator, the original seller runs in `CHALLENGE_ONLY` mode and serves its configured payment challenges. The original resource server returns those challenges before application admission. In native payment mode, the original source admission runs before verification and settlement. The browser's explicit private example preview executes the original read query directly as a merchant operation.

## Build a complete release

1. **Choose an actual table or view.** The catalog reads the configured database's `information_schema` and reports the native server version, columns, keys, nullability, collation and decimal precision. Select the fields that should become public output. Source column names that need ordinary API aliases receive deterministic, collision-safe names; the review shows the mapping.
2. **Configure an endpoint.** Set its ID, GET or POST method, fixed path, service name, description, row/byte limit and deadline. Choose one to four scalar ordering columns and their direction. Including a unique key makes the order stable for the selected query.
3. **Add typed filters.** Select an actual field, comparison, public parameter name, description and example. Optional filters use the original nullable/default-null contract. Omission leaves that condition unrestricted. Required filters have an explicit example. Values remain bound parameters throughout the native query.
4. **Add the endpoint to the release.** Repeat for up to 64 endpoints. Edit and save an existing endpoint to refresh its actual table schema and adopt current choices. The release list shows each route, table, field count and filter count.
5. **Set release and payment terms.** Choose a new release ID, label and canonical public HTTPS origin. Enter the exact atomic amount, native asset, recipient, network and timeout for each accepted payment option. The workspace applies these options to every route in the release. Additional native payment metadata can be supplied as JSON.
6. **Review the native contract.** The server refreshes the actual schema, compiles the fixed SQL through the original MySQL declaration, and runs the original public offer and parameter compiler. Inspect the SQL, field mapping, typed parameter declarations, examples, limits, complete merchant plan and public contract. An explicit preview executes the reviewed example against the actual database.
7. **Prepare the private release.** Confirm the reviewed choices. Preparation refreshes the profile and schema again, builds the original private merchant package and customer client, verifies it, then publishes the complete release directory. The same successful review reopens its existing release on a repeated preparation request.

The catalog returns the original first 1,000 tables or columns with its truncation flag. A truncated column catalog cannot be used for endpoint authoring. Releases are listed in pages of 50.

## Exact filter and result behavior

| Actual database field | Generated parameter and comparison |
| --- | --- |
| Signed integers and smaller unsigned integers | Original bounded integer text, explicitly cast as `SIGNED`. |
| Unsigned `BIGINT` | Original exact decimal text, scale zero, at most 20 integer digits, bounds 0 through 18446744073709551615, cast as `DECIMAL(20,0)`. |
| `DECIMAL(p,s)` / `NUMERIC` | Exact decimal text with the actual precision, scale and signed/unsigned range; explicit `DECIMAL(p,s)` cast. |
| `FLOAT` / `DOUBLE` / `REAL` | Original finite-number input and approximate floating-point comparison. |
| Character, text, enum and set fields | Original bounded string input using the field's actual character set and collation. Literal-prefix comparison treats wildcard characters as ordinary text. |
| Date, time, datetime and timestamp fields | Bounded strings compared with the database's UTC text representation and binary collation. The input contract is text rather than a separate date parser. |
| Binary, bit, JSON and spatial fields | Available for explicit projection through the original source's result handling. |

Decimal precision is admitted by the maintained shared exact-decimal binder. Its optional `maxScale` and `maxIntegerDigits` constraints preserve the behavior of existing declarations that omit them. Trailing fractional zeros do not consume significant scale; zero uses no significant integer digits. This supports `DECIMAL(p,p)` fields while rejecting values that would require integer capacity or rounding. Exact minimum, maximum, enum and default validation continues through the original compiler and binder.

For example, a `DECIMAL(38,6)` filter keeps `900719925474099312345.123456` as text and rejects `900719925474099312345.1234561` before native payment. A `DECIMAL(4,4)` filter accepts `0.1234000` as the exact value `0.1234` and rejects `1` for exceeding its integer capacity. An unsigned BIGINT cursor can reach the database's full 64-bit unsigned range without a JavaScript-number conversion.

Generated SQL uses one placeholder for each declared parameter in an explicitly typed derived input row. Optional-null checks and comparisons reference that row, so the original unique `parameterOrder` and placeholder contract remain intact. Identifiers come from the actual catalog and use the original MySQL identifier quoting. The server accepts schema choices and predefined operators rather than arbitrary browser SQL.

Each successful result is the original `stellar-forge.mysql-result.v1` envelope. Numeric scalars, exact decimal/integer values and date/time values retain their original strings; binary values use `{ "base64": "..." }`; SQL null becomes JSON null. The preview paginates the returned rows in groups of 50. Native row, byte and deadline limits still determine what the source returns.

These are live, capped queries. Each request has its own read-only repeatable-read transaction. A later cursor request observes its own database snapshot. Use views to express database-owned row policy and suitable indexes for the selected order and filters.

## Reopen, run and operate

Choose **Saved releases**, open a release, and inspect its original verified files and route list. **Start merchant** launches the original MySQL seller and operations console. The runtime panel provides API docs, OpenAPI, operations, availability and the original capability-bearing pause/resume control. Each release has its own persisted availability policy in the private state directory.

The workspace operates one merchant at a time. The start request is bound to the selected original manifest. Stop is bound to that specific runtime ID. **Stop merchant** drains the original seller and closes its database source; the release and availability history remain available for restart. A new workspace process reopens saved releases for an explicit start.

The underlying native package can run independently:

```bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/mysql/cli.mjs run \
  --directory /private/mysql-workspace/releases/catalog_v1/package \
  --port 8423 --operations-port 8424 \
  --availability-dir /private/mysql-workspace/availability/catalog_v1 \
  --facilitator https://facilitator.example
```

Keep the original password environment available in the destination process. The prepared package includes a copied, relatively referenced CA when the profile uses one. The original `verify` command validates a relocated native package. Its explicit SQL continues to be parsed and prepared by the actual database at startup.

The release retains the exact schema and source profile reviewed at preparation. Database changes after that point follow the original live source's execution and preflight behavior. Build a fresh release when changing the approved data or payment contract. **Use as a new draft** loads the saved endpoint and payment choices with a new release ID; review and prepare publish the new version separately.

## Customer delivery

**Download customer client** verifies the original prepared package and exports exactly:

```text
openapi.json
client/seller-client.mjs
client/seller-client.d.mts
client/seller-openapi.json
client/package.json
client/README.md
```

The gzip-compressed tar archive is limited to these original public customer artifacts. Its download uses a one-use ticket that expires after 60 seconds. The browser displays the archive size and SHA-256 digest. The private merchant package remains available at the path displayed in the selected release.

Extract the archive into the customer's integration workspace and follow the generated guide. The module's operation IDs are the reviewed endpoint IDs. For the original SF88 Node Buyer, use `createSellerClient({ buyer })` and supply the actual input shape, intent ID, selected payment option and approved atomic cap. The [MySQL guide](../README.md#use-the-generated-customer-client) contains the original Node Buyer example.

## Private state and lifecycle

The workspace owns private `0700` directories and `0600` files beneath the selected state root. A release contains `workspace.json` beside the unmodified original `package/` layout. The release metadata binds the reviewed choices to the original package's manifest. The original preparer owns source, seller, plan, OpenAPI, client, CA and manifest bytes.

Preparation uses a private temporary directory, a retained-descriptor kernel lease in a separate `locks/` directory, original verification and directory synchronization before atomically renaming the complete release into place. Existing release IDs retain their original contents. Multiple workspace processes use the same per-release lease. A process exit releases the lease and can leave a private temporary stage; it cannot leave an empty final reservation that consumes the release ID. The model serializes operations, keeps at most eight 15-minute reviews, checks source/CA bytes and metadata at review/preview/preparation, and verifies the selected package before open/start/export.

The HTTP listener enforces the exact local Host and Origin, a private capability, a bounded JSON body and a restrictive content policy. Runtime status polling reads the existing session state. Shutdown closes the workspace listener, drains original model/native operations, closes incomplete request sockets and allows an already authorized customer download a 15-second grace period.

## Native journey

The complete browser journey ran against MariaDB 10.11.14 and the original pinned `mysql2` 3.24.5 in the Linux container. It authored two endpoints from actual metadata, preserved a maximum unsigned BIGINT, an exact high-precision price, Unicode, microsecond timestamps and binary bytes, handled an output-alias collision, rejected precision loss and live schema drift, prepared and reopened the original private package, constructed a request with its generated customer client, operated the original availability controls, downloaded and compared all six customer files, and reopened the same release and availability revision after restart. Desktop and 390-pixel layouts completed without browser errors or horizontal page overflow; incomplete-body/header shutdown completed cleanly.

The original native seller and source remain responsible for payment, database execution and lifecycle. Programmatic callers can compose `createMysqlWorkspace` from `model.mjs` and `startMysqlMerchantWorkspace` from `server.mjs` with trusted host options.
