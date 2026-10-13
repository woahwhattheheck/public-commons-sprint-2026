# Selective original-archive receiving

Version **1.0.0** · `source_tools/parted_zip.py` · TokenJunkieLabs

Receive a complete source or report tree from an existing large, byte-split ZIP without downloading the other original parts or creating a second joined ZIP. The original archive, member names, scientific inputs and scientific output bytes remain unchanged. This is an additive source/attachment receiving tool, not a new model runner, a ZIP repackager or an alternative Workspace format.

The command uses the existing `ecosystems.archive-parts/v1` manifest. It reads the original central directory from the tail, lists every member, plans the parts needed for an explicit selection, verifies the received original parts, and streams complete selected members into a new directory. A self-contained grayscale HTML planner provides folder selection, full-inventory search, exact member identity, saved selections and downloadable part plans.

## Install and open

Copy `source_tools/parted_zip.py` and `source_tools/parted_zip_view.py` together into an owned source directory. Python 3.10 or later is required; the executed release used CPython 3.13.5 on Linux. There are no third-party dependencies, network calls, daemon processes, model calculations or hosted CI jobs.

The examples run from that source directory. Substitute the actual manifest, parts and output paths. Retain the original manifest as received; do not edit provider IDs or rewrite its JSON merely to rename downloaded files. Its exact byte hash binds saved selections.

```sh
python source_tools/parted_zip.py bootstrap \
  --manifest original.zip.parts.json --parts original-parts \
  --output bootstrap.json
```

Receive the exact `required_parts` named by `bootstrap.json` using the existing authorized file transport. Each descriptor includes its original number, name, size, SHA-256 and any retained file/Library ID. A part split is a byte slice of **one ordinary ZIP**, not a ZIP multi-disk volume.

```sh
python source_tools/parted_zip.py index \
  --manifest original.zip.parts.json --parts original-parts \
  --output member-index.json --html receiving-planner.html
```

A very large central directory or ZIP64 record can require another original part. Exit **3** returns the exact missing descriptors. Receive those parts and repeat the same operation. No absent bytes are fabricated or replaced with zeros.

Open `receiving-planner.html` in a normal browser. It contains the complete index and all its own styling and code, with no external assets or requests. Add complete folders or an exact prefix; search covers every member, not just the visible page. Download the selection and the transfer plan. The browser cannot fetch private provider files: use the ordinary authorized transport for the listed original parts.

Every selected member is identified by original central-directory ordinal, exact path, local-header offset, byte count and CRC32. Duplicate names remain distinguishable by ordinal. Browser selection history is local to the exact archive/manifest edition where browser storage is available; saved selection files are the explicit portable continuation.

## Plan a complete source and report selection

Whole prefixes are literal directory prefixes, not a shortened sample or a glob. Repeating them takes their union. The full saved selection can be reviewed independently.

```sh
python source_tools/parted_zip.py plan \
  --manifest original.zip.parts.json --parts original-parts \
  --prefix application/ \
  --prefix workspace/scientific-report-editions/ \
  --prefix workspace/ensemble-products/ \
  --prefix workspace/ensemble-study-sources/ \
  --prefix workspace/native-process-reports/ \
  --save-selection original.selection.json \
  --output transfer-plan.json
```

Alternatively use the browser's downloaded `archive.selection.json`:

```sh
python source_tools/parted_zip.py plan \
  --manifest original.zip.parts.json --parts original-parts \
  --selection archive.selection.json --output receiving-plan.json
```

The part plan includes every central-directory/end-record part needed by a fresh reader. When a verified local header is present, the CLI refines a member to the exact local-header, filename, extra-field and compressed-payload span. Otherwise it includes the entire original record span up to the next member. The offline browser uses that conservative full-record span. Both preserve complete members; padding can make a conservative plan larger, never incomplete.

