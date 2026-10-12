# Download and use a merchant object from Python

The Python object application selects an original SF30 S3 product, prepares its
native SF88 object session, continues the download across process restarts, and
returns the complete file to the application. The same session also opens in
the original [object CLI and offline report](../OBJECTS.md).

`ObjectBuyer`, `ObjectSession`, `ObjectReport`, `ObjectDelivery`, and
`ObjectDownloadError` live in `stellar_forge_buyer.objects`. The original Python
`Runtime` launches `python/object-bridge.mjs` through its fixed `object` target.
The existing Node session owns the range plan, queue, durable attempts, terminal
approvals, saved responses and assembly receipts. The Python layer creates no
parallel payment state.

## Use the installed original runtime

Use Python 3.11+ on Linux or macOS, a complete current checkout containing the
object application and the original Node runtime/dependencies. Install the
companion from that checkout:

```sh
python -m pip install ./stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python
```

The wheel contains the Python application; its Node bridge and original buyer
components come from `checkout=`. Upgrade both together. The existing
[Python buyer guide](README.md) covers runtime installation, configured buyers,
native operator workspaces and file readers.

Obtain the actual merchant's `objects.json` from its S3 release. Select the
merchant's payment terms through the existing buyer setup and initialize its
native operator workspace. The selected operation must be a base `GET` route
with no query, body or response destination. Object preparation derives the
exact `offset` and `length` for each request and owns those response paths.
The descriptor must describe a nonempty `chunks` product. The original
single-response buyer handles whole-mode and empty files.

Keep sessions and outputs in an existing private directory. All examples below
use illustrative paths and an object alias; replace them with the selected
merchant's actual files, alias and authorized spending limits.

## Prepare the complete download

```python
from pathlib import Path
from stellar_forge_buyer.objects import ObjectBuyer

downloads = Path("/private/customer/downloads")
downloads.mkdir(mode=0o700, parents=True, exist_ok=True)

buyer = ObjectBuyer(
    checkout="/work/public-commons-sprint-2026",
    timeout=900,  # includes native operator prompts and all remaining requests
)
session = buyer.prepare(
    downloads / "archive-session",
    workspace="/private/operator/archive",
    description_file="/private/customer/merchant-objects.json",
    object_id="archive",
    max_total_atomic="3000",
)
print(session.last_report.native)
```

When only `workspace=` is supplied, the bridge obtains `configPath` through the
original `openWorkspace` in offline mode. It retains that workspace's signer,
policy, evidence directory, payer and spending ledger. This mode does not open
the workspace key file or import its signer. An explicit `config_file=` can
select an existing original operator configuration; supplying both makes the
native session enforce their shared workspace bindings.

Preparation selects exactly one descriptor row and binds its route, byte count,
snapshot, content type, chunk cap and optional whole-file SHA-256. The native
selection retains the original description's SHA-256 and object alias. Use
`chunk_bytes=` to choose a smaller size within the advertised cap.

`max_total_atomic` is an integer **string** for the entire download. It must cover
`ceil(bytes / chunk_bytes) × original per-request maxAtomic`. For example,
1,843,229 bytes in 921,600-byte chunks needs three requests. A per-request cap of
1,000 requires a total allocation of at least `"3000"`. These allocations are
caps; the native chunk outcomes and ledger determine the actual payment state.
The original workspace's live total and daily policy limits still apply.

Preparation creates a new private native session and inbox without making a
request. Existing sessions are not overwritten. Open one with `buyer.open(path)`
instead of preparing a second session for the same acquisition.

## Return a real application file

Run a download from the operator terminal so the original SF62 approval can
review each actual quote and exact request. The Python runtime keeps the
controlling terminal and passes cancellation to the original Node process.

```python
delivery = session.download(downloads / "archive.zip")
print(delivery.path)            # actual assembled absolute path
print(delivery.assembly)        # original assembly receipt, byte count and SHA-256

with delivery.open() as stream:
    import zipfile
    with zipfile.ZipFile(stream) as archive:
        member_names = archive.namelist()
        # Feed selected members to this application's importer.
```

`download()` first checks the output location. For a new destination it resumes
the original queue, requests only untouched chunks, and calls the original
streaming assembly when the session is complete. Each completed chunk retains
its original intent, response headers, saved bytes and outcome. Original session
validation checks the exact range, total bytes, snapshot, content type and
digests before treating those bytes as complete.

When that destination already has an assembly receipt in this session,
`download()` reopens it and verifies the current file before returning it. It
makes no new HTTP request in this case. An existing destination without the
matching session receipt is refused before acquisition. If another process
creates the destination during a download, native assembly still refuses to
overwrite it; the downloaded chunks remain available for a new destination.

Use `session.run()` to finish the acquisition without assembling, or
`session.assemble(new_destination)` to assemble an already complete session.
Multiple new destinations are supported, each with its own native receipt.

## Consume large files with the existing readers

`ObjectDelivery` extends the existing `FileDelivery` interface:

| Method or property | Application behavior |
| --- | --- |
| `path` | Exact recorded destination as `pathlib.Path`. |
| `open()` | Rehashes the current file and yields the same opened binary descriptor from its start. |
| `read_bytes(limit=8_388_608)` | Reads a bounded small object; use `open()` for larger objects. |
| `json(limit=8_388_608)` | Parses bounded JSON using the existing strict reader. |
| `csv_rows(encoding="utf-8-sig")` | Yields CSV dictionaries without materializing the complete file. |
| `save_as(new_destination)` | Copies verified bytes into a new private file without overwrite. |
| `verify()` or `raise_for_status()` | Checks the actual current file and returns the delivery. |
| `assembly` | Original snapshot, session, configuration and chunk-manifest bindings, size and SHA-256. |
| `receipt_recorded` | Whether native assembly successfully retained its handoff receipt. |

