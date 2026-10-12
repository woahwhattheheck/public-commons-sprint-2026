# Browser wallet for the original Stellar buyer

Connect Freighter to an existing SF88 operator workspace, review the actual
Stellar transfer in a local browser, and return its verified authorization to
the original SF103/x402 buyer.

The product includes a private workspace, the official locally served Freighter
API, an industrial operator screen, a native SEP-43 provider, retained request
history, crash recovery, and an execution command that reuses the operator's
existing accounting keys and ledger.

## Runtime and installation

Use Node.js 20 or later on the original POSIX operator machine, its original
SF88 Python runtime and operator workspace, the maintained x402 core/stellar
2.28.0 payment engine, and the maintained Stellar SDK satisfying **^16.3.0**.
The browser needs the Freighter extension. Its companion Node package,
**@stellar/freighter-api 6.0.1**, must be available in the same dependency tree
as the Starforge source.

The installed command is **starforge browser-wallet**. From a source checkout,
run the adjacent **cli.mjs** with the same arguments.

The optional distribution feature is **freighter-wallet**. Include it in a
maintained runtime profile alongside the native dependencies. For an existing
Node application that manages its own dependencies:

~~~sh
npm install --save-exact @stellar/freighter-api@6.0.1
starforge doctor --native --feature freighter-wallet
~~~

The service resolves that official package and serves its local
**build/index.min.js**. The exact version and SHA-256 are retained in the
private launch record. The page uses the package's **freighterApi** UMD
interface.

## Prepare an operation

Start with the merchant's existing captured challenge and original SF88 reviewed
operation. If that review does not yet have an operator workspace, initialize
one through the original buyer:

~~~sh
starforge buyer --init-workspace \
  --config /private/merchant/review.json \
  --dir /private/merchant/operator \
  --actor operator-name --service merchant-name \
  --payer G_EXISTING_FREIGHTER_PUBLIC_ADDRESS \
  --python /absolute/path/to/python3
~~~

Use the actual public payer address. Initialization retains the original
operator policy, accounting keys, signer configuration, evidence directory and
reservation ledger. The browser wallet supplies authorization at execution.

Create a separate browser wallet below an operator-owned directory with mode
0700. Supply the initialized **operator.json**, containing the existing body,
headers, recipient, spending cap, policy and ledger:

~~~sh
starforge browser-wallet prepare \
  --buyer-config /private/merchant/operator/operator.json \
  --out /private/merchant/wallet
~~~

For public-network operations, add **--rpc https://your-rpc.example** using the
selected HTTPS endpoint. Testnet defaults to the original SF103 testnet RPC.
An explicit endpoint also supplies the original buyer's settlement evidence.

Preparation creates:

| File | Purpose |
| --- | --- |
| wallet.json | Wallet identity, full operation, body pin and configuration hashes |
| provider.mjs | Private SEP-43 provider bound to this directory |
| native/buyer.json | Original operation with the SF103 signer module selected |
| native/signer.json | Original SF103 configuration using the local provider |

Execution compares the complete source operator configuration with its retained
hash and requires the derived configuration to differ only in **signerModule**.
The original configuration remains at its existing path. To relocate a wallet,
prepare a new binding from that original operator workspace.

## Connect and execute

Keep the local service running in one terminal:

~~~sh
starforge browser-wallet serve --workspace /private/merchant/wallet
~~~

Open its printed private **http://127.0.0.1:PORT/#session=...** URL in the browser
with Freighter. The page removes the capability fragment from the visible URL
and keeps the session within that browser origin.

Review the operation, network, payer, asset, recipient and maximum amount.
Select that account and network in Freighter and choose **Connect Freighter**.
Keep the service and browser open.

Run the original operation from another terminal:

~~~sh
starforge browser-wallet execute \
  --workspace /private/merchant/wallet \
  --operator-workspace /private/merchant/operator
~~~

This checks the original workspace and current connection, then starts a fresh
process for the original buyer. The existing terminal approval, SF81
reservation, SF36 keys, ledger, transport, response-file handling and settlement
evidence remain the execution path.

After approval, the native x402 SDK builds and simulates its Stellar transfer.
The browser displays the amount, recipient, asset, nonce, signature-expiration
ledger and payload digest from the actual native authorization preimage.
Choose **Sign in Freighter**, review the extension prompt, and approve it.

The service verifies the returned Ed25519 signature before the buyer receives
it. Follow the buyer terminal and its original evidence and response files for
payment and delivery status.

**Reject request** ends a pending authorization. Disconnecting during signing
ends its wallet session. Cancelling the buyer interrupts that same retained
request and propagates cancellation through the original buyer before its paid
request can proceed.

