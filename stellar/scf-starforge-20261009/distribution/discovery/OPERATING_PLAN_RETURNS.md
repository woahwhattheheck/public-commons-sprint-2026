# Review returned operating procedures

A returned-procedure review brings another operator’s saved work back into the original customer procedure. It retains the complete current and returned histories, finds their last identical saved revision, and compares the work that each operator changed. The reviewed result remains a complete ordinary operating plan.

Open **Returned procedures** from Operating plans. Use this when a receiving team has returned results, corrected instructions, added work or changed its operating order while the original team continued editing. The original Operating plans workspace remains the place to perform detailed procedure editing and record later work.

## Receive returned work in the browser

Start the original Command finder at the customer’s usual browser address:

~~~sh
starforge discover serve --host 127.0.0.1 --port 8846
~~~

Open **Operating plans**, then **Returned procedures**.

1. Select the **Current saved procedure** and choose **Use saved procedure**, or load its complete plan JSON. This selects the original work to continue.
2. Load the receiving operator’s complete returned plan JSON. Both files keep every saved revision and complete registration selection.
3. Choose **Prepare comparison**. Enter the reviewing operator and the receiving instructions or overall review notes.
4. Review the changed fields, complete steps and operating order. Each change shows its shared saved value, current value and returned value.
5. Choose the current, returned or shared value, or enter a reviewed custom value. Record a decision note where it helps the next operator understand the choice, then choose **Record this choice**.
6. Review the complete proposed procedure. Resolve the remaining conflicts and correct any invalid values.
7. Choose **Complete review and save procedure** when the current source came from this browser’s saved plans. For a current file, choose **Complete review and download plan**.

Saving into the original workspace retains its plan identity and existing history. The complete review and intended result are saved first; a transaction then reads the actual saved plan and compares it with the review’s retained current source before receiving the result. Working drafts in other Operating plans tabs remain available. A later save from one of those drafts uses the existing revision-conflict handling.

If the original procedure advanced during review, choose **Compare with latest saved procedure**. The previous review, decisions and unfinished editors stay in **Retained reviews**. The new comparison starts from the actual latest saved plan and the complete returned source. When continuing from files, select the latest current file and prepare another comparison.

## Understand the comparison

| Changed work | Review behavior |
| --- | --- |
| One operator changed a field | Proposes that operator’s value |
| Both operators made the same change | Proposes the shared changed value |
| Both changed a field differently | Requires an explicit choice |
| One operator added a step | Proposes its complete original step |
| Both added the same step ID differently | Reviews the complete colliding step |
| One deleted a step that the other edited | Requires a complete-step choice |
| Registration or command arguments changed | Reviews the complete selection and argument array together |
| Progress or recorded result changed | Reviews status and recorded result together |
| One changed the work while the other changed its progress or result | Requires review of the complete step |
| The two operating orders changed differently | Requires review of the complete final sequence |

The comparison uses stable step IDs. A registration choice retains its original package, source records and declared runtime groups. Text, arguments and source selections remain complete; the model does not reduce long instructions or retain only a command name.

The complete-step review for crossed work and results matters in ordinary receiving. A completed result for yesterday’s input file should not silently become the completion of a newly changed input or different instruction. Choose the returned step, retain the current step, or enter the complete reviewed combination explicitly.

A custom scalar text field is entered as ordinary text in the browser. A custom step, command choice, progress choice or order is entered as JSON. A complete-step value keeps its original stable ID. Use null to remove that step.

### Final operating order

Each order choice shows the complete proposed sequence. A source order retains its listed positions, filters out work deliberately excluded in the review, and places other included steps at the end. Choose a custom JSON array to place them elsewhere.

Every included stable step ID appears once in a custom order. An empty procedure uses [].

Restoring a step absent from the proposed source order requires an explicit order choice. A recorded source-order choice retains the exact sequence that was reviewed. If a later inclusion decision changes that sequence, the review asks for the order to be chosen again. The previous reviewed sequence remains visible.

### Histories and copies

The comparison base is the longest identical prefix of complete saved revisions. Different first saved revisions have no shared original history for this operation.

