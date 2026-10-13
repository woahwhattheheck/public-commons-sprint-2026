# Existing-plan commissioning from code and the command line

The commissioning client and CLI operate the same Portfolio target workspace as the browser. They keep the original uploaded project, import evidence, source editions, native observations, reviews, request journal and portable handover together. The commissioning workflow begins with an existing imported Planner project and its actual project GUID.

Use **COMMISSIONING_DESK.md** for the four-screen operator workflow and **IMPORTED_PLAN_COMMISSIONING.md** for the native scheduling contract. The full action schema is **portfolio_target/commissioning_contract.json**.

## Start and select the local operator

Run the existing operator server with the selected workspace and its private target profile configuration. Its startup output supplies the local origin and current operator token. The target profile belongs on that host; the portable workspace carries the source and operation history.

The dependency-free ES module is **commissioning-client.mjs**. Its adjacent **commissioning-client.d.mts** supplies the complete TypeScript declarations. Use a runtime with Fetch, AbortController and Web Crypto, such as the product's receiving Node runtime or a modern browser.

~~~javascript
import {PortfolioCommissioningClient} from "./commissioning-client.mjs";

const client = new PortfolioCommissioningClient({
  baseUrl: process.env.PORTFOLIO_OPERATOR_ORIGIN,
  token: process.env.PORTFOLIO_OPERATOR_TOKEN
});
const hello = await client.connect();
console.log({workspaceId: hello.workspace_id, profiles: hello.profiles});
~~~

Keep the token in the local environment or the application's private configuration. Every action verifies the selected workspace before submitting. A prepared request retains the workspace identity, original request ID, action and exact arguments.

## Retain a request before starting it

Create the complete action once, persist its prepared envelope, and then submit it. The example assumes the original source edition, selected target profile, actual native project GUID and uploaded evidence have already been selected.

~~~javascript
import {writeFile} from "node:fs/promises";

const prepared = client.prepareAdoption({
  edition_id: selectedEditionId,
  profile_id: selectedProfileId,
  project_id: actualProjectGuid,
  evidence: selectedImportEvidence,
  import_exceptions: originalImportExceptions
});
await writeFile("adoption-request.json", JSON.stringify(prepared, null, 2) + "\n", {flag: "wx"});
await client.submit(prepared);
const saved = await client.wait(prepared);
if (saved.state === "FAILED") throw new Error(saved.error?.message ?? "Open the saved action failure.");
const adoption = await client.getDeployment(saved.result.id);
~~~

The request journal saves that exact input before work begins. Successful commissioning action results contain deployment records; use **getDeployment** to read the expanded plan, review and acceptance objects.

After an interrupted response, read the retained request with **status(prepared)**. **resume(prepared)** reads and verifies the saved input before continuing its original request. A completed request returns its existing result. Resuming a failed request requires the explicit **retryFailed: true** option after reviewing the saved error. If a submit never reached the server and status returns **OPERATOR_NOT_FOUND**, submit the same retained envelope and request ID.

~~~javascript
import {readFile} from "node:fs/promises";
import {restorePreparedRequest} from "./commissioning-client.mjs";

const prepared = restorePreparedRequest(JSON.parse(await readFile("adoption-request.json", "utf8")));
const status = await client.status(prepared);
const continued = status.state === "COMPLETE" ? status : await client.resume(prepared);
const result = continued.state === "COMPLETE" ? continued : await client.wait(prepared);
~~~

**wait** performs reads only. Its timeout or AbortSignal stops the local wait while the original saved operation remains available. Resume the saved request rather than rebuilding its arguments from a newer deployment revision. The client checks that returned request IDs, actions and original arguments match.

## Upload complete originals and read complete pages

**upload** accepts a Uint8Array, ArrayBuffer or Blob, and verifies the returned source hash against the selected bytes. **uploadEvidence** retains the original upload descriptor and its evidence class: native receipt, original export, original screenshot or operator statement.

~~~javascript
const receipt = await client.uploadEvidence(await readFile("import-exceptions.json"), {
  filename: "import-exceptions.json",
  class: "native_receipt",
  title: "Exceptions returned by the selected import"
});
~~~

An interrupted upload returns **CLIENT_UPLOAD_OUTCOME_UNKNOWN** with the original filename, byte count and SHA-256. Retry **upload** or **uploadEvidence** with those same file bytes and filename. The original upload store reuses and verifies that complete object; the upload itself has no action request ID.

Use the actual coordinates and original typed values when recording import exceptions. Keep source field values, converted intended values and observed native values distinct.

**getState** returns a page of deployment summaries and initial source/request pages. **getEditions** and **getRequests** expose their original cursors. The source edition endpoint returns project metadata and family counts; use family pages or the complete iterator to read original rows.

~~~javascript
for await (const row of client.iterateSourceRows(selectedEditionId, {family: "tasks"})) {
  // Keep row.key and the original typed row.fields values for explicit operator mapping.
}
const inspection = await client.inspect(adoptionId);
~~~

**inspect** returns the expanded selected deployment, source metadata, original import, inventory, source comparison, intended-versus-observed comparison, adoption review and principal rebind where present. It rechecks the deployment revision and object pointers after the read. Use the returned named **\*_sha256** pointers to select immutable Store objects; a comparison's embedded body hash is a separate value.

## Review, correct and accept the imported plan

