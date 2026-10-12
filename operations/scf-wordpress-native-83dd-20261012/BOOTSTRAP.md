# Single-VM WordPress preparation and original native handoff

Run `bootstrap.py` on the receiving Linux VM. It receives the five reviewed source inputs, completes the original dependency graph, then replaces its own process with the existing `launch.py`. The same courier and native supervisor continue to own registration, failed-start recovery, checkpoint frames, the finalizer and complete result custody.

The carrier is pinned to public commit `bcb7bea412839644f02ac7d64490d836b995b7d9`, 1,518,325 UTF-8 bytes and SHA-256 `3e0a2952d6d4f19c439b704cddef3fbadecfcebd9a2cc92bfba8511b37307444`. Product source remains `f167c3e524b782ceb6dd196df81f6b97886442a9`; commissioning remains `4c62463acfae23b50fb3327d7eafeb087e8b4806`.

## Start on the receiving VM

With the exact private fifth input already present:

```sh
python -u -B bootstrap.py --host-finalizer /absolute/private/host-finalizer.json
```

The complete public carrier is read from a sibling `carrier.json` when present, or fetched from its immutable public URL. A local carrier can also be selected explicitly with `--carrier /absolute/carrier.json`. Its exact bytes must match the pinned identity.

For a tool session, start the bootstrap in a PTY and send the private input only after its `awaiting-private-input` event:

```sh
python -u -B bootstrap.py --host-finalizer-stdin
```

Send one JSON line containing exactly these two fields, followed by a newline:

```json
{"name":"host-finalizer.json","content":"THE EXACT ORIGINAL UTF-8 PRIVATE FILE CONTENT"}
```

The value is the JSON-escaped original file text. The bootstrap disables terminal echo and canonical line limits before accepting it. It reads exactly that single line so later courier controls remain on the original stdin. The private packet must be 97,794 bytes with SHA-256 `505edce4abf6323391423b08aa9ac649049c157ac9a6e05acb0ec5f0ccbcbbad`.

Its original source is the private Commons repository at ref `05e676a4e1442c7b06fe574d3dc39e3bb74c19a1`, path `operations/scf-wordpress-native-83dd-20261012/finalizer-host.json`, Git blob `b6f906903b376bfd1cc3eaa7e3326bc7de577e32`. Keep that source and all native checkpoint/result bytes on the authorized private receiving surface.

If the exact private input is already retained at `/dev/83dd-wordpress-source-receiver/host-finalizer.json`, an ordinary invocation reuses it. A supplied input or retained complete file with different bytes produces a concrete conflict before native execution.

## Source completion happens inside the VM

The bootstrap validates the complete carrier and all five file digests before materialization. It retains exact existing files, rejects changed complete selections, parses both Python inputs, and serializes its source preparation through a local bootstrap lock.

It runs the original `prepare.py`, which checks the captured sources, original installed/Git donors and selected native host composition. Missing sources are fetched from the original public repository at the immutable product commit. Each received file must match its original Git blob and declared byte count. Commissioning and captured overrides stay attached to their complete original input.

Up to four independent public reads run concurrently. These reads use unauthenticated raw GitHub URLs and do not consume the authenticated GitHub REST call budget. Actual HTTP status and supplied Retry-After/rate-limit headers are preserved in progress events. Transient reads use at most three attempts and a shared provider retry clock. Successfully received source remains available if another path needs a later retry.

After each receiving round, the original preparer discovers the next transitive dependencies. The process continues until its selected source closure has no missing files. It also requires the existing exact host closure. A retained cache can be supplied:

```sh
python -u -B bootstrap.py \
  --host-finalizer /absolute/private/host-finalizer.json \
  --source-cache /absolute/retained/source
```

The cache has the original repository-relative paths and is checked against the original Git blobs. `--no-network` selects an entirely local preparation; `--workers 1` through `--workers 4` select public-read concurrency.

