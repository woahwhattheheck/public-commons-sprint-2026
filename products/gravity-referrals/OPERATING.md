# Gravity referrals

Operate a complete referral programme from its original FHIR resources through reviewed topology, Task editions, requirements, assessment, conditional exchange, customer delivery and editable receiving. The installed product brings the native referral workspace, private browser, connected clients and managed Applications lifecycle together.

The `gravity-referrals` selection carries the complete Gravity source component and the original FHIR, eLTSS, XML, dataset, merchant, customer and runtime engines that it extends. FHIR Bulk Data and eLTSS Care Plans remain available within the selected installation.

| Work | Installed surface | Retained result |
| --- | --- | --- |
| Operate the referral programme | **Gravity Referrals** in Applications | Same original workspace, source members, authored records and operation history |
| Use the native CLI | `starforge gravity-referrals` | Complete native JSON, original files and editable workspace archives |
| Use local or merchant tools | `starforge merchant-gravity-referrals` | Native actions, complete input/response files and resumable export downloads |
| Publish and receive a native dataset | Original dataset, merchant and customer commands | Original SF30 edition and complete customer packet |
| Move the entire programme | Native or connected workspace receiving | Original UUID, source bytes, authored records and referral operation custody |

## Build the complete selected product

In the existing Runtime workspace, open **Build a product**, choose the retained Merchant Workspace repository and actual committed source, and select **Gravity referrals**. Review the selected source, commands, applications and runtime profile, then build into the product's own output directory.

The same maintained source builder is available from the checkout:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/existing/tjlabs-stellar-merchant-workspace \
  --ref ACTUAL_COMMITTED_SOURCE \
  --selection gravity-referrals \
  --out /absolute/releases/gravity-referrals
~~~

The build manifest retains that commit, the exact recipe, complete selected files and archive identity. Continue an interrupted build through the same output and saved request. The [Source Build guide](../../stellar/scf-starforge-20261009/distribution/runtime-workspace/SOURCE_BUILDS.md) covers the existing browser and CLI continuation.

The selection explicitly retains dynamically opened Python modules, private browser assets, the original guidance package and the native input schemas. [SOURCE.json](SOURCE.json) identifies the adopted source and its original file identities.

## Install and open the runtime

Receive the original package archive and its complete SHA256. Install the selected source package into the existing command environment:

~~~sh
npm install --ignore-scripts --offline --omit=optional /absolute/downloads/original-gravity-package.tgz
./node_modules/.bin/starforge registrations --source gravity-referrals
./node_modules/.bin/starforge registrations --source gravity-referrals-connected
~~~

Prepare and install the original native and connected runtime profile:

~~~sh
./node_modules/.bin/starforge runtime-install prepare \
  --dir /absolute/private/gravity-runtime \
  --archive /absolute/downloads/original-gravity-package.tgz \
  --sha256 ACTUAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

./node_modules/.bin/starforge runtime-install install \
  --dir /absolute/private/gravity-runtime

./node_modules/.bin/starforge runtime-install run \
  --dir /absolute/private/gravity-runtime -- source
~~~

Keep the resulting READY directory, source root, manifest and actual interpreter paths. The selected runtime installs the original merchant dependencies; the referral source, graph, review and archive work reuse the maintained Python engine.

Attach the complete runtime to the existing Runtime workspace:

~~~sh
starforge runtime-workspace attach \
  --workspace /absolute/private/existing-runtime-workspace \
  --runtime /absolute/private/gravity-runtime \
  --label "Gravity referral runtime"

starforge runtime-workspace serve \
  --workspace /absolute/private/existing-runtime-workspace
~~~

Reopen the Runtime host after adopting this source release so its Applications library loads the source-owned provider. [Runtime installation](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md) and [runtime transfer](../../stellar/scf-starforge-20261009/distribution/RUNTIME_TRANSFER.md) cover complete receiving of an existing READY installation.

