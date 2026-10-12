# Complete NocoDB receiving with dedicated Stellar testnet payments

This optional continuation runs the original NocoDB source-to-customer receiving
workflow and then purchases the complete reviewed film edition through the
original native Stellar payment path. It uses the same provider operation,
retained film and actor captures, source workspaces, publisher target, SF82
release store and customer package.

Run [testnet-consumer.mjs](receiving/testnet-consumer.mjs) when the selected host
has the returned complete captures and its native runtime. The driver creates
two dedicated testnet accounts, retains their private keys on that host before
funding, and uses the free testnet faucet for those same accounts. It then runs
the unchanged [core receiving driver](receiving/native-consumer.mjs), stages a
reviewed native facilitator release, and receives all 1,000 film rows in four
paid pages. Every page uses the original SF81 approval channel, SF36 Governor
reservation, SF103 signer, SF88 execution and SF43 transfer observation.

A successful result includes the actual request IDs, transaction hashes,
transfer events, finalized native accounting, delivered page hashes and
complete SF100 data room. This source does not itself report that an execution
has completed. Only the selected worker's actual `result.json` and original
records establish the receiving result.

## Select the same operation and complete source

Use the host already carrying the NocoDB provider operation. Reuse the two
completed capture-backed source declarations and their returned hashes. The
expected dataset is the original Sakila film table with 1,000 records and actor
table with 200 records. Actual selected field IDs, aliases, types and source
order come from those retained declarations. The driver does not create
provider records or acquire the tables again.

The original distribution supplies the correct source and manifest layout:

| Input | Original maintained location |
| --- | --- |
| `sourceRoot` | `RUNTIME/package/source` |
| `sourceManifest.file` | `RUNTIME/package/manifest.json` |
| `sourceManifest.sha256` | SHA-256 of those exact manifest bytes |
| Native dependencies | `RUNTIME/node_modules`, an ancestor of the selected source |
| Core driver | `source/stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/receiving/native-consumer.mjs` |
| Testnet driver | The adjacent `testnet-consumer.mjs` |
| Private receiving state | A separate mode-0700 directory outside `package/source` |

The original manifest already lists repository-relative
`files[{path,gitBlob,sha256,bytes,mode}]`. Use it directly. Both drivers verify all
listed file hashes. The testnet driver also requires its original payment,
release, buyer, approval and evidence entry modules in that manifest. The full
distribution includes their static, dynamic, Python and browser assets.

Keep the selected source complete and immutable. A small folder containing
only the NocoDB adapter does not include the original native merchant and buyer
engines. Symlinks into another incomplete checkout can change Node's import
resolution even when the top-level file exists.

## Prepare the existing native runtime

The host needs a supported Node 24 runtime, POSIX Python 3 with SQLite and
`fcntl`, util-linux `flock`, OpenSSL, and the existing Playwright/Chromium
installation. The original native facilitator and seller availability use
`flock`. The original approval/accounting workers use Python's standard
library. Node's source-context JSON support preserves the provider number
tokens.

Use the maintained runtime installer from the selected source. For a new
private runtime, save this exact pin map as `native-pins.json`:

```json
{
  "@x402/core": "2.28.0",
  "@x402/stellar": "2.28.0",
  "@x402/extensions": "2.28.0",
  "@stellar/stellar-sdk": "16.3.0"
}
```

The actual maintained commands are:

```sh
node /source/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /srv/nocodb-receiving/runtime \
  --archive /srv/nocodb-receiving/starforge-merchant.tgz \
  --sha256 ACTUAL_ARCHIVE_SHA256 \
  --native --operator \
  --pins /srv/nocodb-receiving/native-pins.json

node /source/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /srv/nocodb-receiving/runtime

node /source/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /srv/nocodb-receiving/runtime --load --source
```

Use the original retained installer recovery if installation was interrupted.
It preserves the same archive, profile, lockfile and installation intent.
NocoDB's REST/capture source needs no separate NocoDB native feature group.

The exact payment pins above correspond to the original SF88 lockfile.
A distribution advertising optional peers does not establish that they are
installed. An unrelated runtime using SDK 16.3.1 is not the same selected
16.3.0 installation.

