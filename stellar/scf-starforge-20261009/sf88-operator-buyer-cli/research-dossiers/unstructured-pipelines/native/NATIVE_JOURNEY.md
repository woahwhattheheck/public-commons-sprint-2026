# Managed Pipelines native operating journey

This entry exercises the maintained managed Unstructured Pipelines operator and the original research dossier workspace in one selected native operation. It includes the actual multipart HTTP client, local retained job state, browser controls, original output reader, receiving decision, portable export, and a provider-absent reopen.

The declared provider mode is **`official-model-local-http`**. The local HTTPS fixture implements the pinned provider models and endpoints, supplies two authored text files, and records every original request. Its result carries this mode and its source identity. An account deployment uses the maintained provider configuration and customer operating guide; this manual journey supplies its own process-private provider credential.

## Source and caller

Keep these four maintained manual inputs together:

- `managed-pipelines-native.mjs`: the sole command entry.
- `managed-pipelines-fixture.mjs`: actual multipart HTTP provider and retained provider job state.
- `managed-pipelines-browser.mjs`: original workspace/browser continuation.
- this guide.

The caller selects one current Starforge source tree, one native resource operation, the already installed Playwright module, and the existing Chromium executable. The command takes no credentials and performs no dependency installation. It creates its temporary TLS key/certificate and Chromium profile under a private `/dev/b9d2-managed-pipelines-*` directory, keeps the server and browser in the same foreground process namespace, and removes that temporary directory at exit. The persistent operation and output directories retain the job state, request history, output bytes, source identity, and receiving state.

The entry must follow the existing resource admission and operator custody for the selected run. Check the native record before continuing a disconnected carrier. An interrupted run uses the same command, directories, source selection, provider port, and original native operation. Keep process polling attached to that original foreground caller.

### Exact source selection

The source root is the directory containing `sf88-operator-buyer-cli/` and `sf30-seller-sdk/`, normally `stellar/scf-starforge-20261009/` inside the selected release. The identity file is a retained JSON document:

```json
{
  "schema": "stellar-forge.native-source-selection.v1",
  "repository": "woahwhattheheck/public-commons-sprint-2026",
  "commit": "<actual immutable source commit>",
  "files": {
    "sf88-operator-buyer-cli/research-dossiers/server.mjs": {
      "gitBlob": "<actual 40-character Git blob>",
      "sha256": "<actual 64-character SHA-256>"
    }
  }
}
```

Use the actual selected release and exact native Git blobs. The illustrated entry is a format example; populate the complete selected file map before execution. The command checks every declared file's original Git blob and optional SHA-256, checks the selected files again after the journey, and writes the measured source identity into the result.

The required map includes:

1. `research-dossiers/server.mjs`
2. `research-dossiers/dossier.mjs`
3. `research-dossiers/unstructured-pipelines-workspace.mjs`
4. `research-dossiers/unstructured-pipelines/contract.mjs`
5. `research-dossiers/unstructured-pipelines/client.mjs`
6. `research-dossiers/unstructured-pipelines/operations.mjs`
7. `research-dossiers/unstructured-pipelines/edition.mjs`
8. `research-dossiers/public/app.js`
9. `research-dossiers/public/index.html`
10. `research-dossiers/public/unstructured-pipelines.js`
11. `research-dossiers/public/unstructured-pipelines.css`

Each path above is beneath `sf88-operator-buyer-cli/`. Include the original shared modules and other selected runtime source in the same map when constructing the release selection. The selected dependency closure remains the caller's maintained runtime.

### Invocation

All argument paths are canonical absolute paths. Supply the actual selected directories and executables:

```bash
node /absolute/manual/managed-pipelines-native.mjs \
  --source-root /absolute/release/stellar/scf-starforge-20261009 \
  --source-identity-file /absolute/operation/source-identity.json \
  --directory /absolute/operation/state \
  --output /absolute/operation/output \
  --playwright /absolute/existing/playwright/index.mjs \
  --chromium /absolute/existing/chrome-headless-shell
```

The outer command creates the one local TLS context and launches its child with `NODE_EXTRA_CA_CERTS`. The child uses original `openPipelineOperations` and `startDossierWorkspace`, native `fetch`, and the maintained browser assets. The API key exists only in the child process and is supplied through the configured environment variable. The selected provider API URL and profile digest remain stable across a resumed operation.

## Original workflow and accepted observations

### Reviewed local files and uncertain creation

The browser opens the original Pipelines tab in an existing research dossier, selects the named template profile and question, supplies the two authored files, and saves the original preparation. The command reads the retained inputs through the original server and compares their actual bytes and digest to the files supplied.

The first local provider creation receives and parses a real `multipart/form-data` request with one JSON `request_data` field and repeated `input_files` fields. It validates the exact configured template and bytes, saves its new job identity, and closes the connection before returning a response. The original provider client retains `SUBMISSION_UNKNOWN`.

