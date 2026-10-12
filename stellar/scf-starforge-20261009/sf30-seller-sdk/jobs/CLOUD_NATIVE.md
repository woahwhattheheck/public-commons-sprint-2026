# Run the retained paid-jobs application on an existing cloud worker

The foreground payload [cloud-native.py](cloud-native.py) deploys the complete
public Starforge source, selects its original native payment and schema
dependencies, and continues the retained application through the merchant,
customer library, and native checkout. The existing Commons CloudJobs/native
operator owns the worker, admission, command record, logs, stop and file
transport. Run this payload once inside that operator's accepted command.

This is the continuation of the original CKQrif prepared report. An earlier
Muse run completed the original merchant journey on source
001659bfb4111b33aef2175a93ad981958847058, with two paid protocol-fixture
purchases, cancellation, retry and reopening. Its successful older driver
removed its temporary merchant directory. The CKQrif state supplies the
retained application needed for the customer and checkout continuation.
Keep the earlier accepted result attached to its original run.

## Adopt an already completed core

When the original receiving owner has completed the merchant journey, use the
[completed-core capture and continuation](COMPLETED_CORE.md). The runner accepts
--input-mode completed-core, restores the captured actual application paths and
adopts the exact earlier result before customer/checkout. Select --approval browser
to exercise Request through the original browser approval and result workflow.

The remaining instructions describe the original prepared-capsule mode. Preserve
its existing operation when using that mode.

## Run the complete installed merchant release

The current release can carry the same completed merchant through input-file
intake, browser checkout, resolution, the real merchant MCP endpoint and complete
receiving, then build and install the release and reopen that merchant through
Applications. Select all of these stages in the same existing foreground:

~~~sh
python3 /absolute/worker/cloud-native.py \
  --workspace /absolute/worker/scf-release-receiving \
  --out /absolute/worker/scf-release-receiving/results \
  --source-commit COMPLETE_MERGED_SOURCE_COMMIT \
  --capsule /absolute/inbox/CKQrif-completed-core.tar.gz \
  --sha256 9fb48baeeb071bb680399bb8a0d6fa4668a8e6fccb96dda339134d2453c1228c \
  --input-mode completed-core --approval browser --input-files --applications \
  --validation-operation SCF-RELEASE-RECEIVING-0B8D-20261012-32F59 \
  --node /absolute/node24/bin/node \
  --npm /absolute/node24/bin/npm
~~~

Use `--node-version 24.20.0` with an existing Node 24.20.0 installation, or keep
the original default 24.19.0. The exact selected version and executable must match;
the original runtime inspector still checks every selected package on that host.

The completed-core capsule is the existing 11,088-byte capture `F0C899G7ZUK`.
Its original report and recovery jobs, original application paths and source
identities remain attached to that capture. The validation operation identifies
this release run; `operation` continues to identify the original paid-job family.
Use the actual current native operator's project, executable and input paths.

Select a source commit containing this runner and the complete merged merchant,
Applications, agent and receiving changes from PR1800. The operator runs this
whole command in an available equipped Linux VM. Collection of an earlier
accepted source run can continue independently through its own worker record.
Keep each live operation with its original native controller.

`--input-files` requires browser approval. The checkout driver uses the original
6,000-row invoice ledger and supplier pricebook, continues the original input
desk and retained upload chunks, then receives the resulting resolution and
accounting through the real MCP endpoint. The runner requires all three
completed results before it enters installed Applications.

`--applications` builds the selected Git commit through the maintained
`distribution/build.mjs`, installs that exact original archive through
`runtime-install`, inspects all original package files and loads the selected
dependencies. It shares the existing npm cache with the source-native stages.
The selected profile retains native payment dependencies, the schema feature,
Linux operator support and the compatible Stellar SDK 16.3.1 pin.

The installed command initializes its private runtime workspace and attaches the
actual READY installation. The returned runtime ID goes into the original
`jobs-merchant-receive` input. That installed receiving command reviews and saves
the completed invoice merchant, starts it, reads the original job/result and all
configured operator desks, stops and drains the service, then reopens the same
application for a second lifetime. The source, paid job and result remain the
same across those starts.

The foreground retains the native build, prepare/recovery, installation,
inspection, attach and receiving commands with their actual results. It resumes
an interrupted build in its original output, resumes the original installation
or uses the installer's fresh-directory recovery for an interrupted preparation.
The Applications receiver retains its original reviews, saved application,
request IDs and observed service lifetimes. Immutable retained inputs publish
from fully flushed temporary files; interruption cannot leave a partial final
archive or receiving input. Completed-core restoration uses the same atomic
publication. A partial installation plan is recovered through the original
installer using its matching retained preparation record. The installed receiving step has 90 seconds to finish
its original stop/drain path when the native controller forwards shutdown.

