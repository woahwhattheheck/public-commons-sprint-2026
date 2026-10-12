# FHIR exports and eLTSS Care Plans

Operate complete FHIR exports and person-centered care-plan editions in one installed product. The two workbenches retain their own source files, original workspace identities and histories while sharing the maintained dataset, merchant, customer, Applications and connected-client engines.

The `healthcare-interoperability` selection includes both whole workbenches, their private browser interfaces, the 49-action FHIR connected client, the 77-action eLTSS connected client, original source notices, and complete native, browser and installed receiving programs.

| Work | Applications | Installed command | Complete result |
| --- | --- | --- | --- |
| Receive and review a FHIR Bulk Data export | FHIR Bulk Data | `starforge fhir-bulk` | Original request, provider files, reviewed projection, native editions and editable workspace |
| Review and deliver a care-plan edition | eLTSS Care Plans | `starforge eltss-careplans` | Original resources and graph, all published fields, assessments, corrections and complete CarePlan handoff |
| Operate the saved FHIR workspace from tools | Same FHIR Bulk Data operator | `starforge merchant-fhir-bulk` | Full native actions and complete source, result, dataset and workspace files |
| Operate the saved care-plan workspace from tools | Same eLTSS Care Plans operator | `starforge merchant-eltss-careplans` | Complete review, graph, correction, query, receiving and file operations |

## Build the complete selected product

Open **Build a product** in the existing Runtime workspace. Select the retained Merchant Workspace repository and its actual committed source. Choose **FHIR exports and eLTSS Care Plans**, review the selected applications, commands, files and runtime profile, then build the package into its own output directory.

The same maintained builder is available from the source checkout:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/existing/tjlabs-stellar-merchant-workspace \
  --ref ACTUAL_COMMITTED_SOURCE \
  --selection healthcare-interoperability \
  --out /absolute/releases/healthcare-interoperability
~~~

The resulting manifest binds that commit, the exact selected recipe, all original source files and the complete archive. Continue an interrupted build through its saved output and original request. The existing [Source Build guide](../../stellar/scf-starforge-20261009/distribution/runtime-workspace/SOURCE_BUILDS.md) describes the full browser and CLI continuation.

The recipe carries the complete FHIR, eLTSS and XML source components, the private runtime interface, source and dataset workers, native seller and buyer, customer delivery and merchant MCP host. The original builder discovers static imports; the recipe explicitly retains Python modules, browser assets and other files opened dynamically by these products. The original source inventory is in [SOURCE.json](SOURCE.json).

## Install and connect the runtime

Receive the builder's original archive and full SHA256. Install the same source package into an existing command environment if needed:

~~~sh
npm install --ignore-scripts --offline --omit=optional /absolute/downloads/original-healthcare-package.tgz
./node_modules/.bin/starforge registrations --source fhir-bulk
./node_modules/.bin/starforge registrations --source eltss-careplans
~~~

Use the original installer for the full native merchant and connected profile:

~~~sh
./node_modules/.bin/starforge runtime-install prepare \
  --dir /absolute/private/healthcare-runtime \
  --archive /absolute/downloads/original-healthcare-package.tgz \
  --sha256 ACTUAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

./node_modules/.bin/starforge runtime-install install \
  --dir /absolute/private/healthcare-runtime

./node_modules/.bin/starforge runtime-install run \
  --dir /absolute/private/healthcare-runtime -- source
~~~

Use the original dependency versions selected by that profile and retain its READY result, package identity and source root. Linux with Node 24 and Python 3.11 or newer meets these workbenches' native interpreter requirements. Their FHIR parser, reference graph, field review and archive operations use Python's standard library. The selected native payment and merchant features use the existing maintained dependency installation.

Attach that runtime to the existing Runtime workspace and open its Applications library:

~~~sh
starforge runtime-workspace attach \
  --workspace /absolute/private/existing-runtime-workspace \
  --runtime /absolute/private/healthcare-runtime \
  --label "Healthcare interoperability runtime"

starforge runtime-workspace serve \
  --workspace /absolute/private/existing-runtime-workspace
~~~

The Runtime host loads the source-owned providers when it starts. Reopen the host after adopting this source release so both applications appear. See [Runtime installation](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md) and [complete runtime transfer](../../stellar/scf-starforge-20261009/distribution/RUNTIME_TRANSFER.md) for receiving an existing READY installation.

## Open each original workspace

