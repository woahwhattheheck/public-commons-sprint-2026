# Complete STAC operation in one equipped allocation

This source continues `SCF-STAC-MANAGED-APPLICATION-RECEIVING-B710-20261012` from the received Austin imagery and Cirrus processing workspaces. The selected product remains `7169c10e37a1800d22133efaf37cfaac5d96e343`, tree `eda6ec9050eeedb4bd401c66b7bfba0b604a8fca`. The existing builder, installer, managed-application receiver, lifecycle and predecessor installation supply the actual application behavior.

## Why this correction is needed

The original native-01 allocation reached the real source receiver on October 12 at 15:22 UTC. It assembled 3,338 Git objects and reported 1,675 missing blobs before the application continuation. The caller had omitted the complete archive already declared in its source-selection file. An existing additional Git donor can also retain an unavailable alternate, which needs an actual metadata read before the original receiver can use it.

The same allocation produced its complete 10,082,595-byte failure archive. The original one-shot HTTP PUT returned 502; a following provider read returned File is not ready. This correction uses the maintained parallel upload engine for the complete native output.

The shared scratch filesystem also reached zero available bytes. The existing one-allocation carrier runs this whole operation in its owned private filesystem, transfers the final archive there, and retains selected complete outputs on shared storage when actual capacity permits.

## Complete source

The files in this directory have these responsibilities:

| File | Purpose |
| --- | --- |
| `complete-source-input.json` | Original twelve-member input/source bundle, preserved at SHA-256 `f153feb61d1f6adaa9549b9d63c5ce0972ab9ec4d910e380af5938d1cd5c0350`. |
| `receive-and-continue.py` | Complete caller with both qualified archive inputs, actual optional-Git admission and the existing source/application continuation loop. |
| `one-allocation.py` | Complete wrapper that verifies original source/builders, runs the caller, captures full results and uploads the complete archive through the maintained transfer engine. |
| `native-receiving.py` | Complete original dispatch with twenty exact-byte intake members, the existing carrier and a retained terminal for following source or transfer commands. Private provider selections arrive from an owned request file. |
| `native-source-receiving.py` | Complete source-qualification companion. It receives the pinned saved checkout, verifies matching original blobs, stages the existing flat intake and executes the unchanged native procedure in the same terminal. |
| `native-source-receiving.py.gz.b64` | Whole gzip transport of that same companion, encoded as base64 text for one compact source transfer. |

The original bundle includes the selected private input, its original shared predecessor, both preceding native callers, and all eight selected product source bodies. The dispatch replaces only the selected receiving caller, supplies the current wrapper and retains the earlier caller/wrapper preimages with native-01's actual result and transfer reconciliation.

The existing Commons carrier is `integrations/shared_equipment/native_one_allocation.py`, full SHA-256 `18508b5c566d13c7d6f4a4ec680f2d34c84d12fcc741f38a466b4679aeea66b9`, merged in Commons PR 35330. Its original put/run/read/pack/upload behavior is retained. `OPENFEMA_OPERATION_ID` selects this operation's identity. The dispatch supplies the complete initial command stream in one allocation. When launched with a terminal and an owned private request file, it then reads following commands from that same terminal so the source cache, delivery archive and upload logs remain available.

## Selected source archives

Both complete archives are original source-owned deliveries. The original receiver streams them and admits only Git blobs that match the selected 7169 source metadata.

| Archive | Exact bytes | SHA-256 | Pinned file |
| --- | ---: | --- | --- |
| `source-db3d9cb3d64f.tgz` | 13,032,106 | `d953328850112533ada23b7a9b4b92a22178c902d635c3c999894ae9d4dc1edb` | `libfile_3f476ddd80548191bec55a808c89ce88/v0`, `file_0000000007c481f98c9b288dcdfa06a1` |
| `tokenjunkielabs-starforge-merchant-0.1.0-source.gd16e851341db.tgz` | 13,790,968 | `f750e8abe0a8a3e61bc628027202063d212990d2327be9c02b5356e542fb6c96` | `libfile_970767081ea88191a2ba37aa50dfc85b/v0`, `file_00000000b0cc81f9a1dc3f4138138e7a` |

