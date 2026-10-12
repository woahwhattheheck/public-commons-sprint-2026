# Receive an application contract across Redis and Valkey

This command joins the original commissioning engine to receive the same customer application on a baseline Redis deployment and a selected Valkey deployment. Each side keeps its original saved source workspace, revision, preview operations, complete response pages, package and generated customer files.

The paired input identifies the agreed source edition or receiving window. The command checks the same declared queries, routes, payment terms and customer examples on both sources. It compares complete original rows, writes useful row differences, and can stage the candidate package after both customer expectations and the paired comparison match.

## Prepare the selected input

From the installed source directory:

~~~sh
node sf30-seller-sdk/redis/workspace/cutover.mjs template > customer-cutover.json
node sf30-seller-sdk/redis/workspace/cutover.mjs review --input customer-cutover.json
~~~

The complete example is a starting contract for the original six product kinds. Replace its connection, source edition, operator, key/field declarations, product terms and expected results with the customer's selected values. The template's example hosts and REPLACE_WITH labels are editable placeholders. Read the original [commissioning guide](COMMISSIONING.md) and [connection setup](SETUP.md) for each source profile.

The schema is stellar-forge.redis-cutover-input.v1:

| Field | Selected meaning |
|---|---|
| operationId | The stable paired receiving operation. |
| consistency | immutable-edition or paused-writes, the customer's actual edition/window reference, and receiving operator. |
| baseline | Complete original stellar-forge.redis-commissioning-input.v1 for the Redis source. |
| candidate | Complete original commissioning input for the Valkey source, with distinct creation and receiving IDs. |
| comparisons | One explicit rule for each original check ID. |
| release | Optional original candidate release ID/runtime, staged after the comparison passes. |
| maxComparisonBytes | Combined original row JSON budget for one comparison; default 64 MiB, selectable 1–256 MiB. |

Both original commissioning inputs retain identical queries, routes, payment terms and checks. Their actual connection profiles, source pool/timeouts, public receiving origins, workspace labels and public CA material can differ. Keep private passwords in the named environment variables. Retain distinct monitor/data CAs and credentials when the selected deployment uses Sentinel. The ordinary original setup API carries CA files into each saved source.

A receiving window is an operator-supplied data condition. The command records the selected reference and the actual observation time of every native page. The customer's datastore operator establishes and releases that window. The application command reads and prepares application artifacts.

Place an optional release at the top level. The two nested inputs omit release, allowing the paired result to determine when the candidate package is staged. Activation and external traffic selection remain ordinary explicit operator actions on that retained release.

## Compare the application semantics

- **Ordered:** current values, projected hash rows, rankings, streams and lists retain exact canonical row order and values. A mismatch lists every changed, inserted or removed row index. The original list/stream/ranking kinds require ordered comparison.
- **Multiset:** an explicitly unordered non-set result compares row values and their occurrence counts. Duplicate values remain meaningful.
- **Set:** the original set query compares membership. Redis/Valkey SSCAN can visit a member more than once and returns an unspecified order. Only the comparison view removes repeat visits; each original response, row count, cursor and page remains preserved.

Collection checks receive all pages. They follow the original nextInput until completion, including empty SSCAN pages with a nonterminal cursor. Native uint64 cursors stay decimal strings. A row or page budget ends receiving with the original incomplete-operation details. The tool validates every saved page against its original completed preview, query, revision, input, full-result hash and aggregate rows before computing differences.

Use customer-specific expected values alongside the paired comparison. For a set, expected.columns and useful requiredRows avoid treating unspecified native scan order as part of membership. Exact native row counts remain available when the customer's contract calls for them.

## Receive and reopen

Use a parent directory with sufficient space for both original saved workspaces and their complete prepared packages:

~~~sh
umask 077
node sf30-seller-sdk/redis/workspace/cutover.mjs receive \
  --input customer-cutover.json --directory /private/customer-cutover
~~~

The command completes baseline receiving, candidate receiving, row comparison, original customer package verification and optional candidate staging. RECEIVED exits zero. CONTRACT_MISMATCH exits two and preserves both original receiving outcomes and full row differences. Operational failures exit one with the original error and retained receiving location.

The directory contains:

- cutover-input.json: the complete frozen input and its original SHA256.
- baseline/ and candidate/: the original native authoring workspaces.
- baseline-receiving.json and candidate-receiving.json: complete original commissioning outcomes.
- difference-CHECKID.json: full ordered changes or membership/count differences, column comparison and customer expectation results.
- cutover-result.json: the comparison summary, exact difference hashes, observation windows, original workspace bindings, candidate/baseline customer package references and selected release.
- cutover-error.json: the most recent interrupted/failed invocation details, if one occurred.

Cold comparison uses the full original saved pages:

~~~sh
node sf30-seller-sdk/redis/workspace/cutover.mjs compare \
  --input customer-cutover.json --directory /private/customer-cutover
~~~

The comparison reopens the exact workspace/profile/revision bindings. It uses existing saved read outcomes and the same retained candidate release request. Credentials are needed for native receiving; saved comparison can operate from retained rows. When a previous native operation was interrupted, rerun receive with the identical input and directory to let the original commissioning engine recover its existing request IDs.

After a source or contract correction, choose a new paired operation and directory, with new baseline/candidate creation/receiving IDs. Preserve the earlier comparison as the previous receiving edition. A repeated original request deliberately returns its retained result; it does not silently take a new observation of changed customer data.

Optional offline workspace creation uses create with the same input/directory. Its created JSON artifacts preserve prior complete receiving reports.

## Customer operation and handover

Each successful side has the original generated Node client and OpenAPI from its saved package. The candidate is the selected application handover; the baseline preserves the original client/contract reference. The [customer exporter](CUSTOMER_EXPORT.md) runs selected actual operation IDs with an explicit payment budget and retains full paid response pages before continuing.

The source/browser/MCP/managed Applications continue to use the original workspace directories. The paired tool adds no second customer database or background queue.

The handover includes the original source edition/window, both source profiles with environment references, exact expected/observed comparison, useful differences and their resolution, generated customer files, selected release and rollback edition, and the named customer receiving operator. Datastore migration, replication, traffic change and production rollout follow that operator's actual selected plan.

## Programmatic API

~~~js
import {
  normalizeRedisCutover, receiveRedisCutover, compareRedisCutoverRows
} from './sf30-seller-sdk/redis/workspace/cutover.mjs';

const review = normalizeRedisCutover(input, process.env);
const result = await receiveRedisCutover({
  input, directory: '/private/customer-cutover',
  environment: process.env, mode: 'receive'
});
~~~

receiveRedisCutover accepts review, create, receive or compare. Supply inputSha256 when receiving a previously selected complete input file; otherwise the API uses canonical JSON. The CLI pins the full input bytes. Keep that same input representation when reopening its original directory.

compareRedisCutoverRows exposes the same exact comparison for an existing operator view. The full receiving API verifies original native page custody before using it.
