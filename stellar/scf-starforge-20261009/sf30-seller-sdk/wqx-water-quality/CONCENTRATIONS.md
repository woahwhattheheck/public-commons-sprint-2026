# Concentration units and complete reported limits

Use **Concentration units and reported limits** in the existing **Bulk receiving decisions** workspace to standardize a reviewed water-quality cohort. The operation prepares exact decimal representations for the selected results, every attached reported limit, and each populated native limit field. The ordinary decision preview, immutable save, full project export and independent receiving paths finish the work.

The profile covers mass-per-volume units formed from the listed gram and litre prefixes, with cubic-metre aliases. Its factors are exact decimal powers of ten derived from the [NIST SI-prefix table](https://www.nist.gov/pml/owm/metric-si-prefixes). A change from mg/L to ug/L multiplies each selected quantity by 1000. A reported less-than or greater-than bound retains its direction because every supported factor is positive.

## Operator workflow

1. Open the saved Open Waters source plan in **Bulk receiving decisions**. Retain any current receiving choices in its draft.
2. Select result targets across the existing table pages, or choose **Every result with one exact source unit** in the concentration panel. That group uses the saved source plan's exact unit label. The conversion reads the complete current reviewed draft, including its existing value and limit choices.
3. Choose the target unit and give the complete change a reason. Select **Prepare result and limit conversions**.
4. Review the result before/after values and expand every reported limit. Each limit keeps its original type, source record, unit, comment and origin. The table also shows the native receiving limit quantities separately.
5. Add the complete paired choices to the draft. The current draft keeps all unrelated decisions. **Restore preceding draft** restores the exact input document while that newly applied draft remains unchanged.
6. Preview the complete native plan, then save its decision review and new plan. Download the full conversion JSON/CSV and the ordinary portable decision-review bundle.
7. Receive that full bundle in an empty private project. Reopening the saved review reconstructs the complete conversion report from its original source and retained choices.

The panel pages its display while retaining the complete selection and full exports. The source plan continues to contain every original result; selection changes only the explicit receiving choices for the chosen records.

## Scientific representation

The original Potomac cohort contains 220 mg/L, 40 ug/L and 38 ng/L result records, plus 452 non-detects with reported limits and unspecified result units. The four supported operator selections cover 749 conversions. A separate explicit Keep decision retains the one NTRU optical record, so the complete review considers 750 records while the native plan retains all 1,035 original results and 1,112 limits. In the original silica record, 4.65 mg/L becomes exactly 4650 ug/L and its 0.06 mg/L DQCALC limit becomes exactly 60 ug/L. The [complete retained Potomac source graph](./review-sheet/examples/potomac-concentration-source.json) includes the original native rows, source profiles and corrected receiving plan.

The converter retains the original decimal string separately from its converted string. It moves the decimal point using string arithmetic and retains the exact numerator/denominator factor. It accepts signed decimal and scientific-notation source values. It performs no floating-point arithmetic or rounding.

Blank, absent and null reported quantities retain their distinct source states. A blank non-detect result stays blank. If its result unit is unspecified, **Reported limits with an unspecified result unit** converts only its independently labelled reported/native limits; the result and its unspecified unit remain unchanged. The CLI selects this same complete group with **--reported-limits-only**. Reported inequalities retain their exact comparator. Each attached limit uses its own source unit; a limit with a different unit is converted independently. Empty limit metadata slots retain their original empty value and unspecified unit.

The original characteristic, fraction, method speciation, site, sample context, qualifier, detection condition, estimate label and laboratory method remain attached. Conversion changes representation; it does not change which observations the scientific analysis includes in arithmetic. Source and current receiving context are retained separately where the existing draft already contains explicit contextual choices.

The operator selects an explicit mass-per-volume target. Density-dependent quantities, chemical-basis changes, logarithmic values and unsupported source labels receive a review issue. A populated native limit requires an unambiguous current native limit unit. Use the existing result/limit decision controls to settle that representation before preparing the unit change.

The complete report includes each originally reported limit, including limits that have no native slot. Original native-plan limit objects remain unchanged; the corresponding converted representations are retained with the decision report and source pointers. All original raw profiles continue to travel in the existing portable project.

## Exact receiving choices

The existing decision schema and target identities are unchanged. The adapter writes explicit choices only for changed result/unit or native limit cells. The unit decision retains a compact source-bound conversion annotation inside its ordinary reason. Each changed paired quantity carries the same conversion identity. The existing decision JSON and quoted CSV/TSV retain those reasons.

The native workflow checks the entire paired choice before preview and checks the actual native postimage after its original translations and normalization. An incomplete pair, a removed unit anchor, a changed reported-limit source or a translation that changes the exact converted value/unit is returned as a concrete receiving issue. Re-prepare that result with all its limits from the current draft, or restore the complete preceding draft.

Original receiver field limits also apply: result strings accept 60 characters, unit and native limit strings accept 12, and the ordinary decision reason accepts 2,000. The full report carries the source audit through the existing decision document. Native RESULT_COMMENT retains its original source comment and its 4,000-character field contract.

## CLI

The CLI uses the same project, native planner and receiving engine as the browser.

~~~sh
node wqx-water-quality/review-sheet/cli.mjs units \
  --project /private/water-project --plan original-plan \
  --out source-unit-groups.json

node wqx-water-quality/review-sheet/cli.mjs standardize \
  --project /private/water-project --document current-decisions.json \
  --from-unit mg/l --target-unit ug/L \
  --reason "Use the receiving project's agreed microgram-per-litre reporting unit." \
  --out concentration-decisions.json --report concentration-proposal.json

node wqx-water-quality/review-sheet/cli.mjs preview \
  --project /private/water-project --document concentration-decisions.json \
  --new-plan concentration-plan --out concentration-preview.json

node wqx-water-quality/review-sheet/cli.mjs save \
  --project /private/water-project --document concentration-decisions.json \
  --new-plan concentration-plan --review concentration-review \
  --preview concentration-preview.json

node wqx-water-quality/review-sheet/cli.mjs unit-report \
  --project /private/water-project --review concentration-review \
  --format csv --out concentration-results-and-limits.csv

node wqx-water-quality/review-sheet/cli.mjs export \
  --project /private/water-project --review concentration-review \
  --format bundle --out complete-concentration-review.json

node wqx-water-quality/review-sheet/cli.mjs receive \
  --project /private/receiving-project --bundle complete-concentration-review.json
~~~

Use the exact source unit reported by the **units** command. Alternatively, **standardize --results selected-result-ids.json** consumes a JSON array of distinct original result IDs. Existing output files remain available; choose new filenames for a new reviewed operation. A report containing review issues is written in full so the operator can resolve its selected quantities.

## Reusable domain API

**concentration-units.mjs** exports:

- **concentrationUnit(symbol)** — an explicit supported unit or null.
- **concentrationFactor(fromUnit, toUnit)** — exact decimal power and rational numerator/denominator.
- **shiftExactDecimal(originalString, power10)** — the exact decimal representation.
- **convertConcentrationMeasure({value, unit}, targetUnit)** — one quantity with its original value, missing state, factor and inequality.
- **convertConcentrationRecord(input, {targetUnit})** — one original source-bound result and every reported limit.
- **CONCENTRATION_UNIT_PROFILE** — the versioned scientific contract and target choices.

The complete record input is:

~~~js
{
  source: { sourceSha256, profile, recordId, /* original provider/row identity */ },
  value: "0.0120",
  unit: "mg/L",
  limits: [
    {
      id, type, value: "0.0050", unit: "mg/L",
      comment, origin, source: { /* exact original limit source */ }
    }
  ]
}
~~~

**review-sheet/concentrations.mjs** joins that domain to the maintained product. It exports source-unit groups, complete preparation, paired-choice and native-postimage validation, saved-report reconstruction, and full CSV rendering. **prepareConcentrationChoices** accepts the actual project, current decision document, distinct result IDs, target unit and reason.

## Sources and intended workflow

- [NIST, SI prefixes](https://www.nist.gov/pml/owm/metric-si-prefixes): exact decimal prefix factors.
- [Waterborne, Automated Data Collection](https://waterborne-env.com/automated-data-collection/): the original company workflow combines environmental data from multiple sources and standardizes concentration units and reporting levels for analysis.
- [Open Waters contract](./openwaters-contract.mjs): the original import fields, lengths, limits and aliases used by the receiving application.
- [Bulk decision workflow](./review-sheet/README.md): source-bound preview, save, CSV/TSV editing and complete independent receiving.


## Complete original Potomac receiving operation

The maintained receiver is `review-sheet/concentrations-receiving.mjs`. Its source carrier, `review-sheet/examples/potomac-concentration-source.json`, contains the complete retained capture, original scientific review and corrected source plan. The standard Python ZIP reader verifies every original byte and member before making private copies. The source graph is the retained October 12 receiving packet; the operation makes no provider request.

Copy `review-sheet/examples/potomac-concentrations.json` to the private execution directory and set its source, output, existing Chromium and Playwright paths for that operator. Preserve the original source hashes and operation ID once execution has started.

~~~sh
node --expose-gc --max-old-space-size=768 \
  wqx-water-quality/review-sheet/concentrations-receiving.mjs \
  --config /private/potomac-concentrations.json
~~~

The complete operation exits each child before starting the next. `--phase source` restores the original capture through the maintained project, reproduces the original scientific review and corrected native plan, and invokes the original CLI for the 220 mg/L, 40 ug/L, 38 ng/L and 451 mass/volume reported-limits-only records. It previews all 749 conversions and the explicit original optical Keep choice together and round-trips the entire JSON decision document through complete CSV and TSV tables, including every reason.

`--phase browser` exercises the actual concentration panel and restores the preceding draft, imports the complete document with 749 conversions and the optical Keep reason, previews and saves that same native plan, and downloads all eleven decision/native outputs. It then closes the authoring workspace, receives the complete bundle in an independent empty project, compares all eleven downloads and reopens the received review after a cold workspace restart. Both desktop and mobile layouts are retained.

`--phase verify` reopens both original projects, verifies every original result identifier and all 1,112 reported limits, compares actual browser files to the original native exporters, and reopens the full JSON/CSV conversion report through the maintained CLI. The populated Silica example must remain the exact 4.65 mg/L → 4650 ug/L and 0.06 mg/L → 60 ug/L pair. All 452 unspecified result units and their blank values remain blank.

The phase receipts, private original inputs, complete files and final `result.json` stay in the same selected operation directory. A completed phase verifies its original members before reopening. The same review ID and plan ID resume their existing immutable native records. The receiver preserves original qualified and non-detect records while checking the actual native planner after all existing translations.

For the complete browser operation, reserve 1,536 MiB of memory with 256 MiB headroom and 512 MiB of additional ordinary disk with 64 MiB headroom through the existing native worker. These are planning allowances for the complete source graph, two receiving projects, full table/report exports and sequential browser phases; `result.json` reports the actual retained file lengths. The source-only phase needs no browser and can run first under the same retained source/configuration. Use the existing installed browser and dependency closure.

### Original optical-unit exception

The complete original plan contains one Turbidity non-detect with two NTRU optical limits: 2.0 (Censoring Level) and 2 (Lower Reporting Limit). It has a blank result and unspecified result unit. The mass-per-volume catalogue exposes this record separately and retains its original quantities. The complete operation therefore considers 750 records: 298 explicit mass/volume results plus 451 mass/volume limit-only records are converted, and the Turbidity record carries an explicit original Keep reason. All 452 blank result/unit pairs, all 1,035 source results and all 1,112 reported limits remain in the native plan. A selected set that includes an unsupported unit produces a complete review-required report before applying changes.

The CLI `--reported-limits-only` selection is the catalogue’s supported mass/volume set. The `units` command also returns every unspecified-unit record and the preserved other-unit list. The browser shows the selected count and original optical record beside the preparation controls.
