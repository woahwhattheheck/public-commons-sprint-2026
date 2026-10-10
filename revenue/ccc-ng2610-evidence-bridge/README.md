# CCC NG2610 W3 — Offline ServiceNow, AWS CloudWatch and Jira evidence bridge

A real-source-format adapter for the original accepted City Colleges Chicago NG2610 Python scorer, source at https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C7SK9AGKH . This is NOT a competing SLA scorer, paid vendor connector, real City acceptance result or customer SLA certificate. No network dependencies, credentials, accounts or buyer datasets are embedded.

## Official vendor response contracts

- ServiceNow Table API https://www.servicenow.com/docs/r/xanadu/api-reference/rest-apis/c_TableAPI.html supports GET /api/now/table/incident and /change_request; each complete export contains a JSON result array. Tenant-specific field names, priority/outcome codes, pagination and timestamps are explicitly mapped, never guessed. UTC offset is mandatory.
- AWS CloudWatch GetMetricData https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_GetMetricData.html and https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_MetricDataResult.html return MetricDataResults records with Id, StatusCode, numeric Unix-second Timestamps and Values. Incomplete NextToken and statuses other than Complete are rejected; explicitly expected missing samples are reported even if AWS calls the response Complete.
- Jira Cloud issue search https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/ exposes issues arrays with issue key and tenant-defined custom fields. The partner maps the approved custom field containing a ServiceNow change ID; Jira ticket status does not establish contractual change success.

## Local operator steps

Node 22; no dependencies. Supply FOUR authorized, complete JSON snapshots (ServiceNow incidents, ServiceNow change_request, Jira issues, CloudWatch MetricData) and a separate partner-approved map.json. NEVER upload real exports or tokens to public repos.

Mapping JSON must contain schema_version 1; source_authorized true and an actual authorization_reference; incident_fields mapping all 7 original scorer columns (incident_id, priority, opened_at, investigation_at, outage_start_at, outage_end_at, approved_maintenance) to tenant field paths; explicit priority_values (e.g. 1 -> P1); change_fields mapping change_id, completed_at, outcome; explicit change_outcomes (e.g. successful -> success); jira.change_link_field from the approved tenant such as fields.customfield_XXXXX; cloudwatch_series entries with id, start and end ISO timestamps and period_seconds derived from the actual original AWS query. The authorization flag records operator assertion only; it does not grant permission or fetch data.

Example commands:

    node bridge.mjs --month 2026-09 --incident-json incident.table.json --change-json change_request.table.json --jira-json jira.issues.json --cloudwatch-json aws.metric.json --mapping map.json --out-dir private-output
    python sla_evidence.py --month 2026-09 --incidents private-output/incidents.csv --changes private-output/changes.csv --out private-output/scorer.json

Outputs: incidents.csv and changes.csv match the original scorer headers; manifest.json records SHA256 of original source/normalized output, counts, CloudWatch observed-vs-expected sample coverage, Jira link coverage, and exception codes. Field admission is restricted to explicit paths; safe record IDs and mandatory UTC-normalized timestamps, file mode 0600; no raw issue description, address, hostname or personal details copied to the manifest.

Original scorer incident-derived 99.99% monthly uptime estimate is NOT independently reconciled with metric semantics just because AWS data exists. The authorized prime must validate chosen CloudWatch metric, data completeness and exported pages, maintenance/disputed intervals, Jira workflow policy and contractual signoff. This module does no network access, purchases, government bids, SCF submissions or outbound contacts.

Focused test: node --test bridge.test.mjs. Tests use expressly marked local samples that follow the first-party vendor envelope shapes; never call them buyer records. Broad current-source runs belong to Muse or existing authorized operator using genuinely permissioned vendor exports. No GitHub Actions.
