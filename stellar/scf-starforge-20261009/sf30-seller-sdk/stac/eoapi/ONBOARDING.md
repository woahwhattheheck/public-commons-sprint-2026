# Customer imagery onboarding

This operator carries an approved eoAPI configuration through the original STAC catalog, analyst selection, exact file delivery and customer receiving. Open **Customer operations** in the maintained STAC workspace to review the deployment, associate a captured edition, acquire explicit selected assets, approve its immutable export and prepare the customer handover. **Deployment commissioning** uses the original retained plan/run workspace and its saved source responses.

The original source provider owns catalog requests and file capture. The original policy workspace owns ordered configuration, review, approval and receiving. The original merchant and Buyer own payment, acquisition and portable source custody.

## Open an operator

Use Node 24 and the installed StarForge runtime. Initialize the customer extensions in either a new or an existing analyst workspace:

~~~sh
starforge stac eoapi-init --workspace /absolute/customer-workspace \
  --endpoint https://earth-search.aws.element84.com/v1 \
  --title "Customer imagery"

starforge stac eoapi-serve --workspace /absolute/customer-workspace
~~~

Open the complete local URL printed by the command. The original operator handles local host checks, its browser session and CSRF protection. Catalog, scene and selection views and FilmDrop processing remain available.

The command `starforge stac eoapi-help` lists the complete surface. `--policy-workspace` selects an existing original policy directory; `--output-directory` selects a separate delivery root.

## Review the configuration and source

Load an authored policy JSON or a complete approved package in **Deployment configuration**. Review the saved draft, inspect the ordered access rules and collection rights, then approve that exact review with the responsible operator's name. A later edit creates a new draft while prior approvals and delivered editions remain available.

For a public upstream catalog, use the policy compiler's native public mode. For a customer identity deployment, use its actual OIDC discovery, audiences, ordered route rules and record filters. The compiler produces the original Auth Proxy configuration and an explicit list of stale settings to remove.

The source review distinguishes **Upstream catalog** from **Customer deployment**. Its endpoint, captured root, collection records, declared conformance, licenses and selected collection IDs must match the saved configuration. A review of one captured collection authorizes a new query only within the reviewed collections.

Use **Review retained catalog** for a saved original edition. **Associate captured edition** binds that complete edition to the exact source review and policy package. A handover imported through the original STAC command preserves its captured edition IDs and original files.

~~~sh
starforge stac eoapi-policy-import --workspace /absolute/customer-workspace \
  --input /absolute/approved-policy-package.json
starforge stac eoapi-source-review --workspace /absolute/customer-workspace \
  --edition EDITION_ID --target upstream --reviewer "Operator name"
starforge stac eoapi-bind --workspace /absolute/customer-workspace \
  --source-review SOURCE_REVIEW_ID --edition EDITION_ID \
  --operation-id customer-edition-association
~~~

For a new capture, save the query in the original analyst view and choose it in Customer operations. The controller retains the original query-save, search-review and acquisition operation IDs. Continue a partial capture with the same operation:

~~~sh
starforge stac eoapi-capture --workspace /absolute/customer-workspace \
  --source-review SOURCE_REVIEW_ID --input /absolute/query.json \
  --operation-id customer-scene-capture
starforge stac eoapi-resume --workspace /absolute/customer-workspace \
  --operation-id customer-scene-capture
~~~

Partial or interrupted command results return process exit code 2 and preserve the original result JSON. The saved operation view exposes the exact admitted inputs and continuation identity after a browser or process restart.

## Resolve source credentials through their original owner

Supply `--source-config /absolute/private-source-runtime.json` when starting the eoAPI operator. Protect this host file with mode 0600. It contains named references:

~~~json
{
  "schema": "starforge.stac-eoapi-source-runtime.v1",
  "bindings": [
    {
      "origin": "https://your-approved-catalog-host",
      "tokenEnv": "CUSTOMER_CATALOG_ACCESS_TOKEN"
    }
  ]
}
~~~

For an original managed OAuth connection, use `{origin, credentialRef}` and place the original reviewed connection binding under `oauthConnections[credentialRef]`. That binding names the existing private connection directory environment setting, profile SHA, grant ID, required scopes and original client-secret environment reference. Authorize or reconnect through the existing OAuth connection operator.

The source runtime asks the original provider for its current token at dispatch. An actual 401 invalidates the precise rejected bearer. The next explicit source continuation uses the existing connection owner's refresh and recovery. An unbound public asset origin receives no source bearer.

Named commissioning principals can be supplied as `principals: {customerReader: {name, bindings}}`. The `public` principal uses no credential, and `operator` uses the primary bindings. A trusted host can supply its original credential resolver. An original SF31 transport profile can be selected with `--transport`.

