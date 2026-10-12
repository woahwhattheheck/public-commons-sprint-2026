# Bulk receiving decisions

The Bulk decisions workspace turns a saved Open Waters receiving plan into an editable decision table. An operator can select many native fields, apply one reviewed change, inspect the original planner's resulting issues and receiving counts, and save a new immutable plan. A complete portable bundle reopens the original plan, the new plan, the reasons and the underlying WQX source in another private project.

The scientific review and selected observation cohort stay bound to their original identifiers and hashes. Receiving choices use the existing [Open Waters planner](../openwaters.mjs), [published import contract](../openwaters-contract.mjs) and [native project](../project.mjs). The original [Open Waters guide](../OPEN_WATERS.md) explains the receiver, field constraints, limit representations and six native outputs.

## Operator workflow

1. Open a saved Open Waters plan in **Bulk decisions**. The page records its plan, scientific review and capture identities once.
2. Filter by kind, field, attention status or exact source text. Select visible rows or all matching rows. The screen pages the table; selecting all matching rows follows the complete source result.
3. Choose **Keep**, **Set** or **Clear**. A bulk Set uses one matching field and value type. Enter the exact receiving value and a reason for every changed choice.
4. Preview. The original native planner supplies receiving counts, readiness changes, changed field counts and complete remaining issues. Review the impact on the whole selected cohort.
5. Save under a new receiving plan name and a distinct decision-review name. The saved source plan remains available for comparison.
6. Download the editable decisions, the decision report, the six native receiving files, or the complete decision bundle. Reopen the same review to continue from the saved result.

Use a new decision sheet based on the resulting plan for a subsequent review round. Every round binds its own original plan and retains its own reasons.

## Exact choice semantics

| Action | Behavior |
| --- | --- |
| Keep | Preserve the saved choice. An optional reason records why it was kept. An unmarked row is also kept. |
| Set | Write the exact selected string as an explicit receiving choice. Setting the currently displayed value can still add an explicit override where none existed. |
| Clear | Remove the saved explicit choice and let the original native planner produce that field again. It does not erase the original source record. |

An **empty Set** is a deliberate empty field value. It differs from Clear. The original native validator still applies: for example, an explicit receiving identity must be nonempty and fit its native length.

A limit Set with an empty value means the original native mapping `field: null`: the limit remains in the exact source and native result comment. A reference catalog Set accepts a JSON array of exact string codes; `[]` supplies an empty catalog. Clear removes a supplied catalog, restoring the original planner's unsupplied-catalog behavior.

Settings Clear restores the original option default: `locationMode=create`, `identityMode=compact`, and empty organization, project or notes. The native preview shows any receiving-context issues produced by those choices.

The decision report retains reasons beside the exact target, original explicit choice and resulting explicit choice. Entity-field reasons are part of this retained review; they are not inserted into unrelated native option fields.

## Editable kinds

| Kind | Source identity | Editable receiving choice |
| --- | --- | --- |
| settings | Original receiving plan | Organization, project, location mode, identity mode and notes |
| location | Original native location `sourceKey` | Receiving `MONLOC_ID`, location mode and the original allowed location fields |
| activity | Original native activity `sourceKey` | Receiving `ACTIVITY_ID` and the original allowed activity fields |
| result | Original retained `sourceRecordId` | The original allowed result fields, including the five limit fields and their unit |
| translation | Exact native field plus exact input value | Shared receiving field translation and its reason |
| limit | Exact reported limit type | One of the original five native limit fields, or retained source representation |
| reference | Original native reference family | Exact receiving catalog codes as a JSON string array |

A displayed business or provider identifier can occur in more than one original row. Target identity uses the full retained source key or record pointer, native field, original value and explicit choice, together with the immutable source-plan hash.

Translations match the value entering the original native cleanup step. The original planner applies an individual field override before its matching translation. The preview therefore covers their combined effect. A translation does not change the original source bytes.

Limit choices preserve every reported limit, value, unit, comment and source pointer. Limits whose reported type is absent remain visible in the native source and issue report; the native planner's individual result-field choices remain available. No invented reported type is introduced.

Reference targets use the exact families in the published native contract. A supplied catalog is compared with the exact receiving codes; it does not infer equivalence between different spellings.

## Portable JSON, CSV and TSV drafts

JSON has one shared source binding:

```json
{
  "schema": "starforge.wqx-review-sheet.v1",
  "sourcePlanId": "original-plan",
  "sourcePlanSha256": "the exact 64-character source-plan SHA-256",
  "decisions": [
    {
      "targetId": "the exact target identity returned by this source plan",
      "action": "set",
      "value": "the exact native receiving value",
      "reason": "the receiving choice and why it is appropriate"
    }
  ]
}
```

Use actual exported identities; the strings above describe the fields.

CSV and TSV place `schema, sourcePlanId, sourcePlanSha256` in the first record, followed by the table header. The shared source binding appears once. Columns are:

```text
targetId kind sourceKey sourceId field matchValue currentValue savedChoice type issueCodes action value reason
```

Only **action**, **value** and **reason** are editable. The target hash verifies the other identity and base-value columns before import. The original planner validates the target against the saved source again at preview.

Quoted cells retain tabs, newlines, commas, quotes, leading zeros and empty strings. When opening a table in a spreadsheet, import the columns as **text** so the spreadsheet preserves native codes, dates and identifiers. Export using the same CSV or TSV format.

Keep and Clear leave the value column empty. Set may also have an empty value; its action supplies the distinction. Reference values are entered as JSON string arrays, such as `["code-a","code-b"]`, using the actual receiving catalog.

