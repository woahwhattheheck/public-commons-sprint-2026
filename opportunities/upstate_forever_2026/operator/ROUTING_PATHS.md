# Flow routes from a retained native run

Select an actual completed model run and a source point to see where its retained routing graph goes. The result shows the original directions, split and rejoining branches, first native stream arrivals, and branches reaching a raster edge or missing support. It keeps the selected run, input edition, native model and routing algorithm attached to every report and download.

This is a source-linked interpretation of the completed native calculation. The original model outputs and input rasters remain the scientific source. The useful question is: **which native downstream cells and first stream locations are connected to this point, and how does the recorded graph divide its routed share?**

## Open and select the original calculation

Open the existing scientific application and its original Workspace. In **Flow routes**, choose a completed run and the intended native model. Read the original run title, parameter profile, scenario and grid before choosing a point. When both NDR and SDR were run, each model has its own retained routing stage; select the one whose scientific question you are examining.

The application must take the routing algorithm from the verified original stage arguments, specifically `flow_dir_algorithm`. Both pinned InVEST 3.20 implementations support D8 and MFD through that argument. A routing raster is never reinterpreted by choosing a different algorithm in the interface.

Choose the point on the original raster by its zero-based row and column, or through an interface location control that resolves to that exact cell. The source point must be inside the native raster and on valid retained terrain. Review its original coordinate and cell centre. Preserve the distinction between the computational model domain and a reporting/utility mask: a downstream route can legitimately leave a reporting area while remaining inside the model.

Trace the selected route through the existing task action. Keep the exact selected run/model/point and request identity through an interrupted response. Reopen the original saved task or result before attempting another trace of the same selection.

## Read the map and path tables

The map follows original pixel-centre connections. **Routed share** is a dimensionless unit share starting at the selected point.

- A D8 cell transfers its complete share to its one recorded neighbour.
- An MFD cell divides its incoming share in proportion to all eight original integer weights.
- When branches meet, their incoming shares are combined before the next cell distributes them.
- First-stream mode ends each branch on its first arrival at a cell marked as a stream by the selected native stage.
- Every positive native branch is retained. The calculation does not discard low-weight branches or rescale the remainder after an edge/nodata exit.

A cell's routed share is the share passing through that cell, so adding shares across every path cell double-counts successive travel. **The terminal-share table is the accounting total.** Its stream, raster-edge and missing-support shares add to the original unit share, within the reported floating-point residual.

Use each edge's original direction and integer weight, local share and source-point routed share together. Local share describes that particular split; routed share already includes every preceding split and rejoining branch.

For example, if the source sends one half along each of two branches and both reach the same downstream cell, that shared downstream cell receives a total routed share of one. It appears once with the combined share. If a source sends three quarters toward a first stream and one quarter beyond the raster, the terminal table retains both 0.75 and 0.25. The stream share does not become one by dropping the edge branch.

### Terminal meanings

| Result | Interpretation and useful follow-up |
|---|---|
| First stream | The selected native stream mask identifies this cell as a first-stream arrival. Compare the retained stream definition and threshold when interpreting it. |
| Raster edge | The native direction points to a neighbour outside the raster dimensions. Inspect the model extent and upstream/downstream context. The edge is a raster boundary, not automatically a river mouth or physical outlet. |
| Terrain nodata | The next cell has no retained valid native terrain. Inspect the original terrain mask and the model's source coverage. |
| Stream support unknown | The cell has valid terrain, but the selected stream mask has no usable value. The route is held at that support boundary in first-stream mode. |
| Direction missing | The cell has valid terrain but its native direction is absent: D8 nodata 128 or MFD nodata 0. Inspect the original stage and source. This label does not assert a physical depression or sink. |

A source point already on a native stream has first-stream share one and zero downstream edges in first-stream mode. The kernel also supports explicit continuation through stream cells; the saved selection must retain that different boundary.

A reachable directed cycle is reported with the actual closed sequence of original cells. The calculation does not prune the cycle, silently stop after a path length or publish an acyclic accounting result for it. Preserve those native bytes and investigate the selected producing run.

## Distance, elevation and scientific interpretation

Distances are sums of original pixel-centre edge lengths computed from the complete affine transform. The pure calculation returns **native CRS coordinate units**. The application may label those values in metres only after checking the actual projected CRS and its linear-unit conversion. Geographic degrees require an explicit different distance treatment; they do not become metres by changing a label.

The distance shown at a rejoining cell is the incoming-share-weighted mean of all paths to it. Minimum and maximum graph distances retain the shortest and longest contributing paths. Diagonal edges use the actual affine geometry rather than an assumed cell width. A raster-edge or nodata exit includes the final edge to the recorded next-cell centre.

Elevation and elevation difference retain the source raster's vertical units. They are useful for inspecting the selected native conditioning and plateau routing; interpreting a difference as metres requires the original vertical-unit basis.

