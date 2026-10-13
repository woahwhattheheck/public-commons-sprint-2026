# Customer task outcomes

Open **Grant planning and delivery → Delivery operations → Customer task outcomes**
to compare a customer's prior method with the complete installed task. The
comparison keeps the source population, selected period, useful result, quality,
active effort, corrections, receiving work and costs together.

The browser, **starforge grant-workspace operations**, typed
**GrantWorkspaceClient** and Merchant tools operate the same original Grant
Operations case. A saved comparison is an immutable native source edition.
The existing complete case exporter carries every edition, selected attachment,
original installation, business record and event.

## 1. Select the complete task

Open the original case and record its current version. Select **New comparison**,
enter the customer or receiving team, name the useful task and describe what
counts as a completed task. Keep one stable unit, such as a complete monthly
report or an accepted full data edition.

Select an original customer Installation edition when one exists. It remains
pinned to the chosen revision; a later installation edit does not change an older
comparison. Select the original deployments or purchase observations that
belong to this task. The comparison records those original rows without changing
their payment, fulfillment or lifecycle states.

For each method, retain:

| Field | Meaning |
| --- | --- |
| Method and measurement basis | Prior or installed method; observed, estimated, mixed or unrecorded inputs. |
| Observation time | The original ISO timestamp with its timezone. |
| Source edition or query | The exact source used for this task. |
| Whole population and selection | Which rows, files, accounts, places or other units the work covers. |
| Period | Original report period, source window and meaningful duration. |
| Complete output | What the receiver actually obtains and uses. |
| Quality and exceptions | Acceptance conditions, corrections and remaining exceptions. |
| Attempted and completed tasks | Whole task counts under the stated acceptance criteria. |
| Elapsed minutes | One clock for the whole operation, including overlap and waiting. |
| Sources and notes | Existing original case attachments and the method used to obtain the measurements. |

Use **Attach original sources** to open the case's existing Sources section.
Return to Customer task outcomes to continue its retained draft. Existing source
IDs and complete bytes remain with the original case.

## 2. Enter all work and costs

Record active effort in **person-minutes**. Two people working for 30 minutes
contribute 60 person-minutes. Add the actual acquisition, processing, correction
and receiving work. Use stable row IDs so an edited edition can be compared
with its predecessor.

Enter one hourly labour rate for each row if valuing that effort. All rates and
other costs use the selected currency or asset code. Record the rate basis and
original cost references in the row notes. Conversion between currencies belongs
in the original financial workflow; this comparison has one explicit currency.

The calculation is:

- Active effort = sum of the complete effort rows' person-minutes.
- Labour cost = sum of person-minutes × hourly rate ÷ 60.
- Total cost = labour cost + the complete selected non-labour cost rows.
- Per-task effort or cost = the complete method total ÷ its completed tasks.
- Difference = prior method − installed method.
- Percentage difference = difference ÷ prior method × 100, when the prior
  value is positive.

Input decimals remain exact strings with at most six decimal places. Derived
amounts use six decimal places and are presented without unnecessary trailing
zeroes. Zero is a known value. A blank measurement or rate remains unknown.
Known partial effort and cost stay in the full report alongside missing row IDs;
a missing value does not become a zero total.

An empty effort list leaves active effort and labour cost unknown. An empty
other-cost list declares no additional non-labour costs in the selected method.
Enter an explicit incomplete row when an expected cost is still unknown.

Elapsed time is recorded once for the whole operation. The application does not
sum step elapsed times, because steps may overlap. Active person-time can exceed
elapsed time when several people work together.

## 3. Review comparability and save editions

Describe the relationship between the two complete task scopes. The report shows
changes in source, population, period, output and quality. Select **Comparable**
only when the methods can support the intended comparison, and explain any
material differences. **Not comparable** retains both methods and the reasons
without presenting a customer savings difference.

The report requires both complete scope descriptions and the explicit
comparability explanation before calculating savings. If completed task counts
differ, it presents the per-completed-task comparison and leaves the total
comparison open. Prior values of zero retain a difference and an unknown
percentage. A positive difference means lower installed-method effort or cost.

Choose **Draft** for retained work in progress. Choose **Reviewed** when the
comparability decision, its reason and customer conclusion are ready. The
recording operator and save note are kept with that edition. Review items remain
visible in either state.

1. Choose **Review complete comparison**.
2. Inspect full scope changes, effort, all cost rows and the review items.
3. Choose **Save reviewed edition**.
4. Open the saved edition and its original source selection.
5. Use the revision selector to inspect earlier complete editions.

