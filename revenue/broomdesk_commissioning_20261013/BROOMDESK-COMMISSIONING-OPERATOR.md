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
