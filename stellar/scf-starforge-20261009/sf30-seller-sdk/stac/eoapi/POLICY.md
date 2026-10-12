# eoAPI deployment policy workflow

This module takes an operator's deployment, source, identity, route, record-access and collection-rights intake through a saved review, approval, configuration export and independent receiving workspace. The maintained STAC Auth Proxy supplies authentication and CQL2 filtering. The existing STAC workspace supplies catalog acquisition, analyst selection and exact-file delivery. This component records the configuration version that connects those operations.

It uses Node built-ins and the existing SF88 private store. It starts no hosted service and schedules no GitHub Actions work.

## Integration contract

Import `compileDeploymentPolicy`, `compareDeploymentPolicies` and `applyDeploymentEnvironment` from `deployment-policy.mjs`. Import `openDeploymentPolicyWorkspace` and `validateDeploymentPolicyPackage` from `policy-workspace.mjs`.

```js
const policies = await openDeploymentPolicyWorkspace({
  directory: '/absolute/customer-workspace/eoapi-policy',
  title: 'Customer catalog deployment'
});
const saved = await policies.saveDraft({ policy: intake, expectedRevision: 0 });
const review = await policies.review({ expectedRevision: saved.revision });
// Show review.compilation.review and review.changes to the operator.
const approval = await policies.approve({
  reviewId: review.id, reviewer: operatorName
});
const exported = await policies.exportPackage({
  approvalId: approval.id, directory: '/absolute/delivery/deployment-policy'
});
await policies.close();

// A separate process or machine receives the complete package.json.
const receiving = await openDeploymentPolicyWorkspace({
  directory: '/absolute/receiving/eoapi-policy'
});
const receipt = await receiving.importPackage({ package: exported.package });
await receiving.close();
```

`compileDeploymentPolicy(intake)` returns `{schema, id, digest, policy, environment, unset, review, ready}`. `policy` is the normalized input. `environment` contains exact string values for the current native Auth Proxy settings. `unset` names settings that must be removed when replacing an existing deployment configuration. `ready` requires the upstream's recorded conformance classes needed by the selected record filters. `review` includes ordered routes, required scopes, filter factories, matched conformance declarations, collection rights, the upstream network boundary and source references.

The workspace exposes these methods:

| Method | Arguments | Result |
| --- | --- | --- |
| `getState` | none | Current revision, draft, saved reviews, approvals and receiving receipts |
| `getApproval` | `{approvalId?}` | Detached `{approval, review, policy, compilation}` for the selected or current saved approval |
| `saveDraft` | `{policy, expectedRevision?}` | Normalized policy, digest and resulting revision |
| `review` | `{expectedRevision?}` | Saved review ID, exact policy and compilation, changes from the currently approved version |
| `approve` | `{reviewId, reviewer, expectedRevision?}` | Stable approval ID, review ID, policy digest, reviewer and time |
| `exportPackage` | `{approvalId?, directory?}` | `{package, directory}` for the selected or current approval |
| `importPackage` | `{package, expectedRevision?}` | Receiving ID, source workspace ID, original approval ID, package and policy digests, file count and bytes |
| `close` | none | Completion of pending local writes |

Approval binds to the exact reviewed draft. Editing policy fields or reordering overlapping routes makes an earlier review stale. Reapproving the same review returns its original approval. Importing the same package returns its original receiving receipt. A receiving workspace preserves the source review and approval, allowing reopen and re-export of the same reviewed edition. Exporting an earlier approval remains possible after a later draft is saved.

Each workspace write creates an immutable revision using the original store's exclusive file operation. `expectedRevision` lets a controller reject a stale edit. After a lost response, reopen with `create: false`, read `getState()` and reconcile the saved policy digest, review or approval before continuing. Retain the stable approval ID and `package.digest` beside the original STAC catalog edition, analyst selection and selected-file delivery manifest. Receiving creates its own workspace ID while retaining the original policy and approval identities. `getApproval({approvalId})` resolves the saved edition directly, verifies its policy and compilation against the original approval, and returns detached objects so caller edits cannot modify persisted review state.

## Intake

The schema is `scf-eoapi-deployment-policy/v1`. The controller supplies the customer's actual versions, source reference, conformance response and rights information.

