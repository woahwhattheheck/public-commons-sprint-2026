# Operate the complete live OData customer edition

This operation turns the original five saved Northwind live responses into a complete customer edition. It uses the maintained OData service, collection engine, Analysis workspace, report publisher, workbook delivery and workspace receivers. One private operation directory retains the actual selected inputs, native job IDs, immutable outputs and completed receiving results.

The operation selects all 830 Orders delivered by the original live query. It keeps the original seven fields, declared key, Decimal text, date text, value/null states, page chain, source count and acquisition window. The resulting customer can open the complete report and workbook immediately, then restore either application to continue working with the original source.

## Source and original input

Use the public Stellar Forge product source at **677ba67611b869daed454d689ddc0201ae7a4654**, including its complete original Node and Python dependencies. Apply this directory's two example files from the same published example revision. The Python runner validates the actual Git blob, byte length and SHA-256 of every selected critical product file and the original Node helper before starting work. It records that selection in the operation and customer delivery.

The runtime needs the original Node 24 environment and the existing Python Analysis/workbook dependencies, including openpyxl. Reuse the equipped original runtime; its dependency directories belong to their original installer. A thin checkout is suitable when it contains the complete original import closure and the exact reviewed leaves. The expected leaf identities are embedded in collection-customer.py.

The original receiving packet is selected by the operator's local directory. It contains packet.json, the original workspace/service/package and these exact response files:

| Original response | Bytes | SHA-256 |
|---|---:|---|
| responses/response-1.json | 47,571 | 10065438cad897db2daf2a8d35ba5b89ddaf2ade7d7b17ae28a8732bd5034309 |
| responses/response-2.json | 47,561 | 91022bac4f3f2b56cd89c4e18f6463a4394acda96aa31109f255f3b80ef1679b |
| responses/response-3.json | 47,436 | bbb922c01aa1204cb437bc47cdb04b9427294d58c55896194ae7b4e910cb480f |
| responses/response-4.json | 47,462 | 5842451780ac1efe5a52db66ada610dae33b80bae30f0e2d490f3c1e70edc143 |
| responses/response-5.json | 7,841 | 17b88c3513eb28e5f6f41cc517ae39fdb5726256bc757bce81e3121e0550eb70 |

Source binding: d0504cda1d10b0af1e6539147daaff189cd6502897587a76374d0dc0171f60ec.

Query fingerprint: 0b209a8f9bd385e382879e8c54d5c93c1a17cba66821ef42bf9602159ad672be.

The selected fields are OrderID, CustomerID, EmployeeID, OrderDate, Freight, ShipCountry and ShipName. The original query orders by OrderID ascending and has top=830. The retained chain delivers 200, 200, 200, 200 and 30 rows; its final response records the selected limit and has no next cursor. The packet's original workspace, service profile and package manifest identities are verified before receiving begins.

## Run the whole customer operation

Choose absolute paths for the original source, extracted retained packet and one new private output directory. Set NODE to the actual original Node 24 executable.

```sh
SOURCE=/absolute/path/to/original-source
PACKET=/absolute/path/to/original-odata-packet
OUTPUT=/absolute/path/to/private/odata-customer
NODE=/absolute/path/to/node

umask 077
python3 -B "$SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/odata/live/examples/collection-customer.py" \
  --checkout "$SOURCE" \
  --packet "$PACKET" \
  --output "$OUTPUT" \
  --node "$NODE" \
  --source-ref 677ba67611b869daed454d689ddc0201ae7a4654
```

Run the same command with --resume after an interruption. Keep the same selected source, packet and output. The original operation lock also remains inherited by its Node child, so another caller cannot begin the same operation while that child is active.

The Python process emits progress for the actual native jobs. customer-operation.json retains each original request and ID before launch. Completed jobs reopen through their original APIs; a failed or interrupted job is reconciled before a reviewed resume records another attempt. The Analysis archive receiver retains its own original receiving operation. Its first observed completion stays in the customer receipt while later reuse is recorded in the operation journal.

A completed invocation prints the final archive name, byte length and SHA-256. Repeating --resume after COMPLETE verifies that exact retained archive.

## What the operation performs

The Node phase opens the original retained OData workspace long enough to create its maintained backup, then closes it. It restores that backup into the selected private customer operation. Through the actual original loopback service, it opens the collection UI assets, receives all five original live envelopes, selects their complete ordered chain and creates northwind-orders-complete. It repeats the same immutable selection, reopens the collection from the service inventory and reads every original row through the actual paginated collection route.

The same phase downloads the CSV, original rows, row index and Analysis source document through the service's declared file route. It verifies those bytes against the native collection manifest. The complete original OData backup includes the original service, selected pages and all collection files. The operation restores it into another original workspace, checks every record, closes that workspace and opens it again.

The Python phase then operates the existing Analysis application directly:

1. Register the actual collection source document at its returned original source revision.
2. Preview and import all seven fields plus their value/null-state columns.
3. Activate the retained version as northwind_live_orders.
4. Save and execute northwind_original_orders and northwind_country_summary. Compare all 830 original values, types, null states and row order with the retained supplier responses; independently compare the country counts and null counts.
5. Export the original query through the native JSONL, CSV and SQLite result exporter.
6. Save and publish a report with both original records and the destination-country summary. Export the actual published report as HTML, JSON and a CSV bundle.
7. Build an original two-sheet workbook from the typed query export and the published summary section. Receive the native workbook handoff into an independent workbook directory and reopen its full original manifest.
8. Review and export the complete Analysis workspace. Receive it through the original archive receiver, reopen the saved report and workbook, and execute the original SQL over the restored source.
9. Recover the complete OData collection from the source document retained inside that independently received Analysis workspace. Compare its manifest and every original value with the initial supplier responses.
10. Assemble and verify the final customer edition from those exact outputs.

