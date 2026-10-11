# Native Stellar signer for the SF88 buyer

`native-signer.mjs` supplies the workspace signer callback used by the original SF88 operator buyer. It retains the independent workspace policy and delegates payload creation to the shared [SF103 adapter](../sf103-native-buyer-signer/adapter.mjs), supplying the locally installed, version-checked x402 SDK. SF81 obtains terminal approval and reserves the budget; SF31 sends the initial request and its one paid retry; SF82 records the result.

## Install the original dependencies

From the repository root, install the pinned packages in the buyer directory:

```sh
npm --prefix stellar/scf-starforge-20261009/sf88-operator-buyer-cli \
  ci --ignore-scripts --no-audit --no-fund
```

Node 22+ is required. The lockfile pins `@x402/core` 2.28.0, `@x402/stellar` 2.28.0 and `@stellar/stellar-sdk` 16.3.0, retrieved and installed in the cloud development workspace on October 11, 2026. No dependency installation script or repository test suite is needed.

## Generated private signer module

The operator workspace initializer generates a private module with the chosen network, asset contract, recipient, independent atomic cap and payer address. The operator supplies an existing testnet key through the named local environment variable. A module can follow this pattern; substitute the actual approved public values when generating it:

```js
import { createEnvironmentStellarSigner, validateNativeSignerInput }
  from '/absolute/checkout/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/native-signer.mjs';

const configuration = Object.freeze({
  network: 'stellar:testnet',
  asset: 'ACTUAL_TOKEN_CONTRACT',
  payTo: 'ACTUAL_RECIPIENT',
  maxAtomic: 'ACTUAL_APPROVED_ATOMIC_CAP',
  expectedPayer: 'ACTUAL_PAYER_PUBLIC_ADDRESS',
  secretEnv: 'STELLAR_SECRET',
});
let adapter;
export async function sign(payload) {
  validateNativeSignerInput(payload, configuration);
  adapter ??= await createEnvironmentStellarSigner(configuration);
  return adapter.sign(payload);
}
```

Keep construction inside `sign`: importing the generated module and running SF88 review then reads no key, contacts no provider and signs nothing. `createEnvironmentStellarSigner` reads the configured environment variable and derives an official SDK signer. Its public address must equal `expectedPayer` before a sign callback is returned.

Workspace execution first calls `checkNativeSignerPrerequisites` to inspect the configured provider file or wallet-variable presence and import the local SDK. It does not import the provider, read the key's value or call RPC. Missing local setup therefore leaves a queued request unattempted and the spend ledger unchanged. This check is not performed during initialization or offline review.

An operator using an existing external or hardware signer can call `createOfficialStellarSigner({ ...configuration, signer })` instead. The signer must implement the official `ClientStellarSigner` interface: `address` and `signAuthEntry`. This adapter does not create a wallet or replace that signer.

## Integrate an existing wallet provider

The workspace initializer accepts `--signer-provider /absolute/wallet.mjs` as an
alternative to `--secret-env`. The module must be a regular file, not a symlink
or group/world writable file. It exports:

```js
export async function createSigner({ network, payer, rpcUrl }) {
  // Connect your existing trusted SEP-43 implementation here.
  return existingWalletSigner;
}
```

The returned public `address` must match the workspace's configured payer.
`signAuthEntry` implements the original SDK contract; it must not submit a
transaction itself. The module is trusted operator code, and its factory may
have device or network setup of its own. Workspace initialization, review and
`--diagnose-workspace` never import this provider. Approved execution invokes
`createProviderStellarSigner` lazily through the generated module.

An optional `--rpc` supplies an HTTPS testnet RPC URL without credentials,
query parameters or fragments. The default remains
`https://soroban-testnet.stellar.org`. Diagnostics show only its origin.

## Diagnose the same workspace

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --diagnose-workspace --dir /private/weather-operator
```

This validates the original workspace and installed `@x402/core` and
`@x402/stellar` versions, then checks either provider metadata or whether the
named wallet environment variable exists. It does not read the variable value
or the private SF36 key file. `PRESENT_NOT_IMPORTED` and `PRESENT_NOT_LOADED`
describe availability, not wallet validation. `SETUP_REQUIRED` exits with code
1; the reported error identifies the missing dependency or source. A ready
diagnostic does not assert successful RPC access or signer initialization.

## Signing behavior

The adapter permits the configured `stellar:testnet` exact scheme only. It checks the complete accepted requirement against the original challenge and SF31 approved intent, including resource identity, fee sponsorship, atomic amount, asset, recipient and timeout. The operator cap and the intent cap are both enforced. The challenge must contain exactly one copy of the selected option.

The shared SF103 engine configures the original `x402Client` with `ExactStellarScheme`, the exact testnet registration, an exact-option selector and the approved asset-specific atomic spend control. It passes the original challenge to `createPaymentPayload`. The SDK performs Stellar simulation and authorization signing when the operator executes; the adapter returns its unchanged canonical envelope. The same SF88 signer instance refuses a second signing attempt for the same intent ID, including after failure. Separate approved intents continue to use the original durable SF36 budget and reservations. No payment-aware fetch wrapper or additional merchant request is introduced.

`SIGNER_*` errors identify invalid local configuration, provider initialization or quote drift. `OFFICIAL_STELLAR_SDK_UNAVAILABLE` means the dependencies cannot be imported from the source module. `OFFICIAL_STELLAR_SDK_VERSION_MISMATCH` reports a different installed version; `OFFICIAL_STELLAR_SDK_INCOMPATIBLE` means the installed API lacks the required exports. The shared engine's `NATIVE_PAYMENT_CREATION_FAILED` identifies simulation/signing failure without placing private account material or raw transaction data in the CLI error. Preserve the original SF81 reservation after any failure; use the existing reconciliation path before another operation.

## Original source used

- [Stellar's native CLI example](https://github.com/stellar/x402-stellar/blob/main/examples/client-cli/src/index.ts), observed Git blob `171e5e5a31c5e43e30cb44a561670c1f364ee319`.
- [x402 core client](https://github.com/x402-foundation/x402/blob/main/typescript/packages/core/src/client/x402Client.ts), observed blob `30b534b0966c7e3999c28b0e66d9bc4bdf233c34`.
- [Exact Stellar client scheme](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/stellar/src/exact/client/scheme.ts), observed blob `93a9e6bc1851c243dedb2ef24e0bc4524de30e00`.
- [Official Ed25519 signer](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/stellar/src/signer.ts), observed blob `9a6498b80961c69e9d21c7f31ffd3b2cba13041e`.

The code adapter and dependency installation do not establish a completed testnet payment. The original SF88 result, SF82 record and independent SF43/SF86 transaction lookup identify the outcome of a later authorized execution.
