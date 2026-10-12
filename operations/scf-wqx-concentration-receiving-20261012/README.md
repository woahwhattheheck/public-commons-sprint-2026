# Complete Potomac concentration receiving

This operation opens the original Potomac water-quality project, prepares exact concentration choices, runs the operator browser and receives the complete saved result in an independent project. The entire captured cohort remains in the working project.

## Selected source

The source selection contains 651 files and 7,553,963 restored bytes. It reuses the original 643-file WQX operator source at 3d9d8fef5747f6bb7cd0595e752db051a620ee51 and composes the 16 complete concentration feature postimages from cd5da917f394e485248ec139dd90d763d75cdd07.

Two existing-format source bundles feed the same Commons receiver:

| Input | Exact identity |
| --- | --- |
| Original WQX source | Public sprint blob 0a93d45ea67cec11f3dbca5c6e2e797e90e1df87; 7,038,167 bytes; SHA256 f79de82a7bfd3628afc573d5690530c83d2fd717d5207a800b032d60b21f34c9 |
| This directory's source.json | 3,386,458 bytes; SHA256 de47bf822bf48e41e72e2fa29436576ea79db8a76cb54cbd1402286e731d2c74 |
| manifest.json | Selects the exact original and feature members by path, length and SHA256 |

The maintained Commons reader reconstructed all 651 selected files from these two retained inputs, with no missing or conflicting members. The complete source graph inside the feature contains the original capture, review, corrected receiving plan and original response bytes.

## Receive the complete source

Use the existing Commons receiver. Its exact source pins are retained in manifest.json under receivingTool. It requires its original connected_source_carriers.cjs, connected_sha256.cjs and connected_slack_pages.cjs siblings.

```sh
node /existing/commons/host/receive_source_carriers.cjs \
  --input /retained/original-wqx-source.json \
  --input /retained/concentration-receiving/source.json \
  --manifest /retained/concentration-receiving/manifest.json \
  --out /workspace/scratch/9f774193b7b4/wqx-concentration-receiving/selected-source-cd5da917
```

Use this new selected-source directory so earlier partial materializations keep their own source identities. The receiver verifies the complete input before publication and reuses identical existing files on continuation.

## Existing operation and runtime

The original operation ID is WQX-CONCENTRATION-POTOMAC-9F77-20261012. configuration.json selects its original private directory, complete source graph, source/review/capture identities and the observed installed Chromium and Playwright paths.

Use Node 24.19 or later and Python 3.11 or later. The original private project, exact converter, native review and original exporters run in Node; Chromium and the existing Playwright package handle the browser phase. On another equipped host, bind the configuration to its actual installed paths before the first operation phase. Preserve that selected configuration on continuation.

The complete operation has a planning allowance of 1,536 MiB memory plus 256 MiB reserve, and 512 MiB additional ordinary disk plus 64 MiB reserve. Submit the exact source, configuration and command through the existing native worker's admission. Each child exits before the next phase starts.

```sh
node --expose-gc --max-old-space-size=768 \
  /workspace/scratch/9f774193b7b4/wqx-concentration-receiving/selected-source-cd5da917/stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/review-sheet/concentrations-receiving.mjs \
  --config /retained/concentration-receiving/configuration.json
```

The original entry also supports --phase source, --phase browser and --phase verify for continuation of a retained operation.

## What the operator completes

The source phase restores the original capture through the maintained project, reproduces review ba122f919127c23f701dcbf9cb88314fee46cdace3fd881b971a23b959489631 and corrected plan 893c32bd0b9729cc3504244670ecd05c34c51ddf1e44887296c7ea2cb0788e21. It runs the original CLI for 220 mg/L, 40 ug/L, 38 ng/L and 451 mass-per-volume limit-only records.

All 749 supported records and 1,089 independently reported limits convert to ug/L. One Turbidity non-detect retains its 2.0/2 NTRU optical limits and receives an explicit Keep reason. All 1,035 original results, all 1,112 original reported limits, every source qualifier and all 452 blank result/unit pairs remain present. The populated Silica 4.65 mg/L result and its 0.06 mg/L DQCALC limit become exactly 4650 ug/L and 60 ug/L.

The full decision document round-trips through original CSV and TSV. The browser then prepares and restores a draft, imports the complete choices, previews and saves the original plan, downloads eleven decision/native outputs, receives the complete bundle in a separate empty project and compares the received downloads. Desktop, mobile and cold restart use the same saved identities.

The final verification phase reopens both projects, compares their original native exports with every downloaded file and reopens the full conversion report through the maintained CLI.

## Retained outputs and continuation

Outputs remain below /workspace/scratch/9f774193b7b4/wqx-concentration-receiving/operation. The driver keeps the input identity, original source-ready receipt, browser progress, completed native review IDs, full downloads, screenshots and final result.json. Each complete phase reopens its saved output before executing further work. Resume the original configuration and operation directory after an interruption; the retained request and immutable source identities select the same work.
