# Receive original NHD geometry with fresh download batches

The original NHD collection has grown to 148 large responses and 265,649,171 bytes in source revision 17. Retained-file download URLs expire after a few minutes. The hydration command receives current URL batches into reusable local originals before the complete original-domain receiver runs.

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

Revision 17 includes every known candidate geometry while the final exterior query scopes are being finished. Receiving its existing original bodies can run immediately; the final source bank supplies those additional count/ID records before exact-domain selection.
