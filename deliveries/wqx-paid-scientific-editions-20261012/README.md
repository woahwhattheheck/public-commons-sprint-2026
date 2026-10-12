# WQX paired scientific editions and paid delivery

[Download the complete application](WQX_Paired_Scientific_Paid_Delivery_20261012.zip). Start with `START_HERE.md` inside it.

The archive contains the complete WQX application: retained source acquisition, source review, Open Waters receiving, full concentration decisions, paired scientific editions, browser and CLI, 39 WQX merchant tools, and the original paid Water Quality job with its new scientific mode. It includes all 668 source files, the original Potomac source carrier, operating guides, input examples, native receiving drivers and archive verifier.

## Exact application

- Archive: `WQX_Paired_Scientific_Paid_Delivery_20261012.zip`
- Bytes: 4,399,184
- SHA-256: `766dcf7be104a2904a498432a21dc8df89d68e2db005a78ea7093aab01a91d30`
- Members: 671, including 668 source files and the three application/entry manifests
- Scientific source: [PR2313](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2313), merge `1a94f35d5eaf69c2f23247bf12e32fe6710e6413`
- Paid scientific source: [PR2367](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2367), merge `26b448ce5b841fbed5de50fee2c21230d6a4dc2c`

[Source manifest](source-manifest.json) records every source byte count, SHA-256 and Git blob. [Archive manifest](archive-manifest.json) records every delivered member. Every archive member was decompressed and matched to its exact source before publication.

## Receive and deliver the whole study

The existing `waterQualityReview` function and `/water-quality-review` route accept explicit `mode: "scientific"`. The caller selects a complete saved scientific bundle, its exact original review name and expected scientific review hash. The worker verifies and reproduces both selected source editions, then delivers the seven native exports, original sealed input, scientific selection and complete result manifest. Existing review and Open Waters jobs retain their original behavior.

Use the included [paid scientific guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/jobs/PAIRED_SCIENTIFIC.md) and the [complete standalone operating guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/main/products/wqx-water-quality/OPERATING.md). The standalone maintained selection remains `wqx-water-quality`.

## Calculation and receiving evidence

The complete original study contains 1,035 results and 1,112 reported limits. Its source-native scientific calculation in connected V8 converts 749 selected concentration records and 1,089 independently represented limits, while preserving 452 blank measurement/unit pairs; 451 of those pairs carry supported converted limits. The source retains all qualification, censoring, original-unit and explicit Keep context.

The earlier 664-file scientific source restored in a native runtime and passed 18 Node syntax checks. Its whole source/CLI/browser/MCP receiving stopped before registration because native record allocation had no space. That original operation remains unchanged. The new paid-mode source has complete peer review, exact merged readback and connected JavaScript parsing; its worker/independent receiving/cold-export execution remains prepared until the original native runtime records it. This source release does not claim a new checkout or payment.
