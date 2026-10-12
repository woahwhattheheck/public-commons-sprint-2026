# Kafka native customer receiving

Operation: SCF-KAFKA-MERCHANT-8F43-20261012  
Original product source: d6938e1f333d92670a653f47d136b7d7cfb3abfa  
Repository: https://github.com/woahwhattheheck/public-commons-sprint-2026  
Merged product: https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1731  
Merge: 1f4ff9ac0c2928f0c7913261bbe380aeda24abd2 (the original 66 receiving source files at d6938e1f are unchanged)

## Complete operation

This packet materializes the exact original Kafka, NDJSON, dataset, seller, merchant and customer SDK source. Its original Kafka Applications binding remains the same 26 files. The additional merchant source inventory carries the maintained release and developer modules that the original merchant preparation imports.

The driver creates one private, owned Apache Kafka 4.3.1 cluster. It publishes a single transaction with twelve retained records over two explicit partitions, plus one aborted transaction. The records exercise duplicate business payloads at distinct native offsets, exact large numbers and decimals, null/empty/binary keys and values, tombstones, ordered duplicate headers, and the Goldsky operation field. The actual native client and original product inspect and capture the source.

The full capture retains all twelve committed events across both partitions, including the deliberately null key in partition 1. A second original capture selects the same inspected partition 0 range, whose keys are all present (including the empty key). The broker stays open until both captures are COMPLETE.

The full capture becomes the audit projection using the original events view and retain deletion policy. The partition 0 capture becomes the current projection using the original latest-per-partition-key view and tombstone-or-goldsky deletion policy. Both then travel through the maintained dataset engine: reviewed mapping; native builds and queries; keyed comparison; complete seven-file project exports; original imports into a new customer workspace; same-edition reopen; and complete per-event reconstruction.

The running original customer console is opened in Chromium. The browser selects actual captured records, checks complete native JSON and raw bytes, downloads the selected event, opens the maintained mapping editor, runs the original dataset query, downloads the full Kafka project, and prepares the original merchant and generated customer SDK through the real merchant form. The native receiver inspects that whole merchant package and the original SDK export, imports the generated client, and builds its first request using the retained source, route and testnet payment terms.

The Kafka broker closes after both source captures and before the dataset/browser phase. The source workspace, exact capture revisions, selected partition ranges and customer operation stay the same.

## Software and capacity

Select one existing Python 3.11+ interpreter, Node 22.16+, Java 17+, and an existing Chromium executable. The carrier needs the original declared 768 MiB native memory envelope during the broker phase and storage for the official archive, extracted broker, exact client, small source and customer records. Admission uses actual available/reclaimable capacity on the selected carrier.

The lifecycle reuses an explicit existing Playwright module when provided. Otherwise it checks the known existing module locations, then acquires official playwright-core 1.64.0 once into this private operation. That package contains no browser binary and has no package dependencies. The selected Chromium executable is reused.

Confluent Python client 2.16.0 is installed from an official binary PyPI wheel into this private operation, with no dependencies on Python 3.11+. Its installer report retains the original URL and SHA-256. Existing system packages and other workspaces are untouched.

Official broker archive:

https://downloads.apache.org/kafka/4.3.1/kafka_2.13-4.3.1.tgz

Official SHA-512:

c7d7b2318cb51aa0c61d3246a51c349210073c5c9b754947ef965a439f2f939e8600f204e134a75ac31faf3829c9370960ef7c6a9886c8a1dbf0339a21f4c54c

Official checksum source:

https://downloads.apache.org/kafka/4.3.1/kafka_2.13-4.3.1.tgz.sha512

The original Apache 4.3.1 configuration is Git blob 7f1773d354ea1c30e16de259fc87d4b6b389408f in apache/kafka. The derived owned configuration preserves its standalone KRaft workflow and changes the private loopback addresses/log paths, worker counts, 16 MiB segment limits and compact internal topic counts. Java heap is 96–256 MiB, with two active processors. The original storage tool chooses the retained cluster UUID.

Primary software references:

- https://kafka.apache.org/quickstart/
- https://kafka.apache.org/43/configuration/broker-configs/
- https://github.com/apache/kafka/blob/4.3.1/config/server.properties
- https://github.com/confluentinc/confluent-kafka-python/blob/v2.16.0/requirements/requirements.txt
- https://docs.confluent.io/platform/current/clients/confluent-kafka-python/html/index.html
- https://github.com/microsoft/playwright/blob/v1.64.0/packages/playwright-core/package.json
- https://registry.npmjs.org/playwright-core/1.64.0

## Materialize and launch

This native operation uses the explicit example configuration origin https://kafka-workspace.example and route /events. The original merchant compiler prepares that configuration and generated SDK from the actual owned Kafka source. The selected example origin and exact testnet terms remain in merchant-request.json and the original generated OPERATING.md.

~~~sh
python3 native-source-bootstrap.py \
  --root /absolute/private/kafka-native-receiving \
  --merchant-origin https://kafka-workspace.example \
  --merchant-path /events
~~~

