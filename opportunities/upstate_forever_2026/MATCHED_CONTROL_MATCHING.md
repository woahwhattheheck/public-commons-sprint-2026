# Exact precipitation-matched controls

This is the maintained numerical component for the Upper Savannah original
matched-control workflow. The existing raster preparer owns spatial support,
source receiving, masks, writing and native run submission. This module selects
one distinct candidate for each target within one original land-cover class.

## Native integration

`source_tools/precipitation_matching.py` exposes:

```python
from source_tools.precipitation_matching import match_precipitation

matched = match_precipitation(
    target_precipitation, candidate_precipitation,
    target_ids=target_row_major_cell_ids,
    candidate_ids=candidate_row_major_cell_ids,
    check_running=check_running,
)
control_cell_ids = candidate_row_major_cell_ids[matched.candidate_positions]
method_details = matched.metadata()
```

The result indexes the caller's **original candidate array** and is aligned with
its **original target order**. Supply every eligible candidate in that class,
finite nonnegative precipitation in mm/year, and unique integer original cell
IDs. The caller enforces disjoint populations, original class support, the full
corridor exclusion and the requested reporting/model-domain distinction. An
empty target class is valid. Too few candidates raise a descriptive error.
Cancellation exceptions propagate to the existing queue; no additional scheduler
or polling process is introduced.

The WAT six-argument raster adapter retains its categorical restored land-cover
input and output-directory contract. Its explicit `exact_monge` selection may
import this component. Keep the original greedy method separately declared;
never silently substitute it for an exact request. Admission and disk-backed
raster scanning remain the raster preparer's responsibility. Retain this complete
module, the method metadata, original support/source identity, every matched pair
and actual residuals in that original preparer's receiving output.

## Objective, numeric meaning and deterministic ties

The objective is the global minimum of
`sum(abs(target_precipitation[i] - selected_candidate_precipitation[i]))`, with
each candidate used at most once. This is a subset assignment, not a requirement
to match every eligible candidate or to equalize signed sums. Original class
counts and cell areas are enforced before the numerical call by its producer.

Sorted absolute-distance costs form a bitonic Monge array. The implementation
uses diagonal separation from section 4 of Aggarwal, Bar-Noy, Khuller, Kravets and
Schieber, *Efficient Minimum Cost Matching and Transportation Using Quadrangle
Inequality*, University of Maryland CS-TR-3199:
https://hdl.handle.net/1903/610 . This is an original NumPy implementation, not a
copy of the authors' code. Sorting costs O((n+m) log(n+m)); the separator stage
uses O(n log(m-n+1)) operations and O(n+m) storage. Equal-sized populations take
the direct ordered assignment. There is no n-by-m cost or backtracking matrix.

The retained IEEE float64 values are converted to exact dyadic integer
coordinates. The usual rainfall range uses int64 arithmetic; exceptionally wide
exponents use Python integers. Neither bins nor rounded rainfall values are
introduced. Temporary-array chunks cover the entire population; they do not
truncate the candidate set. Exact objectives are retained as a decimal integer
and a binary exponent, plus a convenient floating display when representable.

The method is `class-stratified-exact-monge-L1-dyadic/v1`. Sort by value and
original ID; symbolic secondary coordinates are `target=3*i+1`, `candidate=3*j`.
They choose only among equal primary objectives and do not perturb physical
rainfall. Different optimal cells can therefore be chosen from those selected by
the legacy DP's tie rule. Preserve completed legacy controls and create an
explicit successor; do not overwrite their source or pretend cell identities
are unchanged.

Rainfall matching alone does not balance soil erodibility, erosivity, terrain,
stream distance, hydrological routing, patch shape or upstream contributing area.
Those remain scientific interpretation and scenario-design considerations.
Paired rainfall residuals are input statistics, not modeled nutrient/sediment
loads or measured intake concentrations.

## Complete original-input operating course

From the application root, with Python/NumPy and Node available:

```sh
python source_tools/precipitation_matching_course.py \
  --source source/simulated_headwaters_20261013 \
  --output /path/to/new-matching-edition
```

The command receives the unchanged original input generator
`f1acf0f2a1470e059ad5f5b8231178ae59876954` and unchanged legacy selector
`7d778123ef8305fdd17c1637192c69399c5efac5`, checks their actual Git blob identity,
executes them locally, matches every original target, compares exact Fraction
objectives, then writes the complete original inputs, both generators, kernel,
rerun source, pair CSV, comparison JSON, all-file inventory and offline HTML.
The output directory is create-only. This course leaves existing Workspaces,
completed masks and native runs unchanged.

Open `report.html` directly. Both original-class maps and every source pair are
available offline. Filter classes/residuals, highlight exact original cells,
page the full table, export all or filtered pairs and inspect source identities.
All scientific source and application code remain editable in the delivered
folder. A recipient can independently replay it:

```sh
cd /path/to/received-matching-edition
python precipitation_matching_course.py --output /path/to/independent-edition
```

The flat receiving layout imports the adjacent kernel rather than relying on the
sender's checkout. Relative HTML downloads require keeping the complete folder.
The report is a retained-input scientific comparison, not the regional native
NDR/SDR execution surface.

## Operated results

On the unchanged 120-by-120, 30-m simulated Piedmont input recipe, both classes
retain the exact legacy minimum:

| Original class | Targets/control cells | Eligible controls | Area, ha | Minimum total absolute residual, mm/year |
|---|---:|---:|---:|---:|
| 81 pasture/hay | 236 | 2,359 | 21.24 | 9.624952000005578 |
| 82 cultivated crops | 399 | 3,474 | 35.91 | 21.24991300001011 |

Together: 635 distinct controls, 57.15 ha, no corridor overlap. All 236 pasture
controls agree with the legacy selection. The crop subset retains 362 legacy
cells and chooses 37 alternative, equal-cost cells under the declared tie rule.
The complete 635-pair CSV and report disclose both original cell identities.

The declared capacity workload used PCG64 seed 20261013 and uniform 1000-1600
mm/year values: 1,000,000 targets against 4,000,000 candidates. In the measured
Python 3.13.5 / NumPy 2.3.5 Linux process it took 1.730110599 seconds, with peak
whole-process RSS 504,244 KiB. It visited 21,603,057 separator rows. The analogous
legacy one-byte DP backtracking array alone would occupy 4,000,005,000,001 bytes.
Capacity measurements are not timings of the regional raster pipeline or native
model. Actual source scanning, disk output, model runs and available memory must
be measured in their original executor. Original small-case timings and the
capacity driver are retained in the receiving package; no hosted CI is needed.

## Delivery context

Carry the complete `CURRENT_OWNER_DIRECTION.md` version `2026-10-13.3` with the
source handoff. Its priority is the actual geographically selected, 30-m native
baseline/restoration/control course, original scientific units, readable
editable delivery, and October 13, 2026 14:00 UTC cutoff. This additive kernel
must preserve that original producer and any already-running operation.
