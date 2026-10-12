# eoAPI deployment commissioning

This operating workspace connects an approved deployment policy to actual catalog and access observations. It retains the original request and response bytes, compares later runs, and transfers a complete operating record to another private workspace.

Use it alongside the original eoAPI onboarding controller. The deployment policy remains in `policy-workspace.mjs`; the original STAC workspace owns catalog acquisition, analyst selections and purchased or selected file delivery. Source credentials remain in the host's private SF31 connection. This module records read-only commissioning operations.

## Complete operator flow

1. Open the customer's existing approved policy and original STAC source workspace.
2. Select the approved edition and whether the plan observes the public deployment or its upstream source. Review exact URLs, HTTP methods, connection names, expected statuses, required conformance and collection/item visibility.
3. Save the plan with a stable operation ID. Its digest includes the selected target, original approval, ordered policy, source revision, complete public request and expectations.
4. Create a run with its own stable operation ID. Execute its reviewed reads, or attach an already retained original capture to its matching anonymous case.
5. Inspect actual response statuses and findings. A completed run means every case has an original retained response; each case separately reports whether its expectations passed.
6. Run the later reviewed edition, compare it to the earlier run, and investigate changed access, payload or asset validators.
7. Export the complete package. Receive it into another private commissioning workspace, reopen it without a provider connection, and retain the original run, policy and source identities.

The industrial panel in `view.mjs` exposes these same operations inside the existing operator host. The panel does not create a separate network or login surface.

## Original interfaces

```js
import { openDeploymentPolicyWorkspace } from '../policy-workspace.mjs';
import { openStacWorkspace } from '../../workspace.mjs';
import { openCommissioningWorkspace } from './workspace.mjs';

const policy = await openDeploymentPolicyWorkspace({
  directory: '/private/customer/policy',
  create: false
});
const stac = await openStacWorkspace({
  directory: '/private/customer/stac',
  create: false
});
const commissioning = await openCommissioningWorkspace({
  directory: '/private/customer/commissioning',
  policyWorkspace: policy,
  stacWorkspace: stac,
  sourceRuntimeFor,
  create: true,
  title: 'Customer catalog commissioning'
});
```

`sourceRuntimeFor({principal, endpoint, signal})` is a trusted host callback. It returns `{transport, sourceAuth}` for a configured connection name. The original `createStacProvider` receives that runtime and performs dispatch. Use the provider source that threads `sourceAuth.requestHeaders` after writing the public request and configures each original SF31 fetch with `sourceAuth.authorizationForOrigin(origin)`.

An anonymous case requires an anonymous runtime. A named private case requires the original auth object to bind the exact requested origin. Unbound public asset origins use their own anonymous cases. The commissioning package contains the principal name, public origin and original response; credential values and merged Authorization headers stay in the existing runtime.

The host retains ownership of a shared source-auth object's lifetime and managed OAuth invalidation. Close commissioning first, then its policy, STAC and credential connections. `close()` aborts active source reads, rejects further calls and waits for all admitted public operations to settle.

## Plan contract

Schema: `scf-eoapi-commissioning-plan/v1`.

```json
{
  "title": "Catalog deployment access",
  "approvalId": "eoapi-policy-approval-SELECTED_ID",
  "target": "deployment",
  "minimumIntervalMs": 1000,
  "cases": [
    {
      "id": "public-catalog",
      "title": "Public catalog root",
      "principal": "anonymous",
      "request": {
        "url": "https://catalog.example.org/stac",
        "method": "GET",
        "headers": {"accept": "application/json"}
      },
      "expect": {
        "statuses": [200],
        "documentType": "Catalog",
        "requiredConformance": ["https://api.stacspec.org/v1.0.0/core"]
      }
    },
    {
      "id": "reader-selection",
      "title": "Selected collection for the reader",
      "principal": "customer-reader",
      "request": {
        "url": "https://catalog.example.org/stac/search",
        "method": "POST",
        "headers": {
          "accept": "application/geo+json, application/json",
          "content-type": "application/json"
        },
        "body": {"collections": ["agreed-collection"], "limit": 10}
      },
      "expect": {
        "statuses": [200],
        "documentType": "FeatureCollection",
        "allowedCollections": ["agreed-collection"],
        "requiredCollections": ["agreed-collection"]
      }
    }
  ]
}
```

Replace the example addresses and collection with the selected policy and original source. `target:"deployment"` uses `policy.deployment.publicUrl`; `target:"upstream"` uses `policy.upstream.url`. The target survives plan validation, run creation, package export and offline receiving. An upstream baseline and a deployment observation remain separately identified.

