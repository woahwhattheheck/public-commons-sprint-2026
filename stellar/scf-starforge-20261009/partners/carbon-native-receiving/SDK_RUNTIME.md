# Original Stellar SDK runtime

The carbon original-ledger reader and native receiver accept an explicit `--sdk-module`. This helper prepares the original published Stellar SDK 16.3.1 single-file UMD bundle for that interface. Its separate Node ESM adapter exports the original Account, Address, Asset, Contract, MuxedAccount, Networks, StrKey, TransactionBuilder, scValToNative and xdr objects.

The upstream versioned build configuration publishes this UMD file with its dependencies included. The native receiver uses Node 22 or later.

## Prepare the runtime

Use an existing complete original bundle or download the pinned published file:

```sh
curl --fail --location \
  'https://cdn.jsdelivr.net/npm/@stellar/stellar-sdk@16.3.1/dist/stellar-sdk.min.js' \
  --output PRIVATE_DOWNLOAD_DIRECTORY/stellar-sdk-16.3.1-original.min.js
```

The bundle is exactly **487,628 bytes**. Its original published file integrity is:

```text
sha256-ZEWtWqGPz98s2AlXZtmX4YwaBLKJBz21Tnrq5DzBxD8=
```

The complete original npm publication metadata, distribution-file metadata and license are included in `sdk-originals/` beside this guide. From the maintained repository:

```sh
node stellar/scf-starforge-20261009/partners/carbon-native-receiving/prepare-sdk-runtime.mjs \
  --bundle PRIVATE_DOWNLOAD_DIRECTORY/stellar-sdk-16.3.1-original.min.js \
  --metadata stellar/scf-starforge-20261009/partners/carbon-native-receiving/sdk-originals/stellar-sdk-16.3.1-original-npm-metadata.json \
  --output NEW_PRIVATE_SOURCE_ROOT/receiving/stellar-sdk-16.3.1
```

The source bootstrap maps the same runtime files to `SOURCE_ROOT/receiving/`; in that layout, use its `prepare-sdk-runtime.mjs` and `sdk-originals/` paths. The output directory is create-only and must have an existing private parent.

The preparer checks the original bundle size and published integrity, preserves its bytes as `stellar-sdk-16.3.1.cjs`, and writes `stellar-sdk-16.3.1.mjs` as the thin adapter. The `.cjs` filename selects the CommonJS branch of the published UMD wrapper. Original metadata and the preparer join the output. When the license and distribution metadata are beside the selected npm metadata, both complete original companions are copied and identified too.

The helper loads the actual required SDK exports and transaction/result/metadata XDR readers. Its `sdk-runtime.json` records the runtime version, complete source URLs, original file identities and the emitted module path. An import failure retains the complete inputs and its diagnostic in the same new directory.

## Use the same module for the complete receiving journey

Pass the emitted path to both the original historical input reader and the receiver:

```text
--sdk-module NEW_PRIVATE_SOURCE_ROOT/receiving/stellar-sdk-16.3.1/stellar-sdk-16.3.1.mjs
```

First run `prepare-ledger-inputs.mjs` with the complete original ledger JSON responses and source manifest. Then run `receive-native.mjs` with the reader's emitted `capture-options.json`, the selected Chromium executable and a new private output directory. The complete [native receiving guide](README.md) covers source import, browser operations, exports, independent receiving, reopening and the final archive.

Keep the prepared SDK directory beneath the bootstrap-owned source root. The finalizer preserves the whole source root with every operated store and original source response. A separately moved SDK donor includes its complete original license and publication metadata.

## Programmatic interface

```js
import {prepareSdkRuntime} from './prepare-sdk-runtime.mjs';

const prepared = await prepareSdkRuntime({
  bundle: '/private/downloads/stellar-sdk-16.3.1-original.min.js',
  metadata: '/private/source/receiving/sdk-originals/stellar-sdk-16.3.1-original-npm-metadata.json',
  output: '/private/source/receiving/stellar-sdk-16.3.1',
});
const sdk = await import(prepared.sdkModule);
```

The result includes `sdkModule`, `receiptPath`, original file digests and the actual named exports observed in the imported module. The complete declaration is in `prepare-sdk-runtime.d.mts`.

## Original publication

- [Published bundle](https://cdn.jsdelivr.net/npm/@stellar/stellar-sdk@16.3.1/dist/stellar-sdk.min.js)
- [npm publication metadata](https://registry.npmjs.org/@stellar/stellar-sdk/16.3.1)
- [Original file metadata](https://unpkg.com/@stellar/stellar-sdk@16.3.1/dist/?meta)
- [Official single-file build definition](https://github.com/stellar/js-stellar-sdk/blob/v16.3.1/rollup.config.mjs)
- [Original license](https://github.com/stellar/js-stellar-sdk/blob/v16.3.1/LICENSE)

The original repository commit is `1f2b862d0257401c85d62e9b7d424b64d14b149a`; build-definition Git blob is `01dec437e305be2fbd2cb5b438c164095622c609`. The npm metadata's tarball integrity identifies the separate package tarball. The bundle's own integrity above identifies the exact published JavaScript file.
