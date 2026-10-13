# Receive original NHD geometry with fresh download batches

The final revision 18 NHD collection contains 148 original geometry responses and 265,649,171 original bytes. Its 25 count/ID scopes cover all 13 original-domain query rectangles and retain 81,057 distinct candidate OBJECTIDs before selection against the original 217 watershed polygon rings. Retained-file download URLs expire after a few minutes. The hydration command receives current URL batches into reusable local originals before the complete original-domain receiver runs.

Run from the application directory using its installed Python environment:

~~~bash
python -m source_tools.hydrate_nhd_originals \
  --bank /work/nhd-source-bank.json \
  --bank-sha256 PUBLISHED_SOURCE_BANK_SHA256 \
  --output /work/nhd-hydration
~~~

The command verifies and expands every source-bank member into a directory named for its published hash. It checks existing originals and writes:

- `remaining-downloads.json`: unresolved original filenames, byte counts and stable Notion references, grouped into batches of at most 25.
- `hydration-index.json`: native validation results and SHA256 identities of completed original files.
- `hydration-summary.json`: received files, bytes, remaining originals and current failures.
- `originals/`: complete original response bodies, unchanged.

For the first remaining batch, resolve its exact stable references through Notion's `get_file_download_urls` operation at download time. Save a plain JSON mapping from each original filename to its returned fresh HTTPS URL. The mapping may contain any subset of the remaining files:

~~~json
{
  "nhdplushr-domain217-native-zm-tile11-ids001-100.json": "https://fresh-returned-download-url"
}
~~~

Then run:

~~~bash
python -m source_tools.hydrate_nhd_originals \
  --bank /work/nhd-source-bank.json \
  --bank-sha256 PUBLISHED_SOURCE_BANK_SHA256 \
  --output /work/nhd-hydration \
  --downloads /work/nhd-downloads-current.json
~~~

Four files download concurrently by default. Each response is checked against its original byte count, original requested OBJECTIDs, publisher fields, native CRS and Z/M geometry through the existing receiver. The complete body is installed atomically only after those checks pass. Every successful file updates the index immediately. Interrupted commands retain all completed originals; incomplete temporary bodies never become accepted files.

Repeat with the next remaining reference batch until `complete` is true. Refresh HTTP-expired links through their stable references. Ordinary local original paths can also be used as mapping values. Keep temporary signed URLs out of source commits, Slack posts and permanent notes; distribute the stable references instead.

A later source-bank revision uses the same hydration directory. Previously accepted originals retain their names and bytes; the command verifies their hash and request identity, including the publisher metadata, and only receives missing originals. Invalid existing bodies move to `invalid-originals/` with their content hash and are included in the remaining download catalog. A process lock prevents two writers from downloading into the same directory.

The command exits zero for successful partial batches or catalog-only runs, and nonzero for actual download failures. Check the summary's `complete` and `remaining_files` fields to decide whether the complete receiving course is ready.

## Continue the original-domain source and model course

Use the latest completed source bank, original 217-HUC domain ZIP, and the hydrated directory with the existing merged receiver:

~~~bash
python -m source_tools.resume_nhd_originals \
  --bank /work/nhd-source-bank.json \
  --bank-sha256 PUBLISHED_SOURCE_BANK_SHA256 \
  --domain-archive /work/dbc61-upstate-model-domain-20261012.zip \
  --download-directory /work/nhd-hydration/originals \
  --output /work/nhd-capture-final \
  --edition /work/nhd-native-edition \
  --archive-output /work/nhd-native-edition.zip \
  --workspace /work/operating-workspace \
  --boundary /work/water-context-boundary.json
~~~

The receiver proves complete exact query-envelope coverage, runs selection against all original HUC polygon rings, prepares the native source edition, imports it through Workspace and runs the selected WaterContext assessment. A newly published source-bank revision uses a new receiver capture directory; the shared hydration directory continues to reuse the already received original geometry. Native project export and independent reopen follow the existing operator course.

## Completed original source edition

