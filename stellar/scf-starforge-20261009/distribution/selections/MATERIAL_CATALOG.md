# Material catalogues and supplier delivery

This selected product carries a supplier file through original-source retention,
material mapping, edition comparison, customer matching, supplier corrections and
complete delivery. It includes the private browser workspace, installed batch
commands, merchant MCP, typed Node client, BMEcat XML, native ETIM xChange 2.0,
2BA processing packages and portable customer receiving.

The source selection is **material-catalog**. The same selection works in the
standalone Merchant Workspace and its maintained shared source. The completed
distribution receipt identifies the actual repository, source commit, recipe
bytes, archive and SHA-256. Keep that receipt with the delivered package.

## 1. Build the selected committed product

Use the maintained builder from the source being released:

~~~sh
node /absolute/maintained/source/stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/original/checkout \
  --ref COMPLETE_SOURCE_COMMIT \
  --selection material-catalog \
  --out /absolute/releases/material-catalog-01
~~~

COMPLETE_SOURCE_COMMIT is the full immutable commit selected by the releasing
operator. The output contains the complete source archive and its retained
distribution identity. The builder resolves original relative imports, selected
browser assets and declared runtime manifests. It carries the original
contribution files and this recipe in the archive.

Continue an interrupted build in that same output directory:

~~~sh
node /absolute/maintained/source/stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /absolute/releases/material-catalog-01 --resume

node /absolute/maintained/source/stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /absolute/releases/material-catalog-01 --status
~~~

A completed resume adopts the original archive. A new source commit or a different
selection uses its own output directory. Add --offline only when the original
Git objects are already present in the maintained source cache. The existing
distribution/git-object-receiving.py workflow can receive an original archive
transfer into that cache before this same build.

### Selected capability and source ownership

The recipe selects the common **opensearch** and
**merchant-provider-opensearch-workspaces** contributions. The former registers
all five OpenSearch commands and the material/supplier/client exports; the latter
registers the original MCP provider. The recipe also selects the original
runtime installer, merchant/release controls, Buyer and native signer.

Its explicit source support follows the existing material-catalog-product
contribution's merchant/browser requirements. It carries the current supplier,
xChange and 2BA source and receiving entry points. The original source-selection
pipeline determines the full dependency closure.

The selected README specializes the product description while the maintained
standalone selector inherits its base repository identity. The public source
uses its own original repository identity. Inspect the actual manifest when
choosing source for an installed runtime.

## 2. Prepare the customer runtime

Use Linux, Node.js 24 or a newer compatible runtime, Python 3.11 or newer, npm and
util-linux flock. The maintained package minimum is Node 22.16; Node 24 also
supplies the built-in SQLite and JSON facilities used by the complete receiving
examples. The resolved runtime profile checks the actual selected requirements.

Create the private runtime parent before preparing a new installation. Copy the
original completed archive and its recorded checksum into the customer host's
private receiving directory.

~~~sh
node /absolute/maintained/source/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /srv/starforge/runtimes/material-catalog-01 \
  --archive /srv/starforge/downloads/ORIGINAL_ARCHIVE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature mcp --operator

node /absolute/maintained/source/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /srv/starforge/runtimes/material-catalog-01

node /absolute/maintained/source/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /srv/starforge/runtimes/material-catalog-01 --load --source
~~~

| Selection | Original runtime purpose |
| --- | --- |
| schema | The source-selected schema validation dependency and original manifest. |
| mcp | The source-selected MCP transport package, its declared dependencies and exported probe. |
| native | The original x402 core, Stellar, Bazaar extensions and Stellar SDK declarations used by paid merchant and Buyer operation. |
| operator | The maintained Linux, Python and flock requirements for the runtime and its child lifetimes. |

The installer resolves these versions from the delivered manifest and retains
its own complete lock. A local catalogue intake or supplier export works on the
retained data. Connecting to OpenSearch begins when the operator inspects or
captures the native source, evaluates search, or starts the managed seller.

An operator who only needs local catalogue and supplier processing can prepare a
separate schema/operator runtime from this same source archive. Use the complete
profile above for all browser, MCP, Buyer and paid merchant commands in this
guide. Add Python lxml to the host's existing Python environment when running the
included independent ETIM XSD receiving example.

### Use the installed command

The original runtime wrapper selects the installed CLI and its dependency tree.
For a shell session, this function is sufficient:

