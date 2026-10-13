# Operating the Upper Savannah decision desk

## Open a completed decision edition

Open `index.html` from the exported decision folder. Its report is already embedded. To switch editions, use **Open report** and choose a `report.json` or a previously saved desk. An empty desk offers **Choose decision report**.

The study header identifies **Comparison**, **Reference profile**, and **Baseline run**. Keep these identities with the option being discussed. **Report JSON** retains the complete quantitative edition, including model identity and source records.

## Shortlist complete alternatives

Start in **Alternatives**. The table shows the edition's selected pollutant reductions, annualized cost, and comparison support. Read the selected outputs before comparing alternatives. Positive avoided export means an improvement; a negative value means increased modeled export.

Use **View filters** to set **Cost currency**, **Capital budget**, **Annual cost limit**, and the **Minimum avoided export** values for the selected pollutants. A numeric budget uses the selected currency. The counter shows how many complete alternatives match.

**Report status** offers **All alternatives**, **Meets prepared criteria**, and **Prepared Pareto frontier**. These last two choices use the saved report's assessment. Budget and target fields change the visible shortlist while prepared badges retain their original meaning.

Use **Clear filters** to widen the view. **Prepared criteria** restores the original budget and targets. Table headers sort the visible alternatives. The chart's **Pollutant** selector changes the reduction plotted against annualized cost.

## Inspect the selected case

Click **Choose** beside an alternative, or select its point in the chart. Open **Selected case** to read:

- **Physical comparison**: paired baseline, alternative, avoided export, reduction percentage, annual units, and annualized cost per unit reduced.
- **Cost assumptions**: capital, annual operation, analysis horizon, discount rate, present value, equivalent annual cost, and source.
- **Prepared decision status**: budget, targets, eligibility, frontier membership, and reasons.
- **Coverage and comparison support**: original and common cells, compared hectares, and the meaning of the support.
- **Run identity** and **Scenario changes**: the actual case and its physical edits.

A selected case stays selected when filters change. A message identifies it if it falls outside the current view.

The overview's **Original baseline quantities** cover each baseline output's own valid cells. The selected-case comparison uses common cells. Its percentage uses that paired baseline.

## Read the supplied sensitivity cases

Open **Sensitivity** for the selected alternative. The included/requested count identifies how much of the supplied member set contributes to the summaries.

Read **Minimum**, **Q10**, **Median**, **Q90**, and **Maximum** as annual reductions across accepted profiles. **Members improved** counts positive reductions. **Rank range** uses the reported stable candidate basis; read it alongside the candidate count.

The **Member comparisons** table includes the primary comparison and additional requested members. It shows comparison/profile, baseline run, alternative run, inclusion, and reason. A missing or different support member stays visible while accepted members supply the summaries.

These summaries describe the supplied cases. The methodology for a probabilistic interpretation would be a separate part of the analysis.

## Keep interpretation and sources together

Open **Methods & sources** for the prepared assessment, methodology, report notes, unavailable alternatives, and original input records.

A complete alternative remains one modeled intervention bundle. Supplied parcel targets describe locations within that case. Evaluate a different combination through its corresponding model run.

Enter the preferred alternative and the reasons for choosing it in **Decision notes**. Keep any proposed budget or target adjustment in the view controls before exporting the next selection.

## Save the work in the form needed

| Control | Result |
|---|---|
| **Save desk** | A portable HTML file containing the original report, current filters, selected case, and notes |
| **Export table** | CSV of all report alternatives |
| **Export this view** | CSV of the currently filtered alternatives |
| **Report JSON** | The original complete quantitative report |
| **Selection request** | The selected criteria, source cost assumptions, comparison identifiers, and notes for a new backend assessment |
| **Print / PDF** | The browser's printable report view |

Use **Selection request** when the next edition should use the revised budget or targets. Rebuild from the same physical source and reporting zone.

For a desk created from the native watershed scenario report, the operator runs:

`python -B model/decision_cli.py scenario-report --report /path/to/native/report.json --zone-id ORIGINAL_ZONE_ID --selection /path/to/downloaded-selection.json --output /path/to/new-edition`

Use the retained native report and the original selected zone shown in **Methods & sources**. The exported decision folder preserves that report at `source-inputs/scenario-report.json`; it can supply `--report` when rebuilding the edition. `scenario-inspect --report /path/to/native/report.json` lists its original zones and run choices.

For a desk created from a retained workspace comparison, the operator runs:

`python -B model/decision_cli.py build --workspace /path/to/study --selection /path/to/downloaded-selection.json --output /path/to/new-edition`

Replace the example paths with the existing physical source, downloaded selection, and a new output folder. Open the new edition's `index.html` to review the prepared assessment produced by those criteria.

The exported package retains the quantitative report, selection, CSV tables, source companion, and available method guides together.
