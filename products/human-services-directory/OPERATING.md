# Operate the Human Services Directory product

Build and install the `human-services-directory` selection to operate the complete directory workflow from original source to editable customer handoff. The selection extends the maintained Gravity referral and healthcare interoperability products. It includes their native source and the directory's browser, CLI, connected SDK/MCP and managed application.

## Build the selected source

Use a checkout containing the chosen complete commit, Node 22 or newer, and the Python executable selected for the native tooling. Give this source commit and selection its own output directory.

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/source-checkout --ref COMPLETE_SOURCE_COMMIT \
  --selection human-services-directory --offline \
  --out /absolute/directory-release --python /absolute/python3
```

The selected recipe is `stellar/scf-starforge-20261009/distribution/selections/human-services-directory.json`. The builder retains the recipe, original source commit, complete archive, installed/source inventory and byte identities. The selected source includes the inherited production dependencies and browser assets discovered by the normal builder. Continue an interrupted build with its original output directory and the builder's `--resume` option.

## Prepare and install the runtime

Read the exact archive path and SHA-256 from the completed build result, then use the maintained runtime installer:

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /absolute/directory-runtime \
  --archive /absolute/directory-release/ORIGINAL_ARCHIVE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /absolute/directory-runtime --cache /absolute/runtime-cache

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /absolute/directory-runtime --load --source
```

Use the installed package's `starforge` command after installation. The directory application is available in the normal runtime workspace's **Applications** catalogue. [APPLICATIONS.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/APPLICATIONS.md) covers selecting the workspace, launch inputs and stop/reopen operation.

## Create or receive the workspace

```sh
starforge human-services-directory init --workspace /absolute/private/directory

starforge human-services-directory serve \
  --workspace /absolute/private/directory --host 127.0.0.1 --port 0
```

Use the returned operator URL to open the directory. The operator writes its descriptor in the selected private workspace. A transferred complete directory is received through `receive-workspace --workspace ABS --file ORIGINAL_ZIP`, which restores its original UUID and inherited records. Follow [RECEIVING.md](RECEIVING.md) when continuing an existing native programme.

## Bring in complete original source

| Original material | Native import format | Selection to review |
| --- | --- | --- |
| HSDS entity, array, provider page or tabular JSON | `hsds-json` | Table and original layout |
| One HSDS table file | `hsds-csv` | Table, encoding and delimiter |
| Whole HSDS CSV archive | `hsds-csv-zip` | Exact member names and each member's table/encoding/delimiter |
| Original FHIR resource or Bundle | `fhir-json` | Reference base, publisher and scope |
| Whole FHIR JSON archive | `fhir-json-zip` | Selected original members and reference base |
| Native retained provider capture | `directory-capture` | Original acquisition metadata and completion state |

Every import includes its label, format and origin. Use `published_reference` for the retained publisher source, `operator_source` for the selected provider's actual data, and `authored_example` for an intentionally authored exercise. Preserve `snapshot`, `subset`, `incremental` or `unknown` scope from the source. `filename` retains the original file name independently of its immutable byte identity.

An original file can be imported with a complete metadata JSON:

```sh
starforge human-services-directory source-import \
  --workspace /absolute/private/directory \
  --input /absolute/private/original-import-profile.json \
  --file /absolute/original/directory.zip
```

Alternatively save an import profile first and use its retained ID with `--import-profile`. The connected interface performs the same profile-save step followed by a complete streamed upload. Original archive members, source rows, native identities, reference relationships and complete SQLite indices remain accessible from the imported source.

## Refresh a selected provider

Save the exact provider connection using the installed schema: HSDS or FHIR HSD protocol, base URL, publisher context and an optional existing authentication profile name. Discovery captures the provider's actual declared interface. Review the request's exact route, resource/table selection, repeated query parameters, pagination and scope before acquiring it.

The native acquisition uses an explicit operation ID. Its saved state keeps the original request, received pages and headers, continuation, decoded records and completion state. Use the operation view to advance, pause or resume that same operation. A capture can be retained as source while preserving its actual received scope. Full source acquisition commands, result shapes and provider handling are documented in [SOURCE_API.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/SOURCE_API.md).

The source catalogue defines complete supported provider routes and limits. Do not infer that discovery of one endpoint proves a different route is available. A saved request binds the selected provider, so a recovered operation continues with the same provider state and original timing.