## Initialize or receive the programme

Create a separate private Gravity workspace:

~~~sh
starforge gravity-referrals init \
  --workspace /absolute/private/referrals

starforge gravity-referrals status \
  --workspace /absolute/private/referrals
~~~

To continue an existing programme on another host, initialize its receiving directory and import the original complete editable archive:

~~~sh
starforge gravity-referrals init \
  --workspace /absolute/private/received-referrals

starforge gravity-referrals workspace-receive \
  --workspace /absolute/private/received-referrals \
  --input /absolute/originals/Gravity_Complete_Editable_Workspace.zip
~~~

Read the returned status and restored UUID. Whole receiving brings back the original source, graph, dataset and referral records, complete retained requests and original workspace identity. The selected receiving directory can differ from the original host path.

In **Applications**, select **Gravity Referrals**, choose its READY runtime and initialized workspace, and select the existing private authentication profile and environment files when needed. Keep the local port at `0`. Review and save the application, continue its managed runtime connection, then review its start and open the running private workspace.

[APPLICATIONS.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_referral/APPLICATIONS.md) explains the complete save, start, browser, stop, host reopen and second-start lifecycle, including portable receiving on another directory.

For a native terminal owner, start the same workspace with its observed UUID:

~~~sh
starforge gravity-referrals serve \
  --workspace /absolute/private/referrals \
  --expected-workspace-id ORIGINAL_WORKSPACE_UUID \
  --port 0
~~~

The startup result supplies the private operator URL. Use the original native listener or Applications owner for the workspace being operated. Connected clients can borrow that listener through `referral/operator-connection.json`.

## Original source and published guidance

The bundled source profile is Gravity 3.0.0 for FHIR R4 4.0.1, retained from `HL7/fhir-sdoh-clinicalcare` at commit `5ee74ba80810ccf2d3837f634c6d7c5baaec1a3b`. Its complete guidance package contains 191 original files, 57 requirements, 24 profile definitions, five actor capability sources and 24 operating field rows.

Open **Sources** to receive original resources, a Bundle or a complete archive. The same native acquisition engine can retain an actual provider discovery, reviewed read request, returned pages and source members. A published example intake also retains the publication URL and explicit reference-base assignment beside the unchanged original archive.

The native catalogue and complete published-example intake are available directly:

~~~sh
starforge gravity-referrals catalogue \
  --workspace /absolute/private/referrals

starforge gravity-referrals profile \
  --workspace /absolute/private/referrals \
  --profile-id gravity-referral-3.0.0

starforge gravity-referrals published-examples \
  --workspace /absolute/private/referrals \
  --input /absolute/originals/Published_Examples.zip \
  --metadata /absolute/private/published-example-selection.json
~~~

Use the complete `publishedExamples` input from the native [referral-schema.json](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_referral/referral-schema.json). It records the label, actor, publication URL, source note and reviewed reference base. The native result returns the retained source, original archive hash, resource-document count and reference assignments.

Every source member and original resource location remains available. Reference resolution retains the actual candidates and authored selection. Task, ServiceRequest, Patient, Group, RelatedPerson, Location, Consent and outcome resources keep their own types and relationships. Task status, status reason and business status are separate original fields.

## Configure the complete referral workflow

Start with the actual participants, endpoint capabilities and delivery responsibility. Save a configuration for the selected programme, source profile, topology, actors and endpoints. The source defines four topology choices:

| Topology | Configuration focus |
| --- | --- |
| Direct | Source and recipient use their selected FHIR servers; the recipient's server owns the selected receiving records |
| Direct light | The recipient reads and updates the selected Task and Procedure on the source's server |
| Intermediary | Source, coordination platform and recipient retain their selected servers, request relationships and explicit receiving responsibility |
| Intermediary light | The light recipient uses the selected source or intermediary server, with the original request, Task and outcome return preserved |

