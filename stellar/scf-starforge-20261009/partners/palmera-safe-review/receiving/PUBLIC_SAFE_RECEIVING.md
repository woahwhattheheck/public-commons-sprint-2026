# Run and reopen the original public Safe input

The installed `safe-review` command can now receive the recorded Gnosis owner-replacement transaction, retain its original provider observations and selection, and create the caller module for the Safe operator workspace. The native buyer, merchant ticket, analysis and handover continue through the existing Safe review commands.

## Select the existing caller runtime

Use the caller project that already resolves `@keyper-labs/palmera-module-sdk@1.0.0-beta.1`. The helper resolves `@safe-global/protocol-kit@4.1.0` **from that Palmera package**, because its original dependency closure also contains an indirect Protocol Kit 5.0.3. The retained runtime records both actual package paths, versions and package-metadata SHA-256 values.

Original package authority is [Palmera c1be7138](https://github.com/keyper-labs/palmera-module-sdk/tree/c1be7138f9cfedfd9a5dbaeb990994b95f18d591); its Protocol Kit 4.1.0 dependency is the one used by the existing selection adapter. Use the existing caller installation and selected HTTPS RPC. The [Gnosis RPC documentation](https://docs.gnosischain.com/tools/RPC%20Providers/) publishes `https://rpc.gnosischain.com/`.

The installed entrypoint is `starforge safe-review`. For a source checkout, invoke `node "$SAFE_REVIEW_CLI"` with the same arguments.

```sh
export PALMERA_SAFE_RPC_URL='https://rpc.gnosischain.com/'
starforge safe-review public-read \
  --caller-root "$CALLER_PROJECT" \
  --rpc-env PALMERA_SAFE_RPC_URL \
  --out "$CASE/public-source"
starforge safe-review public-open --directory "$CASE/public-source"
```

Use absolute paths. `--source FILE` accepts an exact copy of the bundled `public-safe-source.json`; its source transaction and signatures stay unchanged. `--rpc HTTPS_URL` is also accepted for a one-time read, but generated caller modules use the named environment so credentials do not enter their source or retained record. The record keeps only the RPC origin, such as `https://rpc.gnosischain.com`.

The existing `readPublicSafe` helper obtains the original outer transaction and receipt through the Protocol Kit provider. It verifies network 100, block 32106343, the executor, the outer/receipt association, the recorded successful execution and gas used, the approved-hash signature, the Safe transaction hash and the SDK-encoded complete execution calldata. The six-field context uses the **actual outer gas limit**, transaction index and value.

## The retained record

`public-read` returns its record ID, original source link, source execution date, network, outer transaction and block hashes, six-field context, original runtime, selection summary and file descriptors.

| File | Retained content |
| --- | --- |
| `receiving-input.json` | Immutable original source SHA, selected caller root, label, RPC origin and input ID |
| `source.json` | Exact bundled source bytes |
| `observation.json` | Original outer transaction and receipt returned by the SDK external provider, observed context and actual runtime metadata |
| `selected-context.json` | The original six context fields for the existing capture command and operator form |
| `selection/safe-transaction.json` | Original SDK selection record, exact transaction/signature/encoding and Safe identity |
| `selection/simulation.json` | Original Tenderly public request body |
| `selection/selection.json` | Existing three-file selection manifest |
| `receiving.json` | SHA-256/length descriptors for the seven input files, original selection ID and body SHA |

The observation format is **canonical JSON of the SDK external-provider JSON-RPC result objects**. It is a serialization of those returned values, not an HTTP wire capture. Hex quantities and exact decimal strings stay strings. The source execution date is the recorded on-chain date, not a fabricated receiving timestamp.

Repeating `public-read` on a completed directory verifies and opens its saved files. If source receiving was interrupted after the observation was retained, it uses that same observation and the original SDK hydration path to finish the selection. The original atomic writer retains exact outputs and matching temporary files. An input or retained-byte mismatch produces an error.

`public-open` is offline. It validates every file descriptor, the exact bundled original source, the source/observation/context association and the original selection. A recipient can copy the complete receiving directory and use the installed `public-open` command on its new path.

## Create the original operator caller

```sh
starforge safe-review public-caller \
  --directory "$CASE/public-source" \
  --caller-root "$CALLER_PROJECT" \
  --rpc-env PALMERA_SAFE_RPC_URL \
  --out "$CASE/current-transaction.mjs"
```

The output is a small native module exporting `loadTransaction({context})`. Its source embeds the reviewed receiving record ID as well as its paths and RPC environment name. Loading a different record at the same directory is rejected before SDK construction. Its result has the existing `{safe, transaction, label, origin, close}` contract. The output reports its exact module SHA, context-file path, record/selection IDs, caller root and environment name. Repeating the command with the same inputs verifies the identical existing module. Put this module outside the immutable `public-source` directory.

The caller reopens the retained outer transaction, receipt and six-field context. The same actual SDK reconnects to the configured RPC to verify chain/Safe identity, transaction hash and encoded calldata; it does not fetch or replace the saved outer transaction or receipt. It then compares its complete captured record and public body with the original selection. A changed Safe contract identity or incompatible caller runtime is therefore visible before capture can proceed.

Configure the existing Safe operator with `--capture-module "$CASE/current-transaction.mjs"`. Keep `PALMERA_SAFE_RPC_URL` in that host's environment. Copy the exact six context values from `selected-context.json` into the operator's capture form, or use the original CLI:

```sh
starforge safe-review capture \
  --module "$CASE/current-transaction.mjs" \
  --context "$CASE/public-source/selected-context.json" \
  --out "$CASE/operator-selection"
starforge safe-review selection --directory "$CASE/operator-selection"
```

To open the already retained selection directly, the operator's **Receive selection** action accepts `$CASE/public-source/selection`; this uses the original selection receiver. After moving the installation or using a different existing caller project, generate a new caller-module filename with that installation's `public-caller` command and its actual paths, then select it in the existing operator configuration. The receiving directory and original record ID remain intact.

## Continue one native purchase

Use the existing merchant plan and original issued ticket selecting network 100 and this exact body. The completed public input supplies the source selection; the same buyer owns purchase review, explicit execution, recovery and the result.

```sh
starforge safe-review prepare \
  --selection "$CASE/public-source/selection" \
  --plan "$CASE/merchant-plan.json" --ticket "$CASE/merchant-ticket.json" \
  --intent "$ORIGINAL_INTENT" --out "$CASE/prepared"
starforge safe-review import-prepared \
  --directory "$CASE/prepared" --operator-profile "$CASE/operator-profile.json" \
  --state "$CASE/buyer-state" --runtime "$BUYER_RUNTIME"
starforge safe-review review --intent "$ORIGINAL_INTENT" \
  --out "$CASE/purchase-review.json" --state "$CASE/buyer-state" --runtime "$BUYER_RUNTIME"
```

The existing [operator guide](../operator/OPERATOR.md) covers review, explicit purchase, same-intent recovery, analysis, comparison and original portable handover. Source receiving and caller hydration perform read-only SDK/RPC work. A provider simulation occurs only through the existing configured buyer's purchase action.

## Original transaction authority

- [Safe source file](https://github.com/safe-global/safe-eth-py/blob/7ff81f717d34b3f744ce16ab193e4671a14e65da/safe_eth/safe/tests/mocks/mock_transactions.py), original blob `ff66dc6898004d6d2ad3c98dc12d04464b7ecb4f`.
- [Original network-read use](https://github.com/safe-global/safe-eth-py/blob/7ff81f717d34b3f744ce16ab193e4671a14e65da/safe_eth/safe/tests/api/test_transaction_service_api.py), original blob `ab28acc8e20b96e568549f3b43351d36ac4082a6`.
- Safe `0xAedF684C1c41B51CbD228116e11484425d2FACB9`, original nonce `5`.
- Outer transaction `0x27ac6f19a73da17d632259563aafb5092ace7e44c932ca1ed2336b2da83b30ca`.
- Safe transaction hash `0x06c88df42a8ab64b2b2c5e2b5c8c4df384c267b39929a8416d1518db23f91783`.
- Gnosis block `32106343`, source execution `2024-01-24T15:22:55Z`.
- The source's `gasUsed=84977` remains a receipt field; the retained context gets its gas limit from the original outer transaction.

Gnosis receiving uses the original `prepareSafeSelection` path. A real Palmera transaction on its supported caller network continues through `preparePalmeraSelection`, which consumes the caller's original `palmera.getSafeSDK()`.