Routed share expresses **connectivity in the selected native direction graph**. The associated nutrient or sediment calculation also uses its own loading, retention, delivery and other scientific processes. Read those completed outputs in their original model view. Routing shares are not pollutant delivery ratios, measured water discharge, intake concentrations, residence times or calibrated probabilities.

The first stream definition comes from the selected native model. For SDR, when the actual original arguments select a drainage input, use the retained `stream_and_drainage` union that the producer used; otherwise use its `stream` output. Preserve this choice in the saved result. A selected stream pixel is not automatically one of the utility's intakes.

The original graph uses finite-precision encoded weights. The kernel retains every reachable edge and uses binary64 accumulation with stable summation at joins. It reports the final accounting residual and any edge at which an extremely small positive routed share underflowed. Complete graph rows remain available for inspection even in that numerical case.

## Retain, download and reopen

Open the saved result through the same scientific Workspace. Retain the selected run and stage identities, original arguments, exact routing/stream/terrain artifact hashes, original geometry and coordinate units, source point and stopping rule.

Use the complete downloads to inspect:

1. The readable report and route map.
2. The complete cell, edge and terminal tables.
3. The geographic route features with their original coordinates and projection.
4. The full editable/source-bound selection and result.
5. The original native rasters and their source identities.
6. The complete report ZIP, including the readable HTML, three CSV tables, GeoJSON, SVG, terrain preview, complete result and original-source descriptors, captured cell values, selected kernel source and member manifest.

The report ZIP contains the report's own files. Download the original rasters through their source links, and retain the full Workspace backup to carry the actual native stage and raster/companion bodies with the saved route. On Workspace reopen, verify the captured source against those original bodies as well as the saved report accounting.

Extract the complete archive and open its actual report and every linked table/map/source member. Export the existing Workspace with the retained original native stage, restore it to an independent owned receiving location, reopen the same saved route, and compare the original selection and terminal accounting. Preserve historical results when choosing a different point, run or stopping rule; those choices are separate saved route selections.

## Original source and implementation

The pure kernel is `model/routing_paths.py`. It receives a source-bound cell reader, dimensions, original algorithm, original row/column and affine transform:

```python
result = trace_paths(
    read_cell,
    width,
    height,
    algorithm,
    (row, column),
    (a, b, c, d, e, f),
    stop_at_stream=True,
)
```

The reader returns:

```python
{
    "direction": original_integer_or_none,
    "terrain_valid": True_or_False,
    "stream": True_or_False_or_None,
    "elevation": original_finite_number_or_none,
}
```

The native adapter owns original file verification, masks/nodata, grid co-registration, CRS/units and source binding. It must read the actual completed stage's `files` descriptors relative to that retained run, rather than guess a donor filesystem path.

The pinned native keys are `flow_direction` and `stream`, with NDR `filled_dem` or SDR `pit_filled_dem`. SDR's explicitly selected drainage union uses `stream_and_drainage`. Actual producer arguments and registry presence determine the final selected set.

The source-native encoding is PyGeoprocessing's E, NE, N, NW, W, SW, S, SE order. D8 uses values 0–7, with 128 as nodata. MFD stores eight four-bit weights in one signed 32-bit word; its bit pattern is retained, including negative signed values. Each branch weight is `(value >> (4 * direction)) & 15`, divided by the sum of all eight weights. MFD 0 is nodata/no recorded direction.

Primary references:

