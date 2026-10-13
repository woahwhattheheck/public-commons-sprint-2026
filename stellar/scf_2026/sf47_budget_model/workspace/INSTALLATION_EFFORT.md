# Installation effort and support

Review recorded Work against the original customer phases, retain an explicit remaining-work estimate, and carry the reviewed hours into the existing Forecast and Portfolio. The complete review lives in the saved Installation edition alongside its original source, observations and delivery assignments.

Named lead, finance and reviewer profiles can prepare the original effort source and remaining-work selection for their assigned cases. These requests read the current case and prepare inputs; they do not save an Installation or Forecast. Installation editions keep the existing lead/owner save permissions, and Forecast saves retain the original role, case and named-operator checks.

## Start with the original work

Open the saved customer Installation from Delivery and cash operations. Its selected Workshare supplies the customer, original quote, complete phase list, phase owners and dependencies, and delivery and support terms. Keep that complete source attached when reviewing effort. The stable phase and native Work identities let a later review identify the same work after an Installation edition changes.

Record actual time in Work, or receive the original timesheet through the existing Work / invoice intake or Bulk ledger intake. A work record identifies the contributor, actual start and end dates, positive hours, funding basis, optional original work-package ID, and its source. Intake-created work opens in Logged. Continue its submission and acceptance through the original Work controls.

When the same work appears in another export, use the existing intake's explicit matching and correction choices. Reusing an exact original record preserves one native Work identity. Separate work retains the recording reason and its own original record. The phase review should select those native identities after the original intake has finished.

## Accepted quotations and commercial delivery tasks

A saved Installation received from an accepted SF74 quotation uses the same
Work allocation, remaining-estimate review and saved-edition workflow. Open
**Read current work and tasks** on that original commercial Installation. The
source identifies the original case and quotation family, exact quotation and
recorded customer response, accepted scope, task definitions and source file.
Every displayed task retains its original task ID, definition digest and
Installation check; the report uses these IDs in the existing phaseId fields.

Record or receive time in the original Work desk, then assign its actual
quantities to those accepted tasks. Review each task's remaining effort, save
the complete Installation edition, and reopen that exact saved edition. The
same cross-Installation allocation checks prevent counting one native Work
record beyond its current recorded hours. Work state, customer check acceptance,
invoices and cash observations keep their original separate meanings.

An accepted quotation's fee, line quantity or delivery window does not establish
its task effort. For commercial Installations the native report therefore sets
quotedHours, quoteBalanceHours, recordedOverrunHours and projectedOverrunHours to
null. Recorded hours, internally accepted hours, explicitly reviewed remaining
hours and projected total hours are still reported. The comparison to an
operator's planning estimate uses an explicitly selected sealed private quote
assessment; it does not relabel that estimate as a customer-agreed hour budget.
Blank or unavailable costs remain unknown, and a planning hourly valuation is
separate from actual contributor cash cost.

The native effort seed's phaseSource has sourceKind COMMERCIAL and the full
accepted scope under scope. Its commercial identity contains caseId, caseKey,
quoteId, quoteSha256, acceptanceId, acceptanceSha256, scopeSha256, sourceId and
sourceSha256. The same identity and sourceKind are inside the saved effort
report and covered by reportSha256. Existing Workshare source/report fields
and meanings remain compatible.

A later accepted quotation edition continues through the original commercial
Installation review. Changed task or source identity invalidates its prior
remaining-work basis and requires a current review. Original task attributions
remain attached to the stable task ID. Removed tasks with retained allocations
or estimates remain visible with their complete earlier task definition,
check observation and quotation/source identity. Retain or reduce an earlier
task's allocation; assign new work only to the current accepted task scope.
An unrecognized task cannot be introduced through an effort input.

Commercial implementation tasks do not define Workshare support phases. Their
supportWindows array remains empty. Keep recurring care terms, service response
commitments and renewals in the original Merchant service workflow; do not
infer a task allowance, support calendar or acceptance anchor from a monthly
price. The Workshare support controls below continue to use their explicit
original phase/hour/calendar meanings.

Use the same installation-effort-seed, installation-preview, installation-save,
installation-show and installation-export commands described below. The exported
installation-effort.json is regenerated from the selected saved snapshot, and
the original full-case receiver validates it together with every original Work
record, quotation attachment and Installation edition. A report JSON alone is
not a substitute for that complete source and history when continuing the work.