Editing a saved edition creates the next revision. An existing unfinished draft
is reopened intact. **New comparison from this edition** retains the complete
method inputs under a new comparison ID and resets the comparability decision
for a new review.

A stale case or comparison revision requires a fresh read. **Reconcile current
case / revision** preserves the complete draft and displays the newer saved
document. Review that document before explicitly choosing its revision as the
new save base. Then preview the intended result again.

## 4. Browser recovery and input interchange

The editor retains drafts separately by comparison identity in the browser
session. Reading another comparison or visiting another case section preserves
unfinished input. The same Application port and browser session recover that
state after reopening.

A save records its exact original request before dispatch. If its response is
interrupted, **Recover original save** repeats that request. A completed native
request returns the original result. The editor clears only the submitted draft
that still matches those inputs; any later writing remains retained.

**Download complete input** produces the exact input object accepted by the CLI
and client preview. **Import draft input** opens that complete object for
editing. Importing identical input preserves its current save note and original
revision label. A recovery that conflicts with the current draft or note leaves
all existing writing intact for reconciliation.

**Download editor recovery** retains every unfinished input, full save note,
original revision label, selected draft and pending request. Recover a pending save in its original case before moving that
editor recovery. A receiving copy can import a completed recovery when its
original case binding and pinned plan match. Save a Draft edition when work
needs to travel through the full operating-case handover.

If browser storage reaches its capacity, the editor displays the actual storage
failure and keeps the in-memory input available for a recovery download or a
native Draft save.

## 5. Complete command-line workflow

These commands use the original workspace owner. Stop an owning browser service
before opening the same SQLite workspace with the headless CLI. A client that
borrows the running Application uses the typed client or Merchant tools below.

Prepare the input from the current original case:

~~~sh
starforge grant-workspace operations task-outcomes-seed \
  --workspace /absolute/private/grant \
  --case ORIGINAL_CASE_ID --expected-version CURRENT_CASE_VERSION \
  --output /absolute/working/customer-task-inputs.json
~~~

Edit the entire input file. Its shape is:

~~~json
{
  "id": "task-outcomes-ORIGINAL_32_HEX_DIGITS",
  "expectedRevision": 0,
  "document": {
    "title": "Customer task comparison",
    "customer": "Actual receiving team",
    "task": "Complete useful task and acceptance",
    "unit": "complete task",
    "currency": "USD",
    "installation": null,
    "deploymentIds": [],
    "purchaseIds": [],
    "baseline": {},
    "installed": {},
    "comparison": {"decision": "UNREVIEWED", "reason": ""},
    "status": "DRAFT",
    "conclusion": ""
  }
}
~~~

The empty method objects above show the outer structure. The seed contains every
actual method field; keep those complete objects when editing. Optional unknown
numeric fields use null. Each effort row has id, label, category, personMinutes,
hourlyRate and notes. Each other-cost row has id, label, amount and notes.
The complete method contract is in section 1 and the typed declarations.

~~~sh
starforge grant-workspace operations task-outcomes-preview \
  --workspace /absolute/private/grant \
  --case ORIGINAL_CASE_ID --expected-version CURRENT_CASE_VERSION \
  --inputs /absolute/working/customer-task-inputs.json \
  --output /absolute/working/customer-task-preview.json

starforge grant-workspace operations task-outcomes-save \
  --workspace /absolute/private/grant \
  --case ORIGINAL_CASE_ID --expected-version CURRENT_CASE_VERSION \
  --inputs /absolute/working/customer-task-inputs.json \
  --expected-preview-sha256 ORIGINAL_PREVIEW_SHA256 \
  --actor "Recording operator" --note "Complete customer scope review" \
  --request-id ORIGINAL_SAVE_REQUEST \
  --output /absolute/working/customer-task-save.json
~~~

Use the saved comparison ID, revision and case version returned by the original
save. For a later edition:

~~~sh
starforge grant-workspace operations task-outcomes-show \
  --workspace /absolute/private/grant --case ORIGINAL_CASE_ID \
  --comparison ORIGINAL_COMPARISON_ID --revision SAVED_REVISION \
  --inputs-only --output /absolute/working/next-task-inputs.json
~~~

The complete document comes from the selected historical edition. Its
expectedRevision is the current saved head, so the next save follows that head
after review. The selected earlier edition remains unchanged.

List and inspect complete work with **task-outcomes** and
**task-outcomes-show**. All original history is included in the latter response.