The sources may have the same plan identity, or the returned source may be a direct copy made from the original plan. A copy made after the receiving operator’s branch had already diverged is supported: its recorded copy-origin revision is retained, while the actual comparison still uses the identical saved prefix.

A divergent return appends the reviewed body through the original operating-plan saver. Every current saved revision stays unchanged. The returned branch’s intermediate revisions remain complete in the review document alongside the decisions and selected result.

When the returned source is an unchanged forward extension of the same original history, accepting its final content uses the original plan receiver. That retains all intermediate returned revisions in the resulting plan. Choosing a custom body instead produces the reviewed continuation from the current history.

When the selected body equals the current body, completion keeps the same plan without adding an empty revision.

## Retain and resume the review

The page saves each working review in IndexedDB at the Command finder listener’s browser origin. Use the same browser, profile, host spelling and port to reopen it.

**Retained reviews** keeps independent reviews, including multiple imported documents with the same original review ID. Opening or importing another review retains the work already open. Imported review files become their own local working records.

If two tabs edit the same retained review, each save compares the stored version inside the review transaction. A later conflicting save retains both working copies separately, including their unfinished editors. The original procedure still uses its separate saved-history comparison before receiving a completed result.

The browser retains unfinished custom JSON, decision notes and review details while editing. These buffers are separate from recorded review choices. Choose **Record this choice** to apply a buffer to the comparison, or **Discard pending edits** to return to its recorded choice.

| Export | Contents |
| --- | --- |
| Working review JSON | Complete review, unfinished choice editors and current review-detail text |
| Complete editable review JSON | Both complete original histories, recorded choices, reviewer and notes, plus the completed result when available |
| Readable review HTML | Full source comparisons, decisions, contextual issues, proposed choices and the complete editable review |
| Reviewed operating plan JSON | The completed result in the original plan format |

Complete editable review JSON and readable HTML use recorded choices. Record pending choice edits first, or download the working review to retain unfinished work exactly as it stands.

A completed review is immutable. Its result is recomputed from the retained sources, decisions and saved completion time whenever it is opened. Later customer work belongs in the original plan or a new return review.

### Interrupted receiving

The complete intended result is retained before the browser writes the original plan. Reopening a completed review offers **Resume save to Operating plans**.

The receiver recognizes the exact result, or a later saved history that contains that entire result, and preserves the current later work. A repeat save adds zero revisions. If the destination instead contains different work, the completed review remains available and the latest source can be compared separately.

Keep the complete editable review with the reviewed plan in the customer’s normal handover files. The ordinary plan lets existing receivers continue the work; the review preserves the returned branch and the operator’s decisions.

## Installed command workflow

The installed command uses the same pure model as the browser:

~~~sh
starforge discover plan-return --help

starforge discover plan-return prepare \
  --current /absolute/customer/current-procedure.json \
  --incoming /absolute/receiving/returned-procedure.json \
  --reviewer "Customer operations" \
  --out /absolute/customer/return-review.json

starforge discover plan-return show \
  --file /absolute/customer/return-review.json \
  --out /absolute/customer/return-comparison.json
~~~

The comparison lists each exact change key, the three source values, the proposed choice and remaining issues. Use those displayed keys to record a decision:

~~~sh
starforge discover plan-return decide \
  --file /absolute/customer/return-review.json \
  --key /title \
  --take incoming \
  --note "Use the receiving team's name for this reporting period." \
  --out /absolute/customer/return-review-2.json
~~~

Keys under /steps identify the original stable step. A custom value file contains a JSON value, including JSON quotes around a scalar string. A custom complete step includes all original operating-step fields and its stable ID.

~~~sh
starforge discover plan-return decide \
  --file /absolute/customer/return-review-2.json \
  --key /steps/@order \
  --take custom \
  --value-file /absolute/customer/reviewed-order.json \
  --note-file /absolute/customer/order-receiving-note.txt \
  --out /absolute/customer/return-review-3.json
~~~

The displayed comparison determines whether a key exists. Use the actual selected review’s keys and stable IDs. To remove an explicit choice, use --take automatic.