The existing remaining-work Forecast selection binds a Workshare case/source
to its original commercial planning row. It does not guess a matching Forecast
row from an accepted quotation title or amount. Use the explicitly selected
commercial effort handoff to compare a commercial Installation with its exact
SF74 quotation and private assessment.

## Prepare the complete effort review

Select **Read current work and phases** for the current saved Installation and an explicit as-of date. The result includes the complete editable Installation document, the source phases, current Work inventory, allocations retained in other saved Installations and the effort report. A same-edition draft keeps its edits while this source and work inventory are refreshed. The client and CLI use the case version and current Installation edition for the same operation.

Retain the full returned document. Its optional effort field uses schema `stellar-forge.sf47-installation-effort.v1` and contains:

| Field | Complete input |
| --- | --- |
| asOfDate | The selected civil review date. |
| allocations | Original Work ID, original phase ID, selected decimal hours, the Work content SHA256 and an allocation note. |
| reviews | Phase ID, explicit remaining hours or null, reviewer, review timestamp, basis SHA256, note and original source IDs. |
| supportWindows | Stable window ID, selected support phase IDs, included hours, anchor phase and kind, calendar-day length, source plan SHA256, original source pointers, reviewer, timestamp and note. |
| note | The basis for this complete effort review. |

Select **Add work allocation**, choose the Work record and source phase, and enter the hours assigned from that record. Review the other saved allocations before assigning the same hours again. Each allocation retains its native Work identity and content digest. If the original Work record has been corrected, **Use corrected work record** selects its current content for this review. The complete saved edition keeps the earlier allocation history.

Enter the remaining effort for each source phase and select **Apply reviewed remaining hours**. Keep the reviewer, observation timestamp, supporting source IDs and reason with the estimate. The native basis digest identifies the phase source and Work observations assessed in that review. A null remaining-hour value remains unentered. Explicit zero records the reviewer's estimate that the phase has no further work.

Select **Add support allowance** to record the included hours, covered phases and the event and period in the customer's terms. Choose the human-readable source values from **Original terms that define this allowance**. The document retains those selections as RFC6901-style paths into the complete Workshare plan, such as `/schedule/follow_on`, `/commercial/payment_terms` or `/phases/5/description`. The selected values are resolved and retained in the frozen report. The selected support phases retain their complete original quoted hours as the included allowance. The period and anchor are the operator's reviewed interpretation; keep its note with the source wording. sourcePlanSha256 pins the plan whose terms were reviewed. Reseeding keeps that binding until the operator reviews a changed source.

Select **Review complete installation** after editing, read the effort and support report, then **Save reviewed edition**. The existing save uses the case version, selected edition, original request ID and preview digest. It appends an edition and keeps the complete previous history.

## Read the source amounts and observations

| Value | Its source and use |
| --- | --- |
| Quoted phase effort | The selected complete Workshare's original scope estimate. |
| Recorded Work hours | The original contributor's dated work record, with its current native state and sources. |
| Accepted Work | The result of the original Work review lifecycle. |
| Installation check observation | The saved check's observing operator, timestamp and acceptance result. |
| Invoice amount | The original supplier invoice and its lines. A linked Work record belongs to that invoice's contributor. |
| Observed payment | The original cash record and its selected invoice allocation. |
| Remaining planning effort | An explicit current estimate supplied to the saved Forecast and Portfolio allocation. |
| Contributor availability | The selected agreement's dated resource availability and exceptions. |

Read these values together when reviewing an Installation. Retain the work state and source reference with every selected record so a correction can be traced to its original row. Keep the original funding basis and work-package assignment when commercial work and grant work share a contributor.

The Work and Invoice desks own corrections to their records. Work must be reopened before its recorded fields change after the Logged state. An invoice must be reopened before its source or amount changes after Received. Those original transitions remain visible in case history.

## Read the effort report

The effort seed returns the complete Installation report at /report and its effort section at /report/effort. A saved edition retains the same complete report under /preview/report/effort. The section contains the phase results, selected Work balances, support windows, findings and its native reportSha256.

