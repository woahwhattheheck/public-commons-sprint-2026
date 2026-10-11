# SF88: One-command approved Stellar buyer pilot

For complete large-file downloads, use [object acquisition](OBJECTS.md): select
the original merchant object description, approve each chunk through this buyer,
resume saved progress, and assemble the complete private file.

For several prepared operations and restart recovery, use the [durable buyer
inbox](QUEUE.md). It adds private request snapshots, a permanent attempt record,
original-evidence recovery and an offline history report to this same buyer.

For complete encrypted operator-state backup and original-path restoration, use
[workspace recovery](RECOVERY.md). It retains the existing spend journal and keys,
inboxes, evidence and request/output files through the original recovery engine.

For a merchant POST with an issued operation capability, use [private operation
tickets](OPERATION_TICKETS.md). The existing prepare command accepts the body
and ticket as private files; workspace and inbox imports preserve the exact
ticket while review displays only its operation key, request hash and expiry.
The merchant's **complete buyer request** download can be moved to another host
and imported with `--import-operation --file ABS --dir NEW_PRIVATE_DIRECTORY
--accept 0`. The original importer retains exact input bytes and creates the
local review config; the buyer supplies its own operator settings afterward.

Operator-side executable joining SF31 buyer HTTP, SF81/SF62/SF36 approval and reservation, and SF82/SF43/SF52 checkout recording. The native operator workspace supplies the official Stellar SDK signer adapter and private local setup for the selected testnet or mainnet network. Existing operator-provided signer modules remain supported. The example below uses testnet; [MAINNET.md](MAINNET.md) covers the complete mainnet workspace and accounting workflow.

## Set up a complete native testnet operator workspace

Use the complete public sprint checkout on Linux or another POSIX operator host,
with Node 22+ and Python 3.11+. Run all commands in this guide from the checkout
root. Install the pinned official SDK dependencies in the buyer directory:

```sh
npm --prefix stellar/scf-starforge-20261009/sf88-operator-buyer-cli \
  ci --ignore-scripts --no-audit --no-fund
```

Use the saved discovery `--prepare` command below to create a review config for
the actual chosen seller. Then initialize a **new** private workspace, supplying
the operator identity, service identity and existing testnet payer address:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs --init-workspace \
  --config /private/weather-review.json --dir /private/weather-operator \
  --actor owner-operator --service chosen-weather-seller \
  --payer ACTUAL_EXISTING_TESTNET_PUBLIC_ADDRESS --python /usr/bin/python3
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review-workspace --dir /private/weather-operator
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --diagnose-workspace --dir /private/weather-operator
```

Replace the payer placeholder with the actual existing public `G...` address.
The parent directory must already exist. Initialization refuses an existing
workspace and a source config that already contains operator, signer or ledger
settings; it cannot replace an established spend journal.

The initializer creates a private `0700` workspace and evidence directory,
`0600` operator config, policy, key file and lazy signer module, and an empty
SQLite WAL ledger through the original SF36 `Governor`. It writes the completion
manifest last. The selected testnet asset, recipient, payer and maximum amount
are carried into the signer. Changing the config to incompatible terms is
rejected before any new reservation. Lowering the operation cap remains allowed.

The default total and daily limits equal the review config's `maxAtomic`;
that is enough for one operation at the maximum price. To authorize a larger
operator workspace budget, supply explicit `--total-atomic` and `--daily-atomic`
base-unit strings. The original SF36 signed 64-bit ceiling applies. Daily
limits cannot exceed the total, and both must cover the per-operation cap.

If all three existing `SF36_CONSENT_KEY_B64`, `SF36_AUDIT_KEY_B64` and
`SF36_OPERATOR_KEY_B64` variables are present, initialization reuses them.
If none are present, it creates the local HMAC keys needed for this new empty
ledger. A partial key set is rejected. These keys live in the private
`operator-keys.json`; they are never printed or placed in the public repository.
They are budget-journal keys, not a Stellar wallet key.

Make the existing payer's testnet key available through the operator's existing
credential setup in `STELLAR_SECRET`, or choose the variable name with
`--secret-env` during initialization. The workspace stores only that variable's
name. It neither generates nor writes a wallet key. Execute from the original
operator terminal:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --execute-workspace --dir /private/weather-operator
```

