# Receive the reviewed Ottawa study into the original Research case

This following native stage adds the completed Ottawa measured-cooling source bundle to the existing NCC Research dossier. It calls the maintained source-bundle receiver and preserves the original client/CLI/MCP journey on its original source.

## Prepare the existing owner

Run this program from the existing case owner after its original `project/results/native-report.json` records all eight completed stages. The full original report is retained alongside this receiving result. If that owner's private namespace has closed after its completed return was saved, the producing helper accepts the exact saved return as `completedReturn`: schema `sf88.research-client.completed-native-input.v1`, current materialization `url`, observed `bytes` and `sha256`, and the returned complete `ownerMember` path. It verifies the original completed outcome and every member against that owner's inventory, restores the same absolute case paths without replacing differing files, and continues only this following stage. The source-bundle producer has already assembled the publisher files, original analysis and five reviewed findings; use that original complete bundle.

Materialize `ottawa-runtime-source.json` into a separate source directory, preserving each `files[].path`. The envelope closes all 19 relative imports using Node built-ins, without installing dependencies. Its source is public commit `3f675551d23fe2991b54dc6d2ab5b6fa6a8a5030`; each original module carries its Git blob, byte length and SHA-256.

Prepare the private input with schema `sf88.research-client.source-bundle-receiving-input.v1` and these fields:

| Field | Meaning |
| --- | --- |
| operationId, stageId | Existing business operation and its one following study-receiving stage |
| dossierId, questionId, questionText | Original selected dossier and exact research question |
| directory | Existing original Research store directory |
| originalNativeReport | Completed original client/CLI/MCP report |
| sourceDirectory, sourceEnvelopeFile, sourceCommit | The separately selected current 19-module core |
| sourceEnvelope | Exact envelope bytes, SHA-256 and Git blob |
| outputDirectory | Private output retained by this same owner |
| bundle | Original selected file path, byte length and SHA-256 |
| manifest | Exact original manifest byte length and SHA-256 |
| review | Full reviewed manifest, expected source and finding keys, file count and decoded file bytes |

The original Ottawa bundle is 5,966,483 bytes with SHA-256 `643cd42bd0a99342bd99544a12b04ea4d22bce9022b929589c4fb9477117f8fc`. Its 10,315-byte original manifest has SHA-256 `bae4c025caa5a61771fe93ca7bdba532d237be801f65156f9ba93380c6e78c01`. It contains all 42 source-package members, 4,447,398 decoded bytes, three selected source groups, and five complete findings.

Invoke with the existing supported Node executable:

```sh
node receive-reviewed-source-bundle.mjs /absolute/private/receiving-input.json
```

## Review and atomic receiving

The program checks the full bundle and original manifest bytes before touching the dossier. It uses `store.previewSourceBundle` against the actual selected question, preserving the full titles, notes, findings, grouping and terms.

The original `store.receiveSourceBundle` receives the retained edition, three original occurrence selections and all five findings in one revision. Every write uses the reviewed bundle digest and fresh expected revision. When a response is interrupted, that same receiver recognizes the exact question and bundle digest before its revision check.

The result identifies the original revision where this edition first appeared. It checks that revision's original question text and notes, previous source editions, source selections, findings and review-model counts. It verifies the complete introduced finding text and exact occurrence associations. Later editorial revisions remain separate from the original import.

## Complete output and return

The output contains the current selected dossier's HTML and Markdown reports, complete original study files under their original member paths, exact retained bundle and manifest, complete original portable history, original native report, source identities, and receiving result.

The maintained report renderer provides original file downloads, complete text and retained raster charts. This journey verifies that selected source files' exact download bytes are present in the HTML report. Original-member extraction preserves names, bytes, encodings and hashes.

The portable file is streamed into an independent original store. Receiving checks the selected revision, full historical revision hashes, all preserved curation, the exact source-bundle bytes, and the source preview after reopening. Its independent receiver is a verified reconstruction of the portable artifact.

The same producing owner retains the complete output through the existing artifact keeper. The program's process outcome and `receiving-state.json` are retained before packaging. A successful source receive is recovered through the original idempotent receiver; completed export files are verified and reused. A later dossier revision does not change the pinned completed delivery.

The private output should be saved before releasing the native namespace. Keep `portable-receiver` until the full portable file and its verified result have been saved; it can then be reconstructed from that original artifact.

## Source references

- Current receiver: `stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/dossier.mjs`, blob `7010d85de16895c99edc00e0247a1248c432ce0f`.
- Source-bundle encoding and validation: blob `a98e2d2f89cb489e0e1cffa30735f6c2fb5f298c`.
- Complete file report renderer: blob `ca8e15fb3aaa4d3a17c44d1bbd0e4883fbc860d7`.
- Original streamed portable codec: blob `dae6154ded7a88c367e844807ecec664aca4200f`.
- Artifact keeper: [PR 2209](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2209).
