# Databento migration in Applications

Applications opens the complete Databento analyst workbench from a selected
READY runtime. It keeps the same original source editions, captured bytes,
review decisions, output columns, saved previews, history and delivery state.
The original managed worker owns the application process; the original Python
workspace owns its data and native work.

The maintained command is **databento-workspace** and the catalog choice is
**Databento migration** (kind **databento-migration**). The selected runtime must
contain the completed Databento source, browser assets and managed launch module.
Use the normal maintained source installation. An older installation remains
its actual older source until the existing installer adopts a newer release.

## Select the existing workbench

Choose the directory originally created by:

~~~sh
starforge databento-workspace create \
  --dir /absolute/private/databento-workbench \
  --dataset /absolute/prepared/workspace.json
~~~

An operator-supplied deployment plan can be selected through the original
--plan option. Without one, the saved configuration retains
LOCAL_PREVIEW_UNCONFIGURED. Opening Applications makes no provider call or paid
request and does not change that configuration.

The directory contains operation.json, the original workspace/ directory and
any original source materialization. Select this outer workbench directory in
Applications. The inner workspace/ contains the native workspace.sqlite3,
content-addressed files, source revisions, previews and release records.

A previously received portable workspace also works:

~~~sh
starforge databento-workspace import \
  --dir /absolute/private/received-databento \
  --bundle /absolute/handoff/workspace.python-workspace.json
~~~

This is the original create-only receiving command. It retains the original
workspace identity, history, source and completed outputs. To resume an existing
workbench, select its existing directory; importing again is unnecessary.

## Review, save and start

Open the existing runtime workspace and select its READY runtime. In
**Applications → New application**, choose **Databento migration**.

| Setting | Meaning |
| --- | --- |
| Initialized Databento workbench | The original private outer directory containing operation.json and workspace/. |
| Local port | Use 0 to let the native loopback server choose an available port. A fixed port retains its exact selection. |
| Private environment JSON | Optional original host environment. Values stay in the original private file. The saved merchant declaration remains authoritative for Python and native execution settings. |

**Review application** inspects the selected runtime, original workbench marker,
immutable workspace identity and direct native/browser launch source.
It does not open a producer model, execute Python, run an acquisition, recover a
preview or modify a saved revision.

**Save application** retains that review and uses the existing managed adoption
for the exact selected runtime. Its original installation and operation records
remain in the shared runtime workspace. If the reply is lost, reopen the saved
application or repeat the same original save request ID.

**Review start → Start reviewed application** launches the original
databento-workspace managed command. It checks the selected source against the
source that actually executes, opens the original Python model and serves the
original Databento interface through the existing authenticated Python server.

**Open application** appears only after the shared serialized output observer
has read this native startup record and verified the listener's authenticated
/api/state response. The URL belongs to that actual operation; it is not
constructed from a configured port or copied from an example. The native source
console and the Databento interface share the same original server and token.

## Work in the original interface

The application retains the complete existing analyst workflow:

1. Inspect the source/account/batch inventory and select an original edition.
   Full inspection streams all selected original records before returning the
   requested page. Follow the original page continuation to inspect more rows.
2. Review exact records, source metadata, instruments, sessions and findings.
   Decimal and nanosecond text retain their original representation. An unknown
   currency remains unknown.
3. Use comparison only for explicitly comparable original scopes and roles.
   Separate reference/public-sample sessions remain separate source editions.
4. Append named source, edition, instrument or finding reviews and save the
   output-column mapping. The native saved revision is the source of each new
   execution.
5. Run the desired saved-revision inspection or build explicitly. Reopening
   Applications does not run it. A lost execution reply is reconciled through
   its original operation ID and retained preview.
6. Download the original saved report or customer files. The complete mapped
   dataset is streamed by the original handoff CLI from the selected saved build.
7. Use native History to inspect an earlier source revision or restore it as a
   new revision. Normal source edits and history growth keep the same workspace
   identity and do not invalidate the saved application.

The browser's existing workspace-specific IndexedDB draft store preserves
unsaved edits and pending operations across page refresh. Applications does not
add a second draft store or move these edits into startup settings.

### Complete customer output

Select a completed build_migration preview in the original interface, then run
its displayed handoff command:

~~~sh
starforge databento-workspace handoff \
  --dir /absolute/private/databento-workbench \
  --preview ORIGINAL_COMPLETED_BUILD_ID \
  --out /absolute/new/customer-delivery \
  --audience customer
~~~

The original wrapper reconstructs that immutable saved source, streams the
complete selected edition through processor.py, verifies every output and
publishes a new delivery directory. A repeated identical handoff reads its
completed original result. Native preview output remains compact; complete
CSV and NDJSON are files rather than repeated page previews.

Customer output retains exact columns and safe source lineage. Private producer
review notes and the full source workspace belong to the operator handoff:

~~~sh
starforge databento-workspace handoff \
  --dir /absolute/private/databento-workbench \
  --preview ORIGINAL_COMPLETED_BUILD_ID \
  --out /absolute/new/operator-delivery \
  --audience operator
~~~

Follow the original [Databento workbench guide](../../sf30-seller-sdk/databento/WORKSPACE.md)
for complete acquisition, receiving, file identities and reopening. The
[customer warehouse guide](../../sf30-seller-sdk/databento/receiving/README.md)
covers exact streamed intake, committed-prefix recovery, named activation,
selection rollback, query, full export and independent warehouse backup/restore.
That receiver consumes the complete original delivery; Applications continues
to own the producer workbench process.

## Stop and reopen

