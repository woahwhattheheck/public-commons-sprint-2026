# Continue a saved Tariff run through customer receiving

This programme carries the **same completed repository Tariff operation** into the original Commercial workspace. Its inputs are the original native programme's saved request IDs, pricing workspace, completed selection and full pricing backup. The original case, commissioning, package, pricing restore and retained-file engines perform each operation.

The product source is [PR2291](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2291), merged at `f89885a893dcfe66a05bdc51ca2b4a00f7848c8e`. The original Tariff programme is Git blob `3bc275a4bdf389959bcc63e3494d2dfd2f89054c` from the Tariff native receiving handoff. ASTRA-DU/TARIFF-RX owns its one physical operation; this customer programme is its continuation.

## Run the complete continuation

Use the complete source tree received for that original operation, including the SF74 console, SF97 Pricing/Economics/Tariffs, original case/source delivery, and maintained merchant MCP modules. Its full dependency closure remains the original source carrier's responsibility.

```sh
node /ABSOLUTE/REPOSITORY/stellar/scf-starforge-20261009/sf74-merchant-support-console/commercial/tariff-receiving-native.mjs \
  --native-run /mnt/data/tariff-native \
  --output /mnt/data/tariff-native/customer \
  --python python3
```

Supply the actual directory containing the original `operation.json`, `flow-result.json`, `selection-request.json` and `pricing/`. The source tree must be the tree recorded by that run. The programme verifies its unchanged original three fixtures and all original recorded Tariff source files.

Use Node 22 or later and the original Python/runtime closure required by the existing case/source delivery engine. Keep the two private output stores and the full original native run together. The same invocation resumes the same saved customer requests.

## Operating path

1. Reopen the completed native selection and reuse its **existing backup request**. Capture the complete tariff and Commercial pricing source, then reopen that capture using only its retained identities.
2. Attach pricing, backup and tariff to one saved fixture customer case through the maintained CLI. The exact three case request UUIDs are retained before the first action and replayed through the original engines.
3. Save and publish the original 1,250-request quotation. Publish a linked 1,500-request revision, compare both editions and retain the rendered customer document.
4. Export the complete original case, every retained case revision, its commissioning materials and the original pricing archive through the existing complete-case exporter.
5. Receive the package into a separate case/source store through the original Support downloader and reopener. Save a recipient-owned draft, reopen the same package, and confirm that the recipient's edit and the quote's original case identity both remain.
6. Restore the exact pricing archive from the **received package**, then receive its saved tariff portfolio. Reopen the original selected request from that restored Pricing workspace.
7. Open the maintained sender and recipient HTTP workspaces sequentially. Read the selected quote through the typed Tariff client, verify the original served application assets and full file downloads, and exercise the original wrong-scope rejection.
8. Read the same received case through the actual Commercial Tariff MCP owner. Close a partial portfolio read after its prefix, reopen at the original offset and full SHA, finish all remaining pages, and compare the complete result with the HTTP-delivered original file.

These are local repository fixture customer records. The pricing inputs retain the original repository fixture names in the saved operation and completion.

## Quantities the recipient sees

| Quote | Monthly requests | Saved uniform quote | Original graduated schedule at this quantity |
|---|---:|---:|---:|
| Original edition | 1,250 | USD 14.25 | USD 14.25 |
| Volume revision | 1,500 | USD 17.10 | USD 16.50 |

The revised quotation keeps the selected uniform rate of USD 0.0114 per request. The native tariff comparison shows how the graduated schedule changes at the revised quantity. The programme also reviews zero requests through the same original pricing engine and confirms that the customer document renders the zero-volume result without a derived-unit placeholder.

## Saved output and recovery

`customer/operation.json` binds the original native output bytes, source fixtures, completed selection, existing backup and all customer request IDs. Exact private request files are saved before mutations. CLI reports retain their original input bytes and first response; the engines resolve replay.

The complete delivered material is:

- `downloads/customer-quote.md`: the rendered linked quotation.
- `package/`: the complete original customer package with case history and all original inline materials.
- `received-package/`: the original receiving operation and independently retained package.
- `received-cases/` and `received-sources/`: the original recipient stores.
- `restored-pricing/`: the original pricing archive restored with its saved Tariff portfolio.
- `downloads/http-source.json`, `downloads/http-portfolio.json` and `downloads/mcp-reopened-portfolio.json`: complete descriptor-verified files.
- `flow-result.json`: the final original selection, case/quote/package/recipient identities and actual closed-listener outcome.

Repeat the identical invocation after interruption. Keep existing request files and output directories. A conflict reports the original retained identity rather than creating a fresh customer request. If an original case writer remains owned by an interrupted process, use the maintained case-writer inspection/recovery command with the actual original host ownership.

For interactive recipient operation, open the maintained Support workspace with `--cases-dir customer/received-cases --source-dir customer/received-sources` using absolute paths, then select the received case and Commercial → Tariffs. The returned completion provides the exact recipient case ID and restored Pricing source paths.

## Source acceptance

The programme was composed against the original package API, immutable case reopener, preserved recipient edits, byte-bound quote and original retained-file pagination. A source-body parse accompanies publication. The physical native outcome belongs to the original TARIFF-RX receiving operation; its completed output should be delivered in the original thread with this customer directory.
