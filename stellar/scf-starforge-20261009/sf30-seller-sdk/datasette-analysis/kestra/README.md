# Native Kestra/JMS source and report workflow

This directory connects conapi's original JMS and Kestra components to the installed Datasette/Analysis workflow. It carries a complete business request through source acquisition, the selected SQL/report, result publication, actual receiving, and editable handover. The worker retains the request, source edition, report run, result files, publication attempts and receiver receipt.

The native flows use the original `io.kestra.plugin.jms.Consume`, `RealtimeTrigger` and `Produce` classes. They call `../workflow_cli.py` for business state and the original Analysis implementation for source/report work.

## Installed source

| Component | Selected source | Purpose |
| --- | --- | --- |
| Kestra | 1.3.39 | Native subflows, stored ION messages and `ForEachItem` |
| JMS plugin | 1.4.11 | Original consumer, realtime trigger and property-based producer |
| Python script plugin | 1.14.0 | Process tasks with explicit input/output files |
| conapi JMS adapter | 1.0.2 | Optional producer using real native correlation and reply headers |
| Python | Existing installed Python 3.11+ | Workflow and flow renderer |
| Java | Kestra's selected Java runtime; helper compiles for Java 17+ | Native broker client and optional header producer |

`NATIVE_SOURCES.json` records the reviewed source files and their Git blob identities. This flow set targets the selected Kestra 1.3.39 interfaces. Reconcile a Kestra version upgrade against its actual native classes; `ForEachItem` is a versioned dependency.

## Complete flow set

The checked-in `flows/*.yaml` files contain JSON syntax, valid YAML, with a coherent commissioning configuration. `render_flows.py` writes the complete native definitions for the actual namespace, broker and mounted workspace.

| Flow suffix | Result |
| --- | --- |
| `process` | Retains the full original JMS message, runs its installed source/report profile, prepares its exact result, publishes it, and records the producer's actual count. |
| `consume` | Receives a native batch into Kestra storage and starts the process subflow once for every full message. |
| `realtime` | Passes each original realtime trigger message to the same process subflow. |
| `recover` | Republishes an original retained result through its original attempt, delivery identity and result hash. |
| `receive_result` | Selects the exact correlated result, retains the full native message and business result, and returns the original receiver's receipt. |
| `acknowledge` | Records that actual receiver receipt against the sender's original request. |

The native source/report state stays in `runtime.workspace`. The receiver uses its separate `runtime.receiverWorkspace`. Both are mounted private directories under the installed operator's control. Process tasks use the worker's installed Python and source, so the selected existing Analysis workspace and its dependencies stay available.

Each task receives business data through input files or environment values. Business request values are passed to the original CLI as individual arguments. The original JMS transport object is retained separately from the business request. A text message's original JSON text is preserved during intake; structured JSON data retains its full object.

## Select the original installation

Copy `deployment.example.json` to the installation's configuration directory and set:

- The actual namespace and flow ID prefix.
- The original DIRECT or JNDI `connectionFactoryConfig` and explicit provider JAR URLs.
- The request and result `destinationName` and concrete `destinationType`.
- The installed Analysis source directory, worker configuration and sender/receiver workspaces.
- The customer's actual intake mode, batch size and wait times.
- One explicit result correlation mode: `business-properties` or `native-header`.

The example uses ordinary Kestra secret references for the broker URL, username and password. Keep credential values in the installation's secret service. The same rule applies to JNDI credentials and credentials in connection properties.

`providerJarPaths` takes URLs such as `file:///opt/conapi/jms-libs/client.jar`. The selected JMS plugin converts these URLs into its provider classloader directly. Install the same broker client files where the Kestra JMS plugin and Process worker can read them. A deployment using multiple workers supplies the same source and private workspace mounts to the workers eligible for these flows.

The result destination in this deployment must match the installed worker profile's `delivery.jms`. Its `correlationMode` and optional `replyTo`/`replyToType` must match too. A saved request retains its original selected destination; recover it with that original installation selection.

The native destination enum is concrete `QUEUE` or `TOPIC`. Use a queue for results that must remain available before an independent receiver starts. The original native topic consumer is a live subscriber; its selected subscription must be active when those topic messages are sent.

Render the actual installation:

