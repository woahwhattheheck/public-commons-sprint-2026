# Receive the complete North Carolina and Georgia assessment source families

This selected source extension adds both retained state assessment products to the existing `nc-ga-original-assessment-source` component. Use the current complete regional application. Keep the original source families together with their manifests, normalized tables, scientific recipes and original response bodies.

## Retained source editions

| Source | Native manifest | Retained source |
| --- | --- | --- |
| North Carolina final 2022 | `source/north-carolina-assessment-2022/sources.json` | Original 64-file source adapter, including all 56 original capture members, current maintained normalizer and declared input configuration |
| Georgia approved 2024 | `source/georgia-assessment-2024/publisher-savannah-20261013/sources.json` | Original 14-file publisher edition, complete normalized rows, scientific recipe and original attribute responses |

The North Carolina publisher cohort contains 110 original assessment units with 144 distinct geometry representations and 77 original parameter rows. Its parameter rows retain their own original cycle and approval values. The Georgia publisher selection contains 295 original reaches; the source manifest preserves the difference between that publisher basin selection and exact membership in the retained 217-HUC domain. The two jurisdictions keep their own source IDs, category labels, dates, methods and original geometries.

This source extension also selects the current `north_carolina_assessment.mjs`, `georgia_assessment.mjs`, shared `assessment_reach_geography.py`, complete North Carolina and Georgia native receivers and their operating guides. The earlier original ECHO captures remain selected under their original paths. The two new manifests cover 151 original member references and 72 distinct native source paths. The full selected source cohort contains 85 original or maintained implementation/data files before this guide and its component fragment.

Source lineage: North Carolina source PR 3860, Georgia source PR 3873, maintained North Carolina receiver and normalizer PR 3888, and Georgia receiver PR 3906. Native geographic execution continues in the existing ES-9960 operation 5584 on the original regional project. Gauge 9496 and annual 7303 retain their existing operations.

## Import the original retained context

Use the original Workspace source importer with these manifest files. It retains primary bodies and all declared companions, so the original table and report entries remain independently recoverable. The normalized manifests can be imported before a geographic join; the source's original spatial-support labels remain visible.

For an existing application and Workspace, the maintained API is:

~~~python
from pathlib import Path
from model.workspace import Workspace

workspace = Workspace("/ABSOLUTE/EXISTING_WORKSPACE")
source_root = Path("/ABSOLUTE/CURRENT_APPLICATION")
for name in (
    "source/north-carolina-assessment-2022/sources.json",
    "source/georgia-assessment-2024/publisher-savannah-20261013/sources.json",
):
    collection = workspace.import_sources(source_root / name)
    print(collection)
~~~

Run that code with the selected application's Python module search path and actual retained Workspace. Keep the returned collection IDs; source choices in the operator must use those real IDs.

Both manifests contain an `OBSERVED_CONTEXT` scientific recipe with the complete original input family. Georgia also retains its original `REPORT_SECTION` entry. Use the maintained Scientific Reports selection and existing source importer rather than changing the original report roles. Append the intended state source to the original ordered report selection.

## Continue the exact North Carolina geographic operation

The full command and source-field discovery are in `source_tools/RECEIVE_NORTH_CAROLINA_ASSESSMENT.md`. Resolve the actual retained domain collection, source ID, native HUC field, body SHA256 and optional layer from the existing project. From the current application:

~~~sh
"$PYTHON" -B source_tools/receive_north_carolina_assessment.py \
  --application "$APPLICATION" \
  --workspace "$WORKSPACE" \
  --sources "$APPLICATION/source/north-carolina-assessment-2022/sources.json" \
  --domain-collection "$DOMAIN_COLLECTION" \
  --domain-source "$DOMAIN_SOURCE" \
  --domain-sha256 "$DOMAIN_SHA256" \
  --huc-field "$HUC_FIELD" \
  --output "$OPERATION/nc-assessment"
~~~

Add the original `--domain-layer` or actual `--node` executable when the retained selection needs it. Reuse the same original selection and output directory after interruption. The receiver reads all 22 original stream and seven polygon response pages, calls the maintained shared geography implementation, regenerates the existing scientific recipe, imports the resulting table/vector/report edition and reopens its native source views.

## Continue the exact Georgia geographic operation