The facilitator and SF30 native factory import their packages from sibling
source components. Installing only inside `sf88-operator-buyer-cli/node_modules`
does not make those packages available to the siblings. `NODE_PATH` does not
repair ESM package resolution. The maintained installation places dependencies
at the common runtime ancestor.

If an existing authorized host needs only the four native payment packages,
the ordinary free npm installation can use that same common ancestor:

```sh
npm install --prefix /srv/nocodb-receiving/runtime \
  --ignore-scripts --no-audit --no-fund \
  @x402/core@2.28.0 @x402/stellar@2.28.0 \
  @x402/extensions@2.28.0 @stellar/stellar-sdk@16.3.0
```

This fallback is not a substitute for the original operator profile and its
other declared dependencies. Keep npm metadata and `node_modules` outside the
selected `package/source`. Use the existing browser paths; the receiving driver
does not install another browser or provision another machine.

## Save the core receiving template

Begin with the full input from [RECEIVING.md](RECEIVING.md). Keep its exact source
manifest, existing browser paths and two actual capture-backed declarations.
The testnet entry accepts it as a private template and retains a derived
`core-input.json`. It supplies only the dedicated testnet asset/recipient and
the owned output path; the actual source selection stays the same.

The template's merchant fields can be:

```json
{
  "origin": "https://merchant.nocodb.scf.test",
  "path": "/film",
  "payment": {
    "scheme": "exact",
    "network": "stellar:testnet",
    "amount": "10000",
    "maxTimeoutSeconds": 60
  },
  "nextAmount": "12000"
}
```

The wrapper derives the native XLM contract with the official SDK and supplies
the new recipient public address. Do not put a wallet key or shared Routescan
signer in this template. The original core's first and second film releases
retain the 10,000/12,000 atomic-unit amounts above. The later native release
uses the second release's 12,000-unit terms.

Use an owned `.test` hostname for this local receiving ingress. Its exact origin,
resource path, public asset, recipient and amount become the original seller
and buyer contract. No public DNS or domain registration is needed for this
explicit local CONNECT profile.

The template's `outputDirectory` is superseded by
`TESTNET_OUTPUT/core` in the retained derived input. The two original capture
paths, declaration/capture hashes, public columns, actual order column and
browser paths are not substituted.

Both the template and outer input must be regular mode-0600 files. Their
parent directories and output directory must be mode 0700, with canonical
absolute paths and no symlinked private storage.

## Save the explicit testnet input

```json
{
  "schema": "stellar-forge.nocodb-testnet-receiving-input.v1",
  "operationId": "original-nocodb-provider-operation",
  "consumerSha256": "SHA256_OF_THE_EXACT_TESTNET_CONSUMER",
  "receivingInput": {
    "file": "/srv/nocodb-receiving/private/receiving-template.json",
    "sha256": "SHA256_OF_THAT_EXACT_TEMPLATE"
  },
  "outputDirectory": "/srv/nocodb-receiving/private/native",
  "python": "/usr/bin/python3",
  "openssl": "/usr/bin/openssl",
  "authorization": {
    "purpose": "NOCODB_RECEIVING",
    "network": "stellar:testnet",
    "maxPages": 4,
    "maxTotalAtomic": "48000"
  }
}
```

Use the same operation ID in both files. Substitute real absolute executable
paths from the existing host. Compute the hashes from the actual files after
all source and input choices are final.

The explicit maximum must equal four times `merchant.nextAmount`. The driver
accepts only `stellar:testnet`, the native XLM contract derived by the official
SDK, two dedicated accounts, the exact reviewed recipient, and four pages.
The original Governor also enforces that same total and daily amount.
Native facilitator fees have a separate 50,000-stroop per-transaction ceiling
and are sponsored by the dedicated testnet merchant account. Payment principal
and transaction fees are not conflated.

This is a privileged receiving operation. Its explicit input authorizes its
trusted host to approve each original page after comparing the displayed
native request digest, URL, method, body presence, terms and current Governor
estimate. It does not expose a new approval endpoint to a web page or replace
the product's normal approval interface.

## Execute once on the existing provider host

```sh
node /srv/nocodb-receiving/runtime/package/source/stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/receiving/testnet-consumer.mjs \
  --input /srv/nocodb-receiving/private/testnet-input.json
```

