# Original supplier-order receiving

This command continues a complete openTRANS 1.0 supplier workflow in the product's original SQLite workspaces. It preserves publisher XML, every prepared document and saved revision, complete producer and customer ZIP packages, and the exact inputs of each native operation.

The entrypoint is `supplier-orders/receiving/supplier-orders-native.mjs`. It exports `runSupplierOrderNativeReceiving` and a direct command.

## Original source selection

The supplied source index is `supplier-orders/source/opentrans-source.json`. Its original author archive is:

- URL: https://www.digital.iao.fraunhofer.de/content/dam/iao/ikt/de/documents/openTRANS_1_0_complete_eng.zip
- Captured: 12 October 2026, 11:16:34 UTC.
- Complete archive: 4,161,866 bytes.
- SHA-256: `baae9ea0e1363f98aa2323570456fdc384423af330ca95fa27e3769075cb521a`.

The index pins five complete DTD files, four original XML examples, and the complete publisher ReadMe notice. The native parser resolves the selected document's captured DTD and its captured `openbase_1_0.dtd` dependency. Each example's bytes and SHA-256 are checked before intake.

The examples use order `PO4500002323` and supplier `UEG-FB5-BLI`. The original order contains lines `P100012` and `P100028`, quantities 20 and 4, unit C62, and net total EUR 180. The following receiving steps derive their quantities, prices, parties, and delivery periods from those complete original records.

## Invoke the complete operation

Use Node 24 or later with Python 3 available. Supply the existing or selected producer and customer workspace paths explicitly. The output directory, producer directory, and customer directory are distinct.

~~~bash
node supplier-orders/receiving/supplier-orders-native.mjs \
  --directory /absolute/receiving-output \
  --producer-workspace /absolute/original-producer \
  --customer-workspace /absolute/original-customer \
  --operation-id SCF-SUPPLIER-ORDERS-2769-20261012
~~~

The source index defaults to the original file installed beside the product. `--source-index /absolute/source/opentrans-source.json` selects that same complete index from an explicit source location.

The module API is:

~~~js
import { runSupplierOrderNativeReceiving } from './supplier-orders/receiving/supplier-orders-native.mjs';

const report = await runSupplierOrderNativeReceiving({
  directory: '/absolute/receiving-output',
  producerDirectory: '/absolute/original-producer',
  customerDirectory: '/absolute/original-customer',
  operationId: 'SCF-SUPPLIER-ORDERS-2769-20261012',
  onProgress(event) {
    process.stderr.write(JSON.stringify(event) + '\n');
  }
});
~~~

An existing empty workspace can be supplied. Its workspace ID is retained in `workspaces.json`. On continuation, use the same operation ID, directories, and source selection. The command checks those identities before continuing.

## Complete receiving flow

The initial native pass parses and re-emits all four original document kinds, then parses the resulting XML again. It compares the complete semantic trees and retains original and emitted files. The unchanged examples are imported into the producer, with their full findings retained.

The supplier operation proceeds through native saves, preparation, and current selection:

1. Confirm the full original order.
2. Cancel one tenth of the first line using a sparse current response. A later response revision retains the same cancellation quantity. The second line retains its prior confirmation.
3. Restore the full confirmed quantities.
4. Prepare a half-quantity dispatch of the first line, then revise the same business dispatch to three fifths of the original quantity.
5. Dispatch the exact remaining quantities in a second business document.
6. Prepare an invoice with three native lines, each carrying its original delivery-note and line reference. The original net total is EUR 180 and the explicit line-rounded tax total is EUR 28.80.
7. Save a later invoice revision with equivalent signed exponent NUMBER strings. Reopen the original earlier preparation request and its exact retained XML.
8. Render an invoice revision containing an over-quantity and USD currency, import and select that native XML, observe the original order's REVIEW findings, and restore the retained valid invoice.

The first producer delivery is a complete native ZIP. The receiving program also exercises its original-source binding: it changes one normalized quantity in a copy, recomputes the record, snapshot, and ZIP metadata through the original archive engine, and submits that complete copy to the customer receiver. The unchanged XML causes `ORDER_PACKAGE_SOURCE_PROJECTION_DIFFERS`. The original customer business rows remain unchanged. The rejected archive and failed native operation are retained.

The valid package is then inspected and merged into the customer workspace. The customer saves a local revision of the inherited invoice. Independently, the producer advances the same draft and order history further and exports another full ZIP. The customer imports this ahead history, retains its own current selection, and saves its next local revision using the same upcoming revision numbers. A fresh import of the earlier producer package preserves that later customer state.

Finally, both workspaces export complete deliveries, close, reopen their native SQLite stores, re-read all immutable documents and files, verify the recorded operation results, and close again.

## Retained output

| Path | Complete retained content |
| --- | --- |
| `operation.json` | Original macro operation, source index and file selection, directories, and first implementation. |
| `workspaces.json` | Original producer and customer workspace IDs. |
| `requests/` | Exact native requests, including source pins, revisions, state hashes, and reasons. |
| `phases/` | Completed phase results, original operation receipts, selected current states, and artifact identities. |
| `originals/` | Unchanged publisher XML, native round trips, and the explicitly authored source-review invoice. |
| `documents/` | Every prepared native output used by the complete workflow. |
| `packages/` | First producer ZIP, ahead producer ZIP, final customer ZIP, and the rejected source-binding archive. |
| `implementations/` | Actual implementation paths, lengths, and SHA-256 identities for each invocation. |
| `attempts/` | Interrupted outcomes and later completed-report reopen observations. |
| `report.json` | Full successful receiving report after both workspace lifetimes have closed. |

Successful reports have schema `stellar-forge.supplier-orders-native-receiving.v1`, status `PASS`, and `lifetimes: "CLOSED"`. They include full phase results, native operation IDs, source and document identities, final customer draft identity, and complete export paths.

The following operator/MCP receiving phase should consume:

- `workspaces.producer` and `workspaces.customer`: explicit directory, workspace ID, and order ID.
- `artifacts.producerPackage` and `artifacts.customerPackage`: complete path, length, SHA-256, and native file ID.
- `artifacts.firstProducerPackage`: the earlier complete source package retained for replay.
- `current.customerDraftId` and `current.customerDraftRevision`: the actual customer continuation point.

## Continue the original invocation

Each native input is saved before its action. Completed actions are reconciled against the original workspace operation journal. Completed phases reopen their exact files and recorded operation outcomes.

If an original operation is FAILED or INTERRUPTED, the command reports that actual outcome and retains its request ID and source files. Resolve the recorded cause using the original workspace and invocation. A terminal attempt remains part of the original history.

A completed report can also be reopened. The command rechecks its immutable source and output files, original operation outcomes and document records, reads the actual current producer and customer selections, and closes both workspaces. Later operator edits remain in place. The original completed report is preserved; a separate reopen observation records current state.

The source notice remains at `supplier-orders/source/ReadMe.txt`. Publisher examples, specification material, and authored receiving records retain their separate source identities.