| Report value | Meaning |
| --- | --- |
| quotedHours | The selected source phase's quoted effort. |
| allocatedHours | All hours attributed to that phase in the edited Installation. |
| recordedHours | Attributed, nonvoid Work whose whole recorded date span ends on or before the selected as-of date. |
| acceptedHours | The recorded subset whose native Work state is Accepted. |
| quoteBalanceHours | The positive difference between quoted and recorded hours. |
| remainingHours | The reviewer's explicit remaining-work estimate. |
| remainingReviewCurrent | The estimate uses the current phase and Work basis and its review date is on or before the as-of date. |
| projectedTotalHours | Recorded hours plus the current reviewed remaining estimate. |
| projectedOverrunHours | The positive difference between projected total effort and quoted effort. |

A quoted balance is a comparison with the scope estimate. Use the reviewed remaining value for planning. The full report also retains void, changed-source, after-as-of and boundary-spanning hours so the review can identify the records that need attention.

Each Work balance shows the amount allocated in this Installation, the amount allocated in other current saved Installations, total allocations, unallocated hours and any excess over the current Work quantity. Adding hours beyond that original quantity is rejected. If a source correction makes an existing allocation too large, the saved attribution remains available and can be reduced while the correction is reviewed.

Work dated entirely after the as-of date or spanning across it retains its whole original interval and hours. Resolve the reported date-span finding before using that effort for planning. A total over several dates supplies no daily breakdown to prorate automatically.

The report is Ready when its findings permit planning. Changed or void Work, excess allocation, unresolved date spans and missing current remaining-work reviews identify the affected record or phase. Review the current source, correct the allocation or estimate, and save the complete next Installation edition. Retain the existing Work records and case history through those corrections.

## Carry the complete support terms

Use the original scope's support phase and included effort, the event that starts its period, the period's unit and length, and the original response or handover wording. Preserve an explicit original source attachment or the source note with those terms.

Freeform's retained scope includes six support hours within fourteen calendar days after acceptance, with an original response term of two business days. Query.Farm's retained scope includes eight support hours across thirty calendar days after complete handoff. The commercial delivery boundary and subsequent support capacity are separate parts of each complete source plan.

Lutra's six-hour operator-handover phase belongs to commercial delivery. Its original scope also includes two remote operator sessions of up to one hour each. Retain those terms under their original phase and session meanings when selecting source pointers and reviewing an allowance.

A planning comparison can assume acceptance or handoff at the scheduled delivery boundary. Keep that assumption with the comparison's derived support deadline. The saved effort report anchors an actual window to the accepted check observation for the selected predecessor phase, retaining the civil date in that observation's declared timezone. The window end is that date plus the reviewed calendar-day period. Before an accepted observation is available, the report retains Awaiting original acceptance.

Each window shows recorded and accepted hours, the remaining included allowance, recorded overrun, current reviewed remaining effort and projected overrun. Its attribution rows separately identify work inside, before, after or spanning the window, together with void and unanchored work. A work span crossing a boundary remains a whole recorded interval for the operator to review.

When the original scope changes, the reviewed source plan and its terms remain attached to the allowance. Read the current source values, correct the allowance if its terms changed, and select **Use current support terms** to bind the reviewed successor. Earlier phases with saved allocations or reviews remain visible in the report. Move or remove their current allocations as appropriate and review the replacement phases. Keep conditional start requirements alongside any actual or planning date selection.

## Typed SDK: seed, save and reopen

Use the current GrantWorkspaceClient from [the agent guide](AGENT.md). The original managed connection and source selection are shared by all methods below.

~~~js
const caseId = selectedCaseId;
const current = (await client.read('case', {caseId})).value;
const edition = (await client.read('installation', {
  caseId,
  installationId: selectedInstallationId,
})).value;

const prepared = (await client.installationEffortSeed(caseId, {
  expectedVersion: current.program.version,
  installationId: edition.id,
  expectedRevision: edition.revision,
  asOfDate: selectedReviewDate,
  document: edition.preview.document,
})).value;
~~~

Use prepared.document as the complete editable input. Save that input to a private JSON file for the operator's phase allocations, remaining estimates and support terms. After review, read the whole edited document and retain the exact native save request before dispatch:

~~~js
import {readFile, writeFile} from 'node:fs/promises';

const document = JSON.parse(await readFile(editedDocumentPath, 'utf8'));
const previewBody = {
  expectedVersion: current.program.version,
  installationId: edition.id,
  expectedRevision: edition.revision,
  document,
};
const preview = (await client.installationPreview(caseId, previewBody)).value;
const request = {
  caseId,
  body: {
    ...previewBody,
    expectedPreviewSha256: preview.previewSha256,
    actor: recordingOperator,
    note: editionReason,
    requestId: originalRequestId,
  },
};

