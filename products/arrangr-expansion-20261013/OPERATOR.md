# Arrangr Expansion Desk — operator guide

The desk receives a complete working record of users, product activity, organizations, subscription observations, payments, contact history and suppression. It turns those records into a company queue and a saved pilot history. The standalone file works locally; the current workspace stays in browser memory until you download it.

## Open, save and continue

Open the complete Arrangr Expansion Desk HTML file in a current browser. Choose **New workspace** for an original customer edition, **Open workspace** for an existing JSON record, or **Load demonstration** for either the separately labelled original queue or the completed illustrative pilot. Starting a new workspace does not import Arrangr data automatically.

Give the workspace a stable identifier and an observation time with timezone. The observation time controls which imported records belong to the current review. Preserve a downloaded edition before receiving another source. **Save complete workspace** includes all supported tables, imported-source editions, saved pilots and the operation journal.

To continue, open the downloaded JSON in the same application. The maintained engine validates it before replacing the current workspace. The current revision is displayed at the top. Browser refresh or closing a tab discards changes that have not been saved.

## Receive original data

Use **Data and sources**, choose a table, then **Import table**. CSV and JSON arrays are accepted. JSON may also use an object with a rows array. Choose the source edition name, map its columns, inspect the preview and select append or upsert. The application checks the complete mapped input before accepting the new workspace.

Append is appropriate for new original identifiers. Upsert is for a later source edition that adds records or revises the same identifiers. Use the stable source-system identifier rather than a spreadsheet row number. Subscription snapshots need their own unique row ID and the stable subscription_id; this preserves the observed billing timeline.

The mapping screen preserves text values such as member IDs, email addresses and original references. Money fields require exact integer minor units. No currency conversion is performed. Explicit booleans accept true/false, yes/no or 1/0. Organization domains accept a JSON list or comma/semicolon-separated text.

### Supported input tables

| Table | Fields |
| --- | --- |
| users | id, email, email_verified, created_at, status, organization_id, marketing_permission, name, deleted_at |
| events | id, user_id, organization_id, pilot_id, type, at, source_ref |
| organizations | id, name, domains, status |
| subscriptions | id, subscription_id, user_id, organization_id, status, currency, monthly_recurring_minor, observed_at, source_ref |
| payments | id, subscription_id, user_id, organization_id, currency, net_amount_minor, kind, paid_at, source_ref |
| touches | id, user_id, company_key, channel, at, outcome, source_ref, note |
| suppressions | id, scope, key, reason, at, until_at, source_ref |

User status is active, deleted or suspended; deleted_at preserves an original deletion timestamp when present; marketing_permission is allowed, suppressed or unknown. Organization status is active or inactive. Subscription status is active, trialing, cancelled or past_due. Payment kind distinguishes payment and refund; payments are nonnegative and refunds nonpositive signed net_amount_minor in the agreed source mapping. Suppression scope is user, domain or company.

Download a header template for the selected table when preparing source mapping. Export current table returns the current normalized records; the complete workspace is the handover that retains sources and original operations.

## Review the company queue

The company queue distinguishes expansion-ready, reactivation, existing-team, single-active, suppressed and identity-review groups. Each row shows the engine's current reasons, eligible-member count, proposed champion and observed recurring amounts. Search and segment filters only change the displayed queue.

Open a company to inspect its original member IDs, organization membership, verification and contact permissions, recent imported activity and retained contact history. A matching business email domain is provisional grouping evidence. Keep real organization identity distinct, especially where one domain spans several workspaces, subsidiaries or customer accounts. Free email domains require individual identity review.

The active-member window is a product-analysis rule. It is not Arrangr's billing definition. Current recurring amounts come from subscription observations; payments and refunds come from separate receipts.

## Prepare and operate a pilot

Prepare one company pilot from its detail view. Record the owner and the concrete reason for choosing that company. The engine fixes the baseline and original member cohort at preparation. Later changes to queue rules do not rewrite that baseline.

Use the pilot's original identity when receiving subsequent events. General scheduling activity includes meeting_created, meeting_completed, booking_received, poll_created, meeting_confirmed and booking_confirmed. An observed team activation requires the retained team_created event and at least two original cohort members with accepted invitations followed by confirmed activity in that same organization. The outcome view keeps those stages separate. Record a contact only after it happened, with its original timestamp, channel, outcome, source reference and note. The record affects subsequent contact eligibility and cooldown review. Preserve opt-outs and other restrictions as suppression records.

In the existing product, keep invitation, accepted membership, member setup, actual scheduling activity and billing observation distinct. Review the intended member plans and admin owner. Use the actual existing organization/member workflow, then receive its native event and billing observations through the agreed mapping. A proposed meeting or invitation is not sufficient evidence of a completed booking or payment.

The **Pilot outcomes** view presents the original pilot and its derived observations. Inspect the saved baseline and original references. Pause or close with a reason when the team stops the operation; the original cohort and observed history remain retained.

## Contact and suppression

The desk records contact history; it does not transmit messages. Select the original user, retain the actual source reference and use the observed outcome. Do not enter future or assumed contact as completed.

Suppress a user ID, exact email domain or company key with the original request/reference and a clear reason. The queue is recalculated from the retained current records. Imported dated suppressions may include an expiry; the source should explain that expiry.

## Billing and outcome interpretation

Current official Arrangr team pricing describes mixed Basic and Pro membership, centralized billing and active-user charges. The desk retains actual subscription and payment observations so the operator can reconcile the applicable billing period without assigning revenue to every active product user.

Maintain each currency independently. Recurring observations and collected net payments answer different questions. A subscription becoming active does not prove that its invoice was paid. A receipt does not establish that the pilot caused the purchase. Use the original source references and the saved baseline when reviewing results.

## Analysis rules

Rules include the baseline instant, active and reactivation windows, contact cooldown, minimum active-member count and explicit reviewed company overrides. Changes recalculate the current queue while prepared pilots retain their saved basis. Use a current observation time when receiving new evidence.

The full operation journal is preserved in the workspace. The interface pages through the complete journal and exposes each original operation. The complete download retains the same entries.

## Handover

Keep the standalone application, complete source package, source mappings and latest complete workspace together. Record the last accepted revision and original input source names. Reopen the downloaded workspace, confirm the original pilot and source counts, then continue on that edition. Exported company-queue CSV is a convenience view, not the complete working record.

## Public product sources

Checked 13 October 2026:

- https://get.arrangr.com/teams_smbs/ — current organization, admin, mixed-plan and active-member offer.
- https://get.arrangr.com/pricing-and-plans/ — current published plan comparison.
- https://arrangr.freshdesk.com/support/solutions/articles/47001248634-set-up-your-account — original product setup guide; current-source research retained by the original project owner.
- https://arrangr.freshdesk.com/support/solutions/articles/47001248636-your-arrangr-dashboard — original dashboard guide.
- https://arrangr.freshdesk.com/support/solutions/articles/47001248641-booking-pages-overview — original booking-page guide.

The precise source schema for this desk is in the accompanying data contract. Configure the actual installation around the original product exports and event meanings.
