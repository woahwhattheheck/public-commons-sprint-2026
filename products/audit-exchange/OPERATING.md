# Audit Exchange — installed product

Audit Exchange joins native building audits to the maintained Starforge operator and agent workflow. Its source selection carries the full XML workspace, industrial browser, official validators, native nmecr engine, editable turnover exporter and receiving tools.

| Surface | Entry |
| --- | --- |
| Applications | Audit Exchange |
| Operator command | starforge audit-exchange |
| Native MCP | starforge audit-exchange-mcp |
| Browser/Node client | ./seller/audit-exchange |
| Merchant provider | audit-workspaces |
| Source selection | audit-exchange |

## Build and install the selected product

Use the existing Runtime source-selection view and choose Audit Exchange. The complete source command is:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-workspace-checkout \
  --ref ORIGINAL_COMPLETE_COMMIT --selection audit-exchange \
  --out /absolute/audit-exchange-release
~~~

The original builder preserves the selected Git source, complete package archive and manifest. Continue that same output with --resume after interruption.

Prepare and install through the maintained Runtime installer:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /absolute/audit-runtime \
  --archive /absolute/audit-exchange-release/ORIGINAL_PACKAGE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /absolute/audit-runtime --offline

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /absolute/audit-runtime --load --source
~~~

The operator profile uses the maintained Node/Python host. Install the audit application's Python requirement, lxml, in the selected Python environment. The R analysis runtime and its complete pinned nmecr installer are documented in the shipped ANALYSIS.md. Host dependencies are prepared independently of project mutations.

The source contribution explicitly includes the original R runner and four complete Schematron files, alongside the XSDs, imported gbXML schema, browser route manifest, publisher fixtures and original notices.

## Open and review an original project

~~~sh
starforge audit-exchange init --directory /absolute/private/audit-project --name "Audit review"
starforge audit-exchange serve --directory /absolute/private/audit-project --port 8769
~~~

Register the READY runtime in Runtime workspace, open Applications, choose Audit Exchange and select the initialized project. Save the launch and use the existing Start/Open/Stop controls.

Import original XML, select the complete official validation requirements, inspect native records and original energy streams, review corrections, assign findings, and save editions. The same project remains available to native commands and the Merchant provider.

The complete [operator guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/audit-exchange-workspace/OPERATOR.md), [application/API guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/audit-exchange-workspace/README.md), [native analysis guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/audit-exchange-workspace/ANALYSIS.md) and [Merchant guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/audit-exchange-workspace/MERCHANT.md) travel with the application.

## Deliver the engineering work

Preview and save the eight-table turnover projection from the selected original physical assets and audit records. Retain the full original XML/model/validation with its exact CSV tables.

Create the complete editable application package after the working review. It carries the application's source, all original project revisions, saved editions, reviews, sidecars, analysis inputs/outputs, receiving history and ordinary exports. The receiving operator can reopen and continue the same native work in a distinct project.

Deliver the selected managed Runtime package alongside the project when the receiver also needs the full Applications/Merchant environment. The project lives outside the installed source and remains independent of runtime upgrades.
