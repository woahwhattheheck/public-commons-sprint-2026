# Complete WFS customer receiving and delivery

This package carries the original GeoSolutions WFS customer operation from a complete saved source capture through merchant publication, customer acquisition, portable project receiving, installed CLI reopen, browser use, and a saved customer archive.

Operation: `SCF-WFS-GEOSOLUTIONS-CUSTOMER-7DE2-20261012`.

The product is the complete 32-file WFS implementation from PR1978, source head `201f92da09d4f7f02b94df3a98ea1a42a14db3d2`, merged as `9b40162162628f5725fe6386223b7ef6256fcd4b`. The captured source belongs to the existing `OGC-WFS2-GEOSOLUTIONS-20261012-7DE2` operation. Its original capabilities, schema, hits, pages, response records and interrupted-attempt history remain together.

## Receive the complete source package

The enclosing JSON packet contains every source file in its `files` array. Each row has a basename, complete UTF-8 content, byte count and Git blob identity. Before writing a row, encode its content as UTF-8 and verify both its byte count and:

```python
hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
```

Use one private project directory for all files. Retain their original basenames. The source packet includes the complete merchant donor receiver and donor source packet, the full WFS source packet, the original native fixture, the entire customer driver, the foreground owner, the native launcher, the existing artifact publisher, the saved-capture receiver, and the original capture validator.

The donor receiver receives the pinned 538-file merchant source edition and then the WFS source overlay composes its 32 complete files. Existing Node dependencies are reused through the selected installed dependency closure.

## Select the actual host runtime

The launcher records the exact installed runtime paths in `native-input.json`. Its original observed paths are:

| Runtime | Original selected path |
| --- | --- |
| Maintained native host | `/workspace/scratch/7de2cd02ad5f/electron-runtime-c534ab78/host` |
| Native operation records | `/workspace/scratch/7de2cd02ad5f/scf-customer-native` |
| Node | `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node` |
| Python | `/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3` |
| Merchant source donor | `/workspace/scratch/4c21f86f7a8a/grants-integration-20261012/source` |
| Installed Node dependencies | `/workspace/scratch/9345d3fc660b/native-runtime/node_modules` |
| Chromium | `/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell` |
| Playwright packages | `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules` |

An equipped worker can select its observed equivalent paths by changing only these launcher constants before preparing the original operation. Retain the original launcher and the complete adapted postimage with its path mapping. The operation ID, source pins, native customer, fixture and retained source identity stay fixed.

The launcher obtains three original official helper files from its configured existing helper directories and verifies their complete SHA256 identities before admission:

| File | SHA256 |
| --- | --- |
| library_upload.py | `5bc473dadefe1f68ee8797baaed19d6662642d0ea4bcba128fa12938faa0d767` |
| library_file_transfer.py | `5e1557817be17db06e2375f8c34ed83e948d520242e5ee4cb50a30c7a4c83378` |
| library_hosted_apps.py | `97d029b097ace62b744c82dfde20ef6921ed543a33a771ecf6452bd655d11b59` |

## Bind the saved original source capture

The source owner returns the actual saved file identity and its separate original complete `delivery.json`. Create a private descriptor with those returned values:

```json
{
  "schema": "commons.wfs-capture-library-source.v1",
  "file_id": "ACTUAL_FILE_ID",
  "library_file_id": "ACTUAL_LIBRARY_FILE_ID",
  "file_name": "GeoSolutions_WFS2_States_Source_20261012.zip",
  "current_version_number": 0,
  "archive_bytes": 0,
  "archive_sha256": "ACTUAL_ARCHIVE_SHA256",
  "source_delivery": {}
}
```

Replace the numeric and string placeholders with the actual returned version, byte count and digest. Set `source_delivery` to the complete original delivery object, including its `COMPLETE` state, original operation, archive identity, manifest digest, member count, source request/attempt counts and both edition summaries.