## Inspect, close and reopen

~~~sh
starforge browser-wallet inspect --workspace /private/merchant/wallet
~~~

Inspection shows the operation, connection, current instance and retained
request counts. The private **wallet-state.json** retains each native preimage,
digest, exact request identity, transitions and verified result. Browser state
views omit the signature and raw preimage; the provider retrieves the exact
result belonging to its request.

Normal shutdown closes the listener and ends active requests. Restart
**serve** and open its new private URL to reconnect. Completed signatures remain
available for the exact existing request. Interrupted requests remain terminal.

For a process killed before it released its lease, inspect the original
instance and reconcile that exact dead process:

~~~sh
starforge browser-wallet recover-lock \
  --workspace /private/merchant/wallet \
  --instance ORIGINAL_INSTANCE_ID
starforge browser-wallet serve --workspace /private/merchant/wallet
~~~

Recovery validates the wallet and expected instance and checks that the PID
has ended. It can also reconcile a matching recovery guard left by a dead
recovery process.

An initial file-write failure removes only its own newly created inode. A full
disk cannot keep the listener running after shutdown. Restore space and reopen
the same original directory if the final retained-state write failed.

The default local authorization deadline is two minutes. Preparation accepts
**--request-lifetime-ms** between 15000 and 600000. The native signature's
expiration ledger and merchant timeout retain their original meanings; the
screen displays the local deadline and native ledger separately.

## Native interface

The generated provider supplies the existing SEP-43 contract:

~~~js
export const createSigner = ({ network, payer }) =>
  createBrowserSigner({ directory, network, payer });

// Returned signer:
{
  address: payer,
  signAuthEntry(entryXdr, { address, networkPassphrase })
}

// Native result:
{ signedAuthEntry: base64Ed25519Signature, signerAddress: payer }
~~~

The official SDK supplies a base64 **HashIdPreimage for Soroban authorization**.
The returned signature contains 64 bytes and signs the SHA-256 of that preimage.
The native SDK assembles the payment transaction.

The verifier requires the operation's network hash, classic G-account payer,
contract asset, recipient, positive amount within the spending cap and one
standard transfer invocation. It requires three correctly typed arguments and
no child invocations, matching the maintained x402 exact Stellar buyer.

The page checks the selected account and network before claiming, before
opening Freighter, and after its response. The server independently validates
the exact claim generation and signature. The provider checks the preimage and
result again before handing them to the native adapter.

The original SF103 adapter binds the approved HTTP operation, body, accepted
offer, timeout, payment flow and fee sponsorship. This wallet composes with
that adapter and with the existing terminal approval or its separately
maintained structured approval interface.

Package exports, with adjacent TypeScript declarations:

- **@tokenjunkielabs/starforge-merchant/buyer/browser-wallet**: preparation, inspection, provider and
  original execution.
- **@tokenjunkielabs/starforge-merchant/buyer/browser-wallet/server**: local service and explicit
  recovery.

Relative source imports expose the same APIs. Optional server verifier, vendor
and inspectBound parameters are trusted embedding seams; HTTP requests cannot
select them.

## Local lifecycle

The service binds only 127.0.0.1, requires the exact host and issues separate
fresh browser and provider capabilities. Browser mutations require the same
origin. Provider requests reject a browser Origin header.

Private files use operator ownership and private modes. The process lease is
acquired before the retained store opens. Writes are serial and atomic. Each
request ID binds wallet identity, derived buyer hash, network, payer and the
exact native preimage.

The provider enqueues once and reconciles an uncertain POST by reading that
same ID. Claim revisions keep multiple pages on one signing session. Completed,
rejected, expired and interrupted requests stay terminal. Cancellation is bound
before native simulation, including a buyer cancelled before the wallet call.

Keep the launch record and private URL with the operator workspace.

## Original and upstream contracts

- [Original SF103 adapter](../adapter.mjs) and
  [configuration](../operator.mjs).
- [Original SF88 execution](../../sf88-operator-buyer-cli/execute.mjs) and
  [operator workspace](../../sf88-operator-buyer-cli/workspace.mjs).
- [Freighter API source](https://github.com/stellar/freighter/tree/master/%40stellar/freighter-api),
  package 6.0.1, signing, connection, network and UMD interfaces.
- [Stellar SDK signer](https://github.com/stellar/js-stellar-sdk/blob/v16.3.0/src/contract/signer.ts),
  the native authorization-preimage signing contract.
- [SEP-43](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md).
- [Official x402 Stellar client](https://github.com/coinbase/x402/tree/7f2b2f1f77fa5317615735e3378a6fad41cccb4e/typescript/packages/mechanisms/stellar/src).