~~~sh
starforge() {
  node /absolute/maintained/source/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
    --dir /srv/starforge/runtimes/material-catalog-01 -- "$@"
}

starforge source
starforge registrations --command opensearch-catalog
starforge opensearch-catalog --help
starforge opensearch-materials-client tools
~~~

The completed prepare/inspect result supplies sourceRoot and dependencyRoot.
For the directory above, the normal sourceRoot is
/srv/starforge/runtimes/material-catalog-01/package/source. Use the actual
returned path if the receiver chose another directory.

The installed source tree keeps its original layout. In the examples below:

~~~sh
material_source_root=/srv/starforge/runtimes/material-catalog-01/package/source
material_product_root="$material_source_root/stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch"
material_private_root=/srv/starforge/work/material-catalog
~~~

These are task-specific shell variables. Original filenames and request JSON
remain in the private working directory.

## 3. Open the complete browser workspace

Create private inputs, requests and delivery directories. Copy the original
source declaration from the installed examples:

~~~sh
install -d -m 700 "$material_private_root" \
  "$material_private_root/inputs" \
  "$material_private_root/requests" \
  "$material_private_root/deliveries"

cp "$material_product_root/examples/source.json" \
  "$material_private_root/source.json"
chmod 600 "$material_private_root/source.json"

starforge opensearch-workspace \
  --source "$material_private_root/source.json" \
  --workspace "$material_private_root/workspace" \
  --port 8447
~~~

Open the printed loopback URL and choose **Material catalogs**. The browser needs
no frontend build. The saved source declares the endpoint and authentication
environment references; provide their actual values through the host's existing
credential environment when running a native search.

A merchant-plan file is optional for catalogue work. To prepare a paid search
product later, copy examples/merchant-plan.json, enter the intended price, asset,
receiving account and public origin, and add --plan with that private file to the
same workspace command.

The workspace directory remains bound to its source connection profile. Reopen
with the same original source declaration and directory. Browser, batch and MCP
use the same records; choose one current owning server or command session and
allow its original close/drain to finish before handing ownership to another
long-lived host.

## 4. Complete a material intake

### First edition using the included SAP source

The installed examples/material-catalog directory includes the complete two SAP
SHINE product editions, their mapping, source index and original license. Each
edition contains 106 product rows. The joined CSV retains the original English
name and description and the literal SUPPLIER.PARTNERID column.

In the browser:

1. Choose **New catalog**, enter a title and the intended tenant identifier, then
   choose **Map SAP product columns** and save the complete mapping.
2. Retain sap-shine-sps11.csv as CSV with a header and comma delimiter. Inspect
   its recorded byte count, SHA-256, publisher and source revision.
3. Build a **Full catalog replacement** edition using the saved source and
   current catalogue revision.
4. Review all resulting materials and changes, then select that edition using
   its original review checksum.
5. Retain sap-shine-sps12.csv as another original source. Build its full edition
   using the first edition as the comparison base. Review the supplier changes
   and select the intended current edition.

The source index and SOURCES.md contain the actual SAP commits and extraction
details. The two published releases change the supplier value for all 106
products while retaining the material identifiers. Use the complete returned
change records when reviewing that transition.

### The same intake through batch commands

Write one original upload request in the private requests directory:

~~~json
{
  "requestId": "sap-sps11-source-1",
  "format": { "kind": "csv", "hasHeader": true, "delimiter": "," },
  "provenance": {
    "publisher": "SAP",
    "revision": "c8ef4bef064bc4b22e777e01ad5e469d070652f8",
    "kind": "published-product-catalog"
  }
}
~~~

Then pass the original installed CSV:

~~~sh
starforge opensearch-catalog catalog-upload \
  --source "$material_private_root/source.json" \
  --workspace "$material_private_root/workspace" \
  --file "$material_product_root/examples/material-catalog/sap-shine-sps11.csv" \
  --request "$material_private_root/requests/sap-sps11-source-1.json"
~~~

The CLI hashes and transfers the same opened regular file and fills omitted name,
bytes and SHA-256 fields. Keep the returned source ID and each original operation
result with the request that produced it.

Save a catalogue with the complete object from mapping-sap-shine.json under its
mapping field. Use these original method requests for the remaining steps;
CAPITALIZED values select actual records returned by the preceding operation.

