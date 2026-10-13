# Classification, placement and implementation cost

This module extends the original staff market workspace from market comparison into a complete editable compensation plan. The same local application retains pay structures, job-content decisions, workforce inputs, placement rules, phased cost options, reviews and accepted receiving files. Classification records use the original database, revision checks, operation history and complete workspace backup.

Open **Classification and placement** in the main navigation. The five working views follow the consulting workflow: **Pay structures → Role classifications → Workforce editions → Placement and cost → Review and exports**. Each edition remains individually readable after a new edition or recommendation is saved.

## Start with the complete Apex case

The [Apex FY27 input guide](inputs/apex-fy27/README.md) contains the original public PDFs, all 47 public-safety pay titles, 27 grades, 38 authorized groups, the RFP scope mapping, employee and questionnaire adapters, and the complete partner delivery map. The [RFP acceptance matrix](inputs/apex-fy27/RFP_ACCEPTANCE.csv) connects each required deliverable to its source page, responsible party and receiving result.

The public planning comparison preserves 19 original RFP-listed groups totaling 238 FTE. It uses the explicitly selected lower-envelope career-level allocation and compares each same grade's published minimum with its **Published Market Salary**. This is a useful public-source demonstration of the complete operating path; an employee study uses the received workforce and professional placement decisions.

| Quantity | Source-native result |
| --- | ---: |
| Annual base at the selected published minima | $16,283,632.12 |
| Annual base at the same-grade published Market Salaries | $19,949,857.16 |
| Full annual rate change | $3,666,225.04 |
| Immediate implementation, July 2027–June 2028 | $3,671,274.72 |
| 50% from July, 100% from January | $2,747,185.11 |
| Implementation deferred until January | $1,823,095.52 |

The period runs July 1, 2027 through June 30, 2028, inclusive. Its **actual/actual** day convention applies 184/365 to the July–December interval and 182/366 to January–June. Consequently the full-period factor is 66887/66795 and differs slightly from one annual rate. The phased factor is 50051/66795; the deferred factor is 91/183. The displayed totals sum the individually rounded original group results. The example uses an explicitly declared zero incremental burden and base pay only.

After reviewing the retained source and assumptions, receive the complete case into a new private directory:

```bash
python3 classification/open_apex_example.py \
  --workspace /path/to/apex-workspace --create \
  --operation-id apex-public-planning-receiving \
  --actor "Source intake operator" \
  --reviewer "Source and cost reviewer" \
  --review-notes "Describe the actual source, allocation and cost review performed."
python3 cli.py --workspace /path/to/apex-workspace serve --port 0
```

The helper uses the maintained input receiver and the original classification actions. It retains all source documents, the four public planning envelopes, the same-grade market targets, three complete scenarios and accepted CSV/source-package exports. Reuse the same operation ID and unchanged input for an interrupted receiving. To extend an already received source workspace, pass its `original-input-receiving.json` with `--input-receiving` and keep that original workspace path.

The source table's effective timing is the first full pay period in July 2026. The input preserves that language while leaving an unspecified exact calendar date blank. The example's implementation dates are separately declared planning choices.

## 1. Retain the pay structure

Load a complete editable JSON document, or enter its grades in the editor. Record the edition, currency, effective date or original timing language, source references and decision basis. Rates use an annual full-time basis.

Each grade contains a stable ID, label, minimum, reference, maximum, reference label and source reference. The published reference and arithmetic midpoint are separate concepts. Apex's F100 minimum is $56,238.00, Published Market Salary is $68,899.58 and maximum is $87,152.83; its arithmetic midpoint is $71,695.42. The retained reference is the published $68,899.58.

Two methods are available:

- **Explicit reviewed grade assignments** records the selected grade and professional rationale for each role.
- **Defined point factors and score bands** records the consulting team's factor definitions, levels, point values and inclusive grade bands. Each role supplies a level and job-content evidence for every factor. A different selected grade requires a recorded override rationale.

