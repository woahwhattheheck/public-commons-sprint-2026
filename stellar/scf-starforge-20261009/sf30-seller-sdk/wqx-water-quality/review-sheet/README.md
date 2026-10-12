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

## Installed command and SDK

Use the supplied, source-pinned `@tokenjunkielabs/starforge-merchant` distribution containing this complete receiving application. Its existing command registry exposes the same original CLI as `starforge water-quality-decisions`. The source commands below also work directly from a checkout.

```sh
starforge water-quality-decisions source \
  --project /private/water-project --plan original-plan

starforge water-quality-decisions draft \
  --project /private/water-project --plan original-plan \
  --format tsv --out /private/review-work/decisions.tsv

starforge water-quality-decisions preview \
  --project /private/water-project \
  --document /private/review-work/decisions.tsv \
  --new-plan reviewed-plan --out /private/review-work/preview.json

starforge water-quality-decisions save \
  --project /private/water-project \
  --document /private/review-work/decisions.tsv \
  --new-plan reviewed-plan --review receiving-review-01 \
  --preview /private/review-work/preview.json
```

The installed SDK exports the original project and the same model, editable-table codec and retained workflow. For example, after editing the complete exported TSV:

```js
import { readFile } from 'node:fs/promises';
import { openWaterQualityProject } from '@tokenjunkielabs/starforge-merchant/seller/water-quality/project';
import { reviewSheetSource, listReviewSheetTargets } from '@tokenjunkielabs/starforge-merchant/seller/water-quality/decisions/model';
import { reviewSheetTsv, parseReviewSheetTsv } from '@tokenjunkielabs/starforge-merchant/seller/water-quality/decisions/table';
import { previewReviewSheet, saveReviewSheet, exportReviewSheet } from '@tokenjunkielabs/starforge-merchant/seller/water-quality/decisions';

const project = await openWaterQualityProject('/private/water-project');
try {
  const original = await project.readOpenWaters('original-plan');
  const source = reviewSheetSource(original);
  const page = listReviewSheetTargets(original, {
    kind: 'result', attentionOnly: false, offset: 0, limit: 1000,
  });
  const document = parseReviewSheetTsv(
    await readFile('/private/review-work/decisions.tsv', 'utf8'));
  const completeEditableTable = reviewSheetTsv(original, document);
  const preview = await previewReviewSheet({ project, document, newPlanId: 'reviewed-plan' });
  // Inspect the complete preview, impact and remaining issues before this save.
  const review = await saveReviewSheet({ project, document, newPlanId: 'reviewed-plan',
    reviewId: 'receiving-review-01', expectedPreviewSha256: preview.previewSha256 });
  const fullProject = await exportReviewSheet({ project, reviewId: review.reviewId, format: 'bundle' });
  console.log({ source, targets: page.total, tableCharacters: completeEditableTable.length,
    reviewId: review.reviewId, filename: fullProject.filename, bytes: fullProject.bytes.length });
} finally {
  await project.close();
}
```

`./seller/water-quality/decisions` exposes the functions in `workflow.mjs`; `/decisions/model` and `/decisions/table` expose the corresponding domain and codec modules. The installed browser workspace serves the same five assets and uses these same retained records.

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

## Complete native browser receiving

[browser-receiving.mjs](browser-receiving.mjs) is one maintained operator receiving journey. [browser-receiving.example.json](browser-receiving.example.json) selects the original saved Potomac project and its exact source identities. Change the project, output and installed-runtime paths for the selected host; keep the source identities and original operation identifiers when resuming that same work.

The original source plan is `potomac-quarter-open-waters-01`, SHA-256 `4f9b1f612d1f9cb5bf3c90720d67cc37b5bd8fcd0c51476e669a340cde514610`. Its retained 1,035 result rows all have the exact native receiving value `RESULT_STATUS = Accepted`. The receiving journey derives the full target set from that original plan, adds that same value as an explicit receiving choice, and retains one explicit Keep reason for the existing project identifier `32UFDQN00`. It compares all original location, activity and result records, receiving fields, limits, references and summary values before and after the choices.

The complete journey performs the following connected operation:

