# Columbus ERP conversion and phase acceptance workspace

This City profile runs inside the maintained [conversion operator](../../scap-workspace/README.md). It carries a Columbus project from original exports and reviewed mappings through repeated GL and parallel-payroll trials, discrepancy correction, named business reviews, phase selection, cutover planning and a portable project handoff.

The application uses the existing reconciliation service for input custody, execution, correction history, exact reports and reviewer records. City plans are retained in the original mapping bundle. Opening a project does not create another database or copy the comparison engine.

## Start the original operator

From the repository root, using Node.js 22+, Linux `flock` and `tar`:

```sh
node revenue/erp-conversion-assurance/scap-workspace/cli.mjs \
  --directory /absolute/private/columbus-workspace \
  --profile revenue/erp-conversion-assurance/profiles/columbus-rfp27-0008/workspace-profile.json \
  --extension revenue/erp-conversion-assurance/profiles/columbus-rfp27-0008/workspace/extension.mjs \
  --port 8470
```

Open the private URL printed by the original launcher. The host binds to loopback and uses the original token, Host and Origin checks. Reuse the same `--directory` to reopen saved exports, mappings, jobs, reports, reviews and City plans. The trusted local `--extension` adds the **Project and phases** tab; the original intake, run and retained-input views remain the operating controls.

No dependency installation or hosted CI is required. The original service exposes optional input/report, worker deadline and heap limits through the same launcher; see its [guide](../../scap-workspace/README.md) for configuration and service operations.

## Operate a City conversion project

1. **Define the cohort and map the original exports.** Choose a cohort, record its conversion owner and included population, select source and target CSV files, and map the observed physical headers to the logical keys, text fields and amounts. The operator inspects the selected headers. Editable templates below describe business grains; they do not claim the City's physical column names.
2. **Record the project plan.** In **Project and phases → Plan**, use one project ID across its workstreams. Keep a stable trial cohort ID for each repeatedly converted population, such as `gl-fy2025-p12` or `payroll-pr01`. Record the trial number, proposed number of conversions, history years, period, extraction/loading owners, prime and City reviewer roles, scope, mapping decisions and independent control references.
3. **Stage and run.** Return to **Intake & mapping**, review the mapping JSON and stage its immutable input bundle. The staged identity pins the original CSVs, mapping, City plan and current engine. Run the explicit job ID. The original worker reports exact comparison results and paged record/group findings.
4. **Correct a retained run.** Use **Create linked correction** or the project's **Correction** action. The original source and target bytes are reused until replacements are selected. Enter a correction reason, retain the next trial number, and stage a new bundle. The predecessor job and bundle come from the original server, including when the City plan carries report-bound discrepancy assignments.
5. **Review and select a phase.** Record the review against the original report in **Runs & review**. In the City panel, refresh retained runs to compare trials, assign discrepancy owners and dispositions, and select the exact reports and individual review records for a phase. Selecting a later report or review is an explicit edit. Record the phase criteria, interface results and cutover responsibilities, then use the original staging action to retain the plan.
6. **Reopen and hand off.** **Retained inputs** reopens any saved bundle, including a plan revision without a new comparison run. The City trial view also lists such saved plans. **Download project handoff** packages the completed project runs through the original replay exporter and includes every retained mapping/plan snapshot, phase selection, review identity and pending job identity.

Editing a plan retains a new immutable revision when staged. Reading the project, switching views and comparing trials preserve the existing revision. A plan-only correction can be staged without running the comparator again.

## Logical cohort templates

**Needs expert review:** the actual project's logical grains, physical export contract and independent financial/payroll controls. The operator exposes these decisions as editable mappings and retained reviewer records.

