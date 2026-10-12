# Install client close runbooks and portfolio

The selected product uses the repository's original distribution builder and runtime installer. Build and install from an exact Git commit that contains `accountant-portfolio`; keep the resulting package, manifest, dependency lock and runtime receipts together.

## Choose the original source

The source selection is [accountant-portfolio.json](../../stellar/scf-starforge-20261009/distribution/selections/accountant-portfolio.json). It retains the complete accounting and native release components, the original accounting merchant provider, Runbooks and Portfolio clients, managed Applications, browser assets and the actual supporting imports. The selection adds the `client-close` command as a direct registration of the original workspace server.

From a checkout containing the chosen commit, use the existing builder:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --ref FULL_COMMIT_SHA \
  --selection accountant-portfolio --out /private/client-close-release
~~~

Read the returned archive path and SHA256. The output directory belongs to that commit and source selection. A completed build is reopened through its saved output:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --out /private/client-close-release --resume

node stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /private/client-close-release --status
~~~

Use a different output directory when selecting a different commit or product. The selected package version includes both the source commit and `selection.accountant-portfolio`.

The original Runtime workspace also provides **Build a product** on releases that include that interface. Select this repository and exact commit, choose **Client close runbooks and firm portfolio**, review the source selection and open the completed archive in **Source & profile**. It is the same builder and retained output.

## Keep the complete operator materials

The selected package explicitly requires all three original Runbooks documents: `RUNBOOKS.md`, `RUNBOOK_PROFILES.md` and `examples/weekly-monthly-runbook.json` under `source/stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/`. The same paths appear in the package's file inventory. The four product guides and `accounting.example.json` stay under `source/products/accountant-portfolio/`.

Copy the installed weekly/monthly JSON into the private commissioning directory, replace its operator/client/responsibility content, and prepare it through `starforge client-close runbooks prepare --action save`. Keep that edited input outside the installed source so a following package can preserve the original template and the client's actual version independently. The [operating guide](OPERATING.md#use-weekly-and-monthly-procedure-sets) covers publication and exact period selection.

The browser selection helper is an original registered asset. Use the whole selected runtime when upgrading an operator or receiver so the controller, browser, MCP descriptions and typed declarations support the same saved profiles.

## Prepare the native runtime

Use the maintained Linux runtime with Node 22.16 or newer, Python 3.11 or newer, npm, `flock` and `tar`. The original installer reports the actual required dependencies and native build prerequisites for the selected profile. Preserve its exact resolved graph.

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /private/client-close-runtime \
  --archive /absolute/returned-package.tgz --sha256 RETURNED_ARCHIVE_SHA256 \
  --native --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /private/client-close-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /private/client-close-runtime --load --source
~~~

Replace the archive path and digest with the actual builder result. The native, MCP and operator switches select the existing runtime profile. They do not replace the source selection.

The installed package is under `/private/client-close-runtime/package/`; its original dependencies are under `/private/client-close-runtime/node_modules/`. Preserve this layout so the installed source, native imports, SDK, browser launcher and Applications resolve one complete runtime.

An existing complete dependency graph can be adopted with the installer's `--adopt-existing` option after it is placed in this runtime through the original graph-receiving workflow. The installer verifies the graph, lock, selected profile and original imports before declaring it ready. A graph must satisfy this exact profile. Keep the actual donor/receiving identities with the installation record.

For interrupted installation, continue the same prepared runtime:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs resume \
  --dir /private/client-close-runtime
~~~

An offline continuation uses the original `--offline`, `--cache` and, when required, `--node-headers` options with the actual retained cache and toolchain. The prepared source and dependency decisions stay unchanged.

## Open the installed command

Use the original runtime entry to select its installed binary:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /private/client-close-runtime -- client-close --help
~~~

After adding the installed package's binaries through the normal package/runtime setup, these invoke the same original server:

~~~sh
starforge client-close --help
starforge-close --help
starforge merchant-accounting-workspace --help
~~~

Inspect `starforge registrations` and the installed `manifest.json` for the actual command, client export, provider and source selection. The package contains explicit named exports; use those names for the typed clients.

## Select the existing workspaces

Each client has its own private accounting workspace. The firm coordinator has another. Their original native source directories and workspace identity remain the source of truth when the close uses uploaded client files.

Reopen an initialized client:

~~~sh
starforge client-close --workspace /private/client-a/accounting
~~~

To initialize a new original accounting workspace, select its actual original outbox, proof directory and accounting terms:

~~~sh
starforge client-close --workspace /private/client-a/accounting \
  --outbox /private/client-a/source/outbox \
  --proof-dir /private/client-a/source/proofs \
  --terms /private/client-a/source/terms.json
~~~

Keep the workspace outside those input directories. The native initializer validates the source paths and terms before saving the workspace. Use its actual current sources; a period's ordinary close documents are uploaded and selected separately inside Runbooks.

Stop this original owner after initialization when the firm or another managed owner is to open the same client. For an existing live owner, use its printed loopback URL for CLI work.

Copy [accounting.example.json](accounting.example.json) into the private commissioning directory, replace each path and label with the original workspace's actual configuration, and retain only the intended client mappings. The example is configuration structure; it creates no client, source file, period or financial record.

The original merchant initializer produces a complete host configuration from that accounting section:

~~~sh
starforge merchant-mcp init-accounting \
  --dir /private/client-close-operator \
  --accounting /private/accounting.json \
  --name "Client close operations"
~~~

Use the returned `merchant-mcp.json` with the native portfolio:

~~~sh
starforge client-close portfolio inspect \
  --config /private/client-close-operator/merchant-mcp.json --coordinator firm

starforge client-close \
  --portfolio-config /private/client-close-operator/merchant-mcp.json \
  --portfolio-workspace firm --desk client-portfolio
~~~

Open the printed address at `/portfolio.html`. Its client links open the same original Runbooks desk under the selected client alias.

## Managed Applications and agent access

Start the existing Runtime workspace for this installed runtime and use **Applications**. The selected product includes:

| Application | Original selection |
| --- | --- |
| Client runbooks | One existing client accounting workspace. |
| Client portfolio | A host configuration, coordinator alias and its complete client set. |
| Merchant accounting | Original reconciliation, connection and accountant workflow. |
| Cryptoworth accounting | Original customer template, import comparison and retained accountant return. |

Review the exact source/runtime and workspace identities before saving an application. Its original start record retains every selected resource. Stop its native run before opening those directories through another owner; a stopped-owner CLI closes only the workspaces it opened.

For the merchant endpoint, retain the existing bearer-token environment and transport:

~~~sh
starforge merchant-mcp serve \
  --config /private/client-close-operator/merchant-mcp.json \
  --token-env MERCHANT_OPERATOR_TOKEN --port 8765
~~~

The environment variable contains the actual access token. Client calls use the configured alias, native UUID and revision; input files are selected from `runbookInputs` and `portfolioInputs` in the host configuration. The [installed client guides](README.md#included-interfaces) describe typed access, complete paging and exact file receiving.

## Upgrade and reopen

Create a fresh runtime when adopting a different source package. The existing `runtime-install upgrade`, `recover` and `compare` operations retain the original profile and reports; use their generated plan and the new package's actual digest. Keep native client workspaces separate from runtime source and dependency directories.

After the former workspace owner has stopped, review the existing configuration against the new installed runtime, reopen the same original workspace IDs and download an already retained period or portfolio. Its bytes and IDs remain the same. A new source package does not authorize replacing client source paths, repeating a committed native request, or losing the original application history.
