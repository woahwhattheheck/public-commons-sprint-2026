# Original WordPress native receiving carrier

This packet prepares and launches the existing operation `scf-wordpress-native-receiving-83dd-20261012` from its reviewed WordPress source. Product and native source remain f167c3e524b782ceb6dd196df81f6b97886442a9; commissioning remains 4c62463acfae23b50fb3327d7eafeb087e8b4806. One original native supervisor owns execution and durable result custody.

## Receive the five exact inputs

The directly readable `launch.py` is the same exact source embedded in the carrier; `courierSource` binds its byte length and SHA-256. `checkpoint_frames.py` is the caller-side control-frame receiver, bound by `checkpointReceiver`.

Read `carrier.json` as UTF-8 JSON and validate schema `stellar-forge.wordpress-native-carrier.v1`. Its four complete public inputs are `input.json`, `prepare.py`, `host-selection.json` and `launch.py`. Fetch the fifth input, `host-finalizer.json`, from the exact private repository, ref, path and Git blob in `privateInputs`. Validate every byte length and SHA-256 before transfer. That private packet stays on the receiving host.

Use the accompanying `receiver.py`, whose digest is also recorded in the carrier. It accepts exactly these five input names. Its write and commit actions enforce offsets and identical retries. It parses Python inputs before committing them. A retained receiver reporting a different input set must be reconciled before selecting this receiver; source transfer has no native launch side effect.

The source metadata lists 4,694 original SCF files and carries 40 complete selected files. Preparation consumes their exact bytes and the selected installed/Git donors with lazy Git fetching disabled. An unavailable original Git donor becomes a missing-source report in `SOURCE_CLOSURE.json`; already retained source remains usable. Native execution requires the complete selected source.

The fifth input composes two exact additive source postimages into the complete selected installed native host at 62c14ca97b0e3aac0acae58e0bee78af3dd66569. Preparation verifies the original source reader, all transitive Python sources and both original preimages. It copies that complete closure into `/dev/83dd-wordpress-native-host`, verifies and parses each file, and writes `HOST_CLOSURE.json`. The installed donor is unchanged. The launch checks every resulting host file against this closure before original registration.

The original runtime reuses installed PHP, clean WordPress 6.8.3, corrected SQLite, the shared-core helper, Stellar SDK, Node, Python, Playwright and Chromium. It also selects the existing Library helper and its original siblings.

## Execution and custody share the original reservation

The launch enters the original `ForegroundLaunch` in the same dedicated process. Its additive `on_finalized` callback runs only after the actual native child has ended, its native result is written, and the original recorder and completion streams have closed. Archive creation, upload staging, the installed save helper and any uncertain-save reconciliation all run before the original memory and disk admissions release. The same supervisor PID, lease keys and queue sequence remain their owner.

The callback receives the actual native result directly. It never waits for its own supervisor to finish or invokes a second native registration. Native installation or receiving failure is retained independently from the result's durable save. A failed callback returns a distinct supervisor exit code while preserving the original native result.

Before first registration, records are selected as `/dev/83dd-wordpress-native-records`. Project, worker, source and custody remain in the same private namespace. The original 1,024 MiB whole-operation memory declaration, 256 MiB reserve and clean-cache selection remain intact.

| Selected path | Additional storage declaration | Purpose |
|---|---:|---|
| Original private project | 128 MiB / 6,000 inodes | WordPress, commissioning, seller/buyer state and results |
| Original private worker | 64 MiB / 1,500 inodes | Runtime temporary files |
| Original private records | 32 MiB / 300 inodes | Request, process, completion, logs and retained artifacts |
| Private custody directory | 384 MiB / 100 inodes | Complete continuation archive, possible full helper staging copy and save responses |

The custody declaration covers a 192 MiB archive plus one possible 192 MiB helper staging copy. Private TMPDIR, TMP and TEMP, and a forced Python `tempfile.tempdir`, select the courier's own directory throughout the helper. Archive data streams in 1 MiB chunks. Runtime and shared-core symlinks are retained as references; their donors are not copied into the archive.

Callback diagnostics move to a separate courier log after native record streams close. Thus the retained native record stays stable while the archive inventories and hashes it. The archive includes actual terminal failure outputs, exact source selection, original native records and the dedicated testnet/account/session state needed for continuation.

## Durable result and original-request recovery

The complete private archive is `SCF_WordPress_Native_83DD_20261012.zip`. The courier invokes the existing `library_upload.py` with one complete JSON request and EOF. It retains the private request, helper state and full response. A save requires a finalized result item with `status:"succeeded"`, the exact archive path/name, real file and Library IDs and version.

