# A complete customer workflow in the native inbox

Use one private inbox to retain several merchant requests, inspect their exact
terms, execute one selected intent, and reopen its response and financial history
after a restart. This Node interface operates the original SF88 `queue.mjs`,
approval, buyer, response capture and finalizer. The original inbox is also
readable through `queue-cli.mjs` and its existing report.

The runnable interface is the existing `examples/customer.mjs`. In the complete
installed merchant distribution, the same commands are available as
`starforge buyer-node`. Every command keeps the existing `--runtime` and `--state`
arguments. `--inbox` is the absolute path of the original private queue, rather
than a second application identifier.

## Set up and inspect the merchant packet

Use Node 22+, the matching complete native runtime, and the operator's existing
configuration. Keep the application state, inbox, received packets and exports
in caller-owned private directories. A merchant packet supplies its request and
offered terms; the buyer's profile supplies the trusted operator and signer.

```sh
umask 077
node examples/customer.mjs inbox-init \
  --runtime /srv/forge/sf88-operator-buyer-cli \
  --state /srv/private/customer-purchases \
  --inbox /srv/private/customer-inbox

node examples/customer.mjs inbox-handoff-review \
  --runtime /srv/forge/sf88-operator-buyer-cli \
  --state /srv/private/customer-purchases \
  --packet /srv/private/merchant-operation.handoff.json
```

Initialization creates a new original inbox. To reopen it, use the same path in
`inbox-list`, `inbox-show` or another command. Do not initialize a replacement
inbox to recover existing jobs.

The packet review is the original redacted native handoff view. Select an actual
offered payment option by its index; the index selects the original tuple and
does not override its amount, asset, network or recipient. The original importer
validates the packet and ticket, retains exact request bytes, and preserves the
merchant's stable intent ID.

```sh
node examples/customer.mjs inbox-enqueue-handoff \
  --runtime /srv/forge/sf88-operator-buyer-cli \
  --state /srv/private/customer-purchases \
  --inbox /srv/private/customer-inbox \
  --profile /srv/private/operator-profile.json \
  --packet /srv/private/merchant-operation.handoff.json --accept 0
```

This imports and offline-reviews the request in the existing Node application,
then transfers it to the original inbox. It does not execute it. Request bodies
retain the original 16 MiB ceiling across packet import, saved operation,
enqueue and later review. A present empty body remains distinct from no body.
Do not add `bodyType` to native configuration: the original generated client
encodes its body and ordinary Content-Type header before native review.

At intake, `--response-max-bytes`, `--response-stream ndjson|sse` and
`--request-timeout-ms` select the corresponding original capture and transport
options. The matching runtime validates their supported values. Once retained,
the job's request and capture configuration are immutable.

## Add generated requests or existing native configurations

The existing `review` command prepares a generated-client operation. Add that
saved operation to the inbox using its existing intent:

```sh
node examples/customer.mjs review \
  --runtime /srv/forge/sf88-operator-buyer-cli \
  --state /srv/private/customer-purchases \
  --profile /srv/private/operator-profile.json \
  --client /srv/app/seller-client.mjs --operation actual_exported_operation \
  --inputs /srv/private/request-inputs.json --intent monthly-report-001 \
  --max-atomic 1000 --accept 0

node examples/customer.mjs inbox-enqueue \
  --runtime /srv/forge/sf88-operator-buyer-cli \
  --state /srv/private/customer-purchases \
  --inbox /srv/private/customer-inbox --intent monthly-report-001
```

For an existing original configuration, use `inbox-enqueue-config` with
`--config /srv/private/original-operator/operator.json`. That configuration
retains its own operator settings. A `--profile` override is not accepted by
this command.

Enqueue of a Node operation records its binding to one original inbox. Later
execution uses that inbox; direct `Operation.execute()` or transfer to another
inbox cannot create a second attempt. If import succeeded but the enqueue
response was lost, retain the reported intent and use `inbox-enqueue` with the
same state and inbox. This completes the original intake. It does not import
another packet, replace the job or assign a new intent.

