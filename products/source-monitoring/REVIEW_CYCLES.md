# Saved source review cycles

A review cycle turns one retained source comparison into an assigned body of customer review work. It preserves the selected population, original case versions and monitoring policy, then records reviewer completion and supervisor signoff. The original source-monitoring workspace continues to own the editions, counterparties, native screening, identity decisions and relevance decisions.

Open the existing **source-monitoring** Application and select **Review cycles**. Enter the operating reviewer ID and name and choose **Use this reviewer**. The workspace name appears above the cycle list. The complete installation and ordinary monitoring workflow remain in [OPERATING.md](OPERATING.md).

## 1. Start from a complete source comparison

Receive the original source editions and complete update chain through Source editions and Data updates. Retain the original metadata, FtM files, statements and native response evidence in the same workspace. Select the actual before and after editions and use the existing comparison operation.

Review the complete comparison and its impacted customer cases in Change review. Identity and relevance remain independent decisions. The original case revision identifies exactly which decision was visible when the cycle began.

In Review cycles, create a named cycle with:

| Field | Selection |
| --- | --- |
| Label | A recognizable operating name for this review period or source change |
| Comparison | The actual saved comparison ID |
| Selected cases | The complete intended review population, or all impacted cases |
| Scope note | Why this population and source change are being reviewed |
| Supervisor | Stable reviewer identity and displayed name for the person coordinating this cycle |
| Due time | Actual selected UTC due time, or null when none is set |

The saved cycle freezes the comparison, both edition records, original customer case versions, monitoring policies and impact interpretation. It also records the selected and excluded case IDs. A later live case decision therefore does not change which population the supervisor originally commissioned.

Use a new cycle for a genuinely later source comparison or a deliberately changed monitoring scope. Continue assignment, completion and follow-up inside the existing cycle when they belong to its original population.

The software records each cycle command as an immutable event in the same workspace. Its integer version advances as that cycle changes. The returned revision identifies the full saved cycle state.

## 2. Assign the actual review work

The selected supervisor assigns each case to a stable reviewer identity and name. Set an individual due time where useful and retain an assignment note describing the work.

Reviewers should use the same stable ID across their saved decisions and cycle work. The displayed name helps operators identify the person; the ID determines the selected reviewer and supervisor roles in the recorded workflow. Use the customer's agreed operating identities when entering either.

Reassignment preserves the original event history and clears the active completion so the new assignee can review the current work. Review the cycle version immediately before assignment; a stale version produces a conflict rather than replacing a colleague's intervening change.

Use the cycle's selected and excluded counts together. The case table shows 25 rows per page with search and review-state filters. These are operating views; the saved cycle and its exported report retain the full selected population. **Download complete cycle JSON** returns every selected case, source binding and retained report.

## 3. Complete the original case review

Open the actual case from the cycle in Change review. Review the retained source change, candidate identity chain, original customer counterparty and applicable monitoring policy.

Save the decision in the original case form. That form records identity resolution, relevance, reviewer, reason, selected edition and the expected prior case revision.

| Decision | Original values |
| --- | --- |
| Identity resolution | same_entity, different_entity, undecided |
| Relevance | in_scope, out_of_scope, undecided |

A completed cycle review is bound to the cycle's exact following source edition and the actual original case decision version. The candidate must remain within the frozen identity chain. Required identity and relevance decisions must be resolved; a same-entity decision must select one unambiguous current identity.

If the monitoring policy changed, retain the resulting follow-up and create a cycle for that deliberately selected scope. The existing cycle continues to show the policy and original population against which its reviewers worked.

When source identity or required decisions remain unresolved, preserve that condition through **FOLLOW_UP**. The case stays open for further work and the report retains the actual review note and decision version.

## 4. Retain and select complete review evidence

Use **Retain review evidence** to upload the original file into the existing workspace's immutable object storage. Keep the actual original name and media type. The returned object ID identifies its complete retained bytes.

Select those original object IDs when recording reviewer completion or supervisor signoff. Useful evidence includes the complete source material reviewed, an actual customer explanation, a retained provider response or a written operating decision. Each selected file remains available in the complete workspace handover.

The object intake is the original POST /api/os/object route. It accepts the actual file bytes, Content-Type and a URL-encoded X-Original-Name. Its returned descriptor includes id, bytes, name, media, provenance and receivedAt. The cycle uses the original object IDs; it does not replace a file with its name or a pasted claimed hash.

