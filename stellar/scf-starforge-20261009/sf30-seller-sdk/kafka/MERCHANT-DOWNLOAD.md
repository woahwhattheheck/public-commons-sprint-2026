# Receive a Kafka merchant export

The merchant downloader saves a complete Kafka export on the receiving machine. It uses the merchant's existing MCP endpoint, keeps the exact native manifest, and resumes the same file after a connection loss or interruption. The SDK and CLI share the maintained merchant download engine.

Start with the workspace alias and artifact returned by a Kafka merchant export. The agent can create that export with `merchant_kafka_export`, or use the retained artifact returned for a large response or a complete message. The file remains associated with its original workspace UUID, source binding, export operation, content length and SHA-256.

The installed command is `starforge kafka-merchant-download`. The programmatic entry is the package's `./merchant/mcp/kafka/download` export. The repository entrypoint is `stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/merchant-download-cli.mjs`.

## Review and receive

Use the original HTTPS MCP address or its loopback HTTP address. Supply its bearer token through the existing environment variable `MCP_ACCESS_TOKEN`; `--token-env` selects a different variable name.

First inspect the selected artifact:

```sh
starforge kafka-merchant-download inspect \
  --url "$KAFKA_MCP_URL" \
  --workspace "$KAFKA_WORKSPACE" \
  --artifact "$KAFKA_ARTIFACT"
```

The JSON result includes the native manifest, the exact manifest SHA-256, the file's name and media type, total bytes, workspace UUID and source binding. It also gives the stable export operation. Use those values to select the intended source and file.

Receive the reviewed artifact into a private directory whose parent already exists:

```sh
starforge kafka-merchant-download download \
  --url "$KAFKA_MCP_URL" \
  --workspace "$KAFKA_WORKSPACE" \
  --artifact "$KAFKA_ARTIFACT" \
  --directory ./received-kafka-export \
  --manifest-sha256 "$KAFKA_MANIFEST_SHA256" \
  --workspace-id "$KAFKA_WORKSPACE_ID" \
  --binding-sha256 "$KAFKA_BINDING_SHA256"
```

The directory is created with private permissions. Progress is written to stderr after durable chunks; stdout contains the final JSON result. `--quiet` suppresses progress, and `--chunk-size` selects 1–196608 bytes per request.

The completed directory contains:

| Path | Purpose |
| --- | --- |
| `manifest.json` | The exact native manifest bytes received from the merchant. |
| `original.zip`, `original.json` or `changes.ndjson` | The complete original file named by that manifest. |
| `download-state/` | The original endpoint, manifest binding, durable byte checkpoint and local download lease. |

A file is published under its completed name only after its full bytes match the native SHA-256. An existing different file or manifest produces a conflict while preserving the saved contents.

## Resume the same transfer

Repeat the same download command, including the endpoint, workspace, artifact and directory. The engine checks the saved manifest, verifies the checkpointed prefix, and continues at the retained byte offset. It removes only a suffix that was written after the last durable checkpoint.

A remote read descriptor can expire or disappear when the merchant restarts. The downloader reopens the same artifact at the saved offset using its original file SHA-256. Keep the MCP address stable when restarting a local merchant. Changing the selected endpoint is a different receiving identity and the existing checkpoint will reject it.

Ctrl-C and SIGTERM cancel the current requests and drain the accepted local writes. The CLI keeps its signal handlers active until that drain ends. A later invocation continues the saved checkpoint. Exit codes are 0 for completion, 1 for an operation failure, 130 for an interrupt and 143 for SIGTERM.

To reopen and check the completed local download:

```sh
starforge kafka-merchant-download verify \
  --directory ./received-kafka-export \
  --workspace "$KAFKA_WORKSPACE" \
  --artifact "$KAFKA_ARTIFACT" \
  --manifest-sha256 "$KAFKA_MANIFEST_SHA256"
```

This command reads the existing local manifest, checkpoint and file. It reports the same source identifiers and exact file path after checking the complete length and SHA-256. It works with the merchant stopped and requires no token. Verification and resumed-prefix reads also accept cancellation.

## SDK

The SDK exposes these functions:

| Function | Result |
| --- | --- |
| `inspectKafkaMerchantExport(options)` | The native manifest, exact manifest digest and a copy of its received bytes. |
| `downloadKafkaMerchantExport(options)` | A complete file and manifest, or continuation of the same saved download. |
| `inspectKafkaMerchantDownload(options)` | A completed local file reopened without a network request. |
| `openKafkaMerchantDownloader(options)` | A session with `inspect`, `download` and `close`. |
| `parseKafkaMerchantExportManifest(bytes, selection)` | The exact native manifest parsed against the selected workspace and artifact. |

All network methods accept the original URL, workspace alias and artifact. Optional workspace UUID and source binding pins apply before any file is received. A supplied `client` can borrow an already connected merchant file client with `endpoint` and `call(name, args, options)`; its calls return the original MCP tool's structured content.

This example can be saved at the repository root:

```js
import {
  openKafkaMerchantDownloader,
  inspectKafkaMerchantDownload,
} from './stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/merchant-download.mjs';

const selection = {
  url: process.env.KAFKA_MCP_URL,
  workspace: process.env.KAFKA_WORKSPACE,
  artifact: process.env.KAFKA_ARTIFACT,
  expectedWorkspaceId: process.env.KAFKA_WORKSPACE_ID,
  expectedBindingSha256: process.env.KAFKA_BINDING_SHA256,
};

const downloader = await openKafkaMerchantDownloader(selection);
let reviewed, received;
try {
  reviewed = await downloader.inspect();
  received = await downloader.download({
    directory: './received-kafka-export',
    expectedManifestSha256: reviewed.manifestSha256,
    onProgress({ file, bytes, total }) {
      process.stderr.write(file + ': ' + bytes + '/' + total + '\n');
    },
  });
} finally {
  await downloader.close();
}

const local = await inspectKafkaMerchantDownload({
  directory: received.directory,
  workspace: selection.workspace,
  artifact: selection.artifact,
  expectedWorkspaceId: selection.expectedWorkspaceId,
  expectedBindingSha256: selection.expectedBindingSha256,
  expectedManifestSha256: reviewed.manifestSha256,
});
console.log(local.filePath);
```

`inspect` returns `manifestBytes` as a copy of the original bytes. The downloader preserves those bytes directly; it does not rebuild the manifest from the JSON view. The native merchant manifest and file types are shared with `merchant-tools.d.mts`.

For cancellation, pass an `AbortSignal` to a one-shot function or a session operation. An `onProgress` callback runs after the chunk and checkpoint are saved, making it suitable for recording progress or requesting an interruption:

```js
import { downloadKafkaMerchantExport } from './stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/merchant-download.mjs';

const stop = new AbortController();
const received = await downloadKafkaMerchantExport({
  ...selection,
  directory: './received-kafka-export',
  signal: stop.signal,
  onProgress(progress) {
    process.stderr.write(progress.bytes + '/' + progress.total + '\n');
  },
});
// A UI cancel action can call stop.abort() while this operation is running.
```

The callback may be asynchronous. The session's `close` cancels its active requests and waits for accepted operations to release their local resources. A borrowed client's surrounding lifetime stays with its existing owner.

## Use the received file

| Native export kind | Received file | Continue with |
| --- | --- | --- |
| `kafka-project` | `original.zip` | The Kafka console's original project import and retained source view. |
| `ndjson-project` | `original.zip` | The original NDJSON project receiving workflow. |
| `dataset` | `original.zip` | The native dataset package consumer. |
| `merchant` | `original.zip` | The merchant package's existing setup and operating entrypoint. |
| `changes` | `changes.ndjson` | The original comparison stream. |
| `message`, `state`, `projection`, `record`, `query` or a retained response | `original.json` | The complete native JSON content, including exact numeric tokens and message bytes. |

The downloader handles files up to 2 GiB using bounded requests and the native checkpoint engine. It verifies each chunk's workspace, artifact, filename, digest, read ID and byte range, then checks the full file digest before publication. The local directory has one operating-system lease, so concurrent processes cannot advance the same receiving checkpoint.

The selected merchant's existing access control governs manifest and file calls. Download operations read the retained export; the application continues to own its source capture, datasets and server lifetime.

For source operations and export creation, see [MCP.md](MCP.md). For the direct workspace client and its CLI, see [CLIENT.md](CLIENT.md).