await writeFile(requestPath, JSON.stringify(request, null, 2) + '\n', {
  flag: 'wx',
  mode: 0o600,
});
const saved = (await client.installationSave(request.caseId, request.body)).value;
const reopened = (await client.read('installation', {
  caseId,
  installationId: saved.recordId,
  revision: saved.revision,
})).value;
~~~

The original save receipt supplies recordId, revision and the saved edition's sha256. The response envelope's sha256 identifies response bytes; the saved native object's digest remains its own field.

If the save reply is interrupted, reopen requestPath and resend its identical caseId and body. Reopen the edition returned by that original request. Use a fresh current case and Installation read when preparing a later reviewed request.

## Original CLI

Set the selected source, private workspace, actual case and Installation IDs, current case version and saved edition. The following commands operate on that same native workspace:

~~~sh
python3 workspace/cli.py operations --workspace "$scf_workspace" \
  installation-effort-seed --case "$scf_case" \
  --installation "$scf_installation" --expected-revision "$scf_edition" \
  --expected-version "$scf_version" --as-of "$scf_review_date" \
  --output "$scf_output/effort-seed.json"
~~~

Extract the complete /document into an editable JSON file. Retain all Installation fields while editing its effort allocations, reviews and support windows. Supply that whole file with --document when reseeding an edited same-edition draft.

~~~sh
python3 workspace/cli.py operations --workspace "$scf_workspace" \
  installation-preview --case "$scf_case" \
  --installation "$scf_installation" --expected-revision "$scf_edition" \
  --expected-version "$scf_version" --document "$scf_output/installation-input.json" \
  --output "$scf_output/effort-preview.json"

python3 workspace/cli.py operations --workspace "$scf_workspace" \
  installation-save --case "$scf_case" \
  --installation "$scf_installation" --expected-revision "$scf_edition" \
  --expected-version "$scf_version" --document "$scf_output/installation-input.json" \
  --expected-preview-sha256 "$scf_preview_sha256" \
  --actor "$scf_operator" --request-id "$scf_request_id" --note "$scf_reason" \
  --output "$scf_output/saved-effort-edition.json"

python3 workspace/cli.py operations --workspace "$scf_workspace" \
  installation-show --case "$scf_case" \
  --installation "$scf_saved_installation" --revision "$scf_saved_edition" \
  --output "$scf_output/reopened-effort-edition.json"
~~~

Use the values returned by the save receipt for the last command. The CLI writes a new private output file and preserves an existing different file. Retain the original request ID and body when recovering a save.

## Select the reviewed hours for planning

Select **Open remaining-work forecast** from a saved reviewed edition. Choose the saved Forecast and map its commercial tasks to the current saved Installation editions. Each selection retains taskId, installationId, installationRevision and installationSha256. The commercial task must match that Installation's Workshare case and complete source. Use the same as-of date for the saved effort review and the Forecast. The native constructor carries the saved Forecast's complete inputs into the current case context, including Work recorded after that Forecast was saved.

~~~js
const currentCase = (await client.read('case', {caseId})).value;
const selected = (await client.installationEffortSelection(caseId, {
  expectedVersion: currentCase.program.version,
  forecastId: selectedForecastId,
  installationSelections: reviewedInstallationSelections,
  name: reviewedForecastName,
  note: remainingWorkSelectionReason,
})).value;
~~~

The returned /inputs is the complete native Forecast draft. Review its remaining work together with the preserved cash observations, costs, prices and collection inputs. Retain the whole selection result with the save request so its phase and source choices are available for the Portfolio step.

~~~js
const forecastInputs = selected.inputs;
const forecastPreview = (await client.forecastPreview(
  caseId,
  currentCase.program.version,
  forecastInputs,
)).value;

const forecastRequest = {
  caseId,
  effortSelection: selected,
  body: {
    expectedVersion: currentCase.program.version,
    requestId: originalForecastRequestId,
    actor: recordingOperator,
    note: forecastSaveReason,
    inputs: forecastInputs,
    expectedPreviewSha256: forecastPreview.previewSha256,
  },
};
await writeFile(forecastRequestPath, JSON.stringify(forecastRequest, null, 2) + '\n', {
  flag: 'wx',
  mode: 0o600,
});
const savedForecast = (await client.forecastSave(
  forecastRequest.caseId,
  forecastRequest.body,
)).value;
const reopenedForecast = (await client.read('forecast', {
  caseId,
  forecastId: savedForecast.recordId,
})).value;
~~~

