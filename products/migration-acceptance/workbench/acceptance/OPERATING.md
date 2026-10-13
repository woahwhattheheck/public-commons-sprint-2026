# Definian: related-object migration acceptance

This module extends the maintained dlt migration comparison with explicit business-object integrity, parent/child relationships, exact grouped totals and separately recorded exception decisions. It does not write to either database, start a native process or change a measured comparison.

## Source and owner join

Add exactly these two leaves under the existing component:

- acceptance/index.mjs
- acceptance/OPERATING.md

The existing operator owns workspace history, API/UI, imported evidence, native runs, receiving and publication. Keep its original stable request handling and complete source/archive closure. The module imports the unchanged selected original sources:

- vendor/dlt/vendor/sling/migration/common.mjs — exact canonical JSON and digests.
- vendor/dlt/vendor/sling/migration/compare.mjs — canonicalCell, preserving explicit declared comparison types.
- vendor/dlt/pipeline/plan.mjs — comparisonPlan and comparePipeline.

The original source selection is retained in the accompanying source packet. Do not substitute a second comparator or infer native success from these pure functions.

## Three synchronous API functions

### compileAcceptance(input)

Input schema is definian.acceptance-input.v1. Fields are schema, optional title, the required full pipelinePlan, objects, relationships and controls. Unknown fields fail explicitly so a misspelled policy cannot be dropped.

pipelinePlan is the exact compiled dlthub.pipeline-plan.v1 from the currently selected original workspace object. Populate it from that object; do not take an unrelated caller-supplied plan. Its retained digest is checked, and the original comparisonPlan is derived and retained. Every selected native business stream must appear exactly once in objects.

Objects contain:

- id: distinct business object ID.
- streamId: exact original comparison stream ID.
- key: nonempty, distinct canonical business-column names; it must retain the original native primary-key columns.
- required: distinct canonical business-column names that must not contain typed null.

Keys are always required acceptance conditions on both sides. Empty text is an actual non-null value: it stays distinct from null and may be a duplicate key, but it is not silently converted to a missing field. Invalid typed cells and absent selected columns always hold acceptance.

Relationships contain id, parentObjectId, childObjectId, parentColumns, childColumns, nulls and acceptance. Select the same number of columns and matching declared original comparison types. Each side resolves canonical business-column names through its original left/right column map.

- nulls: forbid or allow-all-null applies to the child key. The latter permits an entirely null optional foreign key. A partially null composite child key fails.
- A null parent key fails that relationship. Duplicate parent values remain explicit, with every parent row and every ambiguous child retained.
- Every non-null child must match exactly one parent. Several children may refer to the same unique parent.
- acceptance: required or reviewable is explicit. Reviewable relationship findings can later receive an accepted exception; they cannot clear a separate required object-key or parity finding.

Controls contain id, objectId, groupBy, measure, nulls and acceptance.

- groupBy is a distinct list of canonical business columns. An empty list means the whole table. Typed null and empty text remain separate group keys.
- measure: {kind:"count"} counts every retained row, including duplicate rows. It has no value column or scale.
- measure: {kind:"sum",column:"amount"} requires an original declared integer or decimal binding. An optional scale from 0 through 38 requires exact representability at that decimal scale. Values are never rounded and IEEE-754 values are never coerced into an exact sum.
- nulls: reject creates a finding for null measure cells; ignore retains their full count while omitting them from the numeric sum.
- Both sides retain every group, complete row identity and exact total. Missing groups differ from present groups with zero totals, even when their mathematical totals coincide.
- Empty ungrouped tables have a present count/sum of exact zero.
- A total is represented as {exact:"123e-2",coefficient:"123",exponent:"-2"}. This represents 1.23 without JavaScript Number arithmetic. Coefficients and exponents are strings.
- Exact expansion is limited to 10,000 decimal digits. An input or intermediate total exceeding that explicit processing boundary creates a required hold; it never produces an approximate accepted result.

The result is definian.acceptance-plan.v1 with planId. It retains the literal original input, native plan, derived comparison plan, normalized object/rule selections and processing/display bounds. Persist the full result as an immutable source object under the original workspace request.

### evaluateAcceptance(plan, observations, {parity})

