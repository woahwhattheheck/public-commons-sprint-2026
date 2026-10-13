# Complete original historical ledger intake

The GiveCredit source desk can acquire a complete historical ledger interval, reuse the retained files for a different source address, or close the exact ledger list recovered by an existing native checkpoint reader. All three paths produce a normal `capture-options.json` for the original GiveCredit collector and the two-application native receiving caller.

The original public RPC request and response remain complete files. Native XDR supplies transaction envelopes, results, application metadata, ledger identities, ledger close times and transaction application order. The collector retains those original files and source locations with each decoded transaction.

## Choose the source operation

| Available original source | Native mode | Result |
| --- | --- | --- |
| A native reader already found the relevant ledger numbers | `selected` | One complete original RPC response per selected ledger, a retained copy of the selecting source file, and combined capture options |
| A finite historical interval still needs a complete scan | `capture` | Every original page in the interval, a saved provider cursor, native chain and application identities, source matches, and compact capture options |
| The interval is already retained and another account or provider needs attention | `reselect` | A new source selection from the complete original local pages, with its own capture options and immutable selection manifest |

The accepted E42D historical-source arm is recovering the May 29, 2024 interval from public history checkpoints. Use its exact selected ledgers with `selected` as those results arrive. The existing 379A two-application journey can continue on its completed capture input while the additional source acquisition proceeds.

The endpoint reader already decoded all 914 original envelopes from ledgers 51890145 and 51890864, with zero decoder issues and two selected transactions. The account creation is in ledger 51890145. The account-signed transaction in ledger 51890864 has sequence `222866475759697924`. Its original account is `GD2IBAC2WK3XOD64APP4OKQTX4URQFAH5WRHODEOJF7EN2MLDOV45VKI`. The intervening sequence changes belong to the wider historical interval.

For a complete May 29 interval acquisition, the exact bounds are:

- `startLedger: "51890145"`, inclusive.
- `beforeLedger: "51890865"`, exclusive.
- 720 consecutive ledgers.
- Mainnet passphrase `Public Global Stellar Network ; September 2015`.
- Original GiveCredit contract `CAIRWEYKTLVRQBXQGYNLDUAKWIUV4NO6WPTCMVHH2BOMUUUBTXRJF43R`.

## Native runtime and file layout

Use the existing Node 22 or newer receiver and its complete Stellar SDK. The delivered SDK preparer can retain the original 16.3.1 browser bundle and expose the same native readers through its ESM adapter. Supply that already prepared module with `--sdk-module`.

The complete source parcel reconstructs the helper at:

```text
RECEIVED_SOURCE_ROOT/receiving/capture-ledger-interval.mjs
RECEIVED_SOURCE_ROOT/stellar/scf-starforge-20261009/partners/cfce-givecredit-statements/history.mjs
RECEIVED_SOURCE_ROOT/stellar/scf-starforge-20261009/partners/cfce-givecredit-statements/archive.mjs
```

In the repository, the same wrapper lives under `partners/carbon-native-receiving/`. Its `--source-root` argument selects the received original source tree. Every history output directory must be inside that private tree. The final native receiving archive includes the complete tree, so it carries all raw history pages, original selection inputs, SDK source and the operated application stores together.

The history directory contains:

- `history.json` for a full interval, or `selected-ledgers.json` for a native-selected ledger list.
- `responses/` with complete original request, response and exchange files.
- `selections/` with immutable source selections, source manifest snapshots and capture options.
- `baseline-capture-options.json` when an earlier original capture input was supplied.
- `ledgers/SEQUENCE/` for the individually retained complete ledgers in selected mode.
- A native process lock while an acquisition is active. A resumed process can recover a demonstrably exited process or previous boot.

The helper creates new outputs with private permissions. Resume continues a matching existing operation. Exact original files and completed selections retain their hashes across interruption and reopening.

## Close an existing native checkpoint selection

Use the actual ledger numbers and complete selection file returned by the current native reader. The following placeholders refer to those existing local files:

```sh
node RECEIVED_SOURCE_ROOT/receiving/capture-ledger-interval.mjs selected \
  --source-root RECEIVED_SOURCE_ROOT \
  --output RECEIVED_SOURCE_ROOT/receiving/may29-selected-ledgers \
  --selection-file ORIGINAL_NATIVE_SELECTION.json \
  --selection-pointer /selected \
  --ledger-field ledger \
  --baseline-options EXISTING_CAPTURE_OPTIONS.json \
  --sdk-module EXISTING_STELLAR_SDK.mjs
```