The save receipt identifies the saved Forecast by recordId. Reopening supplies the saved object's sha256 and reviewed source. Recover an interrupted save by reading forecastRequestPath and resending that identical caseId and body.

Use the exact returned /selection/installationSelections with the saved Forecast. The native phase seed adopts the current reviewed phase remainders from those editions:

~~~js
const phaseSeed = (await client.portfolioSeed(
  caseId,
  savedForecast.version,
  savedForecast.recordId,
  {installationSelections: selected.selection.installationSelections},
)).value;
await writeFile(portfolioDraftPath, JSON.stringify(phaseSeed.inputs, null, 2) + '\n', {
  flag: 'wx',
  mode: 0o600,
});
~~~

The full /selection/effort array retains each task's previous and reviewed remaining total, source case and plan, effort-report digest, selected edition and complete phase reviews. Keep this selection with the saved Forecast and Portfolio operation.

Review the complete Portfolio draft's resource assignments, calendar and delivery boundary. For newly seeded groups, phase remainder values come from the saved effort reviews; remaining minimum durations start at zero so the operator can enter the work still required. Assign each phase's hours to its actual resources before reviewing the allocation.

An explicitly authored existing phase group keeps its resource, remainder and duration edits. To adopt all newly reviewed estimates for one selected base group, remove that task's group from the editable inputs.installationPlans and reseed the complete draft with the exact returned Installation selection. Other base groups and each explicit alternative override remain intact. Review those alternatives against the updated source totals before saving.

After editing the complete input, preview, save and reopen through the original methods:

~~~js
const portfolioInputs = JSON.parse(await readFile(editedPortfolioPath, 'utf8'));
const planningCase = (await client.read('case', {caseId})).value;
const allocation = (await client.portfolioPreview(
  caseId,
  planningCase.program.version,
  portfolioInputs,
)).value;
const portfolioRequest = {
  caseId,
  effortSelection: selected.selection,
  body: {
    expectedVersion: planningCase.program.version,
    requestId: originalPortfolioRequestId,
    actor: recordingOperator,
    note: portfolioSaveReason,
    inputs: portfolioInputs,
    expectedPreviewSha256: allocation.previewSha256,
  },
};
await writeFile(portfolioRequestPath, JSON.stringify(portfolioRequest, null, 2) + '\n', {
  flag: 'wx',
  mode: 0o600,
});
const savedPortfolio = (await client.portfolioSave(
  portfolioRequest.caseId,
  portfolioRequest.body,
)).value;
const reopenedPortfolio = (await client.read('portfolio', {
  caseId,
  portfolioId: savedPortfolio.recordId,
})).value;
const completePortfolio = await client.download('portfolio', {
  caseId,
  portfolioId: savedPortfolio.recordId,
});
await writeFile(portfolioExportPath, completePortfolio.bytes, {flag: 'wx', mode: 0o600});
~~~

The complete export retains the saved planning input, source snapshots, allocation and dated cash outputs. Keep the complete operating-case handover with it when the receiving operator will continue Work, Installation and Forecast edits.

The equivalent CLI selection is:

~~~sh
python3 workspace/cli.py operations --workspace "$scf_workspace" \
  installation-effort-selection --case "$scf_case" \
  --expected-version "$scf_current_version" --forecast "$scf_forecast" \
  --installation-selections "$scf_output/reviewed-installation-selections.json" \
  --name "$scf_forecast_name" --note "$scf_selection_reason" \
  --output "$scf_output/remaining-work-forecast-selection.json"
~~~

The selection input file is the complete array of task IDs and exact saved Installation editions. Save the response's /inputs as the Forecast input JSON and /selection/installationSelections as the Portfolio selection JSON. Continue them through the existing native commands:

~~~sh
python3 workspace/cli.py operations --workspace "$scf_workspace" \
  forecast-preview --case "$scf_case" --expected-version "$scf_current_version" \
  --inputs "$scf_output/remaining-work-forecast.json" \
  --output "$scf_output/remaining-work-forecast-preview.json"

python3 workspace/cli.py operations --workspace "$scf_workspace" \
  forecast-save --case "$scf_case" --expected-version "$scf_current_version" \
  --inputs "$scf_output/remaining-work-forecast.json" \
  --expected-preview-sha256 "$scf_forecast_preview_sha256" \
  --actor "$scf_operator" --request-id "$scf_forecast_request_id" --note "$scf_forecast_reason" \
  --output "$scf_output/saved-remaining-work-forecast.json"