| Cohort | Record identity | Declared comparison | Group controls |
| --- | --- | --- | --- |
| General ledger | Fiscal year, fund, posting period, journal/document, line, account class and account code | Debit and credit at scale 2, default tolerance `0.00` | Fiscal year, fund and posting period |
| Parallel payroll | Pay period end, pay cycle, employee token and check sequence | Gross, net, employee tax, deductions and employer fringe at scale 2, default tolerance `0.00` | Pay period and cycle |
| Vendor master | Vendor ID | Exact normalized vendor name and payment status | Complete key population |
| Procurement commitments | Fund, purchase order and line | Exact status; committed and liquidated amounts | Fund |
| Employee and position master | Employee token | Exact normalized position and employment status | Complete key population |
| Fixed assets | Fund and asset ID | Exact class and status; cost and accumulated depreciation | Fund |

The original engine compares signed decimal strings as exact integer units. Operators can edit the declared scale, tolerance, fields and grouping for the actual export contract. The two supplied standalone `*.profile.json` files and four sample CSVs continue to work with the original CLI comparator.

The shared operator supports an explicit `source_key_crosswalk` on any selected subset of the original keys. Import or enter the complete source-to-target tuples, including unchanged source tuples. The engine rejects missing maps and detects duplicate record identities produced by a translation. It does not infer account, employee or other code equivalence. Text-only cohorts use the same original comparator with `amounts: []` and declared `attributes`.

## Repeated trials, discrepancies and phase decisions

The trial view reads the original retained bundles and paged jobs. It compares runs from the same project, domain and stable cohort, showing result/count changes and whether the source, target, mapping bundle or engine changed. Report bodies are fetched only when an operator opens the original discrepancy view.

A discrepancy assignment retains the original job ID, report SHA-256, report collection and zero-based finding position, together with the assigned owner, disposition, correction reason and reference. Assignment does not rewrite the report or change its comparison result. For a corrected payroll export, retain the failed trial and its review, then link the corrected run and its review through the next bundle.

A phase selection retains the exact bundle, job, report SHA-256 and review UUID. The server checks the original completed report, project membership and selected review when staging. A later review or rerun remains visible in project history without replacing that selection.

The phase panel identifies incomplete planning fields, remaining proposed trial count, missing selected reports/reviews, requested changes, and unrecorded interface details. Cutover and first-year-end plans also include the source freeze, cutover window, support coverage, rollback contingency, retained parallel-payroll selection and both first-year-end continuations. These are recorded preparation findings; the actual business decision remains in the named reviewer records and phase criteria.

The independent control reference connects the comparator to the wider conversion work: GL trial balances, opening/closing and encumbrance continuity, payroll gross-to-net and liability controls, void/off-cycle population, interface checks and the actual agreed historical scope. The application preserves these references alongside the selected original reports.

## What the project download contains

The download is a private `columbus-<project-id>.tar.gz` with:

- One original `reconciliation-<job-id>.tar.gz` replay archive for each completed project run. These contain that run's exact original inputs, mapping, pinned engine, report, review history and private report-identity key.
- `project.json` with every retained bundle manifest and parsed mapping/City plan, the project trial history, exact phase/report/review selections, discrepancy dispositions, procurement source pins and pending job identities.
- Hashes and byte sizes for each nested original replay archive, plus a short handoff guide.

The parsed mapping snapshots preserve saved planning content. The exact mapping and input bytes for completed trials are in their original replay archives. New input bytes unique to an uncompleted bundle remain in the original service directory; keep that directory for ongoing work and a full service backup. A plan-only revision after completed trials therefore travels with its prior original inputs without requiring another engine run.

## Executable example in the original browser

The included CSVs contain small illustrative records for demonstrating the application. Their headers are examples, not recovered City or CGI data definitions. Use the mappings in `gl.profile.json` and `payroll.profile.json` to select each sample's observed columns.

