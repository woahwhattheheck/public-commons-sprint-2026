# Record mastering workspace

Receive overlapping source lists, review identity and field decisions, and deliver a reusable master dataset. This installed product brings the original Record Mastering browser and eight merchant tools into the existing Runtime Workspace Applications lifecycle.

The original SQLite workspace remains the decision owner. Applications owns its listening process and recovery history. The setup command retains the connection files and exact reviewed application request; it does not replace either owner.

## What is included

| Surface | Purpose |
| --- | --- |
| `record-mastering` | Original create, inspect, import, invoke, browser, JSON-lines, delivery and workspace receiving commands. |
| `record-mastering-workspace` | Prepare and save an installed application, reconnect, start, recover, stop and retain exact exports. |
| Runtime Workspace → Applications | Review the selected original workspace, inspect the current command and private launch output, and operate the saved process. |
| `merchant_mastering_*` | Configured source inputs, revision-bound decisions, retained file receiving and editable-workspace handover through the original Merchant MCP host. |
| `master.csv` and delivery companions | Exact selected text, stable master IDs, source field provenance, conflicts and the original CSV dataset configuration. |
| Private workspace packet | Complete original sources, decisions, retained operations, editions and deliveries for independent receiving. |

Use Node 22.16 or newer with `node:sqlite`. The installed Applications host also requires the original Linux, Python and `flock` runtime declared by its profile. The standalone mastering command needs no npm dependencies. Selecting Merchant MCP adds the maintained source-selected SDK dependencies.

The three CSV files in the original `record-mastering/example/` directory are complete fictional source inputs for the worked initializer. The source selection omits the optional prebuilt example delivery; the original delivery command creates a new package from the selected workspace. A separately supplied customer workspace archive remains an explicit customer input with its own identity.

## Build and receive the selected release

Use an immutable repository commit containing this product. From a maintained source checkout, the original builder creates the source archive, complete manifest and customer package:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-checkout \
  --ref FULL_COMMIT_SHA \
  --selection record-mastering-workspace \
  --out /absolute/new-record-mastering-release
```

Keep the returned archive path and SHA-256. To resume that same incomplete build, use the same output directory and `--resume`; the builder retains the original source commit and selection. Its `--status` mode reads the saved build state.

Prepare a private installation with the original installer:

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /absolute/record-mastering-runtime \
  --archive /absolute/release/ORIGINAL_ARCHIVE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --operator --feature mcp

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /absolute/record-mastering-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /absolute/record-mastering-runtime --load --source
```

The normal installer selects the versions declared by that exact release. A complete retained dependency tree and its matching original lock can use the maintained `install --adopt-existing` path. Use `--offline --cache /absolute/cache` only with the required retained package bytes. A copied folder alone is not an accepted installation: use the installer's resulting READY state.

All commands below run through the selected installation. The following prefix means the original source installer CLI followed by `run --dir /absolute/record-mastering-runtime --`:

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /absolute/record-mastering-runtime -- record-mastering help
```

The native mastering CLI also accepts `help` without the option prefix. Keep any printed browser session URLs private.

## Select the original workspace

An existing saved workspace can be attached directly. To receive a transferred private packet into a new directory:

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /absolute/record-mastering-runtime -- \
  record-mastering receive \
  --file /absolute/customer.mastering.gz \
  --sha256 CUSTOMER_PACKET_SHA256 \
  --workspace /absolute/received-customer
```

The original receiver verifies the complete packet, SQLite state and retained file references. It preserves the workspace ID and history, and creates a new destination rather than overwriting an unrelated workspace.

For new work, create an empty workspace through the original command:

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /absolute/record-mastering-runtime -- \
  record-mastering create --workspace /absolute/customer-workspace --title "Customer records"
```

The worked fictional initializer is available directly at `source/stellar/scf-starforge-20261009/sf30-seller-sdk/record-mastering/launch-example.mjs` inside the installed package. It reopens an existing directory and creates source decisions only when explicitly creating a new example.

## Prepare the Applications and merchant setup

Create the original Runtime Workspace once, or use the existing coordinator that already owns this installation:

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /absolute/record-mastering-runtime -- \
  runtime-workspace init --workspace /absolute/operator-workspace
```

Write a private request JSON using canonical absolute paths:

