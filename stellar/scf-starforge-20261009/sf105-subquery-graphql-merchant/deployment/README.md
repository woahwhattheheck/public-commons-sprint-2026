# Deploy an original GraphQL merchant

This compiler takes a complete reviewed SF105 merchant package and makes it usable by the existing SF82 release store and SF99 Linux host generator. The same original SF105 adapter executes the fixed queries. SF30 retains admission, payment verification, cancellation, settlement, and the response lifecycle.

Start with the directory returned by `prepareSubQuerySeller`, or the `merchant/` directory returned by `prepareSubQueryRevision`. The compiler reopens the original manifest, verifies every retained file, recompiles the actual served schema, queries, and plan, and compares the native service before preparing a new directory. A changed provider schema is handled by the existing [schema revision workflow](../onboarding/REVISIONS.md).

Requirements: Node 22 or later and the original source release with its declared dependencies, including the component's pinned `graphql` preparation dependency. Linux host installation uses the existing SF99 Caddy/systemd requirements. Prepare on the intended host or at its intended absolute source/configuration paths: the original release and host tools retain those paths.

## Prepare the deployment

The following commands run from a source checkout. Set `SCF` to the existing installed source directory; use separate private directories with existing parents.

```sh
SCF=/path/to/source/stellar/scf-starforge-20261009

node "$SCF/sf105-subquery-graphql-merchant/deployment/cli.mjs" prepare \
  --merchant /private/graphql/reviewed-merchant \
  --directory /private/graphql/deployment-001

node "$SCF/sf105-subquery-graphql-merchant/deployment/cli.mjs" inspect \
  --directory /private/graphql/deployment-001
```

For an explicitly selected same-host HTTP GraphQL backend, add `--allow-loopback-upstream` to **prepare**. It becomes part of the retained handler entry and deployment identity. Public endpoints keep the original HTTPS, DNS/IP, redirect, header, timeout, concurrency, and response-size controls. No upstream requests or credential-value reads occur during these commands.

The output is private and create-only:

| Path | Purpose |
| --- | --- |
| `merchant/` | Every byte of the original prepared merchant, including schema, approved queries, terms, and generated buyer client. |
| `handlers.mjs` | Named original application and admission exports, with the approved normalized query data embedded. |
| `release-inputs/openapi.json` | Exact paid POST facade for the original SF61 importer. |
| `release-inputs/selections.json` | Explicit selected routes and complete ordered native payment choices. |
| `release-inputs/bindings.json` | Original route IDs, handler/admission names, and input-validation binding. |
| `release-inputs/service.json` | Service produced by the original SF61 compiler for an SF82 release. |
| `release-inputs/review.json` | Preserved contract and the original compiler's descriptive annotation differences. |
| `deployment.json` | Original merchant identity, adapter path/hash, explicit loopback setting, credential names, and file hashes. |
| `RUN.md` | Local release and host handoff. |

Keep the output and its recorded original source release. Inspection verifies the native inputs and regenerates the handler module from the retained approved queries; it never imports a caller-selected module. At native launch, the generated entry checks the original adapter's hash and calls `createSubQueryMerchantHandlers`. Its environment is the launching process's environment. The original release contract pins the entry module; its external source dependencies remain part of the operator's retained source installation.

Original legal application names are preserved, including JavaScript reserved words through named ESM exports. A callable export named `then` is rejected before writing: JavaScript's dynamic-import promise treats it as a thenable. Give that handler/admission a different approved name through the normal merchant preparation workflow.

## Stage and run through the original release store

Initialize a new store once with the original release command, or use an existing store. The GraphQL stage command passes the verified files and exact generated handler entry to `stageRelease`; the original SF61 compiler produces the immutable release.

```sh
node "$SCF/sf82-seller-pilot/release-cli.mjs" init \
  --store /private/graphql/releases

node "$SCF/sf105-subquery-graphql-merchant/deployment/cli.mjs" stage \
  --directory /private/graphql/deployment-001 \
  --store /private/graphql/releases --id graphql-001 --port 8423

node "$SCF/sf82-seller-pilot/release-cli.mjs" inspect \
  --store /private/graphql/releases --id graphql-001

node "$SCF/sf82-seller-pilot/release-cli.mjs" diff \
  --store /private/graphql/releases --to graphql-001
```

The example stages a challenge profile. To stage the existing native merchant, supply its selected `--facilitator HTTPS_URL` to stage. The original optional `--allow-local-facilitator` is accepted only with an explicit local facilitator URL for a local native exercise. No credential values are stored in the release options. Set any named GraphQL credential in the launching environment before running the release.

Use the generation returned by the original store's current status/diff. For a new untouched store its initial generation is zero:

```sh
node "$SCF/sf82-seller-pilot/release-cli.mjs" activate \
  --store /private/graphql/releases --id graphql-001 --expect 0

node "$SCF/sf82-seller-pilot/release-cli.mjs" run \
  --store /private/graphql/releases --expect 1
```

The original private release console can manage the same store:

```sh
node "$SCF/sf82-seller-pilot/release-cli.mjs" console \
  --store /private/graphql/releases --port 8425
```

Use the existing fleet workflow to enroll this original store if it is already your operator entry point. Its ownership, activation, current-generation guard, stopping, and rollback behavior are unchanged. A running seller keeps its selected release until stopped. The deployment compiler does not create a second supervisor or auto-activate a release.

