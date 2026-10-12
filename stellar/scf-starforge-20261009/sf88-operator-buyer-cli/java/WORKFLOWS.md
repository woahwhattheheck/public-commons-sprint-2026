# Java acquisition and workspace recovery

The Java customer can receive a merchant handoff, review exact budgets, prepare
the original configuration, initialize and execute a reviewed acquisition,
retrieve its paid file, finalize accounting, deliver its output, and recover
the complete customer workspace. These are the original Node acquisition and
SF88 workspace commands exposed through the maintained shared bridge.

## Select the customer workspace

Build the Java JAR as described in [README.md](README.md). Select an installed
runtime containing the maintained Node acquisition and recovery modules and
the shared bridge from the same source edition.

~~~java
Buyer buyer = Buyer.builder(
        Path.of("/srv/starforge/runtime"),
        Path.of("/srv/customer/state/application"))
    .callsDirectory(Path.of("/srv/customer/calls"))
    .build();

AcquisitionWorkspace acquisitions = buyer.acquisitions(Map.of(
    "directory", "/srv/customer/state/workspace",
    "configsDirectory", "/srv/customer/state/workspace/configs",
    "operatorSettings", "/srv/customer/state/operator-settings.json",
    "temporaryDirectory", "/srv/customer/calls"));
~~~

All paths are absolute canonical paths on the existing operator host.
The calls directory must already exist outside the selected source tree.
The native workspace selection can omit optional settings that are already
recorded in the workspace. Opening either handle leaves absent buyer state
absent, which permits recovery when the original state root has been lost.

Selection keys have their original Node meanings:

| Key | Meaning |
| --- | --- |
| directory | Original acquisition workspace. Required for live workspace commands. |
| configsDirectory | Optional original configuration directory. |
| operatorSettings | Optional original operator settings file. |
| paidFileClaimEnvs | Host-selected claim environment variable names, at most 32. |
| temporaryDirectory | Existing parent for the Node command's temporary directory. |
| resultLimit | Original acquisition result ceiling, 1 MiB through 256 MiB; default 32 MiB. |

The Java bridge has its own result ceiling, 64 MiB by default. A failed workflow
retains its full original result in the error and completion envelope, so size
the Java limit for that envelope when selecting unusually large native results.
File delivery uses the original native destination rather than this metadata
buffer.

## Receive, review, execute, and deliver

[CompleteRequest.java](examples/CompleteRequest.java) is an executable customer
journey. It receives an existing merchant request file, reviews the selected
offer with decimal-string atomic budgets, prepares the original configuration,
saves a runbook draft, initializes the exact reviewed revision, and inspects its
plan. Its execution mode then runs that plan, finalizes its original accounting,
previews and downloads the response, and exports the acquisition report.

The workspace selection JSON contains the keys above. The output directory is
new, with an existing parent; it receives private per-step native results,
the delivered response and the final report. For example:

~~~sh
java --class-path /srv/customer/build/starforge-buyer.jar \
  examples/CompleteRequest.java \
  /srv/starforge/runtime /srv/customer/state/application /srv/customer/calls \
  /srv/customer/workspace-selection.json /srv/customer/request-handoff.json \
  0 10000000 10000000 /srv/customer/delivery-2026-10-12 --execute
~~~

The final argument can be --prepare to create and inspect the reviewed plan.
Execution inherits the caller's real stdin for the original terminal approval.
The original native engine checks the requested operation, wallet, budgets,
review hash and plan hash. Atomic amounts stay decimal strings throughout.

For an existing acquisition, continue from its original ID:

~~~java
AcquisitionResult inspected = acquisitions.inspect(acquisitionId);
String planHash = Json.string(inspected.nativeResult(), "planSha256");
AcquisitionResult executed = acquisitions.execute(acquisitionId, planHash);
AcquisitionResult accounting = acquisitions.finalize(acquisitionId);
acquisitions.download(acquisitionId, operationId,
    Path.of("/srv/customer/delivery/response.bin"));
acquisitions.export(acquisitionId, "html",
    Path.of("/srv/customer/delivery/acquisition.html"));
~~~

The destination parent is an existing private directory. Native delivery creates
a new file and retains original digest and saved-output checks. Reopening the
same acquisition and inspecting or recovering it uses the original attempt.

