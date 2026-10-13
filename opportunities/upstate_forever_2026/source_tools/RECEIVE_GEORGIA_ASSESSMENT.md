# Receive Georgia's original approved-2024 assessment geography

This operation extends the existing regional scientific project with Georgia's complete publisher reach assessment, actual reach-to-watershed relationships, map layer and Scientific Reports recipe. It consumes the eleven already retained original response pages; it does not acquire another publisher edition.

## Existing application and original inputs

Use the current application containing:

- `source_tools/georgia_assessment.mjs` and `source_tools/assessment_reach_geography.py` from PR3818.
- The complete 14-file Georgia source family from PR3873 under `source/georgia-assessment-2024/publisher-savannah-20261013/`.
- `source_tools/receive_north_carolina_assessment.py`, whose shared native-edition composer supports both text and list source notes and preserves all existing typed entries.
- This `source_tools/receive_georgia_assessment.py`.

The retained geometry manifest is the eighteen-kilobyte successor delivered by the original source worker. It lists six stream pages and five lake pages, their exact requested FIDs, original query URLs, byte lengths, capture times and stable source attachment references. Resolve those existing attachments in the admitted receiving session and retain the bytes unchanged under their declared filenames. Existing local originals remain directly usable. The optional `--geometry-links` input materializes missing retained attachments in this same operation; signed URLs remain temporary transport inputs.

The complete geometry manifest identity is **d52ea020236b6577947698537e07332d99810d99b8d000c69334360cca781c1f**, **18874 bytes**. The original responses total **9,594,093 bytes**. Retain all 281 stream features and 14 lake features, including downstream features outside the Upper Savannah project. Their original EPSG:3857 coordinates, Z/M metadata and native FIDs survive in the completed edition.

## One existing project operation

The accepting operator supplies the actual application, Workspace and already imported original 217-watershed source pair. Obtain the source body SHA and original HUC field from that Workspace; preserve its current source ID and collection ID.