Update the reviewing operator or overall notes through the same complete file:

~~~sh
starforge discover plan-return details \
  --file /absolute/customer/return-review-3.json \
  --notes-file /absolute/customer/receiving-instructions.txt \
  --out /absolute/customer/return-review-4.json
~~~

Complete against the actual current complete plan, then extract the original-format result and readable handover:

~~~sh
starforge discover plan-return complete \
  --file /absolute/customer/return-review-4.json \
  --current /absolute/customer/current-procedure.json \
  --out /absolute/customer/completed-return-review.json

starforge discover plan-return export \
  --file /absolute/customer/completed-return-review.json \
  --format plan \
  --out /absolute/customer/reviewed-procedure.json

starforge discover plan-return export \
  --file /absolute/customer/completed-return-review.json \
  --format html \
  --out /absolute/customer/returned-work.html
~~~

Every output is created exclusively through the original synced-file writer. Each command retains the full preceding file and writes a new result. Complete plan inputs are limited to 32 MiB each; complete review JSON is limited to 128 MiB. JSON input uses strict UTF-8 decoding.

The complete operation writes one review document containing both original histories, choices and its exact result. Exporting a separate plan afterward is repeatable. Existing Operating plans and Grant Operations receiving can read that extracted original-format plan; retain the complete review as its accompanying source.

## Application API and destination integration

~~~js
import {
  createOperatingPlanReturn,
  compareOperatingPlanReturn,
  decideOperatingPlanReturn,
  applyOperatingPlanReturn,
  inspectOperatingPlanReturn,
} from '@tokenjunkielabs/starforge-merchant/operator/operating-plan-returns';

let review = createOperatingPlanReturn(currentPlan, returnedPlan, {
  id: crypto.randomUUID(),
  reviewer: 'Customer operations',
  notes: 'Continue the original reporting period.',
});

const comparison = compareOperatingPlanReturn(review);
// Display the actual comparison rows and record the operator's choices.
review = decideOperatingPlanReturn(review, selectedChangeKey, {
  take: 'incoming',
  note: 'Use the returned correction for this selected change.',
});

const completed = applyOperatingPlanReturn(review, { current: currentPlan });
await persistCompleteReview(completed.review);

// In the destination's original transaction, read the actual current plan.
const received = applyOperatingPlanReturn(completed.review, {
  current: actualCurrentPlan,
});
if (!received.alreadyPresent) await saveOriginalPlan(received.plan);
~~~

The selectedChangeKey and destination functions above belong to the host application. The complete reviewed source should be retained before its existing plan transaction. The browser implementation supplies this ordering directly.

The result exposes:

- review: the complete immutable review and original-format result.
- plan: the result to receive, or the actual later plan when it already contains that result.
- alreadyPresent: whether the destination already includes the entire reviewed result.
- addedRevisions: zero on replay; otherwise the revisions this receiving operation adds.
- reviewedRevisions: the result’s revision increase from the review’s retained original current history.

All returned values are independent JSON values. Import validates the complete histories and recomputes a completed result before accepting it. The original operating-plan schema and reader remain unchanged.

The maintained operator-discovery contribution registers the typed API. Its existing command delegates plan-return to the complete CLI, and its browser asset map carries the page, pure model and original dependencies into selected toolkit builds.


## Keep complete customer result files through a return

When either procedure carries attached result files, the review compares each step's complete ordered file collection. A file choice retains every original byte, name, media type and note. Compatible one-branch file changes travel with the resulting step; divergent file changes require an explicit current, incoming, shared or custom complete collection choice. A custom collection uses the original Operating Plans file format and limits.

File changes are recorded results. When one branch changes the work and the other changes its files, the review requires a complete contextual step choice, just as it does for changed progress or recorded result text. Read the whole work and result before carrying those files onto different instructions.

The complete review JSON retains both original file histories, decisions and the exact completed result. The grant submission receiving desk accepts that completed review directly and keeps its branches, file bytes and decisions with the original planning preparation. Use the original grant procedure guide for full draft receiving and later review export.


## Editable offline review workbook

