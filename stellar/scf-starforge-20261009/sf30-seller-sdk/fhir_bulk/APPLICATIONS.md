# FHIR Bulk Data in Applications

The FHIR Bulk Data workbench is available in the installed Runtime workspace's
**Applications** catalog. Save the existing private FHIR workspace, open its
original operator, query its reviewed dataset editions and deliver the complete
editable workspace. Start, Stop, runtime connection and process history use the
maintained Applications lifecycle.

The saved application launches the existing `fhir-bulk serve` command. The same
FHIR workspace contains the original connections, Group pages, export operations,
source captures, mappings, native datasets, comparisons, merchant lineage and
receiving history. Its original workspace UUID joins the saved application,
native process and authenticated browser state.

## Receive the complete distribution

Select the cumulative source release containing these files:

- `sf30-seller-sdk/fhir_bulk/application-provider.mjs`
- `sf30-seller-sdk/fhir_bulk/cli.py`
- `sf30-seller-sdk/fhir_bulk/operate_applications.mjs`
- `distribution/contributions/fhir-bulk.json`

They sit below `stellar/scf-starforge-20261009/` in the original source tree.
The contribution retains the original command and merchant/customer exports and
adds its source-owned Applications provider. The standard distribution builder
collects that provider with the existing SDK, checks its static dependencies and
records its bytes in the installed source manifest.

Reopen the Runtime workspace host after receiving this release. The running host
discovers its Applications providers when its source is loaded. A READY runtime
must contain the new provider and the matching native CLI before it can be
selected for this application. The ordinary installer, existing dependency
profile, managed release connection and archive remain the installation route.

`starforge registrations --source fhir-bulk` shows the effective contribution.
The Runtime workspace's Applications state also includes the provider path,
declaring contribution and source identity.

## Prepare or select the original workspace

A complete native receiving run writes `OPERATED_FHIR_BULK.json`. Its
`workspace` and `workspaceId` identify the directory to use in Applications.
Finish the original native/browser receiving process so its FHIR workspace lease
can be transferred to the application. Acquired exports and original operation
UUIDs stay in that directory.

An operator starting a new workspace can initialize one through the same CLI:

```sh
node /absolute/source/stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_bulk/cli.mjs \
  init --workspace /absolute/private/fhir-workspace
```

The FHIR workspace has mode 0700 and contains:

| Retained item | Purpose |
| --- | --- |
| `workspace.json` | Original FHIR workspace format |
| `fhir/identity.json` | Stable native workspace UUID |
| `workspace.sqlite` | Saved source, mapping, dataset and operation index |
| `sources/`, `plans/`, `builds/`, `comparisons/` | Complete source bytes and native editions |
| `fhir/` | Original acquisition state, operations and received files |

Select the native workspace directory itself. An output directory containing a
receiving journal or a ZIP is a delivery folder; its `workspace` field supplies
the saved native workspace to open.

A complete workspace ZIP can be received first using the existing
`workspace-import` command. That command retains or reconstructs its native
identity through the same original import lifecycle described in the workbench
guide.

## Save and operate in the installed UI

1. Open the original Runtime workspace and select **Applications**.
2. Choose **New application**, enter a display name and select the READY runtime.
3. Choose **FHIR Bulk Data**.
4. Enter **Initialized FHIR workspace**. Use the exact private native directory.
5. Select the existing **Authentication profiles** file when that workspace
   uses configured FHIR authentication. Select the ordinary **Private environment
   JSON** when its process needs selected environment variables.
6. Keep **Local port** at 0 for an available loopback port, or enter the intended
   fixed local port.
7. Select **Review application**, inspect the original command, workspace and
   runtime, then select **Save application**.
8. Applications connects that same READY runtime to its managed release. Its
   **Continue runtime connection** action resumes the saved connection if the
   earlier process was interrupted.
9. Select **Review start**, then **Start reviewed application**.
10. Select **Open application** when the saved native listener is running.

The opened FHIR operator contains its full sections: Overview, Server exports,
Original resources, Dataset mapping, Dataset editions, Native query, Edition
changes, and Delivery and reopen. Use the existing export operations and saved
source captures from there. A workspace opened by Applications has the same
capabilities as one opened by the native CLI.

**Stop application** shuts down the original command through the managed worker.
Its saved application ID and original operation history remain available.
A later start opens that same FHIR workspace and receives a fresh private
listener capability. Ordinary changes to source captures, mapping plans and
native dataset editions remain in the product's own workspace.

## Authentication and interpreter selection

**Authentication profiles** passes the selected native `--credentials-file`
unchanged. The existing FHIR credentials implementation validates the profile
schema and its allowed origins. Secret values are resolved through its original
local environment references. Applications retains the selected file identity
and uses the normal environment-file review and launch checks.

The native Node entrypoint retains its existing Python selection:

1. `SF30_FHIR_PYTHON`
2. `SF30_XML_PYTHON`
3. `CODEX_PRIMARY_RUNTIME_PYTHON`
4. `python3` from the process environment

The same Node entrypoint passes the executing Node binary to the original native
dataset engine through `SF30_FHIR_NODE` and `SF30_XML_NODE` when those values
have not already been selected. Use the installed host's existing environment
file for a required interpreter selection.

The private FHIR URL carries the native process's capability in its fragment.
Applications verifies its actual loopback address, selected port and native
workspace identity, then reads the original authenticated `/api/state` before
making the Open link available. The capability stays in the private retained
application operation. Use the product's complete workspace or dataset delivery
for another operator.

