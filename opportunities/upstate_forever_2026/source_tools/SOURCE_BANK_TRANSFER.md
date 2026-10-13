# Prepare complete source transfers in JavaScript

Use this encoder when a source-bank response is too large for the working connection. The complete original bank becomes deterministic gzip parts, each small enough for the configured connector request. The existing Python materializer reconstructs the exact bank and all original files.

Prefer an ordinary complete archive or repository checkout when the receiving runtime can fetch it. This path addresses the observed managed-blob truncation during the Ecosystem Sciences native handoff. It also works in a JavaScript-only session that has no filesystem, Node, compression API or network API: the caller supplies the exact original JSON text and publishes the returned strings through its already authorized connector.

## Prepare

The maintained module is `source_tools/source_bank_transfer.cjs`. It exports `prepareTransfer` and `identity` under Node, or installs `globalThis.CommonsSourceBankTransfer` when loaded as a plain script. It has no dependencies or side effects outside that export. Keep the module's retrieved source identity with the transfer.

~~~js
const {prepareTransfer} = require("./source_bank_transfer.cjs");
const transfer = prepareTransfer([
  {
    name: "successors",
    text: exactOriginalBankText,
    git_blob: "d85b250872047d04c7d75851cf0aef96eabeff81"
  },
  {
    name: "source-tools",
    text: exactOriginalSourceToolsBankText,
    git_blob: "ac740f87dc7f5948fee9c50e32ddf7c99ad9a47f"
  }
], {
  operationId: "your-retained-operation-id",
  repository: "woahwhattheheck/public-commons-sprint-2026",
  maxPayloadBytes: 600000,
  reserveBytes: 4096,
  chunkBytes: 400000
});
~~~

`text` is the exact original UTF-8 JSON, including its whitespace and terminal newline. `git_blob` and `sha256` are optional expected identities; provide the source's known identity whenever available. A parsed tool response alone does not establish its original serialization. Recover the complete original text or reproduce and verify its known byte identity before preparing a transfer.

Each bank must use `commons.source-bank/v1`, with top-level `file_count`, `source_bytes` and `files`. Every file needs its original relative POSIX `path`, `bytes`, `sha256`, `git_blob` and canonical `content_base64`. The encoder checks all members against the actual decoded bytes before preparing any parts. It rejects duplicate bank names, duplicate member paths, a file used as another file's directory, unsafe paths, malformed Unicode, noncanonical base64 and inconsistent inventory.

A differently shaped historical bank needs an explicitly authored compatible successor that retains the historical artifact and records its relationship. The encoder never silently inserts missing totals or changes the original JSON bytes.

The returned object has:

- `parts`: complete part JSON strings with their exact `git_blob`, `json_bytes`, `json_sha256`, bank/index/offset/raw-byte identity and measured `payload_bytes`.
- `manifestJson`: the complete transfer manifest string.
- `manifestIdentity`: the manifest's byte count, SHA-256 and Git blob ID.
- `manifest`: the parsed manifest for inspecting its inventory and part order.
- `payloadBudget`: the settings actually used.

Compression is deterministic: the same original bank produces the same gzip stream. Splitting also includes the bank name, part number and offset, so retain the original settings to reproduce exact published part IDs.

## Publish and resume

Publish each `part.json` as a UTF-8 Git blob through the existing connection. Check the returned SHA against `part.git_blob` and retain the accepted ID immediately. After every part is accepted, publish `manifestJson` and check against `manifestIdentity.git_blob`.

Use the existing Git tree/commit/branch workflow to retain a reachable directory containing `transfer.json` and `parts/<git_blob>.json`. Publishing a Git blob alone does not give later workers a durable branch to discover. Include the branch/commit, manifest identity, receiving helper and active application/Workspace owner in the existing handoff.

If a write response is lost, fetch the predicted blob ID and compare its complete content before attempting the same deterministic write again. After a transfer interruption, keep already accepted parts. A receiver can request only missing part IDs. Do not generate a competing source edition or replace active worker modifications to restart transport.

The encoder uses the schemas already consumed by `materialize_source_banks.py`; it does not add another receiver. On the native runtime:

~~~sh
python -B source_tools/materialize_source_banks.py \
  --manifest transfer.json \
  --parts parts \
  --output /path/to/new-owned-source-receiving
~~~

Then use the maintained component installer or compose the received source with the working application, retaining the exact active Workspace and current local changes. See [MATERIALIZE_SOURCE_BANKS.md](MATERIALIZE_SOURCE_BANKS.md).

Keep overlays in separate receiving directories when they intentionally repeat existing paths. A single transfer rejects duplicate source paths across its banks, even when the duplicated bytes are identical. The caller's application composition decides which reviewed successor replaces an older file.

## Size budget

`chunkBytes` limits raw bytes from the compressed stream; it does not describe the JSON or provider response size. For every candidate the encoder measures:

~~~text
UTF-8 bytes of JSON.stringify({
  repository_full_name: repository,
  content: completePartJson,
  encoding: "utf-8"
}) + reserveBytes
~~~

This includes base64 expansion and escaped nested JSON. If that envelope exceeds `maxPayloadBytes`, a binary search reduces the raw segment to the largest size that fits. The manifest must also fit. `reserveBytes` covers the additional provider framing allowed by the caller. Choose the budget from actual complete responses on the connection; no setting can guarantee an undocumented provider limit. If a response still truncates, lower the verified envelope and prepare from the same original bank. An oversized manifest needs fewer banks per transfer or a larger observed working envelope.

The default raw cap is 400,000 bytes, total request cap 600,000 bytes, additional reserve 4,096 bytes. The implementation holds the original banks and compressed parts in memory. Use separate complete-bank transfers when memory or manifest size becomes the constraint.

## Existing receiving packages

The existing `delivery/ecosystem-native-source-20261013-s1` branch retains the original 660-file transfer, the 22-file successor transfer and the 29-file source-tools closure. Their directories are:

- `source/receiving/20261013/native-application-660`
- `source/receiving/20261013/native-application-successors-22`
- `source/receiving/20261013/native-application-source-tools-29`

These are under the application prefix `opportunities/upstate_forever_2026/`. They are retained source snapshots. Their merged unique application inventory is 703 files; the current working application may include later maintained additions. Reuse the existing complete packages for that native run.

The extracted encoder was exercised on the original 22- and 29-file banks: 51 source files and 1,896,515 original source bytes. Both gzip streams matched the previously published streams exactly, and an independent decoder reconstructed both original JSON texts. The default part bodies reproduced the existing published part identities. A 250,000-byte total request envelope split the 22-file bank into two parts, including one at exactly the configured limit, and reconstructed the same original content.

## Owner-directed product receiving

Carry the current application `AGENTS.md` and provider instruction copies when assembling a standalone source handoff. The owner instruction version `2026-10-13.1` requires opening/running/rendering the exact outgoing client-facing product and inspecting its actual screens or screenshots, then operating important populated controls, exports and reopening at screenshare and narrow/mobile widths where relevant. Fix clipping, unreadable tables and broken controls before presenting it. Use plain industrial design and preserve the active computation and source owners. Transport completion feeds the existing native product workflow; it does not substitute for the actual rendered product inspection.
