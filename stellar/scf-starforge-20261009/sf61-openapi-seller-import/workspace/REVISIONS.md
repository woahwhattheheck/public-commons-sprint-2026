# API contract revision desk

The existing API merchant workspace can retain and review a replacement provider
description, resolve its selected operations, save a new merchant package and stage
that exact package in the original seller release store. It uses
`../source-refresh.mjs` for operation identity, source differences, setting
preservation and compilation. The command-line refresh tool and this desk therefore
share the same interpretation of a provider change.

## Revise a saved merchant

1. Start the original workspace and reopen the saved project from **Saved projects**.
   Its original description, merchant plan and generated files are checked by the
   existing package reader.
2. In **Review an API contract revision**, select the replacement OpenAPI JSON or
   YAML file. Its original UTF-8 bytes are retained. The existing 4 MiB source limit
   and original OpenAPI parser apply.
3. Review the complete provider source changes and each selected operation's
   contracts and generated bindings. These include referenced components,
   effective public offers, backend bindings, authentication references, request
   and response declarations, and configured operation policies. The comparison
   reports exact changes; it does not infer general backwards compatibility.
4. Choose **Keep operation**, **Remap operation** or **Drop from candidate** for each
   existing route. **Keep unchanged routes** selects the unchanged ones together.
   A remap must name an exact supported operation from the replacement description.
   Operation-ID matches from the shared engine are suggestions; the operator owns
   the mapping. Existing route IDs and exact atomic prices stay bound to their
   original operations.
5. Expand **Retained operation settings** when the new provider contract needs an
   explicit configuration change. The complete saved row is present, including
   server selection, public examples, environment references, response policy,
   cache, availability, stream and durable-operation settings where configured.
   Removing a JSON property becomes the original refresh engine's explicit
   `unset`; changing a property becomes its `settings` patch. `amountAtomic` is
   retained by the refresh engine. Commercial changes use the existing merchant
   configuration separately.
6. To offer additional provider operations, expand **Add new provider operations**
   and enter an array of original merchant-plan rows with explicit methods, paths
   and atomic prices. The original engine checks duplicate targets and prevents a
   new row from reusing an existing operation identity.
7. Choose **Review replacement** after edits. The current original merchant
   compiler must accept the complete candidate. Missing targets, unsupported
   declarations, invalid examples or incompatible settings remain visible with
   their native error; changing one selection does not silently drop another.
8. Choose **Save reviewed candidate** with a new package name. This reruns the
   shared refresh guard and checks the original package manifest before using the
   original `savePackage` implementation. The saved candidate becomes available in
   the existing source/configuration and seller controls.

The review binds exact old and new source bytes, the original plan, explicit
decisions, effective compiler outputs and the saved base package's manifest. A
stale source, plan, decision, compiler result or base manifest requires a new
review. Source changes elsewhere in the provider document remain visible without
automatically offering its new operations.

The source-refresh engine retains stream authoring through the same current
`prepareMerchant` implementation: `payment.paymentFlow`, `operation.stream` and
the original selected response format remain its maintained fields. The desk
does not maintain another setting allowlist or stream compiler.

## Retain unfinished reviews

**Save review snapshot** writes a new private snapshot even while selections still
need work. Choose a new name for each snapshot. **Reopen review** restores its
exact source and decisions and regenerates the current native comparison against
the same verified saved base. Review snapshots live under
`OUTPUT/contract-revisions/`; the directory is mode 0700 and each create-only JSON
file is mode 0600. The base merchant package remains the original input.

Copy the original base package alongside retained reviews when moving their
parent directory. A saved candidate is independently portable through the
existing package reader. Its `source-revision.json` is included in the package
manifest's SHA-256 file map and binds the actual candidate source and plan to the
base package, shared review ID and explicit decisions. It contains no credential
values. The original environment references resolve only in their maintained
runtime.

## Stage and run the original release

After saving, expand **Stage with seller releases**. Select an absolute original
release-store directory and a release ID. Select **Create this new release store**
only for a new directory. **Stage this saved candidate** calls the original
`stageRelease(store, { workspace: packageFolder, ... })` implementation. Staging
copies the same compiled source, upstream bindings and package provenance,
including the source-revision hash and the correct original JSON or YAML hash.

The displayed release-console command opens the maintained compare, activate,
run and rollback workflow. Existing generation checks select a future seller
run. A running seller continues through its existing lifecycle until the operator
uses those controls. The same store is the input for the original SF99 merchant
host; the revision desk does not create a second host or release format.

The existing workspace's challenge preview, native facilitator, operations
dashboard, cache controls, durable tickets and stream customer controls also
consume the saved candidate directly. Retain existing durable state directories,
scope and key references across versions. Dropping a route from the candidate
does not erase its saved operations or change an already running release. A full
merchant withdrawal uses the original release/catalog workflow because the
original merchant compiler requires at least one offered operation.

## Maintained API

`workspace/revisions.mjs` exports the following adapters:

| Function | Purpose |
| --- | --- |
| `reviewMerchantRevision({parent, baseName, specText, decisions, additions})` | Read the verified package and call the original source-refresh review. Returns `reviewSha256`, `refreshReviewId`, changes, native issues and the candidate plan. |
| `saveMerchantRevision({...input, name, expectedReviewSha256, expectedRefreshReviewId})` | Recompute both identities and create the original candidate package. |
| `saveMerchantRevisionDraft({...input, name})` | Create a private, reopenable source/decision snapshot. |
| `listMerchantRevisionDrafts(parent)` | List retained snapshot names. |
| `readMerchantRevisionDraft(parent, name)` | Reopen a snapshot and review its exact original base. |
| `stageMerchantRevision({parent, name, store, id, createStore})` | Consume the saved candidate through the original SF82 release engine. |

Each existing-route decision uses this shape:

```json
{
  "routeId": "the_existing_route_id",
  "action": "remap",
  "method": "GET",
  "path": "/the/explicit/replacement",
  "settings": {
    "amountAtomic": "9007199254740993",
    "responseValidation": "declared"
  }
}
```

`settings` is the complete intended settings object, excluding `id`, `method`
and `path`; omit it to retain every existing setting. The amount in this example
must already be that operation's original amount. Keep decisions omit `method`
and `path`; drop decisions omit replacement settings. Additions use the original
complete merchant-plan row shape and their own explicit prices. The original
engine owns native validation in every case.
