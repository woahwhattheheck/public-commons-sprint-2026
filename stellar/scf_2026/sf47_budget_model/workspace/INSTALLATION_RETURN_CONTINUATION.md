# Continue a retained Installation return after a plan change

An owner can reopen a complete receiving return from the same operating case, compare the staged Installation with current work, and create a new explicit review. The original customer files, receiving report, owner decisions, plan revisions and Installation editions remain available throughout.

The original Installation save remains the final writer. Its preview and transaction bind the exact staged review ID, review SHA-256, Installation edition, selected plan, records and source files. A changed selection is shown to the operator before another edition can be saved.

## Normal staff workflow

1. Open **Delivery operations → Receiving returns → Review a return**. For a newly returned customer ZIP, use **Import complete case**, then select that imported receiving case and report.
2. For a case that already contains an owner review, select **Continue a review retained in this case → Reopen retained owner review**. This uses the original files already inside the current case. It also works after receiving the whole owner case into an empty workspace; the earlier separately imported customer case does not need to exist there.
3. Read the current Installation, original observations, source/configuration differences and earlier decisions. A new review starts with **Keep current owner observation** for every check. Choose **Apply** only for an unchanged criterion and acceptance basis, and record the reason.
4. Preview the complete selection and save the owner review. Saving this review retains the complete original evidence and proposed Installation; it does not advance the Installation edition.
5. Use **Compare staged and current case**. The comparison identifies the actual staged and current editions and any selected record, source, plan or document differences. If the selection changed, use **Regenerate owner review**, review the new comparison and save the new explicit choices.
6. Preview the next Installation edition, record its reason and choose **Save next Installation edition**. The original transaction rechecks the full selected stage. A concurrent change returns the original conflict and leaves the review and files available for regeneration.
7. Download the complete case ZIP. The receiving office imports that ZIP through **Import complete case**, reopens the same retained owner review and saved Installation, and can continue another review.

The saved owner review keeps its earlier decisions. Regeneration preserves the current local owner draft and presents fresh KEEP choices. A confirmed Installation displays the original saved edition associated with that review.

## What the complete case retains

The handover includes the original native planning source bytes and full planning revision history, the amendment history, work intake, Installation editions, named receiving reports, owner reviews, all source mappings, original attached files and the ordinary operating event/request history.

Historical Installation and receiving snapshots are evaluated against the plan selected at their original event. The shared original planning importer validates the native plan history and source bytes. The original amendment history resolves each historical plan. Reopening a case does not reinterpret an old Installation against the newest plan.

The selected stage comparison excludes only receiving-local case/plan IDs and unrelated global case-version changes. It compares the actual selected business records, source metadata, complete plan content and Installation document. The native request still uses the current case version as its transaction boundary.

The original complete-file limits remain: a receiving proof is bounded to 8 MiB, nested retained proof to 16 levels, and a complete Operations import to the native 32 MiB bundle bound. A selection that exceeds a bound needs a smaller explicit whole selection; the interface does not silently shorten its history or source files.

## Interrupted work and later edits

The browser retains the original command body and request ID before dispatch. After an uncertain response, **Continue original request** uses that same request. Once the response is known, readback selects the exact saved review or Installation revision before completing the local action.

The staged Installation command includes:

~~~json
{
  "installationId": "installation-<original-id>",
  "expectedRevision": 5,
  "document": {},
  "returnReview": {
    "id": "review-<original-id>",
    "sha256": "<exact-saved-owner-review-sha256>"
  },
  "expectedPreviewSha256": "<exact-native-preview-sha256>"
}
~~~

The complete document comes from the original saved stage. A manual Installation edit continues to use the ordinary preview/save interface; it does not manufacture an owner-review binding.

An original completed command can be replayed after later changes and returns its original receipt. A new save requires the current comparison. An unavailable selected Installation or review remains an explicit unresolved selection; it is never replaced with a similarly named record.

## Original API, agent and CLI access

The read-only seed is:

~~~text
POST /api/operations/<case-id>/installation-return-review-seed
{
  "expectedVersion": <current-case-version>,
  "retainedReview": {"id": "<original-review-id>", "sha256": "<exact-review-sha256>"}
}
~~~

It returns the original review inputs and returned report, prior choices, current staged-versus-current comparison and any saved Installation editions carrying that exact review. The generated inputs contain the same retainedReview pin and fresh KEEP choices.

The original owner preview and stage commands accept this optional pin inside inputs. The original Installation preview/save accept returnReview alongside installationId, expectedRevision and document.

The typed client exposes installationReturnReviewSeed and carries the same optional pin through installationPreview and installationSave. The merchant MCP tool is merchant_grant_installation_return_review_seed; its ordinary source snapshot/file interfaces continue to retain complete responses.

CLI read:

~~~bash
python3 -B cli.py operations --workspace /absolute/private-workspace \
  installation-return-review-seed --case operation-... \
  --expected-version 42 --review review-... --sha256 <saved-review-sha256>
~~~

For the original installation-preview and installation-save commands, pair --return-review with --return-review-sha256. The ordinary document file, reviewed preview hash, actor, note, request ID and case/Installation revision flags still apply. A completed request must be replayed with its original complete arguments.