Supported requests are GET and HEAD inside that selected origin/namespace, and POST to its exact `/search` endpoint with a JSON body. A reviewed external asset may be inspected with HEAD using its exact original asset descriptor from the connected STAC workspace and a collection retained in the policy. Requests preserve explicit public Accept and Content-Type headers. Caller Authorization, cookies and other transport headers are rejected.

Each plan contains 1–128 uniquely named cases. A JSON search body is limited to 256 KiB. Each original metadata response is bounded by the provider's 64 MiB limit. `minimumIntervalMs` is operator-selected, defaults to 1,000 ms and can range from 0 to 300,000 ms. It spaces the actual dispatches in the same retained run.

Expectations support:

| Field | Meaning |
| --- | --- |
| `statuses` | Required allowed HTTP status list, including expected denial responses such as 401 or 403 |
| `documentType` | Catalog, Collection, FeatureCollection, Feature or Conformance |
| `requiredConformance` | Exact conformance identifiers required in the observed document |
| `allowedCollections` | Collection IDs permitted in that observed response |
| `requiredCollections` | Collection IDs that must appear in that observed response |
| `requiredItems` | Exact `collection/item` keys that must appear |
| `contentType` | Expected response media type without parameters |
| `maxBytes` | Maximum accepted original response bytes |

The observation retains whether the response advertises a next page. Each case evaluates the original response that was actually obtained. A complete source pagination journey can retain a separate case for each original reviewed page request; it does not infer later pages from a first-page result.

## Recovery and operation identity

`savePlan({input, operationId})` and `createRun({planId, operationId})` derive stable identities within the original workspace. Reusing the same operation with different inputs reports an operation conflict.

Before a source call, the run journals the selected case and attempt. The original provider then saves `request.json`, `response.bin` and `response.json`. The public request is retained before private headers are resolved.

On the same run's explicit continuation, a fully retained request/response is verified and accepted before another source call is considered. If the earlier attempt has no complete original response, it remains in history and the explicit continuation creates a new read-only attempt. Concurrent execution uses the original Linux file-descriptor lock; it does not infer process ownership from a PID in another container.

HTTP responses with non-200 statuses are retained by the original provider before its error. Commissioning uses those exact bytes and status as an observation, allowing a reviewed access-denial case to complete. A transport failure without a complete response leaves the run INTERRUPTED. Case findings and execution state remain distinct.

The original request URL, method, normalized public headers, body, request hash, response bytes and response hash must match. A changed response or mismatched capture is rejected. Completed results are immutable.

## Use a retained source capture

```js
const saved = await commissioning.savePlan({input: reviewedPlan, operationId: 'customer-plan-1'});
const run = await commissioning.createRun({planId: saved.id, operationId: 'customer-baseline-1'});
await commissioning.adoptCapture({
  runId: run.id,
  caseId: 'public-catalog',
  sourceWorkspaceId: (await stac.getState()).id,
  captureRef: 'captures/catalog-ORIGINAL_CAPTURE_ID'
});
```

Only captures registered in the connected original STAC workspace are admitted. They must match the complete reviewed request, selected endpoint and original source hashes. This route accepts anonymous captures; a stripped request cannot establish which credential was dispatched for a named private case. Run named private cases through their configured original source runtime.

Copying is recoverable under the same run and capture identity. The original response time and receiving source-workspace lineage remain in the package.

## Compare and receive

```js
const comparison = await commissioning.compareRuns({
  leftRunId: earlierRun,
  rightRunId: laterRun
});
const bundle = await commissioning.exportRun({runId: laterRun});
const received = await receiver.importPackage({
  package: bundle,
  operationId: 'customer-receiving-1'
});
const reopened = await receiver.getImported({importId: received.id});
```

Comparison records added/removed cases, changed reviewed cases, regressions, resolutions and changed source results. It includes the actual response bytes/SHA and asset ETag/Last-Modified, so a changed item geometry, property or asset URL appears even when its ID stays the same. Response timestamps alone do not create a change.

Package schema is `scf-eoapi-commissioning-package/v1`. It includes the complete plan, run, original source attempt request/response records and raw responses as canonical Base64. The package digest preserves the original policy's route order. Maximum decoded source payload is 256 MiB across at most 1,024 original files.

Inspection decodes and hashes every file, validates the original policy and plan, rechecks request identities and recomputes all recorded case observations. Receiving writes a private intent before copying. Existing target members must match exactly; interrupted copies are reused, and all capture directories are synced before the completion receipt. Receiving preserves the original run and policy while assigning a separate receiving-workspace/import identity.

The receiver can reopen its complete retained package without policy, source, provider or credential connections. Customer packages remain in the selected private saved-file path; publish the generic module source through the repository.

## Native CLI

Use the installed Node runtime from the maintained project root:

```sh
node sf30-seller-sdk/stac/eoapi/commissioning/cli.mjs help
```

