# Human Services Directory in Applications

Open the directory from the installed runtime's maintained **Applications** view. The application starts the same native directory operator used by the CLI and connected SDK, with the original workspace and complete editable records.

## Prepare the selected product

Build the `human-services-directory` source selection and install its original archive using [the product operating guide](../../../../products/human-services-directory/OPERATING.md). The installed selection includes the Human Services Directory application, the original Gravity/eLTSS/FHIR applications, the connected Merchant provider and complete source.

Create or receive the private workspace before adding the application:

```sh
starforge human-services-directory init --workspace /absolute/private/directory

starforge human-services-directory receive-workspace \
  --workspace /absolute/private/directory \
  --file /absolute/original/Human_Services_Directory_Editable_Workspace.zip
```

Use the receive command for the original complete packet being continued. Its native receiving record preserves the incoming workspace UUID and the complete directory, Gravity and inherited source content.

## Add and open the application

1. Open **Applications** in the runtime workspace and select **Human Services Directory**.
2. Select the installed runtime and the private **Directory workspace**.
3. Select **Authentication profiles** when the chosen provider uses an existing private profile file.
4. Save the application and start it.
5. Open the live application from the recorded run.

The application preparation records the original workspace marker and identity files. Startup verifies the native directory descriptor, the actual loopback listener, the workspace UUID and the directory state before publishing the open URL. The application uses the existing resource ownership and stop/reopen lifecycle.

The native operator's private descriptor is `directory/operator-connection.json`. Its browser token is carried in the open URL's fragment. The saved application settings identify the workspace and optional authentication file; they do not contain a copied provider credential. Use the normal application controls to stop and reopen the same saved instance.

## Operate the directory

The UI provides original source and provider acquisition, complete source/row/link browsing, frozen editions and comparisons, mapping preview/apply, service criteria and dispositions, clinical bindings, handoff preparation, full file downloads and fresh receiving. Forms use the installed native schema. Every accepted change remains a saved original record that can be opened again.

Review service schedules and capacity in the candidate view before recording the destination. Preserve the provider's original schedule interpretation and the operator's explicit operating-hours, event or exclusion decision. Clinical joins require the exact original resources and bindings selected in the retained Gravity edition.

Complete source files, indices, comparison changes, published guidance, handoffs and editable workspaces are available from their retained records. The state view declares any remaining record pages; the complete original collection remains reachable through its collection browser.

## Run the installed application receiving programme

Use a runtime whose original `inspect --load --source` result is ready, the completed native receiving JSON and an absolute output directory:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/operate_installed_applications.mjs \
  --runtime-directory /absolute/installed/runtime \
  --runtime-workspace /absolute/private/runtime-workspace \
  --receiving /absolute/native/OPERATED_HUMAN_SERVICES_DIRECTORY.json \
  --workspace /absolute/private/directory \
  --out /absolute/private/directory-applications \
  --playwright /absolute/playwright/index.mjs \
  --chromium /absolute/chromium
```

`--workspace` selects an explicitly received copy of the original directory; omit it to use the native receiving JSON's workspace path. Optional `--credentials-file`, `--environment-file` and `--label` select the existing launch inputs and application name. The environment file is a private runtime input, not a product source file.

The programme opens the actual runtime workspace UI, attaches the installed runtime, saves and starts the application, operates the complete directory browser journey, retains the full workspace file, stops the application, closes and reopens the runtime host, and restarts the same saved application. It verifies original record families before and after reopening, including all pages declared by the directory state.

The output contains `APPLICATIONS_JOURNEY.json`, retained original runtime/application requests, browser observations, downloaded complete files and the final result. Reuse the same output directory and unchanged original receiving JSON to continue an interrupted programme. The journal binds the runtime directory, runtime workspace, original directory UUID and saved application ID.

## Lifecycle and operational inputs

| Selection | Meaning |
| --- | --- |
| `human-services-directory` | Installed application and native command |
| `human-services-directory-connected` | Connected SDK/MCP contribution |
| `humanServicesDirectoryConnection` | Merchant host input pointing to the private connection file |
| `SF30_DIRECTORY_PYTHON` | Explicit Python executable for the native directory operator |
| `SF30_DIRECTORY_NODE` | Explicit Node executable selected through the inherited native lifecycle |
| `directory/operator-connection.json` | Original private native descriptor |

Native operation and the connected SDK share the same original workspace. A connected client borrows an already running Applications operator. For complete install, transfer and customer receiving commands, follow [the product receiving guide](../../../../products/human-services-directory/RECEIVING.md).


## Conformance in the installed application

The **Conformance** section is part of the same Human Services Directory application. Open its saved workspace, select standards and source scope, run complete assessments, review findings and compare results. All records and retained files travel with the normal editable workspace export and receiving flow.

The [complete conformance guide](CONFORMANCE.md) covers source and profile selection, finding groups, review successors, report packages and connected SDK/MCP operation.