Open the complete source requirements and actor capability definitions while reviewing those choices. The saved configuration records the implementation decisions used by its referral editions and assessments.

In **Referrals**, select the original source and exact Task cohort. Review its ServiceRequest and related resource links through the original graph. Save the edition with the selected configuration and reference policy. Successor editions identify their original predecessor.

In **Requirements**, adopt the complete profile, review every requirement and field row, and save the entire authored review. Applicability, selectors, absence policy, reviewer choices and source references remain explicit. A successor review keeps the earlier decisions available for comparison.

The native CLI accepts complete UTF-8 JSON request files for authored work:

~~~sh
starforge gravity-referrals configuration-save \
  --workspace /absolute/private/referrals \
  --input /absolute/private/configuration.json

starforge gravity-referrals edition-save \
  --workspace /absolute/private/referrals \
  --input /absolute/private/referral-edition.json

starforge gravity-referrals review-save \
  --workspace /absolute/private/referrals \
  --input /absolute/private/complete-review.json

starforge gravity-referrals assess \
  --workspace /absolute/private/referrals \
  --input /absolute/private/assessment-selection.json
~~~

The 16 native schemas provide the exact request shapes. Cross-record source, role, workspace and predecessor checks are performed by the original native methods.

## Assessment, decisions and corrections

An assessment freezes its source edition, reviewed configuration, complete field review and selected assessment time. Its Task observations, field cells, findings, decisions and original locators can be inspected page by page or downloaded as the complete original assessment file.

Follow the returned next offsets when reading a collection. Use **Queue** to return to saved work and **History** to inspect its retained operations and records.

Save explicit decisions for the selected referral, source relationship, consent, ownership, workflow, finding or receiving result. Each decision retains its actor, source edition, evidence and predecessor. Updated decisions remain part of the programme history.

For authored resource changes, select the exact original record and JSON path tokens. Review the frozen correction preview and apply its exact request hash. The native correction engine creates a successor source and edition while retaining the complete predecessor.

Compare retained editions and receive the complete changes file. Original values, selected relationship links and authored changes stay attached to their source identities.

## Conditional exchange and monitoring

In **Exchange**, select the exact destination connection, resource, method, precondition and complete request. The saved exchange retains its request identity before execution. Continue it with the same operation ID:

~~~sh
starforge gravity-referrals exchange-save \
  --workspace /absolute/private/referrals \
  --input /absolute/private/exchange-request.json

starforge gravity-referrals exchange-advance \
  --workspace /absolute/private/referrals \
  --request-id ORIGINAL_REQUEST_ID \
  --operation-id ORIGINAL_OPERATION_ID

starforge gravity-referrals exchange-operation \
  --workspace /absolute/private/referrals \
  --operation-id ORIGINAL_OPERATION_ID
~~~

The native operation retains the exact request, complete response bodies, headers, selected preimage and actual readback. After an interrupted response, inspect and continue that saved operation. Conditional updates reuse the original selection and reconcile readback before repeating a write.

Monitoring uses an explicitly selected original Task search or instance-history request. Task search carries the selected lower and upper modification bounds, owner, requester and status filters. Instance history selects one original Task and its lower `_since` bound; the UI keeps the search-only selectors separate. The native request verifies that its discovery belongs to the selected connection and that the endpoint advertises the chosen operation. Its saved configuration retains the source selection and polling calendar, and acquisition retains actual returned next links and retry timing.

Use the complete exchange-operation packet when transferring the actual request, response and history to another operator. The connected API exposes both the original operation JSON and whole exchange directory.

## Native datasets and customer delivery

Open **Datasets** to review the original resource projection, output types, array behavior and native unique key. Preview the selected source, save the complete mapping and build through the maintained SF30 engine.

Query the actual retained dataset with its declared filters, sort and native cursor. Follow the original cursor through the requested result. Compare native builds using the same reviewed key and mapping.

