# Receive a complete ETIM xChange supplier delivery

This receiving operation carries the unchanged ETIM xChange 2.0 publisher example through the original material catalog, supplier operator, command line, browser API and merchant MCP. It retains the complete source and every native numeric token, corrects the original URI finding, applies a connected FULL/CHANGE recipient sequence, and delivers the complete workspace to a receiving operator.

The publisher example contains one supplier, one manufacturer product and one supplier trade item. The receiving phases select complete records from that original example. The operation records the selected catalogue versions, omissions and corrections explicitly.

## Run the complete operation

Use the complete source distribution with its original Node 24 runtime, SQLite support and merchant MCP dependencies. The source contains the original publisher JSON, full pinned schema and license. This material/supplier workflow operates the retained catalog; source query capture and paid merchant execution have their separate existing configuration.

From the repository root:

~~~sh
node stellar-forge/mcp-merchant-operator/receiving/xchange-materials-native.mjs \
  --xchange-directory /private/receiving/xchange-etim \
  --directory /private/receiving/xchange-materials \
  --xchange-operation xchange-etim-2769 \
  --operation xchange-materials-2769
~~~

Keep those two directories and operation IDs on continuation. They must be distinct, private canonical paths. The MCP continuation calls the original source journey and reopens its completed report when present. It then uses that journey's producer and receiving workspaces.

| Option | Meaning |
| --- | --- |
| `--xchange-directory` | Complete original source, product delivery and customer receiving directory. |
| `--directory` | Private MCP control state, original request selections, host configuration and complete downloads. |
| `--xchange-operation` | Original source journey ID; default `xchange-etim-2769`. |
| `--operation` | MCP receiving ID; default `xchange-materials-2769`. |
| `--inputs` | Optional directory containing the unchanged original schema and sample under their published filenames. |
| `--help` | Print the MCP receiving options. |

To run the original source journey separately:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving/xchange-delivery-journey.mjs \
  --directory /private/receiving/xchange-etim \
  --operation xchange-etim-2769
~~~

The same directory can then be passed to the complete MCP command above.

JavaScript callers can use either entry point:

~~~js
import { runXChangeDeliveryJourney } from
  './stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving/xchange-delivery-journey.mjs';
import { runXChangeMaterialsReceiving } from
  './stellar-forge/mcp-merchant-operator/receiving/xchange-materials-native.mjs';

const source = await runXChangeDeliveryJourney({
  directory: '/private/receiving/xchange-etim',
  operationId: 'xchange-etim-2769'
});
const complete = await runXChangeMaterialsReceiving({
  xchangeDirectory: source.directory,
  directory: '/private/receiving/xchange-materials',
  xchangeOperationId: source.operationId,
  operationId: 'xchange-materials-2769'
});
~~~

The distribution exports those entry points as `./seller/opensearch/receiving/xchange` and `./clients/opensearch-material/receiving/xchange`. The original catalog CLI, workspace and typed material client remain the product interfaces for a customer's own source.

## Original source

Publisher archive: <https://etim.de/wp-content/uploads/2025/12/ETIM-xChange_V2.0-2025-11-27.zip>

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `ETIM_xChange_SampleFile_V2.0_2025-11-27.json` | 27,705 | `cf81492486cdd2c3a976e07dc901c45fa101fe95797ee6697364e7b56533e04e` |
| `ETIM_xChange_Schema_V2.0_2025-11-27.json` | 62,128 | `5d05577f392661397fbbeff7a1e0486796a515ae65afbe8ab069ab1c9697f20a` |

The source journey copies and verifies the complete originals before intake. Native streaming intake retains supplier/catalogue headers, product and trade-item bodies, original byte ranges, document identity and all 38 JSON numeric lexemes. Manufacturer product `04011969`, GTINs and supplier trade item `221099` keep their original text identities.

The published `LcaEnvironmental.ProductSpecificRulesUri` ends in a trailing U+0020. The initial review preserves that source finding. A reasoned correction removes that single trailing space; the source file remains byte-identical. Every delivery message is reread to EOF with the original native parser and checked against the pinned complete schema.

## Complete source and receiving workflow

