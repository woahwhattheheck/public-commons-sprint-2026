# OpenLineage producer and operator handover

Receive pipeline events, inspect their original bytes, review a saved edition, and deliver the whole editable workspace to the next operator. The browser, native producer endpoint, command line, typed client and merchant tools operate the same saved project.

## Open the delivered project

Extract the customer handover and start its included application with Node 22 or newer:

```sh
node editable-workspace/application/cli.mjs serve \
  --workspace editable-workspace --port 0
```

Open the actual local URL printed by the command. The delivered example retains the unchanged upstream OpenLineage event files, three saved editions, the original operator review, a customer receiving review with its previous decision, and the complete schema review and attached source reference. Select **Current workspace** to see the latest review history. The complete JSON, CSV and HTML reports are in `reports/`.

The source and upstream fixture licenses are included. The full application is editable under `editable-workspace/application/`; no npm installation is needed for the local application. The delivery manifest identifies every included file by byte count and SHA-256.

## Commission an actual producer

Use a new owned workspace for the customer's pipeline:

```sh
node editable-workspace/application/cli.mjs init \
  --workspace /absolute/customer/pipeline --title "Pipeline operations"
node editable-workspace/application/cli.mjs serve \
  --workspace /absolute/customer/pipeline --port 8767 \
  --token-file /absolute/private/operator-token \
  --producer-token-file /absolute/private/producer-token
```

The two token files contain different values of at least 24 characters. Keep them in the receiving host's private configuration. Use the printed connection to open the browser, then select **Connection** and enter the operator token.

In **Producers**, inspect the native endpoint and current queue. Choose Python or Java, enter the producer token, and download the complete client configuration. The file contains the selected producer credential and belongs in private configuration. Point the client's existing configuration loader at it through `OPENLINEAGE_CONFIG`. Generate a new configuration from the actual connection if the selected host or port changes.

The application includes the original native Python, Java and asynchronous Python producer guides. Use `PYTHON_PRODUCER.md`, `JAVA_PRODUCER.md` and `ASYNC_PYTHON_PRODUCER.md` for their complete preparation and execution commands. Their dependency locks and source bytes travel with the application.

The browser's receiving counters report the running server instance. The original sources and operation history stay in the saved workspace. Preserve an unacknowledged body and its operation identity; retry those same bytes after an interrupted response or a `503` response with `Retry-After: 1`. The workspace commits the original source and operation before acknowledging intake. A restart retains the workspace identity and the committed replay.

## Operate and review the original events

1. Select **Import source** for complete JSON, NDJSON or gzip files. A `.gz` filename selects gzip automatically. Keep the original source reference with the import.
2. Open **Sources**, inspect the selected file and choose **Read decoded event source** for gzip. **Download original gzip file** returns the unchanged compressed bytes. The inspector also offers the verified decoded source.
3. Inspect **Runs**, **Jobs** and **Datasets**. Their namespaces form part of identity. **Events & facets** and **Lineage** retain the original producer observations.
4. Select **Save edition** to retain the current event and source selection. A later producer import leaves that selection intact.
5. Open an entity and select **Record review**. Choose the decision and write its reason. **Edit review** retains the previous review in **Previous decisions**.
6. Use **Schema changes**, **Quality** and **Service levels** for their selected operating workflows. Their included guides explain the saved comparison, evaluation and decision contracts.
7. Select **Export** for the complete editable workspace, or the current view's HTML, JSON or CSV report. The complete export preserves original sources, attached results, editions, reviews, operations and all portable application files.

## Receive and continue independently

Verify a complete export, receive it into a new directory, and start the application installed in that received directory:

```sh
node editable-workspace/application/cli.mjs verify --input complete-workspace.json
node editable-workspace/application/cli.mjs receive \
  --input complete-workspace.json --out /absolute/customer/received
node /absolute/customer/received/application/cli.mjs serve \
  --workspace /absolute/customer/received --port 0
```

Select the same original edition or **Current workspace**, continue the review and export the new saved state. Receiving retains the original workspace, sources, event identities, editions, reviews and operation IDs. The new local installation has its own receiving record and server instance.

For the maintained Starforge installation, use `products/openlineage/OPERATING.md` in the source repository. It carries the `openlineage-operations` source selection through the original builder, runtime installer, Applications lifecycle and merchant host.

## Run the included native operating programmes

Use a new owned directory for the complete original operator journey and a separate directory for the resumable producer journey:

```sh
node editable-workspace/application/RECEIVING.mjs /absolute/private/operator-receiving
node editable-workspace/application/PRODUCER_RECEIVING.mjs /absolute/private/producer-receiving
```

The operator programme verifies the unchanged upstream fixtures, uses the original merchant and MCP owner, records editions and reviews, retains complete reports and export ranges, receives a separate editable workspace and starts its included application. Its original operating catalog remains selected when schema, quality and service-level actions extend the installed catalog.

The producer programme performs simultaneous plain/gzip arrivals, exact replay, actual writer backpressure, private client-configuration authoring, server restart, complete export and independent receiving. Repeat the same producer directory to continue its original checkpoint after an interruption.

Both programmes retain their complete native output in the owned operation. The delivered customer example also completed desktop and 390-pixel browser operation, exact original gzip download, producer settings, saved review, complete browser export, independent receiving and review continuation.