For one exact file, use `--member exact/path`. For duplicate original names, use `--ordinal N`; the index displays zero-based ordinals. `--all` explicitly selects every original member. A saved selection cannot be mixed with new command-line selectors. A wrong archive/manifest identity or altered member descriptor is rejected.

## Adopt file-transport names without editing the manifest

A file transport may materialize a part with a duplicate-safe filename or into another directory. Adopt those existing bytes through the original descriptor:

```sh
python source_tools/parted_zip.py adopt \
  --manifest original.zip.parts.json --parts original-parts \
  --part 44 --file /actual/materialized/file.part44
```

The command streams, verifies and installs that one original part under its original filename. An identical existing part is reused; a different file is preserved and reported. It does not make a provider request or expose signed upload URLs in a plan.

## Receive and resume

```sh
python source_tools/parted_zip.py extract \
  --manifest original.zip.parts.json --parts original-parts \
  --selection archive.selection.json --output received-selection
```

Use a **new empty receiving directory**, never the active application or Workspace. The command checks every required original part before writing the selected output. Each selected ZIP member is read completely through Python's original ZIP decoder/CRC check and written with a retained SHA-256.

The receiving directory contains original selected paths plus `.parted-zip/`: the unchanged original manifest, explicit selection, operation identity, exclusive-writer lock, SQLite journal and complete receiving record. Whole source/report trees retain their original filenames and companion files. There is no implicit source overlay or execution of recovered code.

Reissue the **same command and destination** after interruption. The original archive, selection and layout must match. Completed files are rehashed and reused. A file published before its journal transaction is recovered by reading and comparing the complete original member. Uncommitted temporary files are replaced; user-edited completed files are preserved and reported. A concurrent receiving writer is rejected by an operating-system lock. A different selection gets a new output directory.

Files are atomically published without overwriting an existing path, using a same-filesystem hard link after flush/fsync. This requires normal hard-link support in the destination filesystem. Extracted regular files are owner-readable/writable; an originally executable file retains owner execute permission. Original modes and dates remain in the member inventory. This is not an ACL/ownership restore or a service for hostile concurrent filesystem users.

Unsafe paths, parent traversal, symbolic links, special files and encrypted members are not extracted. Case/Unicode-normalization collisions and duplicate names are never silently overwritten. For separately retained duplicate entries, explicitly choose `--layout entries`; the output becomes `entries/00000042/<original path>`, preserving every original entry separately with its original identity in the record.

Exit **0** means the requested operation completed; **3** names original parts still needed; **2** reports a data, filesystem or unsupported-format error. No hidden retries, sends, background scheduling or destructive cleanup occur.

## Complete native Workspace receiving

Selective receiving deliberately produces only the **explicit selected members**. To obtain an independently editable native Workspace, select the complete native archive content with `--all` or reconstruct the exact original ZIP and pass it to the application's maintained original restore/receiving command. Do not call an application-plus-report subset a complete Workspace: source objects, stores and other native dependencies may remain elsewhere in the original archive.

```sh
python source_tools/parted_zip.py join \
  --manifest original.zip.parts.json --parts original-parts \
  --output complete-original.zip
```

`join` requires all original parts, streams them without loading the entire archive, and verifies the **whole original archive SHA-256**. Selected receiving verifies the involved original parts and complete selected members; it does not recompute a hash over absent archive parts. Existing scientific IDs, archive formats, queue ownership, selection semantics and native restore code remain unchanged.

For a Python source consumer, `Manifest`, `PartsIO` and `archive_session` expose the same verified read-only view. Keep it inside its context manager. `NeedParts.parts` reports the required original transport descriptors. No adapter should catch that exception and supply empty bytes.

## Memory and transfer behavior

The reader retains at most four original-part handles and hashes/streams data in 1 MiB chunks. A verified unchanged inode/size/mtime/ctime snapshot can be reopened without hashing it twice within one operation. Changes during an open read are rejected. The original central directory and member descriptors are held in memory; memory scales with member count, not with all uncompressed scientific payload bytes. Selected decompression is streamed, with no joined or zero-filled sparse ZIP.

