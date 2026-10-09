# CircularValue

Evidence-first CivTech 12.3 prototype.

Run:

```bash
PYTHONPATH=. python -m circularvalue.cli demo --out-dir /tmp/circularvalue-demo
PYTHONPATH=. python -m circularvalue.cli verify /tmp/circularvalue-demo/case.json /tmp/circularvalue-demo/packet.json
PYTHONPATH=. python -m circularvalue.cli report /tmp/circularvalue-demo/case.json --out /tmp/circularvalue-demo/review.html
```

The demo uses synthetic data. Each scenario input is bound to retained evidence hashes, explicit confidence labels, deterministic replay and bounded uncertainty.

## Readable case review

Open `review.html` locally to read the same compiler's value ranges, assumptions,
confidence labels, category totals, sensitivity ranking, and retained evidence
references. It is self-contained: no network, scripts, remote fonts, or service
account is needed. The browser's print command can produce a paper or PDF copy. Numeric amounts
stay on one line. On narrow screens, tables scroll horizontally; focus a table
with Tab and use the arrow keys to inspect its remaining columns. Printing fits
the tables to the page without changing the underlying values.

`report` reads and compiles the source case directly; it does not accept a
caller-authored result packet. The report shows the source case and compiled
packet hashes, so it can be matched to a separately compiled and verified JSON
packet. Those hashes do not authenticate the HTML itself. Keep the source case
and packet alongside the human-readable review copy.

All monetary values are shown as integer minor units with the supplied currency
code. The report does not assume every currency has two decimal places. It
preserves hypothesis, modeled, and stale-evidence flags and does not convert
modeled value into realized savings or an investment recommendation. Evidence
locators are displayed as supplied references; they are not fetched or
independently authenticated.

Filesystem boundary: CLI inputs must be bounded regular non-symlink files. Generated outputs are **create-only**: `compile --out`, `report --out`, and the demo's `case.json`/`packet.json` refuse pre-existing paths (including symlinks) rather than overwrite them. Use a fresh output file/directory for each run.

If writing the demo fails, the CLI removes only the case and packet files created
by that attempt that have not since been replaced. Existing files and unrelated
directory contents remain untouched. After the storage problem is fixed, retry
the same directory when the demo output names are free.

## Compare alternatives

**Needs expert review.** Compare two cases on the same valuation basis, inspect
changed evidence and assumptions, and produce a source-replayable JSON comparison
plus a self-contained HTML review. Existing single-case commands are unchanged.

```bash
python -m circularvalue.comparison compile baseline.json option.json --out comparison.json
python -m circularvalue.comparison verify baseline.json option.json comparison.json
python -m circularvalue.comparison report baseline.json option.json --out comparison.html
```

See [comparison semantics and focused validation](docs/COMPARISON.md). Differences
use a conservative endpoint envelope, not a confidence interval or an assertion
of realized savings. Reused evidence IDs with changed source hashes are tracked;
both cases retain their stale-evidence, hypothesis and modeled-value flags.
