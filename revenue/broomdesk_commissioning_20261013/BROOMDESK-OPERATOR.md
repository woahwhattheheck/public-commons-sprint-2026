# BroomDesk recurring-cleaning commissioning guide

Prepared October 13, 2026. Use this guide to take a selected cleaning operator from its current schedule and records through an observed pilot, a reconciled handover, and a recorded operating decision.

The editable commissioning desk accompanies the operator's existing software. Enter the operator's own values, preserve its original exports, and record the result of actions performed in the chosen system. A desk decision records the review of that work; the operator performs scheduling, messaging, payment and payroll actions in the appropriate service.

## 1. Published product basis

The following are current first-party descriptions. Actual selected-account outcomes belong in the observations register. Source IDs resolve to the full URLs in BROOMDESK-SOURCES.json.

### Subscription and feature selection

Starter is USD 29 monthly / 290 annually, Pro 59 / 590, and Business 99 / 990. Team members are unlimited; published location limits are 1, 3 and unlimited respectively. Pro adds payroll, routes, GPS and checklists; Business adds commercial operation and API access. Basic clock records, photos and notes remain available without those higher-plan features. The trial offers Pro for 14 days. SMS credits are additional: USD 10 for 500 outgoing segments. Confirm the selected plan and actual subscription in the account before the pilot. [BD-PRICING](https://broomdesk.com/pricing)

### Jobs and visits

One recurring job creates dated visits. Moving one visit leaves its recurrence unchanged. Pausing cancels future visits and stops creation; resuming restores and replenishes them. Ending retains history while stopping future creation. Dispatch shows assignment and travel conflicts with an explicit override. Property instructions, pets and parking appear with the visit. The installable cleaner web app supports queued offline work. GPS exceptions are flags, and route optimization supports up to 25 stops per person/day. The public page does not specify the recurrence horizon length. [BD-SCHEDULE](https://broomdesk.com/features/scheduling)

### Earnings and exported payroll

BroomDesk derives earnings from completed visits in the organization's time zone. Its bases are hourly, commission, flat per person/visit and hourly plus commission. Commission shares total 100%; hourly rounding occurs at the end. Open periods retain noted adjustments when regenerated. Approval freezes items; an owner can reopen. Missing clock-outs require review. The documented Gusto export contains name, email, regular hours and gross pay; tips are included in gross and only hourly lines contribute hours. Cleaner earnings omit the client visit price. Payment and tax processing remain with the operator's payroll provider. [BD-PAYROLL](https://broomdesk.com/features/payroll)

### Commercial branch

Business supports weekday sets, bulk visit approval, monthly location amounts and PO numbers. Monthly billing is independent of visit count; those visits are not charged again individually. Bulk approval skips ineligible visits with reasons. Inspections weight the areas actually scored and retain unscored areas distinctly. Reports are sent by a deliberate action. [BD-COMMERCIAL](https://broomdesk.com/features/commercial)

### Account, custody and exit

Accounts are for one business; the operator manages invitations and roles. Cancellation takes effect after the paid period, with at least 90 days of readable/exportable access. Clients, visits, invoices and payroll periods have CSV exports on every plan. Photos and message threads require the vendor's full-copy route. Deletion is requested separately, with a stated 30-day response period and retained consent/accounting exceptions. Client payments use the operator's Stripe account. [BD-TERMS](https://broomdesk.com/legal/terms)

Privacy documentation describes encrypted property entry details, role-limited access and private photo links. Location is read at clock events when enabled, rather than continuously. Its detailed hosting section distinguishes application processing in Germany from database/storage/authentication in US East. The public documents do not provide a complete role-permission matrix. [BD-PRIVACY](https://broomdesk.com/legal/privacy)

Service consent and marketing permission are separate. The vendor describes STOP as suppressing both categories, including queued sends; START restores service texts only. A portal marketing preference does not suppress service texts. Treat these as the vendor's published product behavior, and preserve the operator's actual consent and opt-out records. [BD-SMS](https://broomdesk.com/legal/sms-policy)

CSV intake advertises ZenMaid/Jobber column mapping and email/phone deduplication. Preserve ambiguous matches for review rather than treating a detected duplicate as a correct merge. [BD-IMPORT](https://broomdesk.com/)

The optional Business API is organization-scoped, bearer-authenticated and intended for server-side use. It supports read and read/write scopes, shares a 120-request/minute organization allowance, uses an explicit success/error envelope, and lists records with cursors. A new API integration is a separately chosen implementation; this desk works from selected exports. [BD-API](https://broomdesk.com/docs/api)

## 2. Agree the actual pilot

Record the legal/trading business, accountable operator, organization time zone, current systems, current plan, chosen properties and crew, date window, and decision maker. Set a concrete intended outcome: for example, the office can reconcile one real dispatch window and one completed pay period from preserved records.

Choose only the operations the customer wants to evaluate. Select the precise sources and recurring jobs that belong in scope. Keep every other property and period under its present workflow. Record any excluded work so another operator can continue without guessing.

Capture the present process before editing it: who makes schedule changes, who confirms access, who reviews time, who authorizes an export and who receives it. Baseline observations may include actual office minutes per dispatch cycle, unresolved visits and correction counts. Leave unmeasured values empty. Record when and how measurements were obtained; compare equivalent windows and denominators.

Define the customer decision in advance: proceed, proceed with named conditions, repeat the selected observation, or retain the current process. Each condition needs an owner and a concrete resolving result.

## 3. Receive and map the original records

Select the actual exported files from the incumbent system or BroomDesk. Keep each original byte sequence, filename, media type, hash, capture date, source system, covered period and record count. An import record points to those bytes and the exact column map used to interpret them.

Map stable customer, property, recurring-job, visit and worker identifiers separately. Retain source values alongside normalized dates or IDs. Report blank, duplicate, conflicting and unmatched keys individually. Shared household contact details are a review case, not a sufficient identity rule.

Create a preview before using any mapped values: accepted rows, excluded rows and unresolved rows must account for every original row. Correct a mapping as a new revision and preserve the previous interpretation. A changed file or map invalidates a prior acceptance of that interpretation.

## 4. Prepare the property and crew handoff

For each selected property, record the responsible contact, service scope, access-custody reference, parking/pet considerations, handoff owner and the person who confirmed the instructions. Keep door codes and lockbox secrets in the operator's existing secure custody; this portable desk records a reference and whether the assigned cleaner could access the needed instructions.

Confirm actual role behavior using the customer's own selected accounts. Record what the cleaner, dispatcher and approving owner could see or change. Check an unassigned-property boundary as well as the intended assigned visit. Keep worker earnings and customer pricing out of the general client-facing handover.

Use a specific handoff acknowledgment: property, job/visit, recipient, instruction revision, observed time and outstanding issue. A name on a roster is not proof that the new cleaner received the latest change.

## 5. Observe a complete schedule-change cycle

Preserve the selected job pattern and before-state first. Record one explicit intent per change: a single visit, a continuing series or the entire service relationship. Capture requested date/time, duration, assignees, requester, reason and the operator who performed it.

After the change, compare the selected visit and the next expected occurrences to the intended scope. Log actual conflicts and the person who chose the outcome. Link any subsequent access or crew handoff to the changed version.

For pause/resume or termination, retain the observed future-visit list and history reference before and after. Do not manufacture future occurrences in this desk. Distinguish an operator's requested change from an observed change in the source system.

A no-show, denied entry, delayed arrival or canceled visit remains an explicit outcome with an owner. Record who will resolve it and how it affects the selected service/pay review.

## 6. Review actual work and the pay-period handover

Receive the actual completed-work and time records. Keep timestamps with their source offset and organization time zone; record incomplete or contradictory time as unresolved. Distinguish service status, time status, payroll-period status and this desk's review status.

Select the original earnings/export file and the operator's existing pay arrangement reference. Compare the covered worker identities, completed-work coverage, adjustments and observed period totals. Preserve the provider's original calculation and the reviewer’s findings side by side. Enter an expected amount only when the operator can identify its basis.

Each variance needs its original source, reviewer, disposition and correcting source. Preserve the before and after editions. A handover may be marked ready only for the exact reviewed export, covered period and scope revision.

Name the payroll recipient and target import format. Open the actual CSV in that receiving process, verify identities and record the returned result. An exported file, a desk acceptance and a payroll-provider payment are separate events. Replacing or reopening a selected source makes the earlier handover historical; create a new decision for the new edition.

## 7. Record the customer's operating decision

The decision binds the selected business, properties, crew, date window, original source identities, mapping and observation revision. Show unresolved items beside the decision, with named owners.

Any edit to those selected inputs makes the current decision require review. Preserve the prior decision and its exact selected inputs so a receiver can understand what was accepted at the time.

Produce two useful views. The operator copy contains the full original files, mappings, observations, unresolved work and history. The client-facing copy contains only the selected service outcome, agreed next operating steps and appropriate attachments. Review that selected packet explicitly before sharing.

## 8. Complete the portable handover and exit

Export the complete editable desk and selected original sources. Open that export in a fresh session and confirm the same scope, records, decisions, attachments and totals. A recipient should be able to identify the latest accepted edition and the current unresolved work from the opening view.

The exit register records source-by-source coverage: CSVs, attachments, correspondence, settings and any items still held in the original system. Obtain any needed full-copy export while the account remains accessible. Record cancellation request, effective date, export deadline and separate deletion request as distinct events; do not automatically cancel or delete from this desk.

Use the next review date to revisit the customer's measured result, not to send an automated sales message. Keep the operator's existing scheduling, payroll and customer relationships continuous throughout the pilot.


# BroomDesk commissioning acceptance course

These are proposed operating criteria for the accompanying desk. The customer selects the real scope and performs any live changes in its own authorized systems. Published capability references resolve in BROOMDESK-SOURCES.json; the observation/result fields capture what actually happened.

| Stage | Customer-entered inputs | Complete operation and observable result | Retained output |
| --- | --- | --- | --- |
| Scope | Business, owner, time zone, plan, properties, crew, periods, selected capability | Confirm every selected item belongs to the same business and intended pilot. Check required plan against BD-PRICING; record unselected branches. | Named scope revision and original system responsibilities |
| Intake | Original exports and coverage | Preserve full bytes; preview the complete map; account for every row, including unresolved/excluded rows. Reopen the same source without changing its identity. | Sources, hashes, maps, row disposition |
| Identity | Source customer/property/job/visit/worker keys | Resolve one genuine ambiguous match with a stated reason. Keep previous interpretation and do not merge by name alone. | Match decision and affected rows |
| Crew access | Selected property, role, assigned visit, secure instruction reference | Intended recipient confirms the current handoff. Observe actual role visibility and record a permission discrepancy if present. | Role observation, instruction revision, acknowledgment |
| Visit change | Actual selected occurrence and before-state | Operator performs one intended visit change, then observes that visit and next occurrences. Link observed affected IDs to the requested scope. | Before/after source or observation and handoff |
| Series change | Actual job, future occurrences and chosen pause/resume/end intent | Complete the chosen series action in the original system; preserve history and observed future list. Keep unchosen actions out of the live case. | Original action and complete returned outcome |
| Dispatch exception | Actual conflict, travel issue or time off | Record the operator's resolution and affected crew. An explicit override must name who made it and why. | Exception disposition and resulting assignment |
| Actual work | Visit status, time records, attachments | Reconcile the selected work window. Incomplete time and denied access remain distinct findings with owners. | Work review with source references |
| Period review | Actual earnings/export edition, period, workers and adjustments | Account for selected records and reviewer differences. Never silently fill missing time or an unknown amount. | Reviewed edition, findings and original export |
| Export handover | Exact export, recipient, receiving result | Receiver opens the selected file and records its actual outcome. Bind readiness to the exact current edition; preserve any later replacement separately. | Period/file/recipient decision |
| Commercial branch | Selected contract/location amount, period and inspection source | If selected, reconcile the observed bill and scored/unscored areas to the actual contract. Require BD-COMMERCIAL capability before describing this as a product workflow. | Original contract, invoice, observations |
| Customer decision | Selected observations, unresolved work, decision maker | Record proceed/conditional/repeat/retain-current with reasons. A selected-input edit clears the current acceptance and keeps historical decision readable. | Version-bound decision |
| Receiving | Complete editable export and selected originals | Fresh receiving reproduces every selected record, attachment identity and current decision; editing the received copy advances its own history. | Portable complete copy and receiving result |
| Exit | Required export inventory, actual account dates | Reconcile every requested category to an obtained copy or named outstanding item. Cancellation and deletion are recorded independently. | Custody inventory and dated next actions |

## Required relationships

Every observation belongs to the selected pilot and source edition. A reference to an unrelated company's property, worker or period is invalid. A change to the selected map, source, scope or substantive finding requires renewed review. Corrected observations retain the superseded values and reason.

Use actual customer-entered operational values. The empty starter has no invented customers, worked hours, prices, permissions, earnings or successful provider outcomes. If an authored demonstration is included, its separate label must remain visible when opened and exported.

## Human receiving review

Open the complete application on desktop and phone. Use the ordinary controls to select a source, edit a finding, correct an invalid entry, save, download and reopen the actual working file. Inspect the property/crew, schedule-change, actual-work, payroll-handover and decision views. Read the exported customer packet and every selected attachment.

Check long file names, missing optional values, currency/date display, keyboard focus and wide tables in their real views. The opening screen should explain the current scope, latest decision and unresolved work in ordinary language. A source-only check does not substitute for this receiving use.

## Initial acceptance fields

For each row above keep: applicability; original input references; operator; performed_at; observed result; unresolved items; next responsible person; selected output references; review status; reviewed_at. Use not_selected for a branch deliberately excluded from scope, pending before its operation, observed after a returned result, and accepted only after the named reviewer has reviewed that exact result.


## Using this working desk

Create a pilot for one of the original selected companies. Record its actual account plan and payroll entitlement, then add original properties, crew and dated visits. The desk is an offline commissioning planner and receiving record; apply live schedule changes through the company's BroomDesk account and record the observed result separately. A planned change is not a provider result. Every edit remains in the exported history.

Use Time to retain actual clock observations, including incomplete intervals. An approved interval needs an actual end, reviewer and approved minutes; explain a difference from the observed interval. Receive the original payroll export before approving its comparison handover. The comparison CSV carries approved time and source references; it does not calculate earnings, taxes or payments.

Use Intake to record the complete original CSV/source edition, field interpretation and row disposition. Counts must reconcile to the entered source total. This view records your reviewed mapping; it does not automatically migrate records or guess missing columns. Keep the original source attachment and original system keys.

Review each operating criterion with its actual outcome, source and reviewer. Mark an excluded branch not applicable with its reason. Later operating edits invalidate current acceptance. Use a current owner decision to export a handover. The readable report omits secure access references and payroll employee identifiers. Working files contain their full original records and selected attachments; share them only with the intended receiving operator.

Save working files regularly. If local browser storage is unavailable, the desk visibly uses temporary session state and the complete download is the handover. Opening a working file verifies its original company scope, checksum and complete replayed history. A second tab's changed storage is rejected instead of overwritten. Complete application source is downloadable and rebuilds the selected blank application.
