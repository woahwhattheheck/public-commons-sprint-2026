# Native eLTSS source-to-receiving operation

Run this complete operator journey against the unchanged published HL7 STU2 example.
It reuses the installed original source parser, graph, review and correction stores,
SF30 dataset/versioned seller, SF88 offer/preparation, and complete receiving import.
The final `OPERATED_ELTSS.json` is the input for the same-workspace browser and
Applications receiving commands.

## Command

Use Python 3.10 or later and the maintained Node runtime required by the original SF30
engine (Node 22 or later). Point `--source-root` at the complete original
`sf30-seller-sdk` directory with its normal sibling modules, not an isolated copy
of `fhir_eltss`.

```sh
python3 /ABS/SF30/fhir_eltss/operate_receiving.py \
  --source-root /ABS/SF30 \
  --workspace /ABS/eltss-operated/workspace \
  --output /ABS/eltss-operated/receiving \
  --original-bundle /ABS/SF30/fhir_eltss/examples/Bundle-2039212f3fa5406bb4ffd4a.json \
  --node /ABS/NODE
```

An optional `--definitions-zip /ABS/definitions.json.zip` retains the complete original
published computable archive alongside the operation. `SOURCE_NOTICE.md` identifies
the publisher, publication and exact original source bytes.

The output directory retains the original operation journal and one writer lease.
Resume with the identical command and paths; completed phases are reopened, and
interrupted content-addressed writes reconcile their original IDs. The command does
not create a background monitor. Preserve the complete output and workspace together.

## Complete operated flow

1. Verify the exact 128,055-byte published Bundle; create a source packet containing
   the unchanged original JSON, publication identity and exact file manifest.
2. Import all 39 resources and both CarePlans, preserve all original references, and
   derive the graph using original fullUrl, qualified-resource and canonical identities.
3. Adopt all 56 original field definitions and selector drafts. Save a successor
   review of the four original demographic paths, then extract all 112 original
   field cells. Other field-review/applicability states remain explicit.
4. Preview one authored CarePlan title correction, apply that exact preview, and
   repeat the original apply request. Retain the complete original predecessor.
   The source comparison reads all 39 resources and the exact changed JSON value.
5. Build the original and corrected two-row CarePlan datasets with one saved mapping.
   Resource content and original logical IDs drive comparison. Source-position
   provenance remains in lineage rather than changing every compared row.
6. Receive the original SF30 dataset packet into a fresh native workspace and query it.
   Prepare two source releases with the original public example payment terms,
   start the original seller, inspect its live offer, retain its real 402 response,
   prepare and reopen the original SF88 buyer draft, then publish the correction
   using the observed current snapshot and revision.
7. Freeze a complete care-plan handoff, including the original predecessor, selected
   Bundle, graph, all field definitions/cells and human-readable pages. Import/reopen
   it in the selected receiving workspace and save that actual receiving result,
   artifact, destination UUID and original request UUID.
8. Export the complete editable workspace, restore it into a fresh directory, reopen
   all original collection IDs, source bytes, field files and receiving artifacts,
   and save the receiving summary.

The operating example intentionally preserves the difference between a published
reference example, an authored correction, field presence, explicit review status,
and an actual native receiving result. The original reference graph is the source
for identities; names and narrative text do not merge resources.

## Receiving artifacts

`OPERATED_ELTSS.json` records the original source/workspace IDs, exact source files,
all operated editions, assessments, correction, comparison, dataset builds, handoffs,
receiving results and file identities. The complete data is in the retained files:

| Artifact | Contents |
|---|---|
| PUBLISHED_STU2_BUNDLE.json and PUBLISHED_SOURCE.zip | Exact original publisher bytes and source packet |
| ORIGINAL_GRAPH.json and ORIGINAL_REFERENCE_EDGES.json | Complete saved resource/reference selection |
| FIELD_REVIEW.json and both FIELD_CELLS.jsonl files | Full original definition/review and every extracted value |
| CORRECTION_PREVIEW.json, APPLIED_CORRECTION.json, EDITION_CHANGES.jsonl | Retained original apply and exact changed field |
| dataset-original/ and dataset-corrected/ | Native CSV, configuration and source lineage |
| NATIVE_DATASET_PACKET.zip | Original SF30 source/mapping/build receiving packet |
| OPERATED_MERCHANT.json and ORIGINAL_SELLER_CHALLENGE.json | Original seller, exact offers, version publication and buyer configuration |
| CAREPLAN_HANDOFF.zip | Complete human and editable selected handoff |
| ORIGINAL_HANDOFF_RECEIPT.json and SAVED_RECEIVING.json | Actual receiving destination and original saved result |
| COMPLETE_EDITABLE_WORKSPACE.zip | Whole source/domain/native operation restoration |
| WHOLE_WORKSPACE_RECEIVING.json | Actual restored IDs, sources and reopen result |

The sibling merchant and buyer state directories remain owned by their original
native tools. Preserve those directories with their original release files when
continuing their own version, accounting or delivery operations.

After the native command finishes, open the same original workspace through
`starforge eltss-careplans serve --workspace /ABS/eltss-operated/workspace`.
The browser and managed Applications use that exact UUID and original directory.
