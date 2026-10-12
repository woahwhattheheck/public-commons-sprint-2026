# Commission a Redis or Valkey customer application

The commissioning command takes a complete source, merchant plan and customer receiving examples into the original Redis connection setup and saved authoring workspace. It uses the same compiler, private connection profile, source reader, operation records, merchant preparer, generated customer files and release store as the browser operator.

## Select the customer contract

Copy [commissioning-input.example.json](commissioning-input.example.json), or generate the current six-product template:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/redis/workspace/commission.mjs template > customer-input.json
~~~

The input schema is stellar-forge.redis-commissioning-input.v1. Fill its original setup.source and setup.plan fields; [connection setup](SETUP.md) and [List/Set products](../COLLECTIONS.md) explain those contracts. The supplied keys, hosts, payment asset/recipient and expected one-row examples are editable selections. Record the actual customer values before receiving.

Choose a stable operationId and requestId for this customer commissioning operation. Keep the exact input file after creation. The original setup pins the complete input bytes and rejects a different file at the same operation/workspace. A later commissioned edition uses its own input and target, while normal product edits remain available in the original workspace.

Choose the actual exposed connection:

| Deployment | Original source fields | Customer decision |
|---|---|---|
| Standalone or provider endpoint | topology standalone, host/port, database, TLS and environment references | Use the actual client endpoint from the provider or existing deployment. |
| Native Cluster | topology cluster, root nodes, TLS, ACL environment references and optional address map | Confirm client-reachable advertised nodes; Cluster keys route through the original client. |
| Sentinel | topology sentinel, monitor roots/master name, separate data/monitor ACL references and TLS CAs | Select the original monitored master and the actual monitor/data trust contract. |
| Upstash REST | Original transport upstash-rest HTTPS/token profile | Keep the provider's original command/result and rate-limit behavior. |

Credentials stay in the receiving process environment. The manifest carries environment variable names. For a custom CA, put the public PEM in setup.certificates.caFile; Sentinel can independently select sentinelCaFile. The original setup validates certificate-only PEM, normalizes the filenames, and retains the bytes with the private source profile.

The plan specifies the public origin, selected routes, complete payment scheme/network/asset/payee/amount and request timeout. The sample UNVERIFIED_DEMO_ASSET and UNVERIFIED_DEMO_RECIPIENT values are commissioning placeholders. Choose the customer's actual testnet contract and original buyer/facilitator environment.

## Record useful receiving examples

Each selected route needs a checks entry referencing its declared query. Up to 24 examples can cover several inputs or boundaries for the same product. The original parameter compiler validates each input before any source read.

~~~json
{
  "id": "catalog-north",
  "query": "catalog",
  "input": {"region":"north"},
  "allPages": false,
  "maxPages": 100,
  "maxRows": 10000,
  "expected": {
    "rowCount": 1,
    "requiredRows": [
      {"itemId":"9007199254740993", "title":"Reviewed customer item", "priceAtomic":"12500000"}
    ]
  }
}
~~~

Select the expected shape from the actual returned source contract:

- rows: exact ordered rows, including duplicates and the original null/binary encodings.
- requiredRows: a multiset of rows that must occur. Two equal expected rows require two actual occurrences. This suits a native set iteration whose order is unspecified.
- rowCount: the actual expected number of collected rows.
- columns: exact returned column descriptors.
- rowsSha256: SHA256 of canonical JSON rows, where object keys are sorted recursively and arrays retain their order.

Use at least one expected field for every example. requiredRows can accompany rowCount so an empty result cannot pass an intended nonempty example.

With allPages true, the command follows each original nextInput until it is absent. Empty SSCAN batches still continue, uint64 scan cursors stay strings, and every full batch remains intact. maxPages and maxRows bound the receiving operation; reaching either with data or a continuation still outstanding produces a concrete incomplete result. Set COUNT remains a hint. It does not guarantee the returned batch size.

Live source mutations can move list/sorted-set indexes, and set iteration may repeat members. Select an immutable edition or a controlled receiving window when the acceptance contract requires an exact whole-iteration population.

