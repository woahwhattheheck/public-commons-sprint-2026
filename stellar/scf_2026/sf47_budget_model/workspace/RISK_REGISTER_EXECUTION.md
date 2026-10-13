# Delivery Risk original execution owner

This owner runs the maintained risk course and its browser companion against one explicitly selected original SF47 installation. It creates a separate private WALKTHROUGH receiving workspace from the supplied original scenario; it never modifies the earlier Contributor case.

## Complete selection

Use schema `stellar-forge.sf47-risk-execution.v1` and a stable operationId. Required fields are repositoryRoot, outputDirectory, sourceManifest, scenario, python, node, browserScript and browser. sourceManifest/scenario/python/node are complete absolute path/bytes/SHA256 descriptors. sourceManifest contains the exact repository-relative files array with bytes/SHA256/mode, including every current original BOOT_FILES member, operations_walkthrough.py, operations_risks_walkthrough.py, RISK_REGISTER_RECEIVING.md, this execution owner and the exact browser companion. The Python and Node original source selections remain unchanged by the receiving files.

browser has playwrightModule, executablePath, playwrightSha256 and executableSha256 from the actual selected runtime. browserScript is the workspace companion's basename. Browser runtime acquisition is outside this command; it never downloads a replacement runtime or substitutes another host.

The optional library object selects the complete current unchanged three-file Library helper cohort: helperDirectory and files (full descriptors for library_upload.py, library_hosted_apps.py and library_file_transfer.py). An optional retained target identifies an existing original saved item and observed expected_current_version. Without it the first closed archive is a create, and a subsequent completed result provides the same item identity for replacements. Omitted or zero current version is retained as returned, never invented.

Keep source and output as separate non-overlapping roots. Output must be an owned 0700 directory. The program checks source/runtime before original domain writes and holds one original flock guard through host, course, browser, actual child close, cold reopen, archive and save.

## Run and resume

Run the selected interpreter:

    python -B operations_risks_execution.py --input /absolute/private/input.json

The first host uses the original server.create_server and managed_launch selection/require_selection/retain_launch functions. Its actual port is saved before serving. All resumed and cold-reopened hosts select that same port and verify the original origin. The original Workspace lock prevents competing database writers. A stale external listener is not borrowed.

The owner starts one child for the complete native course, then one browser child holding an inherited duplicate of its guard. Each child has a create-only input/stdout/stderr directory. The parent forwards the first stop signal to the same child and retains it through its actual close. The browser's original Chromium/context/download owners drain before the Python owner closes the host. No two-second kill is applied to this nested owner.

After the browser finishes, this owner checks every manifested file, the closed candidate and its closure, then calls the unchanged native verified_archive for all three ZIPs. It validates each original risk review, the immutable first two editions, selected document bytes and the actual third command event. NATIVE_ARCHIVE_VERIFICATION.json retains these complete checks.

The original host drains all HTTP threads, retires its managed launch and closes its original Workspace. A second actual host opens the same private state and same port. The course's fresh-process verify checks the original and both received cases. That host also closes completely before packaging.

NATIVE_OUTCOME.json is frozen only after the complete native/browser/ZIP-validation/cold-reopen course and both host closures. Once present, a save-only continuation verifies those original outputs and reuses the retained pending archive without starting a host or browser.

Resume with the exact same input. The native course retains its requests and result, the browser retains its exact third-edition command and original downloads, and the execution owner retains every child attempt. Reentry never substitutes new native commands for an accepted course.

## Artifacts and durable save

EXECUTION_SELECTION.json retains the complete immutable input. EXECUTION_JOURNAL.json retains all original child attempts and managed host lifetimes. Each closed archive includes the original workspace, complete native and browser outcomes, immutable sources attached to the case, native ZIPs and full attempt logs. Browser profiles, caches and screenshots are not delivered. Repository-backed code is excluded; the complete source manifest and original Git revision provide source reacquisition.

Archives are private full-state handovers and contain authentication material required for this installation's recovery. They must remain in the authorized private destination. They are not public source exports.

With the library cohort selected, the owner invokes the unchanged full upload workflow once for the closed archive, saves its exact request and original ordered result under upload-state, and emits every ordered result before aggregate failure. A passive observer retains the exact original prepare/finalize request and response envelopes under upload-state; an observer failure never prevents or changes the original delegate invocation or result. Provider/helper state stays outside the case archive. An existing request without a returned result is retained for reconciliation before any second upload. It does not rerun a native case to recover a save. Ordinary successful successors use the original returned file identity and actual observed version.

