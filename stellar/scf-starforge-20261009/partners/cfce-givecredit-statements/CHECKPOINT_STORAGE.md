# Continuing large GiveCredit source acquisitions

The native receiver keeps original response and transaction-XDR strings in immutable local objects. A small atomic manifest records the complete current source structure, source selection and pagination progress. Each save writes only new string objects and the current manifest. Registry and ledger acquisition use this storage through the existing browser, CLI and native Carbon receiving workflow.

The exported checkpoint remains an ordinary complete `stellar-forge.givecredit-source.v1` JSON document. Source editions, source digests, donor/payment identities, statements and comparison rules retain their existing contracts.

## Continue an existing saved capture

Keep the original complete capture-options JSON. It carries the same network, endpoints, contracts, original ledger sources and source bounds used by the saved acquisition.

Existing `ledger-capture.json` and `registry-capture.json` files inside a GiveCredit workspace open automatically when that kind has no newer committed manifest. The next awaited progress save creates the incremental store; the original file is preserved.

```sh
starforge givecredit-statements capture-ledger \
  --directory /private/givecredit \
  --file /private/original-capture-options.json \
  --label "Original retained ledger acquisition" \
  --resume
```

To receive a checkpoint from another saved case first:

```sh
starforge givecredit-statements checkpoint-import \
  --directory /private/givecredit --kind ledger \
  --file /private/original-ledger-checkpoint.json

starforge givecredit-statements checkpoint-status \
  --directory /private/givecredit --kind ledger
```

Import reads the whole original file, checks that it stays unchanged, saves its file identity in the local manifest, cold-reopens the new store and compares the complete reconstructed source with the original JSON document. The original checkpoint remains intact. It does not create a new source selection or rerun an accounting action.

The browser's **Capture original records → Continue a saved acquisition** accepts the same complete checkpoint. Each source panel provides **Export complete checkpoint** and the last committed save time. Both capture forms accept an optional original capture-options JSON file, so a historical selection can retain its full original inputs. With that file selected, its query replaces the form's convenience fields; the entered registry API key supplies authorized access.

## Complete independent checkpoint export

```sh
starforge givecredit-statements checkpoint-export \
  --directory /private/givecredit --kind ledger \
  --out /private/givecredit-ledger-checkpoint.json
```

The export is a complete ordinary JSON source file, written with a bounded serialization buffer and create-only publication. It contains every original response, file, normalized record, exact numeric string and source cursor. It can be imported into another GiveCredit workspace or passed to the native receiving caller's `--capture-checkpoint` option.

A local checkpoint directory is also independently reopenable when copied whole. Keep its `checkpoint.json` and entire `objects/` directory together. Every object is checked against its original byte length and SHA-256 when reopened. A manifest by itself is not a complete checkpoint.

## Native Carbon receiving

The original `receive-native.mjs` continues the same preserved-output operation. It first uses an explicitly selected checkpoint, then the copied output's newer `givecredit-ledger-checkpoints/` manifest, then its original `givecredit-ledger-capture-checkpoint.json`.

The output retains both the original saved checkpoint and the new incremental directory. The receiving receipt records the current manifest path, committed source/progress counts and bytes written or reused. The existing whole-output archive includes every object and manifest. The completed accounting prefix, original source options, saved statements and browser-attempt recovery remain in the same operation.

A complete source checkpoint is reused after the same exact native selection check used by an interrupted capture. The check uses the selected SDK/defaults and original ledger-response identities without mutating the checkpoint or fetching source data. An interrupted checkpoint continues with its original collector selection and cursors. Missing or changed immutable objects produce a receiving error; the prior source files remain available for restoration.

## Storage and interruption behavior

Within an ordinary GiveCredit workspace the stores are:

- `ledger-capture-store/checkpoint.json` and `ledger-capture-store/objects/`
- `registry-capture-store/checkpoint.json` and `registry-capture-store/objects/`

Large strings are replaced only in the private storage projection by explicit path references. Hydration replaces exactly those declared paths, preserving ordinary source keys and property order. Raw source strings are JSON encoded in their local object files so all original characters, including escaped Unicode, can be reconstructed exactly.

Each object is written to a private temporary file, synced and published create-only. The manifest is synced and atomically replaced after all referenced objects are durable. A stopped process can leave unreferenced objects or an unfinished temporary file; the prior committed manifest remains readable. The next save can reuse already published identical objects. No background pruning removes source material.