Use the original native workspace or receive its complete editable archive. The original operating result supplies the workspace path and UUID. A new installation can initialize separate private workspaces:

~~~sh
starforge fhir-bulk init --workspace /absolute/private/fhir-exports
starforge eltss-careplans init --workspace /absolute/private/careplans
~~~

In **Applications**, choose the relevant application and READY runtime, enter its initialized directory, select the existing private authentication profiles and environment file when needed, and keep the local port at `0` for an available loopback listener. **Review application** displays the exact command, source and workspace; **Save application** retains that selection. Continue its existing runtime connection, then **Review start**, **Start reviewed application**, and **Open application**.

FHIR Bulk Data binds `fhir/identity.json`; eLTSS binds `eltss/identity.json`. Both retain the original UUID and verify the authenticated native workspace before the Open link appears. Their own saved sources, mappings, field decisions and editions remain editable in that directory.

Use **Stop application** to close its native owner. A subsequent start reopens the same saved records with a fresh private listener. The [FHIR Applications guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_bulk/APPLICATIONS.md) and [eLTSS Applications guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_eltss/APPLICATIONS.md) give the exact request and recovery shapes.

The native CLI can own that same operator when Applications is stopped:

~~~sh
starforge fhir-bulk serve \
  --workspace /absolute/private/fhir-exports \
  --expected-workspace-id ORIGINAL_FHIR_WORKSPACE_UUID --port 0

starforge eltss-careplans serve \
  --workspace /absolute/private/careplans \
  --expected-workspace-id ORIGINAL_ELTSS_WORKSPACE_UUID --port 0
~~~

Run each long-lived command in its own terminal. Select the executing Python with the existing `SF30_FHIR_PYTHON` or `SF30_ELTSS_PYTHON` environment setting when required. The launcher carries the selected Node executable into the original dataset engine.

## Complete a FHIR export and native edition

### Source selection and acquisition

Open **Server exports**. Select the actual FHIR provider and authentication profile. Discovery retains its CapabilityStatement, SMART metadata and complete selected Group pages. Choose the actual system, patient or Group scope and save the complete export definition: resource types, modification bounds, elements, filters, associated data and the selected STU2 or STU3 behavior.

Inspect the generated request before starting it. The operation retains its UUID and exact definition across the original request, returned status location, permitted polling and complete output/error/deleted file receiving. A saved modification bound follows the provider's resource modification clock. Resource clinical dates remain original fields.

Continue the retained operation after interruption. The browser and connected client use its existing request and status URL. Complete files are reused; partial transfers preserve their original offset and validator. Original provider outcomes and retry instructions remain visible with the operation.

The product also receives a complete original FHIR source ZIP. The native `receive-capture` action joins an already-preserved source to its accepted export operation. Use that path for a previously accepted export whose original files were transferred separately.

### Original resources and reviewed mapping

Open **Original resources** to inspect every member and physical NDJSON line. Source type, resource ID, version, reference, file name and exact line location remain separate identities. Complete numeric tokens, array structure, null values and original line endings remain available.

Select a resource type in **Dataset mapping**. Review the actual field paths, array multiplicity, encoding, output type, nullability and missing-value behavior. Preview the complete selected projection and save the mapping. Native numeric conversion is an explicit mapping choice; the complete original JSON remains in source custody.

Build the edition in **Dataset editions**. The original SF30 engine creates its dataset snapshot from the exact saved source and mapping. **Native query** supports the declared fields, enabled equality/range filters, sort and original cursor. Continue each returned cursor through the full requested result.

### Revised exports and complete delivery

Use **Edition changes** to compare native datasets with the same reviewed key and mapping. A full initial export and an ordered set of modification exports can be composed through the existing source lifecycle. Original deletion records, conflicts and authored selections stay visible.

**Delivery and reopen** exports the complete source, native dataset, customer packet and editable workspace. The customer packet carries the original source and mapping so the receiver can reconstruct the same native edition. The editable workspace carries its saved acquisition, source and operating history for continued work.

The [complete FHIR operating guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_bulk/README.md) and [HTTP API](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_bulk/HTTP_API.md) describe every source, projection, composition and file operation.

## Complete a care-plan edition

### Original resources and graph

Open **Sources** to receive a complete resource, Bundle or source archive. The original published eLTSS example is included at `sf30-seller-sdk/fhir_eltss/examples/Bundle-2039212f3fa5406bb4ffd4a.json`. Its complete 128,055 bytes contain 39 resources and two CarePlans.

