# Berkeley ServiceNow RFP 27-11797-C: offline CMDB / ITAM acceptance

A dependency-free, MIT-licensed Node 22 utility for comparing **two operator-authorized** pre/post-change CMDB asset exports. The CLI produces a deterministic audit JSON and spreadsheet-safe CSV discrepancies. It is a vendor-neutral acceptance aid under a potential certified ServiceNow prime contract, not a ServiceNow integration or municipal deployment.

## Original purchasing requirement

The [City of Berkeley's original 24-page RFP](https://berkeleyca.gov/sites/default/files/RFP-27-11797-C-SnowProfessionalServices_0.pdf) Sections 2.1–2.2 explicitly require CMDB/ITAM, endpoint asset interfaces (Microsoft Intune and SolarWinds), platform upgrades, annual major-release regression and integration testing, remediation and post-upgrade handoff. The [current City solicitation](https://berkeleyca.gov/doing-business/working-city/bid-proposal-opportunities/servicenow-professional-services) is due November 20, 2026 at 2 PM Pacific. An appropriately certified ServiceNow Partner must prime the RFP; this narrowly scoped tool does not meet that qualification on its own.

## Real local command

Requires Node 22; no database, credentials, packages, hosted GitHub Actions or network activity.

    node cmdb_qa.mjs --source before.csv --target after.csv --out ./private-evidence

Optional restricted field scope, if a prime-approved schema uses a subset:

    node cmdb_qa.mjs --source before.csv --target after.csv --out ./private-evidence --fields name,assigned_to,install_status

Default required header:

    sys_id,name,sys_class_name,assigned_to,install_status,serial_number,location

Both CSVs must include an identical named stable key column (sys_id) and selected comparison columns. The parser accepts quoted embedded commas, doubled quotes, line breaks, UTF-8 BOM, CRLF and out-of-order columns. It rejects duplicate/blank keys, malformed rows, missing required columns, invalid quotes, control-character keys, files over 16 MiB or over 100,000 records. These conservative acceptance limits are intentionally **not** a promise about a live City dataset's size.

Output: private-evidence/audit.json and private-evidence/discrepancies.csv. The audit provides source and target SHA-256, input counts, sorted record additions/removals/changed fields, severity, and hashed values. A source/target pair with no changes reports PASS; any changed record reports REVIEW_REQUIRED for prime human disposition. Spreadsheet export escapes formula-like identifier cells and hashes comparison values by default. Stable inputs produce identical output bytes with no hidden date or random seed.

Exit codes: 0 for PASS, 1 for REVIEW_REQUIRED, 2 for rejected malformed input or invocation. Client operators must not confuse approved business changes with errors; every finding needs an explicit human signoff or action.

## Focused acceptance check

    node --test cmdb_qa.test.mjs

The one local focused Node 22 regression passed using independent test-authored asset rows. It checks UTF-8 BOM/escaped/embedded-linebreak handling, duplicate/header/schema fail-closed behavior, added/removed/changed records, critical severity, deterministic reruns, absence of raw owner values, output filename and exit statuses. The exact source blobs in this public branch match the locally executed files:
- cmdb_qa.mjs Git blob 2186ed145d7f9a50bd3066c3c33d1e7fbad453b0.
- cmdb_qa.test.mjs Git blob 03cc3fd0c8002ea6aca79d9b5abaf1e3183a806e.

## Paid acceptance scope after actual prime authorization

A certified, adequately insured partner holds all platform, City procurement, credentials and customer-data responsibility. A paid specialist can supply the partner-approved field mapping and stable asset-key manifest, before/after export hashes, validated reconciliation/discrepancy register, signed disposition and rollback/go-no-go report, plus a reproducible rerun packet. A 40–60-hour initial inventory/risk phase is merely **internal exploratory effort**, not a promised price, certified consultant availability, current City contract, partnership, subaward or actual supplier bid intent. No procurement contact, payment, source data access or commitment has been made.

## Security and fit limitations

Run only with contractually authorized exports on the prime/customer's controlled equipment. Real reports retain record keys, and SHA-256 hashes of low-entropy values are not encryption or formal anonymization. Do not post customer CSVs, findings or audit JSON to GitHub, Slack or public CI. Output files are created with restrictive first-write mode; check shared-file ACLs independently. There is no direct ServiceNow authentication, data transfer, writeback, live role/SSO authorization check, license proof, procurement representation, or City result.

For the issuer's contract, historical incumbent partner evidence and business qualification gates, see [internal verified Berkeley buyer→prime research](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C82MME2F7). It treats prior City Alcor contracts as past history, not proof of current bidding or budget.
