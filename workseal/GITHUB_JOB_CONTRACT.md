# Exact GitHub job evidence contracts

Required job names and schema field names are compared as structured sorted arrays,
including cardinality, rather than joining names with a delimiter. One literal name
`build\0test` must never satisfy two required jobs `build` and `test`. Exact literal
names remain supported; no arbitrary character ban is introduced.

Normalized jobs now use deterministic UTF-16 code-unit ordering, matching JavaScript
array string sorting, rather than process-locale collation. Distinct names that collate
equally (such as precomposed and decomposed accented characters) cannot make the
normalized evidence digest depend on provider input order. This can change digests for
multi-job evidence whose old locale ordering differed. Keep the original raw evidence
and review/regenerate affected normalized evidence and dependent receipts; do not
silently accept an old digest as the corrected representation.

A job must start and finish within its completed run's createdAt/updatedAt interval.
The observation timestamp establishes when evidence was collected, not extra time in
which jobs may run after the captured run completed. This aligns the shared contract
with the existing retained-response acquisition compiler. The shared Gregorian
validator and all existing run, workflow, SHA, status and expectation pins are retained.

## Focused reproduction

```sh
node --test workseal/test/github_job_contract.test.mjs
```

All three cases failed against upstream contract blob
`aba9aa35ba4fcea41eab1cc5f2d049d9c592f084` and passed against this repair with
Node 22 in the cloud container. Each case includes a valid control. The fixtures are
synthetic; these checks are not GitHub provider authenticity, live chain settlement,
contest submission or payout evidence. No full repository suite was run.