| Stage | Client method | Required selection |
| --- | --- | --- |
| Observe the imported project | prepareAdoption | Source edition, supported profile, actual project GUID and complete import evidence |
| Preview identities and exceptions | prepareAdoptionProposal | Deployment revision, explicit source-key-to-native-GUID maps, every original exception decision |
| Save the adoption review | prepareAdoptionReview | Exact proposal object, current revision, reviewer, note and selected findings |
| Prepare observed corrections | prepareCorrection | Current intended-versus-observed object; optional selected source fields and source edition |
| Review the correction | prepareCorrectionReview | Exact child revision, reviewer, note and selected correction findings |
| Execute the reviewed correction | prepareContinuation | Child deployment and original saved review object |
| Read the native result | prepareCapture | Deployment and current saved revision |
| Accept the captured result | prepareAcceptance | Both exact comparisons, explicit accepted field and identity IDs, reviewer and note |
| Produce the handover | prepareHandover | Accepted deployment |
| Select a new principal | prepareRebind | Existing revision, host-selected profile, reviewer and reason |
| Export the complete workspace | prepareArchive | The connected original workspace |

Submit and retain each prepared request using the same sequence as the adoption example. Read returned object details before choosing acknowledgements; empty selections are appropriate only when the corresponding reviewed set is empty.

Map tasks, project-team resources, assignments and dependencies using native GUIDs from the complete inventory. Each source row keeps its original key. A source name can help an operator identify a row, while the saved mapping uses its exact native identity.

A correction compares selected source intent with current observed native values. The original source can remain unchanged when the imported target is wrong. Review the prepared child plan, continue its original native OperationSet journal, capture the target again and accept that exact result. If an interrupted capture owns retained pages, resume its original request so it keeps those pages and selected revision.

A new authenticated principal receives a separately reviewed rebind for the same organization and project. The existing history retains the principal that performed it.

## Command line workflow

From the product root, use the existing entrypoint:

~~~bash
python operator/cli.py --workspace /path/to/workspace --profiles /private/target-profiles.json commissioning --help
~~~

The group contains sixteen commands: **list**, **inspect**, **evidence**, **intake**, **probe**, **adopt**, **proposal**, **review**, **correct**, **review-correction**, **continue**, **capture**, **accept**, **handover**, **rebind** and **archive**. Existing generic action, request, artifact, archive-reporting and receive commands remain available.

Retain evidence and source input through the same original streaming upload:

~~~bash
python operator/cli.py --workspace /path/to/workspace commissioning evidence import-receipt.json \
  --class native_receipt --title "Original import receipt" --output receipt-selection.json

python operator/cli.py --workspace /path/to/workspace commissioning intake original-plan.mpp \
  --label "Original project export" --output source-intake-result.json
~~~

Put the selected evidence descriptors into a JSON array. The intake result supplies the original source edition. Select a configured supported profile and actual project GUID for adoption:

~~~bash
python operator/cli.py --workspace /path/to/workspace --profiles /private/target-profiles.json \
  commissioning adopt "$EDITION_ID" --profile "$PROFILE_ID" --project-id "$PROJECT_GUID" \
  --evidence-file evidence.json --import-exceptions-file import-exceptions.json \
  --request-id "$ORIGINAL_REQUEST_ID" --output adoption-result.json
~~~

Use **commissioning inspect DEPLOYMENT_ID** to read the full selected source and commissioning objects. Its **--section** option selects the deployment, source, import, inventory, comparison, source-comparison, review, probe or rebind. **commissioning list --all** reads every original deployment page and returns the adoption/correction lineage.

Every revision-dependent command requires **--expected-revision**. Proposal, mapping, exception and acknowledgment files retain their original JSON types and reject duplicate JSON keys or non-finite numbers. Review commands require explicit reviewer, note and finding selections. Acceptance requires both comparisons and separate accepted field/identity files.

~~~bash
python operator/cli.py --workspace /path/to/workspace commissioning proposal "$ADOPTION_ID" \
  --expected-revision "$REVISION" --row-ids-file row-ids.json \
  --exception-decisions-file exception-decisions.json --mappings-file mappings.json

python operator/cli.py --workspace /path/to/workspace commissioning correct "$ADOPTION_ID" \
  --expected-revision "$REVISION" --basis-sha256 "$OBSERVED_COMPARISON" \
  --selected-fields-file correction-fields.json
~~~

The **--queue-only** option saves an original action without executing it. The existing **request REQUEST_ID --resume** command executes or resumes that saved input. A request ID omitted by the operator is generated and saved in the journal. Keep an explicit ID when an automation needs to reconcile an interrupted CLI process.

**--output** also saves the exact result JSON in the chosen file. It preserves an existing file with different bytes; choose a new result filename when retaining another state of the same request. JSON is also written to stdout. A failed saved action returns process exit code 1.

## Deliver and reopen

**commissioning handover** produces the original target handover plus complete commissioning JSON and HTML, including the accepted source/capture pair, import evidence, reviewed identities, retained differences and pinned parent snapshots. The existing **artifact SHA --output FILE** command copies exact object bytes.

The client downloads and verifies any returned report descriptor with **downloadBytes(descriptor)**. For the complete workspace archive, combine its archive descriptor and top-level filename:

~~~javascript
const done = await client.wait(archiveRequest);
if (done.state !== "COMPLETE") throw new Error(done.error?.message);
const receipt = done.result;
const bytes = await client.downloadBytes({...receipt.archive, filename: receipt.filename});
await writeFile(receipt.filename, bytes, {flag: "wx"});
~~~

Reopen the original archive on the receiving host using the existing command:

~~~bash
python operator/cli.py receive original-workspace.portfolio.zip --destination /path/to/received-workspace
~~~

Deliver the portable workspace together with the complete operator source, including this client and CLI. The workspace archive preserves its original project sources, native observations, operation records and retained objects. Select private target credentials separately on that host, open the retained deployment and review its actual handover. The receiving operator can inspect and continue the same original workspace history.