An identical enqueue may return the original existing job. A changed request,
body, ticket or selected inbox must not replace it. The queue retains the actual
configuration and dependency hashes, private body/ticket files and permanent
attempt record.

## Review and execute one selected request

```sh
node examples/customer.mjs inbox-list \
  --runtime /srv/forge/sf88-operator-buyer-cli \
  --state /srv/private/customer-purchases --inbox /srv/private/customer-inbox

node examples/customer.mjs inbox-review \
  --runtime /srv/forge/sf88-operator-buyer-cli \
  --state /srv/private/customer-purchases --inbox /srv/private/customer-inbox \
  --intent monthly-report-001

node examples/customer.mjs inbox-execute \
  --runtime /srv/forge/sf88-operator-buyer-cli \
  --state /srv/private/customer-purchases --inbox /srv/private/customer-inbox \
  --intent monthly-report-001 --workspace /srv/private/original-operator
```

Use the intent actually returned by the packet or generated request. Execute
reads the selected immutable job's original offline review, checks its pins,
then invokes the original interactive operator approval and buyer once. The
`--workspace` option selects the original operator workspace when that operation
uses it. The native terminal, policy and signer requirements remain in effect.

To separate application review from execution, save the JSON from `inbox-review`
in a private file and supply it as `--review-file` to `inbox-execute`. The API
requires the same inbox, intent, configuration, body and ticket hashes. There is
no execute-all command. Ctrl-C reaches the selected native operation through its
AbortSignal; interruption does not authorize another attempt.

`inbox-cancel --intent ID` cancels an unattempted saved job through the original
queue. It cannot cancel away an existing execution record. Inspect an attempted
job with `inbox-show`, and use `inbox-recover` to invoke the original local
evidence recovery. Recovery starts no purchase. Preserve the original identity
and native state if a process ended without a complete response.

## Consume the retained response

First inspect `inbox-response --intent ID`. It returns the selected original job,
native buyer summary, saved delivery and stream metadata. If no original saved
terminal response is available, it returns the current job with `response:null`
and exit 2. A recovery observation alone cannot manufacture a download summary.

Save a complete verified response to a new private destination:

```sh
node examples/customer.mjs inbox-download \
  --runtime /srv/forge/sf88-operator-buyer-cli \
  --state /srv/private/customer-purchases --inbox /srv/private/customer-inbox \
  --intent monthly-report-001 --output /srv/private/exports/report.json
```

The destination parent must already exist. `saveAs` verifies the full original
byte count and SHA-256 before publishing and never replaces an existing file.
Reopen the same inbox and intent to export or read the same result after restart;
these commands make no merchant request.

`inbox-read --format json` decodes one verified JSON value. Its default read
limit is 8 MiB; an explicit `--read-limit` changes that application read limit
without changing native response capture. For larger record-oriented responses:

```sh
node examples/customer.mjs inbox-read \
  --runtime /srv/forge/sf88-operator-buyer-cli \
  --state /srv/private/customer-purchases --inbox /srv/private/customer-inbox \
  --intent monthly-report-001 --format ndjson
```

`csv`, `ndjson` and `sse` write one original decoded record per JSONL line,
respecting stdout backpressure. CSV defaults to arrays; `--csv-headers true`
returns objects keyed by the original header. SSE preserves native event
records; NDJSON emits their original JSON values. Use the format of the actual
response. SSE and NDJSON reuse the selected runtime's original stream parser.

For an interrupted native stream, `--allow-partial true` explicitly requests
only its retained complete records. The original capture must identify a
valid, hashed partial response and complete-record boundary. Optional
`--max-record-bytes` and `--max-records` constrain parsing. A full-file hash is
checked before records are exposed and again during consumption. Exhaust the
iterator, or observe successful CLI completion, before committing a downstream
import; later storage changes can still invalidate a partially consumed stream.
See [STREAMS.md](STREAMS.md) for the original framing and recovery contract.