| Command | Complete selection to retain in its request JSON |
| --- | --- |
| catalog-save | requestId, title, tenantId, mapping. An edit also supplies catalogId and expectedRevision. |
| catalog-preview | requestId, catalogId, expectedRevision, sourceId, mode:"full", baseEditionId:null for the first edition; the actual base edition for comparison. |
| catalog-select | requestId, catalogId, expectedRevision, editionId and reviewSha256. |
| catalog-decision | requestId, catalogId, expectedCatalogRevision, customerId, description, materialKey, expectedMaterialSha256, status and note; an edit also identifies decisionId/expectedRevision. |
| catalog-create-draft | requestId, catalogId, expectedRevision, index and variant:"baseline" or "identifiers". |

Pass each request with the same --source, --workspace and --request flags.
These are method inputs; the batch command does not take the browser's action
envelope. Read the original operation state before using its result.

Use catalog-show, catalog-history, catalog-source, catalog-edition,
catalog-materials and catalog-changes to inspect the full records and pages.
The current revision can change when the catalogue is saved or an edition is
selected. Read it from the retained catalogue before a later mutation.

### Customer matching and exact quantities

Use the actual customer ID and description in **Customer matches**. Inspect the
complete material before approving or rejecting it. The decision records the
catalogue revision, material checksum, original customer text and operator note.

After the selected edition changes, a decision whose material changed is shown
for reconsideration. Its earlier decision revision remains retained.

Quantities are decimal text. For a material whose original base unit is EA:

~~~sh
starforge opensearch-catalog catalog-quantity \
  --source "$material_private_root/source.json" \
  --workspace "$material_private_root/workspace" \
  --catalog CATALOG_ID --material-key MATERIAL_KEY \
  --material-sha256 MATERIAL_SHA256 \
  --quantity 12.500 --unit EA
~~~

The result retains the original quantity and unit and the exact rational
conversion. A unit alias only renames an explicitly selected unit; the saved
ratio supplies the conversion.

## 5. Review a supplier submission

The supplier layer maps an immutable material edition into a recipient product
and retains reasoned corrections and complete reviews.

| Recipient | Source and delivery |
| --- | --- |
| Sonepar | April 2026 Product Data Guidelines, release 3.1, with its applicable category, market and content requirements. |
| ETIM BMEcat 5.0 | Original BMEcat envelope, product ordering, lexical values and the published 5.0.2 schema. |
| ETIM xChange 2.0 | Complete nested native JSON, original numeric tokens, explicit previous-version selection and recipient state. |
| 2BA xChange 2.0 | Native xChange plus the selected 2BA mappings, processing controls and complete upload ZIP. |

Open **Supplier delivery**, select the target, map product fields to the retained
material and save the submission. A mapping uses a supplier JSON Pointer on its
left and the original material pointer on its right. An explicit constant also
retains the operator's reason.

Read the complete original template through the batch command:

~~~sh
starforge opensearch-catalog catalog-supplier-profile \
  --source "$material_private_root/source.json" \
  --workspace "$material_private_root/workspace"

starforge opensearch-catalog catalog-supplier-profile \
  --source "$material_private_root/source.json" \
  --workspace "$material_private_root/workspace" \
  --target xchange-2.0
~~~

For a new native xChange catalogue, use the returned catalogMapping for its
material mapping and the returned profile/bindings for the supplier submission.
The BMEcat template selects its original profile separately.

Save the full submission with catalog-supplier-save and its stable requestId.
Save a review with catalog-supplier-review using the selected planId and current
expectedRevision. Inspect catalog-supplier-rows and catalog-supplier-row for the
full immutable product and findings. In the CLI, --submission selects a supplier
plan; --plan still selects the optional OpenSearch merchant-plan file.

A correction retains its plan revision, original material SHA-256, projected
base-product SHA-256, correction revision, complete patch list and reasons.
Clearing a saved correction uses an empty patch list through the same operation
family. Changes to the source or mapping require a review of the resulting
correction basis before accepting it again.

Supplier exports require the actual review ID and expected review checksum:

~~~sh
starforge opensearch-catalog catalog-supplier-export \
  --source "$material_private_root/source.json" \
  --workspace "$material_private_root/workspace" \
  --review REVIEW_ID --review-sha256 REVIEW_SHA256 \
  --format bmecat.xml \
  --output "$material_private_root/deliveries/supplier-catalog.xml"
~~~

