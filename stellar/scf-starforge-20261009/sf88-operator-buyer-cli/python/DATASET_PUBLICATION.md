# Dataset publication from a complete Analysis export

The Dataset publication page prepares one **completed, typed query export** and
continues it through the existing Frictionless workbench and publisher. The
saved export is the source. This workflow does not rerun its SQL or acquire
another dataset.

The original Analysis navigation opens /publication under its existing private
access key. Recipes, jobs, source decisions and downloaded handovers use the same
Analysis workspace database and its existing backup/restore workflow.

## Source and decision identities

A recipe pins the original Analysis workspace, query-export ID, exact raw
manifest SHA-256, selected source columns, public aliases and representations.
The full-export binding records the actual tables and immutable source versions
read by that completed export. A preview row count is never used as the complete
dataset size.

Saving a recipe retains its exact request before checking the named recipe head
revision. Repeating that ID and body reopens the saved decision before requiring
the source files to be available again. A changed selection is a newly reviewed
recipe revision.

A dataset-package job streams every original typed row. The complete manifest is
published after the data and descriptor. A same-ID continuation verifies any
already-complete files and finishes missing derived outputs.

Each native source/publisher action is a dataset-source job. It retains the
original request, reviewed connection, prepared package index and deterministic
native request UUID before dispatch. The Node bridge uses the original
FrictionlessWorkspaceClient and maintained publisher methods.

**Analysis COMPLETE means the original native reply was retained.** Some
workbench and extraction methods return an accepted operation that is still
running. Read its original source request or publisher run for the actual outcome.

## Prepare the source in the browser

1. Use the existing Analysis full query-export workflow. Select a COMPLETE export
   with queryComplete true and the original typed rows.jsonl file.
2. Open Dataset publication and inspect its original IDs, raw manifest hash, full
   row count and typed preview.
3. Select the public fields explicitly; the first form selects none.
4. Set each public alias and representation. Reorder the selected fields when
   their public order matters.
5. Enter a package/resource name, public title and private rights/scope note.
   Select a license only when it is authorized for those values.
6. Save the reviewed recipe and prepare that exact saved revision.
7. Inspect its public files, private manifest/report and measured field statistics.

Public aliases begin with a letter and contain only letters, digits or
underscores, up to 48 characters. The names constructor, prototype and __proto__
are rejected. Private recipe names have a saved revision; public package/resource
names are lowercase identifiers.

### Representations

| Selection | Original value | Published value |
| --- | --- | --- |
| text | String or SQL null | Exact string or JSON null |
| integer | Integer within ±(2^53−1), or null | Exact safe JSON integer or null |
| number | Safe integer or finite float, or null | JSON number or null; negative floating zero is rejected |
| boolean01 | Integer 0/1, or null | JSON false/true or null |
| integer-text | Original integer, or null | Exact decimal text or null |
| sqlite-json | Original encoded SQLite scalar | A JSON string containing that canonical encoded value |
| base64 | Original encoded SQLite blob, or null | Canonical Base64 text or null |

No string is parsed as a number, timestamp or Boolean because of its spelling.
Exact decimal strings remain text when the text representation is selected.

The sqlite-json representation preserves distinctions within an explicit JSON
string. SQL null becomes the text null, an empty string becomes the JSON text
for an empty string, and an original string saying null stays a quoted string.
The original tagged binary/nonfinite encodings are preserved in that text.

A mismatch fails at its actual original row and column. The retained error
identifies row, source column, output alias and representation without copying
the private cell. Review a new recipe revision to choose another representation;
do not change an accepted preparation request.

### Standards and public scope

The descriptor uses the general **data-package** profile and a **data-resource**
with an explicit Table Schema. Its external resource is data.json. The v1
Tabular Data Resource profile permits only CSV for non-inline resources, so this
external JSON is not labeled with that profile.

Table Schema missingValues is empty. The descriptor preserves field order,
representation metadata, resource byte length and SHA-256. An operator-selected
primary key is declared for the native workbench to review; this serializer
does not introduce a second primary-key validator.

Official references:

- https://specs.frictionlessdata.io/data-package/
- https://specs.frictionlessdata.io/data-resource/
- https://specs.frictionlessdata.io/tabular-data-resource/
- https://specs.frictionlessdata.io/table-schema/

| File | Scope | Meaning |
| --- | --- | --- |
| datapackage.json | Public | Selected metadata, Table Schema and stable provenance IDs/hashes |
| data.json | Public | Every selected row in its reviewed representation |
| publication.zip | Public | Exactly the two public files above |
| recipe.json | Private | Complete reviewed selection and rights note |
| manifest.json | Private | Full native binding, recipe, file hashes and measured field statistics |
| report.html | Private | Human-readable source and package review |

The public descriptor excludes SQL, parameter text, private paths, tokens and the
rights note. Public title, description, license and selected values are
intentionally public. The public ZIP never includes the private handover files.

