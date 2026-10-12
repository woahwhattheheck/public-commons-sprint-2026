# Work, cost and material by period

The Portfolio archive can include native assignment values for explicit reporting periods. The existing PortfolioWorkspace reopens each selected immutable edition through its original MPXJ recipe. MPXJ calculates the values using that edition's native calendars, assignment rules and resource rates. The archive retains the complete calculation alongside its original project files and reporting tables.

Use this workflow for a completed-project reporting handover, a period-by-period cost/work review or a customer reporting dataset. Keep the selected editions, dates and financial interpretation in the published review. The ordinary project, task, resource and assignment tables remain available with their complete native fields.

## Select the source and periods

Open the original migration desk and choose **Portfolio archive**. Create or open the intended cohort. Select one actual immutable edition for each project, with a stable project key. Read the original field definitions after changing that selection.

Enable **Include native period reporting**. The panel accepts either generated daily, weekly or monthly date periods or individually entered local date/time periods. The date generator fills the explicit period list; it does not change a project calendar or calculate a value. Review that list before saving. A monthly series keeps the original day-of-month anchor and uses the month's last date when that day is absent.

Every period has a unique key, readable label and exact native start/finish bounds. Ranges use the project's original local date/time and must be ordered, nonempty and nonoverlapping in duration. The native boundary rule depends on the operation: duration overlap excludes the finish; instantaneous cost accrual can include both endpoints and selects the first matching range. At adjoining boundaries that can place a cost in the earlier period. These original native results are retained without redistribution. No timezone conversion or assumption that a working day is eight hours is made.

For an actual pro-rata COST resource with nonzero actual cost, MPXJ's selected original method derives a fixed whole-minute stride from the first range. This workflow therefore requires equal-width contiguous ranges with a positive whole-minute stride for the affected COST, ACTUAL_COST and ACTUAL_REGULAR_COST series. Unequal calendar months, gaps and sub-minute intervals are rejected before entering that native method. Select a fixed daily/weekly grid or change the reviewed series selection. The admission also bounds that method's internal alignment/full-assignment walk to 100,000 steps per assignment and two million estimated steps for the selected calculation. Its exact admitted basis is retained. Other supported native paths keep their original range semantics.

For example:

    {
      "key": "2026-10",
      "label": "October 2026",
      "start": "2026-10-01T00:00:00",
      "finish": "2026-11-01T00:00:00"
    }

The native calculation uses these exact boundaries. The original source must contain the intended project schedule and resource/calendar basis for that period. A valid empty period can produce native null values; the application retains that result.

A profile accepts 1–3,660 periods and 1–32 named series. The complete selected cohort is limited to 2,000,000 assignment × period × series facts. A larger reporting request should use a deliberately narrower period/series selection or separate reporting cohorts, each with its own source and review.

## Choose native series

Each series has a unique report name, an actual AssignmentField name, a kind and, for work, an explicit native unit. The selector uses the original field catalogue from the chosen editions. It rejects a kind that conflicts with any selected edition's native definition.

| Kind | Native definition | Calculation and grouping |
| --- | --- | --- |
| work | WORK | Original ResourceAssignment.getTimephasedDurationValues, with selected TimeUnit; unit and elapsed status remain separate. |
| money | CURRENCY | Original ResourceAssignment.getTimephasedNumericValues; native or explicitly reviewed project currency remains part of the group. |
| material | NUMERIC or UNITS | Original numeric period method for an actual material resource; each resource identity and material label remains separate. |

Supported selections include current, actual, remaining, planned and budget work/cost fields where present, regular/overtime variants, and baseline 0–10 work/cost/material and baseline-budget work/cost fields. Material selections include the native MATERIAL, ACTUAL_MATERIAL, REMAINING_MATERIAL and PLANNED_MATERIAL families where present. A name appearing in the source catalogue is still checked against the supported period-method field set.

Work units are MINUTES, HOURS, DAYS, WEEKS, MONTHS and YEARS, plus their ELAPSED_ forms. MPXJ performs the actual requested conversion against the native project settings. Material and money do not take a work-unit setting.

This minimal profile selects exact work and cost series:

    {
      "schema": "portfolio.timephased-profile.v1",
      "periods": [
        {
          "key": "2026-10",
          "label": "October 2026",
          "start": "2026-10-01T00:00:00",
          "finish": "2026-11-01T00:00:00"
        }
      ],
      "series": [
        {"name": "current_work", "field": "WORK", "kind": "work", "units": "HOURS"},
        {"name": "current_cost", "field": "COST", "kind": "money"},
        {"name": "baseline_cost", "field": "BASELINE_COST", "kind": "money"}
      ]
    }

