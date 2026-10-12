# OpenLineage native Merchant and Java receiving

This directory contains the complete source and serial execution programme for the Merchant/Java leg of `SCF-OPENLINEAGE-OPERATIONS-6804-20261012`.

## Contents

| File | Purpose | Git blob |
| --- | --- | --- |
| `source-packet.json` | All 51 source files, including the corrected Merchant configuration writer, native Java launcher and complete receiving programmes | `f623ffd52e2f1c200055576abe907ba9abdfc431` |
| `run-native.py` | Materialize that exact source, run Merchant, run the official Java producer in the same workspace, and retain complete results | `4782e252a10722531dd3515302070f3524871441` |

The source packet identifies every contributing source carrier. The Java launcher and guide are the actual local adapter postimages from the original SDK integration, not the upstream SDK source distribution. The maintained product composition continues in `woahwhattheheck/tjlabs-stellar-merchant-workspace`.

## Execute on the existing native host

Use Python 3.9 or later, Node.js 22 or later, an installed JDK 17 or later, and network access to the public source blob and Maven Central. The programme acquires Apache Maven 3.9.9 and verifies its fixed SHA-512 before extracting it. It uses the selected runtime's existing proxy configuration.

Continue the existing operation in the original coordination thread. BBBD's native host is receiving this Merchant/Java leg serially after its Python operation:

https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791824600472959?thread_ts=1791730220.899469

From this directory, select an ordinary persistent workspace for the operation:

```sh
export COMMONS_OPENLINEAGE_OPERATION_DIRECTORY="$PWD/openlineage-native-run-9f05"
export COMMONS_OPENLINEAGE_JAVA_HOME="/absolute/path/to/jdk"
python3 run-native.py > openlineage-native-run.jsonl 2>&1
```

If `COMMONS_OPENLINEAGE_JAVA_HOME` is omitted, the programme first tries the retained JDK path and then the JDK containing `javac` on `PATH`. Set the operation directory explicitly so all exports and original workspaces remain accessible after the process ends.

The collector verifies the complete source's Git blob hash before writing it. An existing operation directory must retain the same source bytes. A completed Merchant operation is reused with its workspace and source hashes checked; an interrupted operation continues through its retained receiving checkpoints.

## What the programme exercises

The Merchant programme uses the actual application server and separate operator and producer credentials. It exercises the official source fixtures, plain and gzip intake, concurrent immutable configuration, original operation recovery after a real writer failure and source-file move, repeat delivery, saved editions, restart, reconnect, credential rotation, complete export and independent reopening.

The Java programme uses the official OpenLineage Java SDK and the maintained four-file local adapter. It records native serialization and HTTP response artifacts for ordinary delivery, wrong-workspace rejection, writer recovery, JVM restart and delivery into an independently received application. Java joins the completed Merchant workspace through the same operation's local token files.

## Retrieve the full result

The collector first saves the complete Merchant archive, then retains the complete Java archive. Files remain under the selected operation directory:

- `openlineage-merchant-9f05-corrected-complete.tar.gz`
- `openlineage-java-9f05-complete-complete.tar.gz`
- `serial-native-result.json`
- `merchant-operation/` and `java-operation/`, including the full saved workspace exports
- `runtime-acquisition.json`, plus retained preparation and invocation results

An interrupted run retains `openlineage-java-9f05-interrupted-complete.tar.gz` and the original error. Each archive is emitted as a complete base64 record with its byte count and SHA-256 in the JSON-lines output; a shared-memory copy is also attempted when that host supports it.

Archives include the exact source, original workspace objects, complete exports, native wires and responses, per-invocation results and selected runtime manifests. Private credential/configuration files and dependency caches are excluded. Upload the complete binary archive and its native result to the original Slack thread so another seat can reopen the same workspace.

The final `complete` record and the original programme results determine execution success. This source handoff is the runnable input for that operation.
