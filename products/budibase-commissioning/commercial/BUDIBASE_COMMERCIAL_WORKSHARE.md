## Commercial workshare

### Recommended offer and customer outcome

Offer **USD 9,600 for 80 delivery hours over 20 productive business days**, covering one existing Budibase workflow from its selected original export through a working target environment, agreed behaviour changes, customer acceptance, production cutover, operator training and continuing ownership. This is a proposed service price. The actual client, archive, application population, assigned people and start date are selected in the original opportunity.

The useful buyer is an agency with an existing client application that its team needs to finish or take into support, or a customer whose prototype needs an accountable production handover. The service should leave the operator able to process its actual requests, decisions and completed work, maintain its connections, recover the application, and make an understood correction. The agency retains its customer relationship and can buy TJLabs as a named delivery workshare. Budibase’s [partner programme](https://budibase.com/partners/) explicitly invites agencies and developers to build client workflows.

The fixed-fee planning envelope is one workflow and one development/production environment pair, using up to two existing supported data sources, 12 existing screens, ten existing tables, five existing automations, four application roles and 20 initially assigned users. Select up to four concrete behaviour changes. If internal data and attachments must move, the authored starting allowance is 10,000 internal rows and 100 MiB of attachments. These are service estimating quantities, not Budibase platform limits or observed customer counts. The entire selected workflow remains the acceptance unit. Actual source discovery determines whether this envelope fits; a larger census receives an explicit priced workshare and date change.

### Work that the customer actually receives

| Delivery phase | Practical result | Platform engineer | Workflow specialist | Lead | Total |
|---|---|---:|---:|---:|---:|
| 1. Source and receiving environment | Select the real request-to-completion flow; inventory its screens, data, automations and roles; select the import route; prepare the target and source/data responsibility map | 12 h | 1 h | 2 h | 15 h |
| 2. Implement and configure | Complete the selected behaviour changes; reconnect the agreed data sources; configure queries, fields, actions and role assignments; deliver the whole flow for customer review | 20 h | 3 h | 2 h | 25 h |
| 3. Customer acceptance and correction | Operate the full workflow with the designated users, resolve the agreed defects, check data transitions and permissions, and rehearse recovery on the selected target | 20 h | 4 h | 2 h | 26 h |
| 4. Cutover and operating handover | Publish the accepted development edition through the actual platform route; complete the live receiving checklist, two operator sessions, correction instructions and continuing responsibilities | 8 h | 4 h | 2 h | 14 h |
| Total | Complete selected customer workflow | **60 h** | **12 h** | **8 h** | **80 h** |

The two operator sessions comprise an administrator/configuration session and an end-to-end business operator session. Provide a short task guide, field and decision definitions, a connection/configuration register with owners, a user/role assignment map, known operating constraints, the actual source and target edition references, and the recovery/correction procedure. Include one complete corrected successor during commissioning. A proposed 14-calendar-day correction window after handover addresses defects against the agreed acceptance; new features and additional applications use the same explicit change process.

An example acceptance course is a requester creating an operational item; a reviewer returning it for correction; an approver assigning it to the correct operating queue; the operator completing the task; and the designated recipient receiving the agreed notification or report. Select the customer’s own entities, fields and decisions before implementation. The receiver then repeats that complete course in the target environment, with the agreed roles and connected data. This delivers the functioning business process behind the export.

### Source route, data and cutover responsibilities

The [complete pinned export/import contract](https://github.com/Budibase/budibase/tree/ce17c2e58d05dd8df4073826106445fa653fc7ea) governs the receiving route. A workspace TAR and a project package have different contents and import behaviour. A workspace update changes development configuration while retaining destination identity and existing-table rows; publication is a separate operation. Project import regenerates identifiers, disables imported automations/apps, clears publication status and requires reconfiguration; it excludes rows and attachments. Select the route that covers the actual source object types. The original agency fixture has 27 revision records including nine tombstones, with six live screen records and three live row records. The expense fixture has 91 records including eight tombstones, with six live screens, five live automations and 30 live rows. Preserve the original records and select repeated document revisions explicitly; raw record counts are separate from the live configuration quantities used to estimate delivery.

Assign the receiving environment and licensed features, connection endpoints, secret re-entry, user membership and role mapping to specific customer/agency owners. Original workspace exports may contain secrets and attachments need their own protection. The implementer uses the existing approved storage and receiving environment for those private inputs. External database migration, a new hosting platform, a custom unsupported connector or plugin, major schema redesign, and an independently staffed emergency response service are separate workshares.

For cutover, retain the current published edition and the selected data backup before changes. Rehearse application restore and the treatment of affected data separately: restoring configuration does not undo external writes or notifications. The runbook states who can publish, when the client’s operating window occurs, which prior edition/data state can be restored, and how the operator deals with a partially completed business transaction. The agency/customer authorizes its production operation through its existing process.

### Payer and internal economics

The contracting payer is the customer or the agency buying the implementation. A proposed 40/40/20 invoice schedule is **USD 3,840 at the agreed start, USD 3,840 when the complete implemented flow is ready for customer acceptance, and USD 1,920 on accepted production handover and receiving**. Net 15 is the initial service proposal; the model also calculates Net 0, 30 and 60. Invoice issuance, contractual due date and expected collection remain different fields.

At authored internal rates of USD 75/h for platform/integration, USD 55/h for workflow/acceptance and USD 100/h for the lead, direct delivery cost is **USD 5,960**. Contribution is **USD 3,640 (37.92%)**. A 10% delivery-cost reserve is USD 596, leaving **USD 3,044 (31.71%)** before general overhead, tax and selling costs. Preserving a 30% contribution after that reserve requires at least USD 9,365.72, so the USD 9,600 anchor has little room for an unpriced material scope increase.

| Customer collection scenario | Peak operating cash requirement | Including USD 596 reserve |
|---|---:|---:|
| Net 0 | USD 0 | USD 596 |
| Net 15 | USD 231 | USD 827 |
| Net 30 | USD 3,788 | USD 4,384 |
| Net 60 | USD 5,960 | USD 6,556 |

These runs pay contributors 14 calendar days after their workdays. Planned collection moves weekend/selected-holiday receipts to the next business day. An additional collection-processing delay is editable. Third-party purchases and platform licences remain customer-owned costs unless the selected contract explicitly assigns them otherwise.

Twenty percent unpriced effort raises direct cost to USD 7,152 and leaves USD 1,852 after the original reserve. Forty percent raises cost to USD 8,344 and leaves USD 660. At Net 30, those cases require USD 4,545.60 and USD 5,303.20 peak cash respectively. Agree the real behaviour changes and source population early; use the original change record to price additional delivery rather than consuming the entire service margin invisibly.

An agency reselling this work at an illustrative USD 12,000 and spending eight account-management hours at USD 75/h retains USD 1,800, or 15%, after paying the USD 9,600 supplier fee. A customer price of USD 14,572 provides approximately 30% agency contribution on those assumptions. These are agency pricing scenarios, not a customer quote or an expected referral commission.

### Capacity and dependency calendar

The model allocates six productive hours per person per business day. Default role labels describe separate capacity pools; they do not identify committed staff. Platform effort peaks at 20 h in a five-day phase, workflow acceptance at four, and lead effort at two. The combined peak is 26 h/week. One suitably qualified person could cover the base hours within a 30-productive-hour week, with the designated customer still performing its acceptance. With 20% extra effort, that one-seat option reaches 31.2 h in the acceptance phase and requires another person or a date change. The calculator identifies the affected dates rather than silently compressing capacity.

The selected start is blank. For a readable calculation only, the default origin is Monday 19 October 2026. Twenty working days finish on 13 November, across 26 calendar days, before any supplied holiday adjustments. Ten business days awaiting customer review plus five awaiting the cutover window move that same 80-hour programme to 4 December, across 47 calendar days. Those waits change the phase dates and linked acceptance collections; they do not automatically create billable work. Additional support or rework during a wait is entered as effort.

### Customer adoption, care and platform cost

Implementation alone needs **eight hours saved per month over 12 months** at an authored USD 100 loaded value per customer hour. Optional care is proposed at **USD 900/month for six productive hours**: four platform/integration, one operating review and one lead hour. Direct care cost is USD 455 and contribution USD 445. Care covers the agreed monthly operating review, selected small corrections and configuration assistance. Emergency/on-call coverage and additional delivery require separately assigned capacity.

With care selected, first-year service expenditure is USD 20,400 and the same break-even threshold is 17 hours/month. The model accepts the customer’s actual current manual effort and actual incremental platform cost. At an illustrative USD 399/month additional licence cost, the threshold becomes 20.99 hours/month. Select care only when the customer’s operating need justifies it.

The current [Budibase pricing page](https://budibase.com/pricing/) displays cloud Pro/Premium/Business monthly equivalents of USD 19/49/299, with annual-billing end-user additions of USD 5 and additional creators at USD 50. Its FAQ applies a 20% uplift for monthly billing. The USD 399 illustration is Business plus 20 end users on that displayed annual basis; the customer’s actual billing frequency, included creators, feature requirements and payment schedule determine its purchase. Premium lists backups/restore and SSO, Business adds environment variables and user groups, and self-hosted open source carries separate infrastructure/operating responsibilities. Record the selected plan instead of treating an exported archive as a licence entitlement.

### Service revenue and referral revenue

The [current introducer terms](https://budibase.com/partner-terms/) separate professional services from licence commission. Eligibility requires Budibase-approved account registration and the appointment’s commission rate. The published minimum qualifying initial subscription net revenue is USD 7,200, with the initial period limited to 12 months; implementation/training fees and renewals are excluded. Commission follows Budibase’s cleared receipts and is due by the end of the month after that quarter. A registered account’s professional-service opportunity has stated support/capability exceptions.

Therefore this model funds delivery from its service invoices and defaults referral cash to zero. A separate, explicitly confirmed scenario can enter an eligible amount, rate and original provider receipts. The demonstration USD 12,000 qualifying receipt on 20 October at an authored 10% yields USD 1,200 due 31 January 2027; the 10% is illustrative, not a published entitlement. The USD 9,600 engineering fee itself does not satisfy the subscription threshold.

### Editable model and operator integration

The pure `calculateBudibaseWorkshare(input)` function returns the complete input, source scope basis, role allocations, phase dates, invoices, individual work/cost obligations, daily cash, capacity conflicts, care economics, customer break-even, agency resale economics and a separate referral schedule. `budibaseScenarios(input)` returns the 12 collection/effort comparisons. Its named scenario inputs preserve the longer review/cutover wait, optional care/platform cost, shared-seat capacity and agency/referral examples. Daily cash covers commissioning invoices and contributor payments, plus separately selected eligible referral receipts; optional care is reported as monthly unit economics and customer adoption expenditure. Invoice cents use a nonnegative largest-remainder allocation. If an included referral payment date precedes the first workday, the cash ledger starts at that earlier date while the delivery calendar retains its selected start.

Store the selected inputs and calculated result with the original customer implementation plan. The actual export inventory informs the selected scope and role/configuration work; commercial changes preserve their original reasons and accepted dates. The complete source and base result below allow another operator to reproduce or adjust the whole programme.
