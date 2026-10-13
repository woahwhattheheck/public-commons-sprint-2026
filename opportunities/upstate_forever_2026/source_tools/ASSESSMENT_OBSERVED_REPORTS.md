# Published assessment context in the scientific delivery

The original assessment reports can now be included in the existing scientific client delivery. Each new source edition contains two document entries: the unchanged interactive original report and a source-bound assessment interpretation recipe. The ordered scientific-report picker selects the recipe; Original sources opens the original report.

## Two complementary source editions

| Report | Retained scope | Scientific interpretation |
| --- | --- | --- |
| Published assessment and station watershed associations | 192 published assessment records at 159 sites in the assessment-publisher-selected 217-HUC domain | Publisher watershed differences, reported HUC8 support, original NRCS state-HUC associations and focal-watershed counts |
| Coverage of original station and statewide assessment sources | All 705 native Savannah stations and 2,329 records in two statewide published assessment editions | Exact station identifier coverage, source-domain selection, eight publisher-HUC differences and original eleven-digit HUC attributes |

The complete native 164-station / 293-record workflow uses its existing three-inventory producer. These two interpretation recipes preserve the two published source cohorts above.

## Open and import the installed editions

Restart the maintained operator after installing the producer and bundled-source discovery update. Keep its existing Workspace, operator state and source options.

1. Open **Original sources → Review retained reports → Available source editions**.
2. Preview and import **Published assessment and station watershed associations — original report and scientific delivery**.
3. Preview and import **Coverage of original station and statewide assessment sources — original report and scientific delivery**.
4. Open either original report from the retained-report list. Its original HTML, filters, full record detail, selection exports and saved-review behavior remain available.
5. In the report detail, read **Include this interpretation in the client report** and choose **Open Maps and delivery**. Continue to the existing delivery form, retain the actual baseline/scenario and other required source choices, and select the new assessment interpretation sources in the existing ordered report picker. Place them in the intended report order alongside the other selected original studies.
6. Build the delivery through the normal task queue. The maintained observed-context consumer binds each selected recipe and every original companion before its report identity is created. It writes the concise interpretation sections and retains the complete original reports and sources in the delivery archive.

The installed manifests are:

- `results/assessment-association-review-20261013/observed-sources.json`
- `results/assessment-source-scope-review-20261013/observed-sources.json`

Each recipe has role `OBSERVED_CONTEXT` and schema `upstate.observed-report/v1`. Both original document entries preserve their original IDs, roles, vintages and body bytes. The Sources catalogue shows an original HTML preview once per collection when the recipe retains the same document. All typed entries remain available to their existing consumers.

For command-line import, run from the application directory:

`python -B -m model.cli --workspace /absolute/workspace source-import results/assessment-association-review-20261013/observed-sources.json`

Repeat with the source-scope manifest. Use the existing delivery CLI or operator form to select the resulting real collection and source IDs; the generated artifact inventory reports the two recipe IDs.

## Portable import

`results/assessment-observed-delivery-20261013/assessment-observed-reports.zip` is the complete ready-import collection. Import it through the existing source archive preview, selecting the root `sources.json` manifest. It carries four typed entries: two original interactive documents and two interpretation recipes.

The archive preserves both report directories, all original declared body and companion files, the original report ZIPs, the original source manifests, and the two new recipes/manifests. Each recipe's input paths stay relative to its original report source view. Original nested source manifests continue to resolve at their original relative paths.

**Download report and source edition** in Original sources exports the complete selected collection. Reimporting that export preserves both source types and their source identifiers. The selected original report's controls remain ordinary retained HTML; the delivery recipe is structured JSON consumed by the existing scientific renderer.

## Read the counts together

The 192-record report and the 246 native-source associations describe different selections.

- The fixed programme report selects 192 original assessment records by their published HUC12, across 159 sites resolved by the retained native Atlas and WQP sources.
- The whole-source review selects all 705 native stations from the original Savannah publisher query and compares them with all 2,329 statewide records.
- Of those statewide records, 246 at 209 sites match this native station source. This comprises 182 assessment-publisher-domain records and 64 records outside that domain.
- The remaining 10 records in the fixed 192-record programme report have sites outside this 705-station source selection. Their original source-bound identities remain in the fixed programme report.
- The 496 native stations without records in the two selected assessment editions describe source coverage. They do not establish water-quality condition or an absence of monitoring activity.

The report tables distinguish assessment records, distinct sites, publisher HUC12 and state-HUC programme rows. Edition site counts can overlap. Ten fixed-cohort records have only a station-publisher HUC8; their exact station-HUC12 programme association is unavailable.

Six fixed-cohort publisher-HUC differences are retained. Only SV-809 changes the retained NRCS priority-state association: the assessment publisher labels Cane Creek, while the native station publisher labels Lower Tugaloo River. This is an original-source association requiring review alongside the actual mapped native point. It does not reassign the assessment or predict a pollutant reduction.

The full statewide source review adds the source-domain boundary at SV-192 and the 2024 SV-686 label difference, both retained with original record/page/source identities. The two eleven-digit native HUC attributes remain verbatim.

## Reproduce the complete output

Run from the complete application source using the existing Node runtime:

`node source_tools/assessment_observed_reports_cli.mjs --application /absolute/current/application --output /absolute/new/assessment-observed-delivery`

The output directory must be new. The CLI reads the two existing source manifests, verifies every original member's size and SHA256, and checks the exact completed report identities before writing output. It emits the four small recipe/manifest postimages at their application-relative paths plus the complete import ZIP and artifact inventory.

To install the small postimages, compose those four files into the corresponding existing report directories in a complete source staging copy. Their declared original companions must remain present. The ready-import ZIP is independently complete and can be imported directly.

The producer uses the maintained `archive_codec.mjs` and `assessment_association_package.mjs`. Existing `model/observed_context.py`, the ordered source selector, native Station geography and native assessment-context producers retain their original responsibilities.

## Source binding

Every recipe lists the complete original source member identities in `inputs`. Its tables and narrative derive from the retained completed JSON results, and its report links name retained files. The original report manifests are companions too. A changed member or a different completed result edition causes the producer to reject the input before output publication.

The source-bound interpretation distinguishes published regulatory assessment status, publisher watershed labels, original station coordinates, native point/polygon membership, NRCS programme context and modelled export. It introduces no new geometry membership, concentration measurement, regulatory determination or modelled load.