Review evidence remains in the original receiving archive with the source, case decisions and cycle events. Keep private service credentials in their existing configuration route.

## 5. Record reviewer completion

The assigned reviewer selects the current original case revision, chooses a disposition, writes the actual review note and attaches the selected original evidence objects.

| Disposition | Operating result |
| --- | --- |
| REVIEWED | The selected original decision version satisfies the cycle's required review work |
| FOLLOW_UP | The reviewer has retained the observed condition and further work remains |

Completion preserves the complete original case event, selected evidence descriptors, reviewer identity, note and actual time. The software compares the supplied case revision with the current original case before saving.

A colleague may change the case after completion. The cycle then displays that its completion refers to an older decision. Review the changed case, reopen the item with a reason, and complete the current version. The earlier completion remains in history.

If a save response is lost, recover the original cycle request before creating another completion. Repeating the exact original request returns its original result.

## 6. Review and sign the complete cycle

The selected supervisor reviews every selected case and its current decision version. All selected cases must have REVIEWED completions, with no unresolved follow-up and no intervening case changes relative to those completions.

Record the supervisor's note, actual time and original evidence objects, then sign off the cycle. Signoff freezes a complete report at that cycle version. It includes:

- Original comparison and both source edition records.
- Frozen case population, monitoring policy and impact interpretation.
- All selected and excluded case IDs.
- Reviewer assignments, actual completion notes and original case events.
- Original review evidence and supervisor evidence descriptors.
- Supervisor identity, actual signoff time, report version and full report SHA-256.

The report describes the completed selected customer review workflow. Its identity and relevance conclusions remain the original recorded customer decisions.

A later live case change leaves the signed report unchanged and is visible in the cycle's current review state. Use the actual signed version when retrieving a historical report.

## 7. Reopen and continue work

An assigned reviewer or supervisor can reopen an active item with a reason. Only the selected supervisor reopens an item after the cycle has been signed. Reopening preserves the earlier completion, signoff and historical report in the immutable event history.

Review the current case, retain the actual next decision and evidence, complete the item and obtain a later supervisor signoff. The resulting report has its own cycle version and identity. The earlier signed report remains available for its original operating period.

Use the original cycle's actual current version for each new command. Keep the full stale input while reviewing a conflict so the operator can decide what to carry forward.

## 8. Recover the original command after interruption

Every cycle write carries this complete envelope:

~~~json
{
  "requestId": "ACTUAL_CANONICAL_REQUEST_UUID",
  "cycleId": "ACTUAL_CYCLE_ID_OR_NULL_FOR_CREATE",
  "expectedVersion": 0,
  "action": "create",
  "actor": {"id": "ACTUAL_REVIEWER_ID", "name": "ACTUAL_REVIEWER_NAME"},
  "at": "2026-10-13T12:00:00.000Z",
  "body": {}
}
~~~

Replace the illustrated values with the selected original IDs, actual UTC time and complete action body. For creation, cycleId is JSON null and expectedVersion is 0. For a later action, select the current integer cycle version and the existing cycle ID. Preserve the full original request before sending it.

| Action | Complete body fields |
| --- | --- |
| create | label, comparison, caseIds, scopeNote, supervisor, dueAt |
| assign | caseId, reviewer, dueAt, note |
| complete | caseId, caseRevision, disposition, note, evidence |
| reopen | caseId, reason |
| signoff | note, evidence |

caseIds is null for the complete impacted population or the selected distinct case-ID array. supervisor and reviewer each contain id and name. dueAt is the selected UTC timestamp or JSON null. evidence is an array of distinct original object IDs. caseRevision is the original case-event revision, while expectedVersion is the cycle's integer version.

Read cycle-request with the actual original UUID after an uncertain response. An identical request reuses its retained result even after later cycle changes. The same UUID with changed command bytes is rejected. A genuinely new decision uses a new UUID and the current reviewed version.

The actor and supplied event time are part of the original command. Event times follow the saved cycle history and cannot precede the original comparison or frozen case decisions. They cannot be future operating observations.

Browser drafts, original requests, evidence uploads and report downloads are bound to the exact physical workspace directory. Reopen that original workspace to recover a request; a received copy has its own browser drafts. A failed request stays pending until its original result is recovered or the endpoint explicitly confirms it was not committed. An absent lookup following uncertain transport alone does not release it. **Use current cycle version** retains the entered values and deliberately selects the latest saved cycle version after the pending request is resolved.

