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
| `upstream` | `url`, `conformsTo` from the selected upstream, `networkBoundary` describing how the upstream is restricted to its proxy |
| `identity` | `discoveryUrl`, `audiences`, `policyOwner`; optional `internalDiscoveryUrl` |
| `routing` | Explicit `defaultPublic`, ordered `publicEndpoints` and ordered `privateEndpoints` dictionaries |
| `filtering` | Optional `items` and `collections`, each a factory definition or `null` |
| `cors` | Optional `origins`, `methods`, `headers`, `credentials`, `exposeHeaders`, `maxAge` |
| `collectionRights` | Nonempty list of `{id, license, licenseUrls?, attribution?, assetAccess}` |
| `operator` | `name`, `retentionDays`, optional `sourceVersionNotes` |

`assetAccess` is one of `public-https`, `authenticated-source`, `requester-pays` or `retained-files`. These declarations travel with the policy; the existing acquisition and delivery operations apply the selected source access and exact-file behavior.

The portable policy accepts public connection settings and policy expressions. Supply credentials through the existing private source-connection mechanism in the receiving environment. Credential-shaped fields, bearer values, private keys and JWT values are rejected before saving.

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

The package schema is `scf-eoapi-policy-package/v1`. It contains seven named files with exact UTF-8 text, byte count and SHA-256, plus a digest of the complete package contents. Directory export writes these seven files and `package.json`:

| File | Contents |
| --- | --- |
| `policy.json` | Normalized reviewed intake |
| `review.json` | Review ID, exact policy and compilation, prior-version changes |
| `approval.json` | Approval ID, review ID, policy digest, reviewer and time |
| `environment.json` | Exact Auth Proxy environment string map |
| `unset-environment.json` | Variables to remove from a previous configuration |
| `auth-proxy.docker.env` | The same literal values for Docker `--env-file` |
| `OPERATOR.md` | Reviewed settings, route precedence, rights and receiving instructions |

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