For an existing wallet or hardware provider, use
`--signer-provider /absolute/operator/wallet.mjs` in the initializer instead of
`--secret-env`. The trusted module exports
`createSigner({network, payer, rpcUrl})` and returns the official SEP-43 signer.
Initialization and diagnostics check its file without importing it. The
generated private module loads it only inside the original approved signing
callback. An optional `--rpc https://operator-rpc.example` selects a testnet RPC;
the default is the official testnet endpoint. RPC credentials, query parameters
and fragments are not accepted in the URL.

`--diagnose-workspace` checks the existing workspace, pinned SDK versions,
provider file or environment-variable presence, and access to the controlling
operator terminal at `/dev/tty`. It never reads the SF36 key
file, opens a wallet, signs, reserves funds or calls RPC. `READY_TO_EXECUTE`
means the setup requirements are present; actual wallet access, payer identity
and network availability are checked during approved execution. An empty or
invalid wallet variable is still rejected at that point. Existing environment
workspaces keep the same generated signer and operator ledger.

An allocated terminal stream can report `isTTY` while `/dev/tty` is unavailable.
The original approval helper uses `/dev/tty`, so both direct execution and the
inbox check that device before preparing output or recording a permanent
attempt. `OPERATOR_CONTROLLING_TERMINAL_REQUIRED` leaves an unattempted inbox
item queued. On a Linux host with util-linux `script`, run the same command in a
controlling terminal:

```sh
script -q -e -c 'node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs --execute-workspace --dir /private/weather-operator' /dev/null
```

Keep the existing command, workspace, and intent. The wrapper provides the
terminal for the original interactive review; it grants no approval. For an
inbox operation, wrap that operation's existing `queue-cli.mjs execute`
command. An intent with a recorded attempt remains recorded and is never
reset by this setup check.

Execution checks the configured provider file or wallet-variable presence, and
loads the pinned local SDK before creating an inbox attempt or reserving budget.
It then supplies only the three SF36 keys to the original approval
bridge without changing the parent environment. The lazy signer reads the
existing wallet key only after the native terminal approval and durable budget
reservation. It checks the payer and chosen terms, then uses the official
`@x402/core` and `@x402/stellar` implementation through the shared
[SF103 native payload engine](../sf103-native-buyer-signer/README.md) to simulate and sign the actual
authorization. SF31 performs the one paid HTTP retry and SF82 records its
original result. Adapter failures retain their actual pre-retry classification.
Neither initialization nor review makes a network request,
reads a wallet key, reserves funds or signs an authorization.

Keep the workspace and the source checkout at their configured absolute paths.
The workspace's ledger, local key file and recorded checkout outcomes belong
together. After an interrupted or uncertain execution, reconcile the existing
operation; initializing a different workspace is not a recovery action.
For adapter interfaces and SDK source references, see
[NATIVE_SIGNER.md](NATIVE_SIGNER.md).

## Use an existing operator configuration

From the complete public sprint checkout, using Node 22+ and Python 3.11+:

1. Put an owner-reviewed config JSON in a private local directory. It contains only chosen public quote terms and paths to trusted operator files and the existing signer module. Keep the SF36 secret keys outside the config in the operator environment.
2. Review the method, resource URL, base-unit spend cap and body digest without network via: node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs --review --config /private/pilot.json
3. Optionally use --discover --config /private/pilot.json to read the ORIGINAL catalog without payment or signing. Save the result and use --prepare below to select its actual source terms without retyping them. Discovery is not approval.
4. Execute with --execute --config /private/pilot.json from the trusted terminal. Original SF81 invokes SF62 terminal review and SF36 durable fresh reservation before the owner-provisioned signer. SF31 makes one unsigned request and at most one signed retry. Original SF82 persists one create-only evidence file and checks RPC for the approved Stellar network when qualified.

