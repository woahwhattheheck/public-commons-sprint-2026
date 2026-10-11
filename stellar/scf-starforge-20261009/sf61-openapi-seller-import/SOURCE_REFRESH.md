# Refresh an API merchant from a changed source contract

Review a replacement OpenAPI description while retaining the merchant's existing
prices, route IDs, payment destination and backend settings. The resulting export
is an ordinary saved API merchant package: the existing workspace, seller and
SF82 release operator can open it directly.

The command uses Node 22.16 or newer and the existing SF61 source dependencies.
JSON works with the maintained source package. YAML uses the original optional
`yaml` dependency, as in the API merchant workspace.

The maintained command also forwards this workflow without another package entry:

```sh
npx --no-install starforge openapi refresh --help
npx --no-install starforge openapi refresh review --parent /private/merchant-projects \
  --baseline api-v1 --spec /private/new-openapi.json --out /private/review-01.json
```

## Review the replacement

Start with a package already saved by the [API merchant workspace](workspace/README.md).
The parent directory and output directories must be private, mode `0700`. Paths
below are examples to replace with the actual operator directories.

```sh
R=stellar/scf-starforge-20261009/sf61-openapi-seller-import/refresh-cli.mjs
node "$R" review \
  --parent /private/merchant-projects --baseline api-v1 \
  --spec /private/new-openapi.json \
  --out /private/review-01.json --html /private/review-01.html
```

The command prints the review identity, readiness, operation counts and precise
compilation errors. `review-01.json` retains both exact source texts, the original
plan, decisions and generated result. The HTML is a script-free local reading
view of that same result. Keep these files private: they include the API source,
public request examples, backend locations and environment-variable references.

An operation still present at the same `METHOD /path` is retained. A missing
operation requires an explicit replacement or removal. Matching `operationId`
values appear as suggestions. New source operations remain unselected until an
operator adds them with a price and settings.

## Resolve selected operations

Create a decisions JSON file. Omit `schema` or use the schema shown here:

```json
{
  "schema": "stellar-forge.api-source-refresh-decisions.v1",
  "mappings": [
    {
      "from": "GET /forecast/{city}",
      "to": "GET /v2/forecast/{city}",
      "settings": {"serverIndex": 1}
    },
    {"from": "POST /forecast", "to": null}
  ],
  "additions": [
    {
      "method": "GET",
      "path": "/alerts",
      "id": "alerts",
      "amountAtomic": "3000",
      "responseValidation": "declared"
    }
  ]
}
```

Use `settings` to adjust original noncommercial operation fields such as the
backend server selection, authentication references, request examples, timeout,
response mode or request limits. For an optional setting that should be removed,
use `"unset": ["cache"]`. A field cannot be set and unset together. The original
merchant compiler validates all chosen fields, including installed extensions.

Retained and mapped operations keep their original route IDs and `amountAtomic`
strings. They also keep the plan's payment configuration, seller server, service
name, source order and all other unchanged settings. Mapping settings cannot
change `id`, `amountAtomic`, `method` or `path`; the mapping itself declares the
new method/path. Use the existing merchant authoring workflow for a separate
commercial change. Additions cannot reuse an existing operation identity or a
removed operation's route ID.

Generate a new review with those explicit decisions:

```sh
node "$R" review \
  --parent /private/merchant-projects --baseline api-v1 \
  --spec /private/new-openapi.json --decisions /private/decisions.json \
  --out /private/review-02.json --html /private/review-02.html
node "$R" show --review /private/review-02.json
```

Output files are create-only. Saved reviews reopen with the same engine and
inputs. When a source, decision, original plan or effective compiler output
changes, produce a fresh review.

## Read the comparison

Each operation retains complete before/after values for its compiled selection,
public offer, application binding and backend configuration. It also retains the
original selected declaration, inherited server/security/parameter declarations
and locally referenced components read through the original OpenAPI resolver.
Arrays stay ordered. Atomic prices stay strings.