An original per-store kernel lease serializes commits. Writes also join the maintained gates of containing runtime workspaces. The writer recognizes a large application workspace by its first schema field without trying to parse its full source payload as a four-megabyte runtime configuration. Runtime configurations continue through the original runtime gate. Workspace JSON and complete source/handover HTTP exports are streamed to avoid an additional whole-document serialization buffer.

## API and installed interfaces

`CaptureCheckpointStore` is available from the installed `./givecredit/checkpoint` export. Its native methods are `open`, `save`, `load`, `status`, `importLegacy`, `export` and `releaseMemory`.

The existing `GiveCreditWorkspace` provides `saveCapture`, `captureCheckpoint`, `captureStatus`, `importCapture` and `exportCapture`. `GiveCreditClient` provides `captureStatus`, `importCheckpoint` and `checkpointURL`. Browser receiving uses the current workspace identity and revision.

The existing capture APIs default to detached progress snapshots. Native consumers use `checkpointMode: 'borrowed'`: the collector awaits their persistence callback before modifying that source again. The callback must finish all source reading before resolving. The caller also owns its supplied resume object in this mode. External consumers that retain snapshots can continue using the default `'copy'`.

Status includes the source kind/status, committed generation/time, response/file/table counts, current referenced object count and bytes, and objects/bytes written or reused in the last save. These are physical persistence facts. Complete source and report totals continue to come from their original normalized records.

## Focused source receiving

The projection and serializer were checked against the original eight-response native interruption checkpoint and the complete current Stellarcarbon API edition. The original checkpoint and its restored source have the same compact-document SHA-256, `439fb679cbb95adccbd1b7b84382ee5743278796cadef944806a392fbf85d198`, with unchanged selection and all eight responses. Sixteen original string references resolve to eight immutable objects. The complete current Carbon edition's JSON serialization is also unchanged.

Run the CLI import on the actual saved native checkpoint to perform filesystem publication, independent reopen and complete source comparison in the receiving host. This is the ordinary migration operation above and preserves its original source file.

## Immutable source editions and stable native reads

A GiveCredit workspace now owns deeply immutable source editions. Saving settings, assignments, pool funding or statement versions clones the working records and reuses those retained originals. An earlier native view continues to represent its original workspace revision while a later edit is saved. The source rows, raw response strings and saved statement versions cannot be changed through that view.

The public `snapshot()` and `handover()` methods still return detached, editable JSON values. `sealSource()` also returns an independently editable value. Independent receiving takes a detached copy, assigns its own workspace identity and preserves its original source seals. Existing workspace and handover file schemas are unchanged; opening an existing workspace establishes immutable ownership after validating all original seals.

Native HTTP projections and complete downloads use `readonlySnapshot()` and `readonlyHandover()`. These methods return deeply frozen values and share their source editions with the maintained workspace. Keep these values read-only; use the detached methods when preparing independent edits. A mutation publishes a new frozen state only after its complete workspace file is durable. A streaming response can therefore finish its selected version without holding the write queue.

Source and operation digests use a streaming canonical serializer. It preserves the original sorted-object JSON rules, including numeric-looking property names, exact raw response strings and array order. No source identifier or hash changes. Large strings are escaped in bounded chunks; source hashing avoids creating a second sorted source tree and a complete canonical string.

The native receiving caller also streams complete JSON artifacts and hashes existing artifacts through a fixed-size file buffer. It preserves the original pretty-printed JSON bytes, create-only publication, recorded artifact identities and unrecorded-file recovery behavior. Its local save helper returns the artifact identity; the browser and accounting helpers consume the durable output.

These changes remove repeated whole-source copies during operator reads and edits. Initial source parsing, the owned import copy, detached exports explicitly requested by API consumers and the active normalized source still occupy memory. The checkpoint object store continues to avoid repeated raw-response rewrites. Native receiving remains the same saved operation with the original accounting prefix and capture selection.

The focused original-source comparison used the retained 29-response Carbon edition with 40 contributions and 25 certificates. It confirmed identical canonical and pretty JSON bytes, unchanged earlier state, immutable native source reuse, detached default mutations, independently editable handovers and independent receive ownership. Numeric-looking property names retain the original canonical enumeration. This was a pure source comparison; native file publication and the complete two-application journey remain in the existing receiving operation.