## 6. Typed client and Merchant tools

The installed GrantWorkspaceClient supplies:

| Method | Input or result |
| --- | --- |
| read('task-outcomes', {caseId}) | Saved comparison heads. |
| read('task-outcome', {caseId, comparisonId, revision?}) | Complete selected edition, source and history. |
| taskOutcomesSeed(caseId, expectedVersion) | Complete editable /inputs and current case binding. |
| taskOutcomesPreview(caseId, {expectedVersion, inputs}) | Native normalized input, full report, source and preview SHA. |
| taskOutcomesSave(caseId, body) | Original case transaction and retained edition receipt. |
| download('task-outcomes', {caseId, comparisonId, revision, expectedVersion}) | Complete case and selected customer report ZIP. |

The save body contains expectedVersion, requestId, actor, optional note, inputs
and expectedPreviewSha256. The complete typed document, measurement rows,
calculation, source snapshot and result are declared beside the existing client.

Merchant clients use **merchant_grant_task_outcomes**,
**merchant_grant_task_outcome**, **merchant_grant_task_outcomes_seed**,
**merchant_grant_task_outcomes_preview** and
**merchant_grant_task_outcomes_save**. Seed, preview and save use the same original
case selection. Preview and save accept the complete inputs inline or through
the existing verified input-file/snapshot transfer; inputPointer can select
/inputs from the original seed.

Use **merchant_grant_export** with kind task-outcomes, the original caseId,
comparisonId, revision and current expectedVersion. Original row paging and
complete byte transfer retain the full reports and source payloads.

## 7. Export, receive and continue

From a saved browser edition, choose **Export complete case and report**, or use:

~~~sh
starforge grant-workspace operations task-outcomes-export \
  --workspace /absolute/private/grant --case ORIGINAL_CASE_ID \
  --comparison ORIGINAL_COMPARISON_ID --revision SAVED_REVISION \
  --expected-version CURRENT_CASE_VERSION \
  --output /absolute/delivery/customer-task-complete.zip
~~~

This is a native complete operating-case ZIP. It includes the full original
planning package, original case records and source files, every saved comparison
edition, all source/review history, the selected comparison identity, a complete
offline HTML report and every effort/cost CSV row.

Receive it through the existing case importer:

~~~sh
starforge grant-workspace operations import \
  --workspace /absolute/private/receiving-grant \
  --file /absolute/delivery/customer-task-complete.zip \
  --name "Received customer task comparison" \
  --actor "Receiving operator" --request-id ORIGINAL_RECEIVING_REQUEST
~~~

The importer validates the complete native archive, comparison source bytes,
all revision links, original save events, selected attachment and historical
record bindings, installation edition and derived reports before receiving.
The receiving case gets its native destination ID; the original comparison,
source, deployment and purchase IDs remain retained. The browser opens the
selected comparison after import. Another operator can read the full history,
edit the next edition and export the complete resulting case.

The existing native bounds apply: 8 MiB per original source, 24 MiB / 200 source
files per case and a 32 MiB complete case archive. Each method supports up to
100 complete effort rows and 100 other-cost rows. The original case source
inventory remains visible as editions accumulate.


## 8. Continue recurring customer outcomes

Use **Edit this edition → Add recurring observation** to record the next useful
customer task in the same comparison. Keep the original baseline, task unit and
initial installed method. Each recurring observation has its own stable identity,
complete measurement method, source selection, scope decision, operator review,
customer response and conclusion.

The editor starts a new observation with unknown quantities and an unrecorded
measurement basis. It keeps the installed method's name, while requiring the
new period, source edition, population, output and quality to be entered for that
actual run. Earlier measurements and customer responses are not copied into a
new observation.

1. Name the observation and record the original observation time, including its
   timezone and any fractional seconds.
2. Select its original deployments and purchase observations. Attach any new
   source through the existing Sources section, then select those original
   attachments in this observation.
3. Describe the complete work unit and population, actual source edition,
   reporting period, received output and quality. A later period may be
   comparable, but the reviewer must explain that relationship explicitly.
4. Enter active effort and correction/receiving work separately from whole-task
   elapsed time. Browser session length, waiting time and agent or tool runtime
   do not establish human person-minutes.
5. Enter an hourly valuation only when its actual source is supplied. An
   unvalued observation can still be reviewed and accepted. Missing valuations
   remain unknown, while effort, completed output and quality remain visible.
6. Make this observation's own baseline comparability decision and record its
   customer outcome. Choose Reviewed only after the scope explanation and
   conclusion are ready.
