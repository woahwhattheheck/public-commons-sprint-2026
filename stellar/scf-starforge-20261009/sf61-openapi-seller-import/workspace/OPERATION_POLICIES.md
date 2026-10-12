# Reusable operation policies

The original API merchant workspace can save a named set of operating settings and apply an exact edition to explicitly selected, priced routes. The original route worksheet continues to own route inclusion and atomic prices. The original merchant compiler continues to own authentication, transport, request/response contracts, cache behavior, streams, durable operations, payments and runtime launch.

A saved policy application carries its full policy document, original merchant plan, route worksheet, targets, overrides and compiler review inside the ordinary merchant package. Export, receiving and release staging keep the same package and its original runtime.

## Complete operator flow

1. Open an OpenAPI, Postman or reviewed HAR source in the existing API merchant workspace. Choose the public seller and payment terms, select supported routes and enter their exact atomic-unit prices. The source inventory supports up to 2,000 routes; a compiled merchant selects 1–64.
2. Open **Reusable operation policies**. Create a policy ID and title, choose its applicable HTTP methods, and enable only the operating fields the policy should set. The editor provides native scalar controls and complete JSON editing for compound fields. You can also copy the current settings of an included route.
3. Save the policy. Its edition SHA-256 identifies the complete normalized policy file. Editing its content creates another edition; existing packages continue to identify their originally reviewed edition.
4. Select the exact routes that should receive that edition. Filtering and pagination help navigate the selected route set. Each route card also provides **Use reusable policy**.
5. Add per-route overrides when needed. An override replaces the complete native value of a field. An explicit removal restores the original compiler's default or absence behavior for that field.
6. Review the application. Read the full before/after records, changed fields, candidate merchant plan, required environment references and original compiler preview.
7. Choose a new package name and **Save reviewed package**. This sends the exact reviewed candidate to the original package writer and reopens it for comparison. The ordinary package export and receiving tools carry its complete policy record onward.
8. Start or stage the saved merchant through the existing workspace or SF82 release flow. The package's original launch command and operating guide remain in **RUN.md**.

The secondary **Apply to editor** action is useful when the original form can represent the exact candidate. The form normalizes several optional fields into explicit defaults, so that action checks the complete round trip and preserves the previous form if the representations differ. Direct saving of the reviewed package supports every policy accepted by the native compiler.

A loaded package always exposes its retained policy history. If its exact plan differs from the form's explicit defaults, the package remains available for review, export, receiving and launch. Subsequent form edits require a new policy review before attaching a policy record to another ordinary editor save.

## Policy file

A portable edition is a complete JSON document:

~~~json
{
  "schema": "stellar-forge.api-operation-policy.v1",
  "id": "shared_read",
  "title": "Short shared reads",
  "description": "Operating settings for the selected read routes.",
  "methods": ["GET"],
  "settings": {
    "timeoutMs": 5000,
    "maxInFlight": 8,
    "availability": {
      "failureThreshold": 3,
      "resetAfterMs": 30000
    },
    "cache": {
      "shareAcrossBuyers": true,
      "ttlMs": 1000,
      "maxEntries": 256
    }
  }
}
~~~

The normalized UTF-8 file, including its final newline, is at most 256 KiB. Its full SHA-256 is the edition identity. Import uses the same normalizer and explicit save operation as authoring in the browser.

A policy ID begins with a letter and contains at most 64 letters, digits, underscores or hyphens. Methods use the original supported set: GET, HEAD, POST, PUT, PATCH and DELETE. Every policy supplies at least one operating field.

### Native fields

| Area | Policy settings |
| --- | --- |
| Backend and authentication | serverIndex, headerEnv, securityAlternative, oauth2, oauthConnection, oauthProfile, oauthAlias, transport |
| Request and public offer | requestHeaders, publicDescription, requestExample, querySerialization |
| Response | responseMode, responseValidation, enforceResponseContract |
| Backend limits | timeoutMs, maxResponseBytes, maxRequestBytes, maxInFlight |
| Operating behavior | cache, availability, idempotency, stream |

The native operation contract supplies this field list to both the compiler and policy authoring. **method**, **path**, **id** and **amountAtomic** retain their original route identity or worksheet authority and cannot be policy settings or overrides.

