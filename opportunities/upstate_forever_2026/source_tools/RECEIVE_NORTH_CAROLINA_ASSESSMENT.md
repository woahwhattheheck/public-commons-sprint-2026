# Receive North Carolina assessment geography into the regional project

This command completes the retained North Carolina final-2022 source through the existing Upper Savannah application. It selects the original 217-watershed domain from the existing Workspace, joins all 22 stream pages and seven polygon pages with the shared assessment geography implementation, regenerates the maintained scientific recipe with those relations, and imports one complete source edition.

## Required application and source

Use the current regional application with:

- `source_tools/north_carolina_assessment.mjs` and the full `source/north-carolina-assessment-2022/` family (PR3860).
- `source_tools/assessment_reach_geography.py`, including the original numeric-ID correction from PR3763.
- This `source_tools/receive_north_carolina_assessment.py` command.
- The existing project containing the original 217-HUC domain source.

The command uses the application's Python environment with Fiona, pyproj and Shapely, and the installed Node executable. The normalized source manifest and every original companion must be present together. The shared geographic source and the Node producer retain their existing implementations.

Full original normalized source: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8V088BFB

Shared geographic source: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8R23A5UN

## Select the actual project domain

Use the source edition already registered in the receiving project. Its collection ID, source ID, body SHA256, HUC field and optional native layer identify the exact source. Open its entry in Sources or inspect the existing Workspace source records; retain the IDs shown there. The command resolves its path and sidecars through `Workspace.source_file`.

For a direct read in the receiving application's Python environment:

~~~python
import json, sys
sys.path.insert(0, "/ABSOLUTE/APPLICATION")
from model.workspace import Workspace
workspace = Workspace("/ABSOLUTE/EXISTING_WORKSPACE")
for collection in workspace._list("sources"):
    for entry in collection["entries"]:
        if entry.get("kind") == "vector":
            print(json.dumps({
                "collection_id": collection["id"],
                "source_id": entry["id"],
                "title": entry["title"],
                "role": entry.get("role"),
                "sha256": entry["body"]["sha256"],
                "layer": entry.get("layer"),
                "huc_field": entry.get("huc_field"),
            }))
~~~

Use the original domain's declared native HUC field and layer. The geography operation requires 217 distinct, original twelve-character HUC identifiers. It does not derive them from an assessment-unit number.

## Run the same receiving operation

From the selected application, substitute the measured paths and source identities:

~~~sh
python -B source_tools/receive_north_carolina_assessment.py \
  --application /ABSOLUTE/APPLICATION \
  --workspace /ABSOLUTE/EXISTING_WORKSPACE \
  --sources /ABSOLUTE/NC_SOURCE/source/north-carolina-assessment-2022/sources.json \
  --domain-collection EXACT_RETAINED_COLLECTION_ID \
  --domain-source EXACT_RETAINED_SOURCE_ID \
  --domain-sha256 EXACT_RETAINED_BODY_SHA256 \
  --huc-field EXACT_ORIGINAL_HUC_FIELD \
  --output /ABSOLUTE/EXISTING_OPERATION/nc-assessment
~~~

Add `--domain-layer NAME` for a selected layer in a multi-layer native source. Use `--node /ABSOLUTE/NODE` when Node is not on the receiving environment's PATH.

The output directory belongs to this project and original source selection. Reuse the same command and directory after interruption. The command checks its saved binding, verifies previously completed stage files, and reuses identical original Workspace imports. A changed implementation produces a new derived stage inside the same operation. Original sources and the receiving project's other records remain intact.

The command writes its complete original configuration, geography, normalized assessment, source edition, subprocess log and final `nc-assessment-operation.json` under that directory. A native reader failure includes the original source or missing IDs so the same maintained helper can be corrected at the actual failing field.

## Available result in the application

The final state records one source collection with three typed entries:

| Entry | Existing application use |
| --- | --- |
| `ncdeq-final-2022-savannah-assessment-context` | Assessment table with all 110 native units, 77 original parameter records and geographic membership |
| `nc-final2022-savannah-assessed-reach-geography` | Spatial Review vector with original feature IDs, jurisdiction, source identity, parameter counts and original HUC relationships |
| `ncdeq-final-2022-savannah-scientific-report` | Scientific Reports recipe with original assessment tables, row cycles/statuses, exact domain totals and geographic sources |

The receiver reopens the project with a new Workspace instance and resolves all three original source entries through the maintained source-view reader. The final state's collection and source IDs are the values to select in the existing desks.

In Spatial Review, select the geographic entry from this recorded collection. Preserve both positive-dimensional HUC membership and the separate boundary-touch attributes when discussing the map. The geographic layer retains the original full stream or polygon geometry; it is a source context layer, not a clipped model-output grid.

In Scientific Reports, select the North Carolina final-2022 recipe from the same collection. This is an `OBSERVED_CONTEXT` JSON recipe consumed by the existing scientific composer. Its source inputs contain the original domain, all original NC response files, the normalized assessment and every completed geographic output. The report's provenance therefore survives source-view materialization, project export and independent receiving.

Use the same existing project transfer workflow for the completed project. This operation adds the three source entries to that project; its existing tasks, scenarios, model runs and review history remain available to the maintained continuity export.

## Meaning of the geographic counts

There are 110 assessment units represented by 110 stream features and 34 polygon features. The polygons share their unit identities with the stream layer. The 144 geometry representations remain distinct, while assessment-unit totals count each native unit once.

The native reader returns the domain in EPSG:26917 when requested. Original NC feature pages are read in EPSG:3857 and transformed once into EPSG:26917. Positive line length and polygon area establish membership; boundary-only contacts remain explicit relations. The delivered map uses EPSG:4326.

The source's 77 parameter rows retain their original cycles and approval fields: 75 have cycle 2022 and two have cycle 2020. Native geometry joins add spatial relationships without changing those original determinations. The source family README gives the original publisher interpretation and links.

## Use the rendered result before delivery

The repository's owner-directed rendered-product inspection applies to this receiving course. Open the populated geographic layer in the actual operator, view the exact generated report and downloaded attachments, operate the relevant controls, and reopen the delivered project. Inspect the presentation width and a narrow layout where applicable; fix clipping, unreadable tables, broken source links or exports in the maintained application. Source review and source counts support this work, while the actual rendered map and report remain the human-facing delivery. Preserve the current application AGENTS.md with the source handoff.


## Save and independently reopen the scientific report

Continue this same command with `--report` to publish the source through the maintained saved scientific-report edition, report-file ZIP, selected Study archive and independent archived-application reopening. Add `--report-with-operation` for the other completed jurisdiction's original operation JSON; `--report-selection` preserves an existing ordered source list.

For already completed source operations, run `python -B -m source_tools.assessment_report_receiving` with their exact original operation files. The complete command, resumption behavior, scientific interpretation and actual rendered-product course are in [ASSESSMENT_REPORT_RECEIVING.md](ASSESSMENT_REPORT_RECEIVING.md). Both entry points use the same original report publisher and Study transfer implementation.