An actual saved receipt is required even when the native supervisor returns zero. The courier emits the saved identities and archive digest before attempting a compact shared receipt at `/workspace/scratch/83dd50f1866b/wordpress-native-custody/scf-wordpress-native-receiving-83dd-20261012.json`. Shared write failure does not discard the provider's returned identities.

A definite failure before the helper process starts is retained as `helper-not-started`. The same original request may then retry. Once a helper started, an uncertain save stays attached to that original attempt. During the callback's retained reservation, stdin accepts:

- `{"action":"status"}` to inspect the original custody state.
- `{"action":"retry-save"}` only for a known helper-not-started attempt.
- `{"action":"record-finalized","archive_sha256":"...","result":{...}}` to adopt the actual original finalized save item.
- `{"action":"retry-custody"}` to finish a failed local archive step while the same reservation is live.

If the supervisor ends without a saved receipt, the outer process retains the original recovery state and, when the command is still undispatched, a bounded exact control checkpoint. In that original private namespace, `{"action":"resume-native"}` can continue an undispatched queue. If an original launch failure is present, select `{"action":"resume-native","recover_failure":"EXACT_RESULT_JSON_SHA256"}`. The courier freshly checks the original request and the absence of a live owner, process, command output, completion allocation or stop request. It passes the exact failure digest to the maintained `resume_capacity` contract, which validates and retains that failure under its original record lock. The same source, record, operation and finalizer are reused. A started command remains attached to its original outcome. Archive and upload work stays inside the resumed supervisor’s reservation.

## Restore the retained continuation

Prepare the exact original source and selected dependencies in the original private paths, then invoke this same launch file:

```sh
python -B launch.py --restore /absolute/SCF_WordPress_Native_83DD_20261012.zip --sha256 ACTUAL_SAVED_ARCHIVE_SHA256
```

Restoration checks the complete archive digest, member identities and hashes. It refuses conflicting private files or an active original owner, restores selected donor references and performs no launch. Inspect the original result before choosing its maintained continuation. A completed operation remains completed; a started failure retains its original WordPress, approval, acquisition, budget and payment identities.

Actual native installation, payment, receiving and resource closure are reported by that original native result.

## Recover a registration failure before the command starts

The native runtime remains the authority for registration, locks, process ownership and failed-start recovery. Its original `result.json` is never rewritten by this courier. A registration failure now produces an additional private error record with the actual exception type, message, errno and filename when Python supplies them. A missing errno remains missing.

Every `status` request freshly reads the original native owner state and exact control files. Its `native.result` contains the full SHA-256 and byte count of the original `result.json`, including native `error_type`. Its `native.error_details` retains the caught exception. The ready `native.resume_request` is either the exact supported JSON action or null with explicit reasons. Send that returned action unchanged. The maintained native runtime rechecks the original registration and failure under its own lock.

```json
{"action":"status"}
```

A known failed start returns a request shaped like this, with the **actual** digest:

```json
{"action":"resume-native","recover_failure":"EXACT_RESULT_JSON_SHA256"}
```

A retained queue without a failed-start result returns `{"action":"resume-native"}`. A dispatch marker, live original owner, completed result, unreadable control or incomplete checkpoint restoration prevents that action from being offered. Once the command has started, its existing native continuation and complete private archive remain authoritative.

### Read the actual original error

Use the fixed `record` or `courier` scope. Relative paths stay inside those exact original roots; links, traversal and the native lock are rejected. Each range identifies the entire file by SHA-256 and returns exact base64 bytes, total byte count and `next_offset`. A provided SHA-256 must still match, so ranges cannot silently join different versions. Hashing streams through a small buffer.

```json
{"action":"control-read","scope":"courier","path":"native-launch-error.json","offset":0,"limit":16384}
{"action":"control-read","scope":"courier","path":"native-launch-error.txt","offset":0,"limit":16384}
{"action":"control-read","scope":"record","path":"result.json","offset":0,"limit":16384}
```

The courier captures an exception in memory before attempting to save it. If a local control write fails, the returned error includes that actual persistence failure and the bounded checkpoint still contains the caught original exception. It does not substitute a guessed capacity diagnosis.

## Preserve a pre-dispatch checkpoint across session loss

Before waiting after an eligible failed start, the courier takes the original record lock for a stable, small control snapshot. It preserves all physical native controls except the lock, the four initial project source/host/launcher artifacts, the exact caught error and an existing courier-adoption record. It refuses a started project, native dispatch/completion/stop state, linked members or more than 2 MiB of control bytes. The resulting JSON has a 4 MiB upper bound. It contains the original request and failure bytes, not reconstructed values.