The maintained `source_tools/receive_georgia_assessment.py` and its full guide now provide the corresponding Georgia operation. Use the eleven original geometry responses from the same ES-9960 source intake: six stream pages and five lake pages, totaling 9,594,093 bytes. Their retained 18,874-byte capture manifest has SHA256 `d52ea020236b6577947698537e07332d99810d99b8d000c69334360cca781c1f`.

~~~sh
"$PYTHON" -B source_tools/receive_georgia_assessment.py \
  --application "$APPLICATION" \
  --workspace "$WORKSPACE" \
  --sources "$APPLICATION/source/georgia-assessment-2024/publisher-savannah-20261013/sources.json" \
  --geometry-manifest "$GA_GEOMETRY_MANIFEST" \
  --geometry-manifest-sha256 d52ea020236b6577947698537e07332d99810d99b8d000c69334360cca781c1f \
  --geometry-root "$GA_ORIGINAL_PAGE_DIRECTORY" \
  --domain-collection "$DOMAIN_COLLECTION" \
  --domain-source "$DOMAIN_SOURCE" \
  --domain-sha256 "$DOMAIN_SHA256" \
  --huc-field "$HUC_FIELD" \
  --output "$OPERATION/ga-assessment"
~~~

The command consumes the original retained files. Resolve the existing attachments from that capture manifest into the accepting operation's input directory. The receiver validates original FIDs, layer and ReachID identities, attributes and CRS; intersects all 295 publisher features with the original domain; and retains the complete original responses, domain sidecars and generated geographic source in the imported edition. Reuse the same selected Workspace and output directory.

The 14-file attribute/report source edition retains its original published spatial scope. Its source import is available independently; the geometry-aware continuation uses the original eleven geometry responses and adds the actual intersection result. See `source_tools/RECEIVE_GEORGIA_ASSESSMENT.md` for the complete current source identity, native restart and rendered operator instructions.

## Preserve current code and the complete source family

A complete original source bank is a recovery carrier. On an advancing application, retain the current installed implementation and use the carrier to recover missing original data and companions at their declared identities. Do not replace a newer shared provider, formatter or receiver with historical source from an older bank. The component fragment makes the complete source selection available to the maintained application composer and selected-family receiving.

The complete Workspace transfer remains the route for the project, its original domain, imported source editions, scientific report selections and other current records. Use the actual saved edition and archive IDs returned by that operation when reopening. Any selected report archive should carry the selected recipe's complete original companion family through the existing report/Study transfer mechanism.

## Owner-directed rendered-product inspection

Source: direct owner instruction of October 13, 2026. Repository copy version: `2026-10-13.1`.
Scope: owner-controlled work across providers, local and cloud runtimes, and current and future workers. Existing owner controls remain in force.

Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing worker must open/run/render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Code review, DOM counts, HTTP200, unit checks or another worker's approval do not replace seeing the actual product.

The Ecosystem product requires plain industrial design: readable tables, clear hierarchy, consistent typography/spacing, restrained controls, useful labels and responsive layouts. Keep the real workflows/data/computation. Reviews must lead directly to repairs and must not replace implementation/integration or become endless rechecking. The existing focused-validation policy remains; do not run broad suites or build a verification product.

Persist this instruction in the active owner-controlled instruction surfaces actually read by the relevant workers: global/project AGENTS/CLAUDE/GEMINI/rules, provider-specific boot instructions, source mirrors, cloud repository copies and current build/receiving guides. Include this instruction in every delegated child assignment, including assignments to another provider or runtime. Maintainers update their own consumed files and return exact paths, source/version and readback. A coordination acknowledgment alone is not propagation. Do not alter historical evidence or third-party/vendor policies. No forced restarts, new watchers or revival of owner-stopped work.

Inspect the actual completed scientific screens, reports, source pages and downloadable HTML in the real operator. Prior empty-Workspace screenshots are not completed-workspace acceptance. Preserve current engineering owners; other coordinators receive propagation rather than duplicate implementation. Continue native source/runtime/archive joins rather than diverting everyone to cosmetic review. This instruction does not extend or restart the Ecosystem sprint: the existing cutoff is October 13, 2026 at 10:00 a.m. America/Kentucky/Louisville, 14:00 UTC.

Source assembly and standalone application handoffs retain the application-level instruction copies with their current guides. This file records an owner-requested product delivery requirement; it does not change provider safeguards, repository access controls, or existing authorization boundaries.