A draft export can retain unfinished Set values or reasons. Preview and Save validate the completed choices. A filtered table download includes every already marked decision, including marked targets outside the current filter, so importing it preserves the full draft. Deleting an unmarked table row leaves that target kept; use an explicit Clear to remove a saved native choice.

Tables support up to 200,000 target rows, 64 MiB of UTF-8 text, and 4 MiB per cell. Native receiving options retain their original field and mapping constraints. Large tables can be downloaded by kind or field while retaining all marked decisions.

## Command line

The CLI uses the same domain and original private project as the operator page. Node and the original WQX application's existing dependencies are required; the decision-sheet modules add no package dependency.

Start with an already saved native plan:

```sh
node wqx-water-quality/review-sheet/cli.mjs source \
  --project /private/water-project --plan original-plan

node wqx-water-quality/review-sheet/cli.mjs draft \
  --project /private/water-project --plan original-plan \
  --format tsv --out /private/review-work/decisions.tsv
```

Edit the table, then run the complete native preview:

```sh
node wqx-water-quality/review-sheet/cli.mjs preview \
  --project /private/water-project \
  --document /private/review-work/decisions.tsv \
  --new-plan reviewed-plan \
  --out /private/review-work/preview.json
```

After reviewing the returned counts, issues and proposed native plan, save that exact preview:

```sh
node wqx-water-quality/review-sheet/cli.mjs save \
  --project /private/water-project \
  --document /private/review-work/decisions.tsv \
  --new-plan reviewed-plan --review receiving-review-01 \
  --preview /private/review-work/preview.json \
  --out /private/review-work/saved.json
```

The CLI also accepts `--expected-preview SHA256`. The preview binds the complete normalized decisions, exact original source, selected new-plan identity and resulting native plan hash. A changed preview requires a new native preview before saving.

Export and receive:

```sh
node wqx-water-quality/review-sheet/cli.mjs export \
  --project /private/water-project --review receiving-review-01 \
  --format bundle --out /private/review-work/complete-decisions.json

node wqx-water-quality/review-sheet/cli.mjs receive \
  --project /private/received-water-project \
  --bundle /private/review-work/complete-decisions.json

node wqx-water-quality/review-sheet/cli.mjs read \
  --project /private/received-water-project --review receiving-review-01
```

Existing output files are preserved. Choose a new filename for a subsequent export.

## Complete receiving and resumed saves

The retained decision review has its own identity, distinct from the original scientific review and both native plan identities. Save first retains its exact prepared request, then calls the original `saveOpenWaters`, then publishes the completed decision record. The per-review private lock joins the existing native project's lock; no additional workspace or upload system is introduced.

If a save is interrupted, reopen the prepared decision review and submit the same review name, document, new-plan name and preview hash. A completed same-request save reopens its original result. Reusing a review name with different work returns a conflict.

The complete decision bundle carries:

- The complete retained decision review, original normalized receiving options and reasons.
- The resulting original Open Waters bundle, including its complete WQX review/source graph and all five encoded native artifact members.
- The original native complete-bundle filename, byte length and SHA-256.

Receiving uses the original native bundle receiver. It checks the native file's exact metadata, reproduces the original source plan from its saved options, reproduces the reviewed native preview from the same source and document, and retains the same decision-review identity. Both original and resulting plans are available in the receiving project. The native complete-bundle export remains one of the six original receiving outputs.

### Export formats

| Format | Contents |
| --- | --- |
| json | Editable normalized decision document |
| csv / tsv | Complete editable table, with original target bindings |
| report | Standalone decision report, native impact, reasons and complete remaining issues |
| bundle | Complete portable decision/source/native receiving bundle |
| native-locations | Original native monitoring-location paste file |
| native-results | Original native sample/result paste file |
| native-crosswalk | Original full identity crosswalk |
| native-report | Original native receiving report |
| native-references | Original native receiving reference requirements |
| native-bundle | Original complete Open Waters receiving bundle |

## Integration API

`model.mjs` exports `reviewSheetSource`, `listReviewSheetTargets`, `iterateReviewSheetTargets`, `normalizeReviewSheetDocument`, `composeReviewSheet`, `reviewSheetImpact` and `reviewSheetIssues`.

Target pages return `{source, rows, total, offset, limit, kinds, fields}`. Queries accept `kind`, `field`, `search`, `status`, `attentionOnly`, `offset` and `limit`. Limit defaults to 100 and supports up to 1,000; a display can remain small while bulk selection consumes larger pages. Attention includes native issues, existing explicit choices and receiving context/identity choices.

`csv.mjs` exports `reviewSheetCsv`, `parseReviewSheetCsv`, `reviewSheetTsv` and `parseReviewSheetTsv`.

`workflow.mjs` exports:

```js
previewReviewSheet({ project, document, newPlanId })
saveReviewSheet({ project, reviewId, document, newPlanId, expectedPreviewSha256 })
listReviewSheets({ project })
readReviewSheet({ project, reviewId })
exportReviewSheet({ project, reviewId, format })
receiveReviewSheet({ project, bundle })
```

The project argument is the original `openWaterQualityProject` instance. The existing workspace server owns HTTP/UI integration and managed Applications use the same project and browser assets. The source inventory must include `model.mjs`, `csv.mjs`, `workflow.mjs` and the integrated browser module; the standalone command uses `cli.mjs`.

Complete HTTP bundle receiving needs the existing 128 MiB native receiving allowance. Table imports and large decision documents support up to 64 MiB. These are executable input limits, separate from native scientific interpretation and original receiving field constraints.