A BMEcat review also offers review.json, issues.csv and products.jsonl. The
complete XML uses the selected transaction, parties, languages, order units,
prices, classification, attachments and relationships. Keep the immutable
review with the recipient file.

### Included full-catalogue publisher example

examples/supplier-etim contains the original ETIM10 XML, bmecat_etim_501.xsd,
the projected product JSONL/profile, the complete source-node mapping and its
original converter. Use the source index to identify which original XML values
are projected and which remain in the mapping report.

Choose the BMEcat-only profile for that publisher example. The Sonepar target
has additional requirements; the profile explicitly determines which rules
apply. The supplier GUIDE.md documents the original sample workflow and its
independent XSD receiving program.

## 6. Preserve native xChange and its recipient history

The source directory is:

~~~text
sf30-seller-sdk/opensearch/catalog/supplier/xchange/source/
~~~

It includes the complete ETIM_xChange_SampleFile_V2.0_2025-11-27.json,
ETIM_xChange_Schema_V2.0_2025-11-27.json, Apache 2.0 license, notice and source
rules. The sample is 27,705 bytes; its source Git blob is
7eb6d73991ce2f1a82f16edac3b9b13216fcabe7.

Upload that file with format.kind set to xchange-json. The original parser
consumes the complete input, checks EOF/size/hash and joins full root and supplier
headers before exposing a material row. It retains the complete product and
trade-item subtrees.

Numeric JSON values retain their original lexical text and a separate token map.
Quoted identifiers or decimal strings remain quoted. Use the native correction
editor's scalar/tree controls or the complete token-map operation when changing
a numeric field. Removing a correction restores the corresponding original
number metadata. The original uploaded bytes remain available.

A native CHANGE message selects its actual prior recipient review and names the
preceding CatalogueVersion in ChangeReferenceCatalogueVersion. FULL applies full
membership. Inspect the complete product and trade-item before/after records with
catalog-supplier-recipient-rows before delivering the new review.

The original publisher sample contains a trailing-space URI that the selected
schema reports. Correct that specific value with a reason in the supplier
workspace and review the result. Keep the source file and earlier error review
alongside the corrected delivery.

Native xChange exports are xchange.json, recipient.jsonl and impact.csv, plus the
three general supplier diagnostic formats. Recipient history is part of the
complete catalogue bundle. A receiving operator can review that history and
select its existing previous delivery when preparing the next message.

## 7. Produce the complete 2BA upload

Select the 2ba-xchange-2.0 template, save the complete receiving profile and open
**2BA processing and upload package**. Supply the actual status mapping source
and any published modelling-class references required by the selected products.

The included current MC000023/v5 source records **Ready for publication** and
**Dynamic**. It therefore supplies an actionable modelling-release finding for
the original sample. The retained older extraction remains source history.
Use an actual published class reference when required, or make a reasoned
product correction that omits optional modelling data from the intended
delivery. Review the complete resulting product and its exact numeric metadata.

Processing is an explicit saved profile selection. For example:

~~~json
{
  "schema": "stellar-forge.2ba-processing.v1",
  "reason": "Apply this delivery to the selected previous recipient catalogue.",
  "parameters": {
    "GeneratedBy": "Starforge material catalogue",
    "ReportLanguage": "EN",
    "OverrulePackageMutationCode": true,
    "PackageMutationCode": "UpdateExistingCatalog",
    "InteractiveChecks": [
      { "Code": "7000161", "SolutionId": "166" }
    ]
  }
}
~~~

Save it under profile.processing. This example deliberately selects CHANGE
processing and retains omitted attachment references. It requires the actual
previous compatible recipient review. Choose the processing that matches the
recipient agreement rather than copying an example's business meaning.

The controls also expose SkipLoadProducts, SkipLoadArticlesAndPrices,
SkipLoadPrices, SkipLoadAttachments, KeepMimeURL and AutoConvertToMasterGLN.
Review their effects under recipient.processing and the complete skipped,
retained, changed and removed records.

| Omitted attachment behavior | Code and solution |
| --- | --- |
| FULL, keep | 7000160 / 106 |
| FULL, remove | 7000160 / 108 |
| CHANGE, keep | 7000161 / 166 |
| CHANGE, remove | 7000161 / 165 |

xChange URL-retention selections use the original MDX code list. BMEcat MD codes
belong to the separate format. Recipient report addresses are an explicit
selection in SendReportToEmail.