## Complete operating continuation

Three files extend the original 7108 receiving workflow:

- installation-return-continuation.py calls the existing installation-return-receiving.py, preserves its completed core output, applies a selected earlier native amendment while retaining a later planner head, performs a fresh amended Installation return, stages it and cold-receives the complete owner case through the original CLI.
- installation-return-continuation.mjs borrows the existing Page and GrantWorkspaceClient. It exercises the current difference, explicit partial regeneration, an actual committed-but-lost stage response, original request recovery, final native Installation save, later local draft retention, complete customer UI import and normal reopen at 1365 and 390 pixels.
- installation-return-operate.mjs owns one original managed server and one browser context. It closes the original server before the cold receiving server, preserves the original origin, and invokes the final native CLI/history/source readback after the browser closes.

The prepared case is explicitly WALKTHROUGH. Its receiving observations describe the actual local native archive/readback, and its USD100 allocation is a labelled internal scenario on the original public plan. It does not create a customer payment or external acceptance.

Host input:

~~~json
{
  "operationId": "SCF-INSTALLATION-RETURN-CONTINUATION-018A-20261012",
  "sourceRoot": "/absolute/selected-repository",
  "workspaceDirectory": "/absolute/owned-state/original",
  "coreReceivedDirectory": "/absolute/owned-state/original-core-receiver",
  "receivedDirectory": "/absolute/owned-state/cold-owner",
  "finalReceivedDirectory": "/absolute/owned-state/customer-receiver",
  "outputDirectory": "/absolute/owned-state/output",
  "pythonExecutable": "/absolute/python3",
  "playwrightModule": "/absolute/installed-playwright/index.mjs",
  "chrome": "/absolute/installed-chromium"
}
~~~

Start the same whole operating selection:

~~~bash
node installation-return-operate.mjs --input /absolute/owned-state/host-input.json
~~~

### Continue an already completed original host

When the original 7108 core and Page have completed, keep their complete-input.json, both workspaces, selected source directory and output intact. Select the merged continuation source in a separate directory. The new tail uses the existing owner case and its Installation identity.

Add the following optional completedBase selection to the same continuation host input. These are the exact byte identities of the original complete host input and its output/result.json:

~~~json
{
  "completedBase": {
    "input": {
      "path": "/absolute/original-host/complete-input.json",
      "bytes": 1234,
      "sha256": "<sha256-of-the-complete-original-input>"
    },
    "result": {
      "path": "/absolute/original-host/receiving/result.json",
      "bytes": 5678,
      "sha256": "<sha256-of-the-complete-original-result>"
    }
  }
}
~~~

The example byte counts are placeholders; record the actual original files. workspaceDirectory must be the completed host's workspaceDirectory, and coreReceivedDirectory must be its original receivedDirectory. The new outputDirectory, receivedDirectory and finalReceivedDirectory remain distinct from those original directories.

Before any amendment, the continuation checks the selected original input/result, complete customer package intent, every retained core/Page output, original source manifest and source bytes, complete customer archive, original core result and its full archive. The original core's completed_only path holds its normal receiving lock and returns the saved result before opening a Workspace or issuing a native action. A missing COMPLETE result cannot start a new core through that path. The existing live owner case must still contain the exact historical Installation.

The tail keeps exact copies of the original host input, result, source selection, core input/result and complete customer archive with its own receiving outputs. Its journal binds that completed-base selection before the first amendment. Original core/Page operation IDs and files stay unchanged; subsequent amendment, return and browser requests keep the continuation's original operation ID.

Resume with the same complete host selection. If an older continuation input already exists, it cannot be silently rewritten to select another base. If the selected original workspace or source is unavailable on the receiving machine, retain that concrete path/result selection for the original host's supported recovery. Importing a customer case is an explicit native receiving operation with its own recorded local identity.

The source, state directories and output are separate. The host selects its actual installed Python, Playwright and Chromium; the application itself remains the original standard-library Python service. A recipient does not need the browser automation dependencies to run normal staff operations.

The continuation journal preserves each native request before its call, immutable original files, completed phases and exact UI-issued request bodies. Resume the same host input. The producer must retain its complete source/case/output package before a transient execution environment exits.

The final native result checks every complete browser artifact, all received original source bytes, full amendment history, each historical Installation edition, the exact staged-review binding, partial ACCEPTED/ACCEPTED/OPEN result and a closed/reopened CLI read. Screenshots and downloads remain complete artifacts; the guide is not a substitute for an actual COMPLETE result.

## Source ownership and earlier delivery

This is an additive join to the original Installation-return and Installation writers. It preserves the original 7108 receiving model, 70D2 Installation/effort integration and the original Operations request/transaction model.

The prior full plan-amendment delivery is merged at c78026cbd8f6a2641af04b8bb9c84c9687e12f96. Its complete ten-phase receiving archive remains SF47_Grant_Amendment_Complete_Receiving_20261012.zip, 2,717,055 bytes, SHA-256 446c655a71348c0302f837f251c895dbefc8338bb9fb7abcc244b34ba7ba39ac. The present continuation retains that original engine and adds the Installation/customer receiving path.
