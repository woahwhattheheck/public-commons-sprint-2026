# Appraisal browser

The Appraisal panel adds a complete risk-of-bias review to an existing Research dossier. It uses the dossier's retained questions, eligibility study groups, extraction results, original source occurrences and revision history. A protocol fixes the instrument, form, design applicability and named reviewers. Each assessment fixes its study or result edition. Independent drafts, submitted reviews, adjudication and later source changes remain linked to that exact basis.

The panel is an operator surface for the original risk-of-bias domain in [API.md](API.md). The source files are [browser.mjs](browser.mjs), [panel.html](panel.html) and [browser.css](browser.css). Its project form and method references are the maintained [form-template.json](form-template.json) and [method-references.json](method-references.json).

## Start a review

Open the existing dossier and choose **Appraisal**. The question and eligibility review should already contain the retained study links. Result-level assessment also uses the original extraction registry's result records. The toolbar displays the saved dossier revision throughout the workflow.

Choose **Start appraisal review**, select the original research question and eligibility review, and name the appraisal. The protocol editor supports two starting points: author its instrument and form fields directly, or choose **Use project appraisal form**. The latter copies the maintained Project-specific Result Appraisal instrument and form into an editable protocol. It preserves the preceding browser draft and leaves reviewer assignment to the operator.

The project form has five domains and ten original questions:

| Domain | Review focus |
|---|---|
| Reported result and source basis | The selected result's definition and what its retained reports establish |
| Formation of the comparison | The source-described groups, sample and design |
| Exposure, care and follow-up | Delivery, subsequent care, departures and follow-up |
| Measurement and available observations | Outcome measurement, available observations and result-specific denominators |
| Analysis and choice of reported result | Analysis, available prespecified context and the reported result |

The form provides five explicit reviewer judgment choices, including insufficient information. Its exact title, version, questions, instructions and source rights are recorded in the saved protocol. Review and adapt those fields for the project before saving.

For a published instrument, select **Published instrument** and record its actual identifier, title, version, original source URLs, applicable designs, scope and rights statement. **Open instrument references** displays the maintained source metadata. The form has its own title, version, origin, source URLs and rights, so a project-authored form and the cited instrument remain distinguishable.

Assign reviewer identifiers and names, set the minimum number of independent reviews, identify the assigned resolver or resolvers, and describe the disagreement procedure. A resolver identifier must match an assigned reviewer. These are the authorship identities used in the existing authenticated workspace; the protocol records them with each draft and decision.

Save the operation. The saved review and immutable protocol edition appear in **Instruments & protocols**. A later protocol correction uses **Revise protocol**, records its reason and preserves the earlier edition.

## Select the exact assessment basis

Open the intended protocol edition and choose **Create assessment with this protocol**. Name the assessment, then select its original retained study. The picker copies the study's identifier, version and SHA-256 directly from the server's original registry projection. A result-level protocol also requires a specific result; its identifier, version and SHA-256 are copied in the same way.

The panel displays the complete original study and result records beside their selectors. A saved target can retain an earlier record version while the registry has advanced. That condition is labeled explicitly: selecting a current record changes its pins deliberately, while the earlier assessment retains its original record.

Select a study design from the protocol's declared applicability and explain the source basis for that choice. The protocol determines whether the target is a study or a specific result. Choose the linked report occurrences that support the assessment. Selecting a result includes its required original source occurrences.

Use **Evidence for the study design** to add retained passages. Each passage has:

| Field | What to enter |
|---|---|
| Original report | The selected retained occurrence |
| Original retained filename | Optional exact named file inside that occurrence's source bundle |
| Locator | The human-readable location in that report |
| Literal quote | Optional text copied exactly from the retained record |
| JSON pointer | Optional exact string-leaf pointer from the original inspection |
| Note | The reason this passage matters to the assessment |

For a passage in a named source file, copy the original filename from the source inspector. The panel retains that name and highlights it in the source desk. The original domain checks a supplied quote against the selected retained record or named file and saves its matching location with the source edition and hashes. A locator-only passage remains a locator-only passage.

**Inspect** opens the original source desk. It uses the Research source inspector and original-record download control, so a reviewer can read the retained edition behind the selected occurrence. Source URLs and complete saved occurrence details remain available beside the appraisal.