7. Record the actual customer response separately: Pending, Accepted or
   Declined. An acceptance or decline requires the actual receiving reviewer,
   original response timestamp and response/source note. Select the original
   response attachment where it is available.
8. Review the complete comparison and save through the same original case
   transaction. Open the saved edition, inspect its recurring overview and
   export the complete case and report.

The recurring directory shows every observation, review and customer response.
Choose **Open observation** to edit or read one complete observation at a time;
its full baseline comparison appears below. This keeps long histories usable
without loading every observation's editable work rows together. All observations
remain in the saved source and complete export. Editor recovery retains the
selected observation as well as every unfinished input.

**Accepted comparable observed** counts observations with all of the following:
a Reviewed scope, a complete comparable baseline decision, OBSERVED measurement
basis for both the baseline and recurring method, an original observation time,
a positive completed-task count, and an Accepted customer response. Its dates
are those observations' actual measurement dates in UTC. This count alone does
not establish effort or monetary savings.

Every recurring report compares against the same baseline in that selected
edition. It retains material scope differences and the complete original
measurements. Total effort/cost and elapsed differences require the same
positive completed-task count; per-task calculations retain the existing
explicit comparability rule. Whole-operation elapsed differences stay separate
from active effort. The application presents each observation individually and
does not sum overlapping work or extrapolate an annual savings figure.

### Corrections and complete history

A saved observation remains in later editions of the same comparison. Correct
its method, scope decision, customer response or conclusion and save the next
complete edition with a clear note. The earlier full source stays available
through the original revision selector. An observation added in the current
editor can be removed before its first save.

A historical edition may predate later recurring observations. When continuing
that older edition, reconcile the current saved document and retain its complete
observation list before saving. The native writer requires all already saved
observation identities; receiving validates that continuity through the entire
source chain.

**New comparison from this edition** creates a separate comparison identity.
It retains the method inputs for review but resets recurring operator decisions,
conclusions and customer responses to Draft / Unreviewed / Pending. It does not
carry an accepted customer decision into the new comparison.

### Existing input, client and export contracts

The complete input adds one optional field, `document.followups`. Older inputs
omit it and continue to normalize, calculate, export and receive identically.
The existing seed, preview, save, typed client and Merchant tools accept the
same complete input object. No additional source store or command is used.

Each observation contains:

~~~json
{
  "id": "observation-ORIGINAL_STABLE_ID",
  "label": "Next complete customer task",
  "method": {},
  "comparison": {"decision": "UNREVIEWED", "reason": ""},
  "status": "DRAFT",
  "conclusion": "",
  "acceptance": {"status": "PENDING", "by": "", "at": null, "note": ""},
  "deploymentIds": [],
  "purchaseIds": []
}
~~~

Use the complete existing method shape for `method`, including every scope
field, measurement, source ID and effort/cost row. At most 100 observations
belong to one comparison. Their IDs are unique and stable.

The original source snapshot includes the union of the baseline, initial
installed and recurring attachments, deployments and purchases. Each observation
retains its individual selection. Historical receiving checks the full selected
attachment bytes and the original business records before their save events.

The existing offline HTML includes the recurring overview, every full method,
scope difference, calculation, actual customer response, review item and
original selection. The original effort/cost CSVs include all recurring rows,
identified by `method=followup:ORIGINAL_OBSERVATION_ID`. Their columns are
unchanged. Complete JSON source editions retain the raw observation and
calculated report. The same selected-case ZIP therefore reopens the original
comparison and all its recurring history for the next facilitator.

## Source

- operations_task_outcomes.py — one normalized model, exact calculation,
  retained source editions and full receiving validation.
- operations_task_outcomes.mjs and operations_task_outcomes.css — complete
  industrial editor, reports and original-request recovery.
- operations.py, operations_http.py and operations_cli.py — original case
  transaction, selected native export and browser/command adapters.
- agent-client.mjs / agent-client.d.mts and Merchant grant provider/catalog —
  original installed client and full input/output transfer.

## Editable customer measurement workbook

Use the complete [Customer measurement workbook](TASK_OUTCOMES_WORKBOOK.md) from the same comparison desk to prepare editable XLSX measurements, review returned cells and reconcile concurrent desk changes. Its source attachment and pending request remain in the original case. Apply the reviewed measurements to the current draft, then calculate and save through this guide’s original comparison workflow. The whole editor recovery retains unfinished workbook reviews and choices.