`--selection-pointer` is an exact JSON pointer to the original selected row array. `--ledger-field` names the native ledger field in each selected row. The helper preserves the whole source file and derives the unique original ledger list from that array. If a native result uses a different arrangement, supply its exact pointer or use explicit values:

```sh
node RECEIVED_SOURCE_ROOT/receiving/capture-ledger-interval.mjs selected \
  --source-root RECEIVED_SOURCE_ROOT \
  --output RECEIVED_SOURCE_ROOT/receiving/selected-original-ledgers \
  --ledger 51890145 --ledger 51890864 \
  --selection-file ORIGINAL_NATIVE_SELECTION.json \
  --baseline-options EXISTING_CAPTURE_OPTIONS.json \
  --sdk-module EXISTING_STELLAR_SDK.mjs
```

These two numbers describe the already recovered endpoint ledgers. Add the actual intervening ledger numbers returned by the active checkpoint reader for the completed interval continuation.

Each selected ledger is requested once with native `getLedgers` and `limit: 1`. A one-ledger response is already its complete source closure. The resulting combined capture options preserve earlier original sources and transaction hashes, then add the new complete original responses and actual selected transaction hashes. Every child ledger retains its exact native source scope. The original native checkpoint scan keeps its own broader coverage and raw files in the same final source archive.

Resume the same selected-ledger operation with the same arguments and `--resume`. Completed child acquisitions replay from their verified files; the next unfinished child resumes normally.

## Acquire a complete finite interval

When an interval still needs acquisition, the full scan follows the provider's original pagination cursor:

```sh
node RECEIVED_SOURCE_ROOT/receiving/capture-ledger-interval.mjs capture \
  --source-root RECEIVED_SOURCE_ROOT \
  --output RECEIVED_SOURCE_ROOT/receiving/may29-complete-history \
  --start-ledger 51890145 \
  --before-ledger 51890865 \
  --page-size 8 \
  --baseline-options EXISTING_CAPTURE_OPTIONS.json \
  --sdk-module EXISTING_STELLAR_SDK.mjs
```

The default provider is the public full-history Lightsail endpoint, `https://archive-rpc.lightsail.network/`. `--rpc-url` can select another existing public archive service. The current official provider list also publishes `https://rpc.ankr.com/stellar_soroban` as a mainnet historical archive.

The helper requests base64 XDR, preserves every exact request and complete response, and validates:

1. The response belongs to its retained original request.
2. Header XDR agrees with the ledger close metadata and reported native hash, sequence and close time.
3. The page contains the next consecutive ledgers inside the selected interval.
4. Adjacent headers retain the original previous-ledger hash chain.
5. Every native transaction envelope has exactly one original application result.
6. Transaction order comes from `txProcessing`. Native transaction-set order is preserved separately in the original XDR.
7. Each selected compact ledger response matches the scan's whole envelope, result and metadata identity.

The default eight-ledger page size keeps the native working set small while preserving complete responses. The final page uses the exact remaining ledger count. A source interval completes when every selected ledger has been retained; its scope is independent of the provider's current live horizon.

On interruption, the error includes the concrete checkpoint path. Failed HTTP or RPC responses remain complete original files with their observed status and times. Resume with the same operation:

```sh
node RECEIVED_SOURCE_ROOT/receiving/capture-ledger-interval.mjs capture \
  --source-root RECEIVED_SOURCE_ROOT \
  --output RECEIVED_SOURCE_ROOT/receiving/may29-complete-history \
  --resume \
  --sdk-module EXISTING_STELLAR_SDK.mjs
```

The saved interval, provider, page size, initial source selection and original cursor are reused. A completed selection replays its existing capture options and restores its complete manifest state. A different source address belongs in re-selection; a different interval or provider belongs in a new output.

## Reuse the retained interval for another provider

Source-observed provider addresses can be added without repeating the full network scan:

```sh
node RECEIVED_SOURCE_ROOT/receiving/capture-ledger-interval.mjs reselect \
  --source-root RECEIVED_SOURCE_ROOT \
  --output RECEIVED_SOURCE_ROOT/receiving/may29-complete-history \
  --address ORIGINAL_PROVIDER_ADDRESS \
  --sdk-module EXISTING_STELLAR_SDK.mjs
```

This reads the complete existing pages locally and writes a new immutable selection. It uses an already acquired one-ledger response where available. For newly matched ledgers, it retains the existing whole matching scan page as the original source input.