## How the original identity remains connected

The provider prepares:

- The original `serve` command and absolute workspace directory.
- The selected native workspace UUID through `--expected-workspace-id`.
- The original marker and identity file inputs.
- The optional authentication-profile path.
- The existing common port and private environment inputs.

The saved resource identity joins the FHIR application kind, real private
directory and native workspace UUID. The original FHIR workspace file lease
continues to coordinate the actual native process. Applications uses its
existing shared resource and managed worker leases for saved starts and recovery.

The native CLI checks the expected UUID after opening the original workspace
and before executing the selected command. Its startup announcement supplies
the native format, directory, UUID and original private URL. The adapter reads
those exact fields and confirms them through the authenticated native state.

The SQLite database, source files, mappings, native editions and acquisition
progress are editable work. They do not become frozen launch inputs. Review and
Save retain the stable original workspace and selected settings while normal
work proceeds in that workspace.

If an operator intentionally replaces the whole native workspace at the same
path with a different UUID, reopen its settings and review that new selection.
The next application start should refer to the selected workspace identity.

## Complete installed receiving

`operate_applications.mjs` operates the rendered UI against a completed original
FHIR receiving result and an existing READY installation. It imports the
Applications model, HTTP host and provider from that installation's actual
verified source, so the operated application belongs to the selected
distribution.

Use Node 22 or newer and the existing Playwright/Chromium installation. The
driver can use `CODEX_PRIMARY_RUNTIME_NODE_MODULES` to resolve the already
available browser runtime. An optional `--chromium` selects an existing browser
executable.

```sh
node /absolute/source/stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_bulk/operate_applications.mjs \
  --runtime-directory /absolute/private/ready-runtime \
  --runtime-workspace /absolute/private/runtime-workspace \
  --receiving /absolute/private/fhir-receiving/OPERATED_FHIR_BULK.json \
  --out /absolute/private/fhir-applications-receiving
```

Optional arguments:

| Argument | Selected original input |
| --- | --- |
| `--credentials-file` | Native FHIR authentication-profile JSON |
| `--environment-file` | Existing private Applications environment JSON |
| `--chromium` | Existing local Chromium executable |
| `--label` | Display name when saving the application for the first time |

The output parent and the Runtime workspace parent must exist. The driver creates
its private output directory and initializes a missing Runtime workspace through
the original `createRuntimeWorkspace` API. It opens an existing Runtime workspace
when one is present. The READY runtime is attached through the rendered
**Open an existing runtime** form.

### Operated journey

The same operation performs these complete stages:

1. Verify the installed runtime source, selected original FHIR UUID and completed
   native receiving record.
2. Open the installed Runtime workspace UI and its Applications catalog.
3. Review and save the FHIR application's original workspace and settings.
4. Connect the same READY runtime through the original managed release operation.
5. Review and start the native FHIR application, then open its rendered private
   operator.
6. Reopen the saved exports, original sources and dataset editions. Query the
   original final dataset through its rendered controls and retain the full
   native response.
7. Download the complete editable FHIR workspace through **Delivery and reopen**.
8. Stop the application through its UI and receive the original worker's stopped
   operation.
9. Close and reopen the Runtime workspace HTTP host.
10. Open the same saved application, start its next managed operation and query
    the same original native dataset again.
11. Stop that operation and retain the complete application state and history.

At each opened FHIR listener the driver receives the actual authenticated state
and checks the original source, build, mapping, export-operation and comparison
identities from the completed native run. The two application starts retain
their distinct managed operation IDs and the same application/native workspace
IDs. Their queries read the original dataset and verify its native total.

The private output contains:

| File | Complete deliverable |
| --- | --- |
| `OPERATED_FHIR_APPLICATIONS.json` | Final installed source, application, native workspace, managed operation IDs, state, history, query and delivery references |
| `APPLICATIONS_JOURNEY.json` | Original receiving inputs, UI action responses, retained stages and continuation state |
| `SAVED_APPLICATION.json` | Original saved application and runtime connection |
| `run-*-application-start.json` and `run-*-application-stopped.json` | Each original managed operation before and after shutdown |
| `run-*-original-before.json` and `run-*-original-after.json` | Complete native workspace state for each opened listener |
| `run-*-native-query.json` | Full original native dataset query response |
| `FHIR_Applications_Editable_Workspace.zip` | Complete editable source workspace from the real product download |
| `*.png` | Rendered saved application, native query, delivery and stopped-state views |

The receiving journal and persistent browser profile retain the original
operation across an interruption. Run the same command with the same paths.
Existing application IDs and managed starts are reopened before another start
is considered. A running original operation is reused. An interrupted original
start follows the existing **Continue original start** action. The browser's
native pending-request storage remains responsible for its original save/start
UUID before submission.

The completed native acquisition and browser receiving artifacts remain the
source of the FHIR datasets. This installed receiving stage adds the complete
saved Applications lifecycle and its actual product delivery.

## Source maintenance

The source-owned provider lives next to the native FHIR workbench and declares
one catalog kind, `fhir-bulk`. Shared Applications files, source composition,
ordinary managed command execution, private environment handling and worker
history retain their existing implementations.

When native CLI arguments or startup fields change, update this provider with
the same original CLI change. When the complete distribution is received,
operate this same installed journey against the retained native receiving
record and publish the resulting application and delivery files in the original
SCF work thread.