An existing validation run reopens only with the same source commit, input
capsule, approval selection and selected stages. A completed browser-only
checkout cannot satisfy an input-file run. A new source selection gets its own
native validation operation and private project.

The same three outer artifact selections return the complete result. Additional
files inside `native-return.tar.gz` include:

| Retained file or directory | Content |
| --- | --- |
| `applications.json` | Complete installed receiving result and actual source/runtime identities. |
| `applications/source.tgz` | The exact merchant archive built and installed on this worker. |
| `applications/distribution.json` | Original package builder result. |
| `applications/runtime-files/` | Original installation plans, selected profile, lock and npm logs. |
| `applications/runtime-inspection.json` | Complete original source and dependency inspection. |
| `applications/workspace/` | Original Applications selections and native operation records. |
| `applications/receiving/` | The two service lifetimes, original job/result bytes, ledger and final receiving. |

The `continuation.json` in that directory names the actual selected workspace
if an interrupted initialization used a later private directory. The installed
dependency tree remains at its recorded runtime path on the VM. Its original
archive, profile and lock are included for subsequent installation and transfer.

## Worker input

Use a private project directory owned by the worker. The output directory must
be a child of that project so the original native artifact transport can select
it. The worker needs Linux, Python 3.11 or later, Node **24.19.0 or a newer explicitly selected Node 24 release**, npm, git,
OpenSSL and util-linux flock. Reserve at least **768 MiB** for the third
phase's two Node processes, Python, native modules and application worker.
Provision these components through the existing worker controls.

Supply the source commit containing the merged checkout, the original buyer
cancellation support, both native continuation drivers, and the Python PTY
shutdown correction. The complete source at ae5c8acf588a7f577aedac5c252b2a48cf4c00fc
contains the merged product and all three drivers; use its descendant that
includes this payload and shutdown correction for worker execution.

The original input carrier is:

| Field | Value |
| --- | --- |
| Operation family | SCF-DURABLE-PAID-JOBS-0B8D-20261011 |
| Input archive | CKQrif-input.tar.gz |
| Archive bytes | 3317 |
| SHA-256 | 12ab114b63d69650130d975957590a2bc865e99e6d596ada0a82810ac7b29ff8 |
| Retained directory | /dev/shm/0b8d-scf-paid-jobs-native/sf30-paid-jobs-CKQrif |
| Original report | report:2026.10, PREPARED, revision 1 |
| Input source | Seven original files captured under the merchant lease |

Transfer the carrier through the existing private worker file transport. It
contains its own exact file manifest and source binding. Preserve its bytes.
The merchant store includes the application's absolute path, so the payload
restores the original directory at the exact path above. A different
application path would change the original merchant source identity.

The captured files include the original merchant configuration, application,
retained configuration/application bytes, source descriptor, merchant lock and
prepared report. Capture occurred while root held invocation custody and the
merchant had no active native process. The report had no submission time or
settlement. The payload checks the capsule hash, every member's size/hash,
canonical paths and the original report before continuing.

## Invoke through the original native operator

Supply actual absolute executable and project paths. For example, the accepted
native command's argv can be:

~~~sh
python3 /absolute/worker/cloud-native.py \
  --workspace /home/user/scf-paid-jobs \
  --out /home/user/scf-paid-jobs/results \
  --source-commit COMPLETE_SOURCE_COMMIT \
  --capsule /home/user/inbox/CKQrif-input.tar.gz \
  --sha256 12ab114b63d69650130d975957590a2bc865e99e6d596ada0a82810ac7b29ff8 \
  --node /absolute/node24/bin/node \
  --npm /absolute/node24/bin/npm
~~~

The existing operator retains the same worker/job record for that complete
foreground command. Pass its original memory and artifact selection controls
around this argv. Select these paths relative to the project on both successful
and failed completion:

- results/run-result.json
- results/run-artifacts.json
- results/native-return.tar.gz

The payload uses a local file lease to keep two callers from writing the same
project concurrently. That lease does not submit jobs, create a worker or
schedule later commands. The original worker's process custody remains the
authority for inspecting an interrupted command before invoking it again.

## Complete source and dependency installation

The payload fetches the supplied immutable commit from the original public
repository and checks out its complete tree. It preserves the original
Python and JavaScript import closure, schemas, browser assets and component
manifests. A changed tracked source file is retained for review rather than
overwritten during a later fetch.

The dependency input comes from the checked-out original
distribution/runtime-profile-cli.mjs:

