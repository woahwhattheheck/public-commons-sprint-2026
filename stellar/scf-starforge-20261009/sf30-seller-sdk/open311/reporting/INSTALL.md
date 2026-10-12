# Install and operate Open311 service-performance reporting

This product turns complete Open311 source collections into saved service reports. It carries the collection's original responses, window coverage, source versions and internal reviews into an independent reporting workspace. Operators save their own service mappings, calendars, targets and reporting periods, inspect each calculated result, compare reports, and exchange selected reviewer comments.

The installed selection includes both **Open311 municipal service operations** and **Open311 service performance** in merchant Applications. The acquisition workspace and reporting workspace use separate directories and SQLite files. A complete collection export is the explicit handover between them.

## Runtime and package

Use Node.js 22.16 or newer for the complete installed merchant package. Direct reporting modules require Node.js 22.13 or newer with built-in SQLite support. Start the commands from an exact source checkout or from the installed merchant package. The reporting component adds no external database, subscription or hosted compute.

The maintained source selection is `open311-reporting`. Build it from the repository revision you intend to install:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo . \
  --ref EXACT_SOURCE_COMMIT \
  --selection open311-reporting \
  --out /absolute/new/open311-reporting-package \
  --offline
```

Choose a new output directory. The selection includes the original Open311 operations contribution, the independent reporting contribution, the maintained merchant host, and the source components required by those applications. The generated product uses the existing `starforge` command. In an installed environment, its reporting command is `starforge open311-reporting`; its source-acquisition command is `starforge open311`.

The examples below use the direct source entrypoint so every path is explicit:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting/cli.mjs --help
```

The package exports the reporting SDK as `@tokenjunkielabs/starforge-merchant/seller/open311-reporting` and its workspace API as `@tokenjunkielabs/starforge-merchant/seller/open311-reporting/workspace`.

## Bring a complete source collection into reporting

First finish or pause the desired source collection in the municipal operations workspace. Review its selected period, captured windows and any unresolved response-cap intervals. From **Source collections**, download the complete collection JSON, or use:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/cli.mjs export \
  --workspace /absolute/private/municipal-operations \
  --collection COLLECTION_ID \
  --kind json \
  --out /absolute/handover/municipal-collection.json
```

The input is the complete `commons.open311.collection-export.v1` envelope. Keep that file unchanged. It contains the saved plan, every retained original capture, occurrence and source version, consolidated request selection, coverage summary and source operations. The reporting importer saves the original text and its content hash along with the parsed input.

Initialize a separate reporting workspace, then import the collection:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting/cli.mjs init \
  --workspace /absolute/private/municipal-reporting

node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting/cli.mjs state \
  --workspace /absolute/private/municipal-reporting

node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting/cli.mjs import \
  --workspace /absolute/private/municipal-reporting \
  --file /absolute/handover/municipal-collection.json \
  --request-id municipal-source-intake-001 \
  --expected-revision 0
```

Use revision 0 only for a newly initialized empty workspace. For later mutations, read its current state and submit that exact revision. A saved request ID belongs to one complete input. If its response is lost, look up the operation and repeat the same ID, revision and input; prepare a new ID only for a new intended action.

You may import more than one complete collection. Reporting retains each source identity and each observed edition. Report definitions explicitly select the source IDs used for that report.

## Open the operator interface

Start the initialized reporting workspace:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting/cli.mjs serve \
  --workspace /absolute/private/municipal-reporting \
  --host 127.0.0.1 \
  --port 0
```

Open the private URL printed in the single JSON startup line. The server establishes the same-origin browser session when it serves the start page.

In merchant **Applications**, choose **Open311 service performance** and select the initialized reporting directory. The launcher reads the original `open311-reporting.sqlite` identity, starts the reporting command, and matches its live workspace ID, private directory binding and server instance. This keeps the opened application attached to the selected reporting workspace across ordinary merchant operations.

The browser workflow is:

1. **Sources:** import complete collection files and inspect their saved source identity and coverage.
2. **Rules:** save a named profile with a provider interpretation, exact source/status mappings, operator calendars and target policies.
3. **Build reports:** select source collections, a saved profile revision, an explicit reporting period and an as-of instant.
4. **Reports:** inspect totals, groups, individual source editions, calculated targets, calculation issues and management commentary; compare two saved reports.
5. **Reviewer returns:** import a returned review package, select the comments to apply and explicitly choose any report rebase.
6. **Workspace:** export the complete reporting workspace or receive a complete package into an initialized empty destination.

The browser retains the original mutation input before submitting it. Its recovery panel can inspect a saved operation, retry the exact original command and download that command for a later browser session. A revision conflict leaves the original command available while the operator prepares a corrected action against the current workspace.

## Save service rules and targets

A profile has its own ID and revision. Save a new revision when changing an existing operational policy so reports remain tied to the exact rules used to build them.

The basic editor covers:

- Source grouping rules with exact service, agency, status or request selectors.
- Display labels for original provider statuses.
- Named working calendars, weekly intervals, date overrides, time zone and daylight-saving disambiguation.
- Elapsed-time or business-time targets, their originating event and completion event.
- A separately configured interpretation of internal date-only review deadlines.
- Operator references and management notes.

The advanced JSON editor preserves the full profile structure for configurations that need more detailed selectors. Empty selectors are explicit rules covering all selected requests; give those rules a clear name and operator reference. Matching rules with equal priority are calculation issues to resolve, rather than an implicit choice of one rule.

Calendar hours, target durations and local deadlines are operator policies. Preserve their names, revisions and references. Use the source provider's documented semantics for source dates and statuses. In particular, Helsinki's latest-update time remains an update time and its native status remains visible beside any reporting label.

The source API can save the same complete profile file:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting/cli.mjs profile \
  --workspace /absolute/private/municipal-reporting \
  --file /absolute/handover/service-profile.json \
  --request-id municipal-profile-001 \
  --expected-revision CURRENT_REVISION
```