Export the same zero-error immutable review as parameters.xml and 2ba.zip.
The ZIP contains exactly the generated **parameters.xml** and complete
**ETIM_XCHANGE_<review-id>_<native-type>.json**. The native JSON/header and
filename preserve the native type; recipient.processing records the effective
processing type selected by the parameters.

~~~sh
starforge opensearch-catalog catalog-supplier-export \
  --source "$material_private_root/source.json" \
  --workspace "$material_private_root/workspace" \
  --review REVIEW_ID --review-sha256 REVIEW_SHA256 \
  --format 2ba.zip --output "$material_private_root/deliveries/2ba-upload.zip"
~~~

The actual downloaded 2BA example specifies the case-sensitive
UCProcessParameters root and **http://www.2ba.nl** namespace. The exact
387-byte original ZIP and its 446-byte XML member travel with this package.
The source index records the differences between that example and translated
web snippets.

A 2BA review offers eight formats: review.json, issues.csv, products.jsonl,
xchange.json, recipient.jsonl, impact.csv, parameters.xml and 2ba.zip. The
archive is streamed with ZIP64 sizes and CRC-32. Its payload contains native
references; attachment retrieval remains the recipient's selected processing.

The operator submits the completed ZIP through the intended existing 2BA upload
account and retains its actual processing report against the same review and
file checksum. The installed 2BA_UPLOAD.md gives the full source decisions and
processing semantics.

## 8. Operate through MCP and the typed client

The selected merchant provider uses the original workspace and operation
journal. Create a private connection file with the intended aliases and selected
original inputs:

~~~json
{
  "schema": "stellar-forge.opensearch-workspace-connection.v1",
  "workspaces": {
    "catalog": {
      "label": "Supplier catalogue",
      "directory": "/srv/starforge/work/material-catalog/workspace",
      "sourceFile": "/srv/starforge/work/material-catalog/source.json",
      "materialInputs": {
        "supplier-original": {
          "path": "/srv/starforge/work/material-catalog/inputs/supplier.json",
          "name": "supplier.json",
          "bytes": 27705,
          "sha256": "ACTUAL_64_CHARACTER_FILE_SHA256"
        }
      },
      "runtime": { "port": 0 }
    }
  }
}
~~~

Replace the input metadata with the selected original file's actual length and
SHA-256. The source input alias is the tool-facing selection. Host paths and
credentials stay in the private host configuration. The optional planFile and
runtime facilitator settings use the existing OpenSearch merchant contract.

Initialize the original merchant host in a new private directory, then serve it:

~~~sh
starforge merchant-mcp init-opensearch-workspaces \
  --dir /srv/starforge/work/material-mcp \
  --connection /srv/starforge/work/material-catalog/opensearch-workspaces.json \
  --name "Material catalogue"

starforge merchant-mcp serve \
  --config /srv/starforge/work/material-mcp/merchant-mcp.json \
  --port 3211 --token-env MCP_ACCESS_TOKEN
~~~

Use the actual configPath returned by initialization if its retained filename
differs. Supply MCP_ACCESS_TOKEN through the host's existing secret environment.
The original stdio command and merchant-mcp-client-config remain available for
subprocess MCP hosts.

### Typed CLI operations and whole-file receiving

Use the actual endpoint printed by the host as STARFORGE_MCP_URL:

~~~sh
starforge opensearch-materials-client open --workspace catalog

starforge opensearch-materials-client material-inputs --workspace catalog

starforge opensearch-materials-client material-list \
  --workspace catalog --input /private/requests/catalog-list.json --all-pages

starforge opensearch-materials-client supplier-review \
  --workspace catalog --input /private/requests/supplier-review.json

starforge opensearch-materials-client inspect-export \
  --workspace catalog --export-id ORIGINAL_EXPORT_ID

starforge opensearch-materials-client download-export \
  --workspace catalog --export-id ORIGINAL_EXPORT_ID \
  --expected-manifest-sha256 ORIGINAL_MANIFEST_SHA256 \
  --directory /private/deliveries/original-export

starforge opensearch-materials-client close --workspace catalog
~~~

The catalogue-list input is {"collection":"catalogs","limit":50}. Tool requests
omit workspace because the CLI/client binds the alias separately. The complete
tool schemas are available from the local tools command.

For a supplier export, retain requestId, reviewId, expectedReviewSha256 and the
selected formats array. Material exports retain requestId, catalogId,
expectedCatalogRevision, formats and any editionId/index selection. Read the
original operation state before accepting its result.

