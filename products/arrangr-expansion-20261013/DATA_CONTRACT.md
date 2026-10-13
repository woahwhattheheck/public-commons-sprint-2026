# Original data contract

Schema: `tjlabs.arrangr-expansion/v1`. Preserve original IDs; do not replace them with row numbers or names. Timestamps should be ISO 8601 with an explicit timezone. Monetary fields contain integer minor units in a three-letter currency. A user's permission is `allowed`, `suppressed` or `unknown`; absence defaults to unknown.

| Table | Required original fields | Optional/context fields |
|---|---|---|
| users | id, email, created_at | email_verified (defaults false), name, status (active/deleted/suspended), organization_id, marketing_permission, deleted_at |
| organizations | id, domains (array, JSON array text or semicolon-separated exact business domains) | name, status (active/inactive) |
| events | id, type, at, source_ref; user_id or organization_id | pilot_id, original event details |
| subscriptions | id (snapshot ID), subscription_id, status, currency, monthly_recurring_minor, observed_at, source_ref; user_id or organization_id | original invoice/plan/period fields |
| payments | id, kind, currency, net_amount_minor, paid_at, source_ref; user_id or organization_id | subscription_id, original invoice/period fields |
| touches | id, user_id, channel, outcome, at, source_ref | company_key, note |
| suppressions | id, scope, key, reason, at, source_ref | until_at |

Empty tables are valid. An absent invoice/payment feed is reported as missing, not as observed zero revenue. All nonempty user or organization references must resolve in the corresponding imported table. Full JSON reopening enforces canonical types: the string "false" cannot silently become a truthy verification flag.

## Sources and corrections

Every imported file retains its original text, headers, records, mapping, normalized rows and change list. Append rejects a changed record under an existing row ID. Upsert records both old and new rows before replacing that current row. Neither mode deletes an unmentioned row. Use actual status/deletion snapshots to describe deletion.

A subscription ID may have successive snapshot IDs. Analysis chooses the latest observed snapshot at the requested time. Only active snapshots contribute recurring revenue; trialing, past_due and cancelled do not. Conflicting snapshots at the same subscription/time are rejected. Supply the source's actual normalized monthly recurring amount; conversion from annual invoices belongs in a documented customer-specific source mapping. Refund amounts are negative; payment amounts are nonnegative. Currencies are never summed together.

Organization-owned billing takes its explicit organization owner. User-owned billing follows the original user. Pilot billing uses the retained original cohort and explicit pilot-associated organizations, not every company a cohort member later joins.

## Event vocabulary

These are names in this workspace's adapter contract. They are not a claim that Arrangr exposes a public event API.

| Event type | Source observation | Use |
|---|---|---|
| meeting_created | An original scheduling meeting record was created | Recent product usage |
| poll_created | An original scheduling poll was created | Recent product usage |
| booking_received | A booking request was received | Recent product usage |
| meeting_confirmed | An Arrangr meeting became confirmed | Product usage and qualifying confirmed activity |
| booking_confirmed | An Arrangr booking became confirmed | Product usage and qualifying confirmed activity |
| meeting_completed | A confirmed Arrangr meeting completed | Product usage and qualifying confirmed activity |
| offer_exposed | The original member saw the specified pilot offer | Pilot exposure; requires matching pilot_id |
| team_created | The actual team organization was created | Pilot association; requires pilot_id and organization_id |
| team_invite_sent | The native invitation was sent | Retained event history |
| team_invite_accepted | The original member accepted membership in the team | Accepted cohort member; matching pilot_id and organization_id, after creation |

Use actual native invitation, booking and admin observations. A linked-calendar overlay appointment is not an Arrangr meeting. A proposed slot in Suggest & Confirm is not confirmed. Import any additional original event types unchanged; they remain in history and do not affect the listed activity metrics.

## Pilot identity and attribution

Preparing a pilot freezes its member IDs, label, champion, baseline recurring amounts, current organizations and observation time. Later events may refer to that exact pilot ID. Team activation needs at least two original members with both accepted membership and subsequent confirmed activity in the same explicitly associated organization. Confirmation from one member and acceptance by a different member cannot combine into activation.

Results retain associated organization IDs, original payment/event IDs and an `association_review` list for later unrelated membership changes. Amounts represent observed cohort/associated-organization outcomes; the result does not imply causal lift, and organization charges may include additional seats.

## Contact and pilot lifecycle

Verified active users with allowed permission can be candidate champions. Suppression records apply by exact user, domain or company. Deleted/suspended users, unknown permissions, hard bounces, opt-outs and recent touches constrain eligibility. Positive replies/meeting requests require the responsible owner to continue. Record the actual original message identity in source_ref.

Only one nonclosed pilot per original company key is allowed. Closing is terminal. A new cohort has its own operation ID and baseline. A retained source or operation ID cannot be reused with a changed payload.

## Original import example

```json
{
 "columns":{"id":"account_id","email":"work_email","email_verified":"verified","created_at":"joined_at","deleted_at":"deleted_at"},
 "defaults":{"status":"active","marketing_permission":"unknown"},
 "mode":"upsert"
}
```

Defaults must reflect the actual source definition. Do not change permission to allowed or verification to true merely to increase the eligible queue.
