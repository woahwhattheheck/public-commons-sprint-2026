# Twenty source and destination comparison

This additive Migration Acceptance adapter captures independently selected Twenty records, reviews composite fields and relationships, and carries an attributed mapping into the existing local dlt/DuckDB comparison and acceptance engine.

## Use the complete product

Open [dist/twenty-review.html](dist/twenty-review.html) for the self-contained review. The page contains the complete editable adapter source and an authored reference project. Saved working files preserve unfinished controls and raw mapping text; saved projects preserve the capture and complete attributed mapping history.

Use [CAPTURE_OPERATING.md](CAPTURE_OPERATING.md) to collect complete selected API pages and [OPERATING.md](OPERATING.md) to map, compare and receive the full workspace. Native execution requires the complete parent Migration Acceptance product, Node 24 and its selected original Python/dlt runtime.

The source supports an actual Twenty capture or a retained legacy JSON export. Destination expectations always come from a separately captured Twenty destination. All service calls are reads. The example deliberately includes an amount difference so the review can demonstrate findings rather than copying source values into the destination.

## Build and continue

From the Migration Acceptance product root:

~~~sh
node adaptations/twenty/build-review.mjs /absolute/new-output/twenty-review.html
node adaptations/twenty/receive.mjs --project /absolute/project.json --directory /absolute/original-workspace --receiving-directory /absolute/receiving-workspace --runtime-ready /absolute/runtime-ready.json --operation ORIGINAL_OPERATION --actor REVIEWER
~~~

Keep the original operation and saved request history when continuing an interrupted native attempt. The source manifest covers the complete adapter; SOURCE_REUSE.json records the inherited generic project and native modules. Credentials belong in the approved runtime environment and are excluded from portable capture and project files.

Prepared by TokenJunkieLabs. See the operator guides for full source, capture, mapping, output and receiving instructions.