Use the profile and report schemas in [README.md](./README.md) when creating files directly. The browser exports its full profile draft so its named settings can be inspected and saved through the same CLI.

## Build and compare reports

Each definition selects source IDs, an exact profile revision, a start-inclusive/end-exclusive requested-date period, an as-of instant, display time zone, target basis and optional group/status/review/assignee filters. Use ISO timestamps with explicit offsets for period boundaries and the as-of instant. The browser shows these values before saving a report.

Build from the complete definition file:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting/cli.mjs build \
  --workspace /absolute/private/municipal-reporting \
  --file /absolute/handover/report-definition.json \
  --request-id municipal-report-001 \
  --expected-revision CURRENT_REVISION
```

Saved reports keep the original selected rows, source version hashes, target calculations, issues, coverage and commentary. Their source view shows the capture and source selection used for each case. Review an unresolved cap interval or unavailable source date in that context.

Use a stable series ID for related reporting periods. Compare two saved reports by their IDs:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting/cli.mjs compare \
  --workspace /absolute/private/municipal-reporting \
  --before EARLIER_REPORT_ID \
  --after LATER_REPORT_ID
```

The definition and profile revision remain available beside the comparison. A difference in source selection, provider interpretation or target rules affects how the two periods should be read.

## Export reports and exchange reviewer comments

Export a saved report in HTML, CSV or complete JSON. The HTML report is suitable for printing or sharing. A JSON report package preserves the complete reporting workspace with the selected report ID, so the receiver gets its original sources, profile editions, report history and reviewer returns together.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting/cli.mjs export \
  --workspace /absolute/private/municipal-reporting \
  --report REPORT_ID \
  --kind html \
  --out /absolute/handover/service-report.html

node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting/cli.mjs export \
  --workspace /absolute/private/municipal-reporting \
  --report REPORT_ID \
  --kind review \
  --out /absolute/handover/service-review.json
```

A review package names its base report and hash. It carries report comments and request comments; request comments identify the exact source key and source version. Give each returned change its own ID and identify the reviewer. The recipient imports the original returned file, inspects the changes and chooses the change IDs to apply.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting/cli.mjs review-import \
  --workspace /absolute/private/municipal-reporting \
  --file /absolute/handover/service-review-return.json \
  --request-id municipal-review-intake-001 \
  --expected-revision CURRENT_REVISION

node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting/cli.mjs review-apply \
  --workspace /absolute/private/municipal-reporting \
  --file /absolute/handover/review-selection.json \
  --request-id municipal-review-apply-001 \
  --expected-revision CURRENT_REVISION
```

The selection contains `reviewId`, `changeIds` and, when explicitly chosen, `rebaseToReportId`. The browser constructs this selection from the displayed return. Saved report comments and request comments retain their reviewer history.

## Transfer and reopen the complete reporting workspace

Export the full package after the last saved change:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting/cli.mjs export \
  --workspace /absolute/private/municipal-reporting \
  --kind workspace \
  --out /absolute/handover/municipal-reporting-workspace.json

node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting/cli.mjs receive \
  --workspace /absolute/private/received-municipal-reporting \
  --file /absolute/handover/municipal-reporting-workspace.json
```

Choose an empty destination. The complete reporting package carries imported original source text, profiles, saved reports and reviewer returns. Open the received directory with the same `serve` command or choose it in merchant Applications.

For browser receiving, initialize an empty destination, open its reporting interface and select **Workspace → Receive complete workspace**. The import uses that destination's current revision and retains the original receive command. The initialized destination keeps its own workspace identity. Its source records, profiles, reports and reviewer returns come from the received package, and the original workspace identity and operations remain recorded in its receiving history.

Retain the original collection workspace separately when continuing civic-source acquisition. Each subsequent complete collection export is a new explicit reporting intake; existing reports remain tied to their saved inputs.

## Recover a command

Find a saved operation by the request ID already printed or retained:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting/cli.mjs operation \
  --workspace /absolute/private/municipal-reporting \
  --request-id municipal-report-001
```

A successful saved result resolves an uncertain response. If no operation exists, repeat the original command with its original file bytes, request ID and expected revision. If the workspace changed in the meantime, inspect the current state and explicitly prepare the next intended action with a new request ID.

See [README.md](./README.md) for the complete reporting model and [../COLLECTIONS.md](../COLLECTIONS.md) for source acquisition, overlapping windows and original response receiving.
