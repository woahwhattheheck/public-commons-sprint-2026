# MapRank agency pilot — operating guide
Source review: October 13, 2026. This guide defines an editable companion desk for planning, reviewing and handing over a client pilot. It works with entered MapRank results and preserved original files. It does not connect to an account by itself.

## 1. Set up the working case
Create one agency case and name its operator and reviewer. Add a separate client record for each buying organization and a separate location record for each physical business. Give each location its business identity, address and Google Place ID when available. Keep the actual MapRank business ID in its own field: a local desk ID is not a provider ID.

Write the business question in one sentence, such as which neighborhoods need a closer service review. Enter the target keyword exactly as selected, the intended market and the reason that grid covers it. The agency chooses these inputs; the desk starts with blank result fields. Each location can have several keyword series. A series is one stable business/keyword/grid measurement definition.

Use distinct agency, client and location identifiers. Do not treat each of the six researched agency profiles in the original lead package as an onboarded customer. A profile can be selected as a candidate; only an operator creates its pilot case.

## 2. Record the account actually used
Keep a dated account snapshot: account label, plan label, current/legacy status, credit balance, top-up balance, grid ceiling, seat scope, renewal date and the observed report-domain entitlement. Enter an observation source and time. The source register records current published plans, including the conflict with older marketing copy [MR-PRICING, MR-HOME]. Use the account's own entitlements for the case.

Capture the app's quote before a planned run and the actual charge afterward. This desk may estimate point counts; it must label estimates separately from observed balances/charges. A periodic budget is the sum of planned grid points over every location, keyword and occurrence. Track failures and retries individually so they do not disappear into a monthly total. Avoid buying, upgrading or auto-running from an editable estimate.

For the initial free account, plan the observed manual demo described in the onboarding source [MR-SIGNUP]. Keep paid/API eligibility in the account record rather than interpreting a demo as a recurring allowance. The complete billing/cancellation source is [MR-TERMS]; preserve the original checkout if an operator changes a plan.

## 3. Fix the measurement definition
Save a versioned scope containing:
- Client, location, provider business/Place IDs and exact keyword.
- Center coordinates, grid dimensions, spacing and unit.
- Complete ordered point coordinates when actually available.
- Result depth if the source reports it, expected point count and the selected reporting timezone.
- Planned dates/cadence, observed account ceiling and a budget limit chosen by the operator.

Changing the keyword, target business, center, coordinates, grid size or spacing creates a new scope version. Keep earlier scopes and original observations. Do not relabel a moved grid as a continuous before/after series. The method guide supports stable repeated geography [MR-GRID]; the desk's strict comparability checks are an implementation choice.

When only a report summary is available, save it as summary-only. It can be reviewed as a dated vendor observation, but cannot establish point-by-point matches. Allow useful partial intake without manufacturing the missing grid.

## 4. Receive the original baseline
An operator uses the existing MapRank app, approved API or existing authorized workflow to obtain a real scan. Record its provider scan ID, started/completed times, status, original report URL or file and the precise scope used. Attach the original JSON/CSV/report bytes if available and store the file name, media type, byte count and checksum. An attachment must have its own source and import time.

The published integration supports account/business lookup and asynchronous scans/results [MR-AGENTS]. Its public page is a capability overview, not an exact payload schema. Use the actual installed API definition for any adapter. The companion desk keeps raw provider fields alongside its own normalized fields; it does not assume that display labels are wire keys.

Enter every received point with its coordinates, rank or explicit outcome, and provenance. Unknown, failed, not found and ranked are different states. A failed lookup is not proof that a business is absent. Keep provider aggregates exactly as received. A manual entry must identify its author and source, and may be corrected without erasing the original entry.

Select the baseline only after checking business identity, keyword, scope, capture date, point count and attachment. A corrected import creates a new observation/revision. A reviewer can reject a mismatched baseline while keeping it available for repair.

## 5. Review the geography and decision
Use the metric rules to separate provider metrics from transparent local calculations. Show the received point count, completeness and not-found/error counts next to coverage. Display rank movement as positions gained/lost, and coverage movement in percentage points. A zero is a real entered zero; an unentered value displays “Not entered.”

Record geographically specific observations linked to point IDs or regions. Each finding has a short explanation, evidence reference, priority, owner and next action. Keep the hypothesis about why a ranking changed separate from the observed change. Another tool or a client statement may supply traffic/leads/revenue, but it needs a separate source and metric definition; the grid alone does not supply them.

Create an explicit client decision: continue observation, approve a proposed service action, revise measurement scope, or finish the pilot. Store who decided, when, which baseline/follow-up and scope revision they reviewed, rationale and next review date. No universal ranking threshold is preselected. The client and agency can enter their own target and decision conditions.

## 6. Repeat the same series
Record any actual service changes in a work log with owner, date and supporting source. Add the follow-up scan as a new immutable observation. A comparison is eligible only when the required measurement fields match. Point-level comparisons join by coordinates/point identity, not array position. Show any unmatched or incomplete points.

If the geometry or keyword changes, offer a new baseline instead of deleting earlier work. If an import, scope or finding supporting an accepted review changes, retain the old accepted revision and require the current version to be reviewed again. Later changes must not silently reuse an earlier sign-off.

## 7. Prepare the client report and handover
Keep internal operator notes separate from a client-facing summary. The client packet contains the selected scope, original baseline/follow-up references, defined metrics, readable observations, agreed action/decision and the next date. Give it a revision, produced-at timestamp and the exact accepted source revision.

Enter publication choice explicitly: unpublished, approved for link sharing, shared, or withdrawn. Record the actual report URL, domain, reviewer and recipient without exposing API keys. Shared MapRank URLs are public by possession, with project/team access handled separately [MR-PRIVACY]. Opening a link successfully is a useful receiving check; it does not make a guessed URL authoritative.

Keep the whole working record downloadable with original attachments and histories. The companion desk's JSON/CSV/archive exports are its own delivery features; the public sources did not establish a native MapRank export/backup endpoint. On a fresh receiving workspace, reopen that record and confirm original observations, scope versions, review history and attachment identities before continuing.

## 8. Finish, pause or migrate
At handover, record the receiving operator, account owner, source files and next scheduled activity. Account credentials remain in the existing credential manager; the desk stores only a nonsecret custody reference and verification date. Record which teammate can access which client. Do not infer access from a role name alone.

For a move to another tracker, keep raw results plus the metric conventions and exact geography. Imported historic data needs its own provider/source label. Compare equivalent received measurements; do not merge different providers' averages without their missing-value rules.

If scanning stops, preserve the local operated record and set the next action explicitly. Subscription cancellation, disabling a schedule and account deletion are distinct actions. The current published retention and deletion procedure are recorded in [MR-PRIVACY]; confirm the account's present state before any action.

## Pilot acceptance
A pilot is ready for client review when its chosen scope, actual baseline source, account/budget observation, complete or explicitly partial intake, labeled calculations, findings and proposed decision are present. It is complete when the operator records the client decision, produces the exact accepted packet, and cold-reopens the complete working record. Improvements in rank are an observed possible outcome, not a prerequisite for an honestly completed pilot.