The saved file contains the original `capture.zip` bytes under its delivery filename. The ZIP root contains `source-manifest.json` and all original payload members. The separate delivery object retains the producer's original directory and archive provenance.

The receiver prepares the exact saved file through the existing Chat signed-transfer route after native admission. It verifies the returned file/version/name/size, receives through the unchanged official materializer, then checks the whole ZIP digest, every member, the original source manifest and the source owner's complete validator. The complete raw attempt history is included.

## Run the original customer

With the complete source packet materialized at `PROJECT` and the private actual descriptor at `CAPTURE_DESCRIPTOR`:

```sh
python3 -B PROJECT/launch_wfs_customer.py \
  --family wfs \
  --project PROJECT \
  --source-library CAPTURE_DESCRIPTOR
```

The original source directory can instead be selected when it remains available on the same admitted host:

```sh
python3 -B PROJECT/launch_wfs_customer.py \
  --family wfs \
  --project PROJECT \
  --source-capture ORIGINAL_CAPTURE_DIRECTORY \
  --source-manifest-sha256 ACTUAL_MANIFEST_SHA256
```

The two source choices are mutually exclusive. The launcher uses the maintained `native_placement` and `ForegroundLaunch` APIs. Its source-bound private placement is the original operation plus `-private-customer`. It requests 768 MiB memory with a 128 MiB reserve, 128 MiB working files inside the memory charge, and 4 MiB persistent record space with an 8 MiB disk reserve. The complete customer artifact is saved from the same foreground.

A capacity return of 75 belongs to this original placement. Reconcile its retained placement and native record before continuing it. Once admitted, keep the original foreground through its returned customer and saved-artifact result.

## Customer workflow

The driver uses the actual two retained WFS editions and exact recorded request URLs. The real service's uppercase next-page KVPs, unknown JSON total and empty terminal page remain in the source records. Its hits response supplies the observed edition count.

The complete journey opens the merchant feature desk, adopts capabilities/schema and source selection, starts the original capture, cancels after the first complete page through the live MCP control, and resumes that same capture. It compares the two retained editions, publishes the original source and feature-row products, and receives them through the existing SF30/SF88 merchant/customer engines. Payments use the original local protocol fixture.

The transfer reads the complete portable bundle through the maintained MCP file interface. Following host restart it obtains a new reader handle while retaining the same source bundle. Customer receiving replays the original bundle after a legitimate customer review revision, preserving the later revision. The installed CLI reopens the received project. The browser walks the complete application sections using the selected actual Chromium executable.

The foreground is a Linux child subreaper. It drains the original Node, PTY and browser descendants by their process identities before reading customer outputs. The original leader exit remains in the customer outcome.

## Completed output and recovery

The native record's `customer-custody` directory retains the source/customer output log, the exact customer outcome, the artifact identity and the original per-artifact save state.

The complete customer ZIP is named:

```text
WFS_Customer_20261012_<manifest-edition-prefix>.zip
```

It contains the feature desk and its retained source/customer history, request and step records, received portable project, output files and screenshots, the original input/source selection, and the customer outcome. When the Library source descriptor is used, it also contains the complete received original `source-capture/`, the private source descriptor and the receiving receipt.

Every member is bound by `delivery-manifest.json`. The artifact result records its exact bytes and SHA256. The same original publisher retains one save intent per artifact and reconciles its returned helper output or the matching custody acknowledgment. A completed customer and an interrupted customer each retain their full available artifact and original exit.

Capture receiving publishes its immutable complete receipt before its directory. A replay after publication verifies the same original tree and receipt, syncs both the source and destination directory parents, and preserves the original binding. Subsequent customer work stays in its own feature-desk and receiving history.

Return the native record/session, complete customer outcome, final ZIP byte count/digest, returned saved-file identity, and the original saved-custody result to the existing WFS coordination thread. These records let the following installed release consume the same customer and source edition.