Save it as the cohort profile's **timephased** property. Existing columns, scalar metrics and currency declarations keep their original meaning. See examples/timephased-profile.json and examples/timephased-cohort.json for complete editable inputs.

## Review and publish

Save the cohort through its existing saved-action workflow. Review the exact saved revision. A first native period review requires the selected original MPXJ 16.10.0 runtime and the complete source objects already retained by the PortfolioWorkspace.

The native-project context holds the original runtime lock and reconstructs the original source recipe. It checks the actual assignment/task/resource identities against the retained model. Before a calculation, the original raw timephased source, resource detail/rate basis, field definitions and runtime identity must match that edition. The complete assignment effective calendar is retained even when MPXJ derives a calendar that has no standalone source calendar row. Baseline series use the actual ProjectFile.getBaselineCalendar value, including its native named-calendar/default fallback; that complete definition and source resolution are separately retained. Each series and fact identifies its calendar basis.

Each selected source gets an immutable, bounded JSONL calculation object. Its header binds the edition, model, source objects, recipe, complete period profile and runtime. Ordered assignment/series records retain every native value or null. The final footer records completion and counts. The original operator store publishes the complete object by its content address.

A completed calculation is reused by the original action. If an action loses its reply, reopen its saved request and continue that request. A complete stored calculation never requires a replacement native calculation. An interrupted calculation that has no accepted complete object can be regenerated from the same original edition and profile. No remote target write or project scheduling change is involved.

The review shows the complete assignment/fact counts, capture identities, native errors, table hashes and a bounded preview of period totals. **Open complete period totals**, **Open original assignment values** and **Open calendars and rate basis** page through the original publication tables. The full CSVs and database include every row.

Publish the exact review with the reviewer and a concrete delivery decision. An edited selection, period, series or currency declaration requires a following review. Existing lost-reply, same-request and revision guards remain in effect.

## Interpret the values

The native period facts use **assignment grain**. They link to the actual source task and resource. Task-only fixed costs remain in their task fields and are outside these assignment totals. A scalar task/project measure can be reported separately, with its own grain; do not add it to the assignment total as another contribution to the same sum.

Each fact records one state:

| State | Meaning |
| --- | --- |
| native_value | The original method returned a supported numeric or duration value, retained as exact text with its typed native value. |
| native_null | The original method returned null for that assignment, series and period. |
| not_applicable | The selected dimension does not apply to this actual resource type, such as work for a material resource. |
| native_error | The original method raised an error, retained with its original message and series identity. |
| unsupported_native_value | A returned value cannot be interpreted as the selected supported dimension; its full original representation remains retained. |

Native null is distinct from zero. An all-null total has no invented zero total. Totals include value, null, inapplicable and error counts so the reader can assess completeness. Native errors and unsupported values are visible in the review and retained facts.

Totals use exact decimal addition of original numeric text. Work groups preserve selected units and elapsed true/false. Money groups preserve project currency and its original or explicitly declared source. Unknown currencies remain project-local groups. Material groups retain the actual resource identity as well as its label; two resources with the same displayed unit are not automatically combined.

The raw source spans can use a duration representation for material quantities. Their explicit dimension, resource type, full typed values and separate native material-period calculation preserve that distinction. Raw amount-per-hour and span totals are source evidence, not a second set of period contributions to add to the calculated values.

## Reporting tables and joins

The original relational tables remain complete. A timephased profile adds these tables:

| Table | Complete retained content |
| --- | --- |
| timephased_source_sets | Every original RAW_TIMEPHASED field, definition, state, source pointer and span count. |
| timephased_spans | Every raw span, local bounds, amount per hour, total amount, units, elapsed status and full typed value. |
| resource_rate_entries | Every resource cost-rate table entry and its dated range/cost-per-use. |
| resource_rate_values | Each rate within an entry, with original amount, TimeUnit and source currency. |
| resource_availability | Complete original resource availability intervals and units. |
| calendar_rules | Working week, exceptions, work weeks and native unit-conversion definitions. |
| timephased_captures | Complete calculation-object identity, byte hash, runtime, profile, source binding, baseline calendar and native input admission. |
| timephased_periods | Exact ordered reporting ranges and original overlap/accrual boundary semantics. |
| timephased_series | Named series, native fields/definitions, calculation methods, calendar basis, boundary semantics and assignment grain. |
| timephased_assignment_basis | Actual task/resource links, effective native calendar, selected cost-rate table and resource-rate source identity. |
| timephased_values | Every assignment × series × period value, null or error. |
| timephased_totals | Exact grouped totals and complete state counts. |