~~~sh
runtime-profile resolve --source-root ORIGINAL_SOURCE \
  --native --feature schema --operator \
  --pin @stellar/stellar-sdk@16.3.1
~~~

The original profile creator writes its exact package selection to a private
directory named by its profile ID. That selection includes the original x402
2.28.0 declarations and schema engine; the maintained profile determines the
complete selected list and import probes. The payload invokes normal npm
installation with lifecycle scripts disabled. If an original lock already
exists, installation uses npm ci. Add --offline to use the worker's existing
npm cache.

The source's private node_modules link points at that generated profile's
dependency directory. The original runtime inspector verifies the profile
against the selected source and loads its declared entries. A ready existing
installation is reused. The return bundle includes the exact original
profile, package.json, package-lock.json and observed inspection.

When a reviewed source correction changes the declared profile, the new
profile gets its own directory and the stopped payload switches only its own
dependency link. The earlier profile and lock remain in the project. The
native phase records retain their actual source commit and profile ID.

## Source-native phases and installed Applications

| Phase | Original driver | Retained output |
| --- | --- | --- |
| Merchant and purchased jobs | sf30-seller-sdk/jobs/native-journey.mjs | results/baseline.json |
| Customer library continuation | sf88-operator-buyer-cli/job-workspace/continuation.mjs | results/customer.json |
| Original SDK checkout, optionally input files / resolution / agent | sf88-operator-buyer-cli/job-workspace/checkout/native-continuation.py | results/checkout.json |
| Complete installed merchant, when selected | Original build/runtime-install commands and installed jobs-merchant-receive | results/applications.json |

The first driver resumes the original prepared report with
SF_JOBS_JOURNEY_RESUME and keeps its merchant directory. It uses the original
SF30/native x402/SF31/SF88/SF98 components, stores the accepted capabilities
before buyer preparation, and exercises application result delivery and
same-purchase worker recovery.

The customer continuation consumes those same two purchased jobs. It opens
their original buyer records, retrieves status and verified result bytes,
adds the outputs to the existing resource library, edits a note, exports a
collection, receives it and reopens the private workspace.

The final phase uses the original Node SDK's review, execute and recover
paths. Its original Python approval bridge reserves the fixture allowance in
the original SQLite governor ledger. It then takes the actual accepted
BuyerResult into the customer workspace, retrieves the completed output,
receives the collection and reopens the same checkout.

The final checkout uses an explicitly named derivative fixture with the
contract-shaped disposable asset required by the unchanged original governor.
It retains the original report's configuration and application hashes.
Its network fixture consists of the original SF31 explicit CONNECT transport,
verified TLS for jobs-merchant.example, a local facilitator and a disposable
signer. The original SF62 console runs in a real PTY. The launcher answers the
exact fixture approval after checking its native review. Every result records
that fixture boundary and the actual native sources.

## Continue the same operation

On reconnect, inspect the original native worker record first. If the command
still runs, use its existing logs and eventual artifact transport. Completed
phase outputs are reopened and reused; later phases continue from the same
merchant and customer directories.

The worker does not recreate an already attempted baseline purchase. A missing
baseline output with an advanced original record produces the concrete state
for source-level recovery. Its full private record remains in the return
bundle. An incomplete customer or checkout phase keeps its existing buyer,
ticket, native attempt, reservation and collection state for its original
driver's recovery behavior.

CloudJobs stop is forwarded to the current original foreground driver. The
checkout's Python launcher converts SIGINT/SIGTERM into its existing PTY
cleanup and drains that child group. The outer payload allows that cleanup to
finish before escalating a remaining owned child group. The source operation
and private data remain available after termination.

## Receive the actual result

The existing file transport returns native-return.tar.gz with the generated
run-result.json, run-artifacts.json, available phase outputs, command logs,
selected runtime profile/lock and retained-state.tar.gz.

run-result.json reports the actual source commit, original input identity,
runtime versions, installed profile, per-phase argv, exit code, elapsed time,
result hash and completed or failed state. run-artifacts.json names each
returned file relative to the original project and records its byte count and
SHA-256. The payload's final stdout also gives the outer archive's path, size
and digest for the existing native artifact reader.

Use the original worker's artifact hash and file-read controls to receive this
bundle into a private destination. Read each available original phase JSON
and its command log. Match the result source and input identity to the
accepted command, then use the retained merchant and customer stores to
continue a concrete failure or deliver the completed application.

The returned state archive contains private claim capabilities, native
operation records and disposable fixture keys alongside the application
outputs. Keep it on the established private worker/result route. The small
phase summaries carry the public engineering outcome and the exact fixture
scope for the merchant, Applications, distribution and grant owners.