Keep stdout, exit status and the complete private output with the original
operation. The public command enters an exclusive POSIX kernel lease before
generating accounts or starting either receiving phase. The lease is inherited
through the original core and paid worker and disappears when its actual
owning processes end. A parallel invocation cannot create a second funding
or purchase operation in that directory.

`--locked-input` and `--paid-input` are internal child entry points. They require
the inherited descriptor for that exact operation lease. Operators use the
public `--input` command.

### Dedicated account and TLS custody

The first phase generates one payer and one merchant/facilitator keypair with
the official Stellar SDK. It saves the complete private account file before
sending any free Friendbot request. Each account gets at most one automatic
funding dispatch. A missing response is resolved by reading that same account
from official testnet Horizon. The worker never rotates the account or silently
repeats its faucet dispatch.

Confirmed funding observations remain the original observations on restart.
The native facilitator performs its own current readiness checks before
accepting work. The signer ownership directory belongs only to this
operation's dedicated merchant key.

TLS follows the fleet's established host-ingress pattern. OpenSSL creates a
private receiving CA and a leaf certificate for the exact owned hostname.
Only this receiving worker and its children receive that CA as additional
trust. Existing additional CA certificates are preserved, and Node uses its
system trust as well. TLS verification remains enabled.

The loopback CONNECT proxy admits only the exact merchant hostname on port
443 and official `soroban-testnet.stellar.org:443`. Merchant traffic terminates
at the owned TLS ingress and streams into the original loopback SF82 seller.
RPC traffic tunnels to the actual official host; the original buyer verifies
its public certificate. It is not a general proxy.

The original SF31 fetch, payment request, signer, settlement and evidence
transport remain unchanged. The testnet driver provides host routing and
certificate custody around those original modules. It never installs a
certificate in the operating system or modifies a customer browser's trust.

The account secrets, CA key, generated original Governor keys and private
operator files stay in the selected worker's mode-0700 directory. Never send
that directory to Slack, a public repository or a customer.

## The original native sequence

| Stage | Executed behavior and retained authority |
| --- | --- |
| Original core | Runs the complete authoring, actor publication, two film editions, customer browser, retained export, rollback and MCP reopen from the exact core driver |
| Native facilitator | Starts the original facilitator against official testnet RPC with the dedicated signer, explicit asset/recipient allowlist, amount limit and fee ceiling |
| Retained release review | Uses original `reviewReleaseFacilitator` and `stageReleaseFacilitator` over `nocodb-b` in the same SF82 store |
| Native merchant | Selects and starts that reviewed derived release at the same original merchant port and dataset directory |
| Buyer handoff | Reads the real original offer metadata and prepares the exact snapshot-pinned SF88 buyer configuration |
| Original workspace | Initializes or reopens the original SF88 operator, generated SF103 signer and SF36 policy/ledger with the dedicated payer |
| Per-page approval | Uses the original SF81 broker, exact SF62 request digest, original accepted terms and current native budget estimate |
| Actual acquisition | Runs original `runDatasetSession` with its default original executor; four separate payments retrieve all 1,000 film rows |
| Chain observation | Consumes original checkout evidence and the actual SEP-41 transfer; a pending index can be re-observed through the original read-only SF43 verifier |
| Accounting | Calls original dataset accounting/finalization, then reopens and reads the saved original results |
| Data room | Uses original SF100 delivery for JSONL, CSV, review HTML and manifest; compares every delivered film value and verifies all output hashes |
| Reopen | Reopens the same original buyer session, ledger views and data room with zero additional purchase commands |
| Drain | Stops the original merchant, drains the native facilitator, closes approval and ingress, then records completion |

The buyer configuration retains the exact prepared original handoff. A recorded
local `requestTimeoutMs:120000` is the original supported transport timeout
setting; it does not change the accepted price or original request/approval
rules. The facilitator profile's capability read timeout remains the original
maximum of 30 seconds.

The two film publications represent two reviewed output orders over one real
provider observation. The paid session selects the second immutable snapshot.
Its full value comparison is tied to the original core's complete reviewed
dataset hash.

The original dataset response files are the acquired source of the data room.
The receiving driver does not synthesize or independently export a replacement
dataset. Original page caps are allocations; actual payment claims come from
matched transfers and finalized Governor entries.

## Resume the same retained work