All commands return JSON on stdout and controlled error codes on stderr. A live `run` that retains status `INTERRUPTED` emits its complete original run JSON and exits 2, so the native supervisor can continue that same run. Normal command errors exit 1. Completed runs exit 0 and retain their separate per-case pass/finding results.

| Command | Required flags |
| --- | --- |
| `status` | `--directory WORKSPACE` |
| `plan` | `--directory WORKSPACE --policy-directory POLICY --input PLAN.json --operation ID` |
| `prepare` | `--directory WORKSPACE --policy-directory POLICY --plan ID --operation ID` |
| `run` | `--directory WORKSPACE --policy-directory POLICY --run ID` |
| `adopt` | `--directory WORKSPACE --policy-directory POLICY --stac-directory STAC --run ID --case ID --capture REF --source-workspace ID` |
| `report` | `--directory WORKSPACE --run ID` |
| `compare` | `--directory WORKSPACE --left RUN --right RUN` |
| `export` | `--directory WORKSPACE --run ID --output PACKAGE.json` |
| `inspect` | `--input PACKAGE.json` |
| `receive` | `--directory RECEIVING --input PACKAGE.json --operation ID` |
| `reopen` | `--directory RECEIVING --import ID` |

Plan creation may include `--stac-directory` for reviewed asset references. Live runs may include `--connections-file`. Input and connection files must be private regular files owned by the current operator. Package export preserves an existing output file unless its exact bytes already match.

A private connections file names existing environment bindings:

```json
{
  "schema": "scf-eoapi-commissioning-connections/v1",
  "principals": {
    "anonymous": {},
    "customer-reader": {
      "bindings": [
        {"origin": "https://catalog.example.org", "tokenEnv": "EOAPI_READ_TOKEN"}
      ]
    }
  }
}
```

The existing SF31 explicit CONNECT transport profile may be included as `transport` for a principal. Credential references use the same original `createSourceBearerAuth` resolver through a trusted host callback; the native CLI supports environment bindings directly. Credentials are resolved at dispatch and are not serialized into a plan, capture request, report or package.

## Original host join

```js
const controller = createCommissioningController({
  workspace: commissioning,
  readPackage: savedFileId => originalPrivateSavedFileReader(savedFileId),
  savePackage: bundle => originalPrivateSavedFileWriter(bundle)
});
const response = await controller.dispatch({method, path, body, signal});
```

The original host authenticates the operator, enforces its existing CSRF/body limits and removes its configured prefix before dispatch. Routes include GET `/state`, `/plans/:id`, `/runs/:id`, `/imports/:id`; and POST `/plans`, `/runs`, `/execute`, `/adopt`, `/compare`, `/export`, `/receive`.

The receiving route accepts a host-resolved saved-file ID; the HTTP request cannot choose an arbitrary filesystem path. Bind the package writer to the complete package digest for its original saved-file retry/reconciliation.

The browser module exports `commissioningMarkup()` and `mountCommissioning(element,{dispatch,principals,intentStore})`. Supply the host's authenticated dispatch function. When joining `createEoapiSourceRuntime`, map commissioning's `anonymous` principal to the runtime's uncredentialed `public` profile: `input => source.sourceRuntimeFor({...input, principal: input.principal === 'anonymous' ? 'public' : input.principal})`. Keep named private principals unchanged. The panel uses its original connection labels and a monochrome industrial layout, and exposes actual retained source attachment, continuation, comparison, export and receiving.

Before plan, run or receiving dispatch, the panel retains the exact operation binding in workspace-keyed session storage. A reload restores the admitted plan draft, selected plan/file and operation IDs, so retry reaches the same original record after a lost reply. The host may provide its own synchronous `intentStore` with `getItem`/`setItem`; successful exact readback is required before dispatch. The selected plan retains its own current run operation. Explicit New plan operation, New run operation and New receiving operation actions create a separate intended record while keeping prior admitted identities in the retained journal.

## Source contracts

- [Original eoAPI project](https://developmentseed.org/projects/eoapi/)
- [STAC Auth Proxy route access](https://developmentseed.org/stac-auth-proxy/user-guide/route-level-auth/)
- [STAC Auth Proxy record access](https://developmentseed.org/stac-auth-proxy/user-guide/record-level-auth/)
- Original `deployment-policy.mjs` and `policy-workspace.mjs` for ordered authored policies, review, approval and package validation.
- Original `sf31-buyer-client/source-auth.mjs` and `public-transport.mjs` for exact-origin source credentials and native HTTPS.
- Original `stac/provider.mjs` and `stac/workspace.mjs` for retained requests, source capture and edition custody.
- Original SF88 private store and Routescan descriptor lock for durable writes and cross-process exclusion.
