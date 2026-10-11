# Prepare and operate a MySQL paid MCP product

A prepared MySQL merchant can be retained as a native paid MCP product with its
approved queries, exact argument schemas, explicit native payment alternatives,
original connection profile and customer tool handoff. The original data MCP
server opens the original MySQL source and supplies native x402 execution.
The existing buyer saves the complete returned MCP result and its receipt.

Use this workflow after preparing the merchant through the
[MySQL browser workspace](../../stellar/scf-starforge-20261009/sf30-seller-sdk/mysql/workspace/README.md)
or its CLI. The same prepared merchant also continues through the original
[HTTP release and customer client workflow](../../stellar/scf-starforge-20261009/sf82-seller-pilot/MYSQL_RELEASES.md).

## Runtime and inputs

Use Node 22.16 or later, Linux `flock`, the original pinned MySQL driver and the
native MCP dependencies described in [DATA_TOOLS.md](DATA_TOOLS.md) and
[PAID_TOOLS.md](PAID_TOOLS.md). The maintained merchant archive includes the
original `mcp-data` command and source. From a source checkout, replace
`starforge mcp-data mysql` below with
`node stellar-forge/mcp-paid-agent/mysql-package.mjs`.

The merchant package must pass the original MySQL prepared-package verifier:
its plan, query definitions, source bindings, service, OpenAPI, generated client
and optional database CA remain bound to their original file hashes. Its
connection profile uses the original environment reference for the password.

Prepare the original native facilitator configuration for the intended network,
assets, recipients, signer environment references, fee limits and ownership
directory. Its policy is reviewed through the same validator used by the live
native server. See [the native facilitator guide](../../stellar/scf-starforge-20261009/native-facilitator/README.md).

A MySQL MCP plan selects existing route IDs and explicitly states each tool's
complete native payment alternatives. For example:

~~~json
{
  "schema": "stellar-forge.mysql-data-mcp-plan.v1",
  "facilitatorFile": "./native-facilitator.json",
  "tools": [
    {
      "routeId": "catalog",
      "name": "sensor_catalog",
      "accepts": [
        {
          "scheme": "exact",
          "network": "stellar:testnet",
          "asset": "COPY_THE_ASSET_FROM_YOUR_NATIVE_POLICY",
          "amount": "10000",
          "payTo": "COPY_THE_RECIPIENT_FROM_YOUR_NATIVE_POLICY",
          "maxTimeoutSeconds": 60,
          "extra": {
            "areFeesSponsored": true,
            "paymentFlow": "authorization"
          }
        }
      ]
    }
  ],
  "server": {
    "host": "127.0.0.1",
    "port": 8460,
    "path": "/mcp",
    "publicEndpoint": "https://data.merchant.example/mcp",
    "name": "merchant-mysql-data",
    "maxResultBytes": 1048576
  }
}
~~~

Replace the asset and recipient markers with the exact values in the operator's
native policy. Select a route ID present in the original merchant; choose the
amount and tool name for this MCP product. The source HTTP payment alternatives
remain visible beside the MCP alternatives in the review. The original native
MCP profile requires exact Stellar terms with sponsored authorization flow.

The plan requires a public endpoint so the retained customer handoff has a
concrete destination. HTTPS endpoints normally sit behind the operator's reverse
proxy; `host` and `port` select the local listener. A loopback HTTP endpoint can
be used for a local native deployment. The endpoint path must equal the
configured MCP path. Other server options are the original data-server options.

## Review, retain and reopen

The plan's facilitator path resolves relative to that plan. Review reads the
original source and native policy without connecting to the database or resolving
signer secrets:

~~~bash
starforge mcp-data mysql review \
  --package /private/merchant/releases/catalog/package \
  --plan /private/merchant/mysql-mcp-plan.json
~~~

Review returns the original source and execution digests, complete tool input
schemas and examples, the selected native terms, the source's HTTP terms and the
environment references required at launch. Its `reviewId` binds those source
contracts, native facilitator bytes and tool/server choices.

Retain the reviewed product at a new destination. Its parent must already exist
at a canonical path. Supply the review ID when the operation must consume that
exact earlier review:

~~~bash
starforge mcp-data mysql prepare \
  --package /private/merchant/releases/catalog/package \
  --plan /private/merchant/mysql-mcp-plan.json \
  --directory /private/merchant/catalog-mcp \
  --review REVIEW_SHA256

starforge mcp-data mysql inspect \
  --directory /private/merchant/catalog-mcp
~~~

Preparation copies the original declared MySQL files through the existing
SF82 MySQL release capture. It then writes the exact authoring plan, a portable
plan, the native facilitator configuration and customer handoff, and publishes
the complete directory in one rename. The retained descriptor lock remains
outside the final destination; process exit releases the lock. An existing
destination keeps its current contents. A failed preparation cleans up its own
temporary directory.

