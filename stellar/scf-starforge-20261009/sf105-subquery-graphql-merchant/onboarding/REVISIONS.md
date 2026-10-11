# Revise an existing GraphQL merchant

Use a retained original merchant package and the provider's new **served**
schema to review which query products need attention. The revision workflow
compares schemas and operations, checks explicit replacement queries and terms,
then calls the original merchant exporter. It creates a complete new merchant
package beside an exact copy of the previous package.

This uses the same `graphql@16.14.2` dependency, SF105 compiler, launcher and
generated buyer client as [initial onboarding](README.md). Comparison and
preparation are offline. Capture an authorized provider schema through the
existing `capture` command when a current export is not already available.

## Compare the provider change

`--previous` identifies the original prepared directory containing
`manifest.json`, `service.json`, `queries.json` and `buyer/`. A prior revision's
`merchant/` directory is also a complete original package and can be the next
baseline.

```sh
S=stellar/scf-starforge-20261009/sf105-subquery-graphql-merchant
node "$S/onboarding/cli.mjs" compare \
  --previous /private/merchant-release-001 \
  --schema /private/new-served-schema.json
```

The report identifies the exact old and new schema sources, each retained
operation and any endpoint change. It includes the GraphQL reference library's
breaking and dangerous schema changes, then examines the actual selected
products. Unrelated changes elsewhere in the provider schema do not prevent
preparation of a valid selected product.

| Original operation status | Meaning |
| --- | --- |
| `QUERY_INVALID` | The original fixed query or its native variable declaration does not validate against the new served schema. The report includes the concrete original validator error. |
| `CONTRACT_CHANGED` | The query still validates, but a selected output type, enum, possible object type, argument/default, referenced input type/default, or deprecation changed. Review the recorded contracts. |
| `COMPATIBLE` | Validation succeeded and the compared selected contracts are unchanged. This does not establish unchanged resolver behavior, indexed data or provider availability. |

Referenced input-object fields are followed recursively, including nested
defaults and enum choices. This comparison is conservative: a changed input
field is recorded even when a fixed query literal overrides that particular
default. The report preserves the exact before/after contracts so the operator
can assess the change. It does not infer changes in custom scalar semantics or
resolver implementation from schema text.

The baseline reader verifies each original manifest entry's byte length and
SHA-256, requires the original schema/query/plan files, and recompiles their
runtime bindings with the original compiler. Changed, incomplete or mismatched
prepared files are rejected before the previous package can become the baseline.
These hashes identify retained local bytes; they are not a provider signature.

## Supply the explicit revision

When queries or terms need to change, supply the complete revised source files
in the original formats. Omitted `--queries` or `--plan` retains the corresponding
previous source file exactly. The tool does not invent replacement fields,
choose prices or silently remove products that fail validation.

```sh
node "$S/onboarding/cli.mjs" compare \
  --previous /private/merchant-release-001 \
  --schema /private/new-served-schema.json \
  --queries /private/revised-approved-queries.json \
  --plan /private/revised-merchant-plan.json

node "$S/onboarding/cli.mjs" revise \
  --previous /private/merchant-release-001 \
  --schema /private/new-served-schema.json \
  --queries /private/revised-approved-queries.json \
  --plan /private/revised-merchant-plan.json \
  --directory /private/merchant-revision-002
```

Every candidate operation and its public sample must pass the same original
schema, native variable, offer and client compilation as initial onboarding.
The review distinguishes added, removed and changed operation identities and
compares routes by their existing route ID. It records exact URLs, operations,
handlers, admission identities, input schemas, public samples, descriptions and
service names, tags and ordered native payment options. Atomic amounts remain strings and option order
is preserved. A candidate-wide validation error leaves route comparisons absent
instead of presenting partial routes as a ready merchant.

The `revise` command creates a new private directory. Its parent must already
exist and the destination must be outside the previous merchant package.
Existing output directories are never overwritten.

| Directory | Contents |
| --- | --- |
| `candidate/` | Frozen new served schema, approved query source and merchant plan used for this preparation. |
| `previous/` | The complete original package, including its original manifest and buyer files, copied byte for byte. |
| `merchant/` | The complete replacement package from the original `prepareSubQuerySeller` exporter. |
| `revision/` | `review.html`, `review.json`, `RUN.md` and the final revision lineage manifest. |

Directories use mode 0700 and files use 0600. The final revision manifest is
written after the retained and replacement packages are complete. It records
both original package identities, the new schema identity and the review file
hashes. An interrupted or failed write leaves private partial output for
inspection; the tool does not modify the original directory or report that
partial output as a completed revision.

## Review and use the native replacement

Open `revision/review.html`, then `merchant/review.html`. From the new wrapper
directory, use the unchanged original launcher:

```sh
node /PATH/TO/sf105-subquery-graphql-merchant/launch.mjs \
  --seller merchant/service.json --queries merchant/queries.json --check

node /PATH/TO/sf105-subquery-graphql-merchant/launch.mjs \
  --seller merchant/service.json --queries merchant/queries.json --port 8423
```

Supply the existing facilitator, upstream credential environment and deployment
options described in the [original launcher guide](../README.md). A local
development provider still requires the existing explicit loopback option.
The `merchant/buyer/` files are generated by the same original SF30 OpenAPI and
buyer client exporter. The workflow does not start a seller, change a running
deployment, call a provider query or make a payment during preparation.

The retained `previous/` package remains inspectable and launchable through the
same original interface. Successful old-query execution still requires a
provider endpoint that serves the old contract; retaining files does not roll
back the provider's database or API.

## Application API

`onboarding/revisions.mjs` exports:

```js
const previous = await readSubQueryMerchantBundle(previousDirectory);
const { review, prepared } = compareSubQueryMerchantSchemas({
  previous,
  candidate: { schemaSource, queries, plan },
});

const reviewFromFiles = await reviewSubQueryRevision({
  previousDirectory, schemaFile, queriesFile, planFile,
});
const revision = await prepareSubQueryRevision({
  previousDirectory, schemaFile, queriesFile, planFile, directory,
});
```

`schemaSource` is the unchanged original `compileSchemaSource` or
`readSchemaSource` result. Candidate `queries` and `plan` may be omitted to use
the previous parsed values. An explicitly supplied invalid value is validated,
not treated as omission. `prepared` is the original pure compiler result when
the full candidate is valid, otherwise `null` with a concrete review error.

The file reader returns `{directory, schemaSource, queries, plan, service,
manifest, identity, files}`. `files` is a map of the exact verified original
bytes, including `manifest.json`. The revision exporter returns `{directory,
prepared, previousDirectory, review, report, manifest, summary}`. Its `prepared`
property is the **unchanged original exporter return shape** pointing to
`merchant/`; a browser export can use that original shape for review, buyer
downloads, restart and launch. The wrapper's `directory` points one level above
the original native merchant directory.

Distribution integration maps `graphql-onboarding` to the same
`onboarding/cli.mjs` entry; its `compare` and `revise` subcommands need no separate
migration executable. The original `graphql-merchant` launch interface stays
the same.

## Source basis

GraphQL's [schema change guidance](https://www.graphql.org/learn/governance-versioning/)
distinguishes schema differences from actual client impact. The original
GraphQL 16 `findBreakingChanges` and `findDangerousChanges` utilities provide
the global differences used here; the retained approved operations supply the
actual selected product context. The reference project's
[schema review guidance](https://www.graphql.org/learn/schema-review/) describes
why valid schemas and operation-level review answer different questions.
