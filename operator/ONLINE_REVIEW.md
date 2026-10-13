# Customer reviews in the original operator

Open the existing scientific operator and choose **Customer reviews**. This
workflow composes retained sources, saved maps, models, deliveries and review objects in the
same Workspace. The source and response histories remain available through the
original workspace backup and restore.

## Create the review selection

Choose **Create review**, enter its title and purpose, and select any combination
of original source editions, completed saved map exports, completed native model
runs and completed deliveries. The saved-map choices show the original title,
paper size, resolution and retained output count.

Expand **Inspect map and original files** to load the original PNG, open the PDF
and download the SVG or complete map pack. This keeps the current review form and
its selected requirements intact. The displayed image and every download use the
same recorded map export and existing file tickets.

A completed map pack also offers **Create customer review** in its file view and
completed export task. This opens the same review form with that exact map already
selected. Choose any additional original source editions or issuer criteria that
should travel with it. A saved map can be reviewed as soon as its own export is
complete; model runs and deliveries can be added in a later review selection.

**Add issuer requirements** loads the complete retained 33-item EC-SDC profile.
Each item keeps its issuer page and source details. Existing requirement IDs stay
intact; the action adds only missing IDs and records the profile's exact source
hash in the selection notes. Requirements can be edited, added or removed before
saving. Select the actual issuer source edition as part of the review when its
original PDF and companions should travel with the exported files.

Saving creates an immutable review through the original operator task. Reopening
a task after interruption reuses its original creation time and selection. To
change the sources, outputs, purpose or requirements, choose **New selection** on
an existing review. Its previous response history remains associated with the
original selection.

## Inspect the retained work

Open a review to browse:

- **Files:** every complete selected original, its source attribution, byte
  identity and latest decision, with direct downloads.
- **Requirements:** the full selected criteria, original source details and
  latest requirement decisions.
- **Corrections:** assignments, affected artifacts and requirements, priority,
  state and actual resolution from the latest retained response.
- **Response history:** the chronological original response chain, reviewer
  context, decision changes from the preceding response, complete correction
  records and downloadable response documents.
- **Exported desks:** each previously exported response generation. Every desk
  continues to open its exact original package after the operator reopens.

**Compare selections** uses the original review comparison engine for changed,
added, removed and unchanged files. It also shows the selected purpose and
requirement changes, and provides the complete comparison JSON.

## What travels with a selected saved map

The selection uses `spatial_export_ids`, alongside `source_collection_ids`,
`run_ids` and `delivery_ids`. Each selected map is opened through the original
`SpatialExports.inspect` implementation. Creating the review verifies its complete
native file set and saved-review binding. The current map format contributes its
14 declared outputs and `export.json`: the PDF, SVG, PNG, original saved view,
annotations, provenance, renderer/source description, package inventory and
complete map bundle remain the original files.

The online file view labels the selected maps and their coverage. The offline desk
shows each completed map as its own selection; PNG/PDF previews, artifact decisions,
requirements, corrections and response history use the same controls as every
other original file. Exported paths preserve the map file relationships. Returning
the response, exporting a later response generation and restoring the original
Workspace carry these same map and review identities forward.

## Native command workflow

Run from `opportunities/upstate_forever_2026` with the existing scientific Python
environment. `catalogue` now includes `spatial_exports`, each with its original
export ID, saved-review ID, selection, state and `reviewable` flag.

```bash
python -m model.review_cli --workspace /work/upstate catalogue
python -m model.review_cli --workspace /work/upstate create-map SAVED_EXPORT_ID \
  --title "Upper Savannah source map review" \
  --purpose "Review the selected domain, source context and map annotations" \
  --source-edition RETAINED_SOURCE_EDITION_ID \
  --requirements source/acceptance/20261012/review-requirements.json
python -m model.review_cli --workspace /work/upstate export REVIEW_ID /work/review-desk \
  --zip /work/review-desk.zip
python -m model.review_cli --workspace /work/upstate response-import /work/response.json
python -m model.review_cli --workspace /work/upstate history REVIEW_ID
```