Save the assessment with a reason. The resulting assessment family and immutable edition identify the selected protocol, study or result, design rationale and source basis. **Revise assessment edition** creates the next edition in that same family when the appraisal basis changes.

## Work as an independent reviewer

Choose a named reviewer in the toolbar, open the assessment edition, and choose **Open my reviewer draft**. The panel loads that actor's current saved draft for the selected edition, or a new partial draft when none exists. The original reviewer is fixed within that editor.

For each question, choose the answer status deliberately:

| Status | Meaning in the saved review |
|---|---|
| Answered | A text answer or configured choice is supplied |
| Not reported | The retained report does not state the information being reviewed |
| Source unavailable | The required source information cannot be accessed in the selected basis |
| Not applicable | The question does not apply, with an assessment-specific rationale |
| Not yet reviewed | The field remains unfinished in the partial draft |

Only an answered field has an answer value. Text, single-choice and multiple-choice fields follow the saved form. Rationale and supporting passages accompany the selected status.

Domain and overall judgments are separate explicit selections from the protocol's judgment list. A partial draft can leave a domain judgment unchosen and the overall judgment empty. Once selected, the judgment retains its basis status, rationale and passages. Submission applies the form's full requirements for answers, domains, overall judgment and source support.

**Save reviewer draft** creates an immutable native draft revision under that reviewer. Browser edits are also retained as the form is edited. The distinction is visible: the browser draft preserves work in progress, while the native draft appears in the dossier's saved revision history.

Choose **Submit this exact saved draft** after reviewing it. The submission screen displays the complete draft being frozen and the preceding submission when this is a correction. Record the reason and submit. A later correction starts from the reviewer's current draft and retains the earlier submission.

The **Reviewer drafts** and **Submitted reviews** registers show current and earlier records. Each record carries its original actor, assessment edition, saved revision and correction history. Changing the toolbar's reviewer opens that person's independent work.

## Compare and resolve

Choose **Compare submitted reviews** for the assessment. The comparison uses the complete native set of current submissions at the selected dossier revision. Each table column is a named reviewer and submission; each row preserves a field, domain judgment or overall judgment.

The table separately marks **Values differ** and **Rationales differ** using the domain's comparison flags. Original source passages remain available in each cell. The complete comparison and its submitted IDs are retained in the detail view.

A resolver assigned in the saved protocol can choose **Record adjudication** once the required independent submissions exist. The adjudication editor binds the exact comparison SHA-256 and the complete current submission set. It provides the same form fields, judgments and source passages as the reviewer editor.

A resolver may use one submitted review as a starting point, then make explicit selections, explain the resolution and save it. The native result preserves the chosen answers and judgments, the resolver, the full submitted basis and any earlier adjudication. When a later submission changes that basis, the earlier adjudication remains visible with its original binding.

## Handle a changed source or protocol

**Source changes** lists the domain's actual impacts on an appraisal. These can arise from a changed research question, protocol, study, result or relevant retained source. Open an item to inspect the previous and current basis, the affected assessment and the exact impact fingerprint.

Choose **Review this exact change** and record one of three dispositions: reviewed, further review needed, or outside the appraisal scope. The reason and the impact fingerprint are retained. This disposition records the review of the change.

Use **Revise assessment edition** for a resulting change to the selected study, result, source or protocol. The previous edition and its independent reviews stay in the history. An expected-revision rebase of a browser draft updates that draft's receiving revision; its selected protocol, record versions, source hashes and superseded record IDs remain explicit.

## Recover interrupted work

Browser drafts and original requests appear beneath the main desk. The browser retains them in the original profile and origin.

**Download browser draft** saves the complete authored draft, including its original reviewer, saved revision, source selections and editor context. **Open a downloaded browser draft** restores that draft into its original dossier. Reopening a saved browser draft creates a new editable copy and preserves its preceding copy.

Before sending a native mutation, the panel commits the exact request ID, expected revision, actor, action and body to browser storage. The request then has one of the following states:

| State | Receiving behavior |
|---|---|
| Ready | The original request is retained and can be submitted |
| Sending | Its existing attempt is awaiting a response |
| Uncertain | The response was interrupted; recover that same original request |
| Complete | The original immutable operation receipt is retained |
| Rejected | The native rejection and original input are retained for correction |