The evidence directory must already exist with POSIX permissions 0700. Original SF36 policy and ledger paths are absolute. After any unknown payment outcome, reconcile the original SF36 ledger and chain before another attempt, never replace a stable operation ID to force retry.

## Config shape (all values shown are illustrative, nonpayable placeholders)

~~~json
{
  "catalog": {"origin": "https://trusted-catalog.example", "query": "forecast", "limit": 10},
  "operation": {
    "intentId": "consenting-merchant-pilot-001",
    "url": "https://original-consenting-seller.example/api/forecast",
    "method": "GET",
    "expect": {
      "scheme": "exact", "network": "stellar:testnet",
      "asset": "ACTUAL_STELLAR_CONTRACT_ID",
      "payTo": "ACTUAL_STELLAR_PAYMENT_RECIPIENT",
      "maxAtomic": "1000"
    }
  },
  "operator": {
    "python": "/usr/bin/python3",
    "actor": "owner-verified-operator",
    "service": "owner-verified-seller",
    "policy": "/private/sf36/policy.json",
    "ledger": "/private/sf36/reservations.sqlite"
  },
  "signerModule": "/private/operator/official-x402-stellar-signer.mjs",
  "evidenceDir": "/private/stellar-evidence",
  "trustedPayer": "ACTUAL_OPERATOR_VERIFIED_STELLAR_ACCOUNT",
  "captureBody": true
}
~~~