The fixed receiving, source, native record, operation and custody paths remain those in the reviewed carrier. The original installed PHP, WordPress, SQLite, Node, SDK, browser and native host dependencies are selected by the existing host input and preparer.


## Use the connected caller's retained source when VM downloads are unavailable

The original connected GitHub tool can retrieve the exact public carrier and Git blobs. Select the explicit stdin transport when the receiving VM cannot reach public raw GitHub:

```sh
python -u -B bootstrap.py \
  --carrier-stdin --host-finalizer-stdin --source-stdin --no-network
```

The ordered handshakes are:

1. `awaiting-carrier-input`: send one JSON line with exactly `name:"carrier.json"` and `content`, whose value is the original carrier's complete UTF-8 text.
2. `awaiting-private-input`: send the private fifth input in the same two-field shape described above.
3. `awaiting-source-input`: the event contains the preparer's actual current `missing` map. Receive those exact original Git blobs through the connected tool or retained caller cache, then send one JSON line shaped as `{"sources":[{"path":"ORIGINAL_REQUESTED_PATH","content":"ORIGINAL_UTF8_TEXT"}]}`.
4. Repeat only when the original preparer discovers further missing dependencies. After its complete closure is reached, the same process enters the original courier.

Each source bundle must contain every currently requested path exactly once, with no extra members. Every byte count and Git blob is validated before any bundle member is written. Path traversal and changed or duplicate members are rejected. After a transport interruption, recover the original tool session and its actual state before continuing an in-flight frame. When that preparation process has conclusively ended, a new preparation invocation can repeat the original input selection and reuse already committed exact files. Once the courier handoff occurred, continue its original native record.

Use actual JSON encoding for all content strings. A tool may stream a large JSON line in contiguous chunks; add the newline only after its complete frame. Await the next handshake before starting the next frame. No input line is echoed, and the receiving process reads only through its newline. Preserve all native checkpoint frames emitted after the final handoff in the caller's private capture.

These are alternative transport controls for the same five source inputs and original public dependency graph. Native registration, source identity, operation ID and recovery remain unchanged.

## Native handoff and continuation

At `enter-original-courier`, the bootstrap calls `execv`: its PID becomes the existing courier. There is no intermediary relay or additional native operation. The courier emits its original status, checkpoint frames and final custody result directly to the same caller.

Retain the complete private JSON-line stream. The existing `checkpoint_frames.py` can materialize an exact control checkpoint after a pre-dispatch registration failure. Save its small shared checkpoint immediately when the courier reports a successful shared path. Once a native command has started, its existing full continuation archive and original native record remain its receiving state.

For a known failed start, inspect the actual courier status and send its returned `resume_request` unchanged. The existing native runtime owns failure-digest validation and recovery under the original record lock. An uncertain save remains attached to the original helper attempt and finalized provider response.

The first commissioning attempt was observed on October 12 at 17:23:35 UTC as `launch_failed / runtime_registration_failed / OSError`, with no native child. Preserve that earlier observation as history. A fresh private namespace with unavailable old raw controls cannot reconstruct them; retained exact checkpoint bytes support restoration through the existing courier.

## Prepare, inspect or restore

These modes use the same reviewed source preparation and perform the indicated existing courier action:

```sh
python -u -B bootstrap.py --prepare-only
python -u -B bootstrap.py --status
python -u -B bootstrap.py \
  --restore-checkpoint /absolute/private/SCF_WordPress_Control_Checkpoint.json \
  --sha256 ACTUAL_CHECKPOINT_SHA256
python -u -B bootstrap.py \
  --restore /absolute/private/SCF_WordPress_Native_83DD_20261012.zip \
  --sha256 ACTUAL_ARCHIVE_SHA256
```

A restore verifies the actual selected artifact and restores the original operation through the maintained courier. It performs no native launch. Follow with the ordinary original courier and its freshly offered continuation.

The source-preparation exit describes source and host preparation. The original native result describes the WordPress installation, testnet payment, receiving, browser and resource journey. The original finalized save response identifies the complete delivery archive.