This control checkpoint does not run a WordPress child, create the full application ZIP or invoke the save helper. Those larger operations continue inside the original supervisor's admission. The checkpoint uses a small in-process compression buffer and emits its complete transfer frames even if its private file cannot be written.

The `checkpoint-ready` event gives raw and compressed byte counts and SHA-256 values. It is followed by:

1. `checkpoint-begin`, selecting the original operation and both exact identities.
2. Contiguous `checkpoint-write` ranges, with offsets and base64 bytes.
3. `checkpoint-commit`, binding the complete compressed stream.

The courier also attempts to retain the exact small JSON at the shared original custody path, ending in `.checkpoint.json`. A successful `shared_path` is reported; an actual write failure remains visible. Save that shared file promptly through the existing persistent file workflow. Retain complete transfer frames when the shared write cannot complete. The receiving orchestrator must keep the original untruncated JSON-line stream; it can fetch any missing exact ranges before releasing the private session. The accompanying `checkpoint_frames.py` materializes one selected checkpoint into a private local JSON file, validates both hashes and refuses truncated or conflicting ranges:

```sh
python -B checkpoint_frames.py \
  --input /absolute/original-courier.jsonl \
  --sha256 ACTUAL_CHECKPOINT_SHA256 \
  --output /absolute/private/SCF_WordPress_Control_Checkpoint.json
```

Save that exact small file through the operator's existing persistent file workflow and retain the returned file identity and version. The source carrier contains no private checkpoint. After the actual native command ends, its existing full continuation archive also carries the retained checkpoint, caught error, restore journal and courier-adoption metadata. The emitted native failure digest remains the selection for recovery.

A lost portion of the transfer can be retrieved from the same retained courier without rereading the entire record:

```json
{"action":"checkpoint-read","sha256":"ACTUAL_CHECKPOINT_SHA256","offset":0,"limit":12288}
```

These offsets refer to compressed bytes. Repeat the same selection and advance using `next_offset`. `{"action":"checkpoint"}` resends the current eligible checkpoint's complete frames; an unchanged checkpoint retains the same raw digest. Ordinary status and heartbeat responses stay concise and never resend its full data.

### Restore through the original receiver

Prepare the same five reviewed inputs and complete original source/host closure on the receiver. Replay the retained `checkpoint-begin`, `checkpoint-write` and `checkpoint-commit` objects directly to `receiver.py`. The receiver preserves identical range retries and verifies the complete compressed and decoded packet before committing it. The checkpoint is a separate control transfer; it does not add another source input.

Then send:

```json
{"action":"checkpoint-restore","sha256":"ACTUAL_CHECKPOINT_SHA256"}
```

The receiver invokes the same courier's control restore, which verifies every member and destination before writes, checks the actual original owner, and restores under the native record lock. Conflicting or additional existing native state is preserved. A restore journal retains the exact checkpoint selection; interrupted restoration can repeat that same packet. Request visibility comes last, and native launch refuses an unfinished restore.

The same restore is available directly when the exact private JSON file is already on the receiving host:

```sh
python -B launch.py --restore-checkpoint \
  /absolute/private/SCF_WordPress_Control_Checkpoint.json \
  --sha256 ACTUAL_CHECKPOINT_SHA256
python -B launch.py --status
```

Restoration performs no native launch. Enter the ordinary courier with the receiver's existing `launch` action, inspect its fresh status, and send the returned original `resume_request`. The original operation, request bytes, failure history, source, commissioning command and capacity declarations remain selected. A checkpoint from the earlier published 880e6514 launcher keeps that exact `NATIVE_LAUNCH.py` artifact and records the new courier as an explicit source adoption.

The eventual full custody archive carries the retained launch error, launcher adoption and checkpoint/restore history with the original native record. A fresh archive uses one creation timestamp for its manifest and saved identity. Recovery preserves an already saved archive identity after verifying its complete ZIP digest and size, including archives created by the earlier courier.

The first observed commissioning registration failure was at 2026-10-12 17:23:35 UTC in record `3743770b3d824a0db0dfa2b852050bd9618995b369cdac90daad5701150bae1a`. Its returned native metadata was `launch_failed / runtime_registration_failed / OSError`; the native command had not started. The original five-input and 1,048-file source closure remain selected. The repaired courier retains each available original control and actual error detail so subsequent recovery selects those exact bytes through the maintained native runtime.
