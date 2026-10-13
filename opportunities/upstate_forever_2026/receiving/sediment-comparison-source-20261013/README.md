# Complete sediment comparison source-execution results

This directory retains two whole original comparison documents from actual connected V8 source execution. They are source-exercise results using openly authored review contexts, not native SQLite save or browser receipts. The original public USGS07144100 table and all source/parser/mapping/model inputs are inside each complete document. All three candidates and every held-out target are retained.

Read all.manifest.json or in-range.manifest.json. In ascending index, concatenate the exact raw bytes at every parts[].path with no separators, then verify the declared complete bytes and SHA-256 before parsing the JSON. The files are UTF-8 text segments, not individually valid JSON. Shared segments are intentionally stored once and referenced by both manifests. Every segment and manifest was independently read back exactly.

The all document has52 common observations. The in-range document retains all52 but scores the37 within every candidate's original training ranges. Complete original studies occur once per document at input.studies. summary.json records the actual per-candidate scores and explicit source/receiving scope. Root module reopening reconstructs original studies and the complete comparison, not merely its summary.

These supporting results sit outside measurement_workspace and its application/source selection. They are not imported by the engine. The maintained reproducer is measurement_workspace/reference/run-sediment-comparison.mjs; the original native6ACE owner uses reference/receive-sediment-comparison.mjs and its existing workspace handles for actual saves and onward receiving.