All one to sixteen ordered payment choices remain whole objects with their original atomic amount strings, asset, recipient, network, timeout, and `extra`. The shared discovery compiler uses the same sixteen-choice ceiling as the native seller. Stage compares original SF61 source hashes and the trusted entry hash against the inspected deployment before returning success.

SF61 owns the release's offer representation. It supplies its existing payment-required error text and body `examples` annotation, and omits the original offer's optional resource MIME/output metadata. The compiler explicitly compares route identity, URL, method, input assertions, public request example, metadata, handler/admission binding, and every ordered payment choice. It rejects a contract change. Review the actual release challenge when selecting a payment; the exact bytes of the two compilers' optional annotations are not claimed to be identical.

## Prepare the original Linux host installation

Supply an ordinary native host-settings JSON object. This example selects the existing challenge profile; choose `mode: "native"` and the actual `facilitator` URL for the configured native merchant. Payment terms come exclusively from the reviewed merchant.

```json
{
  "schema": "stellar-forge.merchant-host.v1",
  "merchant": "graphql-index",
  "serviceUser": "stellarmerchant",
  "serviceGroup": "stellarmerchant",
  "mode": "challenge",
  "privateRoot": "/srv/stellar-graphql/state",
  "environmentFile": "/srv/stellar-graphql/credentials.env",
  "ports": { "seller": 8423, "operations": 8424 }
}
```

The service user/group must already exist as required by the original host workflow. The compiler fills `kind: "api"`, `config`, and `handlers` from the inspected deployment. Omit `config`, `handlers`, `upstreams`, and `allowLoopbackUpstream` from supplied settings. All other settings are validated by the original SF99 generator. Its `allowLoopbackUpstream` option applies to a different upstream-bindings interface; the generated GraphQL handler already carries its explicit same-host permission.

If the original queries name an authorization environment variable, `environmentFile` is required so systemd can supply it. Put the actual value in that private regular file on the host, using systemd EnvironmentFile syntax, with no group or world access. Preparation records the path and variable name without reading the value. The original host check requires the file to exist with private permissions before installation/start. If no credential or signed-delivery setting needs it, the field may be omitted.

```sh
node "$SCF/sf105-subquery-graphql-merchant/deployment/cli.mjs" host \
  --directory /private/graphql/deployment-001 \
  --plan /private/graphql/host-settings.json \
  --destination /private/graphql/host-001

node "$SCF/sf99-merchant-deploy/cli.mjs" check \
  --bundle /private/graphql/host-001/installation
```

Open the generated `installation/RUNBOOK.md`. The existing generator supplies Caddy, the original seller/operations systemd service, source/configuration checks, private operations, service lifecycle, and encrypted-recovery configuration. Follow its service-account access instructions so the private source/configuration files are readable by the chosen service account. Optional original delivery settings remain under their existing native schema. Generating this package does not install or start services.

The host uses the exact retained original `merchant/service.json`; the SF82 path uses the exact original SF61-compiled `release-inputs/service.json`. Both call the same original handlers with the same query data, input assertions, and payment terms. Select the existing release-store or host lifecycle appropriate to the installation. Do not start both on the same ports. After host startup, use its original smoke command:

```sh
node "$SCF/sf99-merchant-deploy/cli.mjs" smoke \
  --bundle /private/graphql/host-001/installation
```

Add the original `--public` option after DNS and TLS are configured. It checks the selected real public routes. Challenge mode advertises the native offer without delivering a query result. Actual purchase and result delivery use the original native seller and buyer flow.

## Browser and programmatic consumers

Import these functions from `deployment/compiler.mjs`:

```js
const deployment = await prepareSubQueryDeployment({
  merchantDirectory: retainedMerchant.directory,
  directory: '/private/graphql/deployment-002',
  allowLoopbackUpstream: false
});
const reopened = await inspectSubQueryDeployment(deployment.directory);
const staged = await stageSubQueryDeployment({
  directory: reopened.directory,
  store: '/private/graphql/releases',
  id: 'graphql-002',
  port: 8423
});
const host = await prepareSubQueryHost({
  directory: reopened.directory,
  host: nativeHostSettings,
  destination: '/private/graphql/host-002'
});
```

`prepare` and `inspect` return absolute `directory`, `manifest`, `merchant`, `service`, `queries`, `client`, `handlers`, and `releaseInputs` paths, plus `identity`, `hashes`, `adapter`, `allowLoopbackUpstream`, `credentialReferences`, and exact route/payment summaries. `identity.deploymentSha256` binds the prepared deployment manifest; `identity.merchant` binds the original prepared merchant manifest and schema/query/plan source hashes.

`stage` returns `{directory, identity, store, release}`; `release` is the original unmodified SF82 public release. `host` returns `{directory, identity, deployment, plan, bundle, prepared, credentialReferences}`; `prepared` is the original SF99 generation result. `plan` names `host-plan.json`, and `bundle` names its sibling `installation/` directory. No function returns a secret environment value.

A browser consumer should retain the selected original merchant identity and deployment identity alongside the native stage/host results. Use these original APIs again when reopening an existing draft. Stage and host commands may create durable original output before a later input-change error is reported; inspect that output and use a new ID/directory, rather than overwriting it. The CLI preserves SF82's existing importer progress JSON followed by its final stage result; call the exported API for a structured return value.
