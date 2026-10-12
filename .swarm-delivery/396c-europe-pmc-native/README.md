# Complete Europe PMC native receiving source

This kit receives the complete standalone Europe PMC product into a separate source directory for the existing citation → Python/Analysis → Europe PMC customer workflow. It contains **473 source files**, **6,808,118 source bytes**, all **71 current Python modules**, and all **31** independently read standalone PR111 postimages.

The preceding citation and Python source directories remain intact. The original native owner supplies the existing workspace, dossier, current dossier revision and accepted operation ID. This kit contains source and executable receiving instructions; it does not dispatch a native operation.

## Exact source selection

| Selection | Immutable identity |
|---|---|
| Standalone Europe PMC product | PR111, merge `eaabd39677aad9e908634097e9ae92841cc8ff48` |
| Complete Python source base | Public PR2180, merge `edb9e042733034c1ee0e6afb79740c9a46e30aa3` |
| Base envelope | 449 files; Git `5b58fa7625c511d9a677c353b1aedcfb64de31eb`; SHA256 `4699d7bef9afae7e7b83246600e7add0904403fe829943c32553a3eb63c113ff` |
| This complete envelope | 7,138,459 bytes; Git `bad4c0102ac6e8eb1594ced31ce522ff04d60de1`; SHA256 `400aebafd847d21bad61cfce6afd40b29c5d005b65213abba0fe9390f61ffa31` |
| Source materializer | 8,419 bytes; Git `0b5cf2bee8518b2358a73f4bc86c49e1501aa9b9`; SHA256 `90d60e55d1838215c7252cc2a79db5ad8509bf01b44bbbbe79af1dc98fa3635f` |

The selected edition preserves 442 base source bodies, explicitly replaces seven shared product files, and adds 24 files. `SOURCE_MAP.json` records the complete effective selection and every replacement preimage. `STANDALONE_READBACK.json` records all 31 merged path/blob/byte/SHA256/mode results. All 71 Python module bodies are unchanged from the complete base.

The standalone shared server, client and index are the coherent original Research source plus Europe PMC. Public PR2178 is also merged, but its independently composed public source includes newer eligibility integration; this kit selects the standalone bodies listed above. Existing routescan quota/config and the full Research/Merchant dependency closure are included. The one `seller-client.mjs` string in the source generator is an emitted README example, not a missing native import.

## Receive exact source

Use the direct `source-envelope.json` when the carrier transfers it completely. For bounded transport, `source-envelope.parts` contains eight original `commons.file-part.v1` records, each at most one million raw bytes. Reassemble with the unchanged Commons helper:

```sh
python3 -B /ABS/KIT/transfer_parts.py join /ABS/KIT/source-envelope.parts \\
  --output /ABS/KIT/source-envelope.json

python3 -B /ABS/KIT/materialize-europe-pmc-source.py \\
  --source-envelope /ABS/KIT/source-envelope.json \\
  --directory /ABS/SEPARATE_EUROPE_PMC_SOURCE
```

The source receiver verifies the whole envelope SHA256 and byte count, then every member's original Git SHA1, SHA256, length and source mode. It writes ordinary files atomically, reuses only identical files after interrupted receiving, and verifies all source bytes before reporting completion. It refuses either preceding citation source marker in its target and never overwrites a different source body. Its returned `.europe-pmc-source-materialization.json` is the full manifest consumed by the original Europe PMC receiving command.

Keep this directory distinct from both preceding source directories. The original customer workspace is a separate argument; source receiving does not edit it. The body packet is 7,138,459 bytes and the selected source is 6,808,118 logical bytes. Filesystem allocation, source transfer staging, browser profiles and final outputs must be counted in the original owner's full placement declaration. A carrier may keep temporary transfer files inside its already-declared private work directory while preserving the final source and results on the selected durable surface.

## Continue the original customer operation

Use the same equipped Linux host and its existing Python 3.11+, Node 24+, Playwright, Chromium and original flock support. The preceding citation and Python customer phases must have completed and closed their listeners. Read their actual original workspace, dossier and current revision; freeze those values in the owner-selected operation before first dispatch.

`READY.json` supplies the complete argv as an array. Replace each named absolute path and original identity from the existing receiving record:

```sh
/ABS/EXISTING_PYTHON -B \\
  /ABS/SEPARATE_EUROPE_PMC_SOURCE/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/run-europe-pmc.py \\
  --operation-id ORIGINAL_EUROPE_PMC_OPERATION \\
  --source-root /ABS/SEPARATE_EUROPE_PMC_SOURCE \\
  --source-manifest /ABS/SEPARATE_EUROPE_PMC_SOURCE/.europe-pmc-source-materialization.json \\
  --workspace /ABS/ORIGINAL_RESEARCH_WORKSPACE \\
  --dossier ORIGINAL_DOSSIER_ID \\
  --expected-revision ORIGINAL_CURRENT_REVISION \\
  --directory /ABS/EUROPE_PMC_RUN \\
  --inputs /ABS/SEPARATE_EUROPE_PMC_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/europe-pmc/public-inputs \\
  --node /ABS/EXISTING_NODE \\
  --playwright /ABS/EXISTING_PLAYWRIGHT_MODULE \\
  --chromium /ABS/EXISTING_CHROMIUM
```

The original Python parent runs the operated and cold-reopen phases sequentially under its retained kernel lock and child lifetime control. The actual browser/client/CLI flow receives the four original Europe PMC JSON pages and their transfer provenance, saves both complete source editions, handles query/draft/review history, appends the selected records to the same dossier, invokes the original Merchant attachment and complete exports, then restores and reopens the portable library in a separate Node process. It issues no new provider acquisition for these retained examples.

The Merchant callback is wired in merged `europe-pmc-native.mjs` (`08d8bf3a5f374860137725ea604dce6d8bae0469`). The journey `6b0d10c901a1e033d48e8199f47e61392ed137b7` retains its completion and selects final history after that callback. It exercises the exact already-saved review request, all six export kinds and the original immutable retained-file receipts. No additional review decision is substituted for the saved request.

## Actual completion and recovery

The operator returns `complete-delivery.json` only after it validates `Europe_PMC_Complete_Receiving.zip` against its full exact member manifest. The ZIP contains every selected source file, all original source pages/provenance, full source editions and comparisons, review histories, original dossier reports, every retained Merchant/browser output, portable workspace and the separate-process reopen result. `completed-native-operation.json` summarizes both actual phases and their different process instance identities.

Reuse the same selected operation directory for an interrupted phase after the maintained native controller positively reconciles its old child. The original wrappers recover committed phases and outputs from exact saved hashes, preserve the original query and request IDs, and recover a lost final receipt from the original complete ZIP. A changed source selection or original input requires an explicit successor. The source kit's existence establishes source readiness; it does not establish native completion.

For the complete operator/API/CLI instructions, open the selected source's `research-dossiers/EUROPE-PMC-OPERATOR.md`. The Merchant family and original attachment/source/export semantics are in `stellar-forge/mcp-merchant-operator/EUROPE_PMC.md`. The full prior Python and Analysis guides are retained alongside their original package.
