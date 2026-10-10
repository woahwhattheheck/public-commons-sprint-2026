# Operator report

Run with Node.js 22 from the repository root:

    node stellar/scf-starforge-20261009/sf58-merchant-operator-report/report.mjs --input observations.json --out new-output

The source inputs use the adjacent SF52 outcome schema. The tool saves a JSON summary, a CSV export and a static HTML report into a newly created directory. Input file size is limited to 8 MiB. Reported amounts are exact token atomic units, not currency conversions.

For a focused local check:

    node --test stellar/scf-starforge-20261009/sf58-merchant-operator-report/test/report.test.mjs
