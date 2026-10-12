# Research Developer Portal — complete source-kit repair

The original Research source kits omitted three files that the existing Developer Portal loads when the SDK is imported. This kit contains the original assets and an exact successor composer for each retained source selection.

Original kits: [citation](../396c-citation-review-native/), [Python/Analysis](../396c-citation-python-native/), [Europe PMC](../396c-europe-pmc-native/). Their original envelopes and source bodies remain pinned; this directory carries the explicit runtime-asset addition.

## Complete source-kit successors

Use the full helper below with the three original source envelopes and their original materializers. Each invocation creates a separate deterministic successor kit. It preserves every original source body and adds exactly the three original assets above. The helper verifies both the original and successor whole-envelope hashes, every source member, all six existing dependency pins, and the generated materializer source. It never starts the customer operation.

The addition JSON fence above omits its terminal file newline when rendered by Slack. Parse that single JSON object and save `JSON.stringify(packet) + "\\n"` as UTF-8, or append one LF to the compact fence body after removing structural fence newlines. The resulting **Developer_Portal_Source_Additions.json must be exactly 46,410 bytes / SHA256 f1890ee59c679d9322dc5e2edaf97eda606c34c7c1921a797215395b5d02e45e**. Do not normalize arbitrary source text. The direct JSON file and Python helper in this directory already contain their exact terminal LF.

Use **compose-developer-assets.py** in this directory and verify **16710 bytes / SHA256 b6a9f93e8e9556ab6deacfac8100a526d4e04738f6827e4004ce1a17d022edd9**. Paths below are explicit examples; use the retained original envelopes and materializers already selected by the existing workflow owner.

```bash
python3 -B /ABS/compose-developer-assets.py --kit citation --addition-packet /ABS/Developer_Portal_Source_Additions.json --source-envelope /ABS/citation-original/source-envelope.json --source-materializer /ABS/citation-original/materialize-source.py --output /ABS/citation-successor
python3 -B /ABS/compose-developer-assets.py --kit python --addition-packet /ABS/Developer_Portal_Source_Additions.json --source-envelope /ABS/python-original/source-envelope.json --source-materializer /ABS/python-original/materialize-source.py --output /ABS/python-successor
python3 -B /ABS/compose-developer-assets.py --kit europe-pmc --addition-packet /ABS/Developer_Portal_Source_Additions.json --source-envelope /ABS/europe-pmc-original/source-envelope.json --source-materializer /ABS/europe-pmc-original/materialize-source.py --output /ABS/europe-pmc-successor
```

Then use each successor's original materializer interface, selecting that kit's existing source directory:

```bash
python3 -B /ABS/citation-successor/materialize-source.py --source-envelope /ABS/citation-successor/source-envelope.json --directory /ABS/existing-citation-source
```

The Python and Europe PMC source directories remain separate, as required by their original materializers. Repeat the last command with their respective successor paths and existing separate directories. Normal product entrypoints, operation IDs, private workspace paths and output ownership remain with the original workflow.

### Manifest publication and recovery

The updated materializer verifies every selected file before publishing the canonical source manifest used by the native delivery. If the directory has the exact original manifest, it first retains that full manifest unchanged under `<manifest>.predecessor-<SHA256>.json`, then atomically advances the existing canonical marker under its own manifest lock. It accepts only the exact original predecessor or the exact selected successor. A repeated same-directory invocation reuses the identical files and successor; an interrupted addition or publication is completed from the same bytes. A different existing source body or manifest is preserved and reported. All original envelope files are retained unchanged; the new envelope explicitly records their identities in `runtimeClosureAddition.predecessor`.

The canonical manifests now include all 286 / 452 / 476 source files, so source-inclusive customer archives can select the three assets through the existing manifest-driven packaging. Keep `KIT_SUCCESSOR.json` with the receiving receipts. This packet is source preparation; the actual earlier import failure and the original native history remain separate.

| Kit | Complete source files | Complete source bytes | Successor envelope bytes | SHA256 |
|---|---:|---:|---:|---|
| citation | 286 | 3558658 | 3703763 | 750aaf8416d08dca67f3de27d574859a0d25e96561f7173c82238b2effb6f1b2 |
| python | 452 | 6394509 | 6723862 | 5edf487427cf69152c6ce36bd7031efc840016360c20177a813f8522d96bd3ab |
| europe-pmc | 476 | 6838893 | 7171993 | 6d85434ef1932f00faef9d3ae6be38fcc409d6cd8ed6865c68c5432462265210 |

Source review and exact-byte composition are complete. The independent source-only Python parse attempt returned environment_offline before process creation; the helper therefore compiles each generated original materializer before writing it during actual receiving. No native parse or customer completion is claimed by this source packet.

The base64 source-and-helper carrier is also retained at https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8KDSC56W .
