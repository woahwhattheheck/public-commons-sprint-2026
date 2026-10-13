# Decision commissioning programmes

The Flowable operator can retain a complete decision-service commissioning programme: source DMN, typed reference requests, the native deployment and evaluation reviews, confirmed results and the complete receiving history. It uses the same programme intake, workspace owner, decision connection and native dispatch operations as ordinary decision work.

## Open the complete reference

The supplied `workspace/examples/decision-commissioning.programme.json` contains fourteen sequential native steps and seven complete source members. Its original catalogue is `fixtures/decisions/decision-catalog.json`; the other six members are the two authored rule editions for each family.

| Reference family | Typed cases in each edition | Native steps |
| --- | --- | --- |
| Grant intake review routing | Exact decimal/large integer; small intake | 2 deployments + 4 evaluations |
| Vendor review assignment | Changed review threshold | 2 deployments + 2 evaluations |
| Onboarding review routing | New remote route | 2 deployments + 2 evaluations |

These are editable implementation references. Their routes do not represent a customer's policy or a fairness/compliance assessment. `decision-commissioning.inputs.json` exposes all four original typed requests and their authored expected routes for review. The catalogue remains the source of those requests.

The grant request retains `bigDecimal:"10000.1250"` and `bigInteger:"922337203685477580612345"` as native typed decimal strings. The compiler accepts the catalogue's string, boolean, signed32 integer, safe numeric long, bigInteger and bigDecimal contracts. Other supported native input types remain available in the original decision review; they require an appropriate separately reviewed source contract before being added to this reference compiler.

## Compile an editable source edition

From the selected source checkout or installed source directory:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/flowable/workspace/compile-decision-programme.mjs \
  stellar/scf-starforge-20261009/sf30-seller-sdk/flowable/workspace/examples/decision-commissioning.compile.json \
  /existing/output/decision-commissioning.programme.json
```

The installed command is `starforge flowable-decision-programme CONFIGURATION.json OUTPUT.programme.json`. The configuration has schema `stellar-forge.flowable-decision-programme-compile.v1`, the catalogue path relative to the configuration, a stable operation key, and optional `tenantId` and `familyKeys`. Use the actual selected native tenant; omitting it keeps the native default scope. Selected family keys are `d76c_grant_eligibility`, `d76c_vendor_review` and `d76c_onboarding_route`.

The compiler reads every declared original resource without truncation, checks its catalogue byte count and SHA, and preserves the complete catalogue and XML. It publishes the whole programme atomically. Reusing an output filename succeeds only for identical complete bytes; another source edition uses a new filename. The whole output obeys the existing sixteen MiB programme intake limit.

The synchronous application API is:

```js
buildFlowableDecisionProgramme({
  catalogText,
  members, // name -> {text, bytes, sha256, mediaType, contentBase64}
  operation,
  tenantId, // optional
  familyKeys // optional
});
```

Each declared resource resolves to exactly one member by its original catalogue path or filename. The catalogue text must itself be retained exactly once. `describeFlowableDecisionProgramme` returns the same `programme` and an `expectations` list for the native receiving review. The original workspace hashes all embedded bytes before saving the programme.

## Native source selection and review

Flowable 8's standalone DMN upload accepts the resource and optional tenant. Evaluation uses a decision key and tenant to choose the current native definition. A catalogue edition is not a native version-number selector. A DMN deployment's own ID is not its `parentDeploymentId`: the pinned engine uses that field to find a parent application deployment and can fall back to latest. The compiler therefore leaves it absent.

The reference runs each source deployment before its typed cases, then moves to the next source edition. Inspect the prepared native definition/resource against the expected full source SHA before dispatch. Use a controlled commissioning environment with one responsible deployment owner. The original workspace compares its retained source preimage again immediately before the native request. The native latest-selection API does not make that read and evaluation one atomic transaction; coordinate other deployments during the operation.

`verifyFlowableDecisionProgrammeOperation({expectation,operation,readSource,phase})` performs the reference review. `readSource(reference)` returns the original JSON value from the existing workspace. For `phase:'prepared'`, the verifier checks the complete typed selection, current native key/tenant definition and original resource SHA. For `phase:'confirmed'`, it also checks the actual original HTTP201 response and authored typed review route. Returned definition metadata describes the saved preimage; it is not an invented evaluation execution ID.

The existing `receiveFlowableProgramme` now accepts optional `reviewOperation({step,operation,phase})`. Use this verifier in that callback. It runs before first dispatch and for confirmed steps, including confirmed steps recovered in a later lifetime. A failed review stops the same saved operation before further work or export; it does not create another dispatch or authorize a retry.

## Resume and receive the original operation

Save through the original `saveProgramme`, inspect `readProgramme`, prepare the selected step and review its normal native plan. The workspace persists the exact child input before preparation. Continue its existing request after interruption.

A complete native HTTP201 evaluation result confirms the saved request. Native history additions are candidates, not request IDs. An UNKNOWN evaluation whose response was lost remains the same uncertain request and must not be evaluated again automatically. Preserve its source, typed body, raw return and reconciliation.

After all actual steps and source/result reviews complete, export the original workspace, download the complete bytes, inspect/adopt in an independent workspace and reopen the same programme. Its source SHA, original operation IDs, complete result history and programme basis must agree. The installed native journey performs this continuation on the original engine and selected SDK/CLI/MCP/browser application.

## Producing-worker visual acceptance

Before calling the outgoing customer-facing operator or export ready, its producing worker must run/open the exact version, look at actual screens or screenshots, and operate the important controls, downloads and reopening. Inspect screenshare and narrow/mobile widths plus populated, empty, loading and error states. Unviewed screenshots, source/DOM/HTTP checks and peer approval do not replace seeing the product. Repair unreadable, cramped, clipped or overflowing layouts with the existing industrial tables, hierarchy, restrained controls and responsive spacing.

If the native host is unavailable, deliver the complete exact source and opening steps to the existing equipped receiving owner, keep its operation identity, and inspect the rendered return when it arrives. Source compilation and review remain distinct from an actual native or visual completion.

## Original implementation authority

Native engine: Flowable8.0.0, source revision `0779d68e5a3385b74d8acb8bc37901ff54513249`. The complete existing `DMN_NATIVE_CONTRACT.md` and `DMN_SOURCE_MAP.json` retain the original REST routes, typed converters and response shapes. Parent selection is implemented by upstream `modules/flowable-dmn-engine/src/main/java/org/flowable/dmn/engine/impl/cmd/AbstractExecuteDecisionCmd.java`, original Git blob `efba0d4c0b201f4a12a0590ef448736f0b25680e`. Standalone upload is `DmnDeploymentCollectionResource.java`, original blob `3c6ad218d78bfd29543fcf7aaedfbc84babb3d6d`. No expression evaluator or replacement native owner is introduced.