```json
{
  "schema": "stellar-forge.record-mastering-product-request.v1",
  "runtimeDirectory": "/absolute/record-mastering-runtime",
  "runtimeWorkspaceDirectory": "/absolute/operator-workspace",
  "workspaceDirectory": "/absolute/customer-workspace",
  "label": "Customer records",
  "alias": "customers",
  "port": 0,
  "inputs": {
    "crm": {
      "path": "/absolute/input/crm.csv",
      "sha256": "THE_EXACT_64_CHARACTER_SHA256_OF_THIS_INPUT"
    },
    "billing": {
      "path": "/absolute/input/billing.csv"
    }
  }
}
```

`sha256` is optional on an input; preparation always captures the actual whole-file digest. Replace the illustrative digest with a real value or omit that member. Merchant tools select these aliases, and the original provider rechecks the retained file identity before importing. New inputs need a new reviewed setup.

`port: 0` asks the original application to choose an available local port. An optional `environmentFile` is an absolute private file retained by Applications. To intentionally revise an existing saved application, supply both its `applicationId` and observed `expectedRevision`; otherwise preparation creates a new application review. Later saved changes are never overwritten silently.

Prepare into a new private setup directory:

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /absolute/record-mastering-runtime -- \
  record-mastering-workspace prepare \
  --directory /absolute/customer-setup \
  --request /absolute/customer-request.json
```

Preparation retains the full original request before attaching or reviewing. It binds the exact selected installation, coordinator workspace, mastering workspace identity and configured input bytes. Review the returned original Applications request and file identities. The saved directory contains:

| File or directory | Retained purpose |
| --- | --- |
| `product.json` | Original preparation identity, selected native owners, review, save result and latest concrete error. |
| `request.json` and `source.json` | Normalized request and complete original request-file text, path, bytes and digest. |
| `record-mastering.json` | Original named-workspace merchant connection. |
| `merchant.json` | Original Merchant host configuration selecting that connection. |
| `starts/` | Original reviewed start request and its retained response. |
| `exports/` | Original request-bound workspace and customer-delivery packets. |
| `received/` | Independently received workspaces exposed by the original merchant provider. |
| `merchant-releases/` and `merchant-exports/` | Original SF82 release state and private Merchant host exports, kept separately from customer packet exports. |

A stopped preparation resumes with `prepare --directory /absolute/customer-setup`. It uses the already-retained original request. Supplying changed source text, another request ID or a different setup request under that same directory is rejected.

Save the exact review:

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /absolute/record-mastering-runtime -- \
  record-mastering-workspace save --directory /absolute/customer-setup
```

The original Applications save request ID is retained before dispatch. Repeating this command returns the same saved result. If managed adoption was interrupted, use `connect` on this setup to resume the original adoption; inspect the resulting status rather than creating another application.

## Start and operate the saved application

Open the original operator console with `runtime-workspace serve --workspace /absolute/operator-workspace --port 0`, or operate the same saved application from the setup command.

Choose and retain one UUID for a start request:

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /absolute/record-mastering-runtime -- \
  record-mastering-workspace start \
  --directory /absolute/customer-setup \
  --request-id 0b3d2ee9-96a4-47ce-982a-9b95d30f42e2
```

The example UUID is illustrative; use a new retained UUID for your own start. The setup records the original start review before calling Applications. An identical repeat recovers that result. The original resource owner controls whether another process may open this workspace.

Read `record-mastering-workspace status --directory /absolute/customer-setup` for the saved application, native operation state and original private browser startup. The application adapter verifies the listening process's workspace ID and binding against the reviewed input. Open its private session URL.

The browser is the original mastering application. Import a source CSV, review its edition comparison, activate the explicit refresh, inspect matching groups and make merge, split or field choices. Every change retains the observed SQLite revision and original request ID. A changed source-pinned field remains visible for review. Customer datasets preserve text values, including exact decimal strings and leading zeroes.

Use `recover --operation-id ORIGINAL_OPERATION_UUID` to reconnect to an interrupted original application operation, and `stop --operation-id ORIGINAL_OPERATION_UUID` to stop that same operation. These recovery commands keep the existing coordinator and application identity even if an input file or installation later becomes unavailable. They do not create another start.

A setup status may report `superseded: true` after someone intentionally saves a later Applications revision. It still identifies its original save and may recover or stop the original operation. Starting new work from the old setup is rejected; prepare a new reviewed setup against the current application revision.

## Use the maintained Merchant MCP connection

The setup creates the original complete `stellar-forge.merchant-mcp.v1` host configuration with its name, empty source catalog, retained SF82 release store, private host export directory and `recordMasteringConnection`. It validates those actual files with the native Merchant configuration reader before completing the Applications review. Reopening preparation resumes the original release initializer and preserves its existing state and history.

The setup exposes the original `recordMasteringConnection` through `merchant.json`. The maintained Merchant host loads the source-selected lazy provider and its eight tools. Start the original stdio command with the exact private configuration:

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /absolute/record-mastering-runtime -- \
  merchant-mcp-stdio --config /absolute/customer-setup/merchant.json
```