MCP page responses carry their nextCursor, nextRevision or nextOffset.
Continue to null, including a page shortened by the byte budget. --all-pages
follows those original continuations. Complete files use the retained export
manifest and reader, with a per-file limit of 8 GiB and a 64 KiB manifest limit.

The Node entry is
@tokenjunkielabs/starforge-merchant/clients/opensearch-material. Its adjacent
declarations ship in the selected product:

~~~js
import { readFile } from 'node:fs/promises';
import {
  createOpenSearchMaterialClient
} from '@tokenjunkielabs/starforge-merchant/clients/opensearch-material';

const client = await createOpenSearchMaterialClient({
  url: process.env.STARFORGE_MCP_URL,
  workspace: 'catalog',
  tokenEnv: 'MCP_ACCESS_TOKEN'
});
await client.open();
try {
  const request = JSON.parse(await readFile('/private/requests/export.json', 'utf8'));
  const operation = await client.materialExport(request);
  if (operation.state !== 'COMPLETE') throw new Error(JSON.stringify(operation));
  if (operation.result.fullResultRetained === true) {
    throw new Error(operation.result.fullResultHint);
  }
  await client.downloadExport({
    exportId: operation.result.exportId,
    expectedManifestSha256: operation.result.manifestSha256,
    directory: '/private/deliveries/original-export'
  });
} finally {
  await client.close();
}
~~~

The download retains its original endpoint, alias, export ID, manifest hash,
partial prefixes and read offsets. Reopen the same directory after an
interruption. The original helper resumes an expired read lease on the same
file identity and verifies the complete bytes before publishing completion.

## 9. Receive and continue the complete customer catalogue

Choose **Complete catalog bundle** in the browser or export it through the
installed command:

~~~sh
starforge opensearch-catalog catalog-export \
  --source "$material_private_root/source.json" \
  --workspace "$material_private_root/workspace" \
  --catalog CATALOG_ID --format catalog-bundle.jsonl \
  --output "$material_private_root/deliveries/catalog-bundle.jsonl"
~~~

Keep the actual complete file, byte count and checksum. The bundle carries the
original source bytes, catalogue revisions, mappings, editions, decisions,
supplier plan/correction histories, immutable reviews and complete recipient
records. Supplier history uses the maintained v2 bundle; original v1 handovers
remain readable.

The customer selects a private receiving workspace and the original source
connection profile. Write a receiving request with its own stable requestId:

~~~json
{ "requestId": "customer-catalog-receive-001" }
~~~

~~~sh
starforge opensearch-catalog catalog-import \
  --source /private/customer/source.json \
  --workspace /private/customer/material-workspace \
  --file /private/customer/delivery/catalog-bundle.jsonl \
  --request /private/customer/requests/receive-001.json

starforge opensearch-catalog catalog-state \
  --source /private/customer/source.json \
  --workspace /private/customer/material-workspace
~~~

For MCP receiving, declare the exact downloaded bundle as a customer
materialInputs alias, then call material-receive with that inputId and the
original receiving requestId. Read the received catalogue, plan/review/correction
history, selected edition and complete recipient pages.

The importer verifies original histories and reconstructs their reviewed
products and effects before committing. Replaying an earlier compatible bundle
retains newer receiving decisions and corrections. Conflicting changes to the
same historical identity remain visible for reconciliation.

Create the customer's later corrections and delivery in that same receiving
workspace. Export its complete later bundle when handing the work onward.

## 10. Continue into an original paid search product

From the selected material catalogue, choose **Search and handover**, an actual
OpenSearch index and baseline or identifiers variant. This creates a normal
saved query draft with the catalogue/tenant filter and original merchant route.

Export index.json and bulk.ndjson to the intended existing OpenSearch
ingestion process. Apply reviewed delta.ndjson only against its selected
original base. The generated source.json and search-client.ts retain the
declared query, source references and typed client contract.

Use the original draft workflow to save and validate the selected price and
query, inspect the actual native source, capture its result and prepare the
merchant package. Deployment stages, compares, selects and starts the saved
release through the original controller. The customer client is generated
from that actual merchant contract.

The standalone entry points are unchanged:

~~~sh
starforge opensearch-prepare \
  --source /private/search/source.json \
  --plan /private/search/merchant-plan.json \
  --directory /private/search/prepared