Use the actual IDs returned by the preceding operation. `create-map` accepts
multiple saved export IDs, repeated `--source-edition` and `--note` options, and
an optional requirement list or the retained issuer profile. It records the
requirement source filename and hash in the review notes. The general `create`
command continues to accept a complete selection JSON for any mixture of source,
model, delivery and saved-map records.

A review ZIP contains the selected files and review history. For continued native
geographic editing, use the original `workspace-backup` and `workspace-restore`
commands; that archive includes the maintained Workspace and application. Reopen
the restored review through `show`, the online operator or a fresh exported desk.

## Export and continue a review

Choose **Export current review**. The retained operation captures the displayed
response predecessor. If another response arrives before this operation captures
the workspace, reopen the current review and select its updated generation.

When the task completes, **Open review desk** launches the full original review
application over that export's exact files. The existing file session and
download engine serve only the recorded package members. The generated desk uses
its own exact script hashes; selected source HTML continues through the normal
file sandbox.

The same task provides **Complete offline review desk**, a ZIP containing
`index.html`, `review.json`, `response-template.json`, `review-manifest.json`,
the README and all selected original files with their native companion paths.
Download and extract the ZIP to use it independently. Open `index.html`, enter
the actual reviewer context, record decisions and corrections, then export the
complete response JSON.

Existing export tasks reuse their own inspected directory and ZIP after
interruption. A later export gets a new task directory and captures its new
response generation. Earlier exported packages remain readable.

## Receive the complete response

Open the corresponding review and choose **Receive response**. Select its
returned JSON. The operator displays the reviewer, disposition, time, decision
counts, corrections and complete original document before retaining it.

The original review backend checks the project, selected review, predecessor,
every artifact decision, every requirement decision and each correction. An
identical already retained response returns its existing record. A response
based on an older predecessor must be reconciled with the current history.
The operator retains the original upload as well as the normalized response.

Reopen the review to inspect the changes. Export the current desk to continue
the inherited decisions and corrections. Its response template carries the
latest predecessor and leaves the next reviewer's identity blank.

## Existing operation and file interfaces

All mutations use the existing `POST /api/actions` queue and retained
`operation_id`:

| Action | Payload |
| --- | --- |
| `customer.review.create` | `{"selection": <upstate.customer-review-selection/v1>}` |
| `customer.review.export` | `{"review_id": "...", "expected_response_id": null_or_latest_id}` |
| `customer.review.response.import` | `{"review_id": "...", "upload_id": "..."}` or the complete `response` object |

Read routes are `/api/reviews/catalog`, `/review?review_id=...`,
`/template?review_id=...`, `/compare?before_id=...&after_id=...` and
`/spatial-export?export_id=...`. The last route returns the original completed map
record with its existing authenticated file downloads. The catalogue returns
`spatial_exports` for the same complete saved-map choices.
Each accepts the existing `workspace` key. Completed task views expose the
original `_downloads` and a `_review` descriptor.

The desk route is
`/api/file/review-desk/<original-export-task-id>/<package-member>`. It shares
the original download cookie, file tickets, byte-range support and per-file
identity checks. It uses the existing web server, package format and task queue.

## Source composition

- `operator/customer_reviews.py` binds the original review APIs to existing
  tasks, uploads, file tickets and exact export generations.
- `operator/web/reviews.mjs` provides the online selection, inspection,
  saved-map inspection, comparison and receiving workflow; `reviews.css` uses the original gray
  workbench style.
- `model/reviews.py` supplies the original review engine. Its additive
  `created_at`, `expected_response_id`, `review_file` and
  `describe_export` interfaces make original task recovery deterministic.
- The small server, application and navigation registrations preserve the
  existing spatial and community workflows.