Add `--fetch-closures` to request original `limit: 1` responses for newly matched ledgers. The background interval remains in source-root files; each editable workspace receives its selected complete original response pages. This keeps unrelated background ledger data from being copied through every statement export and independent workspace.

`--account` selects actual G accounts for ordinary Horizon acquisition. `--contract` selects actual GiveCredit contracts for the original donation and pool logic. `--address` selects additional source-observed G or C addresses without changing either classification. These extra addresses are stored separately, so changing the selected account or contract does not silently retain an older selected account.

## Use the resulting input in the maintained applications

Each successful command prints the actual `captureOptions` path, byte count and SHA-256, plus the native selected transaction hashes and source counts. Pass that file into the same original native journey:

```sh
node RECEIVED_SOURCE_ROOT/receiving/receive-native.mjs \
  --source-root RECEIVED_SOURCE_ROOT \
  --output NEW_PRIVATE_RUN_DIRECTORY \
  --chromium EXISTING_CHROMIUM \
  --sdk-module EXISTING_STELLAR_SDK.mjs \
  --capture-options ACTUAL_CAPTURE_OPTIONS_PATH \
  --archive-path SIBLING_COMPLETE_DELIVERY.tar.gz \
  --actor "379A native receiving operator"
```

The native receiving caller already covers both complete carbon desks, original source intake, saved statement versions, real browser operations and downloads, independent receiving and edits, closed-store reopening, and the final whole-source archive. Bind its accounting arguments to the receiving host's actual maintained accounting directory and original case when that selection is available.

The GiveCredit CLI also exposes the same complete acquisition operations:

```sh
givecredit-statements capture-history --file PRIVATE_HISTORY_OPTIONS.json
givecredit-statements select-history --file PRIVATE_HISTORY_OPTIONS.json
givecredit-statements capture-selected-ledgers --file PRIVATE_HISTORY_OPTIONS.json
givecredit-statements capture-ledger --directory EXISTING_DESK \
  --file ACTUAL_CAPTURE_OPTIONS_PATH --label "Original May 29 ledger edition"
```

`PRIVATE_HISTORY_OPTIONS.json` contains `sourceRoot`, `output` and the same named JavaScript options used by the native helper. Add `--sdk-module` when using the retained portable SDK. Keep an earlier capture checkpoint with its original source selection; the historical input creates a fresh source edition while the earlier edition remains available for comparison.

The desk imports the full original request/response strings and records native JSON pointers, header references, application positions and ledger hashes with each transaction. Actual successful transfer rows enter the existing payment and pool logic. Original donation events, explicit registry receipt associations and frozen funding allocations continue to determine the statement joins.

## Programmatic entry points

```js
import {
  captureLedgerInterval,
  selectLedgerInterval,
  captureLedgerSelection
} from './partners/cfce-givecredit-statements/history.mjs';

const result = await captureLedgerSelection({
  sourceRoot,
  output,
  sdk,
  ledgers: originalSelectedLedgers,
  sourceSelectionFile: originalNativeSelectionPath,
  baselineOptionsFile: originalCaptureOptionsPath,
  onProgress: recordNativeProgress
});
```

The source descriptor used by the maintained collector is:

```js
{
  format: 'stellar-rpc-ledgers-json',
  sourceUrl: originalRpcUrl,
  request: originalRequestObject,
  requestContent: completeOriginalRequestString,
  content: completeOriginalResponseString,
  status: observedHttpStatus,
  retrievedAt: actualResponseCompletedAt,
  acquisition: originalAcquisitionMetadata
}
```

Both request forms, the complete response, observed HTTP status and acquisition times are retained. The decoder checks the request and response identity before reading native XDR. For a transferred original whose HTTP retrieval time was not retained, the import keeps `retrievedAt: null` and a separate actual `importedAt`.

## Original implementation contracts

- [Stellar RPC getLedgers method](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgers): named parameters, opaque cursor, page limit, original header and close metadata.
- [Official RPC provider list](https://developers.stellar.org/docs/data/apis/rpc/providers): full-history `getLedgers` archive endpoints.
- [Stellar ledger XDR, v26.0](https://github.com/stellar/stellar-xdr/blob/v26.0/Stellar-ledger.x): transaction sets, ledger close metadata and application-order results.
- [Original CFCE monorepo](https://github.com/CollaborativeEconomics/monorepo/tree/3d20065447bd56c9c05a3e658ccd11e0b9cb985e): GiveCredit receipt, donation and Credits contract source.
- [Stellar SDK original runtime guide](SDK_RUNTIME.md): retained source bundle, original metadata, license and native decoder exports.