## Receive a paid-file order

Receive the original merchant handoff, then review its current revision with
exact budgets, the destination filename, and a claim environment variable name.
The receiver makes the claim value available in the process environment.

~~~java
AcquisitionResult received = acquisitions.receivePaidFile(handoff);
String orderId = Json.string(received.nativeResult(), "id");
AcquisitionResult review = acquisitions.reviewPaidFile(
    orderId, expectedRevision, "10000000", "10000000",
    "report.pdf", "REPORT_CLAIM_TOKEN");
AcquisitionResult prepared = acquisitions.preparePaidFile(orderId, reviewSha256);
AcquisitionResult transfer = acquisitions.retrievePaidFile(
    acquisitionId, operationId, configSha256, handoffSha256);
acquisitions.downloadPaidFile(acquisitionId, operationId, deliveredProduct);
acquisitions.exportPaidFile(orderId, orderExport);
~~~

Use the review, acquisition identity, operation identity, configuration hash
and handoff hash reported by the original order and prepared acquisition.
The SDK passes those values through unchanged. Retrieve resumes the original
transfer; reset remains a separate explicit operation pinned to the same hashes.
DownloadPaidFile publishes the verified product. Download publishes the saved
checkout response. These are separate original resources.

## Operate all 31 acquisition commands

The Java methods return AcquisitionResult, with the full original map and typed
native completion and process fields. The CLI maps each command to the same
method through the acquisitions- prefix.

| Native command / CLI suffix | Java method | Required method selection |
| --- | --- | --- |
| state | state | Selected workspace |
| attach | attachRun | Original run directory |
| request | request | Request ID |
| receive | receiveRequest | Handoff file; optional filename |
| review-request | reviewRequest | ID, offer index, total/day atomic strings |
| prepare-request | prepareRequest | ID, review hash |
| paid-file | paidFile | Paid-file order ID |
| receive-paid-file | receivePaidFile | Handoff file; optional filename |
| review-paid-file | reviewPaidFile | ID, expected revision, budgets, filename, claim environment name |
| prepare-paid-file | preparePaidFile | ID, review hash |
| retrieve-paid-file | retrievePaidFile | Acquisition ID, operation, config and handoff hashes |
| reset-paid-file | resetPaidFile | Acquisition ID, operation, config and handoff hashes |
| download-paid-file | downloadPaidFile | Acquisition ID, operation, new destination |
| export-paid-file | exportPaidFile | Order ID, new destination |
| draft | draft | Draft ID; optional revision |
| save | save | Manifest; optional ID and expected revision |
| initialize | initialize | Draft ID, expected revision, review hash |
| inspect | inspect | Acquisition ID |
| execute | execute | Acquisition ID, plan hash; optional operation |
| recover | recover | Acquisition ID |
| unlock | unlock | Acquisition ID, recorded owner PID |
| finalize | finalize | Acquisition ID; optional operation |
| bind-accounting | bindAccounting | Acquisition ID, operation, accounting workspace |
| preview | preview | Acquisition ID, operation |
| download | download | Acquisition ID, operation, new destination |
| export | export | Acquisition ID, json/html/csv, new destination |
| export-request | exportRequest | Request ID, body/handoff, new destination |
| backup-review | backupReview | Exact state root |
| backup | backup | State root, new bundle, review hash, quiesced, optional passphrase environment name |
| verify | verify | Bundle, optional record hash/passphrase environment name/Python |
| restore | restore | Bundle, optional record hash/passphrase environment name/Python |

The draft and save overloads distinguish an omitted revision from an explicit
zero. Optional null values are omitted from the request. Original manifest
fields and exact JSON numbers remain available in the immutable result maps.

For CLI operation, --acquisitions supplies an absolute selection JSON file;
--options supplies an absolute file containing the native method option map.
--id supplies the requested identity. An ID inside the method option file is
also supported when --id is absent.

~~~sh
java -jar /srv/customer/build/starforge-buyer.jar \
  --runtime /srv/starforge/runtime --state /srv/customer/state/application \
  --calls-dir /srv/customer/calls \
  acquisitions-inspect --acquisitions /srv/customer/workspace-selection.json \
  --id original-acquisition-id --save-result /srv/customer/inspection.json
