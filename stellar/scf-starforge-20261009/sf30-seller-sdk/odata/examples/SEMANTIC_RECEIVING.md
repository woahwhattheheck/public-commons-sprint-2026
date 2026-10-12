# Original OData semantic customer receiving

This example continues a declared, retained OData workspace through the original MCP merchant host, SF30 typed dataset, SF82 release lifecycle, SF88 request preparation, SF100 customer delivery and independent source-workspace receiving. Use the same reviewed source edition and merchant profile already present in its connection file.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/odata/examples/semantic-receiving.mjs \
  --connection /absolute/original/connection.json \
  --workspace capture \
  --edition mcp-orders-baseline \
  --profile orders \
  --fields OrderID,CustomerID,EmployeeID,OrderDate,Freight,ShipCountry,ShipName \
  --name 'Original Northwind MCP dataset' \
  --expected-semantic 69b8a4df18f1bfd7f2a14d147bfc5f410531f475d3a9e415e6fccddb17f5cab5 \
  --out /absolute/private/odata-semantic-receiving
```

The command uses the original connection's selected workspace, provider declarations and public merchant terms. It creates a private host configuration for that source and its receiving workspace. This permits the selected source to continue independently of unrelated retired input aliases in an earlier multi-workspace host. The source directory, saved queries, source editions and existing exports keep their original identities.

The original native source example contains all 830 Northwind Orders in five retained pages. Its complete CSDL digest is `81a48488cd2911f7254170da5403628db22127ea59124d6597d04c6af18d7702`. The shown seven-property projection retains 14 value/state columns, the complete OrderID key and exact Freight text. The original connection and transfer are delivered in the existing OData customer handover; use the retained files from that handover or the original populated workspace.

## Operation

The host previews the CSDL dictionary, binds its digest to the original immutable export and downloads every declared CSV, JSON, CSDL and capture companion through the maintained chunk reader. It stages, activates and starts the same original SF82 dataset release, observes its native payment challenge and prepares the original SF88 request for each complete native dataset page. SF100 retains the page, independent intent and source-response record, then finalizes the full customer JSONL, CSV, review and dictionary.

The operation then stops its merchant, creates the complete source transfer and receives that same transfer into an independent workspace. It repeats the exact receive, closes and reopens the customer source, and reads the original dictionary again. Output includes `customer-room/`, `finalized-scan.json`, `merchant-source/`, per-page original requests and responses, `source-workspace.json`, `source-receiving/` and `operation.json`.

The original output directory is the receiving identity. A completed repeat validates its retained customer chain and transfer, then returns the original result. An interrupted run reuses the original export, release, page intents and transfer; it resumes from SF100's committed page prefix. Use a separate output directory for a different source selection.

## Original Python analysis and workbook receiving

Pass the resulting `finalized-scan.json` and finalized room into the maintained `sf88-operator-buyer-cli/python/examples/semantic_analysis.py` workflow. That workflow retains the exact dictionary while creating the original dataset source, SQL aliases, saved queries, reports, workbook handover and database backup/reopen. Review the physical-to-SQL column mapping explicitly; the Northwind operation uses `OrderID` to `order_id`. The source CSDL type, precision, scale, nullability and original key remain separate from SQL storage choices.

Use the original configured buyer runtime when executing a paid request. Its returned source response enters the same SF100 receiving flow, and its existing signer, payment and request-recovery behavior applies.