The final immutable closure receipt is published only after the execution guard's owned descriptor closes. It identifies the complete closed ZIP and save result. Native or browser failures still produce an interrupted closed-case archive only after all actual owners drain. A source-level prepared package is not a completed runtime result.

## Bounded runtime identity checks

Runtime and corrected-source identity checks read the complete regular file through a 128 KiB hash window. They preserve the selected byte count, SHA256, mode and descriptor/path inode identity, and reject size, modification-time or change-time drift during the read. They do not retain full interpreter or Chromium binaries in memory. Original application source still receives complete member verification. This reduces transient verifier allocations; it does not provide memory for Chromium when the shared host is already full.

## Explicit execution continuation of an existing case

An interrupted original case may need a correction to this owner and its browser companion while its accepted domain course and source selection remain pinned. The optional `--execution-continuation` argument points to a private JSON descriptor `{path,bytes,sha256}` of a complete sidecar. Ordinary invocation retains its original source checks and behavior.

The sidecar schema is `stellar-forge.sf47-risk-execution-continuation.v1`. Its top-level fields are:

- `operationId`: the original execution input's operationId.
- `original`: exact absolute path/bytes/sha256 descriptors named `sourceManifest`, `executionInput`, `executionSelection`, `executionJournal`, `browserSelection` and `browserJournal`.
- `corrections`: exactly `python` and `node`. Each has the original repository-relative `repositoryPath` and complete `original` and `current` descriptors with `path`, `bytes`, `sha256` and integer permission `mode`.
- `reason`: the concrete execution correction.
- `sourcePublication`: the real repository, reachable source commit or complete source-packet identity, and selected leaf identities needed to reacquire the corrected source.

The Python correction selects `operations_risks_execution.py`; the Node correction selects the original `browserScript`. Both original files must still match the unchanged full manifest. Put corrected complete source in a separate source directory outside both the original repository and private case. The original scenario, full source manifest, execution input and browser SELECTION remain byte-for-byte unchanged.

The outer operation and native course use different original identifiers. The sidecar operationId binds the outer execution input. The native UUID prefix remains bound by the original native handover and browser SELECTION. The continuation does not rename either operation or manufacture a new request identity.

Before constructing the case owner or rewriting a journal, the parent acquires the original execution guard and publishes these exact files beneath `execution-continuations/<sidecar-sha256>/`:

1. `prior-browser-journal.json`: complete exact predecessor selected by the sidecar.
2. `prior-execution-journal.json`: complete exact parent predecessor.
3. `execution-continuation.json`: exact selected sidecar bytes.
4. `ADOPTED.json`: schema `stellar-forge.sf47-risk-execution-continuation-adopted.v1` and `executionContinuation:{reference,document}`.

ADOPTED is the final publication, after both predecessors and the sidecar are retained. A failed admission leaves the original journals unchanged. Reentry verifies the retained predecessors and record instead of interpreting an advanced journal as the original snapshot.

The parent passes the sidecar descriptor to the same selected browser child. The browser verifies both corrected modules, unchanged complete original source and stable selection, exact ADOPTED and both predecessor snapshots. Its journal, immutable result candidate, completed result and every closure carry the same `executionContinuation:{reference,document}` separately from the original selection. The parent checks those records before accepting the three native ZIP exports.

Run the corrected complete owner directly with the original input:

```sh
SELECTED_PYTHON -B /absolute/corrected-source/operations_risks_execution.py \
  --input /absolute/original-preparation/RISK_EXECUTION_INPUT.json \
  --execution-continuation /absolute/private/execution-continuation-reference.json
```

Do not rerun preparation with new packets over the existing selected source. The retained native course result republishes or verifies its original accepted requests; the resumed browser retains its original draft, third-edition request and download journal. If the interrupted browser never committed its third command, the same declared browser course performs that original assigned action once through the operator controls.

The existing guard, fixed host port, actual installation identity and full owner drain remain authoritative. Before a replacement browser launch, the companion reconciles all recorded prior processes and performs a complete census for the original attempt profiles. A killed Node process does not itself prove its browser descendants have closed. Reclaim shared capacity through its actual owner before repeating a run that was interrupted by memory exhaustion.

The closed private case includes the continuation metadata and exact predecessor journals. Git-backed corrected code remains in the source publication. The original source manifest stays unchanged, and the complete private case continues the existing saved file and observed version through the unchanged upload helper. The continuation record accompanies interrupted as well as completed outcomes.
