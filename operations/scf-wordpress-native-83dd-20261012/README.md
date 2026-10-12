# Original WordPress native receiving carrier

This packet prepares and launches the existing operation `scf-wordpress-native-receiving-83dd-20261012` from its reviewed WordPress source. Product and native source remain f167c3e524b782ceb6dd196df81f6b97886442a9; commissioning remains 4c62463acfae23b50fb3327d7eafeb087e8b4806. One original native supervisor owns execution and durable result custody.

## Receive the five exact inputs

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

If the supervisor ends without a saved receipt, the outer process retains a metadata-only recovery state. It does not move archive or upload work outside the released allocation.

## Restore the retained continuation

Prepare the exact original source and selected dependencies in the original private paths, then invoke this same launch file:

```sh
python -B launch.py --restore /absolute/SCF_WordPress_Native_83DD_20261012.zip --sha256 ACTUAL_SAVED_ARCHIVE_SHA256
```

Restoration checks the complete archive digest, member identities and hashes. It refuses conflicting private files or an active original owner, restores selected donor references and performs no launch. Inspect the original result before choosing its maintained continuation. A completed operation remains completed; a started failure retains its original WordPress, approval, acquisition, budget and payment identities.

Actual native installation, payment, receiving and resource closure are reported by that original native result.