All 23 policy fields are optional in the original operation schema. A per-route removal can omit any of them. The original compiler then applies its usual defaults and compatibility rules. For example, removing a conflicting legacy response-contract alias is an explicit choice, and removing a transport assignment still requires the plan's transport profiles to be consistent.

Compound fields replace their complete value. Setting a new **headerEnv** map replaces that route's previous map; it does not merge selected credentials silently. To retain a member, include it in the replacement map or leave that field outside the policy and override.

### Route overrides

~~~json
[
  {
    "method": "GET",
    "path": "/reports/{id}",
    "set": {
      "timeoutMs": 20000
    },
    "unset": ["cache"]
  }
]
~~~

An override names one of the explicitly targeted routes, has at least one set or removal, and cannot set and remove the same field. Route selection, price strings and complete untargeted operation records remain intact.

The native compiler checks the resulting whole merchant plan. Shared read caching requires its explicit cross-buyer setting and GET/HEAD methods. Durable POST operations retain their required unique state directories and original key references. Streams retain their native method, cache, response-validation and duration rules. Transport assignments refer to existing compatible profiles in the merchant plan. These rules are implemented in the original native compiler; the policy layer calls that implementation.

## Edition history and concurrency

The policy library lives beneath the original private merchant parent in **.sf61-operation-policies**. Opening, listing, loading and exporting it create no files. Each policy retains immutable full editions and their previous-edition links.

Saving supplies **expectedHeadSha256**: null for a new policy ID, or the observed current head for a new edition. A per-policy lease and atomic publication protect simultaneous writers. A committed identical retry reopens the same edition. A stale head returns the current-change conflict so the operator can compare the actual current edition with the draft.

A saved historical edition can be loaded and applied directly. Saving identical historical content does not move the current head backward. Edit it into a distinct new edition when a new head is intended.

The library retains a durable pending edition during publication. After an interruption, the same store completes that pending edition before accepting another change. Complete policy files, edition metadata and head updates are written with private permissions, verified on readback and synchronized to the original filesystem.

## Exact reviewed packages and recovery

A review binds these complete values:

- Exact original source bytes.
- Original base merchant plan.
- Complete source-bound worksheet and its currency.
- Full selected policy edition.
- Explicit route targets and per-route overrides.
- Additional original operation records where supplied.
- Captured-source selection when the original HAR workspace is involved.
- Exact candidate merchant plan and original compiler preview.

The package endpoint requires the review SHA-256 and recomputes that decision before publishing a new package. The original writer creates the compiled merchant files and includes **operation-policy.json** in **merchant-package.json**.

If a save response is interrupted, retain the attempted name and exact review. Reopen the submitted package or retry the same request. Existing committed work is compared against its verified source, plan and full policy record before consulting mutable host credentials or HAR catalogue entries. A name holding different or incomplete work remains a distinct package-name conflict.

Ordinary editor saves can carry an attached operation-policy record only while the plan and captured-source selection still match it. The reader reconstructs the candidate through the original worksheet planner and compares the original compiler preview, so an edited record or changed plan cannot silently reuse an old review.

## Export, receiving and release

Use the existing complete merchant-package export. Its manifest includes the **operation-policy.json** member and the matching **operationPolicySha256**. Receiving verifies every original file and reconstructs the policy candidate through the original package reader. Existing packages without a policy record retain their original format and behavior.

SF82 release provenance retains the policy-file hash and policy-review hash. The original runtime still uses its compiled facade, selections, bindings and upstream configuration. Approved host environment references resolve in the original runtime.

Export one policy edition separately to reuse its settings in another merchant workspace. The receiving operator imports that complete file, selects the appropriate source routes and prices, and creates a new review against that source and merchant plan.

## Agent and command-line workflows

The existing merchant provider exposes the same library, review and package operations through its source-bound workspace client. It supports declared source, plan, worksheet and policy files, explicit route override files, and complete SHA-pinned downloads for larger policy and application records.

The companion merchant-operator guide documents the concrete tool names, CLI commands, declared-file configuration and one complete native journey. Browser, agent and CLI operations use the same authenticated workspace routes and original package writer.

Related original guides:

- [Route selection and exact pricing](../../../../stellar-forge/mcp-merchant-operator/OPENAPI_ROUTE_WORKSHEETS.md)
- [Complete package transfer](./PACKAGE_TRANSFER.md)
- [Authorization connections](./AUTHORIZATION_CONNECTIONS.md)
- [Backend transport profiles](./TRANSPORTS.md)