Use **Download original request** to retain that exact request as JSON. **Open an original request file** imports its unchanged identity and body; submission remains explicit.

For a sending or uncertain request, choose **Recover original request**. The panel resends the same ID and original body. The host checks its retained original operation before checking the current dossier revision, so a completed operation can be recovered after later work has advanced the dossier. The original operation receipt is stored before refreshing the current dossier.

For a definite rejection, reopen the retained source draft, inspect the error, refresh the dossier and use **Refresh and rebase this draft** when appropriate. Rebase leaves its source and superseded-record selections intact. If another reviewer draft, submission or target has advanced, open its exact current record and prepare the correction from that basis.

The panel keeps one outstanding original request per workspace and dossier in the browser store. If browser storage is unavailable, open edits remain downloadable from the recovery section. A saved request and its exact body remain the receiving identity across an interrupted connection.

## Workspace identity and recovery

The original host supplies `getWorkspace()` with the exact `workspaceId` and `instanceId` returned by its existing `/api/state`. Drafts, original request files and browser cache keys retain that workspace identity together with the dossier identity. Two workspaces can therefore contain the same received dossier without sharing local drafts or pending mutations.

Open a downloaded draft or original request in its originating workspace and dossier. The complete request envelope retains the destination, actor, UUID, expected revision and unchanged native body. A workspace restart may change the instance identity; the original stable workspace remains the request destination. The original full-dossier receiving operation carries saved appraisals and history into its receiving workspace, whose new browser drafts then belong to that receiving workspace.

The host API receives its existing `workspaceId` option on every appraisal request. Asynchronous pages, source inspectors and reports are adopted only while the original workspace, instance and dossier remain selected. A completed native mutation is first recorded under its original workspace key; a later navigation or refresh failure leaves that operation receipt available for original recovery.

Browser storage version two creates workspace-keyed draft and request stores. It preserves any earlier unscoped stores in place. New exports contain the explicit workspace binding and use the complete envelope for recovery.

The protocol requires at least two distinct named reviewers and a minimum of two independent submissions. The exact retained filename accepts up to 2,048 characters, and a structured source pointer accepts up to 4,096 characters, matching the original domain contract.

## Export the appraisal

The report menu downloads the original JSON, CSV, Markdown or HTML export for the selected saved dossier revision and review or assessment. The file uses the original export filename and content type.

Reports retain instrument and form editions, selected study or result, source passages, independent reviewer content, comparison, adjudication and impact history. The complete original dossier export also carries every appraisal event and source blob. Use the existing Research dossier receiving workflow to open that complete package in another workspace.

The register pages are revision-bound. **Filter this loaded page** filters the displayed page by name, identifier, reviewer or status. Next and previous pages keep the same saved revision. Study, result, source and protocol pickers read their complete paginated original collections.

## Existing application integration

The panel exports:

~~~js
import {createRiskOfBiasPanel} from '/risk-of-bias/browser.mjs';

const appraisal = createRiskOfBiasPanel({
  root: appraisalPanelElement,
  tab: appraisalTabButton,
  api,
  task,
  notify,
  getDossier: () => state.dossier,
  getWorkspace: () => ({workspaceId: state.workspaceId, instanceId: state.instanceId}),
  isBusy: () => state.busy,
  onReceived: async dossier => {
    applyDossier(dossier);
    await refreshList();
  }
});
~~~

The original app calls `setDossier(value)` whenever its dossier changes, `show(visible)` when changing tabs, and `updateBusy()` with its normal busy-state rendering. Its existing navigation warning calls `hasUnsaved()`. `close()` ends the panel after pending browser-draft writes are settled.

The caller supplies the existing authenticated `api`, serialized `task`, notification and dossier-adoption functions. A completed appraisal mutation carries the native metadata reply; the panel then reads the complete current dossier through the original GET route before invoking `onReceived`.

The existing fixed asset map serves these files:

| URL | Source |
|---|---|
| /risk-of-bias/browser.mjs | risk-of-bias/browser.mjs |
| /risk-of-bias/panel.html | risk-of-bias/panel.html |
| /risk-of-bias/browser.css | risk-of-bias/browser.css |
| /risk-of-bias/form-template.json | risk-of-bias/form-template.json |
| /risk-of-bias/method-references.json | risk-of-bias/method-references.json |

