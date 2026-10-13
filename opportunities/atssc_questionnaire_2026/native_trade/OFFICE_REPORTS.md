# Editable Excel and PowerPoint reports

Open **Reports**, choose a frozen report, and download its public or protected
**Excel** and **PowerPoint** edition. Both files retain that report's accepted
revisions, ordering, statistics, groups, year tables and source question
context. Public alternatives remain separate text.

The Excel workbook has three useful sheets:

- **Report** contains the complete ordered report tables and editable native
  charts. Chart titles use the original section titles.
- **Responses** contains each selected response's scalar or table-cell value,
  unit, disclosure, public alternative and original question context. Header
  filters and a frozen first row support reviewing the full collection.
- **Chart data** contains every chart category and series. The native charts
  link to those cells, so editing a series value changes its chart in Excel.

The chart-data sheet appears when the report has visible numerical charts.
Ordinary numeric values are numeric cells. Numbers exceeding Excel's native
15-digit precision retain their exact decimal text. Blank numerical result
cells represent unavailable values. Zero remains a numeric zero. Percentages
retain their source unit; an original unscaled percentage such as `25` remains
`25`, and its question's unit identifies the percentage.

The PowerPoint file contains editable text, native tables and native charts.
Long tables continue on subsequent slides; full original question context
precedes the corresponding response records. Each chart contains an editable
embedded Excel workbook. Open the chart's **Edit Data** action in PowerPoint to
change that chart's embedded data. Charts retain gaps where values are
unavailable. Views with no visible numerical answers retain their full
statistical tables.

These office files contain the frozen report snapshot. Update responses or
templates in the questionnaire application and freeze a successor report to
create a new retained edition. Existing report IDs and downloads remain
available in the workspace's history.

The source-owned renderers use the same projected public/protected payload as
PDF and Word. `office_reports.py`, the standard blank slide template under
`office-assets/`, and `document_charts.py` travel with every complete project.
The Excel and PowerPoint rendering path uses Python's standard library and the
delivered application source. The offline document runtime also supplies the
shared PDF/Word model used by these renderers.
