# OpenLineage operations and customer review

Receive original pipeline events, understand jobs and dataset dependencies, review changes and quality, and give a customer an editable record of the work. This package joins the maintained OpenLineage application to Starforge Installation, Runtime Workspace, Applications and the merchant interfaces.

The current portable application contains **126 complete source files**. Its separate Applications provider binds the same workspace and source to the managed runtime. Original event and result bytes, saved editions, staff decisions, customer reviews, recipient requests and returned responses travel in the complete workspace export.

## Work through the product

| Task | Where to work |
| --- | --- |
| Receive events and inspect jobs, runs, datasets and facets | Source import, producer intake and lineage views |
| Compare saved schemas and record an attributed decision | Schema operations |
| Review service assessments and incident decisions | Service levels |
| Review multiple jobs and atomically apply a saved policy selection | Policy rollouts |
| Evaluate dataset quality, compare saved evaluations and track selected work | Quality and Quality follow-up |
| Assemble a customer review from complete original evidence and decisions | Customer reviews |
| Issue a review request, retain a recipient working copy and receive an attributed response | Recipient returns |
| Continue the same project elsewhere | Full export, verification and independent receiving |

Read the [complete operating guide](source/products/openlineage/OPERATING.md) and [source/API guide](source/stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/README.md). The [customer-review guide](source/stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/CUSTOMER_SERVICE_REVIEW.md) and [recipient-return guide](source/stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/REVIEW_RETURNS.md) explain the customer round trip. Saved reviews retain the selected historical evidence; later operational decisions remain separate versions.

## Build the selected product

Use the public repository and one full published source commit. From that checkout, run its maintained builder:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/public-commons-checkout \
  --ref FULL_PUBLISHED_COMMIT \
  --selection openlineage-operations \
  --out /absolute/private/openlineage-package
~~~

Retain the returned archive, manifest, commit and SHA-256 together. Continue an interrupted build with the same output and `--resume`; a new source selection uses its own output. The [selected-package guide](source/products/openlineage/SELECTED_PACKAGE.md) explains original source acquisition and runtime support.

All 126 application files are explicit source inputs, including the Java/Python producers, notices and versioned inventories. The original builder follows JavaScript imports and browser maps, with dynamic worker inputs from the maintained selected product. Google and Airflow companions retain their separate declarations and commissioning owners.

## Install and open

For a prepared archive and an existing populated dependency cache:

~~~sh
npm install --ignore-scripts --offline --omit=optional /absolute/openlineage-package/RETURNED_PACKAGE.tgz
npx --no-install starforge source
npx --no-install starforge registrations --source openlineage-workspace
npx --no-install starforge openlineage --help
~~~

The full managed runtime uses the original installer, selected features and exact dependency lock in the [runtime installation guide](source/stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md). The portable application runs on Node 22 or newer; the managed profile uses its documented Node 22.16+ and selected native dependencies.

Initialize a private project once and start it:

~~~sh
npx --no-install starforge openlineage init \
  --workspace /absolute/private/lineage --title "Pipeline operations"
npx --no-install starforge openlineage serve \
  --workspace /absolute/private/lineage --port 0
~~~

Open the returned URL. Reopen an existing project using its original workspace directory. In a READY managed runtime, select **Applications → OpenLineage operations**, choose the initialized or received workspace, and use the existing Review, Save, Review Start, Start, Open and Stop controls. The provider checks the actual workspace and server identity before returning the connection.

## Customer review and recipient return

In **Customer reviews**, select saved assessments, evaluations, comparisons and historical decisions for the intended customer and period. Inspect the full preview, retain the original request and save through the same revisioned workspace. Complete JSON, CSV and HTML reports preserve that evidence.

In **Recipient returns**, prepare the request against the saved review. A recipient can keep working JSON or editable HTML, reopen unfinished work and return the full attributed response. Import and compare the return through the original workflow. Previous source, requests, responses and staff history remain available.

The CLI groups are `openlineage customer-review` and `openlineage review-return`; their full original help and request formats are included. Canonical package exports include:

- `@tokenjunkielabs/starforge-merchant/seller/openlineage/customer-review`
- `@tokenjunkielabs/starforge-merchant/seller/openlineage/review-return`
- `@tokenjunkielabs/starforge-merchant/seller/openlineage/review-return/receiving`

The original merchant action catalog uses the same authenticated connection. Keep the exact request, operation ID and expected revision before mutation. After a lost response, receive or replay that original request. Review a genuine revision conflict before authoring a different action.

## Deliver the complete editable workspace

~~~sh
npx --no-install starforge openlineage export \
  --workspace /absolute/private/lineage \
  --out /absolute/delivery/openlineage-workspace.json
npx --no-install starforge openlineage verify \
  --input /absolute/delivery/openlineage-workspace.json
npx --no-install starforge openlineage receive \
  --input /absolute/delivery/openlineage-workspace.json \
  --out /absolute/private/received-lineage
node /absolute/private/received-lineage/application/cli.mjs serve \
  --workspace /absolute/private/received-lineage --port 0
~~~

Receiving verifies complete application, state and original objects before creating the independent destination. Original identities and history survive; the local receipt identifies the new installation.

The current [recipient-return receiving course](source/operations/openlineage-recipient-review-returns-e496-20261013/RECEIVING.md) continues the original 8F43 Page and workspace, including edited copies, request recovery, full independent receive and reopening. The separate [installed Quality course](source/products/openlineage/INSTALLED_RECEIVING.md) explicitly binds its historical v5/76-file or upgraded v7/81-file application. It is retained with those exact source editions; the current v11/126-file workflow uses the recipient course. Preserve each completed case and its original source snapshot.

## Operate and inspect the outgoing edition

The producing operator runs the exact delivered version, operates important controls, and personally looks at actual desktop and narrow views, including populated, loading, empty and error states where relevant. Open every report, working-copy download and attachment; independently receive and reopen the complete workspace. Preserve the native and browser observations with the output. Source integration and installed/rendered receiving remain distinct records.

Continue through the existing source-owned runtime and receiving owners, with their original private workspaces, accepted requests, credentials and locks.

## Source and operating references

- [Original source contract and notices](source/stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/SOURCE_CONTRACT.md)
- [Native producers](source/stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/PRODUCERS.md)
- [Asynchronous Python producer](source/stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/ASYNC_PYTHON_PRODUCER.md)
- [Service levels](source/stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/SERVICE_LEVELS_OPERATOR.md)
- [Multi-job policy rollout](source/stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/SERVICE_POLICY_ROLLOUT.md)
- [Quality](source/stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/QUALITY_OPERATOR.md)
- [Quality follow-up](source/stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/QUALITY_FOLLOWUP.md)
- [Producer/operator handover](source/products/openlineage/PRODUCER_OPERATOR_HANDOVER.md)

The package manifest records exact source identities and repository revision. Editable source remains under `source/` for the next operator.
