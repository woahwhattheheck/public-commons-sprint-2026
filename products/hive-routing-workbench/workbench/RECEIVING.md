# Delivering and reopening the whole application

## Export

Finish the current programme and its complete review. Stop native processes when delivering their final completed logs. Use **Delivery → Create complete ZIP**.

The exporter freezes the current saved database, verifies every original object, adds the complete application source, and writes one ZIP. The final archive is published only after its member bytes and original workspace have been read back successfully.

The browser downloads the exact saved archive. Its result includes the path, byte count, SHA-256, source-file count, member count and original workspace identity.

A command-line export uses the same controller:

~~~bash
python3 -m hive_desk action /work/hive/customer-workspace delivery.export --data-file export.json
~~~

export.json can select a new destination:

~~~json
{
  "destination": "/work/hive/delivery/Hive_Customer_Complete_Workspace.zip"
}
~~~

Browser downloads use archives created beneath that workspace's deliveries directory. An explicit command-line destination remains available through the selected filesystem.

## Inspect the original edition

The complete ZIP has manifest.json, source/ and workspace/. The manifest identifies every original member, source pin, saved workspace and revision history.

Inspect verifies all paths, full member sizes and SHA-256 values, the saved SQLite workspace and its original ancestry. It rejects duplicate or missing members, changed contents, symlinks and paths outside the selected edition.

Use **Inspect edition** for the selected archive. **Compare history** identifies its relationship to the current saved workspace without changing either edition.

## Receive

Choose a fresh destination and receive the complete archive:

~~~bash
python3 -m hive_desk receive /work/Hive_Customer_Complete_Workspace.zip /work/hive-received
~~~

The receiver reconstructs the source and saved workspace in a temporary directory, verifies the original objects and revision, then publishes the complete selected destination. It retains the original workspace identity and every saved entity.

Open the received application from its source directory:

~~~bash
cd /work/hive-received/source
python3 -m pip install -r requirements.txt
python3 -m hive_desk serve /work/hive-received/workspace --port 8794
~~~

The original edition files, programmes, reviews and deployment history are ready to inspect immediately.

## Commission the receiving host

Select the receiving host's exact original release executable and existing environment. Preparing the deployment binds that new local installation; it creates a distinct local deployment even when the source edition is identical.

Start the receiving native deployment and review its actual readiness/log. Run the full original client programme, inspect every response and save the complete review. Select the receiving deployment for the local endpoint.

Earlier native process IDs and absolute source-host paths stay in historical records. The receiving host gets its own actual native process identities and local paths when it prepares its deployment.

After the receiving programme and review, create a fresh complete export to carry the receiving installation's work forward. Keep the original incoming ZIP and the new complete edition available for history comparison.

## Delivery contents

| Part | Purpose |
| --- | --- |
| Original complete editions | Configuration, supergraph, client operations and supporting files |
| Original native responses | Full response bodies, HTTP metadata and request selections |
| Native deployment history | Original executable identities, attempts and completed logs |
| Engineering reviews | Decisions for every configured feature and client outcome |
| Selected endpoint history | Cutover and rollback decisions tied to the current reviewed process |
| Complete source | Operator, native control, browser, reference programme, guides and upstream provenance |
| Saved workspace | Original immutable objects, entities, event history and revision |

The application uses the operating guides and source that travel in the ZIP; a receiving installation does not depend on a previous chat session.
