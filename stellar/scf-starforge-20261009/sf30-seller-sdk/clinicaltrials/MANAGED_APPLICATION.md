# ClinicalTrials registry in managed Applications

Open the complete ClinicalTrials registry from the existing Starforge
**Applications** workspace. One saved application selects the original clinical
workspace, an existing Python interpreter and the maintained runtime. Review,
Save, Connect, Start, Open, Stop and recovery use the original managed release
and process operation.

The clinical console keeps the full study records, cohort progress, source
reviews, PRS documents and decisions, native dataset editions, publisher and
customer files. Its browser and attached merchant MCP share that one original
Python owner.

## Prepare the existing source and workspace

Select a complete maintained runtime containing the ClinicalTrials contribution,
the Applications provider registry and the original PRS leaf. The
**ClinicalTrials registry** card appears from that source's contribution. Its
provider path, source digest and declaring contribution appear in the existing
Applications provider inventory.

Use an existing Python 3.11 or newer environment with the declared PRS
requirements. The original [requirements file](requirements.txt) includes
[prs/requirements.txt](prs/requirements.txt). Follow the maintained
[Python runtime instructions](../../distribution/RUNTIME.md#clinicaltrials-registry-and-prs-python-dependency)
for that selected environment. Application review runs the original PRS doctor
with that exact interpreter and compiles its retained schema closure.

For a new working directory, initialize the original workspace:

~~~sh
starforge clinicaltrials --python /absolute/python-environment/bin/python \
  --workspace /private/clinical/registry init
~~~

To receive a saved ClinicalTrials customer packet into that new directory:

~~~sh
starforge clinicaltrials --python /absolute/python-environment/bin/python \
  --workspace /private/clinical/registry restore \
  --file /private/clinical/ClinicalTrials_Customer_Checkpoint.zip
~~~

For an existing initialized or received workspace, select its current absolute
directory. Its root and metadata remain private and operator-owned. The original
database and marker retain the workspace identity.

Inspect the binding before selecting it in Applications:

~~~sh
starforge clinicaltrials --python /absolute/python-environment/bin/python \
  --workspace /private/clinical/registry binding
~~~

This reads the saved directory, marker and database identity, verifies the
ClinicalTrials application marker through a read-only database connection, and
runs the original PRS doctor. It returns the selected Python, source hashes,
lxml/libxml versions, schema-set digest and one binding SHA-256. It uses the
original NDJSON identity inspector. Source acquisition and workspace actions
remain in the original clinical owner.

The binding excludes mutable study rows and review history. A new review,
captured page, PRS plan or dataset query therefore remains normal work within
the same application. A replaced workspace, interpreter, PRS runtime or source
requires a fresh application review.

## Review, save and open

Open the existing runtime console:

~~~sh
starforge runtime-workspace serve \
  --workspace /private/runtime-console --port 0
~~~

Use its private printed URL and select the original READY installation. The
[Applications guide](../../distribution/runtime-workspace/APPLICATIONS.md)
covers the same runtime attachment and managed-home selection.

1. Choose **Applications → New application → ClinicalTrials registry**.
2. Select the **Original ClinicalTrials workspace** and **Existing Python
   executable**. The Python path can select its existing virtual environment.
3. Optionally choose a new **Console connection file**, such as
   /private/clinical/clinical-console.url. Select **Local port** 0 for an
   available listener. The original private environment file is available for
   the configured publisher and source host.
4. Select **Review application**. Inspect the retained runtime, managed home,
   exact command, workspace identity, source binding and PRS runtime.
5. Select **Save application**. A matching original managed release is reused.
   If that runtime still needs its original managed adoption, follow the
   existing **Connect** operation to completion.
6. Select **Review start**, inspect the current inputs and release, then
   **Start reviewed application**.
7. Use **Open application** after the original authenticated clinical listener
   is ready.

The managed command selects the reviewed Python explicitly. The clinical
launcher verifies the binding before opening the original workspace and again
after acquiring its existing writer lease. Applications then compares the
startup announcement with the live authenticated /api/launch response, including
the selected workspace, source execution path, Python, PRS runtime and binding.

The clinical application and the NDJSON application share the original workspace
resource identity. Their common managed resource lock and the original native
workspace lease keep one owner for the same database. A current managed run
remains available through its existing saved operation.

## Complete the study and customer workflow

The opened page is the original industrial ClinicalTrials console. Use its
normal sections to complete the work:

| Section | Work in the retained workspace |
| --- | --- |
| Cohort and capture | Review the original query and provider version; select, pause or continue the retained capture and its original opaque page token. |
| Studies and reviews | Page the saved studies, open the complete nested study and source identity, and retain a ready, follow-up or exclude decision against the exact source hash. |
| Mapping and editions | Inspect the original field inventory, save the explicit mapping, build the native dataset and compare retained editions. |
| Query | Read the selected dataset through the original native query engine and continue its returned cursor. |
| PRS | Inspect the original XML and schemas, review modernization decisions, apply the retained plan, compose a reviewed upload and reconcile the selected study fields. |
| Publisher | Prepare the selected export, review and stage the original dataset release, operate its seller and retain the original customer session and complete outputs. |
| Export and receiving | Save the complete source/customer package and reopen it through the original ClinicalTrials receiver. |

Selecting an existing capture opens its saved source. A new acquisition is an
explicit clinical action with its own current revision and request UUID. The
same distinction applies to publisher and customer work: reopen the retained
release or session and use its original continuation.

Keep the complete customer package with the operating handover. It includes the
original raw source, explicit mapping, native CSV and configuration, source
lineage, reviews, PRS inputs and reports, and declared contracts. The original
publisher's customer files retain their exact native output and manifest. The
[main operating guide](README.md) and
[PRS API](prs/API.md) describe the complete source-specific operations.

## Attach the same console through MCP

The optional console connection file contains the original private loopback URL
and capability followed by a newline, with mode 0600. The clinical serving
process owns it and removes only its own unchanged file on normal Stop.

Create a private clinicaltrials-connection.json alongside it:

~~~json
{
  "schema": "stellar-forge.clinicaltrials-workspace-connection.v1",
  "workspaces": {
    "portfolio": {
      "label": "Clinical study portfolio",
      "consoleUrlFile": "./clinical-console.url",
      "files": {}
    }
  }
}
~~~

The existing merchant host accepts that connection:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs \
  init-clinicaltrials-workspaces \
  --dir /private/clinical-mcp \
  --connection /private/clinical/clinicaltrials-connection.json

node stellar-forge/mcp-merchant-operator/serve.mjs \
  serve --config /private/clinical-mcp/merchant-mcp.json \
  --port 3211 --token-env MCP_ACCESS_TOKEN
~~~

Use the existing host's configured bearer environment reference. An existing
merchant configuration can add the same clinicalTrialsWorkspaceConnection
alongside its other configured providers.

The ClinicalTrials attachment exposes its original 42 Clinical and source
controls through that running console. Study/capture/PRS reads, reviewed native
actions, original source mapping and dataset operations, publisher/customer
operations and verified complete file delivery reach the same owner as the
browser. The attachment rereads the console URL file for each request, so a new
managed start can publish its new port and capability at the same path.

Closing the MCP attachment drains that client's requests and owned file reads.
The managed clinical process remains available in Applications. Follow the
[complete MCP guide](../../../../stellar-forge/mcp-merchant-operator/CLINICALTRIALS_WORKSPACE.md)
for host-selected file handles, exact action schemas, operation reconciliation
and complete download continuation.

## Stop, reopen and recover

**Stop application** targets the saved managed operation. The clinical launcher
removes readiness, stops and closes its listener, drains its original publisher
and closes the existing workspace owner. The original data, source editions,
review IDs, PRS plans and customer files stay in their workspace.

After the operation has stopped, select **Review start → Start reviewed
application** on the same saved application. Open returns to that retained
clinical workspace. The new process has its own private capability and managed
operation ID. Its source capture and review identities remain the originals.

Closing only the Applications browser or runtime-console server leaves its
managed process available. Reopen the runtime console, select the saved
application and inspect its current operation before starting anything else.

Use the original controls for interrupted work:

| Observed state | Continue the original work |
| --- | --- |
| A live managed run with a closed browser | Reopen the saved application and its current private link. |
| An incomplete runtime connection | Use **Connect** to resume the original managed adoption. |
| A retained queued or interrupted application operation | Inspect its output and use the original **Continue/recover** control for that operation ID. |
| A changed source, Python, PRS installation or workspace identity | Review the current application inputs, save them and review the new start. |
| An existing console connection file | Open its still-running original console. After a confirmed ended operation, select a new connection-file path through the original application review. |
| An uncertain clinical mutation response | Read the original Clinical operation by its saved request UUID, then continue that exact retained outcome. |
| A received customer packet in a new private directory | Review that receiver's actual workspace binding, then reopen its retained source and customer workflow. |

A portable customer packet reconstructs its retained source, reviews, mappings,
editions and PRS records through the original receiver. The new receiving
workspace obtains its own directory/database binding and new local export
records. Retain the prior complete customer package and operating journal
alongside the receiving output for their original operation history.

## Operate from the existing CLI

The browser and these commands call the same Applications model:

~~~sh
starforge runtime-workspace applications --workspace /private/runtime-console
starforge runtime-workspace application-review \
  --workspace /private/runtime-console --request /private/clinical/review.json
starforge runtime-workspace application-save \
  --workspace /private/runtime-console --request /private/clinical/save.json
starforge runtime-workspace application-connect \
  --workspace /private/runtime-console --application-id APPLICATION_ID
starforge runtime-workspace application-start-review \
  --workspace /private/runtime-console --application-id APPLICATION_ID
starforge runtime-workspace application-start \
  --workspace /private/runtime-console --request /private/clinical/start.json
starforge runtime-workspace application-output \
  --workspace /private/runtime-console --application-id APPLICATION_ID --operation-id RUN_UUID
starforge runtime-workspace application-stop \
  --workspace /private/runtime-console --application-id APPLICATION_ID --operation-id RUN_UUID
starforge runtime-workspace application-recover \
  --workspace /private/runtime-console --application-id APPLICATION_ID --operation-id RUN_UUID
~~~

The review request uses the actual selected runtime ID:

~~~json
{
  "runtimeId": "ORIGINAL_READY_RUNTIME_ID",
  "kind": "clinicaltrials",
  "label": "Clinical study portfolio",
  "settings": {
    "workspaceDirectory": "/private/clinical/registry",
    "pythonExecutable": "/absolute/python-environment/bin/python",
    "connectionFile": "/private/clinical/clinical-console.url",
    "port": 0
  }
}
~~~

Replace the displayed ID with the selected runtime's returned ID. Editing an
existing application also supplies its applicationId and expectedRevision.
The save request contains the returned reviewId, applicationId null for a new
application, and the new request's UUID. The start request contains the saved
applicationId, its start reviewId and that start's UUID. Keep each original
request file for the existing idempotent recovery.

To run the original selected console directly, use the same explicit interpreter
and binding:

~~~sh
starforge clinicaltrials --python /absolute/python-environment/bin/python \
  --workspace /private/clinical/registry serve \
  --port 0 --console-url-file /private/clinical/clinical-console.url \
  --expected-binding REVIEWED_BINDING_SHA256 --startup-format json
~~~

This prints the same structured launch record used by Applications. The
authenticated /api/launch read is available only for that managed startup.
The ordinary direct serve command retains its original console output.

## Source integration

The existing ClinicalTrials distribution contribution declares
applicationProviders.clinicaltrials and the complete source-owned
[provider](application-provider.mjs). Its
[preparer and startup reader](managed-application.mjs) call the original runtime,
Applications path/environment helpers and startup observer. The Python
[binding helper](managed.py) extends the original NDJSON inspector with the
Clinical application marker and original PRS doctor.

The common Applications registry, browser, managed release, operation journal
and lock protocol retain their existing implementations. Receive the complete
following source release and reopen the runtime host to discover this provider;
saved applications and their histories remain in the original workspace.