python3 workspace/cli.py operations --workspace "$scf_workspace" \
  portfolio-seed --case "$scf_case" --expected-version "$scf_forecast_saved_version" \
  --forecast "$scf_forecast_saved_id" \
  --installation-selections "$scf_output/portfolio-installation-selections.json" \
  --output "$scf_output/reviewed-effort-portfolio-seed.json"
~~~

Use recordId and version from the Forecast save receipt in the last command. The Portfolio seed's /inputs is the complete editable allocation. Its existing portfolio-preview, portfolio-save, portfolio-show and portfolio-export commands follow the same input, version, request and preview-digest pattern; [the Portfolio guide](PORTFOLIO.md) gives the complete allocation and cash selection workflow.

## Continue delivery and cash planning

Open the current saved Forecast and continue into Portfolio. Use installation phases to retain the original phase graph, customer identity and selected Installation edition. Review the seeded remaining effort in every phase and assign it to the available resources. The complete phase remainder must equal the commercial task's remaining hours, and each phase's resource assignments must total its remaining effort.

Retain the reviewed commercial delivery boundary. Every support phase remains in the shared allocation, including work after that boundary. Reopen the saved Portfolio and select Open dated cash forecast draft to carry chosen work dates into the original Forecast editor. Its original prices, invoice inputs, collection dates, credits and cash observations remain attached to that complete forecast input.

When a named contributor supplies the capacity, use the original Contributor Engagements workflow and its confirmed agreement, dated availability, compensation terms and explicit resource mapping. Keep the actual agreement's start and end dates and dated exceptions in the received allocation.

## Merchant MCP

| Tool | Original operation |
| --- | --- |
| merchant_grant_installation_effort_seed | Prepare the complete effort document and current native inventory for a saved Installation. |
| merchant_grant_installation_preview | Review the complete edited Installation document. |
| merchant_grant_installation_save | Save the reviewed effort together with the whole Installation edition. |
| merchant_grant_installation | Reopen the exact edition returned by the save. |
| merchant_grant_installation_effort_selection | Select exact reviewed editions into a complete original Forecast draft. |
| merchant_grant_forecast_preview / merchant_grant_forecast_save | Review and save that full original Forecast input. |
| merchant_grant_portfolio_seed | Continue its original remaining work and phase source in Portfolio. |
| merchant_grant_export with kind installation | Export the selected saved edition and complete operating case. |

The effort seed's optional document can be passed inline as inputs or through an existing verified host input, retained response or committed input transfer. inputPointer selects /document from the seed or /preview/document from a saved edition. expectedInputSha256 always identifies the whole original file before pointer selection. Complete reports use the existing retained-response paging and download routes.

## Corrections and complete handover

Retain the exact request body, request ID, selected case version and reviewed digest before a save. If the response is interrupted, resend that same request through the original client. A committed native request returns its original result. Reopen the saved edition named in that receipt before preparing later edits.

Use the complete Installation or operating-case export to carry the saved edition, earlier history, original Work and Invoice records, attached source documents, and saved planning inputs. The original importer assigns the receiving case its new case identity while preserving the selected Installation identities and source lineage. Continue from the actual receiving receipt and reopened current case.

Keep complete input documents when moving between the browser, CLI and agent tools. An edited source selection and the original saved edition remain available for review as their separate records.

## Native routes and maintained source

| Operation | Route |
| --- | --- |
| Prepare a saved Installation's effort input | POST /api/operations/{case}/installation-effort-seed |
| Preview the complete Installation | POST /api/operations/{case}/installation-preview |
| Save its reviewed next edition | POST /api/operations/{case}/command, action installation.save |
| Select saved reviewed hours into Forecast | POST /api/operations/{case}/installation-effort-selection |
| Reopen the saved edition | GET /api/operations/{case}/installations/{id}?revision=N |
| Export the selected complete handover | GET /api/operations/{case}/installations/{id}/export.zip?revision=N |

The maintained source adds operations_installation_effort.py and operations_installation_effort.mjs to the same runtime. The existing Installation browser and stylesheet are extended. Both managed launch selectors include the new modules, and the existing native HTTP registration serves the editor. Deploy the complete composed source and reopen the same selected native application before continuing its saved case.