| Group | Required fields and meaning |
| --- | --- |
| `title` | Human-readable configuration title |
| `deployment` | `id`, `eoapiVersion`, `authProxyVersion`, `sourceRef`, `publicUrl`; optional `rootPath` and `rootPathSkipPrefixes` |
| `upstream` | `url`, `conformsTo` from the selected upstream, `networkBoundary` describing the selected public or private source boundary |
| `identity` | OIDC: `discoveryUrl`, `audiences`, `policyOwner`, optional `internalDiscoveryUrl` and `mode: "oidc"`. Public source: `mode: "public"`, `policyOwner` |
| `routing` | Explicit `defaultPublic`, ordered `publicEndpoints` and ordered `privateEndpoints` dictionaries |
| `filtering` | Optional `items` and `collections`, each a factory definition or `null` |
| `cors` | Optional `origins`, `methods`, `headers`, `credentials`, `exposeHeaders`, `maxAge` |
| `collectionRights` | Nonempty list of `{id, license, licenseUrls?, attribution?, assetAccess}` |
| `operator` | `name`, `retentionDays`, optional `sourceVersionNotes` |

`assetAccess` is one of `public-https`, `authenticated-source`, `requester-pays` or `retained-files`. These declarations travel with the policy; the existing acquisition and delivery operations apply the selected source access and exact-file behavior.

The portable policy accepts public connection settings and policy expressions. Supply credentials through the existing private source-connection mechanism in the receiving environment. Credential-shaped fields, bearer values, private keys and JWT values are rejected before saving.


### Public source and OIDC modes

The selected STAC Auth Proxy v1.3.0 application initializes an identity provider at startup and during request handling, including routes that are public by default. A public catalog such as Earth Search therefore uses an explicit public runtime supplied with its policy package.

Use this identity group for public source intake:

```json
{"mode":"public","policyOwner":"Operating team"}
```

Public mode requires `routing.defaultPublic: true`, no private route rules, both record filters absent or `null`, and `cors.credentials: false`. OIDC discovery fields and audiences must be absent. The included factory is selected against `stac-auth-proxy==1.3.0` source `dd0c10f27999b0cb0874f5330a938e2ed5349dcd`; record that exact version and source reference in the deployment fields. The review shows its filename, factory, native dependency and file SHA-256.

The compiler exports `EOAPI_IDENTITY_MODE=public` and disables authentication annotation. Its replacement list removes discovery/audience settings, ambient OpenAPI and Swagger identity configuration, stale record filters and the unreviewed proxy options. The included factory uses the original native request/path/link/CORS/reverse-proxy components, performs upstream-only startup checks, and strips incoming Authorization, Cookie and Proxy-Authorization before forwarding. Its typed settings reject private routes, record filters, identity settings and credentialed CORS.

The package includes `eoapi_public_proxy.py`. Use an existing environment installed from the exact selected source, or create a receiving environment and install it:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install 'stac-auth-proxy @ git+https://github.com/developmentseed/stac-auth-proxy.git@dd0c10f27999b0cb0874f5330a938e2ed5349dcd'
```

The factory checks the selected native construction source before startup. From the directory containing `.venv`, replace `PACKAGE_DIRECTORY` below with the received package directory. This launcher removes every listed stale variable and passes the complete reviewed environment directly to the same Python interpreter:

```sh
.venv/bin/python - PACKAGE_DIRECTORY <<'PY'
import json
import os
from pathlib import Path
import subprocess
import sys

package = Path(sys.argv[1]).resolve(strict=True)
environment = dict(os.environ)
for name in json.loads((package / 'unset-environment.json').read_text(encoding='utf-8')):
    environment.pop(name, None)