The consultant supplies the classification method and its judgments. Missing ratings, unsupported levels, unknown grades and gaps in the configured point bands remain visible for correction. Save the source edition, inspect all grades, and record its review before accepting dependent decisions.

## 2. Retain job-content and grade decisions

Select the exact saved method and import a complete Roles JSON or CSV. Each role keeps its stable ID, title, department, description, classification rationale, source references, current grade and selected proposed grade. The original workbench Jobs record can be bound through `native_job_id`.

Use the detailed row editor to inspect the complete description, source and ratings. All rows are accessible through pagination. Switching to the factor editor consumes the retained ratings JSON once; subsequent visible level and evidence edits become the values saved. Malformed ratings remain editable in place.

The included questionnaire adapter maps the prime's existing response export. Multiple responses for one role preserve their response IDs and source text. A new role edition retains the previous job description and grade while carrying the submitted job-content material into the consulting review.

## 3. Receive the workforce edition

Select the exact saved Roles edition. Declare whether the input represents **individual employee rates** or **explicit aggregate planning cohorts**. Each row has a stable ID, role ID, FTE and annual full-time base rate. Incentive rate, credited experience, explicit proposed rate, current grade and supervisor ID are separate inputs.

The native declaration is `rate_basis: annual_fulltime`. The included [employee adapter](inputs/apex-fy27/README.md#private-employee-intake) converts an actual export using its declared basis:

| Original pay basis | Receiving conversion |
| --- | --- |
| Annual full-time | Preserve the annual rate |
| Annual prorated | Divide source pay by the row's FTE |
| Hourly | Multiply by explicitly supplied full-time annual hours and retain their basis |

The scenario applies FTE once after the full-time rate is established. Rounded hourly/annual ratios from a published pay table are not used as employee annual-hours inputs. Optional blank values stay blank. Exact department/title aliases are explicit mapping decisions.

Complete original UTF-8 CSV/JSON content, BOM, line endings, mapping and hash remain attached to the retained edition. The detailed editor can make explicit derived row changes while preserving those original bytes. Decimal input text stays exact through the browser and Python Decimal calculation.

Malformed files are retained for download and correction before they can replace a usable draft. If a prior browser draft has a malformed row container, reopening exposes the complete retained draft and original file beside a usable editor. The native host remains responsible for semantic validation.

## 4. Compare placement and cost choices

Select the method, its role edition and that role edition's workforce. These selections are checked together. A range-position calculation also selects its exact original baseline method.

| Placement rule | Required decision/input |
| --- | --- |
| Minimum floor | Raise rates below the proposed minimum; retain existing higher rates |
| Range position | Preserve the recorded position in the explicitly selected original grade range |
| Experience | Use credited years, the declared percentage per year and explicit year ceiling |
| Explicit proposed rates | Supply a full-time proposed rate and placement rationale for each row |

Reductions require the explicit reduction option. Above-range pay, insufficient placement inputs and related exceptions remain individually visible. Supervisor comparisons use the supplied reporting relationships and declared minimum gap. A cycle in that reporting structure requires correction.

The cost configuration states the inclusive period, day convention, cumulative implementation phases, burden percentage and its basis, optional incentive rules, and the treatment of current incentives. Phases must move forward in time and cannot reduce the cumulative share. The first phase can begin after the period starts; earlier days then carry no implementation change.

Incentive rules can specify a full-time annual flat amount, a percentage of proposed base, applicable role IDs and their source/policy basis. Multiple selected rules add. Unselected roles keep their current incentive rate. Enabling incentives requires their explicit current rate, including a supplied zero where appropriate.

Review the full individual decisions, department totals, placement exceptions, manager gaps, date segments and displayed rounding adjustment. Changing a selected source or cost input invalidates the old preview. **Retain this exact scenario** saves only the exact input/preview identity still displayed.

### Arithmetic and displayed totals

Rates and calculations use Decimal values. The annual change is proposed minus current annual full-time pay, multiplied once by FTE. Each inclusive calendar segment applies its cumulative phase share. `actual_actual` uses the number of days in each segment's calendar year; `actual_365` uses the explicitly selected fixed denominator.

Base, incentive and burden period amounts are displayed to cents. The row total rounds their exact sum. `period_rounding_adjustment` reconciles the separately rounded displayed components with that total. The same adjustment is included in department/overall summaries and accepted CSV, so the displayed columns add correctly.

## 5. Review, deliver and reopen

Inspect a saved edition in **Review and exports**. The page exposes its complete content, exact source parents, current review and prior review history. Acceptance checks the selected document hash, resolves input errors and requires accepted original parents in dependency order. A requested change remains attached to that original edition.

An accepted scenario provides:

- **Accepted placement and cost CSV**, including each source row, placement decision, full-time and FTE amounts, implementation amounts and rounding adjustment.
- **Accepted complete source package**, including the scenario, every recursively referenced input edition and its review history.
- **Editable source JSON** for a new receiving draft. Imported content receives a new native edition and review; the original identity remains available as its origin.

Use the main **Workspace** view or original CLI to save the complete database and original input blobs. A fresh restore retains the same native documents, source bytes, reviews and accepted exports. Use a new backup identity after later saved work; reopening an already completed restore preserves its subsequent work.

```bash
python3 cli.py --workspace /path/to/apex-workspace backup \
  --operation-id apex-reviewed-workspace-backup
python3 cli.py --workspace /path/to/apex-restored restore \
  --package /path/to/the-native-backup.zip
python3 cli.py --workspace /path/to/apex-restored serve --port 0
```

The receiving organization supplies the retained volume, authorized access route and actual private inputs. The loopback application can be placed behind its existing authenticated deployment route. The current package uses Python standard-library storage/server code and local browser assets; publisher intake additionally uses the existing Node runtime.

## Native integration contract

All actions run through the original workspace transaction and operation ledger. A mutation includes a stable `operation_id` and the workspace revision the caller reviewed. Reconcile an uncertain result using the same action, operation and arguments.

| Action | Principal input |
| --- | --- |
| `classification.save_method` | `actor`, complete `document`, optional exact original `content`/`filename` and `supersedes` |
| `classification.save_roles` | `actor`, `method_id`, complete rows, optional original content/format/mapping |
| `classification.save_roster` | `actor`, `roles_id`, explicit rate basis and complete workforce rows |
| `classification.preview_scenario` | Exact method/roles/roster, optional baseline method and complete cost config |
| `classification.save_scenario` | Same inputs plus `actor` and `expected_preview_sha256` |
| `classification.review` | `kind`, `id`, `expected_sha256`, `reviewer`, `outcome`, `notes` |

HTTP uses `POST /api/extensions/classification/<action>` without the `classification.` prefix in the final component. Read `/state`, `/document/<kind>/<id>` and `/download/<kind>/<id>` beneath the same extension route. In Python, `Workspace.extension_read("classification", ...)` returns the same original records and downloads. An explicit derived-row import sends `edited_rows: true` while retaining the original content and mapping.

The [main operating guide](../README.md) describes source editions, publisher cohorts, market calculations, receiving corrections, survey cycles, mutation recovery and complete restore. The [McGrath workshare](inputs/apex-fy27/MCGRATH_WORKSHARE.md) maps this implementation to the current Apex procurement and the prime's existing consulting workflow.


## Receive complete accepted packages

Use **Receive accepted package** to import complete accepted scenario JSON/ZIP exports with their original document IDs, source editions and ordered reviews. The original archive and individual members remain available unchanged, and the original Workspace backup carries the complete received case. See [the receiving workflow](RECEIVING.md) and [the original Apex receiving example](../examples/apex-accepted-package-receiving/README.md).