```sh
ANALYSIS_ROOT=/opt/tjlabs/merchant/stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis
python3 "$ANALYSIS_ROOT/kestra/render_flows.py" \
  --deployment=/etc/conapi/kestra-deployment.json \
  --output=/etc/conapi/rendered-flows
```

Import the six resulting native flow files into the selected existing namespace. The source process flow is shared by manual batch intake and realtime intake. `intake.mode=manual` leaves the realtime trigger disabled. `intake.mode=realtime` enables that original trigger; use the native consume flow when deliberately selecting a manual batch.

## Business properties and real native headers

The result body always includes the original `requestId` and `correlationId`, the stable `deliveryId`, `runId`, `resultSha256`, and complete `result`. That result identifies the original edition, Analysis run, files and editable archive.

The JMS properties are:

| Property | Exact value |
| --- | --- |
| `businessRequestId` | Original request ID |
| `businessCorrelationId` | Original correlation ID |
| `deliveryId` | Stable retained result delivery ID |
| `resultSha256` | SHA-256 of the complete canonical result |

In `business-properties` mode, the renderer uses the original native `Produce` with JSON serialization, persistent delivery, priority 4 and no expiry. It records the original `messagesCount` output. Receivers select the original correlation and delivery properties and validate the complete result body.

The selected `Produce` implementation creates its message from `data` and ordinary `headers` properties. It does not apply the native `JMSMessage.correlationId` or `replyTo` fields. The adapter's ordinary property map calls `setObjectProperty`. A property called `JMSCorrelationID` therefore cannot establish the native correlation header.

For an existing API or broker client that uses actual `JMSCorrelationID` or `JMSReplyTo`, select `native-header`. The supplied standalone producer calls the real adapter methods `setJMSCorrelationID` and `setJMSReplyTo`, then records its actual one-message send and provider message ID. It uses the same resolved original connection factory, credentials, provider JAR URLs and filtered-classloader choice.

Build and install that selected optional producer:

```sh
mvn -f "$ANALYSIS_ROOT/kestra/native-header/pom.xml" -DskipTests package
install -D -m 0644 \
  "$ANALYSIS_ROOT/kestra/native-header/target/conapi-native-header-producer.jar" \
  /opt/conapi/conapi-native-header-producer.jar
```

Set `runtime.nativeHeaderJar` to that installed file and render the flows again. Kestra resolves the original connection values through task environment entries; the bridge sends the resolved configuration to Java through standard input. The configuration and credentials are excluded from the producer's output. The helper's structured receipt contains the actual publication identities and count.

The optional reply destination is the trusted installed worker profile's `delivery.jms.replyTo`. The original business message cannot redirect a result to an arbitrary broker destination.

## Process the original customer request

The business request selects an already installed profile. For example, the selected customer's gateway might emit:

```json
{
  "requestId": "customer-feed-20261012-001",
  "profile": "customer-feed",
  "correlationId": "customer-feed-20261012-001",
  "parameters": {}
}
```

The customer's actual request identifiers and selected profile replace these commissioning values. The profile contains the original source selection and useful report configuration. Send the business JSON as the body of the original JMS request; the native trigger/consumer supplies its complete transport envelope.

The process flow records its actual Kestra execution identity. Task retries derive the same publication attempt from that execution. A redelivered business request continues through the original worker's request identity. Its completed result retains the same delivery identity and result hash.

The original JMS consumer uses CLIENT_ACKNOWLEDGE. It acknowledges messages during native acquisition; the complete batch's storage URI becomes a task output after consumption. The realtime trigger acknowledges after emitting its execution. The gateway/client retains the original request ID and retries that same business request when business acceptance or completion is still outstanding. Broker acknowledgement, saved business acceptance, result publication and business receiving are separate steps in that protocol.

Kestra retains completed native task outputs and subflow identities. When a later source/report task needs continuation, resume that original failed subflow or task using its original input. The worker resumes the retained source/report operation and preserves the accepted edition and output identities.

## Receive the exact result

Start `receive_result` with the four values from the original result tracking record:

- `requestId`
- `correlationId`
- `deliveryId`
- `expectedResultSha256`

The flow builds a native selector containing the original request, correlation and delivery properties. Single quotes inside identifiers are escaped as JMS SQL string literals. Native-header mode also selects the real `JMSCorrelationID`.