Re-run the public command with the same exact input only after the previous
original host operation has ended. The kernel lease and original source stores
protect their respective work. The completed core leaves its seller stopped.
A fresh release console cannot take ownership of a previous process merely by
matching its port; an orphaned original seller must complete its retained native
lifecycle recovery before that same receiving operation launches again. Do not remove a lease file, alter the original
publisher database, reset the buyer ledger or replace a request ID to continue.

| Retained state | Continuation behavior |
| --- | --- |
| Account file exists, funding not dispatched | Reuses the same keypair and records the one funding intent before dispatch |
| Faucet response missing | Observes the same public account; no new account and no automatic second funding request |
| Funding already observed | Reuses that original funding observation |
| Original core incomplete | Uses its same private input, native request IDs, authoring stores, publisher and customer export recovery |
| Original core `PASS` | Reads and verifies that result without repeating the core workflow |
| Facilitator release staged | Reuses the saved original review and exact derived release |
| Original SF88 setup interrupted | Calls the original initializer with the same arguments and its native resume mode |
| Dataset has completed pages | Reuses the original page lineage and begins only its next unattempted page |
| Checkout reply/evidence interrupted | Invokes original read-only checkout recovery before reading the same dataset session again |
| Payment outcome unresolved | Retains the exact attempt, signer/transport records and ledger identity; no automatic replay |
| Complete dataset/data room | Reopens original files and preserves their hashes without another transfer |
| Final `PASS` retained | Verifies the recorded native result files and returns without another native operation |

The driver deliberately does not invoke `retryUnpaid`. That original command
requires its authenticated unsigned-attempt review and exact retained attempt
hash. A genuinely unresolved payment is handled with the product's original
reconciliation APIs and actual returned request identity, rather than an
automatic repurchase.

A later read-only SF43 transfer observation is saved separately and bound to
the immutable original checkout evidence hash. It never rewrites a completed
checkout record or claims a new buyer invocation. The original SF100 manifest
keeps its own payment classification; any later matched transfer is reported
with its original observation and ledger finalization.

SIGINT/SIGTERM abort new buyer admission through the original signal/channel
and drain the services this worker owns. An interrupted signed attempt remains
available for native reconciliation.

## Read and return the actual result

The outer `result.json` becomes `PASS` only when the original core, actual
testnet purchase, complete data room, reopen and cleanup have completed.
`payment-result.json` retains the detailed original native references.
`payment-progress.json` and the two private logs retain concrete incomplete
states.

Useful internal handoff fields are:

- Exact executed source commit, archive and manifest hashes, both driver hashes,
  input hash and Node version.
- Original provider declaration and capture hashes, 1,000/200 row counts, source
  versions, publisher runs and snapshot IDs from the core result.
- Dedicated public payer/recipient, testnet asset, exact per-page amount,
  transaction/ledger/event identities and original approved request IDs.
- Original evidence and response hashes for each page, native finalized
  accounting and actual total atomic units.
- Complete received dataset value hash, the four SF100 output hashes and
  original data room source binding.
- Original customer package identity and actual browser screenshots from the
  core workflow.
- Actual exit status, successful drain, or the precise original native error
  that still needs resolution.

A 402 response, prepared buyer configuration, funded account, facilitator
readiness or seller-reported receipt alone does not satisfy this command's
completion checks. The returned native evidence distinguishes those states
from actual transfer and complete data delivery.

## Primary and original references

- [Core receiving workflow](RECEIVING.md)
- [NocoDB source workspace](WORKSPACE.md), [Applications](APPLICATIONS.md) and
  [managed deployment](DEPLOYMENT.md)
- [Original native facilitator](../../native-facilitator/README.md)
- [Original retained facilitator review](../../sf82-seller-pilot/FACILITATORS.md)
- [Original SF88 operator and dataset session](../../sf88-operator-buyer-cli/README.md)
- [Original SF81 approval bridge](../../sf81-buyer-operator-bridge/README.md)
- [Original SF43 transfer verification](../../sf43-agent-commerce/verify.mjs)
- [Official Stellar token quickstart and Friendbot setup](https://developers.stellar.org/docs/tokens/quickstart)
- [Official Stellar transaction simulation and native asset contract](https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/transaction-simulation)

The free testnet account and transaction activity is development receiving.
No mainnet, customer account, paid service or real-money transfer is part of
this operation.