observations is the unchanged complete slingdata.migration-observations.v1 produced by the selected original native job. parity is its unchanged dlthub.pipeline-comparison.v1.

Before business-rule evaluation the module checks:

1. The complete compiled acceptance plan reproduces from its original literal input.
2. observations.pipelinePlanId and observations.planId select the original pipeline and derived comparison plan.
3. Both original parity digests are valid: reportId and nativeReport.comparisonId.
4. nativeReport.observationsDigest binds the complete exact observations.
5. Running the maintained comparePipeline on that original full native plan and those observations yields exactly the supplied parity report.

Invalid bindings throw; they never return a ready result. A valid original failed/incomplete parity report remains in the resulting acceptance report as a required ORIGINAL_PARITY_HOLD, including missing streams, native execution errors, pending packages, failed load jobs and incomplete table coverage.

The result is definian.acceptance-report.v1. It retains the complete original plan, observations and parity. Every failed row has objectId, streamId, side, rowIndex, rowDigest and original sourceSha256. Duplicate rows remain distinct by their original row indexes. Relationship matches also retain their exact parent and child references.

Each finding has a digest-based findingId. The complete rows list is preserved. examples contains at most the first 20 entries for display, with examplesTruncated; it is never the evidence boundary. Count fields refer to findings or the stated row/group population, not distinct identities inferred from a display sample.

Measured readyForCutover requires original native parity readiness and zero findings. Measured findings and reportId never change when a reviewer records a decision. A source correction, a changed rule or a new native observation creates a new complete report edition.

### decideAcceptance(report, decisions)

This reopens the full measured report, verifies reportId and reproduces it from its original inputs before applying any disposition.

Each decision contains exactly:

- findingId and reportId, selecting the current full measured report edition.
- disposition: acknowledged or accepted_exception.
- reason: a nonblank human reason.
- actorId: the original authenticated operator identity supplied by the existing workspace/server.

Acknowledged records that someone reviewed the finding; it stays unresolved. Accepted_exception resolves only a finding explicitly declared reviewable. Required object keys, typed-cell/column integrity, exact-arithmetic failures and original parity/native-completeness holds cannot be accepted away.

An edition contains at most one current decision per finding. The workspace keeps all earlier decision editions in its existing history. To change acknowledged to accepted_exception, create the next decision edition with the original reportId and retained prior edition; do not mutate measured report bytes.

The result is definian.acceptance-decision.v1 with decisionId, exact plan/report/observation/parity references, the complete selected decisions, per-finding resolutions and counts. Decision readyForCutover requires original native readiness and no unresolved required or reviewable findings. A decision from a different report fails, even when a displayed row looks the same.

## Operator workflow

1. Select an existing completed original native plan/run and its full typed observations/parity.
2. Import or author acceptance input in canonical business-column names. Bind the selected compiled pipeline plan from the same workspace.
3. Compile and retain the input/plan as one original request. Show object keys, optional relationship semantics and exact control policies before review.
4. Evaluate the original observations. Show native parity first, then required findings, then reviewable findings; offer complete row-evidence downloads.
5. Record acknowledgement or deliberate exception acceptance with the authenticated actor and reason. Preserve the previous decision edition and all source/report bytes.
6. Show measured truth separately from the current decision. Use the current decision's readyForCutover only when its reportId still equals the selected measured report.
7. Carry full input/plan/observations/parity/report/decision/source objects through the existing named archive and fresh/forward/older receiving paths. Re-run the pure validation on receiving without replaying the native load.

The module does not authorize cutover or perform it. The existing operator uses this exact retained result in its established acceptance workflow.

## Original-source validation completed

The authored module was composed with the actual retained common, canonicalCell/compareObservations and compilePipeline/comparisonPlan/comparePipeline in V8. No database or browser was invoked. The focused cases established:

- 9007199254740993.01 minus 9007199254740992.99 produces exact 0.02.
- Blank text remains separate from null.
- Both-side orphan identities remain complete.
- Acknowledgement leaves the two orphan findings unresolved.
- Explicit acceptance resolves those declared reviewable findings while leaving their measured report unchanged.
- Required duplicate-key/native parity findings reject exception acceptance.
- A rehashed altered parity report is rejected by recomputation against the original comparator.

Use the supplied exact source and original job outputs for the one full receiving course owned by the main programme.
