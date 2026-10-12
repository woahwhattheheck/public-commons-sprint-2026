# Prescient customer operator and portable receiving

This workspace connects an existing Prescient catalog and its original SDK to the maintained STAC analyst and customer delivery product. Staff retain the catalog response, query, scene edition, exact asset review and actual received bytes in the same STAC workspace. A reviewed operator profile selects the customer endpoint, identity mode, collections, S3 scope and permitted receiving use. The original Prescient worker supplies the native identity and temporary AWS session.

The Prescient tab uses the existing STAC host session, Origin check and CSRF token. The source workspace, merchant, buyer, dataset/file delivery and GIS export remain the original maintained engines.

## Source and installation

Use the cumulative Starforge source containing the original STAC product, shared source-auth/asset-access hooks, this operator, and the original Prescient worker. The SDK is **prescient-sdk 0.4.2**, from [sparkgeo/prescient-sdk at 895b7720b22c3047b76ecff512f6be13f1d62fc9](https://github.com/sparkgeo/prescient-sdk/tree/895b7720b22c3047b76ecff512f6be13f1d62fc9). Its MIT license and exact client/settings hashes accompany the worker in this directory.

Use the existing Node runtime required by the current Starforge distribution and a supported Python runtime. The original worker's [SDK_BRIDGE.md](SDK_BRIDGE.md) defines the supported interpreter, pinned source installation, offline wheel installation, native identity session and exact S3 receiving contract. Select that installed Python in the deployment file. The operator imports the worker lazily: opening retained data and approving a profile does not start an identity request.

The original STAC product was merged in [PR1421](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1421). The original Prescient worker is maintained in [PR1610](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1610), and the shared eoAPI/source-auth host in [PR1573](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1573). Use the actual composed source revision recorded by the installed package; those PR references describe the source ownership and do not substitute for its recorded revision.

## 1. Configure the receiving host

Copy `deployment.example.json` into a private operator location. Its binding IDs are names for existing host-owned files; they are not credentials. The browser can select a configured ID but cannot supply an environment file, Python command, proxy, receiving root or other host configuration.

```json
{
  "bindings": {
    "customer-primary": {
      "label": "Customer production access",
      "envFile": "/srv/prescient/private/customer.env"
    }
  },
  "pythonCommand": ["/srv/prescient/runtime/bin/python3"],
  "timeoutMs": 300000,
  "deliveryRoots": ["/srv/prescient/customer-deliveries", "/srv/prescient/received"],
  "exportRoot": "/srv/prescient/exports"
}
```

Keep the existing Prescient credentials in the private file selected by `envFile`. The original SDK's Settings contract remains authoritative. For API-key access it reads the actual endpoint and API-key configuration. For Microsoft/Google access it uses the customer's existing provider settings and the original interactive identity flow. The worker compares the effective endpoint, identity mode and provider with the reviewed profile before making the native connection. Environment overrides which would select another account or endpoint fail that comparison.

`deliveryRoots` limits the source and received directories that the operator may open. Paths are absolute and resolved to their real locations before selection; a symlink cannot move a selection outside these roots. Include the export root in this list if staff should reopen an exported package on the same host. The default export root is the operator directory's `portable/`; by default it is also the only receiving root.

An explicit trusted source transport may be included using the unchanged original STAC transport contract. Keep proxy settings in deployment custody. Catalog authorization is bound to an exact approved HTTPS origin; redirects and additional origins still use the existing transport rules.

## 2. Create and review a customer profile

Copy `profile.example.json` and replace its example endpoint, collection and approved S3 scope with the actual customer configuration. The example uses the reserved `example.invalid` domain and makes no claim that a customer account exists.

A profile contains:

| Field | Meaning |
| --- | --- |
| name | The customer/project label shown in the workspace. |
| endpoint | The original Prescient endpoint. The SDK derives its catalog URL using `urljoin(endpoint, "stac")`; preserve the intended trailing slash. |
| authMode | `api-key` or `oauth`. |
| identityProvider | `microsoft` or `google` for OAuth; omitted or null for API-key mode. |
| bindingId | An existing opaque binding from the local deployment file. |
| allowedOrigins | Exact HTTPS origins allowed to receive this source identity, including the endpoint's origin. |
| collections | Actual catalog collection IDs available to this project. |
| allowedS3 | Explicit bucket, literal key prefix, AWS region, optional expected account owner and requester-pays choice. |
| maxAssetBytes | Maximum reviewed bytes for one asset, up to the original worker's 2 GiB limit. |
| rights | The customer's source/retention basis, reference, purpose and whether selected asset bytes may be included in portable delivery. |
| refreshSkewSeconds | The original session's advance renewal interval, from 0 to 900 seconds. |

An S3 prefix is a literal string prefix. Include a trailing slash when the intended scope is a directory-like prefix. The original worker chooses the longest matching scope and rejects equally specific conflicting entries. Requester-pays access is selected explicitly in the profile and remains subject to the original asset's storage and license review.

Initialize the profile without contacting the catalog:

```sh
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs" prescient-init \
  --workspace /srv/prescient/customer-one \
  --profile /srv/prescient/profile.json \
  --actor "Customer operator"
```

Start its existing local STAC host:

```sh
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs" prescient-serve \
  --workspace /srv/prescient/customer-one \
  --deployment /srv/prescient/private/deployment.json \
  --port 0
```

Open the returned original local operator URL. In **Prescient**, enter the operator's name, inspect the complete selected profile, create its review and approve that exact review. The review records the source profile hash, original SDK revision, actor and time. A later profile change creates a separate saved profile and requires its own review and approval. Unsaved form values survive ordinary refreshes and tab changes.

The host freezes its selected profile for its lifetime. If staff approve a different profile while it is open, the connection view asks for a restart; source calls under the old profile are refused. Stop and reopen the same host to select the newly approved profile. A different catalog endpoint uses a fresh workspace, preserving the previous source history.

## 3. Connect and operate the original catalog

Choose **Connect original SDK** after profile approval. The worker imports and verifies the original SDK, checks effective Settings, and opens the native identity. Its visible metadata is the actual installed SDK revision/version, endpoint, derived catalog URL, identity mode/provider and approved origins. Private identity headers, API keys, access tokens and AWS credentials are not returned to the browser or written into workspace records.

Use the original STAC catalog/query/scene/asset views. Queries are limited to the reviewed collections. The existing product retains the actual request and response before building its scene editions. Staff select scenes and review individual assets through the original review IDs and operation IDs.

For ordinary HTTPS assets, the normal native downloader remains in use. For supported S3 addresses selected by the profile, the original Prescient worker resolves the approved bucket, key, region, version and requester-pays conditions. The saved asset review retains that nonsecret access identity. Download dispatch rechecks the same profile, workspace, item digest, asset review and operation ID.

The worker performs the real S3 transfer with source length, ETag/version and range validation. Completed ranges are fsynced and recorded under the original receiving operation. An interrupted capture continues the same committed prefix. A completed transfer can publish its already verified bytes into a later capture attempt without another S3 request. The original provider checks the entire resulting file and includes `prescient-receipt.json` in its normal edition and handover inventory.

**Inspect native session** returns the original SDK's safe session metadata. **Refresh native session** asks that same worker to renew using its supported native path. OAuth renewal uses the original SDK refresh method; API-key temporary AWS renewal creates a fresh original SDK client because version 0.4.2's API-key refresh method is a no-op. A changed or revoked catalog API key is an operator configuration correction, followed by reopening the same host.

Stopping the host aborts admitted source and receiving calls, drains its owned SDK worker and releases the original host lock. The receiving checkpoint, workspace history and selected operation IDs remain intact. The worker's constructor accepts the same owned abort signal, so stopping during interactive initialization also drains that worker.

## 4. Review and hand over an original customer delivery

Complete or reopen the customer delivery through the existing STAC merchant, SF88 buyer and dataset/file workflow. This operator consumes that original completed directory; it does not initiate another purchase.

In **Prescient → Original customer delivery**, choose the exact completed customer directory from an allowed receiving root and create its review. The native `StacDelivery.open` verifies its original manifests, selected files and byte hashes. The review retains the original bundle, edition, selection and native binding identities; each scene's actual collection and each received asset's size are compared with the selected profile.

Inspect the saved review and export that exact review. The existing portable GIS engine writes the complete original customer delivery, local STAC catalog, GeoJSON and offline scene explorer. The operator then adds:

| File | Retained purpose |
| --- | --- |
| prescient-profile.json | Source, collections, S3 scope, purpose and rights without the sending host's binding ID. |
| prescient-receiving.json | The original delivery identities, exact source review, portable manifest hash, approved profile, selected operation and receiving hash. |
| scene-export.json | The original portable export's declared members and hashes. |

The final receiving hash and original portable manifest hash appear in the operator history. Transfer the complete produced directory through the customer's chosen delivery method and provide its receiving hash alongside it. Copy the exact files; do not substitute a newly acquired asset or reconstructed manifest.

The operator does not export its private SDK environment file, identity session, Python worker state or receiving spool. The complete customer delivery carries the selected permitted assets and native metadata required for the existing offline receiver.

## 5. Receive on another host

On the receiving host, choose a fresh local binding and deployment file. Read the package's `prescient-profile.json` and use `receivePrescientProfile(portableProfile, localBindingId)` to produce the local profile. This helper verifies the portable profile and original SDK hash before attaching the new local binding. Initialize a new operator directory with that profile using the command above.

The same browser also supports **Import profile** into an already initialized workspace with the same endpoint. Select its local binding, then create and approve the resulting exact profile review. No binding from the sending host is imported.

Add the incoming directory to this host's trusted `deliveryRoots`, start its original STAC host and choose **Open received delivery**. Supply the complete directory and the exact expected receiving hash from the sender's record. The operator verifies the receiving/profile files, calls the original `openPortableStacDelivery`, rechecks the original source/native binding and validates all declared portable members. The saved result records `originalDeliveryVerified: true`, `providerRequests: 0` and `credentialBindingImported: false`.

This receiving action operates on retained files and does not initialize the SDK. The local profile still requires explicit review and approval, so the receiver's source, collections and retention choices are attributable.

## Original command and continuation contract

The browser and CLI dispatch the same operations. Every write supplies the actual actor, a stable `operationId` and the currently observed `expectedRevision`. Profile review/approval and delivery export additionally bind the exact saved review ID/hash.

A lost response is resolved by replaying the **same** command body and operation ID. A completed operation returns its original result. An interrupted operation retains its original source and review identity; a changed input under that ID is a conflict. Do not replace a receiving or source identity to make a retry proceed. Corrected inputs are a new reviewed operation while the original remains in history.

Useful commands:

```sh
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs" prescient-state --workspace /srv/prescient/customer-one
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs" prescient-profile-review --workspace /srv/prescient/customer-one --input /srv/prescient/review-command.json
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs" prescient-profile-approve --workspace /srv/prescient/customer-one --input /srv/prescient/approve-command.json
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs" prescient-delivery-review --workspace /srv/prescient/customer-one --deployment /srv/prescient/private/deployment.json --input /srv/prescient/delivery-review.json
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs" prescient-delivery-export --workspace /srv/prescient/customer-one --deployment /srv/prescient/private/deployment.json --input /srv/prescient/delivery-export.json
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs" prescient-delivery-open --workspace /srv/prescient/receiver --deployment /srv/prescient/private/receiver-deployment.json --input /srv/prescient/receive-command.json
```

Run a standalone runtime command while the corresponding browser host is stopped; both use the same original lifetime lock. The local browser service returns its private bootstrap URL on stdout. Keep that URL in operator custody.

### Same-session API for clients

The original `/api/state` exposes `capabilities.prescient.enabled`. Discover the existing session through the normal STAC `/api/session` flow. All Prescient writes use that same cookie, Origin and CSRF contract.

| Method and path | Body or result |
| --- | --- |
| GET /api/prescient/state | Nonsecret configuration, selected profile/hash, binding choices, SDK/session metadata, receiving progress and original workspace ID. |
| GET /api/prescient/profiles/HASH/export | Exact saved portable profile, without a local binding. |
| POST /api/prescient/profiles | profile, actor, operationId, expectedRevision. |
| POST /api/prescient/profiles/import | portable profile, bindingId, actor, operationId, expectedRevision. |
| POST /api/prescient/profiles/review | profileSha256, actor, operationId, expectedRevision. |
| POST /api/prescient/profiles/approve | reviewId, reviewSha256, actor, operationId, expectedRevision. |
| POST /api/prescient/connect | actor, operationId, expectedRevision; optional refresh boolean. |
| POST /api/prescient/session | actor, operationId, expectedRevision; refresh boolean selects native renewal. |
| POST /api/prescient/deliveries/review | directory, actor, operationId, expectedRevision. |
| POST /api/prescient/deliveries/export | reviewId, reviewSha256, actor, operationId, expectedRevision. |
| POST /api/prescient/deliveries/open | directory, manifestSha256, actor, operationId, expectedRevision. |

The route prefix is removed before `controller.dispatch({method,path,body})`. For example, the final receiving action dispatches `POST /deliveries/open`. UI components mount through `mountPrescientView({root,api,context})` and preserve the original host's update/dispose lifecycle.

## Source provenance and operating results

The source-pin manifest and original SDK guide retain implementation provenance. The original STAC and SDK native operations keep their own actual source/response, receiving and browser results. Public Austin imagery demonstrates the retained public-data workflow; it does not establish a configured Prescient customer's endpoint, license or identity. Attach the actual selected customer profile and completed receiving result to the deployment handover when that customer is configured.

The commercial implementation offer is a separate relationship record. This source guide records software operation and does not claim provider partnership, customer acceptance, or a payment received.