Direct HTTP cycle calls require the original bearer capability plus `X-Review-Workspace`, containing the URL-encoded absolute workspace directory from `GET /api/os/cycle-context`. The maintained client selects this directory from its authenticated launch. Evidence uploads for cycle work send the same header. Source/provider operations otherwise retain their existing interface.

## 9. Use the browser, client or original CLI

The browser, typed MonitoringClient, HTTP routes and native CLI operate the same Domain and original NDJSON workspace.

| HTTP method | Route | Result |
| --- | --- | --- |
| POST | /api/os/cycle-command | Save or recover the exact original cycle command |
| GET | /api/os/cycles | Current saved cycle list |
| GET | /api/os/cycle?id=ID | Complete selected cycle with current review state |
| GET | /api/os/cycle-request?id=UUID | Original command result |
| GET | /api/os/cycle-report?id=ID&version=VERSION | Complete immutable signed report JSON |
| GET | /api/os/cycle-report-html?id=ID&version=VERSION | Complete human-readable signed report |

The existing MonitoringClient get/post methods expose the matching named operations. Select the current original private connection file and retain complete response bytes through the existing response output methods.

For native CLI operation against the original workspace:

~~~sh
starforge source-monitoring --python /absolute/python3 \
  --workspace /absolute/private/customer-monitoring \
  cycle-command --input /absolute/original-cycle-command.json

starforge source-monitoring --python /absolute/python3 \
  --workspace /absolute/private/customer-monitoring cycles

starforge source-monitoring --python /absolute/python3 \
  --workspace /absolute/private/customer-monitoring \
  cycle --id ACTUAL_CYCLE_ID

starforge source-monitoring --python /absolute/python3 \
  --workspace /absolute/private/customer-monitoring \
  cycle-report --id ACTUAL_CYCLE_ID --version ACTUAL_SIGNED_VERSION \
  --output /absolute/private/signed-cycle-report.json
~~~

Use the existing server/client route while that Application owns the workspace. Retain the original operation's full response, current cycle revision and report identity.

## 10. Receive the entire customer review history

Download the complete customer workspace through Receiving or the maintained client export. The original full ZIP carries the source and update objects, editions, comparisons, portfolios, native screening requests and responses, case decisions and the new immutable os_cycle_events history.

Deliver the selected source release, its installation guide and the whole workspace archive. Include the actual cycle IDs, current versions, signed report versions, support owner and the actual next service period. Historical reports identify their original source and decision versions.

On the receiving host, install the complete selected release, create a new private workspace and import the original full ZIP. Open Review cycles and inspect the complete selected population, assignments, original evidence and signed report. Reopen the selected cycle item when new work is required, save the actual later decision and completion, and export that later whole workspace.

The receiving model replays the original cycle events against retained case-event versions and source objects. An older workspace without cycle events remains a valid starting point. Receiving preserves all original source, case and request identities and gives the new physical directory its normal local storage identity.

## 11. Operating limits and review completion

The current cycle implementation supports up to 10,000 retained unmerged cases for the comparison dataset in its complete creation population, 50,000 cycle events in a workspace and 96 MiB for a complete cycle state. Each evidence list permits up to 128 distinct retained original objects. The existing source-monitoring object, request and archive limits still apply.

Review the complete intended population before creating a cycle. If the complete retained creation population exceeds capacity, retain its original files and current workspace; arrange a supported complete operating scope before starting this cycle. No list is silently sampled or truncated.

The complete handover exercise should use an actual source comparison and its real customer case history: create the cycle, assign work, review the original cases, retain evidence, complete and sign, receive the whole workspace independently, reopen it, and continue a later review. Record the actual observed result in the existing customer Installation.

## 12. Send assigned work to an independent reviewer

The **Reviewer exchange** view uses this same saved cycle and its exact current assignments. Select the named reviewer and complete intended case population, issue the editable HTML and original JSON, then retain their complete returned file. Unfinished work can be received without inventing a named decision. For a named edition, compare original/current/returned case values and completion, explicitly resolve conflicts, and apply through the same case writer and cycle transaction. A signed or changed cycle must be reviewed through its current original workflow before adoption.

For a customer portfolio cycle, a reviewed completion selects the original retained portfolio retain/continue event. The returned file preserves that event and the original portfolio source. It does not create another portfolio-refresh decision. See [REVIEWER_EXCHANGE.md](REVIEWER_EXCHANGE.md) for the complete source inspection, local draft recovery, command replay and onward receiving course.