environment.update(json.loads((package / 'environment.json').read_text(encoding='utf-8')))
subprocess.run([
    sys.executable, '-m', 'uvicorn', 'eoapi_public_proxy:create_app',
    '--factory', '--app-dir', str(package), '--host', '127.0.0.1', '--port', '8080',
], env=environment, check=True)
PY
```

The local listener uses port 8080. The receiving deployment can bind its selected reverse proxy to that listener. Keep the approved upstream, path, route and CORS configuration together when deploying.

The original Auth Proxy application always initializes OIDC. Public mode uses this included factory with upstream-only startup checks and removes caller Authorization, Cookie and Proxy-Authorization before forwarding. Its typed settings require public routes, empty record filters and identity settings, and CORS credentials disabled. The native dependency and factory travel as the reviewed source selection and complete included Python file.

An absent identity mode preserves the existing OIDC policy and package bytes. New authenticated intake may use `mode: "oidc"`; this explicit form removes a previous `EOAPI_IDENTITY_MODE` when applying a replacement and launches the original `stac_auth_proxy.app:create_app` factory. The editor preserves absent mode on an existing untouched OIDC policy and records explicit OIDC when switching from a public edition. Complete compilations set native default access, private routes, authentication annotation and CORS credentials, so those values follow the newly approved edition.

### Routes and precedence

Route expressions retain the authored Python regular-expression text. The selected native Auth Proxy reviewer evaluates Python syntax and the commissioning access cases with its original matcher; the configuration compiler does not substitute JavaScript expression validation. Native endpoint method settings accept GET, POST, PUT, PATCH and DELETE. CORS configuration also supports HEAD and OPTIONS.

```json
{
  "defaultPublic": false,
  "publicEndpoints": {"^/$": ["GET"]},
  "privateEndpoints": {
    "^/collections/sensitive(/.*)?$": [["GET", "catalog:read sensitive:read"]],
    "^/collections(/.*)?$": [["GET", "catalog:read"]]
  }
}
```

The order shown is significant. The first matching private rule selects the required scopes; all scopes in its string are required. The exact scope string is preserved: native matching splits a nonempty string on each literal space, including empty tokens between repeated spaces. A tuple with an empty scope string requires authentication without a scope. The review shows those exact token values for commissioning. With `defaultPublic: false`, matching public rules are considered before private rules. The review records order within each access class, and order is preserved in stored JSON, digest calculation and exported environment values. Public patterns are case-sensitive; the native private matcher uses case-insensitive matching and its normalized request path.

### Native filter constructors

A filter is `{factory, args?, kwargs?, classPath?}`. Built-in constructors accept their named or positional forms and are normalized to exact positional arguments with empty keyword arguments. Duplicate positional/keyword values, missing arguments and unknown built-in keywords are rejected.

| Factory | Native class | Constructor |
| --- | --- | --- |
| `template` | `stac_auth_proxy.filters:Template` | One `template_str` string |
| `opa` | `stac_auth_proxy.filters:Opa` | `host`, `decision` |
| `custom` | Explicit `module:Class` in `classPath` | Selected class's JSON `args` and `kwargs` |

For example, an OPA factory may use `{"factory":"opa","kwargs":{"host":"http://opa.internal:8181","decision":"catalog/access"}}`. The original native factory evaluates its policy at request time. Custom class installation and its constructor contract belong to the selected deployment source.

Either record filter requires the native common CQL2 classes `basic-cql2`, `cql2-text` and `cql2-json`. Items also require OGC API Features Filter, Features Filter and STAC Item Search Filter. Collections require STAC Core, Collection Search, Collection Search Filter and OGC API Common Simple Query. The compiler mirrors the native middleware's prefix matching and STAC `v1.0.0` prerelease pattern. Its review records the actual matching declarations, and lists each missing declaration as a finding.

## Export and receiving

The package schema is `scf-eoapi-policy-package/v1`. It contains seven base files with exact UTF-8 text, byte count and SHA-256, plus a digest of the complete package contents. Public-source policies add the complete `eoapi_public_proxy.py` runtime as an eighth exact file. Directory export writes the selected files and `package.json`:

| File | Contents |
| --- | --- |
| `policy.json` | Normalized reviewed intake |
| `review.json` | Review ID, exact policy and compilation, prior-version changes |
| `approval.json` | Approval ID, review ID, policy digest, reviewer and time |
| `environment.json` | Exact Auth Proxy environment string map |
| `unset-environment.json` | Variables to remove from a previous configuration |
| `auth-proxy.docker.env` | The same literal values for Docker `--env-file` |
| `OPERATOR.md` | Reviewed settings, route precedence, rights and receiving instructions |
| `eoapi_public_proxy.py` | Public-source policies only: complete selected native factory, verified during receiving |

Use `applyDeploymentEnvironment(existingEnvironment, compilation)` to apply a replacement: it removes `unset` keys and overlays the compiled values. Omitted internal discovery removes a prior internal discovery URL so the native fallback follows the current public discovery URL. Unmanaged custom filter paths and `PROXY_OPTIONS` are removed so the native default filter coverage and reviewed CORS behavior apply. Existing parent `ITEMS_FILTER` and `COLLECTIONS_FILTER` JSON variables are also removed; disabled factories remove the corresponding class and argument settings.

The Docker environment file uses literal values, including JSON arrays for JWT audiences and JSON dictionaries for routes. Docker `--env-file` retains quotes as data, so the exporter does not add shell quotes. Use the JSON map with other deployment systems. Do not execute the environment file as a shell script.

Receiving validates the exact file set, each file's bytes and SHA-256, the package digest, normalized policy, original review policy, approval identity and the recomputed native configuration. It then records the original review and approval in a separate private workspace. SHA-256 identifies the selected bytes; it does not establish who authorized an independently obtained package. The operator records the accepted review in the existing customer onboarding process.

## Native CLI

Run `node policy-cli.mjs help` for the command contract. Commands return JSON.

```sh
node policy-cli.mjs init --workspace /absolute/policy
node policy-cli.mjs save --workspace /absolute/policy --input /absolute/intake.json
node policy-cli.mjs review --workspace /absolute/policy
node policy-cli.mjs approve --workspace /absolute/policy --review REVIEW_ID --reviewer OPERATOR_NAME
node policy-cli.mjs export --workspace /absolute/policy --output /absolute/policy-delivery
node policy-cli.mjs verify --input /absolute/policy-delivery/package.json
node policy-cli.mjs receive --workspace /absolute/receiving-policy --input /absolute/policy-delivery/package.json
node policy-cli.mjs status --workspace /absolute/receiving-policy
```

`inspect --input INTAKE_JSON` compiles without creating a workspace. `save`, `review` and `approve` accept `--expected-revision`. Error results include a stable code and field path where available. Correct an intake finding, save the new draft, review its change and approve that exact edition.

## Maintained native references

- [eoAPI](https://developmentseed.org/projects/eoapi/)
- [Auth Proxy configuration](https://developmentseed.org/stac-auth-proxy/user-guide/configuration/)
- [Route-level authentication](https://developmentseed.org/stac-auth-proxy/user-guide/route-level-auth/)
- [Record-level authentication](https://developmentseed.org/stac-auth-proxy/user-guide/record-level-auth/)
- [Current settings source](https://github.com/developmentseed/stac-auth-proxy/blob/main/src/stac_auth_proxy/config.py)
- [Native request matching](https://github.com/developmentseed/stac-auth-proxy/blob/main/src/stac_auth_proxy/utils/requests.py)
- [Native filter conformance](https://github.com/developmentseed/stac-auth-proxy/blob/main/src/stac_auth_proxy/middleware/Cql2BuildFilterMiddleware.py)
- [Template constructor](https://developmentseed.org/stac-auth-proxy/reference/stac_auth_proxy/filters/template/)
- [OPA constructor](https://developmentseed.org/stac-auth-proxy/reference/stac_auth_proxy/filters/opa/)

The compiler's contract was checked against the maintained sources above on 2026-10-12. Record the selected deployment's own version and source reference in every intake so a later operator can compare a native upgrade with the approved configuration.

## Operator editor and host controller

The industrial editor uses the same compiler, revision store and approval IDs as the CLI. It provides deployment and identity intake, ordered route editing, record filters and collection rights; review with differences and native conformance findings; approval; complete package export; receiving; and paginated saved history.

Serve `policy-view.mjs` and `policy.css` from the existing operator application. Create one controller around that application's existing policy workspace:

```js
import { createDeploymentPolicyController } from './policy-controller.mjs';

