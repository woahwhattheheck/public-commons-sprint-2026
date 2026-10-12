# Recurring economic briefings

Save the selection from a reviewed FRED analyst report as a calendar template. Apply it to a later retained capture, inspect the original periods and source changes, then save the next report through the same project. A successor retains its own original review, complete analyst report, selected predecessor, and template.

This workflow supports recurring economic commentary, management reports, and customer editions that use the same series and calculation choices. The [analyst briefing guide](BRIEFINGS.md) covers initial authoring and the existing merchant/customer flow.

## Create a calendar template

Use the original project's Editions & review workflow to retain a source capture and save an analyst briefing. Choose the original series, comparisons, relative-percent choices, decimal precision, title, and notes there. Templates retain those reviewed choices together with each series' units, frequency, seasonal adjustment, source mode, and information basis.

A calendar policy has three fields:

| Field | Meaning |
| --- | --- |
| `months` | Complete calendar months in each report window, from 1 to 1,200 |
| `anchor` | `latest_all` uses the earliest of the latest recorded observation dates across the selected series; `latest_any` uses their latest recorded date |
| `lagMonths` | Trailing calendar months to omit after choosing the anchor, from 0 to 1,200 |

Selected series determine the anchor. Missing observation markers retain their original dates and participate in it. Every chosen series must exist in the new source with at least one recorded observation.

A quarterly observation's date labels its original source period. A quarterly date of July 1 is used as July in the calendar window. The coverage table exposes each series' own latest recorded date and whether its latest source value is missing.

By default, the number of months spans the initial report's start and end calendar months, up to 1,200. The default anchor is `latest_all`, with zero trailing months omitted. A template uses complete calendar boundaries even when its originating report started or ended partway through a month.

The supplied [calendar policy](examples/briefing-template-window.json) selects twelve months through the earliest latest recorded month.

## Use the installed package

The existing installed `fred` command opens this workflow from the same merchant package:

```sh
npx --no-install starforge registrations --source fred
npx --no-install starforge fred --help
npx --no-install starforge fred templates --project /absolute/private/economic-project
```

Keep the private economic project outside the installed package directory. Reopen its existing Applications workspace or the same `fred serve` command after upgrading the package. Source capture, selected review, native payment configuration, and customer receiving stay with that project.

Applications can call the original project API or use the pure typed template and report interfaces:

```js
import {
  listFredBriefingTemplates,
  previewFredBriefingSuccessor,
  saveFredBriefingSuccessor,
} from '@tokenjunkielabs/starforge-merchant/seller/fred/project';

import {
  createFredBriefingTemplate,
  materializeFredBriefingTemplate,
  compareFredBriefingSuccessor,
} from '@tokenjunkielabs/starforge-merchant/seller/fred/briefing/templates';

import {
  renderFredBriefingSuccessor,
  fredBriefingSuccessorCsv,
} from '@tokenjunkielabs/starforge-merchant/seller/fred/briefing/template-report';
```

The existing `fred` contribution registers these exports and preserves its original command and Applications provider. Type declarations and this guide travel beside the original source. Inside the installed package, the guide is `source/stellar/scf-starforge-20261009/sf30-seller-sdk/fred/TEMPLATES.md`.

## Native command workflow

Use the project's current revision for every mutation. Uppercase values below come from the original project or the preceding command.

```sh
starforge fred show --project /absolute/private/economic-project

starforge fred template-save \
  --project /absolute/private/economic-project \
  --id monthly-template --expected-revision CURRENT_REVISION \
  --review SAVED_REVIEW_SHA \
  --name "Monthly economic briefing" \
  --window /absolute/commons/stellar/scf-starforge-20261009/sf30-seller-sdk/fred/examples/briefing-template-window.json

starforge fred templates --project /absolute/private/economic-project
```

The saved template has an immutable `fred-template-…` identity. To change its series or calculations, save a new original briefing review and create a new template from that review. `--previous-template TEMPLATE_ID` records the earlier template while retaining both versions.

Acquire the next source through the existing configured FRED capture operation, or import a later complete original capture with the existing `import` command. The template applies to the retained capture selected by its capture ID.

```sh
starforge fred successor-preview \
  --project /absolute/private/economic-project \
  --template TEMPLATE_ID --capture NEW_CAPTURE_SHA
```

The preview shows the calendar window, per-series coverage, source meaning changes, original briefing measures, and changes against the original template review. `--anchor YYYY-MM-DD` selects an explicit observation-date anchor; the report also retains the independently observed anchor. `--note /absolute/private/report-note.txt` binds the operator's review note to the successor preview.

For a later report in an existing chain, select the saved preceding successor:

```sh
starforge fred successor-preview \
  --project /absolute/private/economic-project \
  --template TEMPLATE_ID --capture NEW_CAPTURE_SHA \
  --previous-successor PREVIOUS_SUCCESSOR_ID \
  --note /absolute/private/report-note.txt
```

Use `--baseline-review SAVED_REVIEW_SHA` to choose the template's original review or a saved successor review from the same template. A predecessor successor belongs to that template and binds its original saved review.

The preview returns the identity used by the save operation. Submit the same source, anchor, predecessor and note with that preview identity:

```sh
starforge fred successor-save \
  --project /absolute/private/economic-project \
  --id monthly-report-next --expected-revision CURRENT_REVISION \
  --template TEMPLATE_ID --capture NEW_CAPTURE_SHA \
  --previous-successor PREVIOUS_SUCCESSOR_ID \
  --note /absolute/private/report-note.txt \
  --preview-id PREVIEW_SHA

starforge fred successor \
  --project /absolute/private/economic-project \
  --successor SAVED_SUCCESSOR_ID

starforge fred successor-file \
  --project /absolute/private/economic-project \
  --successor SAVED_SUCCESSOR_ID --format html \
  --out /absolute/delivery/monthly-report-changes.html
```

Use `--offset N --limit N` to page through comparisons, with page sizes from 1 to 500. `--all-comparisons` includes unchanged rows. File downloads use `html`, `csv`, or `json` and create a new destination file.

The direct module command is also available:

```sh
node /absolute/commons/stellar/scf-starforge-20261009/sf30-seller-sdk/fred/briefing/template-cli.mjs --help
```

The installed workspace client and agent use the same project operations. See [the FRED workspace guide](../../../../stellar-forge/mcp-merchant-operator/FRED.md) for its private connection record, agent tools, and full-file transfer interface.

## Read the change report

A comparison joins original measurements by series, observation date, and comparison method. Each row retains both original current observations, both original baselines, source metadata, and calculation states.

| Change | Meaning |
| --- | --- |
| `NEW_PERIOD` | A measurement now appears after the preceding report's displayed interval |
| `EARLIER_PERIOD` | A measurement appears before the preceding displayed interval |
| `ADDED_COMPARISON` | A new measurement key appears inside the preceding interval |
| `LEFT_WINDOW` | A preceding measurement lies outside the new displayed interval |
| `REMOVED_COMPARISON` | A preceding measurement key disappears inside the new interval |
| `REVISED` | An overlapping measurement's original value, missing marker, baseline, meaning, or calculation changed |
| `UNCHANGED` | The overlapping economic and calculation fields agree |

A newly available earlier observation can change a `previous_observation` baseline even when its numeric value repeats the old baseline. That remains a revision: the report preserves the changed baseline date and original source row.

The exact value revision is the new current value minus the preceding current value. The exact change revision is the new absolute period change minus the preceding period change. These deltas are available when original units, frequency and seasonal adjustment agree and the required original values are available.

Source context is recorded separately. A later information date, retrieval window, or real-time validity range can change while the economic value and calculation stay the same. Such rows retain `UNCHANGED` together with their `contextChanges`. `contextChangedCount` counts comparisons with source context changes. The HTML provides a Source context changes view, and the CSV keeps both original information dates and real-time fields.

Original missing values stay explicit. Coverage includes every selected series, including a series with zero observations inside the chosen calendar window. An entirely empty window requires a different selection. The report counts original observations after the selected window, making the effect of a lag or explicit anchor visible.

The downloaded HTML is a complete offline comparison with local series/change filters, source coverage, original-row inspection, full JSON export and full CSV export. The filters wrap to fit a phone screen. Each wide table scrolls within its own region, keeping the report controls and reading text in view.

Use Tab to reach the labelled **Selected source coverage**, **Source meaning and information basis**, or **Period changes** region. The focused region has a visible outline; Left and Right move through its columns. Continue with Tab to a row's **Inspect** button to read its full original source values. Series, change and display filters affect the visible comparison rows. **Download all changes** and **Download complete source comparison** include every comparison page and preserve the complete source context. Original FRED source notices and report files stay attached to the saved analyst reports.

## Continue into the merchant workflow

A successor retains a normal original analyst review and its complete analyst report. Use that saved review's ID in the existing publication command or merchant screen:

```sh
starforge fred publish \
  --project /absolute/private/economic-project \
  --id monthly-report-publication --expected-revision CURRENT_REVISION \
  --review SUCCESSOR_REVIEW_SHA \
  --origin https://your-existing-merchant.example \
  --payment /absolute/private/original-payment.json
```

The publication contains the analyst report assets and original economic dataset. Native customer preparation, payment, recovery, and delivery continue from that publication. Comparison files support the operator's report review and project handover.

Project export and receiving preserve templates and successor lineage alongside the original captures, reviews, reports and publications. Reopen the received project to continue the same reporting chain.

## Implementation and source references

`briefing/templates.mjs` owns the immutable template descriptor, calendar materialization, original-report comparison and compact successor record. `briefing/template-report.mjs` owns complete offline HTML and CSV. `briefing/template-cli.mjs` routes commands through the original project transactions. The original `briefing/model.mjs` calculates every baseline, absolute change and relative percentage.

The [FRED observations API](https://fred.stlouisfed.org/docs/api/fred/series_observations.html) documents values and real-time fields. The [FRED real-time period guide](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html) explains information-date selection. The [FRED vintage-date endpoint](https://fred.stlouisfed.org/docs/api/fred/series_vintagedates.html) describes dates on which a series changed. Public-table captures retain their original retrieval dates and source mode. Publisher attribution remains in the original [FRED API terms](https://fred.stlouisfed.org/docs/api/terms_of_use.html).