The primary archive declaration in `operation-code/source-selection.json` remains exact. The explicit paths use `STAC_DECLARED_SOURCE_ARCHIVE` and `STAC_D16E_SOURCE_ARCHIVE`. Each selected file must be a canonical regular file with its declared byte count; the receiver verifies the whole archive SHA-256.

The optional D1CC Git repository is checked through the original `git --no-replace-objects --no-lazy-fetch ... cat-file --batch-check`. The caller records the actual result and includes the donor only when its object metadata is usable. Its existing alternate configuration remains in its original custody.

## Complete checkout qualification and existing source intake

The complete companion reads the original saved `completed-scf-checkout-sources-20261012.tar.gz`, pinned as `libfile_60f77ed06a608191be37d1c9e1cd7394/v0` and `file_00000000b2f081f5b2ef6b5c967f41d8`. Its selected compressed byte count is 17,463,296. The existing LibraryFileMaterializer receives that exact version; the qualifier computes its full archive SHA-256 from the actual bytes.

The residual source selection is the complete `native-02-missing-objects.json`, 71,756 bytes / SHA-256 `b2c56fbccf5b58e7de48592c30ea2bcf367d8a716d864a38ed6c6566265e92d6`. It records 467 original Git blobs for source 7169. The qualifier streams regular archive members, reads candidates of the selected sizes and calculates each original Git blob ID. Only exact matches are retained, with their full bytes and original archive member names.

The companion copies those verified bytes into `/dev/b710-stac-applications-7169/operation-base/incoming/<OID>.blob`. The selected source receiver already supports this flat incoming format; the original receiving caller, builder and application loop are unchanged. All three complete source programmes are embedded and hash-checked: the 53,232-byte native procedure, the 6,490-byte qualifier and the 6,315-byte carrier.

The actual qualification result, original qualifier stdout and complete preceding native-02 result files enter the same delivery. A failed qualification opens the original carrier in that same allocation so its original diagnostics and selected inputs remain available. A successful qualification enters the unchanged full native procedure.

### Compact transport of the complete programme

The plain companion contains 93,866 bytes with SHA-256 `2ba2af8ab83d02a1b63df3123368323c085be3133b7103c613325bf9a93e662e`.

Its checked transport is:

| Representation | Bytes | SHA-256 |
| --- | ---: | --- |
| Gzip payload | 29,904 | `9ae517021a31a98d1eb05b0d3225d76491836a8f20973e708dfb13010165afdf` |
| Base64 text file | 39,872 | `a8c6ef0803f2f9f0022611d9fe0858baa744b2ed746602487c84f43e5ecb675b` |