The original `Consume` task reads one matching result into native storage. The bridge passes the complete object to `workflow_cli.py receive-result`. The original receiver checks body/property/expected identities, the native header when selected, the computed delivery identity, and the complete canonical result hash. It retains the original native message and complete envelope. A repeated matching delivery returns its same original receipt and marks the current handling as a replay.

The flow's `receiving` output contains the actual receipt under `receipts[0]`. A timeout returns `status=WAITING` and an empty receipt list. Run the same selection again as the original request continues.

Return that original receipt through the customer's existing completion route, or supply it to the `acknowledge` flow with the original request ID. The sender then records the actual received-result outcome. The original callback implementation uses the same retained result/receipt contract when the customer selects an API callback.

## Continue an interrupted publication

Read the original operation history:

```sh
python3 "$ANALYSIS_ROOT/workflow_cli.py" status \
  --workspace=/var/lib/conapi/workflow \
  --request-id=customer-feed-20261012-001 \
  --history
```

The retained history identifies the original publication attempt and result. A native producer output showing `messagesCount=1` can be received through the original `published` or `reconcile` command. An actual customer receipt is received through `acknowledge` or `reconcile`.

If the producer's completion was lost, run `recover` with the original `requestId` and `attemptId`. It exports the already retained result, publishes through the selected original route and records that actual producer output. The receiver's stable delivery identity and result hash make the same result safe to receive repeatedly.

The recover flow starts from the saved result. Source/report continuation uses the original process operation. This keeps publication recovery connected to the accepted source edition and report.

## Complete editable handover

The renderer writes `flow-delivery.json` containing the complete selected deployment, every rendered native flow definition, each rendered file's SHA-256, and the selected source versions. Bind this complete file to the worker profile:

```json
{
  "flowDelivery": {
    "path": "/etc/conapi/rendered-flows/flow-delivery.json"
  }
}
```

The original workflow exporter retains that full file with its hash alongside the original request, source/report history, result files, Analysis archive, maintained application source and editable Kestra source.

Receive the outer handover through `workflow_cli.py receive`. Recreate its exact native flows from the retained complete flow delivery:

```sh
python3 "$ANALYSIS_ROOT/kestra/render_flows.py" \
  --receive-delivery=/path/to/received/flow-delivery.json \
  --output=/etc/conapi/received-flows
```

The renderer verifies each original definition against its declared SHA-256 before recreating the selected flow files. The received deployment can then be copied, rebound to the receiving installation's paths and ordinary secret references, and rendered as an editable successor.

Commission the complete operation against the selected original feed and report: receive the request, inspect its full source edition and useful report, receive its correlated result, return its actual receipt, export the complete project, reopen it in the independent receiving installation, and continue the original project. Retain that original native runtime/source selection with the same company workshare.

## Primary implementation references

- [Original JMS plugin 1.4.11 source](https://github.com/kestra-io/plugin-jms/tree/v1.4.11)
- [Original Produce implementation](https://github.com/kestra-io/plugin-jms/blob/v1.4.11/src/main/java/io/kestra/plugin/jms/Produce.java)
- [Original connection factory configuration](https://github.com/kestra-io/plugin-jms/blob/v1.4.11/src/main/java/io/kestra/plugin/jms/configuration/ConnectionFactoryConfig.java)
- [conapi JMS adapter 1.0.2](https://github.com/conapi-oss/jms-adapter/tree/v1.0.2)
- [Native JMS message header implementation](https://github.com/conapi-oss/jms-adapter/blob/v1.0.2/src/main/java/at/conapi/oss/jms/adapter/impl/MessageAdapter.java)
- [Kestra 1.3.39 stored-message parsing](https://github.com/kestra-io/kestra/blob/v1.3.39/core/src/main/java/io/kestra/core/runners/pebble/functions/FromIonFunction.java)
- [Python script plugin 1.14.0](https://github.com/kestra-io/plugin-scripts/blob/v1.14.0/plugin-script-python/src/main/java/io/kestra/plugin/scripts/python/Script.java)
- [conapi's original gateway and asynchronous workflow architecture](https://conapi.at/gravitee-kestra-integration-apis-workflows/)