Load `browser.css` in the original document head. The module opens its semantic HTML fragment on first display and imports the existing `/source-inspection.js` controls.

| Native route | Role |
|---|---|
| GET /api/dossiers/:id/risk-of-bias | Saved appraisal projection and revision-bound pages |
| POST /api/dossiers/:id/risk-of-bias/reviews?projection=metadata | Original request, same dossier writer and immutable operation |
| GET /api/dossiers/:id/risk-of-bias/export | Original selected-revision report download |

Read selection fields are `revision`, `reviewId`, `assessmentId`, `assessmentEditionId`, `actorId`, `section`, `offset` and `limit`. Export adds `format`. Mutation bodies and record structures follow [API.md](API.md). The complete portable dossier uses the original receiving path and includes the appended appraisal history.

## Original browser receiving programme

The complete receiving entry point is `risk-of-bias/receiving-browser.mjs`. The existing Research producer calls it against its already-running authenticated listener and its actual retained study, result and source selections:

~~~js
import {runRiskOfBiasBrowser} from './risk-of-bias/receiving-browser.mjs';

const authored = await runRiskOfBiasBrowser({
  url: originalListenerUrl,
  dossierId,
  questionId,
  studyId,
  studyVersion,
  eligibilityReviewId,
  sourceCase,
  runDirectory: originalBrowserReceivingDirectory,
  playwrightModule: existingPlaywrightModulePath,
  chromiumExecutable: existingChromiumExecutablePath,
  mode: 'author',
  signal: originalOperationSignal
});
~~~

`sourceCase` is the original source-bound case prepared by the same programme. Its members are `operationId`, `operator`, `review`, the full `protocol`, `assessment`, the exact `selectedResult`, both independently authored `reviewers`, explicit `adjudication`, and the original named `source`. The operator supplies actual retained IDs and hashes. The selected result includes its original record version and hash; source passages already contain their real occurrence and optional filename.

The authoring journey operates the actual panel. It selects the project form and named reviewer protocol, selects the original study and result from their native pickers, fills the source-based assessment, saves both independent reviewer drafts and submits each exact draft, opens their complete comparison, and records the resolver’s authored decision. Before submission it reads the panel’s complete authored operation view and compares the actual form values with the original case. It opens the retained named source file through the original inspector and downloads the selected JSON, CSV, Markdown and HTML appraisal reports. Desktop and narrow screenshots show the instrument, result selection, source file, authored form and comparison.

Every native POST comes from the actual UI. Before the request is allowed to continue, the receiver reads the panel’s already-committed workspace request record, preserves its exact wire bytes and full original recovery envelope, and records the current stage. Responses are retained separately from original input. After a connection interruption, the same stage opens its original request in the panel or consumes the exact original completed browser receipt. A recovered original operation keeps its first accepted response file. A definite native rejection remains attached to that request for correction.

The same mode, listener origin, source case and receiving directory resume that original operation. The original persistent Chromium profile keeps browser drafts and requests. A completed receiving result is reused after its source selections and all recorded artifact hashes are checked. The existing AbortSignal closes and joins this browser while leaving the original request files available for continuation.

After the original Research portable receiver opens the same saved dossier in its receiving workspace, the programme inspects that exact selection:

~~~js
const received = await runRiskOfBiasBrowser({
  url: receivedListenerUrl,
  dossierId,
  questionId,
  studyId,
  studyVersion,
  eligibilityReviewId,
  sourceCase,
  runDirectory: receivedBrowserDirectory,
  playwrightModule: existingPlaywrightModulePath,
  chromiumExecutable: existingChromiumExecutablePath,
  mode: 'inspect',
  selection: authored,
  signal: originalOperationSignal
});
~~~

Inspect mode opens the selected original review, protocol, assessment edition, both submissions and current adjudication in the receiving browser. It checks the unchanged study/result/source target, reads the original named source, records the received comparison, and downloads the same native report formats at the receiving revision. Its original listener and receiving directory are supplied by the existing programme.

The returned object contains the actual review, protocol, assessment, immutable edition, draft, submission and adjudication IDs; original and current revisions; exact request and response file paths; native source/comparison outputs; report downloads; screenshots; and the complete receiving state path. The parent programme includes those original files with its full dossier and source package.