Use **Download editable workbook** in Returned procedures to hand another operator one complete HTML file. The file includes the maintained review editor, its original plan and return models, the full guide, both entire source histories, recorded decisions and every attached file byte. It opens directly from disk without the installed listener or a network connection.

The workbook also carries current reviewer text, receiving notes, decision notes and unfinished custom JSON exactly as typed. A custom choice does not have to be valid yet to download or reopen the work. **Working review JSON** keeps that same complete portable working state; **Complete editable review JSON** exports the recorded, valid review after pending choices have been recorded or discarded.

### One complete handover

1. Prepare or reopen the original return review. Compare both histories and enter the reviewing operator and any initial decisions.
2. Download the editable workbook. Send that whole HTML file through the existing handover.
3. The recipient opens the file in a modern browser, reviews the original comparison and records each intended choice. Complete attached bytes remain in both source branches and in the selected full-file decisions.
4. Before moving to another browser or sending unfinished work onward, choose **Download editable workbook** again. This produces a new full file with current working text and decisions. Browsers do not overwrite the original opened HTML.
5. Complete the review and download **Complete editable review JSON**. Return that full JSON document to the original operator. Its reviewed operating-plan JSON is also available in the original format.
6. The original operator receives the result against their current complete procedure or receives the completed review in the original Grant Operations desk. That existing receiver checks current history and preserves the full review. Later local work remains part of the receiving comparison.

A completed review remains immutable inside its workbook. Prepare another review from the actual later complete procedure to review new changes.

### Local recovery and separate copies

Offline workbooks use their own browser review store. They do not open or write the installed Operating plans database. The destination is always a complete file handover.

When browser storage is available, reopening the same workbook resumes the latest locally retained work for that workbook identity. Retained reviews keeps other saved copies. The original editor's compare-and-save version check preserves a second tab's divergent work as a separate copy rather than overwriting the first.

Some browsers decline persistent storage for files. The workbook remains editable in that tab and clearly labels its current state. Download the updated workbook or Working review JSON before closing. The page warns about undownloaded work when local storage is unavailable. The workbook's **Download the original embedded working review** button also recovers the exact initial portable data if its editor cannot start.

A newly downloaded workbook receives its own workbook identity while preserving the original review identity and both complete histories. Its initial data is the exact working state at download time, so it can move independently of another browser's local storage.

### Original CLI and typed API

The installed CLI packages the same maintained sources and uses the existing create-only output writer:

```sh
starforge discover plan-return export --file review.json --format workbook --out review-workbook.html
starforge discover plan-return export --file review-working.json --format workbook --out review-workbook-next.html
```

Only workbook export accepts the working-review envelope. Other CLI actions keep their existing complete-review validation. A reviewed plan or full completed review is returned through the original prepare/show/decide/complete/export course.

The typed export `./operator/operating-plan-returns/workbook` provides:

- `inspectOperatingReturnWorking(value)` to validate and normalize a complete review or original working-review envelope.
- `OPERATING_RETURN_WORKBOOK_ASSETS` to identify the exact eight maintained application source files and installed browser routes.
- `renderOperatingReturnWorkbook(value, sources, { id? })` to generate one self-contained editable HTML file from complete trusted application sources.

The source map contains `catalog`, `plan`, `review`, `workbook`, `editor`, `html`, `css` and `guide`. Supply complete source text from one maintained installed edition. The editor, CLI and packager reuse the original return model's comparison and completion interpretation; packaging does not change or recompute a saved review under a different format.

### Complete file boundaries

Each source plan keeps its original 32 MiB limit. The full review keeps its 128 MiB limit. Working review JSON allows 192 MiB to retain complete pending text, and the resulting single HTML workbook allows 256 MiB including original application sources and JSON escaping. Application source files are limited to 4 MiB each.

The offline document embeds complete application sources and portable data using escaped JSON. Its original modules load from local Blob URLs. The document's content policy disables network connections, forms and external resource loading. Imported procedure text and file bytes remain data interpreted by the original models. The included guide and review text are rendered as text.

The complete file can contain customer material and attachments from both branches, including work that is not selected for the final procedure. Send it through the same authorized customer handover as the original complete review.