- [PyGeoprocessing 2.4.11 original routing source](https://github.com/natcap/pygeoprocessing/blob/2.4.11/src/pygeoprocessing/routing/routing.pyx), original Git blob `4f12528f2a8864cf021fe2f4237fc49a0f3d5753`; `flow_dir_d8`, `flow_dir_mfd` and `flow_accumulation_mfd` define the exact encoding and weight normalization.
- [InVEST 3.20 NDR source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py), original Git blob `f518b2867d4a327675fcb1c9b4ba56f29b12188d`.
- [InVEST 3.20 SDR source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py), original Git blob `0cac27add172011df367ff8026427dbbdbcda5b2`.

The application's actual retained model version and original stage arguments travel with the route result. Installing a newer analysis component does not revise an older completed native run.

The reader also retains the original stage's observed PyGeoprocessing package version. The following explicitly reviewed producer editions share this encoded-direction representation:

| Original producer version | Original routing source Git blob | Interpretation basis |
|---|---|---|
| [2.4.9](https://github.com/natcap/pygeoprocessing/blob/2.4.9/src/pygeoprocessing/routing/routing.pyx) | `04781bd83d20afb79f81608a0a1d1a6628c60453` | D8 directions and nodata; signed 32-bit MFD nibbles and normalization over all eight weights. |
| [2.4.10](https://github.com/natcap/pygeoprocessing/blob/2.4.10/src/pygeoprocessing/routing/routing.pyx) | `4f12528f2a8864cf021fe2f4237fc49a0f3d5753` | Same direction representation. |
| [2.4.11](https://github.com/natcap/pygeoprocessing/blob/2.4.11/src/pygeoprocessing/routing/routing.pyx) | `4f12528f2a8864cf021fe2f4237fc49a0f3d5753` | Routing source is byte-identical to the listed 2.4.10 source. |

This compatibility concerns reading the retained direction bytes. It does not equate different releases' complete terrain conditioning, solver implementation or resulting numerical outputs. An unlisted producer edition needs its actual encoding source joined before this reader interprets its raster; the original completed run and its files remain intact.

## Complete original numerical and receiving course

Run the focused encoded-raster course through the existing application source:

```bash
python source_tools/receive_routing_paths.py \
  --kernel model/routing_paths.py \
  --output /YOUR/OWNED/routing-course/encoded-course.json
```

It operates the actual kernel on complete labelled source arrays: split/rejoin with signed MFD high bits, all eight D8 directions, raster-edge and terrain-nodata splits, missing stream/direction, first-stream origin, explicit stream continuation, a real directed cycle and a 5,000-cell route. The output retains full route records for the branching and boundary cases, together with the long-route totals.

Where the original scientific runtime already has PyGeoprocessing 2.4.11, run the same course with `--native`. That additional phase writes two explicitly authored small DEMs, invokes the actual installed D8 and MFD producers, retains their unchanged direction rasters and interprets those outputs. These are discriminating computational examples; the actual regional/source-point receiving uses its own original completed run and raster bytes.

Continue the original application receiving with that real completed run: select a valid source point, inspect its source/grid/units, trace it once, observe original-task recovery, open the saved result, and operate all report/map/table/source downloads. Exercise a point on a stream, an invalid point, missing support where the actual selected run contains it, and a second saved selection without losing the first. Full Workspace export and independent receiving must reopen the same original stage and path result.

### Continue the existing application and cold receiving

The full browser helper is `source_tools/receive_flow_routing_browser.mjs`. Import it in the original equipped receiving controller and pass that controller's existing authenticated page/API, registered Workspace and receiving directory. The caller retains its original receiving lock. Supply two distinct actual source points from one completed native run, with a title, notes and explicit stopping rule for each.

```javascript
const original = await receiveFlowRouting({
  page,
  api,
  workspace: originalWorkspaceKey,
  workspaceDirectory: originalWorkspaceDirectory,
  runId: completedRunId,
  model: selectedModel,
  points: [
    {row: firstRow, column: firstColumn, title: firstTitle,
     notes: firstReason, stop_at_stream: true},
    {row: secondRow, column: secondColumn, title: secondTitle,
     notes: secondReason, stop_at_stream: true},
  ],
  directory: ownedBrowserReceivingDirectory,
});
```

The returned `operation_file` is the actual original browser journal. The helper downloads and checks every original argument/raster/companion and all 13 report members. It operates the actual served report, with its normal response policy, as well as the downloaded HTML, three table families, search, pagination, SVG and terrain image. It retains the original requests through interruption and reopens their exact results. At completion it restores the operator's original working selection while preserving both new accepted requests in the complete current working history.

Continue that exact journal through the original native Workspace receiver:

```bash
python source_tools/receive_flow_routing.py \
  --workspace /ABS/ORIGINAL_WORKSPACE \
  --browser-operation /ABS/OWNED_BROWSER_RECEIVING/operation.json \
  --output-dir /ABS/OWNED_NATIVE_RECEIVING
```

The native receiver binds both saved report IDs and selections to their real native source, receives the complete files, exports the whole Workspace, restores it independently, and rechecks full report, graph, original raster and member identities. A resumed receive reconciles the same archive and published receiving directory using the maintained `portable.resume_restore` path. It preserves the original restore result rather than trusting the presence of a directory.

Register the returned `reopened_workspace` with the same existing application, select that actual restored Workspace, then continue its read-only browser chapter:

```javascript
const cold = await receiveReopenedFlowRouting({
  page,
  api,
  workspace: restoredWorkspaceKey,
  operationFile: original.operation_file,
  directory: ownedColdBrowserReceivingDirectory,
});
```

Use the existing server and browser throughout these chapters. The helpers consume the selected completed model and its saved routes; they neither choose scientific input points for the analyst nor create a replacement model calculation. Preserve the complete encoded-raster course beside this application course; they exercise different boundaries.

Use the complete current `CURRENT_OWNER_DIRECTION.md` version 2026-10-13.4 and the 52-order post-call product brief. The producing peer opens/runs/renders the exact outgoing version, personally LOOKs at real desktop and 390px views, operates important controls and normal loaded/empty/error states, and opens all final attachments/archive contents. Fix actual layout, label, source or recovery defects in the same product. Preserve the existing scientific workers, accepted results and original receiving operation while completing this integrated route workflow.
