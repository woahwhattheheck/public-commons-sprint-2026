# Receive Georgia's original approved-2024 assessment geography

This operation extends the existing regional scientific project with Georgia's complete publisher reach assessment, actual reach-to-watershed relationships, map layer and Scientific Reports recipe. It consumes the eleven already retained original response pages; it does not acquire another publisher edition.

## Existing application and original inputs

Use the current application containing:

- `source_tools/georgia_assessment.mjs` and `source_tools/assessment_reach_geography.py` from PR3818.
- The complete14-file Georgia source family from PR3873 under `source/georgia-assessment-2024/publisher-savannah-20261013/`.
- `source_tools/receive_north_carolina_assessment.py`, whose shared native-edition composer supports both text and list source notes and preserves all existing typed entries.
- This `source_tools/receive_georgia_assessment.py`.

The retained geometry manifest is the eighteen-kilobyte successor delivered by the original source worker. It lists six stream pages and five lake pages, their exact requested FIDs, original query URLs, byte lengths, capture times and stable source attachment references. Resolve those existing attachments in the admitted receiving session and retain the bytes unchanged under their declared filenames. This operation receives local originals; signed download URLs are transport inputs and are not written into the scientific source manifest.

The complete geometry manifest identity is **d52ea020236b6577947698537e07332d99810d99b8d000c69334360cca781c1f**, **18874 bytes**. The original responses total **9,594,093 bytes**. Retain all281 stream features and14 lake features, including downstream features outside the Upper Savannah project. Their original EPSG:3857 coordinates, Z/M metadata and native FIDs survive in the completed edition.

## One existing project operation

The accepting operator supplies the actual application, Workspace and already imported original217-watershed source pair. Obtain the source body SHA and original HUC field from that Workspace; preserve its current source ID and collection ID.

```sh
python source_tools/receive_georgia_assessment.py \
  --application ACTUAL_APPLICATION \
  --workspace ACTUAL_EXISTING_WORKSPACE \
  --sources ACTUAL_APPLICATION/source/georgia-assessment-2024/publisher-savannah-20261013/sources.json \
  --geometry-manifest RETAINED_CAPTURE_MANIFEST.json \
  --geometry-manifest-sha256 d52ea020236b6577947698537e07332d99810d99b8d000c69334360cca781c1f \
  --geometry-root RETAINED_ORIGINAL_PAGE_DIRECTORY \
  --domain-collection ACTUAL_ORIGINAL_DOMAIN_COLLECTION \
  --domain-source ACTUAL_ORIGINAL_DOMAIN_SOURCE_ID \
  --domain-sha256 ACTUAL_RETAINED_DOMAIN_BODY_SHA256 \
  --huc-field ACTUAL_RAW_HUC12_FIELD \
  --output ACTUAL_OPERATION_OUTPUT
```

Supply `--domain-layer` only when the actual retained native source requires a named layer. Supply `--node` with the receiving environment's existing Node executable when it is not on PATH. Use the GIS Python already serving the same project.

The operation resolves the original domain through `Workspace.source_file`, including its original sidecars. Its output directory is bound to the project ID, exact assessment and geometry source identities, original source pair, body SHA and HUC field. An existing directory belonging to a different selection is rejected before the geographic join.

Completed geographic and normalized outputs are reused only when their saved descriptors and implementation identities still match. Source imports are content addressed. Restart the same command with the same arguments after an interrupted native session.

## What the operation actually computes

First, every original geometry page is checked against its retained byte length and any declared SHA, then hashed. Provider errors and truncated responses are rejected. Native FID inventory, declared OID type, text ReachID, EPSG:3857 and Z/M metadata must match the original source selection.

Each geometry feature is joined by **publisher layer plus FID** to the already retained295-row assessment edition. Its complete raw attribute dictionary must agree. A changed assessment capture is reported by feature ID and field; the operation cannot silently substitute a different source edition.

The shared geography implementation then intersects the original lines and polygons with all217 retained watershed polygons in EPSG:26917. A positive line length or polygon area establishes study membership. Boundary-only touches remain separate. The same assessed reach may cross several watersheds. Whole publisher basin counts, distinct study reaches, individual geometric representations and feature-HUC relations remain separate quantities.

The Georgia producer applies those relations to the original295-row table and regenerates the existing scientific recipe. The shared native-edition composer carries every original response, full domain sidecars, validated capture inventory, normalized assessment and geographic output into one portable source collection.

The original six small lake-page features already examined match all retained attributes exactly. Page004 has SHA `018f6493d0756bb0da803a32e3f3e805317f115d31244b197951b7171b624689` and43,427 bytes; page005 has SHA `4577a3582334bbf8613bf82ebb6d4d2a2c7ebafa8097c37ea293d1e3c23625cb` and131,149 bytes. The admitted receiver computes and records the remaining original hashes while validating all eleven pages.

## Open the resulting product

The final `ga-assessment-operation.json` records the actual imported collection ID, source IDs, complete source inventory, geography counts and scientific report source ID. The operation reopens the Workspace and materializes every imported entry using the original hash-verifying source reader.

The collection has four existing source roles:

| Source ID | Existing application use |
| --- | --- |
| `ga2024-gis-assessments-json` | All295 original reach assessments with actual study-domain relations |
| `ga-approved2024-savannah-assessed-reach-geography` | Spatial Review layer with original FIDs, ReachIDs, classes, causes and HUC relations |
| `ga2024-gis-report-section-json` | Existing jurisdiction report section |
| `ga2024-gis-observed-report` | Scientific Reports recipe with original source and geography companion closure |

Open the actual imported geographic entry in Spatial Review. Use the scalar boolean `intersects_selected_domain = true` for positive-dimensional project membership; boundary-only contacts remain available separately. The map retains full original reach shapes so crossing a watershed boundary remains visible. Save the review in this existing project.

Open **Georgia approved 2024 assessment context** in Scientific Reports. Review the project-specific reach and watershed table, retained original notes and full document context, then export the ordinary completed report. Open the rendered map, report and original attachments at desktop and narrow layouts as applicable, and correct any actual presentation failure in the maintained producer.

Preserve the source import, saved view and completed report with the existing whole-project snapshot/receiving course. Reuse that course's selected history and export rather than creating a second regional model project.

## Interpretation in the regional study

The source's full publisher Savannah Basin has124 Supporting,143 Not Supporting and28 Assessment Pending reaches, with50 distinct Category5/5R listings. Those whole-basin counts include lower and coastal waters. The completed geographic output supplies the actual project subset.

Overall assessment is a reach-level summary across potentially different designated uses and pollutants. Hartwell's Fishing/PCB impairment coexists with Drinking Water and Recreation uses meeting their criteria. All category, cause, use and source notes remain associated with their original row. These listing records provide assessment context; nutrient and sediment model comparisons use the separate original measured targets and actual model outputs.


## Save and independently reopen the scientific report

Continue this same command with `--report` to publish the source through the maintained saved scientific-report edition, report-file ZIP, selected Study archive and independent archived-application reopening. Add `--report-with-operation` for the other completed jurisdiction's original operation JSON; `--report-selection` preserves an existing ordered source list.

For already completed source operations, run `python -B -m source_tools.assessment_report_receiving` with their exact original operation files. The complete command, resumption behavior, scientific interpretation and actual rendered-product course are in [ASSESSMENT_REPORT_RECEIVING.md](ASSESSMENT_REPORT_RECEIVING.md). Both entry points use the same original report publisher and Study transfer implementation.