| Original operation | Expected original result | Retained continuation |
| --- | --- | --- |
| Stage the two GL sample exports with fund/period grouping | PASS; both sample funds retain matching debit/credit totals | Record the first GL review |
| Revise the target fund codes from `G100`/`G200` to `NEW100`/`NEW200`; import both explicit fund crosswalk rows | PASS; all four source records translate through the reviewed map | Trial 2 retains the original job/bundle predecessor and its own review |
| Stage the two payroll sample exports | FAIL; the target has net pay `730.01` against source `730.00` | Retain the original discrepancy and a changes-requested review |
| Assign that discrepancy, replace the target with `730.00`, and stage the linked correction | PASS; totals are gross `2150.00`, net `1650.00`, tax `390.00`, deductions `110.00`, fringe `132.00` | Retain the failed report, corrected target, assignment and accepted second review |
| Select the second GL and payroll reports/reviews; stage the completed cutover plan | Four completed runs remain, with the additional plan revision retained separately | Reopen the original directory and download the project handoff |

## Original procurement and source versions

The [City listing](https://columbusga.gov/finance/bid-opportunities), observed October 11, 2026, and [Addendum 2, page 1](https://columbusga.gov/Portals/finance/Resources/bid-opportunities/2027/Heather%20FY27/RFP27-0008Add2.pdf?ver=wbOYnkUWs-BsSJZBX9578g%3D%3D) give the proposal deadline as **October 28, 2026, 5:00 PM Eastern**. The earlier October 14 date was superseded. Check the original listing for subsequent addenda and the announced separate Q&A.

The [original RFP](https://columbusga.gov/Portals/finance/adam/Content/LDQoKeGkfk6iEZfk7wkYyw/SolicitationDocument/RFP27-0008.pdf), page 13, describes the CGI Advantage 4.0 vendor-hosted SaaS incumbent and financial, procurement, HR and payroll transition, including validation, parallel payroll and first-year-end support. Pages 21, 23 and 26 supply the financial/payroll and migration context.

| Source | Relevant requirement | Application input and retained output |
| --- | --- | --- |
| Addendum 2 §11(G), p4 | Extraction, cleansing, mapping, loading, validation, proposed history years and trial count; vendor/City responsibilities | Original file intake; header maps; repeated cohort/trial identity; named plan owners and scope |
| Addendum 2 §11(H), p4 | Interface inventory | Named interface, owner, recorded result and original evidence reference |
| Addendum 2 §11(I), p4 | Phase criteria and parallel payroll | Original reviews, phase criteria and exact selected report/review set |
| Addendum 2 §11(K), p4 | Source freeze, readiness and rollback | Saved freeze, cutover window, support and rollback plan |
| Addendum 2 §11(L), p4 | Hypercare and first fiscal/payroll year-end | Named support and both first-year-end continuation fields |
| Addendum 2 §11(Q), p5 | Reusable machine-readable data | Original replay exports and project mapping/plan handoff |

The source adapter embeds the following exact downloaded versions. A saved plan retains its own source pins when reopened.

| Original document | SHA-256 |
| --- | --- |
| `RFP27-0008.pdf` | `283afce21ae55fb1bd2c74781c7447b210038a140699d9d67474342ba884d250` |
| `RFP27-0008Add1.pdf` | `071497b2e50be2fc63020ba9f46299dac2f352cb1105f1e71f273d0f2225d5a0` |
| `RFP27-0008Add2.pdf` | `005e745e7e8ba07089cfcdaada114b9d8437ab2fb24f5a3458ccfd260a09f5d9` |

## Shared extension contract

The original host accepts an optional trusted local extension. `decorateDraft` restores profile metadata when an existing bundle is opened; `compileSpec` retains and checks it after the original mapping compiler; explicit assets mount only under `/columbus/`; the project endpoints run after the original authentication and request checks. The browser supplies its original API, bundle/run controls and download path to the panel's `mountProfilePanel`, `updateDraft` and `currentPlan` interface.

The City module adds no independent comparison arithmetic, job queue, input store or review history. Its project view composes the original service's verified bundles, jobs and reviews, and its project export calls the original replay exporter for each completed run. The default SCAP operator remains usable without an extension.
