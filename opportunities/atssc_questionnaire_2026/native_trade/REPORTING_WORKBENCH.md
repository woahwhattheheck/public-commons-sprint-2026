# Reporting workbench

Open **Reports** and choose the original questionnaire. Its reporting library
retains complete chart/table views and ordered report templates in the same
customer workspace as the workbooks, published definitions and accepted responses.

1. Create a template or reopen a retained version. Set its title, descriptive
   introduction, page orientation, spacing and one/two-column layout.
2. Add question views and descriptive sections. Choose the original question
   or table column, edit the output title and notes, and select statistics and
   a bar chart, line chart or table. Drag sections to reorder them; the arrow
   buttons provide the same operation with a keyboard. A saved complete view
   can be reused, edited and saved as a new version.
3. Add response-selection filters and, optionally, filters for an individual
   view. Numeric comparisons use the original decimal values. Multiple filters
   on one table must match the **same answer row**. Each view's table-row filters
   also restrict the rows included in its statistics.
4. Add nested grouping variables, an original year variable and, for ratios,
   a numeric denominator. A date uses its year; an integer/text/choice year
   uses a four-digit value. Table variables join their own original row.
5. Select the published edition and accepted respondents. An empty individual
   selection includes all currently accepted respondents; selecting one creates
   an individual report. Preview either disclosure edition, then freeze the
   report. Reopen it later or download HTML, CSV, JSON, PDF and editable Word.
   Record the disclosure review to release that exact public edition.

Public and protected filters are evaluated independently against their own
projected answers. A filter on a protected-only variable selects no public
responses and its literal is withheld in public metadata. A protected answer or
cell also stays outside a public `missing` filter; withholding an answer does not
turn it into an unanswered observation. Where a selected filter variable has
protected responses or cells, the public layout retains its operator and source
reference with `literal_withheld`, while the complete operand stays in the
protected edition. Public alternatives
remain readable text; they never enter sums, averages, ratios, groups or charts.
Calculated answers dependent on protected inputs retain the original protected
projection. Missing/withheld year cells remain gaps in charts and cross-tabs.
An all-unavailable view retains its full statistics and tables while omitting
the chart. Original numerical zero values remain plotted.

**Count** is the number of visible answered observations. **Percentage** divides
that count by all selected original observations, including missing/withheld
values. Table statistics count original table rows; the separate respondent
count counts contributing respondents. **Ratio** divides matched numerator and
denominator sums, using only observations where both original values are
available. A zero denominator yields an empty ratio. Every finite source
contribution is retained in decimal sums; derived averages, percentages and
ratios record their decimal precision and rounding in the saved native result.

Templates and views require their current `expected_version`. Each save appends
an immutable version. A stable `request_id` replays the complete original result;
reusing it with different inputs preserves the workspace and returns a conflict.
Reports retain the selected accepted revision references, template/view versions,
layout, both disclosure projections and all computed statistics. Subsequent
response or template edits update new previews and reports while older reports
retain their original values. The normal whole-project export/receive operation
includes this library, every version, journal and report, and the source modules.

The native extension operations are `list_reporting_library`,
`save_report_view`, `get_report_view`, `save_report_template`,
`get_report_template`, `preview_summary_report` and `create_summary_report`.
Use the original `get_report`, `release_report`, `export_report` and project
export/receive operations for saved report lifecycle and delivery.

For a native template, use `question_ids`, `filters` and `ordered_sections`.
A question section has `id`, `question_id`, optional `column_id`, `title`,
`note`, `chart` (`bar`, `line`, `none`), ordered `statistics`, `group_by`,
optional `year_field`, optional `ratio.denominator`, and optional `filters`.
Variables are `{question_id,column_id?}`; filters have `variable`, `operator`
and, where applicable, `value`. A descriptive section is
`{id,kind:"text",title,note}`. Reused views bind `saved_view_id` and
`saved_view_version` to their exact retained specifications.

Each frozen edition includes `report_layout` and `report_views`. Matching section
IDs identify their summary, full frequency/group tables and year matrix. A
cross-tab is `{row_dimensions,year_variable,years,rows}`; each row has
`dimensions`, `label` and `cells:[{year,summary|null}]` in the exact `years` order.
An absent year stays null, rather than becoming a zero or disappearing.

These operations implement the original Annex A reporting requirements on
pages 21-22, sections 7.3.6-7.3.11, alongside the application's original response,
review, public release and document-download operations.

## Native workbook calculations and retained views

Report variables use the questionnaire core's original disclosure projection.
This includes expression dependencies, native workbook dependencies, original
source coordinates and native protected dependencies. A workbook-derived value
whose source is protected receives the same classification in reporting as in
the respondent's accepted revision. Filters, groups, year variables and ratio
denominators all resolve through that one reference context.

The definition context contains only the declared table shape and physical
source-row ordering. It supplies reference classifications; the selected
accepted responses remain the only source of report observations and numerical
statistics. The context is built once for a complete template or saved view and
is shared by its original variable references.

Reopen an existing saved template or view through the normal reporting library.
Its title, notes, sections, filters, selected questions and saved version remain
retained. When preparing a new preview or report, both a reused section and its
original saved view are resolved against the selected published definition
before their binding is compared. Previously retained reference metadata is
therefore updated for the original native-calculation contract without changing
the stored view. An actual change to a view's authored specifications still
requires its own saved version.

An already frozen report remains its original complete edition. To receive the
current native dependency interpretation, create a new preview from the selected
template and publication, review both public and protected outputs, and save that
new report. This preserves the earlier report and its original accepted revision,
template, view, value and calculation history.

## Public selection and complete report delivery

A public response filter reads its selected public value together with the
classification already returned by the core. For a table, all conditions must
match the same original physical answer row. A withheld cell satisfies neither
`answered` nor `missing`; its approved explanatory alternative remains text in
the public response. Original public zero, false and empty input retain their
normal value semantics.

A public layout and every public view withhold a filter operand when its
declared/native dependency or an original response classification makes that
reference protected. The protected layout keeps the original complete filter.
The same selected public rows feed the preview, frozen statistics, JSON, CSV,
HTML, Word, PDF and the existing Office outputs.

Use the original customer receiving operation to reopen a retained template,
prepare the next public/protected editions from the same accepted responses,
save the report, download its full outputs, and reopen the complete project
export. The reporting extension uses the existing transaction and request-ID
journal; the original saved versions and frozen reports stay part of that
receiving case.