Facts join their assignment, basis, period and series by retained IDs. Assignment basis links to actual task/resource entity IDs, with explicit resolution status. Assignment effective and project baseline calendars retain complete native JSON and a source calendar entity when uniquely resolved. Each native series/fact names the applicable basis. Derived native calendars remain usable as complete definitions without a guessed source join.

All tables use the original edition-local identities. Their columns remain TEXT in CSV, SQLite and the generated Azure SQL schema so large IDs, precision, ISO local dates, native units and JSON survive the handover. The generated data dictionary includes the additional tables and exact headers. Power Query uses those same complete headers.

## Query and export

Use the original Archive table/query interface and saved query-export action. A useful period report is:

    SELECT project_key, period_key, series, currency, units, elapsed,
           material_resource_entity_id, total_text,
           value_rows, null_rows, not_applicable_rows, error_rows
    FROM timephased_totals
    ORDER BY project_key, period_key, series, currency, units,
             material_resource_entity_id;

For a selected series, filter by its retained report name with a parameter. The original query preview is bounded; **Export complete query** streams every matching row. examples/timephased-query.sql and examples/timephased-parameters.json provide that input.

For a further sum, use the original decimal_sum function only after choosing the complete grouping dimensions. Keep project, series/field definition, currency/currency source, units/elapsed and material resource identity where applicable. Values from cumulative/alternative fields or overlapping business reporting selections need an explicit consuming-model decision.

The HTML report shows selected series/periods, native capture identities and a labeled totals preview with links to every full table. The complete ZIP includes CSV, SQLite, Power Query, Azure SQL definitions, source evidence and the operating guide. Load the supplied Power Query against the unpacked archive folder, then build the customer's reporting model from its reviewed dimensions.

## Portable receiving

Receive the complete ZIP through the existing Archive upload, inspect and receive actions. The archive carries the original project/companion/model closure plus every selected complete calculation object under source/operator-objects. Source hashes, calculation bindings, record order, headers, footer and file stability are verified while streaming.

Before accepting the received cohort, the original receiver rebuilds every reporting row and exact total from the restored editions and retained calculation records. It compares those results with the publication's full table hashes and review. It requires no JVM or target credentials for this operation. The received original source remains available if a later operator deliberately creates a new native calculation.

The complete original archive and uncompressed closure retain the existing 8 GiB receiving limit. Individual calculation objects are bounded at 2 GiB and JSONL records at 64 MiB; streams and temporary SQLite aggregation keep large facts out of a whole-file memory allocation.

Keep the same receiving request, original archive identity and destination after an interruption. A completed request reopens its receipt even after the intake filename has moved. Subsequent source-local browsing, full query export and workspace handover use the retained original data.

## Native receiving continuation

Continue from the same MPXJ runtime and workspace used for source intake. For the supplied timephased-budget-baseline.mpp fixture, select the actual edition ID returned by that intake.

Follow native/README.md. The optional --native-timephased argument derives an explicit weekly profile from that actual fixture's retained raw span bounds and supported native definitions. --timephased-profile selects an already-reviewed explicit profile instead. Both extend the same original archive receiving function and browser helper.

The native phase enters the profile through the real Archive controls, retains the original save/review/publish actions, exports complete totals, downloads the full handover, receives it into the original fresh workspace and reopens it with native calculation access disabled. It checks the original source models and calculation/table identities. Its actual result, screenshots and saved requests belong in the original operation and customer handover.

## Primary native contract

The selected runtime is MPXJ 16.10.0 at upstream commit 7ef9e72813d33378c55ec6ceb148cc831ed22033. Original methods, field definitions and fixture identities are listed in SOURCE_REFERENCES.json.

- [MPXJ timephased data guide](https://www.mpxj.org/howto-use-timephased/)
- [ResourceAssignment API](https://javadoc.io/doc/net.sf.mpxj/mpxj/16.10.0/org/mpxj/ResourceAssignment.html)
- [AssignmentField source at the selected commit](https://github.com/joniles/mpxj/blob/7ef9e72813d33378c55ec6ceb148cc831ed22033/src/main/java/org/mpxj/AssignmentField.java)
- [TimephasedItem API](https://javadoc.io/doc/net.sf.mpxj/mpxj/16.10.0/org/mpxj/TimephasedItem.html)