## Freeze and compare directory editions

Select the full set of source IDs and optional tables that make up the edition. Save an actor and review note; name a predecessor when continuing an existing edition. The frozen edition joins the selected original records and preserves source references as `{sourceId, recordId}`.

Review each relationship against its native identity candidates. A relationship can have multiple candidates or no target. The UI and API expose every target page, including targets beyond the initial relationship preview. Use the original source reference when making an explicit identity decision.

Compare the selected before and after editions. The complete change inventory retains `unchanged`, `changed`, `only-before`, `only-after`, `ambiguous` and `unidentified` states. Explicit reviewed links resolve the selected original identities and record the operator's reason. The full comparison SQLite and JSONL are downloadable alongside paginated change rows.

## Review and apply mapping

Select the edition, mapping mode, identity/reference settings and complete native rules. The installed mapping catalogue retains published source-to-target mappings and the explicit migration decisions required by the selected HSDS and HSD versions. Add the intended type conversion to a rule when the source requires it; the declared `valueType` choices are `original`, `string`, `number`, `integer` and `boolean`.

Prepare the mapping preview, then inspect all generated resources, source-to-field cells and findings. The preview has separate complete pages for `resources`, `fields` and `findings`. It retains the original mapping ID and edition. Apply the reviewed preview to create the retained conversion and its original FHIR source.

Original numeric and boolean values remain meaningful through review. A retained zero is a value, including in capacity-related source fields. Source facts and the operator's mapping decisions remain inspectable in the resulting record lineage.

## Select the destination service

Choose the original converted edition and record the criteria for the referral destination. Review all candidate records, their source identifiers, service locations, eligibility and provider information, and the complete retained schedule and capacity interpretation. Give every selected or excluded candidate its intended disposition.

Record each explicit schedule decision against the original service reference. The schema distinguishes `operating-hours`, `event` and `exclude`, with the operator's reason. Keep the provider's own availability and exception fields alongside that interpretation. Capacity and schedule data inform the reviewed candidate; they remain tied to their original source and edition.

The saved service selection retains the criteria, chosen original references and complete candidate inventory. Reopen it from the saved record to inspect the exact selection used by a later handoff.

## Join the selected clinical resources

Open the original Gravity referral edition to be continued. The directory join takes the exact chosen service selection and conversion, the original clinical edition, and explicit original Task/ServiceRequest bindings. Review the bindings in the UI and save the resulting successor edition.

The join retains its source edition, selected clinical resources, service references and generated graph/source lineage. The original clinical workspace remains available alongside the directory record. All subsequent handoffs select the saved join by its retained ID.

## Prepare, hand over and receive the complete workspace

Prepare a handoff from the saved service selection and conversion, adding the original referral join when selected. Save its owner, recipient and operator context. Download the complete handoff packet and the latest complete editable workspace from the retained records.

Receive the handoff into its intended receiving workspace and review its original records there. The native receiving result identifies the incoming archive and preserved workspace UUID. Save the receiving disposition against the original handoff. A full workspace receive reconstructs the directory, inherited Gravity/eLTSS records, source files and complete indices.

Use full-file exports for archival and customer delivery. Paginated views carry `nextOffset` and a declared byte budget; follow every remaining page when computing a complete inventory. Native whole-workspace archives support 2 GiB, while the inherited connected transport retains its 512 MiB file ceiling. Use the native file command for a larger complete archive.

## Run the same work from connected tooling

The typed SDK, normal Merchant MCP host and `merchant-human-services-directory` CLI share the installed native catalogue and the existing operator. Their connected input bodies keep the complete schemas and exact native record IDs. [The connected guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/connected/README.md) contains connection JSON, source import, complete pagination, file download and whole-programme examples.

## Transfer the installed runtime

```sh
node stellar/scf-starforge-20261009/distribution/runtime-transfer-cli.mjs export \
  --runtime /absolute/directory-runtime \
  --directory /absolute/directory-runtime-transfer \
  --cache /absolute/runtime-cache

node stellar/scf-starforge-20261009/distribution/runtime-transfer-cli.mjs inspect \
  --directory /absolute/directory-runtime-transfer --verify
```

The runtime transfer preserves the complete installed source and selected runtime assets. Transfer the separately selected complete editable workspace with it when continuing the operator's saved work. The receiving guide ties the native, browser, connected and installed application results to their original inputs.
