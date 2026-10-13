# Recurring World Bank customer delivery

A customer keeps one Analysis workspace, named data view, saved SQL, report definition and workbook. Each approved World Bank handover receives its own recurring operation in that same workspace. The original response importer, DatasetChanges review, report publication, WorkbookRefresh and archive engines retain the source and history.

The product does not regenerate the customer's SQL or report definition during refresh. It runs the exact report revision reviewed by the operator, including the query revisions and parameter overrides already selected in that report. Workbook titles, notes, worksheet positions, worksheet names, column labels and projection choices are preserved. Worksheets sourced from other reports or query exports keep their complete original sources.

## Review the incoming edition

Obtain the complete approved handover from the original World Bank source workspace. The retained original package importer validates it and regenerates the reviewed CSV before analytical import. Excluded source rows remain recorded in that handover's original review.

Find the actual saved view, report and workbook names in the customer's existing Analysis application. Supply a new stable 32-character hexadecimal operation ID for a new approved edition:

~~~sh
starforge worldbank-product analysis recurring-review \
  --handover /srv/incoming/approved-worldbank-handover.zip \
  --workspace /srv/customer/economic-analysis \
  --operation-id 3b8a28572c444d40a213b2e7e0d4d685 \
  --view north_america_13c281c36fca \
  --report north_america_13c281c36fca_report \
  --workbook north_america_13c281c36fca_workbook \
  --resume
~~~

These names illustrate the initial product's naming convention; use the customer's actual names. The product entrypoint supplies the adjacent original World Bank core and Python package. Put --python /absolute/python immediately after analysis when selecting an installed Python environment.

The response contains review_sha256 and review_file, the full retained comparison identity/counts, approved source metadata, current view bindings, and the complete customer report/workbook definitions. Open the existing Analysis application to inspect every changed observation and the retained source metadata. Review compares all rows, retaining exact numeric text, null values and source metadata; it does not sample the population.

Default comparison keys are source_id, country_iso3, indicator_id, period and aggregate. A source with duplicate identities needs a complete distinct key available in both editions; --keys accepts an explicit JSON list. The original comparison engine reports null or duplicate keys rather than dropping rows or choosing one duplicate.

Review imports the new source under its own source name. The existing customer view continues to select its previous edition until the reviewed selection is applied.

## Refresh the same customer delivery

After reviewing the source change, use its returned digest and a meaningful selection note:

~~~sh
starforge worldbank-product analysis recurring-refresh \
  --workspace /srv/customer/economic-analysis \
  --operation-id 3b8a28572c444d40a213b2e7e0d4d685 \
  --review-sha256 ACTUAL_REVIEW_SHA256 \
  --note "Reviewed revised population observations and the original exclusions." \
  --resume
~~~

The original comparison selects the candidate on the same named view. The exact customer-edited report runs against that selected edition and produces a new publication under the same report name. Related workbook sheets move to the corresponding section in that publication through the original workbook refresh review. Previous definitions and their complete sources stay in workbook history.

A report may deliberately pin an older saved query revision. Refresh preserves that choice. To use an edited query, choose it in the report definition before the incoming-edition review; an unrelated saved-query edit is retained without silently changing report semantics.

All source selection, jobs, publication and workbook definition requests use stable IDs derived from this operation. Repeat the same command after interruption. Completed re-entry reopens the original delivery, preserving customer edits made afterward. Another approved source edition uses a new operation ID with the same saved customer names.

The Analysis application holds the workspace's original single-process lease. Close its current local host before running a CLI writer against that workspace; reopen it through the existing serve command after the operation. The customer workstation must use that same service/lease boundary.

## Actual schema changes

Unique source column labels are remapped to the corresponding new source positions while retaining customer headers and type/null/precision choices. Repeated labels or removed columns require explicit choices. The adapter retains the selected source and published report, writes workbook-proposal.json, and returns WORKBOOK_COLUMN_CHOICES_REQUIRED with each affected worksheet/column.

Use --columns with a JSON file whose keys are the zero-based worksheet positions and values are complete column arrays for those worksheets. Copy the original column objects from the retained proposal, then choose the actual new source label/source_index or remove an obsolete projection. For example:

~~~json
{
  "0": [
    {
      "source": "country_iso3",
      "source_index": 1,
      "header": "Customer country",
      "type": "text",
      "null": "text",
      "null_text": "NULL",
      "precision": "preserve"
    }
  ]
}
~~~

The source_index above is an example; select the actual position from the proposed source. Pass that file on the same recurring-refresh command. The original workbook engine validates and saves the complete mapping. Its full workbook job validates the delivered population. Before source selection, the review checks that every related customer worksheet still matches its saved report/query identity. If a report section was removed or replaced, update that worksheet in the existing workbook editor and rerun review with the current customer definitions. The selected source remains unchanged while resolving that choice.

## Complete customer files

The completed result names exact original IDs, file lengths, SHA-256 values and the delivery directory. It includes the existing HTML/JSON report, section CSV ZIP, Excel workbook, independent workbook handover, complete Analysis workspace/archive manifest and operating guide, plus:

- WorldBank_Source_Changes.json: the full row changes, source/version identities and original selection.
- WorldBank_Source_Changes.csv: complete field differences and the same original source/review identity.
- WorldBank_Recurring_Selection.json: reviewed source, preserved report definition and workbook refresh revision.

WorldBank_Analysis_Delivery.zip contains the full customer file set. Receive its portable workspace in the original archive receiver and its workbook in WorkbookDelivery. Continue a live customer workspace through recurring-review/recurring-refresh with its retained operation. The portable workspace contains the complete customer data, saved definitions and native history. After receiving it into a separate customer installation, start the next incoming-edition review with a new operation ID and the same saved customer names. World Bank adapter operation directories stay with the original live installation.

## Native receiving journey

The supplied receiver uses two actual approved World Bank handovers. It opens the original Analysis engines, creates a customer-edited SQL query and report, renames a worksheet/header and adds a customer worksheet. It refreshes the same customer workspace using the second handover, reads every resulting source row against that handover's CSV, receives the workbook package and predecessor history, then reopens the completed operation after a later customer query edit. It also restores the complete Analysis workspace into a separate customer installation, compares every source row and customer definition, reopens earlier and current worksheet sources, and repeats that original portable receiving operation.

~~~sh
starforge worldbank-product analysis recurring-receive \
  --baseline-handover /srv/worldbank/exports/previous/handover.zip \
  --candidate-handover /srv/worldbank/exports/current/handover.zip \
  --workspace /srv/receiving/worldbank-recurring \
  --operation-id 8a3d93902a0f4b2e9b6d5d653fd6e6ac \
  --resume
~~~

Use the same original receiving directory and operation ID when continuing. The receiver retains both input digests and its actual receiving results in recurring-receiving.json. It runs through the source-native production path and adds no provider charges or GitHub Actions jobs.

## Workstation integration

The Python service is stellar_forge_buyer.worldbank_recurring.WorldBankRecurring:

- review(handover, core, view=..., report=..., workbook=..., keys=None, prefix="worldbank", resume=True)
- refresh(review_sha256, note=..., columns=None, resume=True)
- completed() for the retained full delivery, or record for the original phase/job state.

The product CLI exposes recurring-review, recurring-refresh and recurring-status. Only one owner may hold the original workspace process lease. Preserve the caller's operation ID, exact reviewed handover and reviewed digest across lost responses. Present the actual source comparison and mapping choices in the customer's existing workstation.