starforge opensearch --directory /private/search/prepared --inspect

starforge opensearch --directory /private/search/prepared \
  --port 8423 --operations-port 8424 \
  --facilitator https://YOUR_CONFIGURED_FACILITATOR
~~~

Use the intended current source and merchant plan for these commands. The
OpenSearch source requires an actual supported 3.3-or-newer cluster and the
permissions declared in its README. The native runtime profile supplies the
source-selected payment libraries; facilitator and receiving-account settings
come from the merchant's actual configuration.

The exported Buyer Node client and native signer use their existing operator
profile, state directory, approval limits and saved-response recovery. Each
customer call receives the complete configured query result through the
original search and settlement lifecycle.

## 11. Resume, upgrade and hand over ownership

| Retained object | Supported continuation |
| --- | --- |
| Source distribution | Same output directory and build --resume; source commit and selection stay pinned. |
| Customer runtime | Same prepared directory and runtime-install resume; inspect --load --source after completion. |
| Source upload or mutation | Same requestId and complete input; inspect catalog-operation or the original MCP operation result. |
| Sealed MCP export | Same exportId/manifest/checksums and receiving directory, including after later business edits. |
| Unsealed MCP export | Same request under the original complete source fingerprint; changed source selection requires a new explicit export request. |
| Customer catalogue | Same receiving workspace and bundle identity; compatible earlier history can be replayed after newer customer work. |
| Managed seller | Original release, controller and instance identity through status, drain, restart, upgrade or rollback. |

Use runtime-install upgrade --from OLD_RUNTIME --dir NEW_RUNTIME with the new
original archive and its SHA-256. Keep the previous runtime until the new
selected installation and workspace continuation are ready. runtime-install
compare shows the retained change; recover prepares a new directory from the
original selected runtime when appropriate.

The browser and MCP host close their admitted work and retained readers before
closing SQLite. A failed close preserves its owner for the same close
continuation. Let that owner finish before moving a complete workspace.

A runtime archive installs code and dependencies. A catalogue bundle delivers
business source/history. Keep both identities in the customer handover so the
recipient can install the exact product and continue the exact catalogue.

## Included operating references

Paths below are relative to the installed sourceRoot. They retain the original
source and supplier publications.

| Reference | Original path |
| --- | --- |
| Material mapping, editions, customer decisions and CLI | stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/catalog/GUIDE.md |
| Sonepar and BMEcat submission | stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/catalog/supplier/GUIDE.md |
| ETIM xChange intake, corrections and recipient state | stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/catalog/supplier/xchange/GUIDE.md |
| Complete 2BA processing/upload and source decisions | stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/catalog/supplier/xchange/2BA_UPLOAD.md |
| Merchant material/supplier MCP and typed client | stellar-forge/mcp-merchant-operator/OPENSEARCH_MATERIALS.md |
| Native query, relevance and managed merchant MCP | stellar-forge/mcp-merchant-operator/OPENSEARCH_WORKSPACE.md |
| Original runtime install/receive | stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md and RUNTIME_TRANSFER.md |
| Original source recipe/build | stellar/scf-starforge-20261009/distribution/SOURCE_SELECTIONS.md and BUILDING.md |

The SAP source index and license, ETIM schema/sample license and notice, original
ETIM XML/XSD/mapping, 2BA XML/ZIP acquisition record and modelling-class source
history are included with the product. Read those retained records when adapting
a publisher example or selecting the next recipient's rules.

Primary publication references include
[ETIM BMEcat 5.0.2](https://www.etim-international.com/wp-content/uploads/2021/09/ETIM-BMEcat-Guideline-V5-0-2-2024-12-12.zip),
[ETIM's BMEcat guideline](https://etim.ch/de/downloads/downloads/2-bmecat?download=12:etim-bmecat-guideline-v5-0-en),
[Sonepar's product-data guide](https://www.sonepar.com/resource/blob/85322/d6950a910363f19c4fdc060017186082/sonepar-product-data-guidelines-data.pdf),
[2BA native xChange rules](https://www.2ba.nl/en/documentation/file-exchange/etim-xchange-v2-0/),
[2BA's original processing parameters](https://www.2ba.nl/documentatie/bestandsuitwisseling/upload-bestanden/process-parameters/)
and the [original parameters archive](https://www.2ba.nl/wp-content/uploads/parameters.zip).
