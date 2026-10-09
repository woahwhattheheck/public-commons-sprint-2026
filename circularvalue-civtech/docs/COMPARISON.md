# Baseline-versus-option review

**Needs expert review.** This is decision-support software, not an investment
recommendation, an environmental certification, or evidence of realized savings.
It adds option comparison to the existing CircularValue calculation generation;
it does not replace the single-case compiler or change existing packets.

## Run

From `circularvalue-civtech`, supply two existing case-schema JSON files. Each must
have the same currency, evaluation date, horizon, and discount rate. The command
names below belong to `circularvalue.comparison`; existing `circularvalue.cli`
commands are unchanged.

```bash
python -m circularvalue.comparison compile baseline.json option.json --out comparison.json
python -m circularvalue.comparison verify baseline.json option.json comparison.json
python -m circularvalue.comparison report baseline.json option.json --out comparison.html
```

A valid replay prints `VALID` and exits 0. Invalid replay, incompatible bases,
malformed input, or filesystem failures exit 2. Existing outputs are never
overwritten. Case inputs are bounded to 4 MiB each; comparison verification input
is bounded to 32 MiB. Inputs must be regular non-symlink UTF-8 JSON files. Strict
JSON validation and the existing case-schema validation run before output creation.

The HTML report is self-contained, uses no JavaScript, credentials, remote assets
or network calls, and prints locally. Tables scroll horizontally on narrow
screens and are keyboard-focusable. Dynamic case, lever and evidence text is
escaped. The report compiles the source cases itself; it never trusts an imported
comparison's totals. Keep both source cases and the comparison JSON with the
review copy. Hashes identify the JSON inputs and calculation, not the HTML file.

## What the differences mean

All values remain integer minor units. No currency conversion or decimal scale
is inferred. Annual lever values and category totals are **before** recurring
costs. Net present value comes from the existing compiler **after** one-off and
recurring costs, using the shared horizon and discount rate.

The delta convention is option minus baseline:

- Lower endpoint: option low minus baseline high.
- Central estimate difference: option central minus baseline central.
- Upper endpoint: option high minus baseline low.

This is a conservative endpoint envelope, not a confidence interval, a
probability, or matched low/low and high/high scenarios. No correlation between
baseline and option outcomes is inferred. Even identical input ranges retain
an envelope when treated as separate uncertain outcomes; no causal improvement
is implied. A numerical range-above/range-below flag does not override evidence
quality or recommend an option.

Currency, evaluation date, horizon or discount-rate differences are rejected
rather than silently compared. Costs and evidence-age policy can differ and
are shown as changed assumptions. Both original quality blocks and original
decision-support states are retained, including stale evidence, hypotheses and
modeled levers.

## Change tracking and replay

Evidence is compared by stable ID **and its complete content**, including the
retained artifact SHA-256 and provenance metadata. Reusing an evidence ID with a
new artifact hash is a modification. Any lever citing changed evidence appears
in the change list even when that lever's numerical fields are unchanged.
Added, removed and modified evidence/levers are sorted deterministically, with
both before and after values. A changed evidence reference is not authenticated
or fetched by this tool.

The comparison contains both compiled case packets, their source hashes,
assumption differences, evidence differences, lever differences, annual-value
and NPV envelopes, category envelopes, and its own content hash. Verification
recompiles both supplied source cases and compares exact canonical JSON. Merely
altering a comparison value and recomputing its hash cannot pass replay.

## Focused validation

```bash
python -m unittest discover -s tests -p test_comparison.py -v
```

Three synthetic contracts exercise conservative endpoint arithmetic and basis
mismatches; reused evidence IDs, quality propagation and rehashed tampering; and
HTML escaping plus CLI compile/verify/report and create-only/symlink behavior.
They do not establish real commercial value, sponsor acceptance, a competition
entry, or a payment. The original core and unrelated suites are unchanged.

## Competition context

The official [CivTech 12.3 challenge](https://www.civtech.scot/civtech-12-challenge-3-commercial-value-of-circular-economy-business-practices)
asks for an intuitive, evidence-based tool showing wider commercial value of
circular-economy practices. This feature supports comparison of alternatives and
inspection of changed assumptions. The source is a prototype contribution, not
an application receipt or awarded procurement contract. Applicant eligibility,
actual company evidence and submission requirements must be established separately.