The operator lists the actual account jobs, chooses that retained provider ID, records a reason, and reconciles the original operation. The fixture gives independent file IDs and reverses their list order. The operator's output choice consequently depends on the provider IDs, not on an inferred input index.

### Output retention, browser reply loss, and research receiving

After the provider completes the saved job, the operator refreshes the original state and selects an actual default output. The browser's retain request is allowed to complete at the original HTTP server. The journey saves the server's successful response, then loses only its delivery to the browser.

The panel reopens the exact pending request. The operation returns its original action result and retained output without a second provider download. The actual raw output can also be downloaded independently of the portable edition projection.

The same pattern exercises the receiving decision. The original dossier commits one edition and returns its receipt; the browser response is lost. A reload exposes **Continue exact receiving decision**, which uses the original selection, output digest, question, label, revision, and request ID. The original receiving receipt is recovered and the dossier has one added edition.

The operator then selects the actual explicit node/file pair, retains its output, and receives the second edition. The reader locates a page-two `NarrativeText` paragraph containing the operating assumptions.

### Cancellation

A second, separately reviewed preparation supplies one authored source file. Its provider job enters `IN_PROGRESS`. The original cancel response acknowledges the request; the operation remains active until a subsequent provider read actually reports `STOPPED`. The result retains both the acknowledged and confirmed state.

The fixture records the interval between its two creation requests. The same account/API launch gate must preserve at least the documented one-second interval. Provider queue statuses remain the actual provider observations.

### Portable reopen and screen layout

The original workspace is captured at 1440 pixels and at a 390-pixel mobile viewport. The mobile document must fit the viewport horizontally.

The command downloads the original dossier's JSON portable export, closes the original provider and workspace, and starts the same dossier implementation in a fresh restored directory with `pipelineSource:null`. It imports the portable export through the original `/api/reopen` operation, reads the retained edition in the Pipelines tab, and downloads the original output bytes. The restored output digest must match its original retention. The provider's request counters must remain unchanged during this portable reading.

## Retained operation and recovery

The following files are the continuation state:

- `state/host-state.json`: original workspace ID, selected source manifest digest, and actual local provider port.
- `state/provider-operations/`: original immutable preparation, copied inputs, command receipts, job observations, and output bytes.
- `state/dossiers/`: original research dossier history and received blobs.
- `state/restored-dossiers/`: same exported dossier reopened through its original portable API.
- `output/provider-state.json`: the local fixture's original job and file identities, captured inputs, HTTP observations, and counters.
- `output/browser-checkpoint.json`: completed stages, exact browser request bodies, and only the Pipelines request/receiving journal needed to recover replies.

The browser checkpoint captures each selected control before its HTTP request proceeds. A continuation first reconciles a pending preparation by its original request ID. It finds an already-published plan or reselects that exact preparation’s retained input bytes, then reuses existing preparations, reopens pending original commands, and skips completed stages. The API key, browser authentication token, and general browser storage are excluded from the retained checkpoint.

A prior successful `managed-pipelines-result.json` is returned as the accepted result. The entry does not create another provider job. An interrupted carrier must be reconciled through its actual native status before the same remaining operation resumes.

Keep retained state and source selection together. If a source correction is needed, preserve the previous selection and operation record and use the maintained source handoff with that same operation; do not erase the request or provider state.

## Result and delivery

The complete result is `output/managed-pipelines-result.json` with `status:"passed"`. It includes measured source identity, provider mode and contract, original dossier/question/operation/job/output/edition IDs, recorded control requests, provider counters and launch intervals, portable digest, restored revision, and screen errors.

Expected final files include:

- `native-host-result.json`
- `managed-pipelines-result.json`
- `provider-http-result.json`
- `lost-retain-original-reply.json`
- `lost-receive-original-reply.json`
- `retained-original-output.json`
- `restored-original-output.json`
- `managed-pipelines.research.json`
- `managed-pipelines-desktop.png`
- `managed-pipelines-mobile.png`
- `managed-pipelines-restored.png`

A failed continuation records `managed-pipelines-failure.json` alongside the original checkpoint and actual completed stages. The final delivery should use the successful result, selected source identity, original output digest, and customer guide. Preserve the private journals with the operation rather than embedding them in a customer package.

## Provider source

The fixture follows the official SDK at [Unstructured Python Client commit ba25d2537151e0cbd6bdfadd97167a47f1e7d948](https://github.com/Unstructured-IO/unstructured-python-client/tree/ba25d2537151e0cbd6bdfadd97167a47f1e7d948), including its Jobs create/get/details/list/cancel/download operations and `JobInformation`, `JobDetails`, and node-file models.

Current official endpoint and limit references:

- [Create a local-file job](https://docs.unstructured.io/api-reference/api/job/create-job)
- [Managed workflow overview and local-file limits](https://docs.unstructured.io/api-reference/workflow/overview)

The maintained configuration enforces at most ten input files and 50,000,000 bytes per file. Its local account/API gate spaces creation requests by at least one second. The provider reports scheduled overflow beyond its current running-job capacity.