The source operation receipt names the actual OData routes and their returned byte identities. The Analysis receipts identify saved native queries, jobs, report publication, workbook manifest and workspace receiving operation. The caller's completed result is the record of the actual execution.

## Customer delivery

The final OData_Complete_Customer_Edition.zip contains:

| File | Customer use |
|---|---|
| START.md | Open the worked edition and run the original receiving/application commands. |
| OData_Customer_Report.html | Read both sections of the complete published report. |
| OData_Customer_Report.json | Retain the native published report structure and values. |
| OData_Customer_Report.zip | Receive both report sections as the original CSV bundle. |
| OData_Collection_Workbook.xlsx | Work with the original Orders and country summary in a spreadsheet. |
| OData_Collection_Workbook.zip | Receive the original workbook, selected typed inputs and definitions. |
| Original_Orders.json and .csv | Reuse the full native original-row query result. |
| Country_Summary.json and .csv | Reuse the same-source country and null-count result. |
| OData_Analysis_Workspace.zip | Restore the complete original Analysis workspace and continue saved work. |
| OData_Collection_Workspace.json | Restore the original OData service and completed collection. |
| source-selection.json | Identify the actual original packet, responses and selected critical product source. |
| worked-customer.json | Identify the actual collection, Analysis version, report, workbook and independent receiving results. |
| customer-files.json | Verify the exact selected file names, byte lengths and hashes. |

The archive is produced at one journaled candidate path. The operation verifies complete membership and all member bytes before installing the final name. A complete candidate with different membership or content is retained for review. Only the operation's unfinished candidate with a missing or truncated ZIP end record can be retired and rebuilt after its current identity is saved.

The complete package contains the original query values and their typed companion exports. Freight remains Decimal text throughout; the source does not identify its currency. The selected-query completion, original page count, source count and source field definitions remain attached to the collection. These details let a customer inspect what was selected and continue from the same source in either original application.

## Receiving commands

START.md is generated with the actual Analysis archive SHA-256. It includes the native receiving command and the original application launch:

```sh
export PYTHONPATH="$SOURCE/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python"
python3 -B -m stellar_forge_buyer.workspace_archive_receive receive \
  "$DELIVERY/OData_Analysis_Workspace.zip" "$RECEIVING/analysis" \
  --sha256 ACTUAL_ARCHIVE_SHA256
python3 -B -m stellar_forge_buyer.analysis_workspace \
  --database "$RECEIVING/analysis" --checkout "$SOURCE" --node "$NODE" serve
```

For the OData operator, select an empty receiving workspace and restore the full transfer:

```sh
"$NODE" "$SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/odata/cli.mjs" \
  --workspace "$RECEIVING/odata" restore --input "$DELIVERY/OData_Collection_Workspace.json"
"$NODE" "$SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/odata/cli.mjs" \
  --workspace "$RECEIVING/odata" serve --port 0
```

The existing browser Restore handles transfers up to its declared 64 MiB input ceiling. For a larger complete collection transfer, the original UI supplies this native-file route and the actual selected workspace/CLI. The native receiver reads the complete file and preserves the same original transfer validation and workspace ownership.

## Original workspace identity and preflight continuation

The retained packet's workspace hash is its original creation identity: schema,
original directory and creation time. The original workspace identity reader
validates that record; a receiving-directory relocation retains its original
directory in the identity comparison. The complete reference workspace file is
also checked separately against its original 123,591 bytes and SHA-256
`7b1b2b38bc9b574c53200f9f2708c64e980b73f92fb88625aae652cada653ea9`.
The prepared customer result retains both identities.

The first customer helper treated that creation identity as a whole-file hash
and could stop before it created any customer workspace or native job. For that
specific retained preflight, select the same input, output and product source,
and add `--resume --resume-source-from ORIGINAL_SELECTION_SHA256` to the command.
The prior SHA is `selection_sha256` in its existing `customer-operation.json`.
The runner requires the exact original selection, an empty step history and no
customer output beyond the original preflight records. It accepts only this
helper correction and the original identity-reader dependency, retains the full
prior selection and error in the same journal, and continues the same customer
operation. Once customer work exists, ordinary `--resume` keeps its original
source and complete native jobs.

## Continue the original native collection preparation

The collection uses the maintained SF82 per-directory `state.lock` lifetime lease for receiving, row reads, inspection and restore. The lease file belongs to the selected collection directory, and the original helper retains its inode and closes its descriptor when that operation ends.

The first native customer operation exposed an unsupported `collection.lock` caller name before it created the collection. Its five received response pages and merchant workspace were retained in the same operation. The corrected source calls the existing `state.lock` contract and includes that original helper in the runner's immutable source selection.

To continue that exact pre-Analysis preparation, restore its complete operation checkpoint to the same selected output path, retain the original input packet, and run the command above with `--resume --resume-source-from 32b9b87f1ef85efeab180eb395e8c2434845b94a49b1abe655fb157239a4a652`. The runner preserves the previous selection and error, verifies every unchanged input and source, permits only the recorded identity/lease corrections, reopens the original received pages, and continues the original collection. An existing completed collection or Analysis job retains its original source selection.
