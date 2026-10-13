# Continue the original Georgia geography into reviewed legal source relationships

This operation consumes the completed Georgia approved-2024 assessment geography and the retained thirty-reach legal source review. It preserves all 295 original assessment rows and the original eleven geographic response bodies, then follows the 37 explicitly reviewed service/FID/ReachID selections through the existing 217-catchment intersection.

It produces a usable native source collection: the original assessed-feature map, feature/HUC relationship CSV, complete source context, printable briefing, and a Scientific Reports source. The original assessment producer remains responsible for the geographic calculation. This consumer retains its complete outputs, originals and sidecars.

## Use the completed original operation

Use the actual `geography-sources.json` emitted by the existing `source_tools.receive_georgia_assessment` operation. Its retained `ga-assessment-operation.json` names `geography.directory`; the original manifest is in that directory. Keep that operation’s completed output and its existing Workspace.

Run from the application root with a current Node interpreter:

```sh
node source/ga_designation_assessment_relationships/20261013/open-native-geography.mjs \
  --geography-sources /actual/original-geography/geography-sources.json \
  --output /actual/retained-output/georgia-legal-native-review \
  --workspace /actual/existing-workspace \
  --python /actual/gis-environment/bin/python
```

Replace those paths with the accepting owner’s actual existing paths. The output must be separate from the application tree, original geography tree and Workspace. The command checks this before writing.

Omit both `--workspace` and `--python` to produce the same complete portable source edition without importing it immediately. The existing application can import it later:

```sh
python -m model.cli --workspace /actual/existing-workspace \
  source-import /actual/retained-output/georgia-legal-native-review/sources.json
```

The consumer calls this maintained native source import itself when both import options are supplied. It prints the actual returned source collection ID and all five source IDs. It does not start an Operator, a model run, another geographic intersection, or another archive acquisition.

## What the output means

The original geographic engine intersects whole original assessment features with the retained 217 HUC polygons in EPSG:26917.

- **Positive dimensional intersection:** a stream or beach line has positive intersected length, or a lake/sound polygon has positive intersected area.
- **Boundary contacts only:** the original feature meets one or more HUC boundaries but contributes zero measure in its original dimension.
- **Outside the selected domain:** the complete original capture contains the reviewed feature, and the completed geographic operation reports no intersection with the selected domain.

Every one of the 37 reviewed original features receives one of those states. Features outside the domain retain their original service, numeric FID, ReachID, capture query, source bytes and actual geographic-body SHA256. Their absent HUC relationship is preserved.

The downloadable map contains whole assessment features with a positive intersection or boundary contact, using the unchanged EPSG:4326 geometry produced by the maintained native engine. It is not clipped to the study boundary. Original EPSG:3857 bodies, including their declared Z/M fields, remain in the retained source companions.

A feature’s membership does not establish that the whole legal endpoint-defined reach has that membership. The legal review retains the distinct boundary descriptions, reservoir components, named aliases, use differences and partial-support qualifications. The output always preserves `legal_geometry_assignment: false`.

Lengths remain metres and areas remain square metres. The CSV retains each original feature/HUC relationship separately. Do not add line lengths to polygon areas or treat overlapping feature supports as independent land/water coverage.

## Complete deliverables

| File | Purpose |
|---|---|
| `sources.json` | Ordinary five-entry native source manifest, with byte/SHA256 descriptors for every retained companion |
| `native-context.json` | Full 37-feature source review with original domain memberships and exact native relation records |
| `reviewed-assessment-geography.geojson` | Whole native assessed features, with original properties and explicit reviewed legal references |
| `geometry-relations-review.csv` | Every reviewed feature/HUC relation; an explicit outside-domain row where the original operation has no relation |
| `observed-report.json` | Scientific Reports source with actual geographic counts and the complete thirty-reach legal review |
| `briefing.html` | Self-contained printable source review, all 37 geographic memberships, and complete original/source downloads |
| `request.json` | Immutable binding to both source manifests, original domain and executed implementation |
| `source-register/` | Complete original thirty-reach source family, builder, guide and exact original root manifest |
| `native-geography/` | Complete unchanged native geographic edition, originals, sidecars, context and manifest |
| `imports/` | Actual Workspace-specific import identity returned by the native application |

The five source IDs are:

- `ga-designation-assessment-native-context`
- `ga-designation-assessment-native-map`
- `ga-designation-assessment-native-relations`
- `ga-designation-assessment-native-report`
- `ga-designation-assessment-native-briefing`

The portable entry points are the generated top-level `sources.json` and `briefing.html`. The copied `source-register/root.sources.json` is an unchanged provenance record from its original application layout; the generated top-level manifest supplies the correct relocated companion paths.

## Open, inspect and print

Open `briefing.html` locally or through the native retained document download. Its first section shows every reviewed feature, original identity, positive HUC12s and boundary-only HUC12s. The original thirty-reach review follows, with original descriptions and full candidate evidence.

The geographic table always shows all 37 reviewed features. The legal-record search/filter applies only to the thirty legal records. Native CSV/JSON/GeoJSON buttons download the complete named geographic outputs independently of that filter. The existing legal-row CSV follows the visible legal rows; the complete original-pair and source JSON buttons retain their complete scope. Print preserves the complete geographic table plus visible legal records.

For the native application, select the returned source collection and `ga-designation-assessment-native-map` to use the original map layer. Select `ga-designation-assessment-native-report` in Scientific Reports to build the native report from the retained original source.

## Exact source and replay behavior

Before producing any output, the command snapshots and checks all source-family members, all original input descriptors, all native geographic members and all original/sidecar bodies against their declared byte counts and SHA256. All 295 native assessment rows must retain exactly the same original attribute objects as the three captured publisher attribute responses. Object-key serialization order may differ; original values and types must agree.

The pure binding module then checks the approved Georgia edition, EPSG:26917 comparison, complete 217 unique HUC inventory, all eleven native source bodies, every service-qualified FID/ReachID, original query/response identity, every native relation dimension/unit and every derived map membership. Missing assessment identities or unmatched original geometry are rejected.

Each reviewed source is located in the completed original capture even when it falls outside the domain. Matching the service URL and FID prevents a stream and lake with the same numeric FID from being confused.

Output members are immutable and use a temporary file, fsync and same-directory link. An identical rerun reuses exact members. Interrupted partial output can be resumed with the same command. A changed source manifest, domain, implementation or existing output member requires a different output directory; the command does not overwrite an earlier edition.

Workspace import uses the existing content-addressed native importer. An identical rerun returns its existing collection. Independent import receipts are keyed to the actual Workspace path, while the source edition itself remains portable. A failed import leaves the complete prepared source edition intact and can be retried with the same command.

## Source implementation

- `build-relationships.mjs` derives the original thirty-reach source review.
- `bind-native-geography.mjs` binds that review to the maintained completed geographic operation.
- `open-native-geography.mjs` verifies and retains complete inputs, writes the native edition and optionally imports it.
- `source_tools/assessment_reach_geography.py` remains the original geographic calculation.
- `source_tools/receive_georgia_assessment.py` remains the original complete Georgia source receiving operation.

The static source review is reproducible from the retained originals. Native membership counts and the completed collection IDs are produced only when this command consumes the original operation’s actual completed geography.
