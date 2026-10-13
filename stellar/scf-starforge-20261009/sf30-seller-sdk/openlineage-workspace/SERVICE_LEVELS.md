# Pipeline service levels

Service levels turn original OpenLineage events into a usable pipeline operations desk. Operators save per-job expectations, evaluate a stated time, retain an immutable assessment, and decide how to handle each observed incident. Every policy revision and incident decision travels with the original editable workspace.

Open **Service levels** from the workspace header, or visit the workspace's **/service-levels** page. The desk uses the same workspace identity, HTTP owner, access token and revisioned writer as the original lineage application. Its four work areas are Policies, Assessment, Incidents and Reports. The complete desk instructions are in [SERVICE_LEVELS_OPERATOR.md](SERVICE_LEVELS_OPERATOR.md).

## Choose the original job

Copy the exact job key from the existing workspace or select a job in the policy form. A key includes both the namespace and job name, for example:

    ["job","warehouse.example","hourly_refresh"]

The example is illustrative. Replace it with the key from the selected original workspace before saving. Policies may intentionally name a job that has yet to produce an event; the assessment records that lack of observation.

A policy contains:

| Field | Meaning |
| --- | --- |
| title | Operator-facing expectation, up to 400 characters. |
| jobKey | Exact JSON job key supplied by the workspace. |
| effectiveFrom | RFC3339 start time with an explicit timezone. |
| maxCompletionAgeSeconds | Maximum time allowed since the latest observed COMPLETE event; null disables this condition. |
| maxDurationSeconds | Maximum observed elapsed run time; null disables this condition. |
| monitorFailures | Observe FAIL and ABORT terminal events in the failure window. |
| failureWindowSeconds | Lookback for terminal failures and completed duration findings; defaults to 86400 seconds. |
| owner | Responsible team or person, stored as ordinary text. |
| runbook | Optional HTTP(S) reference. The application retains the link without fetching it or sending notifications. |
| enabled | Disabled policies remain visible with their complete history. |

At least one completion, duration or failure condition must be enabled. Durations are whole seconds from 1 through 315360000. Saving an existing policy uses its id and creates its next version; older versions remain available in its history and in the assessments that used them. A reason accompanies each save.

## Understand an assessment

Each evaluation requires an explicit asOf timestamp. The result includes the selected workspace revision, event IDs, source IDs, policy versions, projected observations, findings, and coverage diagnostics. A read-only evaluation allows the operator to inspect the result before saving it.

The projection uses the same retained events and namespaced job/run identities as the original lineage workspace. Events with valid timestamps after asOf are excluded. Invalid timestamps remain visible through diagnostics and do not provide a fabricated observation time. Observations always describe the selected retained source data.

### Completion freshness

The first deadline is effectiveFrom plus maxCompletionAgeSeconds. The policy's grace period therefore applies even when the workspace has never observed a completion. After the grace period, a job without a COMPLETE produces completion-unobserved. An observed completion anchors the next deadline; an overdue deadline produces completion-stale.

An event after the evaluation time cannot satisfy that evaluation. START, FAIL and ABORT events do not satisfy completion freshness. A future policy is marked not-started. An unobserved job inside its initial grace period is marked awaiting-observation.

### Run duration and failure

An observed START supplies a run's duration anchor. Active runs that exceed the maximum produce run-overdue. A recently completed or failed run exceeding the maximum produces run-duration-exceeded. Terminal runs are considered within the policy's configured lookback window. An active or recent terminal run without START retains a note describing that missing duration anchor. An otherwise unviolated policy with that missing duration evidence is marked awaiting-observation.

FAIL and ABORT outcomes within the configured window produce run-failed and run-aborted findings. The exact job/run identity and original event/source references remain attached to each finding. Multiple conditions can be recorded against the same run.

### Save a current or historical selection

Saving a current assessment normally updates the incident desk. Repeating the exact operation ID and arguments returns the original result through the existing workspace journal. A changed workspace revision requires the operator to review the new selection before issuing a fresh request.

A saved edition is a historical selection. Set applyToIncidents:false when saving an edition assessment. The same option can retain an older evaluation time without changing the present incident desk. Applied assessments advance monotonically in their evaluation time; they may have the same time when additional original events have arrived.

Saved assessments freeze their event/source IDs and policy versions. Later imports and policy edits preserve the previous interpretation. Receiving a package reconstructs those assessments from the retained original sources and compares the full saved assessment.

## Work an incident

A finding opens an incident with its original policy version, first observation and event references. Subsequent assessments update its current condition and latest original references. A clear assessment records condition-clear while preserving the operator's decision.

| Decision | Result |
| --- | --- |
| acknowledge | Mark the incident acknowledged, with the operator's reason. |
| assign | Set a named owner while preserving the incident's current status. |
| resolve | Close an incident whose most recent saved assessment shows the condition cleared. |
| accept | Record a reasoned acceptance of the condition, including when it remains active. |
| reopen | Return the incident to open status. |

An observed condition recurring after resolution reopens the incident. Accepted conditions remain accepted when observed again, retaining the explicit prior decision. Every decision records the time, reason, before/after status, owner and assessment reference.

Changing a policy creates a new policy version and therefore new finding identities. The previous incident remains readable with its original policy meaning. A subsequent current assessment clears its active condition if that previous policy version no longer applies.

## Command line