The complete dataset export and customer packet retain the original source and mapping. Merchant publication and buyer receiving use the original maintained merchant and SF88 customer engines carried by this product. The installed native wrapper exposes the original merchant and customer commands.

Use **Receiving** to prepare the selected referral handoff. It freezes the programme configuration, source and Task cohort, complete review, assessment, authored decisions and delivery material. Retain the actual destination result as an original artifact and save its receiving record against the selected handoff and operation.

| Receiving file | Continue with it |
| --- | --- |
| Original source or published archive | Reopen the same members and resource locators |
| Complete assessment and edition changes | Inspect every retained observation, field cell and original value |
| Native dataset/customer packet | Receive the selected native edition and its original source/mapping |
| Complete exchange packet | Continue the same request, complete responses and readback history |
| Complete referral handoff | Receive the selected programme and original referral custody |
| Complete editable workspace | Continue the full source, native dataset and referral workspace with its original UUID |

## Connected clients and complete files

The connected command uses private host configuration. A minimal existing-operator selection is:

~~~json
{
  "schema": "stellar-forge.gravity-referral-merchant-connection.v1",
  "workspaces": {
    "referrals": {
      "directory": "/absolute/private/referrals",
      "label": "Referral programme",
      "allowStart": false,
      "inputs": {}
    }
  }
}
~~~

A declared input selects its complete host file with `{"file":"/absolute/originals/input.json","sha256":"ACTUAL_SHA256","label":"Original selection"}`. An existing private `credentialsFile` can be selected in the workspace configuration.

Use the installed tools to inspect the complete action catalogue and call the native referral state:

~~~sh
starforge merchant-gravity-referrals tools

starforge merchant-gravity-referrals call \
  --connection /absolute/private/gravity-connection.json \
  --exports /absolute/private/gravity-exports \
  --action referral_state \
  --args /absolute/private/referral-state-arguments.json
~~~

The arguments file contains `{"workspace":"referrals"}`. Local one-shot commands borrow an already running operator. A persistent client can own the original native operator when startup is explicitly enabled in its host configuration.

The maintained merchant initializer and host load the `gravity-referral-workspaces` provider through `gravityReferralsConnection`:

~~~sh
starforge merchant-gravity-referrals init \
  --directory /absolute/private/gravity-merchant \
  --connection /absolute/private/gravity-connection.json \
  --name "Gravity referral workspace"
~~~

The provider exposes `merchant_gravity_referral_` actions. The typed package exports are `./merchant/gravity-referrals`, `./merchant/gravity-referrals/setup` and `./merchant/gravity-referrals/provider`. Original inherited source, graph, acquisition, native dataset and file operations remain available alongside the referral actions.

Each native call retains the complete response and original request. Full JSON input retains its unchanged original input bytes. File actions retain the original selected payload and a complete export manifest. Use `value` for a complete native JSON value and `download` for all declared export files:

~~~sh
starforge merchant-gravity-referrals download \
  --connection /absolute/private/gravity-connection.json \
  --exports /absolute/private/gravity-exports \
  --workspace referrals \
  --export-id ORIGINAL_EXPORT_ID \
  --manifest-sha256 ORIGINAL_MANIFEST_SHA256 \
  --directory /absolute/received/gravity-export
~~~

Resume with the same export, manifest and receiving directory. The existing receiver checks saved prefixes and the complete original file identities. The detailed [connected guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_referral/connected/README.md) includes the full action contracts, local and MCP examples, queue lifecycle and file receiving.

## Complete handover

Commission the product with the actual programme, actors, selected provider profiles, reviewed topology, original source and downstream destination. Deliver the installed source release, READY runtime, complete operating result, original source files, native customer output, selected referral handoff and whole editable workspace together.

[RECEIVING.md](RECEIVING.md) joins the full native, private browser, connected and installed Applications journeys to the same original result. The receiving host can then continue the saved programme through any of those interfaces.
