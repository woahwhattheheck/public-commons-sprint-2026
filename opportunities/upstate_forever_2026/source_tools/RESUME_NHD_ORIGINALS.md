# Receive and finish the retained NHDPlus HR originals

This receiver connects the saved original HTTP responses to the current scientific source intake. It reuses the complete native inventories and arbitrary geometry batches already retained by ECO13-AE11, fills uncovered grid cells through the maintained adaptive collector, and requests only missing native geometry IDs. It then selects whole source features intersecting the original 217-HUC polygon union, assembles a transferable source edition, imports into an existing Workspace, and optionally runs the current Water and Habitat Context analysis.

## Source and dependencies

Run from the Upstate application root containing model/ and source_tools/. The application must include capture_water_sources.py from PR2884, merge 270d5162048fa5a1ccd887c7dc86d2b0264d8299 or a compatible successor. Its capture_layer function accepts stream_spatial_relation. Preserve the newer geometry-selected FW intake from PR2856 and all independent consumers.

Python uses the existing project dependencies. Exact polygon selection requires Shapely; the existing source intake/native model uses the application's GDAL/PROJ environment. This utility adds no dependency and no Actions workflow.

The current original-response bank is Slack Canvas F0C8UD4L25S, revision 2. Save its complete JSON code block, without Markdown fences, as nhd-original-progress.json. Verify the bank against the SHA256 printed with that exact revision. The receiver independently verifies the bank and every decoded member.

The exact target is 217 original HUC12 IDs with SHA256 ec0cb3d05a0ede9da1b9238b7c7bff2fa495d94e5a6a0451890b54233edfbd52. Supply the retained original domain ZIP whose members include model-domain.esri.json.gz, feature-bindings.json and domain-summary.json.

## Recover the three larger original responses

inventory-progress.json within the bank contains native_geometry_pages. For each row, its stable_reference identifies the exact original file attached to the existing Eco source page:

https://app.notion.com/p/3f7dd77231008124b767e1dccf8a706e

Resolve those stable references through the authorized Notion file-download tool and download the original response under its recorded filename. The download tool returns temporary signed URLs; retain the stable references in work records. Never rewrite or format the original JSON bodies.

You can instead create a local JSON mapping from each recorded filename to its downloaded path or a freshly resolved HTTPS URL. Pass that file with --downloads. The receiver checks each response's original byte count, native-ID equality, full native fields, EPSG:3857, Z/M flags and coordinate dimensions, then records its own content hash for later resumes. It preserves each full original response.

Revision 2 contains three geometry references: first 100 IDs, next 500 IDs and a 50-ID response, totaling 2,177,267 original bytes for 650 requested IDs. The receiving process performs the feature-level checks before admitting them. The diagnostic XY-only singleton remains a separate companion; it is excluded from native Z/M pages.

## Run through complete source import

From the application root:

~~~sh
python -m source_tools.resume_nhd_originals \
  --bank /data/nhd-original-progress.json \
  --bank-sha256 127777b1cd8978872c2a397bc2081db94763cdadb9c2a0a8ab57dbd505be3e0a \
  --domain-archive /data/dbc61-upstate-model-domain-20261012.zip \
  --download-directory /data/nhd-original-downloads \
  --output /data/nhd-source-capture \
  --edition /data/nhd-source-edition \
  --archive-output /data/nhd-source-edition.zip \
  --workspace /data/existing-upstate-workspace \
  --timeout 180 \
  --chunk 500
~~~

For a different bank revision, use its actual published hash. A running capture is pinned to its original bank hash. Resume it with the same bank, output directory, domain archive and edition path. Start another output directory when adopting a different bank snapshot.

Add --boundary /data/retained-boundary-reference.json to execute model.water_context.build immediately after source import. That file is the actual native boundary reference:

~~~json
{"collection_id":"existing-imported-collection-id","source_id":"existing-polygon-source-id"}
~~~

Use the real existing collection/source values. The source binding supplies the NHD stream-order overlay automatically. The model writes its normal saved assessment; the receiver also retains workspace-bindings.json, water-context-selection.json and water-context-assessment.json in the capture directory.

--counts-only finishes the entire native candidate inventory and retains any supplied geometry, then exits before acquiring remaining geometry or creating a source edition. An ordinary invocation resumes those same caches.

## Coverage and interruption behavior

The bank contains the complete 4x4 grid of the original domain envelope. The receiver recomputes those 16 cells from the actual ZIP's domain-summary.json and compares every coordinate. A completed scope covers a whole cell only when its original unrestricted where=1=1 query has exactly that cell's envelope. Retained smaller scopes remain original query companions and contribute their IDs; they never stand in for a missing whole cell.

The retained first cell used exact Intersects; the next whole cell used the supported conservative IndexIntersects relation. Both are valid candidate sources for subsequent exact polygon selection. Each missing cell uses the maintained collector's adaptive IndexIntersects inventory path in its own directory. Every native count/ID response is preserved. Shared boundaries can repeat IDs; the final candidate set is their union.

received-geometry.json checkpoints validated original pages after every successful batch. On restart those bytes, hashes, requested native IDs and geometry are checked again. Remaining IDs are computed by set difference. Actual geometry timeouts divide a batch; quota handling remains in the maintained OriginalSource HTTP helper. Successful pieces are checkpointed immediately and reused.

All geometry retains original native attributes and coordinates. Stream order comes from the publisher's streamorde field. Exact-domain selection identifies original feature IDs using the retained polygon union and preserves the original whole flowlines. Each source edition includes its native metadata, original responses, requests, selection geometry and transfer inventory.

The capture descriptor is marked complete only after the entire grid's native inventory and every requested geometry ID are present. The normal intake then enforces its existing source contract. An interruption retains completed response caches and received pages for the next invocation.

## Implementation review

The implementation was manually reviewed against the merged adaptive capture, the existing exact-domain helper, Workspace.import_sources, water_context_intake.bind_workspace and model.water_context.build contracts. The authoring container currently returns environment_offline for Python execution. The native receiving process is the execution point for syntax, source-page validation and the actual model run.