The global source comparison includes unselected operations and fields outside
the runtime's imported contract. `CHANGED` and `UNCHANGED` describe the compared
values; they are not a backward-compatibility classifier. Inspect the full source
changes and original compiler diagnostics when upstream semantics change.
`UNRESOLVED` and `INVALID` keep the affected selection in view and prevent export.
An all-removed plan also needs a usable selection before the original merchant
compiler can create a package.

## Export and reopen the reviewed package

Copy the exact 64-character review identity printed by `review` or `show`:

```sh
node "$R" export \
  --parent /private/merchant-projects \
  --review /private/review-02.json --review-id REVIEW_SHA256 \
  --name api-v2
```

Export reopens and verifies the saved baseline, regenerates the review and calls
original `savePackage`. It creates the existing compiled offers, service,
upstreams, operator cases and package manifest, plus `source-refresh.json` with
the accepted source review. The baseline and running merchant remain available.

A repeated export to the same name reopens only a complete exact match. It checks
the actual original compiled offers/service, source manifest hashes, generated
facade, selections, route bindings, upstreams and cases. It can complete a missing
refresh record after a lost reply, without recompiling or replacing the package.
An unrelated, incomplete or altered destination remains intact; choose a new name
or recover it through the original package tools.

The original workspace lists the exported package automatically:

```sh
node stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/server.mjs \
  --out-parent /private/merchant-projects --port 0
```

Reopen `api-v2`, inspect its original preview and start it through the existing
merchant controls. `RUN.md` in the package also gives its exact shell command.

## Stage through the existing release operator

Use the same retained release store as the merchant, then review the original
release diff before selecting it:

```sh
S=stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs
node "$S" stage --store /private/merchant-releases \
  --id api-v2 --label "Reviewed source update" \
  --workspace /private/merchant-projects/api-v2 --port 0
node "$S" diff --store /private/merchant-releases --to api-v2
```

The [existing release guide](../sf82-seller-pilot/RELEASES.md) covers selection,
startup, drain and rollback with the observed generation. Refresh does not choose
a release, change a running seller or supply payment authority.

## Application and workspace integration

The browser adapter and CLI use one synchronous core:

```js
import {reviewSourceRefresh, requireSourceRefresh} from './source-refresh.mjs';

const input = {
  baseline: {specText: saved.specText, plan: saved.plan},
  candidateSpecText,
  decisions: {mappings: [], additions: []}
};
const review = reviewSourceRefresh(input);
// Persist the same input and display review.operations, issues and sourceChanges.
// Before the existing writer saves an accepted candidate:
const accepted = requireSourceRefresh(input, review.reviewId);
// Original savePackage({specText: candidateSpecText, plan: accepted.plan, ...}).
```

`review` exposes `schema`, `reviewId`, `ready`, `plan`, `operations`, `issues`,
`sourceChanges`, `unselected`, `summary` and the original `preview`. Each operation
has `from`, `to`, `id`, `action`, `state`, `changes`, `before` and `after`; missing
operations may have `suggestions`. Changes are JSON Pointer records with `kind`
and whichever `before`/`after` values exist. `summary` counts retained, mapped,
removed, added, changed and invalid rows.

`refresh-cli.mjs` additionally exports `createRefreshReview`, `verifyRefreshReview`,
`readRefreshReview`, `exportRefreshReview` and `renderRefreshReview` for applications
that use its portable review file. Existing workspace revision persistence can
call the shared core directly and retain its own original save lifecycle.

## Native workflow exercise

```sh
node stellar/scf-starforge-20261009/sf61-openapi-seller-import/source-refresh-acceptance.mjs
```

The single workflow starts from the original example, reviews a changed source,
resolves operations, preserves a large exact atomic price, saves/reopens the
original package, stages two original SF82 releases and checks the actual HTTP
402 from the selected release. It retains its temporary private directory and
prints the path. It also exercises stale review rejection, identity reuse and
script-free HTML escaping within that same journey.