The existing OpenLineage command forwards service-levels to the same implementation:

    node cli.mjs service-levels status --workspace /private/lineage
    node cli.mjs service-levels policy --workspace /private/lineage --input actual-policy.json --reason "Agree the daily operating window" --operation-id policy-daily-v1
    node cli.mjs service-levels evaluate --workspace /private/lineage --at 2026-10-12T12:00:00Z
    node cli.mjs service-levels record --workspace /private/lineage --at 2026-10-12T12:00:00Z --operation-id assessment-20261012T1200
    node cli.mjs service-levels incident --workspace /private/lineage --id INCIDENT_ID --decision assign --owner "Data operations" --reason "Route to pipeline owner" --operation-id assign-incident-01
    node cli.mjs service-levels report --workspace /private/lineage --format html --out /private/service-levels-report.html

Use --revision to bind a mutation to a specific revision already reviewed. Otherwise the CLI reads current metadata immediately before preparing the request. Preserve the complete original arguments and operation ID after an interrupted response; the original writer's journal provides exact replay.

Replace --workspace with --url and optional --token-file for an existing HTTP workspace. The CLI reads the server's original identity and pins its workspace and running instance. Add --expected-workspace-id and --instance-id to bind a URL command to a connection already reviewed; the server and client both compare those identities before an action is sent. Keep the workspace ID when recovering a prior operation. A restarted instance can be selected explicitly after reviewing its new identity. To retain an edition assessment:

    node cli.mjs service-levels record --url http://127.0.0.1:8767 --edition EDITION_ID --historical --at 2026-10-12T12:00:00Z --operation-id historical-01

Report output uses create-only private files. Select --assessment to export a particular saved assessment. If omitted, the latest saved assessment is selected. Reports always retain all saved policy versions and incident histories.

## HTTP, Node and merchant tools

The original POST /api/action endpoint exposes:

| Action | Arguments |
| --- | --- |
| service-levels.read | Empty object. |
| service-levels.policy.save | operationId, expectedRevision, policy, reason. |
| service-levels.evaluate | asOf, optional editionId. |
| service-levels.assessment.save | operationId, expectedRevision, asOf, optional editionId and applyToIncidents. |
| service-levels.incident.review | operationId, expectedRevision, id, decision, reason, optional owner. |
| service-levels.report | Optional assessmentId and format: json, csv or html. |

The installed typed client is exported as @tokenjunkielabs/starforge-merchant/seller/openlineage/service-levels. Its methods are serviceLevels(), saveServicePolicy(), evaluateServiceLevels(), saveServiceAssessment(), reviewServiceIncident(), and serviceLevelReport(). It extends the original LineageClient, preserving its access headers, identity binding, timeout and caller cancellation.

The original stdio catalogue exposes the same actions as lineage_service_levels_read, lineage_service_levels_policy_save, lineage_service_levels_evaluate, lineage_service_levels_assessment_save, lineage_service_levels_incident_review and lineage_service_levels_report. The configured merchant provider exposes them with the merchant_ prefix and the existing workspace alias argument.

The three mutating merchant actions use the original host's active-call tracking, uncertain-operation recovery and explicit instance reconnection. Oversized confirmed writes return the original committed revision, operation ID and saved record identity, with complete retrieval through the original journal/export.

## Complete delivery and receiving

Use the existing workspace export to deliver the original source bytes, event history, policy history, assessments, incidents and application:

    node cli.mjs export --workspace /private/lineage --out /private/customer-lineage.json
    node cli.mjs verify --input /private/customer-lineage.json
    node cli.mjs receive --input /private/customer-lineage.json --out /private/customer-lineage
    node /private/customer-lineage/application/cli.mjs serve --workspace /private/customer-lineage --port 0

The receiving directory must be new. The original workspace identity and revision remain unchanged. The complete current application inventory includes the service-level domain, typed client, CLI, catalogue, browser desk and operator guides alongside the original lineage and producer application.

Use JSON for complete machine-readable policy, assessment and incident data; CSV for spreadsheet review; HTML for the printable customer operating report. Event and source identifiers in all three formats refer back to the original delivered workspace.

Policies and assessments are evaluated when an operator invokes the desk, CLI or existing tool. Scheduling and notification delivery belong to the operator's existing run environment. No timer or separate background process is installed by this feature.

## Application edition compatibility

New service-level exports use applicationVersion 4 and include all 66 portable source files. Receiving preserves the original version-1 inventory (35 files), version-2 inventory (40 files), native version-3 inventory (48 files), and complete schema version-3 inventory (55 files). Each inventory is checked as its exact complete set. Schema records require a schema-capable edition, and saved service-level policies, assessments or incident decisions require version 4. The existing includeApplication:false option retains a complete data-only export with its corresponding application version.

## Saved evaluation versions

Every newly saved assessment records evaluationVersion 2 alongside its complete original policy versions, selected event/source identities, explicit observation time and assessment digest. Version 2 retains missing START duration coverage as awaiting-observation for active and recent terminal runs.

Earlier saved assessments keep their original bytes, digest and incident references. Receiving an unversioned assessment recomputes its complete contents against the two original evaluation contracts and accepts only an exact match. This supports both the original engine's recorded workspace and the subsequent coverage refinement. Explicit versioned assessments use their recorded evaluator; unsupported versions are rejected. The original version 1 duration behavior remains available solely for reconstructing these retained assessments. New actions always use version 2.