```sh
python source_tools/receive_georgia_assessment.py \
  --application ACTUAL_APPLICATION \
  --workspace ACTUAL_EXISTING_WORKSPACE \
  --sources ACTUAL_APPLICATION/source/georgia-assessment-2024/publisher-savannah-20261013/sources.json \
  --geometry-manifest ACTUAL_APPLICATION/source/georgia-assessment-2024/publisher-savannah-20261013/geometry-capture-manifest.original.json \
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

## Materialize the retained attachments in the same operation

The original geometry capture manifest is a complete receiving plan, not a request for another publisher capture. Its exact identity is 18,874 bytes / SHA256 `d52ea020236b6577947698537e07332d99810d99b8d000c69334360cca781c1f`; the complete application retains its unchanged body at `source/georgia-assessment-2024/publisher-savannah-20261013/geometry-capture-manifest.original.json` (Git blob `1c4351f51e44808c7d6b01ba20fbc2966391ea78`). Use that installed file directly as `--geometry-manifest`; preserve it without reformatting.

At the existing native input phase, use the connected Notion `get_file_download_urls` operation on the manifest's `files[].stable_reference` values. The actual decoded response has this shape:

~~~json
{"files": [{"reference": "ORIGINAL_STABLE_REFERENCE", "url": "CURRENT_SIGNED_HTTPS_URL", "expiry_time": "ORIGINAL_PROVIDER_EXPIRY"}], "unresolved": []}
~~~

Pass that decoded JSON through the session's existing ordinary connector-to-native file or argument bridge. Keep its runtime file outside the published source package. Resolve immediately before the native transfer because the URLs expire. The stable references remain in the retained manifest; refreshing their URLs does not change the original scientific source.

Add this one option to the existing full receiver command:

~~~text
--geometry-links /ABSOLUTE/OPERATION/attachment-downloads.json
~~~

Use the same `--geometry-root`, geometry manifest, original Workspace/domain selectors and output directory on every continuation. The receiver will:

1. Check the pinned original manifest and its eleven plain filenames, unique attachment references, exact 281 stream / 14 lake ID selection, and original byte sizes.
2. Lock that geometry directory, retain an unchanged copy of the capture manifest, and reuse already present original pages after validation.
3. Stream each missing attachment to a temporary file in the destination directory. Bound the response by its declared size, then validate the exact page length, original FIDs, full raw assessment attributes, native geometry type, EPSG:3857 and Z/M declarations using the same reader as the geographic receiver.
4. Atomically publish each complete valid original filename and checkpoint its SHA256, original capture timestamp, stable reference and FIDs in `geometry-transfer.json`. Signed URLs are excluded from this record and scientific source companions.
5. Continue through the existing geographic intersection, complete source import and optional `--report` saved-report / selected-Study course.

An interrupted page is discarded; completed original files remain. If a URL expires or a transfer fails, the error identifies the original filename and provider status without printing the signed URL. Resolve the same remaining stable references again, replace only the temporary link-response file, and repeat the same command. A response containing only remaining file references is sufficient. A valid previously published file is never downloaded again. If a previously received body is missing, its replacement must also match the retained SHA256 before publication. A changed original body is rejected rather than overwritten.

The final imported source retains the unchanged geometry capture manifest as a companion alongside the computed original-page inventory and all eleven full responses. The original manifest is not regenerated from downloaded geometry. The transfer checkpoint supports continuation; the original publisher request, capture time and raw bytes retain their original source meaning.

After all eleven files are received, the owned `geometry-root` has the exact 9,594,093 original response bytes plus the unchanged capture manifest and transfer record. Return this complete directory or an ordinary archive through the same receiving operation so the source-family maintainer can publish the original geometry closure. Temporary download URLs and their runtime JSON file do not belong in that archive.

## What the operation actually computes

First, every original geometry page is checked against its retained byte length and any declared SHA, then hashed. Provider errors and truncated responses are rejected. Native FID inventory, declared OID type, text ReachID, EPSG:3857 and Z/M metadata must match the original source selection.

Each geometry feature is joined by **publisher layer plus FID** to the already retained 295-row assessment edition. Its complete raw attribute dictionary must agree. A changed assessment capture is reported by feature ID and field; the operation cannot silently substitute a different source edition.

The shared geography implementation then intersects the original lines and polygons with all 217 retained watershed polygons in EPSG:26917. A positive line length or polygon area establishes study membership. Boundary-only touches remain separate. The same assessed reach may cross several watersheds. Whole publisher basin counts, distinct study reaches, individual geometric representations and feature-HUC relations remain separate quantities.

The Georgia producer applies those relations to the original295-row table and regenerates the existing scientific recipe. The shared native-edition composer carries every original response, full domain sidecars, validated capture inventory, normalized assessment and geographic output into one portable source collection.

The original six small lake-page features already examined match all retained attributes exactly. Page004 has SHA `018f6493d0756bb0da803a32e3f3e805317f115d31244b197951b7171b624689` and 43,427 bytes; page005 has SHA `4577a3582334bbf8613bf82ebb6d4d2a2c7ebafa8097c37ea293d1e3c23625cb` and 131,149 bytes. The admitted receiver computes and records the remaining original hashes while validating all eleven pages.

## Open the resulting product

The final `ga-assessment-operation.json` records the actual imported collection ID, source IDs, complete source inventory, geography counts and scientific report source ID. The operation reopens the Workspace and materializes every imported entry using the original hash-verifying source reader.

The collection has four existing source roles:

| Source ID | Existing application use |
| --- | --- |
| `ga2024-gis-assessments-json` | All 295 original reach assessments with actual study-domain relations |
| `ga-approved2024-savannah-assessed-reach-geography` | Spatial Review layer with original FIDs, ReachIDs, classes, causes and HUC relations |
| `ga2024-gis-report-section-json` | Existing jurisdiction report section |
| `ga2024-gis-observed-report` | Scientific Reports recipe with original source and geography companion closure |

Open the actual imported geographic entry in Spatial Review. Use the scalar boolean `intersects_selected_domain = true` for positive-dimensional project membership; boundary-only contacts remain available separately. The map retains full original reach shapes so crossing a watershed boundary remains visible. Save the review in this existing project.

Open **Georgia approved 2024 assessment context** in Scientific Reports. Review the project-specific reach and watershed table, retained original notes and full document context, then export the ordinary completed report. Open the rendered map, report and original attachments at desktop and narrow layouts as applicable, and correct any actual presentation failure in the maintained producer.

Preserve the source import, saved view and completed report with the existing whole-project snapshot/receiving course. Reuse that course's selected history and export rather than creating a second regional model project.

## Interpretation in the regional study

The source's full publisher Savannah Basin has 124 Supporting, 143 Not Supporting and 28 Assessment Pending reaches, with 50 distinct Category 5/5R listings. Those whole-basin counts include lower and coastal waters. The completed geographic output supplies the actual project subset.

Overall assessment is a reach-level summary across potentially different designated uses and pollutants. Hartwell's Fishing/PCB impairment coexists with Drinking Water and Recreation uses meeting their criteria. All category, cause, use and source notes remain associated with their original row. These listing records provide assessment context; nutrient and sediment model comparisons use the separate original measured targets and actual model outputs.


## Save and independently reopen the scientific report

Continue this same command with `--report` to publish the source through the maintained saved scientific-report edition, report-file ZIP, selected Study archive and independent archived-application reopening. Add `--report-with-operation` for the other completed jurisdiction's original operation JSON; `--report-selection` preserves an existing ordered source list.

For already completed source operations, run `python -B -m source_tools.assessment_report_receiving` with their exact original operation files. The complete command, resumption behavior, scientific interpretation and actual rendered-product course are in [ASSESSMENT_REPORT_RECEIVING.md](ASSESSMENT_REPORT_RECEIVING.md). Both entry points use the same original report publisher and Study transfer implementation.

## Current Upper Savannah workshare direction

Carry `opportunities/upstate_forever_2026/CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.3`, and the current repository `AGENTS.md` with this existing receiving course. Ecosystem Sciences already practices GIS, modeling and watershed analysis. This source intake supplies inspectable production work for the actual RFP: original Upper Savannah shapes, a 30 m selection, the upstream model domain distinct from the South Carolina reporting mask and four utility focus anchors, and a complete editable handover. The separate native regional case keeps explicit simulated assumptions, baseline/restoration/matched-control identity and N/P kg/year plus sediment tonnes/year delivered to streams.

The producing native peer must open and look at the exact outgoing map, report pages and every attachment; operate relevant selection, download, export and reopen controls at presentation and narrow widths; repair the actual visible faults; and cold-reopen the delivered application/project. Preserve the original source assessment meaning and the separate actual model-run identities throughout that presentation.