There is no silent member-count or total-size truncation. The HTML planner pages visible rows while searching/selecting the entire index. For archives beyond JavaScript's exact integer range, use the Python CLI rather than browser planning.

## Focused release exercise

Run the three end-to-end receiving journeys, not a broad scientific suite:

```sh
python checks/parted_zip_journeys.py
```

They cover selective whole-tree receiving, absent original parts, byte-exact continuation after a lost journal commit, edited-output preservation, full-archive reconstruction, duplicate entries, unsafe paths, changed original parts, bad original ZIP CRC, ZIP64, data descriptors, UTF-8 names, cross-part headers/end-record searches, and an empty original ZIP. The fixtures are authored archive data; the tool does not submit a model job.

The native release exercise additionally consumed an existing 49-part scientific history. Its complete directory contained 9,700 original members. The application and four complete scientific-output trees selected 5,570 members / 393,635,423 uncompressed bytes, requiring six original parts / 187,469,032 bytes instead of 1,630,309,608 bytes. This avoided 1,442,840,576 transfer bytes (88.5%). Initial local extraction took 2.776 seconds; a later complete 5,570-file rehash/reuse took 1.151 seconds. These are measured local operations after file materialization, not provider download-time estimates or promises for another machine.

The outgoing planner was operated in Chromium 144 at 1440x1000 and 390x844, including complete-folder selection, global search, pagination, member inspection, all JSON downloads, a fresh-document selection reopen and wrong-edition rejection preserving the current selection. A demonstrated sidebar control overflow was repaired. The actual desktop/narrow images were viewed. In that managed browser, file navigation was rejected; the exact outgoing HTML was rendered and operated through Playwright's normal `set_content` interface, and downloads were saved and consumed by the native CLI. Native browser file navigation is not inferred from that rendering transport.

## Current owner direction carried into receiving

This source arm supports `CURRENT_OWNER_DIRECTION.md` **2026-10-13.3** in `opportunities/upstate_forever_2026/`: the actual Upper Savannah production workshare, native modeled baseline/restoration/matched control, retained geographic and source identities, original units, editable assumptions and usable export/cold-reopen. The prime retains scientific method choices, interpretation and the client relationship. Source receiving serves the existing equipped native operation; it does not replace the scientific calculation, restart current jobs, invent measurements or introduce a second Workspace writer. Preserve the October 13, 2026 14:00 UTC sprint cutoff and forward the current complete owner brief with subsequent receiving handoffs.

Before presenting an app, report, planner, downloaded file or other attachment as ready, open/run/render the exact outgoing artifact and LOOK at it in its actual recipient-facing form. Operate important controls, populated/empty/error states, exports and reopening at desktop and narrow widths. View actual screenshots, not just save them. Open and use all outgoing attachments and their meaningful archive contents. Repair unreadable, cramped, clipped, unstyled or broken output in the real producer. Use plain industrial grayscale, clear hierarchy and readable tables. Source review, HTTP success, DOM counts or a passing test does not replace seeing the product. Keep focused validation subordinate to shipping the usable engineering; create no additional approval gate, watcher, controller or review bureaucracy.

Carry the complete standing root `AGENTS.md` rendered-product instruction and the current owner brief with native assembly/receiving distributions and onward work orders. Preserve active source/compute ownership, existing contact controls, source attribution, no private GitHub/Actions and other owner controls. If producing media, use available natural generative voice/TTS, watch/listen to the exact exported result and retain applicable voice, purchase and third-party rights constraints. The receiver makes no new scheduling, spending or contact decision.

## Format references

The physical ZIP interpretation follows [PKWARE's ZIP specification](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT). Selected member decoding and CRC checking use the [Python standard-library zipfile API](https://docs.python.org/3/library/zipfile.html). Original byte-split manifests are the application's existing `ecosystems.archive-parts/v1` records; true multi-disk ZIP volumes are a different format and are rejected explicitly.