| Phase | Actual work |
| --- | --- |
| Native source intake | Upload the complete original xChange file, use its complete catalog mapping, preview and select the full one-product edition. |
| Initial review and source correction | Retain the publisher URI finding, apply the explicit original-source correction and create the first ready FULL review at catalogue version 2.0. |
| CHANGE 2.1 | Select the first FULL review and exact previous version 2.0. Deliver the complete original product with its trade-item array omitted; the prior trade item remains in recipient state. |
| FULL 2.2 | Use the same complete product selection without the trade item. The recipient review records its deletion with the actual before value. |
| FULL 2.3 | Restore the complete original trade item and review its addition. Keep the full prior review chain and all original corrections. |
| Portable receiving | Receive the catalog-only bundle, the first supplier bundle and the full recipient-chain bundle, close and reopen the customer workspace, and verify every original source and review. |
| Source CLI and browser API | Read every recipient page, export native JSON, inspect both native target templates, save the receiving operator's source-confirmation correction and replay its same request. |
| Earlier-delivery replay | Receive both older complete bundles and retain the customer's later correction, its original reason, complete review and recipient state. |
| Final reopen | Reopen both workspaces, verify all complete delivered files and original source identities, then close the server and owned workspaces before retaining the final report. |

The source-confirmation correction records the receiving operator's inspection of the original 24-month consumer warranty. Its value and all original numeric tokens stay intact. It creates an independent receiving revision that the earlier producer bundle must preserve.

The message's selected membership and the recipient's accumulated state are separate data. For the CHANGE phase, the exported message omits the trade item and its recipient state retains the actual previous item. For FULL 2.2, its complete recipient impact contains the deletion. The [operator/source-rule guide](../catalog/supplier/xchange/GUIDE.md) explains the full ETIM and selected 2BA semantics.

## Merchant MCP continuation

The following operation reuses the complete original source journey and both workspaces. It configures private producer and customer aliases, declares the exact source and original bundle as host inputs, and retains its complete requests before making mutations.

It reads the original catalog, edition, materials, source, supplier plans, correction histories and review rows. It inspects both native templates and every recipient page, verifies full recipient before/after hashes and the original row root, and exercises the actual supplier-name/key, kind and change filters.

The producer and customer each export:

- All ten original material formats: catalog CSV/JSONL, approved matches, index description, bulk/delta NDJSON, facets, search client, source description and full catalog bundle.
- The six applicable native supplier formats: review JSON, issues CSV, complete products JSONL, xChange JSON, complete recipient JSONL and impact CSV.

The client retains a real nonfinal 16 KiB-or-larger prefix of the complete producer bundle, closes the original host, reopens its same endpoint and continues that download. It receives every selected file and validates each complete byte count/hash. The CLI also reads all customer recipient pages and reopens the complete supplier download.

The original descriptor controls each filename. Match `manifest.selection.formats` to the same index in `manifest.files`; native names include `ETIM_XCHANGE_<review>_FULL.json` and `material-catalog-<id>-r<revision>.jsonl`. The file manifest retains the actual output names and hashes.

Independently generated bundles include their own export timestamps. The continuation compares the full original record JSON and every complete source body while allowing export-timestamp/framing differences; every individual bundle still has its own exact byte identity. The receiver imports both the MCP bundle and the original older bundle through its declared host aliases and preserves the customer's later correction and review.

## Continuation and retained outputs

The source directory contains the complete original inputs, source declaration, producer and customer workspaces, all exports and `xchange-delivery-native.json`. Its report identifies the original implementation bytes, source hashes, selected catalog, final producer review, full bundle and later customer correction/review. Export publication keeps the complete fsynced body and identity before installing its final name. Continuing uses the original saved result.

The MCP directory contains `control/receiving-state.json`, exact original request selections, private host configuration, all complete download directories and `xchange-materials-native.json`. Its report records the source pins, actual tool calls, original operations, completed artifacts, download continuation and closed lifetimes. The host's ephemeral bearer token stays in its process environment.

After interruption, keep the original source and receiving directories. Use the same command and operation IDs. Retained phases reconcile their original files and records; the client resumes the original verified offsets. The final reports are written after the owned workspaces, file readers and merchant are closed.

## Product references

- [Native ETIM xChange operator and source rules](../catalog/supplier/xchange/GUIDE.md)
- [Supplier profiles and original BMEcat delivery](../catalog/supplier/GUIDE.md)
- [Material/supplier MCP, typed client and CLI](../../../../../stellar-forge/mcp-merchant-operator/OPENSEARCH_MATERIALS.md)
- [Existing BMEcat supplier → MCP receiving](../../../../../stellar-forge/mcp-merchant-operator/receiving/OPENSEARCH_MATERIALS_NATIVE.md)
