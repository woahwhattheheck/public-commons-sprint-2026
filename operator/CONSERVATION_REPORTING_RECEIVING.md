# Complete the original South Carolina reporting studies

The regional receiver now uses the original PlanningBasins2023 files already
shipped with the application. This completes the existing South Carolina
reporting-basin study and source-water priority study when the native host
cannot resolve the original public Git endpoint.

The change is in `operator/conservation_regional_receiving.py`. It composes the
64,962-byte maintained receiver from PR3435, SHA256
`1f47edbdd7eff17746e6f851d0ff89e13e67b92dab21598b86690bbfb00adc91`.
All original source-ID resolution, whole-domain and reporting studies,
source-water optimizer, plan packets, candidate catalogue, optional scenarios
and explicit experiment execution remain in that same receiver.

## Original source selection

Receiving follows the existing source-custody order:

1. Reuse an already imported original source by its actual byte identity,
   retaining the received collection and source IDs.
2. For an absent reporting source, reuse each complete matching member in
   `Workspace/conservation-receiving/original-reporting/`.
3. For a missing or incomplete cached member, copy the exact original from
   `APPLICATION/source/geography/planning_basins2023/`.
4. If that bundled member is absent, use its existing pinned public URL.

A present bundled file must resolve within the application and match its
original byte length and SHA256. A mismatch raises the existing source attempt
error. The receiver streams the member through its existing `.partial` file,
checks the completed copy, then atomically replaces the cached destination.
A complete cached original is left in place.

A local copy capture records `source_kind=bundled_original`, the application
relative source path, the original pinned public commit and the observed file
identity. It does not assign an HTTP response to a filesystem copy. Public
downloads retain their original response URL, status, headers and timing with
`source_kind=original_public_download`.

The original public source is
[capellett/scsf at 45f7ea3ca968c96e2fc6188d7f55c3b0ce60da95](https://github.com/capellett/scsf/tree/45f7ea3ca968c96e2fc6188d7f55c3b0ce60da95/data-raw/planning_basins2023).
The five exact members are already published under the application's source
directory from PR2866. They are one source family:

| Filename | Bytes | SHA256 |
|---|---:|---|
| PlanningBasins2023.shp | 1600228 | 133bc5369bd0d68bfdb53c61e3df24f9445f799b0d68b301f321d2c49d71eab6 |
| PlanningBasins2023.shx | 164 | 60572d5c75694110fceab00c24ba9b3607756838585f2b315c5abcbeac0034c6 |
| PlanningBasins2023.dbf | 874 | 0c792056dcaff94eaa9fb5a22d576a6c42bcce763a885a289f4cdd15434b4dba |
| PlanningBasins2023.prj | 424 | 16375a22022b8b34455292d576c5ebb590083e406d754a9abbcca6994c3e3261 |
| PlanningBasins2023.shp.xml | 12530 | 95776aa0ff34820f077e04695975af1eb73a3f21d03642c827623324e47a73ec |

The complete eight-feature source keeps its native EPSG:26917 CRS, original
attributes and layer name `PlanningBasins2023`. The reporting selection remains
the original feature with `Basin = Upper Savannah`, native record 5. This is
the actual reporting boundary used to intersect the original WBD HUC12 units.
The upstream model-domain boundary remains its own retained source.

The receiver imports the complete existing `upstate.sources/v1` document with
role `REPORTING_BOUNDARY`, original source ID `planning-basins2023`, all four
sidecars and the actual per-member capture records. An already imported
equivalent source keeps its original receiving identity.

## Resume the completed regional project

Use the already operating regional application and Workspace, with its original
217-HUC model-domain and published protection source editions. Select a new
receiving output filename in the same operation so the earlier whole-domain
result stays available.

For a received regional project, use its actual application, Workspace and GIS interpreter:

```sh
APP=/actual/received/application
WS=/actual/received/workspace
PYTHON=/actual/environment/bin/python

"$PYTHON" -B "$APP/operator/conservation_regional_receiving.py" \
  --workspace "$WS" \
  --output "$WS/conservation-receiving/reporting-resume.json"
```

An equipped receiving host that restored this same project under another
directory uses its actual restored application and Workspace paths. Preserve
the restored project's identity and its existing source identities.
The complete current application must include all five original geography
members above. If it is receiving a source supplement, copy this ordinary
existing directory from the complete published source along with this current
receiver.

The regional receiver uses the original Conservation prepare/build APIs and
saved records. It runs the reporting study, source-water priority optimization,
plan export and independent Workspace reopening through those maintained APIs.
Original upstream results remain available under their existing study/plan IDs.

If a source edition has not yet been imported in that receiving Workspace,
pass its existing original manifest:

```sh
"$PYTHON" -B "$APP/operator/conservation_regional_receiving.py" \
  --workspace "$WS" \
  --domain-manifest /actual/original-domain/sources.json \
  --public-water-manifest /actual/public-water/sources.json \
  --public-water-preparation /actual/public-water/public-water-preparation.json \
  --output "$WS/conservation-receiving/reporting-resume.json"
```

Use the actual retained paths. An already imported original is resolved from
the Workspace; it does not require another source download. The optional
`--geography-manifest` remains available for the complete existing original
geography collection.

## Completed result and next existing controls

A successful continuation retains these named study results in
`reporting-resume.json`:

- `reporting`: original HUC12 units intersected with the selected complete
  Upper Savannah reporting polygon, original focus selection and exported
  Conservation plan packet.
- `protection_reporting`: eligible reporting units scored by their measured
  overlap with the original published protection polygons; original optimizer
  analysis, actual selected HUC12 IDs, saved plan and complete packet.
- The existing `upstream` and `protection_upstream` studies retain their
  separate original geographic basis.

The result has `reporting_source_status=received_and_operated`, actual source
bindings, study and plan IDs, candidate counts, selected original HUC12 values,
packet paths and hashes. The original receiver independently reopens the saved
plans and protection analyses and compares their source selections and files.

Open the returned reporting plan in **Conservation**. Its original saved-plan
Scientific Reports integration from PR3491 and PR3522 can prepare the typed
source and carry the actual objective, constraints, optimizer and measured
areas into the existing ordered report composer. Use the actual returned plan
ID, keeping the earlier whole-domain plan separately selectable.

To exercise the maintained candidate catalogue on the completed reporting
priority study in the same receiving operation:

```sh
"$PYTHON" -B "$APP/operator/conservation_regional_receiving.py" \
  --workspace "$WS" \
  --prepare-catalog --catalog-study protection_reporting \
  --output "$WS/conservation-receiving/reporting-catalog-resume.json"
```

This original course retains the full eligible cohort, explicitly records its
deterministic one-HUC receiving edit, exports every selected original row and
packet, and reopens the original cohort/plan. That receiving demonstration
selection is separate from the retained optimized priority plan.

No grid/profile/scenario arguments are required for these original geographic
studies. Numerical experiment execution remains the receiver's explicit
`--execute-experiment` action when an actual model experiment is selected.

## Source and receiving publication

Carry the entire current receiver and this guide together with the unchanged
five-member original source family. A cumulative component owner can add the
guide and those existing source paths to its maintained Conservation source
inventory. The current receiver predecessor and all original identities are
declared above so another source writer can compose a concurrent change
without replacing its unrelated work.

Keep actual source/member reuse output, the reporting study/plan/packet IDs and
the independently reopened result in that same continuation. A source identity
or native GIS exception can then be repaired against its actual retained input.