Use the complete revision 18 source bank: 9,205,104 UTF-8 bytes, SHA256 `1821e66c906e46a9ee873d8164ea7de0cfafc66a8713e02a97b813073d01d1a5`, containing 270 original source and operator metadata members. The four ordered source parts decompress to this single bank; retain and verify the complete bank before hydration.

The bank already includes `native/nhdplushr-domain217-native-zm-batch-006.json`, 104,245 bytes, SHA256 `292abfa7cfefbf843f467e3206f2350f6e6cd5e09ef878871718850d68c42bcf`. This is one original response containing 25 native Z/M features. Its local path may be the first downloads mapping value; the hydrator then produces the remaining stable-reference batches. Resolve later batches inside the receiving runtime immediately before downloading so the temporary links remain fresh.

All original count/ID query scopes are complete. The native receiver still performs the exact coverage comparison and original polygon-ring selection on the received bodies; the 81,057 candidate IDs are the query-envelope union, not a claimed count of features selected inside the watersheds. Original Z/M coordinates, fields, spatial reference and request identities travel unchanged.

After `complete` is true and `remaining_files` is zero, continue the existing full receiver command above using the actual application, original domain archive and Workspace paths. Keep the hydration directory when resuming. The selected source edition, Water Context assessment, report, project export and independent reopen remain parts of this same operation.


## Owner instruction: inspect the actual outgoing product

Before calling a client/prospect-facing app, website, dashboard, demo, report,
presentation or export ready, the producing peer must actually open, run or
render the exact outgoing version, LOOK at the rendered screen or its real
screenshots, and operate the important user controls. Check the actual
screenshare width and narrow/mobile width where relevant, populated, empty,
loading and error states, downloads/exports and reopening. Capturing screenshots
without viewing them is insufficient. Fix ugly, broken, unstyled, cramped,
clipped, overflowing or unreadable output within the authorized work before
presenting it. Code review, DOM counts, HTTP 200, unit checks or another peer's
approval do not replace seeing the actual product.

ALL ATTACHMENTS count. Literally open, view, play and use the final delivered
HTML, PDF, report, slides, spreadsheet, map, image, video, audio, archive and
project as its recipient would. For archives, extract and open the actual
contained deliverables and working project. Tests, checklists and screenshots
merely captured are not substitutes. Use available high-quality generative media
models and natural voice generation/TTS for videos; avoid robotic default
voices. Watch and listen to the final export for pronunciation, pacing, timing
and audio alignment. Keep building and fixing; inspection is not review/test
performance theatre.

For the Ecosystem product use plain industrial design: readable tables, clear
hierarchy, consistent typography and spacing, restrained controls, useful labels
and responsive layouts. No decorative template slop. Keep the real workflows,
data and computation. Reviews must lead directly to repairs and must not replace
hard implementation/integration or become endless rechecking. The existing
focused-validation policy remains; do not run broad suites or build a separate
verification product. Prior empty-Workspace screenshots are not acceptance of a
completed scientific Workspace.

PERSISTENT PROPAGATION REQUIRED: copy this rule into every active owner-controlled
policy/instruction surface the provider and workers actually read: global and
project AGENTS, CLAUDE, GEMINI and rules files, provider-specific boot instructions,
Commons source mirrors, cloud repository instruction copies, and current build
and receiving guides. Every delegating peer includes this complete rule in child
assignments, including its all-attachments and final-media clarification. Return
exact changed paths, source/version and readback. A Slack ACK alone is not
propagation. Preserve all existing owner controls and do not alter historical
evidence or third-party/vendor policies. No forced restarts, new watchers or
revival of owner-stopped work.

Continue the same Ecosystem Sprint Integration assembled product and its original
scientific, run, browser and receiver owners. Continue native source, runtime and
archive joins rather than diverting everyone to cosmetic review. Preserve the
October 13, 2026 fleet cutoff at 10:00 a.m. Eastern (EDT), 14:00 UTC. This project
cutoff does not expire the standing inspection rule or change other projects'
owner-directed schedules.
