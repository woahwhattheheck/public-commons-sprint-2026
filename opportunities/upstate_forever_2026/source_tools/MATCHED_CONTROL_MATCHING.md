# Exact precipitation subset matching

This is the maintained integration contract for the unchanged original NumPy kernel `precipitation_matching.py`, original source Git blob `51027e4cba7759ebf444951bfe86bd554aa76a9c`. The geographic producer and `regional_matched_control.py` own the original class, reporting, computational and corridor selections. The kernel chooses an injection from the supplied target population into distinct candidate positions.

## Objective and original-source contract

For every original land-cover class, match all n target values to n distinct members of the m eligible candidates, minimizing:

```text
sum(abs(target_precipitation[i] - candidate_precipitation[selected[i]]))
```

Values are original finite nonnegative float64 precipitation in mm/year. IDs, when supplied, are unique nonnegative integer original cell indices. The producer must establish geographic support, equal class membership and disjoint target/candidate populations before calling. The kernel does not select a domain, interpret nodata or infer a restoration treatment.

```python
from source_tools.precipitation_matching import match_precipitation

result = match_precipitation(
    target_values,
    candidate_values,
    target_ids=target_original_cell_ids,
    candidate_ids=candidate_original_cell_ids,
    check_running=existing_operation_callback,
)
positions = result.candidate_positions
original_control_ids = candidate_original_cell_ids[positions]
metadata = result.metadata()
```

`candidate_positions` has one member per caller-original target position. It indexes the caller's candidate array, not its internally sorted array. `target_order` is the internal stable ordering of the caller's targets. The regional wrapper uses these distinctions to write actual original row/column IDs into its retained pairing table.

Insufficient candidates raise an error. Empty targets are valid. Duplicate original IDs, nonfinite/negative values, and integers that cannot be represented exactly in float64 are rejected explicitly.

## Algorithm and numerical identity

The original algorithm is the bitonic Monge diagonal-separation method described by Aggarwal, Bar-Noy, Khuller, Kravets and Schieber, *Efficient Minimum Cost Matching Using Quadrangle Inequality*, CS-TR-3199, section 4.

Primary publication and complete manuscript:
https://hdl.handle.net/1903/610

Sorting costs O((n+m) log(n+m)); vectorized diagonal separation costs O(n log(m−n+1)) time and O(n+m) storage. The kernel avoids a target-by-candidate matrix. Prefix minima split ordered rows across adjacent diagonal offsets, preserving a globally optimal monotone injection.

Actual IEEE-754 inputs are converted to exact dyadic coordinates. The ordinary rainfall case uses signed int64 arithmetic with a checked coordinate bound. The disjoint ascending candidate gaps bound primary prefix sums. An arbitrary-exponent input may require Python integer coordinates; callers must account for that different memory model.

Symbolic secondary coordinates resolve ties without changing rainfall values. The stable tie convention is retained in metadata: sorted value/original ID, symbolic target=3*i+1 and candidate=3*j, first prefix minimum. Different equal-optimum spatial selections are possible compared with an older tie rule. Preserve all completed original editions and source IDs.

The exact objective is retained as a decimal integer string and binary exponent. The readable objective is a derived floating-point presentation; the exact pair remains available if the float representation overflows. The regional result additionally retains every original pair and per-class residual.

## Native operation and memory

The kernel allocates linear NumPy working arrays. It is not a bounded constant-memory stream. The regional adapter maps retained original records, checks the actual per-class counts against an explicitly admitted working-memory estimate, and refuses to silently change method when an exact request exceeds capacity.

An actual source-owner native run on 1,000,000 targets and 4,000,000 candidates completed matching in approximately 1.73 seconds with about 492 MiB peak RSS. That is a measured matching workload, not an estimate for full regional raster preparation or native NDR/SDR. The regional preparer adds input scanning, source retention, sorting, CSV output and final mask writing.

The original 635-cell square course reproduced its two exact objectives, 9.624952000005578 and 21.24991300001011 mm/year, on the original 236 pasture and 399 crop targets. The completed square's source/results remain separate from the actual-geography edition.

See `REGIONAL_MATCHED_CONTROL.md` for explicit `matching_method="exact_monge"`, actual host memory admission, complete source snapshots, native grid/footprint adoption and restart behavior. Both methods retain the same original geographic and source qualification; native NDR/SDR remain the existing model owners.