const controller = createDeploymentPolicyController({
  workspace: policies,
  reviewerFor: ({ context }) => context.operator.displayName
});

// The authenticated host strips its /api/eoapi/policy prefix.
// Context comes from that host's verified operator session.
const response = await controller.dispatch({
  method: request.method,
  path: policyPath,
  body: parsedBody,
  signal: request.signal,
  context: { operator: authenticatedOperator }
});
```

The host applies its existing authentication, authorization, same-origin and CSRF controls before dispatch, and supplies a request-size limit. The controller accepts JSON bodies up to 20 MiB. Browser inputs cannot create the trusted context. When `reviewerFor` is configured, its result supplies the approval reviewer; a body reviewer does not override it. Without that callback, a local operator application supplies the reviewer explicitly.

```js
import { mountDeploymentPolicy } from './policy-view.mjs';

const panel = mountDeploymentPolicy(policyElement, {
  dispatch: request => authenticatedPolicyRequest(request),
  onApproval: async ({ approval, policy, compilation }) => {
    await onboardingPanel.selectPolicy({
      approvalId: approval.id,
      policyDigest: compilation.digest
    });
  },
  onReceived: async ({ receipt, approval }) => {
    await onboardingPanel.refresh();
  }
});
await panel.ready;
```

`authenticatedPolicyRequest` adapts the host's existing request mechanism and returns `{status, body}`. `selectPolicy` and `refresh` above are host-owned integration points, not new policy APIs. The selected approval can always be reopened with the original `policies.getApproval({approvalId})`. The callbacks run after the corresponding original workspace action has completed; a failed host refresh leaves that saved action available for reconciliation. `panel.refresh()` updates the view, and `panel.destroy()` removes listeners and releases download URLs.

The dispatcher uses these paths relative to the host's mount:

| Method and path | Input | Result |
| --- | --- | --- |
| GET `/state` | — | Workspace identity/revision, saved draft, current approval, history counts and operator identity |
| GET `/history?kind=reviews&limit=30&before=N` | Kind is `reviews`, `approvals` or `imports`; optional earlier-page cursor | Newest-first summaries and `nextBefore` |
| GET `/reviews/REVIEW_ID` | — | Original saved review, associated approval and current-draft status |
| GET `/approvals/APPROVAL_ID` | — | Original detached approval, review, policy and compilation |
| POST `/preview` | `{policy, againstApprovalId?}` | Compilation and differences against the selected/current approval |
| POST `/draft` | `{policy, expectedRevision}` | Saved normalized draft and resulting revision |
| POST `/review` | `{expectedRevision}` | Saved review of the current draft |
| POST `/approve` | `{reviewId, reviewer?, expectedRevision}` | Original approval identity |
| POST `/export` | `{approvalId?}` | Complete original package |
| POST `/inspect` | `{package}` | Validated receiving identity, policy, compilation and file metadata |
| POST `/receive` | `{package, expectedRevision}` | Original receiving receipt |

The history cursor records an exclusive array index. New appended records do not move the earlier page already selected. The view can inspect an older review, copy it into a new draft, or export an older approval while newer work remains saved.

### Editing, approval and receiving

The editor retains the revision on which its unsaved fields are based. Refreshing after another writer's update preserves those fields and their original revision; it does not silently make the stale edit current. A stale save or approval returns HTTP 409. Reopen the current saved edition, inspect its differences, and choose the intended new draft before saving again.

Route rows have explicit move controls because their order affects native matching. Public rules and private rules are displayed in separate ordered groups with their native precedence. The editor sends the authored Python patterns unchanged to the original compiler.

Preview compiles without changing the workspace. Save and review create the original immutable records. Approval is available only for the reviewed current draft with no outstanding conformance findings; unsaved local edits require a new save and review.

Package export downloads one JSON file containing the complete policy package, including each original file's text, bytes and SHA-256. The approved-edition view also offers the individual files. The complete JSON can be passed directly to the existing CLI `receive --input` or imported into another editor. Its package digest and original approval ID remain visible throughout inspection and receiving.

The receive panel validates the complete package before importing it. Receiving selects the original approval and replaces the receiving workspace's saved draft with that approved policy. Unsaved editor fields remain visible with their original base revision; use the existing Reload saved draft action to replace those local fields with the received policy. The resulting receipt can be reopened in history; it retains the source workspace, package and policy identities used by onboarding and commissioning.