1. Bind the exact original plan, scientific review, capture, current managed source inventory and driver source to one immutable `request.json`.
2. Open the real browser workspace, verify the five served assets, page the original targets and select all matching rows through the supported 1,000-row requests.
3. Set the exact current status and reason across all 1,035 results. Download the full editable CSV, parse that original download, add the explicit Keep reason, and import a complete TSV through the operator interface.
4. Preview the full native plan, inspect that preview in the Open Waters tab, return to the decision sheet, and save or reopen the same original decision review. A prepared save resumes its original review name, plan name and preview.
5. Download all eleven visible decision/native exports and compare their byte counts and SHA-256 values with the original export functions. Inspect saved read-only controls, revise into fresh names, and reopen the original saved review.
6. Close the original server and browser context, start the same project afresh, and reopen its unchanged decision review and resulting plan.
7. Receive the full portable bundle through the browser into the independent project. Reopen it, download all eleven files again, compare each against both the received native model and its retained original export, then close and freshly reopen the receiving project.

Run the driver from the seller SDK source directory:

```sh
node --expose-gc --max-old-space-size=768 \
  wqx-water-quality/review-sheet/browser-receiving.mjs \
  --config /absolute/browser-receiving.json
```

An embedding application can import `runReviewSheetBrowserReceiving(configuration)` from the same source module. `--help` prints the exact standalone entrypoint. The regular installed `starforge water-quality-decisions` command remains the operator's domain CLI; the receiving driver uses its own explicit browser-runtime configuration.

The configuration takes absolute canonical paths for the original project, output directory and independent receiving project. `playwrightModule` and `browserExecutable` select existing installations; `browserArgs`, `browserLibraryPaths` and `browserTempDirectory` carry the selected host's actual Chromium runtime requirements. The supplied example records the existing Chromium 153 launch arguments used by the same original console receiver. On a different installed browser, select that browser's supported arguments and library paths. Node and the original application dependencies must already be present.

The original plan file is 5,562,523 bytes; its complete native Open Waters bundle is 31,495,178 bytes. Full decision tables and eleven exports are additional retained outputs. Start the whole operation through the existing native resource controller with its complete source, input and runtime paths declared. A starting allocation for this full browser workflow is 1,536 MiB memory plus 256 MiB reserve and 512 MiB new ordinary-disk space plus 64 MiB reserve. Those are execution declarations, not measured peaks. The driver streams file verification, releases large export buffers between files, and retains one exact set of complete exports; received downloads are compared and removed after their exact result is recorded. Keep the browser's ordinary temporary directory within the admitted allocation.

### Retained output and continuation

`request.json` binds the logical source, all exact decisions and code identities. `progress.json` records the current connected stage, original downloaded members, native receive and cold-reopen outcomes. A partial operation uses those same identifiers and verifies retained files before continuing. A completed call verifies its original files and both native projects, then returns the original result with `reused: true` without another browser run.

`result.json` contains the completed review/plan/source identities, all eleven retained export hashes, all eleven receiving-download comparisons, actual browser and Node versions, original target-page requests, served assets, mobile viewport result and closed-workspace state. `exports/` contains the complete deliverable files. `draft/` contains the actual editable CSV, imported TSV and reopened decision JSON. `screenshots/` contains four focused viewport images covering the complete native preview, saved exports, mobile view and received project. `received-project/` is the independent original project, ready to reopen through the ordinary workspace or managed Applications.

If a source or decision identity differs, select the intended original operation or begin a separately named receiving operation. An unfinished stage keeps its original request and records the concrete failure in `failure.json`; completed records and downloads remain available for the same operation's continuation.

## Complete Potomac receiving example

The [complete Potomac packet](./examples/potomac-complete-receiving/README.md) applies this workflow to all 1,035 original WQX3 results from the Chain Bridge station in January–March 2025. Its source-bound decisions move the original receiving plan from 571 ready rows and 464 rows requiring review to 1,035 ready rows. The packet retains all 1,112 original limit records, exact original capture files, source review, full editable CSV/TSV tables, per-row receiving choices and complete native outputs.

The example derives its reporting-threshold, pH-unit and categorical-label choices from the original source and the documented receiver fields. It supplies the exact preview/save commands, immutable plan and review identities, and the configuration for the same complete browser receiving operation. Use its [input and member descriptor](./examples/potomac-complete-receiving/carrier.json) to select and verify the full packet before receiving it into the original project.
