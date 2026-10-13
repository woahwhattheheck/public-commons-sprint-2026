# Exact precipitation matching with reusable record output

The existing regional preparer keeps its scanner, original geographic support,
external sort and native jobs. These optional modules provide a complete class
record interface for the exact kernel introduced in PR #4143.

```python
from source_tools.matched_control_exact_records import match_class_exact

summary = match_class_exact(
    sorted_targets, sorted_candidates, class_directory / "exact-selection",
    original_class, original_grid_width, emit,
    max_working_bytes=admitted_numerical_bytes,
    io_working_bytes=32 * 1024 * 1024,
    check_running=check_current_operation,
)
```

The two source files retain the existing sorted 16-byte record format:
`<float64 precipitation, uint64 original cell index>`. The chosen positions
returned by the unchanged exact kernel remain aligned to the original target
records. All original IDs, precipitation values and signed pair residuals are
written to `pairs.csv`; original selected IDs are written to `selected.bin`.
`selection-positions.bin`, exact numerical metadata, all implementation sources
and `complete.json` are also retained. A disk bitmap checks cross-chunk duplicate
selections while exports use the separately declared IO budget.

Use a new owned output directory, or reopen the same completed directory.
The caller's existing operation lock remains authoritative. Inputs, class,
grid width, method, tie rule and complete source bytes bind reuse. An accepted
completed selection returns before another numerical allocation or solver call.
The producer prefixes the returned relative `files` entries into its outer
manifest and includes `complete.json` separately. Existing work/sort directories
can contain the owned `exact-selection` child. No active producer body changes
are required to import and call this interface.

For new work the facade preserves the current numerical admission estimate:
`256*n + 96*m + 256 MiB`, with zero for an empty target class. The IO budget is
additional. Version 2 also preserves the current producer's int64-dyadic
precision boundary before allocating the exact solver. Arbitrary-width integer
inputs need an explicitly sized native backend; no approximate fallback is
selected. Completed historical source editions stay unchanged.

The retained original-input integration operated 236 pasture and 399 crop
pairs, 635 cells / 57.15 hectares. Exact objective integers were 21165493281584
and 46729052865479, both multiplied by 2^-41. Matching, retained outputs and
completed reopening took 0.018575944 seconds after sorted inputs were available.
The two new classes invoked the kernel twice; their completed reopening invoked
it zero times. That recorded operation uses the version-1 facade, whose complete
source remains in its output. Version 2 only adds the current numeric-array
precision admission; its focused ordinary/extreme-exponent check made zero
matching calls. The existing accepted numerical runs were reused.

Complete original source/inputs/pairs and that operation are available in the
[shared delivery](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791891622900569).
The canonical original scientific inputs, reporting/corridor/domain definitions
and native NDR/SDR execution remain the maintained regional product. This
interface changes record handling, not their scientific meaning.