The retained source request is written before the private dispatch header is resolved. Closing waits for original source/OAuth recovery and saved outcomes.

## Review selected source files

In **Scenes & assets**, mark the intended scene as SELECTED and name each intended asset key. Customer operations reuses completed matching source files after the original file reader verifies their bytes; other selected files go through the original asset review and acquisition. Requester-pays or retained-file selections use the existing retained asset owner.

**Prepare delivery review** writes a complete original edition outside the workspace, pins every exported member and selected asset, and saves the reviewer. The original manifest is published after the files. If an interruption follows that completed export, the same operation reopens its exact files even when a later analyst selection has changed.

**Approve selected delivery** approves that immutable export. Merchant staging reopens the original files and compares their complete manifest identity with the approved review before calling the existing merchant compiler.

~~~sh
starforge stac eoapi-assets --workspace /absolute/customer-workspace \
  --edition EDITION_ID --operation-id customer-selected-assets
starforge stac eoapi-delivery-review --workspace /absolute/customer-workspace \
  --edition EDITION_ID --reviewer "Operator name" \
  --operation-id customer-delivery-review
starforge stac eoapi-delivery-approve --workspace /absolute/customer-workspace \
  --review DELIVERY_REVIEW_ID --reviewer "Operator name"
starforge stac eoapi-merchant-stage --workspace /absolute/customer-workspace \
  --delivery-approval DELIVERY_APPROVAL_ID --operation-id customer-merchant \
  --origin https://your-merchant-host --payment /absolute/agreed-payment.json
~~~

The result identifies the original merchant directory. Serve and receive it through the maintained merchant/customer commands described in [MERCHANT.md](../MERCHANT.md). Choose every approved selected asset path alongside the original source metadata files in the customer plan.

## Package and reopen the customer handover

The export accepts a complete original StacDelivery. Its edition, native acquisition reports and selected file hashes must agree with the approved export. The original portable GIS exporter supplies the scene explorer, STAC catalog, footprints, rights and asset inventory.

~~~sh
starforge stac eoapi-delivery-export --workspace /absolute/customer-workspace \
  --delivery-approval DELIVERY_APPROVAL_ID \
  --directory /absolute/original-customer-delivery \
  --out /absolute/customer-handover
starforge stac eoapi-delivery-open --directory /absolute/customer-handover \
  --expected-manifest-sha256 HANDOVER_MANIFEST_SHA256
~~~

| File | Purpose |
|---|---|
| `manifest.json` and native members | Original acquired delivery and saved reports |
| `scene-export.json` | Original portable GIS export identity |
| `scene-explorer.html` | Offline scene, footprint, source-rights and file view |
| `stac-catalog/catalog.json` | Portable STAC catalog |
| `eoapi/source-review.json` | Exact source and approved policy association |
| `eoapi/delivery-review.json` | Immutable edition and selected file review |
| `eoapi/delivery-approval.json` | Responsible operator's approval |
| `eoapi/policy/` | Original seven-file policy package and manifest |
| `eoapi/OPERATOR.md` | Customer receiving and operating instructions |
| `eoapi-delivery.json` | Complete associations and independent receiving hashes |

Reopening checks the original delivery, portable GIS files, policy compiler output, review/approval identities and every selected file. The receiving object's `importPolicy(policyWorkspace)` receives the same approval into a new original policy workspace.

## Deployment commissioning

Open **Deployment commissioning** to prepare a plan against the approved upstream or customer endpoint. It exposes original retained capture attachment, source execution, continuation, comparison, export and independent receiving.

The host resolves complete packages by saved file ID, verifies the original commissioning package and writes through the original immutable private file writer. The panel's source credentials remain in the host's named runtime.

See [COMMISSIONING.md](commissioning/COMMISSIONING.md) for supported request cases and plan/run semantics, and [POLICY.md](POLICY.md) for Auth Proxy configuration.

## SDK

~~~js
import {openEoapiRuntime, openEoapiDelivery}
  from '@tokenjunkielabs/starforge-merchant/seller/stac/eoapi';

const runtime = await openEoapiRuntime({directory, sourceConfiguration, transport});
try {
  const source = await runtime.onboarding.reviewSource({
    approvalId, editionId, target: 'upstream', reviewer
  });
  await runtime.onboarding.bindEdition({
    sourceReviewId: source.id, editionId, operationId
  });
  const receiving = await openEoapiDelivery(customerDirectory, {
    expectedManifestSha256
  });
  await receiving.importPolicy(runtime.policies);
} finally {
  await runtime.close();
}
~~~
