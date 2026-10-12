# SFTP publishers in Applications

**SFTP source and dataset publishers** opens the original private SFTP workbench
through the maintained Applications service. It keeps the saved connection,
report revisions, complete captures, publication and dataset directories,
merchant payment choices, recurring policies and customer files together.

The application kind is **sftp-publisher**. Its command is the existing
**sftp-workspace**. The source-owned provider is registered by the original
distribution/contributions/sftp.json, and the common Applications service owns
Review, Save, Connect, Start, Open, Stop and recovery.

## Select the native workbench

Use a completed or received SFTP workbench: the private directory that contains
workspace.json, revisions/, captures/ and publications/. Applications retains
that directory in place.

To initialize a new workbench with the original command:

~~~sh
starforge sftp-workspace --state /absolute/private/sftp-workbench --port 0
~~~

Open its printed private URL, or stop this initial listener after it creates the
workbench and continue its authoring in Applications. A workbench with no saved
connection is a valid initial selection. Its first connection can have no
queries while you catalogue and sample the selected remote files.

An existing source and merchant declaration can be imported by the same original
create-only command:

~~~sh
starforge sftp-workspace \
  --state /absolute/private/sftp-workbench \
  --source /absolute/private/sftp-source.json \
  --merchant /absolute/private/sftp-merchant.json \
  --port 0
~~~

For an initialized workbench, select its existing directory. New source and
merchant versions are saved by its original browser with a revision check.

## Review and save

Choose a READY runtime containing the SFTP Applications provider and all original
SFTP source/browser files. Open **Applications → New application → SFTP source
and dataset publishers**.

| Setting | Use |
| --- | --- |
| Original SFTP workbench | The initialized private directory containing workspace.json. |
| Dataset facilitator URL | The original HTTPS x402 facilitator used by the native dataset sellers, when required. |
| Allow local development facilitator | An explicit choice for a selected http://127.0.0.1 development facilitator. |
| Local port | 0 selects a free port; a fixed port remains an exact launch setting. |
| Private environment JSON | The existing private file mapping the source's credential environment names to host values. |

SSH authentication stays in the original source's environment references. The
common Applications reader loads a private environment file for the child
process. Keys, passwords and passphrases are absent from application settings and
startup observations.

**Review application** reads the original workspace creation identity, private
directory identity, current saved source/merchant hashes and retained product
bindings. It verifies selected-report source bytes and the original buyer
configuration hashes. It also binds the selected runtime's direct SFTP launch and
browser files. This preparation opens no source connection, workbench writer,
publisher or seller.

**Save application** retains the original review using the common application's
request ID. **Connect** completes any original managed-runtime adoption. If a
response is lost, reopen the same saved application or reconcile the same
request ID.

## Start and open the complete product

**Review start → Start reviewed application** prepares the current original
workbench again and retains that exact start review. The source-owned provider
reads this original application run and start-review record immediately before
launch. The reviewed source and the managed release's executing source must
match. The common worker runs the existing sftp-workspace command.

**Open application** becomes available after the native command announces its
actual private loopback URL and the provider reads the authenticated /api/state
response. The live source revision and selected publication bindings must agree
with the reviewed workbench. The common application-url.json writer retains the
original operation ID and the current private URL. Each retained publication
console is also exposed as an application link.

The original workbench provides the whole operator workflow:

1. Save the host, port, username, mandatory host-key fingerprints and credential
   environment references. The source declaration retains those references.
2. Page through the complete remote directory. Capture and sample a selected
   CSV, JSON or NDJSON file, with a JSON pointer when the records are nested.
3. Review the native inferred fields and save explicit column types, nullable
   values, report parameters and filters. Integer fields reject fractional
   numeric lexemes before conversion.
4. Save the public merchant origin and complete payment options. A publication
   binds exactly one saved report and its exact merchant revision.
5. Open that product's original publication console, extract a complete
   candidate, review its rows and files, and publish the selected edition.
6. Start the native dataset seller, review the pinned original offer and save a
   buyer handoff. The full payment choices and their large numeric strings retain
   their original values.
7. Enable the original recurring schedule for that publication. Review current
   and older dataset versions and download their original CSV, dataset and
   candidate manifests.

Existing seller intent is read by the original workbench at startup. A native
seller that cannot start remains visible with its original start error; the
operator can correct its actual configuration in the existing product. Opening
Applications does not select new payment terms or create a second publication.

## Stop, reopen and recover

Use **Stop** for the saved application's actual operation. The original managed
worker signals the workbench process. Its server closes admission, waits for
admitted operations, closes private source reads and publisher/seller sessions,
and releases its existing workspace lease.

The source revisions, captures, publication IDs, dataset snapshots, buyer
configuration files and saved service intent remain in the same directory.
Closing the Applications browser is different from stopping its managed process;
the retained application still identifies that process.

After Stop, use **Review start → Start reviewed application** on the same saved
application. Its new operation receives a new private browser URL. A changed
source revision, completed publication, buyer file or review is ordinary work
inside the same native workbench. It appears in the new start review while the
application's stable resource identity remains unchanged.

Replacing the workbench directory or its creation identity is a new selection:
review and save that replacement explicitly. Mutable workspace.json bytes and
file modification times do not define the application identity. The original
directory device/inode and creation time do.

If a managed launch is interrupted, inspect the same operation and use the
common **Recover original operation** control. Original application/run IDs,
worker leases, source/runtime bindings and failed outcomes remain authoritative.

## Original runtime CLI

Use the maintained runtime-workspace CLI with the actual workspace and runtime
IDs returned by the original installation:

~~~json
{
  "runtimeId": "ACTUAL_RUNTIME_ID",
  "kind": "sftp-publisher",
  "label": "Private SFTP dataset products",
  "settings": {
    "workspaceDirectory": "/absolute/private/sftp-workbench",
    "port": 0,
    "environmentFile": "/absolute/private/sftp-environment.json"
  }
}
~~~

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

The save body is {requestId, reviewId}. The start body is
{applicationId, requestId, reviewId}. Use the respective actual review ID and a
fresh UUID for each distinct operation; retain the UUID when recovering an
uncertain reply.

~~~sh
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

## Source integration

The provider exports its versioned default adapter from application-provider.mjs.
managed-application.mjs contains the native catalogue, read-only workspace/source
inspection, preparation and authenticated startup reader.

| Export | Native purpose |
| --- | --- |
| sftpApplication(common) | Original Applications choice and operator settings. |
| inspectSftpApplicationWorkspace(directory) | Read saved identity, source/report/product bindings and customer files. |
| inspectSftpApplicationSource(sourceRoot) | Bind the original direct launch and browser files. |
| prepareSftpApplication(settings, context) | Prepare the existing command, original inputs and shared resource key. |
| reviewedSftpApplication(request, operationDirectory) | Read the common retained run and exact start review. |
| verifySftpApplicationLaunch(request, operationDirectory) | Check the retained workbench and executing source before launch. |
| sftpApplicationStartup(request, text, operationDirectory, context) | Verify the actual original private listener and publication links. |

The complete provider requires the maintained source-owned Applications API
described in distribution/runtime-workspace/APPLICATION_PROVIDERS.md.
Use a cumulative release that includes this provider declaration and its source
files. The original contribution's three commands, five exports and ssh2 runtime
selection are preserved.