~~~

Option maps use the original names: acceptIndex, totalAtomic, dailyAtomic,
expectedRevision, reviewSha256, expectedPlanSha256, only, operationId,
configSha256, handoffSha256, stateRoot, output, quiesced, passphraseEnv,
bundle, expectedRecordSha256 and python as applicable. Path values are strings.
Claim and archive options carry environment names; their values stay in the
host's environment.

## Back up the acquisition workspace

First select and review the complete original state root. Quiesce its existing
writers for the archive operation, preserving all native acquisition and
accounting roots selected by the review.

~~~java
AcquisitionResult review = acquisitions.backupReview(stateRoot);
String reviewHash = Json.string(
    Json.object(review.nativeResult().get("profile")), "reviewSha256");
AcquisitionResult archive = acquisitions.backup(
    stateRoot, bundle, reviewHash, true, "SF88_BACKUP_PASSPHRASE");
String recordHash = Json.string(archive.nativeResult(), "recordSha256");
acquisitions.verify(bundle, recordHash, "SF88_BACKUP_PASSPHRASE",
    Path.of("/usr/bin/python3"));
~~~

The native backup enforces the review hash and explicit quiescence. Place the
bundle and Java and Node temporary directories outside the selected state.
The archive records its original canonical restore root.

## Recover the complete application workspace

WorkspaceRecovery exposes the four maintained SF88 operations. Its selection
adds the Buyer's application state directory to the original native include
list, so choose a stateRoot containing the application state and all selected
native dependencies.

~~~java
WorkspaceRecovery recovery = buyer.workspaceRecovery();
WorkspaceRecovery.Selection selection = new WorkspaceRecovery.Selection(
    workspaceDirectory, stateRoot, inboxDirectories, additionalDirectories);
WorkspaceRecoveryResult inspected = recovery.inspect(selection);
WorkspaceRecoveryResult snapshot = recovery.snapshot(
    selection, bundle, true, "SF88_BACKUP_PASSPHRASE");
WorkspaceRecovery.Archive archive = new WorkspaceRecovery.Archive(
    bundle, Json.string(snapshot.nativeResult(), "recordSha256"),
    "SF88_BACKUP_PASSPHRASE", Path.of("/usr/bin/python3"));
WorkspaceRecoveryResult verified = recovery.verify(archive);
~~~

For recovery after loss of the source, construct Buyer with the same original
application path and an existing calls parent outside that source, then invoke:

~~~java
WorkspaceRecoveryResult restored = buyer.workspaceRecovery().restore(archive);
~~~

Construction, verify and restore do not create the absent state directory.
The authenticated native archive selects the original canonical root.
The original restore checks that destination and publishes the recovered state
with the original file permissions and identities. The API exposes the full
native restore result for reopening with the Node, Java or other customer SDK.

The four CLI commands are workspace-inspect, workspace-snapshot,
workspace-verify and workspace-restore. Each takes --options ABS_JSON.
Inspect and snapshot options are directory, stateRoot, inboxes and include;
snapshot also takes output, quiesced and an optional passphraseEnv.
Verify and restore use bundle, optional expectedRecordSha256,
passphraseEnv and python. --acquisitions is unnecessary for these four calls.

## Completion and interruption

A native publication may complete before its caller receives a cancellation,
timeout or cleanup error. Read the retained original result before deciding
how to continue:

~~~java
try {
    acquisitions.restore(bundle, recordHash, "SF88_BACKUP_PASSPHRASE", python);
} catch (BuyerException failure) {
    if (failure.result() != null) {
        AcquisitionResult original = AcquisitionResult.from(failure.result());
        observe(original.nativeResult(), original.completionReported(),
            original.process().original());
    }
    throw failure;
}
~~~

For the four workspace calls, use WorkspaceRecoveryResult.from in the same
pattern. Native completion, process exit, interruption and cleanup outcomes
remain separately inspectable. Java reads the exact private response identity
after termination and before restoring the caller's interrupt status.

The Java invocation path creates only its own private call directory outside
the selected workflow source. Successful calls clean it. Failed calls retain
their request, original result and diagnostics at BuyerException.invocationDirectory.
Continue using the original command identity and native state after inspection.