The data-file ceiling is explicitly selected, up to 256 MiB. The example defaults
to 64 MiB. Browser downloads buffer and verify at most 64 MiB per file. The CLI
streams the same retained files when they are larger.

## Connect the existing workbench

The launcher reads a private, caller-owned named connection file. The token is
read by the native bridge; browser actions select only a declared alias.

~~~json
{
  "schema": "stellar-forge.analysis-publication-connections.v1",
  "connections": {
    "publication": {
      "label": "Reviewed local publication",
      "url": "http://127.0.0.1:4200/mcp",
      "token_file": "/absolute/private/merchant-token.txt",
      "workspace": "dataset-source",
      "workspace_id": "11111111-1111-4111-8111-111111111111",
      "publisher": "dataset-publisher",
      "input": "analysis-package",
      "timeout_ms": 120000
    }
  }
}
~~~

Replace the example values with the actual original host identities. The native
workspace UUID comes from that workbench and differs from the Analysis ID.

Use the native host's existing configuration tools to declare its publisher and
an input of kind descriptor pointing to the exact package/datapackage.json.
The browser displays this actual input declaration after preparation. Its input
alias must match the connection. The bridge verifies the exact descriptor and
data hashes before the native capture; a copied input must retain those bytes.

The browser cannot submit an arbitrary input path or token. HTTPS is supported;
plain HTTP is restricted to numeric loopback. URLs are normalized to the original
client's URL form. A saved action cannot silently move to another origin, path,
publisher or native workspace. A changed endpoint requires a new reviewed request.

~~~sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/private/analysis-workspace \
  --checkout /absolute/original/stellar-runtime \
  --node /absolute/path/to/node \
  --publication-connections /absolute/private/publication-connections.json \
  serve --port 0
~~~

Install the maintained native client, workbench, publisher and their complete
dependency closure. The bridge has a static import of the original client. The
receiving programme also requires the actual native host/server application;
the client module alone is not that application.

## Native source and publisher sequence

1. Open the configured source workspace when needed.
2. Read its current status and declared input. Check the native workspace UUID,
   workbench version and exact selected package.
3. Capture the input using the current version and a reviewed label.
4. Read the original request until its native capture is complete.
5. Create an edition from its actual capture ID. The bridge supplies the selected
   ordered projection under the original query name PublishedData.
6. Review that edition and inspect every original resource result. A retained
   reply with ready false is not a completed source review.
7. Read the publisher's current source hash. Select the reviewed edition using
   that **prior current hash** as expectedSourceHash.
8. Load and inspect the original plan input, then save it with the exact edition
   and source review IDs.
9. Extract the plan and inspect its original run and candidate digest.
10. Inspect the actual publication target. Review the candidate with its exact
    digest, reviewer, note and target initialization/revision decision.
11. Publish with the same plan request, run and accepted review. Read/recover
    that original run until its actual outcome is known.
12. Prepare the full native source handover and retain all its indexed files.

The version fields are current concurrency checks. A background read does not
rewrite a typed decision. Use current selected identities copies actual observed
values into the form only when the operator asks.

The original native projection permits at most 64 fields. A string projection
cannot simultaneously preserve physical null and empty string with one
missing-value setting. The package itself preserves both; its private field
statistics expose that native constraint. Choose a compatible explicit recipe,
such as sqlite-json for that field, and save the revised decision.

## Interrupted replies and cancellation

The browser persists the exact body before every mutation, including retries.
If browser storage fails, the POST is not started. Reopening uses the original
Analysis workspace ID to recover its request history. Continue exact request
reads the original job, verifies its body, and preserves its ID.

The bridge reads an existing native workbench request before dispatch and
compares its original kind/input. Captures, editions, source reviews, selections,
plans and exports reuse those saved native UUIDs.

Publisher review and publication have distinct semantics. After an uncertain
review, the bridge checks the exact retained candidate review. After uncertain
publication, it uses the original run/recovery path. It does not create another
extraction, candidate or publication to replace an unknown result.

A transport error is not proof that a write was absent. Only an explicit native
not-applied or pre-dispatch outcome clears that uncertainty. Complete validated
native success takes precedence over a late local cancellation/timeout flag.

Cancelling an Analysis job requests its child process to stop. It does not claim
that a prior native commit was reversed. Read the original outcome. The bridge
retires its own transport resources; it does not call the borrowed workbench's
close action and stop somebody else's host.

## Python and streaming CLI

~~~python
from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace

ws = AnalysisWorkspace(
    "/absolute/private/analysis-workspace",
    checkout="/absolute/original/stellar-runtime",
    node="/absolute/path/to/node",
    publication_connections="/absolute/private/publication-connections.json",
)
try:
    review = ws.publications.review(
        original_export_id,
        manifest_sha256=original_manifest_sha256,
        sample_rows=20,
    )
    saved = ws.publications.save_recipe({
        "id": retained_recipe_request_id,
        "name": "SelectedEvents",
        "expected_revision": 0,
        "recipe": reviewed_recipe,
    })
    job = ws.start("dataset-package", {
        "id": retained_package_job_id,
        "recipe_id": saved["id"],
        "recipe_sha256": saved["recipe_sha256"],
    })
    # Poll ws.job(retained_package_job_id) using this same original ID.
