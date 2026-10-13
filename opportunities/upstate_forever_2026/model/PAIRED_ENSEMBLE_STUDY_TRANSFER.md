# Transfer and continue a paired raster analysis

This joins the existing Paired raster analysis desk to the original Study
transfer archive. Its typed root is `ensemble-products`. The scientific engine,
result archive, report producer, source importer and operator queue retain their
existing contracts.

## Operator course

1. Open a saved result or paused analysis in **Paired raster analysis**.
2. Choose **Transfer editable analysis**. The desk reopens the exact saved
   analysis through the original inspect route and passes that identity to
   Study transfer.
3. Preview contents. The plan identifies the input kind, original selected and
   planned member counts, locally retained physical inputs, and unresolved
   original input fingerprints.
4. Export through the existing study queue. The archive includes the maintained
   application, selected analysis directory, all retained quantitative outputs,
   report files, source receipts and tile checkpoints, plus its resolved native
   scientific dependencies.
5. Restore through the original Workspace receiving flow. Study transfer lists
   **Paired raster analyses** and **Open paired analysis** reopens that exact
   original record in the paired desk.
6. A native analysis with its complete original cohort can use **Resume from
   retained native pairs**. This continues the original paired calculation and
   durable tiles; it does not launch an InVEST model.

The transfer action also supports paused/interrupted analyses. Workspace
switches, view detachment, and opening another analysis invalidate an older
pending transfer read. The existing **Add to scientific report** control remains
with the original report wrapper.

## What belongs to the selected study

The native record is `ensemble-products/<analysis-id>/analysis.json`. Its ID
is the original digest of its complete frozen selection. The transfer retains
the entire owned analysis tree, including `reports.json`, quantitative
GeoTIFFs, the original result ZIP manifest when received, execution settings and
every existing tile record/raster. Descriptor paths are relative to their
original analysis directory; no output is interpreted relative to another run.

The helper uses the original `.analysis.lock` and `.report.lock` during
capture. Each tile's original window, record name and declared raster bytes are
checked. Native files and source CAS objects are read directly; source-view
hard links are never created during closure or receiving.

### Original native Workspace inputs

Only the original exact input kind
`original Workspace native run artifacts` invokes native record
resolution. The declared project must be the current retained Workspace.
Every local native run ID must match its immutable original selection and
the member's profile, grid and baseline/alternative scenario. Each selected
pollutant's original normalized pixel-mass raster must match the analysis's
SHA256, length and units. The original grid reporting mask must match too.

The original run roots bring their full profiles, scenarios, grids, source
collections, native stages, input tables and outputs through the existing
typed Study closure. Historical source references and requested model versions
remain unchanged. The helper does not use requested version strings to
reclassify completed producing-stage provenance.

### Explicit paired rasters and received result editions

The original engine deliberately strips absolute source paths from its frozen
selection. An explicit-raster member can have arbitrary descriptive IDs; such
IDs never become native Workspace dependencies just because they resemble
hexadecimal identifiers.

A received result ZIP contains the completed quantitative/report products and
source fingerprints, while its original input rasters and tile checkpoints may
be absent. The study archive preserves that exact received result edition.
When identical physical input bytes exist in an original source collection,
the helper records `identical_source_bytes` with the actual collection,
source ID and source member, and includes that source edition. This is a byte
binding, not a claim that the source is a native model run.

Unresolved inputs remain exact named fingerprint dependencies in the plan and
receipt. The complete result still opens and exports. Resuming the numerical
analysis requires every original reporting mask and member raster. Foreign
native Workspace references retain their original project identity and are not
silently mapped to same-looking local run IDs.

The original explicit-raster CLI can consume a resolved receiving spec when
all physical bytes are retained:

```sh
python -m model.paired_ensemble_study_cli \
  --workspace /actual/received/workspace \
  --analysis-id ORIGINAL_ANALYSIS_ID --describe

python -m model.paired_ensemble_study_cli \
  --workspace /actual/received/workspace \
  --analysis-id ORIGINAL_ANALYSIS_ID \
  --output /outside-workspace/paired-inputs.json

python -m model.paired_ensemble.ensemble_cli analyze-rasters \
  --selection /outside-workspace/paired-inputs.json \
  --out /actual/received/workspace/ensemble-products
```

The resolver only reads and emits the existing `upstate.ensemble-input/v1`
contract. It uses create-only output outside the Workspace and verifies the
original bytes again. The original kernel remains responsible for raster
alignment, mass units, calculation identity, resource controls and numerical
execution. A different kernel revision naturally produces its own original
analysis identity.

## Scientific-report lineage

The existing paired producer creates immutable captures under
`ensemble-products/report-sources/<report-source-id>`. They retain
`report-source-record.json`, its original analysis/report inventory,
source recipe, companions, producer code, and the original `import.json`
when present.

Selecting a saved scientific-report edition follows a paired source only when
its role, URI, metadata, recipe, complete companion roster and retained capture
agree. A same-project source adds its original analysis and native/input
dependencies. The original registered import source remains a separate
dependency; an equivalent reimport under another collection ID is accepted
after complete byte/recipe equality. A foreign source remains a complete
CAS-contained report with its declared project provenance.

The shared report-lineage map uses the existing tuple
`(source_collection_id, source_id)` and original receipt schema.
Source-free or related captures are retained separately inside each paired
analysis receipt. The existing saved-report source-key receiving guard keeps
older archives on their original dependency contract.

With **Include related results** selected, original completed paired report
captures are carried for the chosen analyses. Selecting one analysis never
pulls every unrelated ensemble in the Workspace.

## Original command-line selected export

Use the maintained Study transfer CLI with a normal selection JSON:

```json
{
  "title": "Paired scenario study",
  "include_related_results": true,
  "roots": [
    {"kind": "ensemble-products", "id": "ORIGINAL_64_HEX_ANALYSIS_ID"}
  ]
}
```

The current `model.study_transfer_cli --help` supplies its original
preview/export/inspect commands. Restore with the original `model.portable`
or registered Workspace receiving flow; the study verifier reopens the selected
original root and checks the retained result/input/report identities.

Continuation may append tiles, finish a paused analysis, recover missing input
bytes or add a scientific report. Previously captured quantitative outputs,
input bytes and immutable report captures remain exact. A completed calculation
cannot silently become incomplete on receiving.

## Source adoption

The additive component fragment is
`integration/component_fragments/paired-ensemble-study-transfer.json`.
It extends the original paired and Study transfer families and enumerates the
existing paired engine, store, report producer, native provider, registered
views and guides needed in a received application. It preserves the original
report wrapper and its report action.

The shared core joins add one typed root/provider, its two native locks,
analysis receipt, receiving verification and catalogue. The saved-report join
calls this helper after the existing captured-source guard. The selector adds
one label and an original-desk reopening action. No alternate task queue,
registry, archive or report renderer is introduced.

Actual controller verification covers the complete handoff, paused analysis,
A→B→A Workspace switching, detachment, a changed saved analysis during a delayed
read, and received-study reopening. Native export/restore receiving should reuse
an existing completed original cohort and return its actual analysis ID,
source bindings and first execution result through the current sprint course.