The trusted signer module exports an async sign({intent,challenge,accepted}) function. The native workspace generates this module using the official SDK adapter; an existing externally managed signer can supply the same interface. The shared [SF103 native signer adapter](../sf103-native-buyer-signer/README.md) also connects an existing configured buyer to an account or trusted provider. No private key or wallet is bundled. For POST, PUT or PATCH, an optional absolute operation.bodyFile supplies the exact request bytes (max 16 MiB, subject to the seller's smaller configured limit). `--prepare --body-file` pins its length and SHA-256 before review; changed pinned bytes are rejected before execution or inbox staging. Use `--form-file` with `--form-out` to create a private multipart body once from local fields and files. The boundary and selected bytes are retained through unsigned and paid attempts. See the [merchant file input workflow](../sf61-openapi-seller-import/workspace/FILE_INPUT.md) for the manifest format and exact handoff.

### Ordinary request headers

`operation.headers` carries `Content-Type`, `Accept` and ordinary API values such
as `accept-language` or `x-region`. Native review displays the exact values sent
by the original SF31 request. Names are case insensitive: known existing fields
retain `Content-Type`, `Accept` and `X-SF98-Order-ID`; other names are lowercase.
Duplicate names, surrounding value whitespace and invalid HTTP characters are
refused before review or execution. The aggregate ordinary header limit is 8 KiB.

For saved-offer preparation, use `--headers-file /private/request.headers.json`.
This is a same-owner private regular JSON file at a canonical absolute path,
up to 16 KiB, containing an object of header names and string values. The CLI
copies validated values into the prepared config; later edits to the header
file cannot change that config, its saved workspace or an already queued job.
`--content-type` still works and may accompany the file when both values agree.

Authentication/API keys, cookies, HTTP framing, forwarded/proxy/security and
payment headers are handled by their original components and cannot be supplied
here. The merchant ticket belongs in `ticketFile`, and its selected header cannot
collide with an ordinary header. SF98's saved `X-SF98-Order-ID` remains checked
against `orderReference` and the exact `sf98_order` URL. See
[the complete POST ticket handoff](OPERATION_TICKETS.md) for language/region
requests, private files, original workspace and durable inbox commands.

Review makes no external calls. Discover returns original source catalog listings but cannot authorize payment. Execute emits a brief status and the original SF52 aggregate report plus local SF82 evidence file path. Seller-reported settlement, observed HTTP delivery, and independently verified transfer remain distinct and retain the approved network. Publication does not execute the buyer or start a hosted workflow.

Source lineage: SF31 buyer, SF81 one operator-approved operation, SF82 independent evidence, SF36 existing budget journal.

## Managed-cloud HTTPS gateway for unsigned catalog discovery

Some managed Linux runtimes resolve genuine public catalog hosts through a reserved
`198.18.0.0/15` HTTPS egress overlay. The default original SF31 public-address
transport refuses that DNS answer before any request (`NONPUBLIC_DNS_ANSWER`).
This is not evidence of an empty Vellar/Periplo catalog or a failed payment.

**Operator opt-in for `--discover` only:** use the CURRENT OS resolver from the
trusted runner (`node:dns/promises.lookup(host, {all:true, verbatim:true})`) on
the actual public HTTPS catalog hostname. If and only if it returns exactly
one IPv4 address and the operator knows this is that runner's 198.18/15 gateway,
add `sandboxGatewayIPv4` under the original `catalog` object. For example:

```json
{
  "catalog": {
    "origin": "https://vellar-facilitator-testnet-production.up.railway.app",
    "limit": 20,
    "sandboxGatewayIPv4": "198.18.126.99"
  }
}
```

**The numeric address is illustrative from an earlier VM, not a universal or
permanent gateway.** Do not reuse it unless that host's *fresh* OS DNS gives
the same sole address on the particular managed machine. A changed address,
mixed DNS answers, arbitrary private IP, direct IP-literal URL, bad origin,
URL credentials, redirects, or TLS identity mismatch all fail closed.
The transport pins the exact original DNS address and verifies original
hostname/port443/certificate/SNI. Its default DNS rules do not change.

Only the original unsigned `--discover` path passes this opt-in. `--review`
and `--prepare` have no network or signer. `--execute` continues to use the
unchanged original SF81/SF31 public-only signed/payment transport: the catalog
gateway cannot be used to authorize, sign, settle, retry or bypass spend
approval. Never enable this mode to defeat actual private-resource DNS.

Local source check, no network or wallet:
`node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/test/catalog-gateway.test.mjs`.
For live merchant acceptance, run the original real catalog URL through
`--discover` on the managed operator runner and record its actual returned
HTTP response/classification, source and original listing count. A catalog
listing is still not a customer or a payment.

## Prepare a review config from saved discovery

Start with a catalog-only config containing the `catalog` property shown above;
no operator, signer or operation is needed for discovery. Save its original output:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --discover --config /private/catalog-config.json > /private/catalog.json
```

Inspect `originalListings` and each row's `accepts` array. Select both **zero-based**
indices explicitly, supply a stable intent ID for the intended operation, and
enter the concrete URL including required query values. For a weather listing
at `/weather` whose advertised method is GET:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --prepare --discovery /private/catalog.json --row 0 --accept 0 \
  --intent-id weather-lagos-001 --url 'https://chosen-seller.example/weather?city=Lagos' \
  --method GET --out /private/weather-review.json
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review --config /private/weather-review.json
```

Replace the example URL with the chosen listing's actual origin/path. Preparation
allows explicit query values; it refuses a different origin/path, unresolved path
templates or a method contradicting the listing. It does not fill query values or
request bodies from seller examples. For a body-bearing method, add your own
absolute `operation.bodyFile` and allowed headers before review.

The command also accepts an unchanged native saved `resources` or `items` catalog
envelope, or an original Atlas `scf61-observed-native-page-v1` export. Atlas exports
retain their native row/option indices; older files without a source URL record
`source:null`. The existing Atlas UI also offers the same preparation builder via
**Review this offer**, with a concrete request form and source/config downloads.
Both paths call exported `prepareReview(rawBytes, selection)` in `prepare.mjs`;
only the original CLI wrapper writes an exclusive, fsynced `0600` file. The pure
builder performs no network or filesystem access and never loads a signer.
Input is limited to 1 MiB; the resulting config must fit the existing
64 KiB config limit. The destination's trusted parent directory must already exist.
The config is created with mode `0600` and never overwrites an existing path.

The selected option supplies the original scheme, network, asset, recipient,
atomic amount, timeout and supported payment flow to `operation.expect`. The
complete original listing, including every option, unknown provider fields and
Bazaar input/schema, is retained under `preparedFrom`, with the input file's
SHA-256 and both selected indices. `--review` displays this saved source context
alongside the concrete operation. A raw catalog without a source URL records
`source:null`; no observation time or provider identity is invented.

Preparation makes no network request, loads no signer, copies no operator paths
from discovery, and generates no credentials or payment approval. The result has
`captureBody:false`; it is ready for offline review, not execution. Add your own
trusted operator, signer and evidence settings only after review. The saved listing
may be stale or edited: its hash identifies the file, not verified seller terms.
Execution still obtains a fresh original SF31 challenge, requires a unique matching
option within the displayed caps, and asks the original operator to approve its
full current terms. `preparedFrom` is review context, not an exact-option commitment
or a replacement for that approval; no unknown provider field is silently turned
into signer or payment authority.

## Connect the official native Stellar signer

After reviewing the saved selection, complete the configuration's real operator
paths, evidence directory, public `trustedPayer` and any response destination.
Install the pinned optional native packages listed in the [SF103 guide](../sf103-native-buyer-signer/README.md),
then use its setup command with the existing trusted signer environment:

```sh
node stellar/scf-starforge-20261009/sf103-native-buyer-signer/setup.mjs prepare \
  --buyer-config /private/weather-review.json \
  --out /private/weather-native --secret-env STELLAR_SECRET
node stellar/scf-starforge-20261009/sf103-native-buyer-signer/setup.mjs inspect \
  --config /private/weather-native/signer.json
export SF103_SIGNER_CONFIG=/private/weather-native/signer.json
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review --config /private/weather-native/buyer.json
```

The setup command preserves the original operation, request body, source
provenance, operator and response settings. It changes `signerModule` in a new
private buyer file and binds that file to the new signer configuration. The
source input is unchanged. An existing trusted provider module can replace
`--secret-env`; SF103 documents that interface and the optional `check-signer`
command. Use the generated buyer file for the existing `--execute` command;
the original terminal approval and reservation run before native signing.

## Save the returned dataset or other output

The optional response-file flow uses the original [SF31 writer](../sf31-buyer-client/SAVING_RESPONSES.md).
Set `captureBody` to `false` (or omit it), then use the same destination for review
and the independently authorized execution:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review --config /private/pilot.json --response-out /private/downloads/dataset.json
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --execute --config /private/pilot.json --response-out /private/downloads/dataset.json
```

Review prints the destination and limits with `prepared:false`; it creates no
output file, contacts no provider and loads no signer. Execution prepares a
create-only destination before the buyer call. The original writer requires an
existing trusted parent directory and hard-link support; its completed and
partial files use mode `0600`.

For a saved configuration with different byte/time limits, add this top-level
property instead of the flag:

```json
"responseFile": {
  "destination": "/private/downloads/dataset.json",
  "maxBytes": 67108864,
  "timeoutMs": 30000
}
```

The flag and `responseFile` configuration are mutually exclusive, so an explicit
destination is never silently overridden. Defaults are 64 MiB and 30 seconds.
`--response-out` is available for review and execution, not catalog discovery.
`captureBody:true` conflicts with response-file saving: SF82's optional cloned
body capture and the file writer must not consume the same response concurrently.
The original SF82 receipt, reservation and independent verification remain active.

Saving starts immediately when the original buyer returns. It runs alongside
SF82's independent verification, because the HTTP transport's body deadline does
not pause for RPC work. The writer consumes the response once and never makes a
second buyer call, changes an intent ID, signs, retries or releases payment budget.

The command's JSON keeps the original buyer status and outcome report and adds
`responseFile` separately: `SAVED` includes path, byte count, SHA-256 and content
type; `FAILED` includes the local error and any retained nonempty `partialPath`;
`NOT_STARTED` means no returned response was handed to the writer. A successful
save does not prove settlement. An unsuccessful save does not undo a payment.

For finite SSE or NDJSON, add `"stream":{"format":"sse"}` or
`"stream":{"format":"ndjson"}` to the same `responseFile` configuration.
Optional `maxRecordBytes` and `maxRecords` bound framing and output counts.
Native stream transfers may use `timeoutMs` up to 300000. The existing review
shows these exact selected options before execution; the resulting file report
includes stream completion and the last complete record boundary. An interrupted
report also includes the retained bytes' digest for verified local recovery.
See the [original stream writer](../sf31-buyer-client/STREAMING.md) and
[Node application workflow](node/STREAMS.md).

Exit code `2` retains the original buyer/evidence error priority. Exit code `3`
indicates a file-save or file-cleanup problem when the buyer/evidence adapter did
not return an error. An evidence-recording failure still reports any returned
buyer status and available local-file outcome. Keep those results and reconcile
the original operation; neither error code authorizes another purchase.

## Interruptions and local cleanup

### Merchant HTTP deadline

Set top-level `"requestTimeoutMs":120000` in the original operator configuration
when a reviewed merchant operation needs a longer HTTP exchange. Allowed values
are integers from 1 to 300000 milliseconds. Offline review and the retained native
attempt summary show the effective value. A workspace retains the setting in its
same `operator.json`, and initialization and diagnostics also expose it.

The deadline includes DNS, TLS, waiting for headers and consuming the response
body. It applies to each original merchant request through the existing public
HTTPS transport, including an explicitly configured proxy. Ordinary requests
default to 30000 milliseconds. When finite `responseFile.stream` capture is
selected and the request deadline is omitted, the capture's selected timeout is
also used for the HTTP exchange. An explicit request value takes precedence.

`responseFile.timeoutMs` separately limits the writer after the response returns.
Allow time for provider generation and delivery in the request deadline; the
earlier applicable deadline ends a transfer. The existing signer/RPC deadlines
and Node subprocess deadline retain their own meanings. In Node, pass
`{requestTimeoutMs:120000}` to `fromConfig`, `fromRequest`, `prepare`, `call`, or
handoff import, or retain it in the existing operator profile.

### Cancellation

SIGINT/SIGTERM now request cancellation through the original buyer and response writer. The command awaits local cleanup before exiting 130/143. A failed evidence pipeline also cancels an incomplete download immediately; an already published output remains saved. A rejected non-2xx response body is closed when the writer cannot consume it. These paths never make an additional buyer call.

The output reservation is prepared before loading the trusted signer module. If setup fails, the CLI reports any response-writer partial path or cleanup warnings along with the original error code. Completed-file cleanup warnings retain exit code 3. Nonempty partial files remain private and incomplete at the reported path; inspect that path and the original evidence/reservation before considering any further operation.

If evidence processing fails after a native buyer error, the summary now retains that original error's code, its known payment-sent state (or null when unknown), and the bounded original reservation metadata. `interrupted` and `retry:NO_AUTOMATIC_RETRY` accompany the original buyer status, independently produced outcome report and separate `responseFile.status`. Local file output is not payment proof, and a failed save does not undo an operation.

This increment retains the original SF88 launcher (PR #767), response-output integration (PR #795), and unchanged SF31 writer (PR #774), SF81 approval bridge and SF82 evidence adapter.

Focused local composition check (Node 22.3+ with module mocks): `node --experimental-test-module-mocks --test stellar/scf-starforge-20261009/sf88-operator-buyer-cli/test/response-delivery.test.mjs`. It uses original SF31 transport/writer and SF82 evidence with a substituted privileged SF81 constructor and local Response streams; it does not execute terminal approval, a signer, network or payment.