finally:
    ws.close()
~~~

Native actions use ws.start("dataset-source", original_request). The body contains
the connection, action, original arguments, reviewed endpoint, expected native
workspace and package index shown in the browser. Native reads use
ws.publications.sources.read(original_read_request).

~~~sh
python -m stellar_forge_buyer.analysis_workspace --database "$ANALYSIS_DIRECTORY" \
  dataset-read --action configuration

python -m stellar_forge_buyer.analysis_workspace --database "$ANALYSIS_DIRECTORY" \
  dataset-recipe --request /absolute/private/reviewed-recipe-request.json

python -m stellar_forge_buyer.analysis_workspace --database "$ANALYSIS_DIRECTORY" \
  dataset-package --request /absolute/private/package-request.json

python -m stellar_forge_buyer.analysis_workspace --database "$ANALYSIS_DIRECTORY" \
  --checkout "$ORIGINAL_CHECKOUT" \
  --publication-connections /absolute/private/publication-connections.json \
  dataset-source --request /absolute/private/original-native-request.json

python -m stellar_forge_buyer.analysis_workspace --database "$ANALYSIS_DIRECTORY" \
  dataset-download --id "$PACKAGE_JOB_ID" --out /absolute/private/package-delivery

python -m stellar_forge_buyer.analysis_workspace --database "$ANALYSIS_DIRECTORY" \
  dataset-download --id "$SOURCE_DOWNLOAD_JOB_ID" --source \
  --out /absolute/private/source-delivery
~~~

The package/source commands wait for the original Analysis job. Their COMPLETE
result still preserves the separate native operation state. Request files must
retain the same IDs and bodies on continuation. dataset-read --action job accepts
a request containing id. source-read accepts the native read request.

dataset-download with --name streams one exact file; otherwise it downloads the
complete original index. Its --expected-sha256 option pins the file hash or the
whole index respectively.

## Offline handover and cold restore

The complete downloader saves its original index before file transfer, reuses
verified final files and writes a complete receipt after every file matches.

~~~python
from stellar_forge_buyer.analysis_publication_delivery import (
    DatasetPublication, download_publication,
)

receipt = download_publication(
    ws, retained_package_job_id,
    "/absolute/private/package-delivery",
    expected_index_sha256=reviewed_index_sha256,
)

# No source host, publisher or Analysis database is used by this reader.
delivery = DatasetPublication(
    "/absolute/private/package-delivery",
    expected_index_sha256=reviewed_index_sha256,
)
verified = delivery.inspect()
with delivery.file("data.json") as (stream, record):
    original_bytes = stream.read()
~~~

The same reader accepts a full native source-export delivery. It verifies the
original workspace/export/source identities, index and all bytes. Original
source.tar.gz, source edition, inspection, reviews and manifest retain their
native filenames and hashes.

The original Analysis workspace-export job now includes complete packages and
native source-export downloads. The saved database carries recipe editions,
requests, progress and accepted results. Tokens and launcher connection files
are not added.

Use the existing workspace archive download and
workspace_archive_receive.restore_archive. The restored project retains original
query exports, packages and native receipts. Completed local reads work without
the former source host. Further native actions require an explicitly configured
connection to the intended original workbench.

The offline CLI is dataset-open --directory, with optional
--expected-index-sha256. The original main parser still requires --database,
but this command verifies the delivery before constructing an AnalysisWorkspace.

## Original receiving input

The complete receiving programme uses the already-completed event export in
the original 7DE2 Analysis project:

- Workspace: 5e7e814ca0a4464680168c079b0430bb.
- Query export: 96fc26d02bd44f2197afdea394b4b6a1.
- Raw native manifest:
  266d598d6fe9dea6fed8d0867468587a7b0a0f139707615c9c705934f56a392e.
- Three complete retained rows, compared with one original preview row.
- Original workspace archive:
  4daa8c2c28cfe14263a69c32cb0e3733e043d223a320fdf83cc7daef51f7d0e3.

The programme keeps the full package, loses an accepted action reply, reopens
the same native identities, completes the actual source/review/plan/extraction/
publication, downloads both handovers, exports the complete Analysis workspace
and reopens it with the source host absent. Results record actual native states;
source checks are reported separately from a completed receiving outcome.


### Exact native index files

The retained package `downloads.json` and original source `files-index.json` can also be downloaded through the existing file route or `dataset-download --name`. Their SHA-256 is the original `index_sha256`. They remain private metadata and are outside their own file arrays. This preserves the exact original digest even when a status response includes additional recipe display fields. The complete Python delivery reads this retained index first, then copies every selected original file.