The unmodified [pako 2.1.0 gzip encoder](https://raw.githubusercontent.com/nodeca/pako/2.1.0/dist/pako_deflate.min.js) produced the gzip. The existing standalone decoder independently checked the gzip CRC, complete output length and every restored source byte. The compression changes the transport representation; the decoded programme remains the original complete companion.

A receiver with both source files can compare them using Python's existing standard library:

```python
import base64, gzip, hashlib
from pathlib import Path

encoded = Path("native-source-receiving.py.gz.b64").read_bytes()
assert hashlib.sha256(encoded).hexdigest() == "a8c6ef0803f2f9f0022611d9fe0858baa744b2ed746602487c84f43e5ecb675b"
packed = base64.b64decode(encoded, validate=True)
assert len(packed) == 29904
assert hashlib.sha256(packed).hexdigest() == "9ae517021a31a98d1eb05b0d3225d76491836a8f20973e708dfb13010165afdf"
source = gzip.decompress(packed)
assert len(source) == 93866
assert hashlib.sha256(source).hexdigest() == "2ba2af8ab83d02a1b63df3123368323c085be3133b7103c613325bf9a93e662e"
assert source == Path("native-source-receiving.py").read_bytes()
```

A native bootstrap can embed the complete base64 text and verify the same bytes before compiling and executing the source. Keep the original terminal and private request-file argument through that transport.

## Equipped source and runtime inputs

The operation reads the following selected existing sources:

- Six-file operation source and fixed Git metadata: `/workspace/scratch/b71092915960/stac-managed-applications-native/operation-code`.
- Eight pinned builder files: `/workspace/scratch/b71092915960/stac-applications-source-7169/builder`.
- Original predecessor installation: `/workspace/scratch/d1ccf784531e/scf-dataset-applications-native/runtime-recovered-eea35`.
- Received imagery and processing: `/dev/shm/b710-cirrus-native-20261012/operation/received-scenes` and `received-processing`.
- Original bundle: `/workspace/scratch/b71092915960/stac-managed-applications-native/complete-source-input.json`.
- Complete source-owner archive guide: `/dev/shm/b710-stac-source-archive-receiving/STAC_Complete_Archive_Receiving.md`, 19,044 bytes, SHA-256 `ec7b2abde2dedcec6f743bd41307858cd18a5d933d66a2606efecc7818a3296c`.

The complete metadata stays Git blob `56da861934c0a161c8ab76b64a17c2a9b421d557`. The selected input differs from its shared predecessor only in the private `builderDirectory` copy. Project, cache, runtime, source, predecessor and closed data remain selected by the original operation.

The private root is `/dev/b710-stac-applications-7169`. Existing Node and Python are used, with `PYTHONDONTWRITEBYTECODE=1`, `NODE_OPTIONS=--max-old-space-size=160` and an owned temporary directory.

## Maintained upload dependency

The wrapper imports the existing transfer API from `/workspace/scratch/b71092915960/wherobots/library-upload-20261012` and verifies the full source of its three modules before the application run:

| Module | SHA-256 |
| --- | --- |
| `library_upload.py` | `b11e4929596e321366c2f7291890fbb6d6bf8b413ae6d24593e9548f9bf50f23` |
| `library_file_transfer.py` | `5c81478cd94a59d721a1677d0bd36f7cec23c18a21b48740b1c9ff94d27fb26f` |
| `library_hosted_apps.py` | `b7961301f7ca6f76b2f2f30e4e5673a303532680a790e545c3207a2bf5e63de4` |

All three complete modules are retained with the native delivery source. The existing `azcopy` executable was observed at `/usr/local/bin/azcopy`, version 10.32.7.

The wrapper calls `UploadRequest.parse` with the actual final archive, `PreparedUpload.parse` with the complete original returned object, and `SignedUrlUploader.upload` with a fresh empty private state directory. A reservation with a null size remains unchanged; the request measures the actual finished archive. The uploader's successful index determines the transfer result.

## Whole native dispatch and retained terminal

Reconcile the original operation and any returned native handle before dispatching. The original native-02 run completed its source phase at 17:09:38 UTC: 4,546 Git objects / 45,107,825 raw bytes were retained, with 467 exact blobs / 6,836,872 bytes still needed for the selected whole product. Its complete archive has 4,607 members, 16,015,069 bytes and SHA-256 `c844ec20fb579e99f847f7bbf704a4b50bd6b75f9f168d389be515d1901ac0db`. The maintained uploader returned an empty success set, and the independent original-file read returned File is not ready. Its non-TTY allocation ended before its private upload diagnostics could be read.

The following attempt continues this same operation with `attemptLabel: "native-03"`. The label distinguishes original logs, transfer selections and shared result filenames. Preserve the completed native-02 results. One owner holds the actual native handle throughout acquisition, application receiving, transfer and provider finalization.

Prepare both pinned source versions through the existing materialization contract. Prepare the final `SCF_STAC_Managed_Applications_Native_20261012.zip` upload through the original file-provider contract. Write the complete private request into an owned file with mode 0600 in the same allocation:

- `qualificationTransfer`: the complete original transfer object for the pinned 17,463,296-byte checkout archive above.
- `archiveTransfers`: the complete original db3d9 transfer object followed by the complete original d16e transfer object.
- `upload`: the complete original opaque upload object.
- `attemptLabel`: `native-03` for this complete qualification and following native attempt.

Launch the actual command with the execution tool's terminal setting enabled, passing the private file as an argument:

```sh
python3 -B -u native-source-receiving.py PRIVATE_REQUEST.json
```

The request-file argument leaves the original terminal available. Standard-input redirection consumes that channel; it retains the earlier one-shot behavior and ends the private allocation when the preloaded commands finish.

The complete companion qualifies the saved checkout and stages exact matching blobs into the original incoming directory. It then runs the unchanged procedure, which downloads and verifies both selected source archives, applies their returned attributes, reads the unchanged original bundle, verifies all twenty intake members and runs the selected wrapper through the original carrier. The fixed source receiver expands source closure against the original tree and invokes the maintained STAC application continuation when complete. The continuation performs the real source build, predecessor installation/upgrade, installed-source verification, managed-application receiving and lifecycle.

After the initial put and run, the input adapter reads the next command from the original terminal. The existing carrier, its command implementations and operation phases remain in the same process. Its original `read`, `put` and `run` commands are available for the next action. Read specific result files or logs by their known paths; the original `status` command also enumerates the whole source tree and can produce a very large response.

## Results, transfer recovery and finalization

The wrapper retains full stdout/stderr, source and runtime outputs, selected input, original callers, all operation/builder source and maintained upload modules. It creates and CRC-checks the complete ZIP and records its exact bytes, SHA-256, member count and transfer outcome. Private provider selections and transfer logs stay in the owning allocation.

Keep the returned terminal handle active while inspecting the run. For native-03, `transfer-native-03.json` reports the transfer outcome and `upload-native-03/transfer-0.log`, `upload-native-03/logs/` and `upload-native-03/jobs/` contain the maintained uploader's original private diagnostics. These can include provider credentials, so inspect them privately and retain only sanitized public error details. An empty successful-index set does not identify its underlying cause; use the original log and original-file readiness result to choose the following action.

A nonzero source outcome retains the full source cache and missing-object list. Qualified additional source can be received into this same allocation and passed to the unchanged source receiver. The remaining source must satisfy the selected Git object hashes; the application continuation determines actual build and installation completion.

After a successful transfer, finalize the complete original opaque object through the same provider contract while this allocation remains active. Apply the returned attributes to the exact archive. Once the file has been finalized and independently read back, stop the existing carrier:

```json
{"command":"stop"}
```

Stopping the carrier triggers the existing shared-output retention step. It preserves selected full result files under the attempt label and copies the complete ZIP if sufficient shared space remains. Existing same-label results must match exactly. The archive copy uses an exclusive temporary file and removes only the temporary file created by that copy.

A failed process creation changes no native state. An actual returned process or uncertain transfer is reconciled using its existing identifiers and logs before another execution or transfer. The retained terminal is the source recovery boundary; keep it alive until the actual output and provider result have been preserved.

## Related completed receiving

The imagery/processing workspaces remain the original product inputs. The later C79F customer workflow completed all ten native stages on October 12 at 14:55:33 UTC, including the original processing import, imagery comparison, asset/range review, analyst decisions, exports, second-workspace receiving and reconnect/reopen lifecycle. Its separate completed package and SCF application adoption are in the original STAC thread.

- [Original STAC application thread](https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791761556094779)
- [Complete source-owner archive guide](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8LH0PAN6)
- [Existing carrier source and full-byte handoff](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8EK8UDAR)