The original host owns its private local transport and generated access token. The setup does not forward a browser session or invent a second authentication scheme. Use the maintained `merchant-mcp-client-config` command for a client-specific launch configuration.

| Tool | Original operation |
| --- | --- |
| `merchant_mastering_workspaces` | List configured and independently received workspace aliases. |
| `merchant_mastering_query` | Read full original status, sources, master records, groups, editions and saved operations. |
| `merchant_mastering_apply` | Submit an explicit original decision with its revision and stable request ID. |
| `merchant_mastering_input` | Inspect a configured original source file and its digest. |
| `merchant_mastering_import` | Retain and import that exact configured input through the original source writer. |
| `merchant_mastering_export` | Retain a request-bound complete workspace or customer delivery packet. |
| `merchant_mastering_file_read` | Receive the whole exported packet or retained large result through ordered chunks. |
| `merchant_mastering_receive` | Independently receive an explicitly configured packet into the original receiving root. |

Read a large result until `nextOffset` is null, verify its complete byte count and SHA-256, and then parse or receive it. A single returned page is not a full delivery. Reopen the same export request after a lost response; the original provider returns its retained bytes and full digest. Keep the existing native operation lookup for changes whose reply was interrupted.

## Deliver exact customer files and editable workspaces

Create an immutable delivery edition in the browser or through the original writer. It retains the selected source editions, fields and ready-only or all-active mode. Inspect its conflicts before transferring it.

Retain a customer package with an explicit revision, delivery ID and request UUID:

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /absolute/record-mastering-runtime -- \
  record-mastering-workspace export \
  --directory /absolute/customer-setup \
  --kind delivery --revision 24 \
  --delivery-id 7851c723-6eb4-4e78-9c41-5a18ecfc746a \
  --request-id 1f584b1d-3d1d-4a3a-8024-15b930c077d8
```

Substitute the actual observed revision, saved delivery ID and your retained request ID. The response includes the original packet's path, bytes and SHA-256. The packet contains `master.csv`, `dataset.json`, complete field provenance, conflicts and recipient instructions. The existing CSV seller owns pricing and payment if you offer that dataset for sale.

Use the same command with `--kind workspace` and no delivery ID for the entire editable customer state. That packet includes original source files and private decisions; choose its intended recipient accordingly. The input alias for a received packet must be explicitly configured in the receiving host's new reviewed setup.

The recipient uses the original `record-mastering receive` command with the transferred SHA-256 and a new destination. Read its preserved workspace ID, revision, source editions and deliveries. A subsequent edit is independent of the sender. Reopen the sender's original setup to see its later current state; receiving and export never roll back those later decisions.

## Reopen, upgrade and operating records

Reopen the original setup with `status`, the original Runtime Workspace with its same directory, and the selected mastering workspace with the native command. Retain all three owners plus the installed source/runtime identity in a full host backup. The customer workspace packet alone intentionally does not contain local application sessions, operator credentials, arbitrary host input paths or the installation's dependency tree.

For another machine, receive the runtime through the maintained installation transfer workflow, independently receive the customer workspace, and prepare a new setup using that machine's actual absolute paths and original coordinator. For a source/runtime upgrade, use the maintained new-directory runtime upgrade, compare its original profile and manifest, then create a reviewed application/setup revision. The old setup keeps its original operation history.

The private status and retained source files are the operational record. Record an actual build, READY installation, saved application, listening process, completed transfer and independent receive as separate outcomes. A saved start request can still be awaiting its native process.

## Source and contracts

This product composes the original source-owned interfaces:

- `sf30-seller-sdk/record-mastering/README.md`, `client.d.mts`, `application.mjs`, `mcp-tools.mjs` and `portable.mjs`.
- `distribution/runtime-workspace/APPLICATIONS.md`, `APPLICATION_PROVIDERS.md` and `storage.mjs`.
- `distribution/BUILDING.md`, `SOURCE_SELECTIONS.md`, `RUNTIME_INSTALL.md` and `RUNTIME_TRANSFER.md`.
- `stellar-forge/mcp-merchant-operator/MERCHANT_PROVIDERS.md`, `stdio.mjs` and its native configuration reader.

License: MIT.