Use **Stop** on the saved application's current operation. The existing managed
worker signals the original process. Its native server closes admission,
aborts and awaits any owned private previews, closes any seller session it owns,
and closes the original SQLite connection. The existing managed operation
records the outcome. Source revisions, failed and completed preview records,
customer files and historical selections stay in the same workbench.

Closing the runtime browser does not mean Stop. Open that same runtime workspace
again to inspect or stop the retained original operation.

After Stop completes, **Review start → Start reviewed application** creates a
new original managed run for the same saved application and workspace. The
server issues a new private token and URL. Open the current operation's link;
an old stopped listener is not reused.

If a launch response is lost or its worker is interrupted, open the same
Applications record and inspect its retained run. Use the existing
**Recover original operation** control for that operation ID. The shared
managed process-identity and recovery implementation owns the decision to
resume or close it. A new source import, database replacement, lock removal,
manual PID signal or repeated acquisition is not part of reopening this product.

The workspace identity includes its original directory and SQLite inode,
original marker bytes, workspace ID and creation time. Replacing that directory
or database with another copy is an explicit new selection and requires a new
review. Ordinary SQLite writes, source-head changes, reviews, retained previews
and release history are excluded from that launch identity.

## Original runtime CLI

The same shared lifecycle is available through the original runtime-workspace
CLI. Keep request JSON private and use the actual IDs returned by each step.

A new application-review request has this form:

~~~json
{
  "runtimeId": "ACTUAL_RUNTIME_ID",
  "kind": "databento-migration",
  "label": "Databento historical migration",
  "settings": {
    "workspaceDirectory": "/absolute/private/databento-workbench",
    "port": 0
  }
}
~~~

The original runtime workspace resolves the selected runtime ID to its retained
installation. Review and save through the existing commands:

~~~sh
starforge runtime-workspace application-review \
  --workspace /absolute/private/runtime-workspace \
  --request /absolute/private/application-review.json
starforge runtime-workspace application-save \
  --workspace /absolute/private/runtime-workspace \
  --request /absolute/private/application-save.json
starforge runtime-workspace application-connect \
  --workspace /absolute/private/runtime-workspace \
  --application-id ACTUAL_APPLICATION_ID
starforge runtime-workspace application-start-review \
  --workspace /absolute/private/runtime-workspace \
  --application-id ACTUAL_APPLICATION_ID
starforge runtime-workspace application-start \
  --workspace /absolute/private/runtime-workspace \
  --request /absolute/private/application-start.json
~~~

Save uses {requestId, reviewId} for a new application; start uses
{applicationId, requestId, reviewId}. requestId is a fresh UUID for a distinct
operation and remains the same when reconciling an uncertain reply. Start uses
the ID returned by application-start-review. The original application-connect
operation finishes any required managed adoption.

Inspect or recover the same retained run:

~~~sh
starforge runtime-workspace applications \
  --workspace /absolute/private/runtime-workspace
starforge runtime-workspace application-output \
  --workspace /absolute/private/runtime-workspace \
  --application-id ACTUAL_APPLICATION_ID --operation-id ACTUAL_OPERATION_UUID
starforge runtime-workspace application-recover \
  --workspace /absolute/private/runtime-workspace \
  --application-id ACTUAL_APPLICATION_ID --operation-id ACTUAL_OPERATION_UUID
starforge runtime-workspace application-stop \
  --workspace /absolute/private/runtime-workspace \
  --application-id ACTUAL_APPLICATION_ID --operation-id ACTUAL_OPERATION_UUID
~~~

The original [Applications guide](APPLICATIONS.md) describes the shared managed
adoption, current operation, private environment and runtime controls.

## Native binding and integration

For a read-only description of a selected workbench and native launch source:

~~~sh
starforge databento-workspace binding \
  --dir /absolute/private/databento-workbench
~~~

This returns stellar-forge.databento-workbench-review.v1 with workspace.sha256
and source.sha256. Applications computes and retains these identities itself.
Its launch command uses the existing command entrypoint:

~~~sh
starforge databento-workspace managed \
  --source-root /absolute/selected-runtime/source \
  --dir /absolute/private/databento-workbench \
  --expected-workspace-identity WORKSPACE_SHA256 \
  --expected-source-sha256 SOURCE_SHA256 \
  --port 0
~~~

The direct managed command prints one schema-first
stellar-forge.databento-workspace-startup.v1 line with status
DATABENTO_WORKSPACE_READY. It includes the selected and executed source roots,
their shared source hash, immutable original workspace identity, actual process
and instance IDs, and the two original private URLs.

The integration exports are:

| Interface | Purpose |
| --- | --- |
| databentoApplication(common) | Original catalog choice and fields. |
| prepareDatabentoApplication(settings, {inputPath, runtimeDirectory}) | Reviewed source, input identities, original argv and shared resource key. |
| databentoStartup(request, text) | Validate native startup, selected/executed source and authenticated live workspace. |
| inspectDatabentoWorkspace(directory) | Read-only original marker and SQLite identity. |
| inspectDatabentoLaunchSource(sourceRoot) | Hash the direct native launch and browser files. |
| prepareDatabentoManagedLaunch(options) | Validate the saved review before opening the original model. |
| databentoManagedStartup({launch, workspace, service}) | Bind the actual original listener and model to the reviewed launch. |

The shared Applications composer adds the catalog, original preparer branch and
serialized observer. The preparer carries resourceKey through the shared
selectedResourceKey field so two saved Databento applications cannot start
concurrent managed writers for the same original workspace. Native data access,
authentication, origin policy, source editing, payment semantics and process
recovery remain in their original implementations.