## Review and create the original workspace

Run an offline review first:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/redis/workspace/commission.mjs review \
  --input /private/customer-input.json
~~~

The JSON result includes the original connection/compiler review, required environment names with their current availability, certificate digests, exposed routes/payment terms, expected examples and selected release. It does not open the source.

Create the original saved authoring workspace:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/redis/workspace/commission.mjs create \
  --input /private/customer-input.json \
  --workspace /private/customer-valkey
~~~

The target parent must already exist. The original setup creates a private workspace and stores its operation/input identity with the original metadata. Repeating this exact command reopens the same workspace and creation request. A conflicting target or changed commissioning input is reported by the original setup.

The returned workspace ID/profile digest identifies the same saved operator that the browser, MCP and managed Applications use. The original workspace/cli.mjs can open that workspace for product edits, private previews, public customer downloads and retained releases.

## Receive and prepare the application

Set the source environment variables in the receiving process, then run:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/redis/workspace/commission.mjs receive \
  --input /private/customer-input.json \
  --workspace /private/customer-valkey
~~~

This performs one original operation:

1. Reconcile or create the selected setup using the same operation, creation request and complete input identity.
2. Check that the saved current queries/plan still match that input. Existing operator edits are retained for explicit review.
3. Execute each private source example through original saved preview operations. Follow native continuation only when requested.
4. Compare the collected rows with the selected expected result. Every page remains accessible by its original operation ID.
5. Prepare the original merchant package after all selected examples match. Read back each original public client/OpenAPI file through the workspace's verified file API.
6. If a release is selected, stage the prepared package in the same retained release store.

The result contains the original workspace binding and revision, each saved preview request/page/continuation, expected-result outcome, actual package path/manifest digest and verified public-file sizes/hashes. It also returns the original staged release identity when selected.

~~~json
{
  "release": {
    "releaseId": "customer-valkey-v1",
    "label": "Customer Valkey first edition",
    "runtime": {
      "port": 8080,
      "facilitator": "https://facilitator.customer.example"
    }
  }
}
~~~

The release remains staged for the original operator's activation. The original retained release UI supports its normal review, activation, drain/reopen and rollback. The original generated client and buyer perform the agreed paid customer request after the source/merchant have been received.

## Resume the same work

Run receive again with the identical input file and target. It uses deterministic original request IDs per example/page/preparation/stage. Completed operations are reused; interrupted operations resume through workspace.resume. A saved failed operation returns its actual error for correction in the original operation flow. The command does not replace a failed or conflicting original request with a fresh identity.

A source mismatch returns ACCEPTANCE_MISMATCH and CLI exit code 2, with each failing example and its saved pages. Earlier native previews remain retained. Configuration, cursor, resource or original-operation errors return exit code 1 with the code and the relevant original request. Successful receipt returns RECEIVED.

If a customer edits the product contracts after commissioning creation, use the original browser's review/save/preparation flow for that revision. The immutable commissioning file continues to identify its own selected contract.

## Programmatic use

~~~js
import { commissionRedis, normalizeRedisCommissioning }
  from './workspace/commission.mjs';

const review = normalizeRedisCommissioning(input, process.env).review;
const result = await commissionRedis({
  input,
  directory: '/private/customer-valkey',
  environment: process.env,
  mode: 'receive'
});
~~~

A file-based caller should pass the exact complete input bytes' inputSha256. An object-only caller can omit it; the command uses canonical JSON identity consistently for that operation. Reuse the same choice when recovering.

The default runtime requirements are those of the original source/authoring workspace: current supported Node with node:sqlite, the existing Redis dependency for native connections, and the original package source. Receiving needs the selected source network/environment; review and workspace creation can run offline. The command does not install another dependency set or launch another merchant process.

## Customer commissioning operator

The original saved workspace now includes a complete customer commissioning view, expected-result matrix, durable receiving operations and customer handover. See [COMMISSIONING_OPERATOR.md](COMMISSIONING_OPERATOR.md) for the browser, original CLI, HTTP and same-workspace native receiving flow.
