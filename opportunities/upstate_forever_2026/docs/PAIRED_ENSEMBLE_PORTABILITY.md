# Retained paired ensembles: portable result and report-source receiving

The existing paired-ensemble application stores, exports and receives completed
results through the shared `model.portable_fs` implementation. Scientific model
execution, paired reductions, annual mass units, missing values, original member
identities and native-version provenance remain owned by the existing producers.
This course uses our already retained development/reference results. Tim's future
customer data is not a software packaging dependency.

## Included source

Keep these application-relative files together:

- `model/paired_ensemble/ensemble_store.py`
- `model/paired_ensemble/ensemble_portable.py`
- `model/paired_ensemble/ensemble_report_source.py`
- `model/paired_ensemble/ensemble_report.py`
- `model/paired_ensemble/ensemble_rasters.py`
- `model/portable_fs.py`
- `model/windows_fs.py`

The existing `paired-ensemble-report` component fragment includes this dependency
closure. Its original `paired-ensemble` and `observed-context` requirements, native
operator routes, CLI and report-source composer remain in place. The shared
filesystem implementation supplies the existing Windows handle/locking layer and
POSIX directory-descriptor operations; this contribution adds no second server,
model runtime, job dispatcher or alternate workspace format.

## Saved records and portable archives

Mutable experiment records use completed-file replacement. Immutable records,
result archives and captured original files use create-only publication. On a
filesystem that does not support hard links, the shared layer writes and verifies
a same-directory temporary copy, then publishes it with the platform's atomic
no-replace operation. A differing existing immutable file remains an error;
matching saved capture records keep their existing reuse behavior. There is no
fallback that replaces an existing recipient result or truncates its contents.

Archive writers flush their completed ZIP through a writable file handle before
publication. Source streams are counted and hashed while their actual bytes are
written to the ZIP, then compared with the original descriptors. Receiving verifies
those same descriptors and the original analysis, selection, report and native-run
bindings before publishing the completed directory. Original archive member names
are retained. Case/Unicode aliases, Windows device names, alternate-stream names,
file/directory conflicts and noncanonical names are rejected rather than silently
renamed. There is no new global archive-size limit; the existing explicit receiving
disk allowance and metadata reader capacity remain available.

Internal Windows I/O uses the existing extended-path helper. Result receipts retain
ordinary caller-facing absolute paths. Receiving writes through the shared pinned
parent-directory abstraction, synchronizes original files and directories, and
publishes the completed directory create-only. Interrupting receiving leaves the
prior published result unchanged; repeat into a new destination with the original
archive. Temporary receiving directories are removed on normal exception cleanup.

The existing report writer publishes its original text and grayscale PNG overviews
through the same native path, replacement and directory-sync layer. PNGs are
flushed through their writable temporary handle. The paired-analysis producer also
uses native source/output paths and shared tile/result replacement. It closes GDAL
writers first, then opens the completed TIFF with write access on Windows for the
required flush before publication. POSIX keeps its original read-only flush handle.
The numerical member loops, support masks, quantiles, units, aggregation and raster
encoding are unchanged. The existing source fingerprint identifies a new producer
edition for future analyses; previously completed analyses keep their original IDs,
source fingerprints and retained result bytes. Transfer or report regeneration does
not rerun the original scientific models.

## Operate an original completed result

Use the installed application Python and an already complete paired product. Keep
all output destinations outside the source product. The existing CLI is unchanged:

```sh
python -B -m model.paired_ensemble.ensemble_cli export --project ORIGINAL_PRODUCT --out NEW_RESULT.zip
python -B -m model.paired_ensemble.ensemble_cli receive --archive NEW_RESULT.zip --out NEW_RECEIVED_PRODUCT
```

Run from the application directory, or set `PYTHONPATH` to it. On Windows the
packaged Python executable can invoke the same module and arguments. Paths may
contain spaces and Unicode; quote each complete path in the shell.

The received `index.html` is the original retained offline report. Open it, follow
its original download links, then close it and move the complete received directory
to another parent folder. Reopen the moved `index.html` and its retained downloads.
Compare the original and received `analysis.json`, its selection ID and every
member declared in `ensemble-project.json`; all quantitative and report member
bytes should remain identical. A second receive into that existing directory must
preserve it and report that a new destination is required.

After preserving that byte-identical transfer, exercise the normal report writer
on the independent received copy, not the original retained product:

```sh
python -B -m model.paired_ensemble.ensemble_cli report --project NEW_RECEIVED_PRODUCT
```

Open the regenerated report and its original quantitative downloads. Its analysis
selection and scientific summaries remain those of the received original product.

## Capture the original scientific report source

The normal operator action still prepares the original scientific source through
`ensemble_report_source.prepare` and `Workspace.import_sources`. Programmatic use
of the same adapter is:

```python
from pathlib import Path
from model.paired_ensemble.ensemble_report_source import capture, export_source, inspect

project = Path("ORIGINAL_PRODUCT")
captured = capture(project, Path("NEW_CAPTURE_ROOT"))
source = Path(captured["directory"])
checked = inspect(source)
archive = export_source(source, Path("NEW_CAPTURE_ARCHIVE.zip"))
assert checked["ensemble_id"] == captured["ensemble_id"]
```

The complete captured directory contains `sources.json`, the original report-source
recipe, unrounded scientific summary, every declared original quantitative/report
file, and its implementation sources. Use the normal source-collection importer
with that `sources.json`, including its complete companions. Keep the archive's
relative directories intact when receiving it with the existing source-archive
workflow. This source archive and an ensemble-result archive have different
manifests and should be opened with their corresponding existing workflow.

New captures retain and fingerprint four implementation files: the report producer,
its storage implementation, `portable_fs.py` and `windows_fs.py`. Their fingerprints
participate in the capture identity; a changed implementation creates a new capture
edition rather than mutating an old edition. These files are provenance companions,
not a substitute for the installed application package. Older complete capture
records remain inspectable using their recorded identity and file inventory.

Repeating capture with the same source, title, workspace identity and implementation
returns the same completed source. Re-exporting to a matching existing source ZIP
checks its complete inventory and original bytes before returning `reused=True`.
A duplicate, altered or incompatible archive is rejected and remains untouched.

## Practical release check

Exercise the course on the actual retained product without rerunning InVEST:
result export, independent receive, moved-folder report opening, scientific-source
capture and source export, and ordinary repeat/reuse behavior. Compare the original
stored identities, summaries and member hashes. On a suitable development volume,
also exercise the shared verified-copy path when hard-link creation is unavailable.
The existing report controls and original download links should be clicked once.

For the native TIFF publication path, use an independent working copy of retained
original tile records and the same original selection/bands with the existing
materializer, then compare the result arrays and metadata. Keep the original
completed product untouched. This exercises the repaired writer without dispatching
InVEST or inventing replacement scientific inputs.

This document specifies the operating course; execution outcomes belong with the
exact tested application revision and product in the release coordination thread.
The collection's root Windows launch and the three native software payloads remain
part of the whole-workbench release, outside this saved-result adapter.