For an existing consumer that requires a pathname, call `delivery.verify()`
before passing `delivery.path`. Prefer the open descriptor when the consumer
supports it. Each `open()` revalidates bytes, so retain one open stream for a
sequence of reads instead of reopening it for every block.

The live assembly result says `SAVED` with `fileRevalidated: true`. After restart,
the same native receipt says `RECORDED` with `fileRevalidated: false`: it records
the prior assembly, while the destination could have moved or changed. The
Python reader checks that destination when it opens it. `status` retains the
original assembly status; it is not a payment classification.

If a completed assembly could not save its receipt, the native result retains
the exact saved file with `receiptStatus: "NOT_RECORDED"`. Preserve that returned
delivery and inspect the native error before using the same path again. The
native chunks remain available for a new assembly destination.

## Restart, cancellation and original outcomes

```python
from stellar_forge_buyer.objects import ObjectDownloadError

session = buyer.open("/private/customer/downloads/archive-session")
progress = session.last_report
print(progress.status, progress.complete_chunks, progress.chunk_count)
print(progress.native["nextChunk"])

try:
    delivery = session.download("/private/customer/downloads/archive.zip")
except ObjectDownloadError as error:
    print(error.code)
    print(error.progress.native.get("stoppedChunk"))
    # After the original process has exited, inspect/recover this same session.
```

The native process handles SIGINT/SIGTERM. The shared Python runtime also
forwards a timeout or keyboard interruption to it. `run()` returns a valid
interrupted native report when one was produced. `download()` raises
`ObjectDownloadError` when it has a report but no complete application delivery;
the exception carries `progress` and `operation` (the same session).
An unavailable or invalid subprocess result raises the existing `NativeError`.
Neither path creates a replacement intent or repeats an attempted payment.

After the original process exits, `session.recover()` performs native offline
recovery. It reads retained queue outcomes and response records and can release
a proven-dead local session lease. `READY` means an unattempted chunk can run;
`COMPLETE` means the original chunks can be assembled. For
`RECONCILIATION_REQUIRED`, `stoppedChunk` supplies the actual intent and local
response/evidence locations. Use the original inbox for that exact intent:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs show \
  --root /private/customer/downloads/archive-session/inbox \
  --intent ORIGINAL_STOPPED_CHUNK_INTENT
```

The original [queue workflow](../QUEUE.md) provides its saved-result recovery and
finalization commands. Chunk records expose `originalOutcome` and the original
reservation; file completion does not replace those financial outcomes.
Do not submit these queue-owned intents through a separate Python `Operation`.

Inspect, recover, assemble, reopen delivery and export require no signing keys.
An original session created through the Node CLI can open through Python and
vice versa. Keep its absolute directory and the original shared workspace,
evidence and ledger in place; copying an object session to a different pathname
does not rebase its native bindings.

## Review progress and export a handoff

```python
progress = session.inspect(chunk_offset=0, chunk_limit=100)
for chunk in progress.chunks:
    print(chunk["index"], chunk["state"], chunk["intentId"], chunk["originalOutcome"])

session.export_report(downloads / "archive-report.html")
session.export_report(downloads / "archive-report.json", format="json")
delivery = session.delivery("/private/customer/downloads/archive.zip")
```

The ordinary response keeps the original scalar summary under `native`, one
chunk page (default 50, maximum 250), and the latest 25 assembly receipts.
`record["chunkPage"]` carries offset, total and next offset;
`record["assemblyPage"]` carries receipt offset and total. `next_chunk_offset`
is a **report page** offset, while `native["nextChunk"]` is the next native
request. The complete HTML or JSON export includes every chunk and receipt.
Exports are private, create-only files. The HTML is the original offline
operations view and can be opened without a server.

Original inspection and receipt reopening validate the retained chunk files,
so they read the completed object bytes. Paging limits subprocess output, not
that original validation work. Retain the returned `ObjectDelivery` for repeated
application consumption. Use one complete exported report for reviewing many
chunk pages instead of repeatedly inspecting the session.

## Runnable application example

`examples/download_object.py` supplies `prepare`, `status`, `run`, `recover`,
`download`, `assemble`, `consume`, and `report` commands. Each command accepts
`--checkout` and `--session`; use `--help` after the command for its own options.

```sh
python examples/download_object.py prepare \
  --checkout /work/public-commons-sprint-2026 \
  --session /private/customer/downloads/archive-session \
  --workspace /private/operator/archive \
  --description /private/customer/merchant-objects.json \
  --object archive --max-total-atomic 3000

python examples/download_object.py download \
  --checkout /work/public-commons-sprint-2026 \
  --session /private/customer/downloads/archive-session \
  --out /private/customer/downloads/archive.zip

python examples/download_object.py consume \
  --checkout /work/public-commons-sprint-2026 \
  --session /private/customer/downloads/archive-session --as binary
```

The binary example streams the file into a concrete application consumption
loop. CSV consumption counts rows and columns through the existing iterator;
JSON consumption reports the bounded document shape. Replace those loops with
the application's actual importer. They perform local reads only.

For a merchant using the same original byte-range contract but no S3 description,
`buyer.prepare_explicit(directory, bytes=..., chunk_bytes=..., snapshot=...,
max_total_atomic=..., config_file=..., sha256=..., content_type=...)` accepts
already-reviewed facts. `sha256` and `content_type` are optional; `snapshot` and
the complete byte plan are required. An absent expected whole-file digest still
produces the measured assembled SHA-256 and retains the original range/snapshot
and per-chunk validation.
