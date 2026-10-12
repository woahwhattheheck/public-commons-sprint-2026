# Merchant support in Applications

The managed **Merchant support** application opens the original SF74 case desk and SF93 incident operations in the selected installed runtime. Applications retains the runtime, managed release, original private directories, reviewed configuration, process operation and verified local listener. Cases, source captures, acknowledgments and notification attempts remain in their original stores across Stop and reopen.

## Select the original runtime and stores

Open the existing runtime workspace, select a READY installation containing the current **support-console** command and its **managed-launch.mjs** helper, and choose **Applications → New application → Merchant support**.

| Setting | Selection |
| --- | --- |
| Private merchant case directory | The original case directory, or one new folder in an existing private parent. Saving creates that one reviewed folder. |
| Private incident source profiles | The original private JSON file naming up to eight initialized SF93 stores. Each configured source retains its own original capture and notification history. |
| Allow local seller captures | Enable when this operator will capture an explicitly local seller through the original intake controls. |
| Local port | Use 0 for the original server to choose an available loopback port. |
| Private environment JSON | Optional existing private file supplying the environment names used by the original notification destination and seller configuration. |

Use the existing [incident source guide](../../sf74-merchant-support-console/INCIDENT_SOURCES.md) to initialize or reopen SF93 stores and configure their original watcher behavior. A source profile document has the existing shape:

~~~json
{
  "schema": "stellar-forge.support-incident-sources.v1",
  "sources": [
    {
      "id": "merchant-operations",
      "label": "Merchant operations",
      "directory": "/private/merchant-incidents"
    }
  ]
}
~~~

The file must be private and owned by the operator. Relative store paths resolve beside this file. Source IDs must be unique lowercase identifiers; the ID **profiles** is reserved by the existing HTTP route. Every selected directory must contain an initialized original SF93 store. The profile document can name an empty source list for a retained case desk with no active incident sources.

The browser uses configured source IDs and labels. It cannot replace a source path through an incident request. Environment values stay in the existing managed child environment and original private files.

## Review, save and open

1. **Review application** reads the selected runtime and original profile parser. It retains the case-directory identity, source-profile bytes, original store identities and their current watcher configuration revisions.
2. **Save application** reuses the matching original managed release or starts its existing adoption operation.
3. **Review start** refreshes the current private inputs and selected release. Configuration changes made since an earlier review are shown through a new review.
4. **Start reviewed application** launches the original support-console command through the existing managed worker.
5. **Open application** becomes available after the original server's startup announcement is reconciled with that same live local listener.

The managed command has this form:

~~~text
starforge support-console --cases-dir ABS_PRIVATE_CASES --incident-sources ABS_PRIVATE_PROFILES --startup-format json --expected-selection-sha256 REVIEWED_SHA256 --port 0
~~~

Applications prepares the selection digest. It includes original directory identities and configuration hashes, together with the native startup boundary's exact module fingerprints. Managed adoption can copy identical source into its retained release directory; the copied source must keep those same bytes.

The native server checks the expected selection before binding its port. Its one-line **stellar-forge.support-console-launch.v1** announcement contains the selected case/profile paths, process ID, unique instance ID, actual local URL and selection digest. The managed observer calls the same listener's **GET /api/support-launch** and matches its process, instance, URL, state and digest before saving the Open link against the original operation ID.

The listener response contains its identity and digest. Original capture bodies and credentials remain in their native stores. Existing direct command use keeps the ordinary text startup format.

## Operate the original support workflow

Open **Incident operations**, select a configured source, and read its current merchants, incidents, notification queue and worker state. The displayed configuration is the original SF93 configuration.

**Start watcher** starts that source's original watcher under its original worker lease. An already-owned source keeps its external worker identity. The console may stop and drain only watchers it started. Destination inspection uses the original destination and Slack actor/workspace checks.

For a retained incident, inspect its original before/after captures and advertised routes, acknowledge it with the current revision, or continue its original notification operation. Notification controls retain the original attempt and latest-event checks. The original watcher is responsible for source collection, notification delivery and retry timing.

To prepare a merchant case, select an advertised route from that incident's retained capture and use the current merchant workspace. **Prepare case** reads the original immutable capture files through the original SF93 transaction and exports the existing runtime handoff. The case desk imports that handoff through its existing case format.

Save the case in the selected private case directory. Its metadata, workspace, runtime-support attachment and revision history remain in the original case store. Download or receive its existing runtime handoff when handing work to another retained merchant workspace.

## Stop, reopen and receive saved work

**Stop application** addresses the saved managed run. Its original command receives shutdown, marks its listener as stopping, aborts and drains its own incident watchers, then closes the HTTP listener. Each watcher retains the original worker result and queue state before the process ends.

Closing the Applications browser or its runtime web server leaves the original managed operation available for reopening. Reopen that saved application to recover its current run, output and verified original URL. An ended run keeps its historical URL with Open disabled.

After a completed Stop, choose **Review start → Start reviewed application** on the same saved application. The new process gets a new instance ID and actual port. It reopens the same original case directory and incident stores. Select an existing case to recover its exact revision, metadata, workspace and retained runtime-support attachment; select its source to recover the original incidents, captures, acknowledgments and notification attempts.

Watchers are started from the original incident controls for the new console session. An external watcher keeps its original ownership. Opening the application preserves retained notification attempts and source captures.

To use a received case, import its original runtime handoff in the case desk and save it into the selected case directory. For a separately received incident store, reopen that original initialized private store and name it in the private source-profile document before reviewing a new application start. The existing case and incident formats remain the transfer formats.

## Configuration changes and recovery

A changed profile file, replaced original directory, modified watcher configuration or changed native source requires a current start review. Incident observations, capture retention, notification progress and case revisions can advance during ordinary work without becoming source-selection changes.

If a start response is lost, continue the original saved start UUID from Applications. Its operation and request body remain the original identity. If shutdown or the runtime host was interrupted, use the existing managed recovery operation and original SF93 worker status before continuing.

The native startup problem identifies whether the original selection changed, the selected port differs, or the actual listener did not match. The managed operation retains the original output. Reopen and correct the selected private inputs through the existing review flow.

## Integration

**application-merchant-support.mjs** composes three maintained hooks:

- **merchantSupportApplication(common)** supplies the catalog entry and original settings.
- **prepareMerchantSupportApplication(settings, {inputPath, runtimeDirectory})** returns the original arguments, reviewed inputs and directories to create.
- **merchantSupportStartup(request, text)** reconciles the native announcement with the actual loopback listener.

The original **applications.mjs** owns review, saving, adoption, runtime binding, resource exclusion and start operations. **application-command.mjs** owns the original child environment and startup observation. SF74's **managed-launch.mjs** supplies its native selection and listener protocol; **incident-sources.mjs** reuses its original parser for the private selection projection. The existing SF93 queue, watcher, store and case handoff remain the implementation used by the application.

Follow [Applications](APPLICATIONS.md) for the common browser and CLI operations, and [Incident sources](../../sf74-merchant-support-console/INCIDENT_SOURCES.md) for native incident configuration and controls.
