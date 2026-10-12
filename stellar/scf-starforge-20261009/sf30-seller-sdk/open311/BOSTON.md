# Boston 311 operations and service reporting

The Boston preset connects the municipal desk, collection runner, installed merchant tools and service-reporting workbench to the original BOS:311 API. Operators can collect a fixed creation period or a fixed update period, inspect every original page, review individual source editions, prepare management reports, and deliver both editable workspaces to another operator.

## Source contract

The [BOS:311 addendum](https://311.boston.gov/open311/docs) documents page/per_page traversal, a maximum of 300 results per page, a public allowance of 10 requests per minute, optional Bearer API keys, updated_after/updated_before filters and date ranges of at most 90 days. It also describes optional extension fields and warns that record updates can have several causes.

The [GeoReport v2 specification](https://wiki.open311.org/GeoReport_v2/) defines creation and modification timestamps. For a closed case, updated_datetime represents case closure. The retained status_notes and notes explain the source disposition. A closure can concern a referral, replacement case, citation or work completed; keep those original reasons beside the status.

The connection in [examples/boston.commission.json](examples/boston.commission.json) supplies the exact public endpoint, provider parameter names, status values, date-range contract and six-second request spacing. It omits an API key. To use an existing key, add apiKeyEnv with the name of its host environment variable. The selected Bearer transport sends that value in the Authorization header for the configured API origin/path. The saved connection carries the environment reference.

Provider pacing is shared by clients in one process. Additional processes and hosts must share the provider's actual allowance. A 429 retains the response and Retry-After; the saved collection records its earliest retry time. A completed interrupted run resumes through a new run request after that time. An uncertain original response is recovered using its original request ID and inputs.

## Open a Boston desk

Use the combined open311-reporting package and its [installation guide](reporting/INSTALL.md) for an installed merchant. It includes the municipal desk, reporting desk and maintained Applications launcher.

The following source commands run from sf30-seller-sdk. Use a private directory appropriate to the installation. State initializes a new municipal workspace.

~~~sh
node open311/cli.mjs state --workspace /private/boston-operations

node open311/cli.mjs connection-put \
  --workspace /private/boston-operations \
  --file open311/examples/boston.commission.json \
  --request-id boston-source-01 --expected-revision 0

node open311/cli.mjs capture \
  --workspace /private/boston-operations \
  --connection boston --kind services \
  --request-id boston-catalogue-01 --expected-revision 1

node open311/cli.mjs serve \
  --workspace /private/boston-operations --port 0
~~~

The browser's connection editor accepts the same preset. Its collection form presents the selected time basis, window/page traversal and provider page size. Source status, original disposition and internal review are visible separately.

## Collect a fixed creation period

[The created-case example](examples/boston-created-collection.json) selects 8 October 2026, 08:00–12:00 UTC, with 300 results per page. Select the actual operating dates in a new file.

~~~sh
node open311/cli.mjs collection-plan \
  --workspace /private/boston-operations \
  --file open311/examples/boston-created-collection.json

node open311/cli.mjs collection-create \
  --workspace /private/boston-operations \
  --file open311/examples/boston-created-collection.json \
  --request-id boston-created-plan-01 --expected-revision 2 \
  --out /private/boston-created-plan-result.json
~~~

The result supplies the saved collection ID and current revision. Use them in collection-run with a new stable request ID. Every source page has its own retained operation and raw response. A full page advances to the next page at the same date bounds; a short page finishes that interval. A repeated identical capped response is retained as a LIMITED page for review. A date selection longer than 90 days is partitioned into legal initial intervals.

~~~sh
node open311/cli.mjs collection-run \
  --workspace /private/boston-operations \
  --id SAVED_COLLECTION_ID \
  --request-id boston-created-run-01 --expected-revision SAVED_REVISION \
  --out /private/boston-created-run-result.json

node open311/cli.mjs collection-info \
  --workspace /private/boston-operations \
  --id SAVED_COLLECTION_ID --limit 100

node open311/cli.mjs export \
  --workspace /private/boston-operations \
  --kind json --collection SAVED_COLLECTION_ID \
  --out /private/boston-created-collection.json
~~~

Follow collection-info nextOffset until null for a full inventory. The complete JSON includes every original page, source version, observation, review and collection operation. Source data can change during a page walk; each observation retains its own capture time and the worklist selects the latest observed edition.

For a window-based traversal, choose strategy windows or omit strategy. Capped date windows are divided using the recorded precision and overlap settings. Legacy plans continue to use created time and window refinement when the new choices are absent.

## Collect changed records

[The updated-case example](examples/boston-updated-collection.json) uses timeBasis updated with a fixed updated_after/updated_before interval. Run the same plan/create/run/export commands with that file and new request IDs.

An updated feed describes the cases returned by its exact update filters. It can contain cases created before that update period. Optional start_date/end_date remain additional fixed source filters; they are distinct from the advancing update interval. Preserve those filters when tracking a known creation cohort. When they are absent, retain the provider's original selection and any default creation-window behavior in the interpretation.

An empty returned page completes a no-change observation for that selected interval. A later observation or overlapping interval is another saved collection. Original versions and reviews remain available when a case changes.

## Build a management edition

Import the complete created collection into a separate reporting workspace and save [the Boston review profile](reporting/examples/boston-case-review-profile.json).

~~~sh
node open311/reporting/cli.mjs init --workspace /private/boston-reporting

node open311/reporting/cli.mjs import \
  --workspace /private/boston-reporting \
  --file /private/boston-created-collection.json \
  --request-id boston-report-source-01 --expected-revision 0

node open311/reporting/cli.mjs profile \
  --workspace /private/boston-reporting \
  --file open311/reporting/examples/boston-case-review-profile.json \
  --request-id boston-report-profile-01 --expected-revision 1

node open311/reporting/cli.mjs serve \
  --workspace /private/boston-reporting --port 0
~~~

The example uses three explicit internal service groups, America/New_York working hours, and a TJLabs four-working-hour review target. Select the calendar, holidays, origin and target that apply to the receiving team. Source expected_datetime is retained independently. If it is absent, the source-target denominator excludes that case.

Reports use a fixed creation period and observation cutoff. Import additional collections to compare original observations, including changed-record feeds. Each source selection displays its time basis and exact filters, and the report explains the population represented by an updated feed.

Management HTML and CSV carry source status notes and valid case-closure time. The legacy resolutionMinutes data field is displayed as source case-closure duration. Internal review completion and the selected operator target have their own events.

The browser supports report comparisons, source-linked reviewer templates, selected return incorporation, and explicit rebase when an original source edition changed. Export HTML, CSV, JSON and the complete reporting workspace from the same saved edition.

## Deliver and continue

Export the whole municipal workspace to carry its connections, captures, collections, reviews and operations:

~~~sh
node open311/cli.mjs export \
  --workspace /private/boston-operations --kind workspace \
  --out /private/boston-operations-workspace.json

node open311/cli.mjs receive \
  --workspace /private/boston-received \
  --file /private/boston-operations-workspace.json \
  --request-id boston-receive-01 --expected-revision 0
~~~

Export and receive the reporting workspace through the corresponding reporting commands or browser. Select each received directory in Applications, Review/Save its restored identity, and Start/Open it. The original source inventory and editable management editions remain available to the receiving operator.

The [merchant guide](MCP.md) documents the complete typed SDK and four collection tools. They accept these same source profiles and saved policies, preserve exact operation recovery, and deliver complete retained files.