| Retained content | Purpose |
| --- | --- |
| `mysql/package/` | Original verified source, merchant plan, service, OpenAPI, generated customer client and optional database CA |
| `manifest.json`, `offers.json`, `seller-service.json` | Original SF82 MySQL release capture and public HTTP contract |
| `authoring-plan.json` | Exact original operator input bytes |
| `mysql-mcp-plan.json` | Reviewed tool selections with a package-relative facilitator path |
| `facilitator.json` | Original validated native facilitator configuration and environment references |
| `data-mcp.json` | Original data-server configuration with provider `mysql` and package-relative `preparedDirectory` |
| `mcp-package.json` | Retained file hashes, reviewed source/terms identity and original authoring-plan hash |
| `customer/mcp.json`, `customer/README.md` | Public tool declarations, native payment alternatives, discovery destination and buyer/result workflow |

The full directory belongs to the merchant operator and contains its private
database configuration. Deliver the `customer/` directory to MCP customers.
The original five-file HTTP client remains in `mysql/package/client/` for the
existing customer export workflow.

The native policy's signer ownership directory remains its original host reference.
Keep that original state available alongside the configured environment and database
when moving the prepared product. The original authoring directory may be moved
after preparation. Inspect reads
the retained files, validates the original release and source, compiles the same
tool declarations and native terms, and verifies the complete handoff. Customer
prose remains the exact originally retained bytes when software is upgraded.

## Run and close the native product

Supply the environment variables listed by review using the host's existing
secret injection mechanism. Start from the complete retained directory:

~~~bash
starforge mcp-data mysql run \
  --directory /private/merchant/catalog-mcp
~~~

The command verifies the retained source and plan, delegates to the original
data launcher and prints the native endpoint, discovery URL, tool names, source
status and retained package identity. The original source owns approved prepared
statements, argument admission, exact numeric and binary encoding, query limits
and database shutdown. The native MCP server owns signing policy, verification,
settlement, sessions, result limits and drain. SIGINT and SIGTERM await that same
close operation.

Queries read the current database rows. Reopening this package restores its
approved query and payment configuration; an immutable dataset belongs in the
[MySQL dataset publisher](../../stellar/scf-starforge-20261009/sf30-seller-sdk/mysql/publisher/README.md).

## Customer purchase and retained results

Give the buyer `customer/mcp.json` and `customer/README.md`. They contain the
endpoint, discovery URL, approved argument schemas, merchant examples and
complete payment alternatives. The original buyer can connect through its
browser console, HTTP MCP workspace or host integration.

The trusted buyer operator configures the advertised origin, its own payer and
native signing policy, durable state directory and approval callback.
[REMOTE_MCP.md](REMOTE_MCP.md) supplies the complete native operator setup.

1. Search the retained discovery destination and describe the selected tool.
2. Preview the exact advertised alternative with arguments from its declared
   schema. The original merchant example is included when one was supplied.
3. Execute the retained quote with the trusted operator's approval.
4. Read the status and result inbox. `bazaar_read_result` consumes the complete
   saved MCP result with range continuation.
5. Reopen the same state directory to inspect or export the original result and
   its payment receipt. [RESULTS.md](RESULTS.md) covers the native Node API and CLI.

The buyer's original once-per-quote dispatch, schema comparison, signed outcome
reconciliation and result retention apply to these tools. Exact decimal strings,
large integer strings, binary values and complete structured query results remain
in the original MCP result file.

## Native Node API

~~~js
import { once } from 'node:events';
import {
  reviewMysqlMcpPackage,
  prepareMysqlMcpPackage,
  inspectMysqlMcpPackage,
  startMysqlMcpPackage,
} from './stellar-forge/mcp-paid-agent/mysql-package.mjs';

const review = await reviewMysqlMcpPackage({
  packageDirectory: '/private/merchant/catalog',
  planFile: '/private/merchant/mysql-mcp-plan.json',
});

const retained = await prepareMysqlMcpPackage({
  packageDirectory: '/private/merchant/catalog',
  planFile: '/private/merchant/mysql-mcp-plan.json',
  directory: '/private/merchant/catalog-mcp',
  expectedReviewId: review.reviewId,
});

const reopened = await inspectMysqlMcpPackage(retained.directory);
const server = await startMysqlMcpPackage(reopened.directory, {
  environment: process.env,
});
try {
  console.log(server.endpoint, server.discoveryUrl, server.mysqlPackage);
  await once(process, 'SIGINT');
} finally {
  await server.close();
}
~~~

Use the existing source description and native policy to resolve review errors.
A changed source or plan requires a current review. A modified retained file is
identified during inspection; restore the original retained bytes or prepare a
new complete product from the intended source and explicit plan.
