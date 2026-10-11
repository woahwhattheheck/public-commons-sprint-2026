# Native Stellar signer for the SF88 buyer

`native-signer.mjs` supplies the missing signer callback used by the original SF88 operator buyer. It calls the published x402 SDK to construct the payment envelope. SF81 still obtains terminal approval and reserves the budget; SF31 still sends the initial request and its one paid retry; SF82 still records the result.

## Install the original dependencies

Install from the original `sf88-operator-buyer-cli` directory so its signer module resolves these packages:

```sh
npm install --ignore-scripts --no-audit --no-fund --save-exact \
  @x402/core@2.28.0 @x402/stellar@2.28.0 @stellar/stellar-sdk@16.3.0
```

Node 22+ is required. The published package versions above were retrieved and installed in the cloud development workspace on October 11, 2026. No dependency installation script or repository test suite is needed.

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

An operator using an existing external or hardware signer can call `createOfficialStellarSigner({ ...configuration, signer })` instead. The signer must implement the official `ClientStellarSigner` interface: `address` and `signAuthEntry`. This adapter does not create a wallet or replace that signer.

## Signing behavior

The adapter permits the configured `stellar:testnet` exact scheme only. It checks the complete accepted requirement against the original challenge and SF31 approved intent, including resource identity, fee sponsorship, atomic amount, asset, recipient and timeout. The operator cap and the intent cap are both enforced. The challenge must contain exactly one copy of the selected option.

Each invocation configures the original `x402Client` with `ExactStellarScheme`, the exact testnet registration, an exact-option selector and an asset-specific atomic spend control. It passes the original challenge to `createPaymentPayload`. The SDK performs the real Stellar simulation and authorization signing when the operator executes; the adapter returns its unchanged canonical envelope. It neither uses a payment-aware fetch wrapper nor sends another merchant request.

`SIGNER_*` errors identify invalid local configuration or quote drift. `OFFICIAL_STELLAR_SDK_UNAVAILABLE` means the dependencies cannot be imported from the source module. `OFFICIAL_STELLAR_SDK_INCOMPATIBLE` means the installed API lacks the required exports. `OFFICIAL_STELLAR_PAYMENT_CREATION_FAILED` identifies SDK simulation/signing failure without placing private account material or raw transaction data in the CLI error. Preserve the original SF81 reservation after any failure; use the existing reconciliation path before another operation.

## Original source used

- [Stellar's native CLI example](https://github.com/stellar/x402-stellar/blob/main/examples/client-cli/src/index.ts), observed Git blob `171e5e5a31c5e43e30cb44a561670c1f364ee319`.
- [x402 core client](https://github.com/x402-foundation/x402/blob/main/typescript/packages/core/src/client/x402Client.ts), observed blob `30b534b0966c7e3999c28b0e66d9bc4bdf233c34`.
- [Exact Stellar client scheme](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/stellar/src/exact/client/scheme.ts), observed blob `93a9e6bc1851c243dedb2ef24e0bc4524de30e00`.
- [Official Ed25519 signer](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/stellar/src/signer.ts), observed blob `9a6498b80961c69e9d21c7f31ffd3b2cba13041e`.

The code adapter and dependency installation do not establish a completed testnet payment. The original SF88 result, SF82 record and independent SF43/SF86 transaction lookup identify the outcome of a later authorized execution.
