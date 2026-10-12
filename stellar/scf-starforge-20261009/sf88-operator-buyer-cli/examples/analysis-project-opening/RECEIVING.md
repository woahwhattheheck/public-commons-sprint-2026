# Open the Analysis project

Open **project.html** to work through the saved project in a browser. It contains
the original source files, complete dataset rows, saved SQL, report publications,
workbook editions, and receiving instructions. Search and sort the data, inspect
the source and version behind a result, and download the original files.

The offline reader verifies its embedded snapshot and every downloadable file.
It works from the extracted project without a server. Its table cells retain
integer and decimal text, including the source value `599.010000`
and the saved signed 64-bit query parameter.

## Project contents

| Location | Contents |
| --- | --- |
| `project.html` | Complete offline project reader |
| `project-data.json` | The full typed project snapshot used by the reader |
| `project-manifest.json` | Complete file inventory with byte counts and SHA256 values |
| `archives/analysis-workspace.zip` | Native portable archive for continued editing |
| `archives/archive-manifest.json` | Original native archive inventory and source workspace identity |
| `workspace/` | Exact archived database, reports, workbooks, exports and retained response sources |
| `runtime/python/` | Complete selected Python application and receiver source |
| `runtime/native/` | Matching original Node source and retained dependency files |
| `source/` | Complete project-opening, packaging and viewer source |
| `receiving/` | Original native receiving results and selected source/runtime inventories |
| `open_project.py` | Verify this package, receive the project and open the native application |

The three original sources are regional sales, game records, and three
acknowledged event-stream records. Their source manifests preserve the original
result status, response bytes, completion information and chosen mappings.
Dataset versions keep their original identities. Reports and workbook editions
retain the selected query revisions, source columns, row ordering and original
file downloads.

## Continue editing in the native application

Use Python 3.12 or later and the installed Node executable. The package contains
the selected application source and dependency files. Choose a new working
directory below a private parent; keep the extracted package as your receiving
copy.

On Linux, for example:

```sh
mkdir -m 700 "$HOME/analysis-work"
python3 -B /absolute/Analysis_Project/open_project.py \
  --workspace "$HOME/analysis-work/customer-project"
```

The launcher first verifies every file in the complete package, then uses the
original native archive receiver. It starts the same Analysis browser
application for saved queries, dataset views, reports and workbook editing.
Use `--node /absolute/path/to/node` when Node is not on PATH, or
`--no-open` to receive the local launch URL without opening a browser.

The launcher reuses the original receiving journal for that destination.
Opening it again preserves subsequent saved queries, workbook revisions and
other local project changes. The existing native workspace lock keeps one
editing process at a time.

To receive the project and return without starting the browser:

```sh
python3 -B /absolute/Analysis_Project/open_project.py \
  --workspace "$HOME/analysis-work/customer-project" \
  --receive-only
```

You can supply an explicit 32-character hexadecimal `--operation`
when an external workflow has already recorded the native receiving ID.
Continue with that same ID after an interruption.

## Work with the original sources

Response registrations retain their original names, revisions, hashes and
source metadata. The complete native archive carries their input files in:

```text
analysis-response-sources/<original-source-sha256>/
```

Each source directory has a complete `capsule.json` and all original
file bytes. Stream sources include the original manifest and request, the
typed record export, and the original response file or acknowledged prefix.
The MCP source includes its original result and metadata files.

The native readers resolve these files in the received workspace and verify
their original identity. Local path relocation changes only the in-memory file
addresses required to open a received copy. The original metadata and source
registrations remain available for inspection.

The saved SQL remains editable. Choosing to run a query is an ordinary explicit
action in the native application. The offline reader shows the existing SQL
and its retained results.

## Make the next complete workspace archive

Use the native browser's workspace archive action after saving your changes.
The native receiver and exporter preserve the current SQLite snapshot,
completed report and workbook files, exports, and locally retained response
sources. Review the complete file selection, then keep the same export ID
through an interruption or resume.

If you register another existing stream or MCP response, retain its files before
making the next archive:

```sh
PYTHONPATH=/absolute/Analysis_Project/runtime/python \
python3 -B -m stellar_forge_buyer.response_sources \
  --database "$HOME/analysis-work/customer-project" \
  --checkout /absolute/Analysis_Project/runtime/native \
  --node /absolute/path/to/node \
  --all
```

Close the native browser process before this command so its original workspace
owner lock is available. The command copies and verifies the registered input
files and leaves the source revisions unchanged.

## Use the native receiving commands directly

The packaged Python source provides the original CLI:

```sh
export PYTHONPATH=/absolute/Analysis_Project/runtime/python

python3 -B -m stellar_forge_buyer.workspace_archive_receive inspect \
  /absolute/Analysis_Project/archives/analysis-workspace.zip \
  --sha256 ORIGINAL_ARCHIVE_SHA256

python3 -B -m stellar_forge_buyer.workspace_archive_receive receive \
  /absolute/Analysis_Project/archives/analysis-workspace.zip \
  "$HOME/analysis-work/customer-project" \
  --operation ORIGINAL_RECEIVING_ID \
  --sha256 ORIGINAL_ARCHIVE_SHA256

python3 -B -m stellar_forge_buyer.analysis_workspace \
  --database "$HOME/analysis-work/customer-project" status
```

The exact archive SHA256 and workspace identity are in
`project-manifest.json`. The native receiver verifies every archive
member before publishing the workspace. If interrupted during extraction,
repeat the same receive command. If the workspace has already been published,
the same command validates the retained receiving record and returns it while
preserving later local revisions.

## Build another complete offline project

The reusable builder consumes an exact native workspace archive:

```sh
PYTHONPATH=/absolute/Analysis_Project/runtime/python \
python3 -B /absolute/Analysis_Project/source/build_project.py \
  --archive /absolute/new-workspace.zip \
  --archive-sha256 EXACT_SHA256 \
  --viewer-template /absolute/Analysis_Project/source/portable.html \
  --extra-files /absolute/selected-source-files.json \
  --output /absolute/private/new-project
```

The optional selected-file document is an array of
`{path, source, bytes, sha256, mediaType?}` entries. Paths are relative
to the new project package; source locations are exact existing regular files.
Use it to carry this guide, the complete source/runtime, receiving records and
the launcher with the next project. Retain those same selected files through
a resumed build.

The builder includes every native archived payload and the complete SQLite
table contents. It uses the native dataset-view registry for saved views and
does not run saved SQL recipes. It writes the offline reader, typed snapshot,
file manifest and complete ZIP together. Repeating a completed build verifies
and reuses the exact original files.