**Acquisition** can instead retain a selected Bundle URL, an observed CarePlan operation, or a reviewed REST graph request. The saved source selection, capabilities, actual returned next links, retry state and request identities travel with that acquisition.

In **Care plans**, choose the actual reference-resolution policy and CarePlan records. The graph resolves original full URLs, logical IDs, versions, contained resources and selected base URLs, retaining the observed candidates and explicit choices. Save the selected edition with its owner, actor and note.

### All published fields and assessment

**Field review** contains every one of the 56 published eLTSS dataset fields. It preserves the selected release's definitions, cardinalities, FHIR mapping text, guidance and original source references. The bundled source is eLTSS 2.0.0 STU2 for FHIR R4 4.0.1 and US Core 6.1.0.

Review each field's applicability, absence policy and exact ordered selectors. Outgoing and incoming graph steps select original related resources; value steps retain original JSON locations and values. Explicit conversions carry their original and selected representations. Save the entire review as a retained edition.

Run **Assessment** for the selected CarePlans and saved field review. Every plan/field cell retains its exact source record, pointer, value and review decision. The full page sequence and complete JSONL export retain present, absent, unresolved, not-applicable and pending-review states.

### Corrections and original editions

In **Corrections**, select the exact original resource and JSON path tokens. Preview the complete authored change; applying the saved preview uses its retained request hash. The result is a successor source and edition with the original predecessor preserved.

Open the complete resource comparison and inspect before/after values and changed paths. **Datasets** then reviews a resource projection, builds its original native dataset and queries the resulting snapshot. Merchant publication and customer preparation use the same SF30/SF88 engines as the FHIR workbench.

### Whole receiving

In **Delivery**, choose the CarePlan scope, field review, assessment, decisions and receiving target. A handoff retains the original members, selected collection Bundle, graph, every field row and cell, human-readable entry and complete file manifest.

Receive the full handoff in its destination workspace. Attach the actual downstream result and record the receiver, target object, original operation and any correction predecessor. The complete result bytes remain available from the receiving record.

Export the full editable workspace when another operator needs to continue authoring. Its native receiver restores the archive's original UUID, source files, complete records and history. The [eLTSS operating guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_eltss/README.md) includes exact CLI commands for all six delivery formats.

## Connected clients and the same native operator

The installed commands address declared workspace aliases in private connection files. Use the original schema and input declarations for each product:

| Product | Connection schema | Native descriptor | Merchant configuration |
| --- | --- | --- | --- |
| FHIR Bulk Data | `stellar-forge.fhir-bulk-merchant-connection.v1` | `fhir/operator-connection.json` | `fhirBulkConnection` |
| eLTSS Care Plans | `stellar-forge.eltss-merchant-connection.v1` | `eltss/operator-connection.json` | `eltssConnection` |

Each connection selects an initialized directory, label, startup ownership and complete host-file aliases. A running Applications operator is borrowed through its original descriptor. An explicitly startup-enabled persistent client can own the normal native `serve` process and release it through the same lifecycle.

The local commands support `call`, `value`, `download` and `reopen`. They retain complete native responses and original request metadata. Whole-source and result downloads preserve their exact files even when a small readable preview is available. The maintained receiver resumes saved prefixes and verifies the full manifest and original file hashes.

The original merchant host can load both configuration inputs together. Its provider registry retains `fhir-bulk-workspaces` and `eltss-careplan-workspaces`, with tool prefixes `merchant_fhir_bulk_` and `merchant_eltss_`. The respective typed exports are `./merchant/fhir-bulk` and `./merchant/eltss-careplans`; each includes its original setup and provider exports.

Follow the complete [FHIR connected guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_bulk/connected/README.md) and [eLTSS connected guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_eltss/connected/README.md) for working configuration files, native action contracts, typed examples and full-file receiving.

## Complete customer handover

Keep the selected source release and installed runtime with the actual product workspace, original complete input files, saved mapping or field review, native dataset/customer outputs and full editable archive. Commission the receiving environment using its chosen provider, authentication profile, resource scope, mapping and downstream destination.

[RECEIVING.md](RECEIVING.md) joins the complete native, browser, connected and installed Applications programs to those same original workspaces. The returned outputs and whole editable archive provide the continuing operator with the original source and saved work.