The response object deliberately has no historical-process `ok` property.
Successful local inspection, complete file delivery, native buyer outcome and
financial finalization are distinct facts. Keep those fields when passing
the result to another application.

## Finish accounting and hand over the history

`inbox-finalize` explicitly continues the original reservation for one existing
intent. It requires the matching original operator workspace and can read
configured providers or update the original ledger. It does not execute the
merchant request again.

```sh
node examples/customer.mjs inbox-finalize \
  --runtime /srv/forge/sf88-operator-buyer-cli \
  --state /srv/private/customer-purchases --inbox /srv/private/customer-inbox \
  --intent monthly-report-001 --workspace /srv/private/original-operator

node examples/customer.mjs inbox-report \
  --runtime /srv/forge/sf88-operator-buyer-cli \
  --state /srv/private/customer-purchases --inbox /srv/private/customer-inbox \
  --workspace /srv/private/original-operator \
  --output /srv/private/exports/buyer-history.html
```

For merchant finalization, supply `--outbox` and `--merchant-route` together.
The original finalizer validates the buyer, request, attempt and ledger binding.
Its result retains `FINALIZED`, `IDEMPOTENT_FINALIZED` or the actual alternative
outcome, alongside the status of saving the finalization view. A delivered file
does not imply that this financial continuation has completed.

The HTML is the original private searchable report: every retained job, request
identity, selected terms, attempt, outcome, delivery, recovery and finalization
remains attached to the same intent. It contains local operational metadata and
should stay with the operator. `inbox-list` also returns the complete original
JSON job collection for a private machine-readable handover. Neither export
converts authorization ceilings into charges or combines unlike assets.

Each native command returns its original result under `native`, with the current
command's `process` separately. Successful command files are cleaned up normally.
An uncertain command retains a private `commandDirectory`; an `InboxError` also
retains its available `native` result and `process`, which the CLI prints. Reopen
the same queue with `inbox-show` before choosing another action.
`--inbox-report-limit` changes the separate
native result-file ceiling, which defaults to 32 MiB; it does not raise request
body, response capture or spending limits.

CLI exit 0 describes the requested command's completion. Exit 2 retains an
unsuccessful or uncertain native result, unavailable original response, or
incomplete finalization. Argument/runtime errors return 1; interruption returns
130. Read the original fields as well as the exit status. A later inspection's
process success does not rewrite the historical buyer result.

## The same workflow from an application

```js
import { Buyer } from '@stellar-forge/native-buyer';

const buyer = new Buyer({
  runtimeDirectory: '/srv/forge/sf88-operator-buyer-cli',
  stateDirectory: '/srv/private/customer-purchases',
  operatorProfile: '/srv/private/operator-profile.json',
});
const inbox = buyer.inbox('/srv/private/customer-inbox');
const jobs = await inbox.list();
console.log(jobs.native, jobs.process);

const intentId = 'monthly-report-001'; // The actual retained request identity.
const review = await inbox.review(intentId);
const execution = await inbox.execute(intentId, {
  review, workspaceDirectory: '/srv/private/original-operator',
});
console.log(execution.native, execution.process);

// A later process reopens the same queue; response() does not execute it.
const reopened = buyer.inbox('/srv/private/customer-inbox');
const response = await reopened.response(intentId);
if (response) {
  console.log(response.job.state, response.native, response.delivery);
  await response.saveAs('/srv/private/exports/original-response.json');
}
await reopened.exportReport('/srv/private/exports/customer-history.html');
```

Pass `{signal}` to commands and response consumers when an application supplies
a Stop action. Keep the native queue, Node state and original operator workspace
together through the maintained [workspace recovery workflow](RECOVERY.md).
The queue remains the execution authority for transferred operations.