The supplied public testnet terms are exact: stellar:testnet; USDC SAC CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA; 10000 atomic units; payTo GDCPSCLRFZFT3RCAJ67DCNCTBQW3DLMRZYM4OWXCZI7J6XC3ZZKMGQOG; timeout60 seconds. This is the existing owned testnet account. The original network passphrase is Test SDF Network ; September 2015, and the USDC issuer is GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5. No account secret is part of this packet.

After the original carrier admits this one operation:

~~~sh
python3 /absolute/private/kafka-native-receiving/native-lifecycle.py \
  --root /absolute/private/kafka-native-receiving \
  --node /absolute/existing/node \
  --browser-executable /absolute/existing/chromium \
  --playwright-module /absolute/existing/playwright/index.mjs
~~~

Omit the final module option to use the existing module inventory and exact private fallback. To use an already-retained official broker archive, add --apache-archive /absolute/existing/kafka_2.13-4.3.1.tgz; its official digest is always checked. To acquire software before native memory admission, add --acquire-only, then run the same command without that option after admission.

The existing cloud executable and browser module paths have been read successfully:

- Node: /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node
- Chromium: /workspace/scratch/bc0850d7ba23/browser-runtime/chrome-headless-shell
- Java: /usr/bin/java
- Playwright: /opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs

The carrier should use its actual Python and executable paths. The selected original paths are frozen in lifecycle-input.json and receiving-input.json.

## Existing Commons native admission

On the currently selected D76C host, use the supplied native-admitted.py entrypoint after source materialization:

~~~sh
python3 /absolute/private/kafka-native-receiving/native-admitted.py \
  --root /absolute/private/kafka-native-receiving \
  --records /workspace/scratch/8f4370a17e6f/kafka-native-records
~~~

The launcher verifies the installed original 71-file runtime and the complete 66-file customer source, then uses its original ForegroundLaunch and swarm_cloud_job.start APIs. It retains the same operation ID and exact command. The selected lifetime requests 768 MiB memory plus the original 128 MiB admission reserve, 768 MiB project storage, and 128 MiB artifact-record storage. The official Apache directory lists the pinned broker archive as 130M; the project allocation covers that archive, extraction, native client, private broker logs, complete customer workspace and outputs. The lifecycle separately checks actual remaining archive/extraction bytes before writing them.

The original D76C host is /workspace/scratch/d76c9c89fb9e/native-prepared-stop-20261012/host. The launcher uses the observed existing Node, Playwright core and Chromium paths above. An equipped carrier can select the same complete installed host and actual executable paths through its explicit arguments. The native record retains selected runtimes, input identity, logs and completed artifacts.

If the original foreground is waiting for capacity after its connection ends, use the same native-admitted.py command with --resume. This invokes the maintained resume-capacity path for the same operation. Inspect and service the original returned record; do not create another Kafka operation or concurrent broker.

## Reopen the original operation

Run the same lifecycle command at the same root. It reuses the exact source, selected terms, retained broker cluster and original topic. Transaction initialization fences a previous interrupted producer, and the original read_committed capture decides whether the committed twelve records already exist. A checkpoint containing both COMPLETE captures skips the broker and continues the same dataset/customer operation.

The customer operation retains complete capture revisions, original build IDs, imported receiving IDs, whole source ZIPs and browser downloads. The merchant input identity is retained before its original POST. The completed download is published atomically to its final ZIP path. If only the separate receipt write was interrupted, reentry reads that same ZIP and reconstructs its receipt instead of preparing another merchant export. The original generated SDK completion file is preserved.

SIGINT and SIGTERM stay with the same lifecycle. The foreground native child receives the signal, the owned broker closes, and original customer capture state remains available. An orphaned owned broker is identified by its saved process birth, exact configuration path and original operation before it is closed. The next invocation uses the same cluster and retained topic.

## Returned delivery

The complete primary result is receiving/result.json; lifecycle-result.json joins it to the exact original software. Useful completed artifacts include:

- seed/source-input.json and seed/result.json: original published bytes and actual broker metadata/offset results.
- receiving/receipts/received-wire-messages.jsonl: complete received events, including exact JSON text and original base64 wire bytes.
- receiving/delivery/audit-kafka-project.zip and current-kafka-project.zip: full portable Kafka and native dataset editions.
- receiving/browser/browser-kafka-project.zip: the actual customer browser download, received through the original importer.
- receiving/browser/native-merchant.zip and receiving/delivery/browser-merchant/: the actual generated merchant and customer SDK package.
- receiving/receipts/merchant-native-received.json: original merchant inspection, SDK export inspection and actual generated first-request binding.
- receiving/browser/source-history.png, customer-handoff.png and merchant-customer-sdk.png: the running original console.
- receiving/customer/: the same complete customer workspace for subsequent Applications adoption.
- receiving/receipts/: original native API outcomes and same-edition reopen results.
- software/software.json and the original package reports: selected runtime acquisition identities.

Keep the private console connection/owner/input files with the native operator. They contain that original loopback capability. Publish the completed source/customer results and the relevant screenshots through the original Goldsky product thread and the same operation's engineering delivery.
