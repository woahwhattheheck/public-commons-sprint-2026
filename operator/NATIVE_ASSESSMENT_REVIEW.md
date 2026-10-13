# From native report selection to a retained station study

The native assessment report can now supply the exact station selection for a new Station geography study. The saved study carries the exported review, the original report and its source companions, the selected original assessment rows, the original point sources and the retained watershed geometry.

## Open and select the original report

Import the complete native assessment edition through **Original sources**:

`results/native-assessment-delivery-20261013/sources.json`

The ready-open `native-assessment-delivery.zip` contains the same thirteen typed source entries. Keep the original 217-watershed geometry in the same Workspace; the prepared published assessment study in **Station geography** identifies any missing originals.

Open the native report through **Source reports**. In its native station explorer, filter by original utility coverage, annual-reference catchment, reported watershed relationship or station text. Select the stations needed for the new study, then choose **Export selected native JSON**. Selection persists while filters change, so review the selected count before downloading.

For a useful two-station example, select **RS-21014** and **SV-809**. The completed original report associates those stations with Little Beaverdam and Lower Tugaloo respectively. Their four original assessment records retain the publisher watershed identifiers and source locators alongside the geographic result.

## Build the selected study

1. Open **Station geography** and find **Use selected native report stations**.
2. Choose the imported native report. If the Workspace has one compatible report, it is selected automatically.
3. Choose the exported **Selected stations JSON**. The desk displays the selected station IDs, original assessment record count and saved review filters.
4. Enter a study title and choose **Build selected study**.
5. Open the completed edition from **Retained operations**. The original geography desk provides the station map, assessment filters, watershed coverage and complete edition downloads.

The action is retained in the existing operator queue. Closing the desk does not discard the operation; its result and downloads remain on the task. If an interrupted operation needs another attempt, use the existing **Resume** control. Submitting the same uploaded selection again uses the desk's saved operation identity.

The server checks the uploaded station rows against the imported report and exact retained native context before preparing the study. It resolves each selected original native feature, uses the existing published-study point sources and original watershed source, and sends only the selected station IDs to the maintained geography engine.

The selected inventory contains all original published assessment records for those stations. A report filter describes review context; it does not discard another original assessment record for a selected station.

## Retain, share and reopen

Download the complete geography edition from the completed task or the saved study. Reopen that package in another Workspace with **Reopen original geography package**. The existing native receiver restores the study and its retained source references.

The selected inventory's source companions preserve:

- The raw exported review JSON.
- The original report document and complete source companions with their native relative paths.
- The original published inventory source entries.
- A preparation record linking the selected station IDs, original assessment inventory, source report and derived inventory.
- The original assessment fields in the selected CSV, including source ID, source hash, vintage, publisher watershed, cause, use and record locator fields.

The native engine separately retains its original point and watershed sources in the same geography package. Opening the saved study uses its retained calculation and source identities.

## Existing application integration

The browser adds one module, `operator/web/native_assessment_review.mjs`, to the existing Station geography extension. Its new action is:

`station.geography.review-selection`

The queued payload is:

```json
{
  "upload_id": "existing operator upload ID",
  "source_collection_id": "retained native report collection",
  "source_id": "retained native report document",
  "title": "Selected native assessment stations"
}
```


`model.native_assessment_review.prepare(...)` validates and retains the source selection, then the provider calls the existing `model.station_geography.build(...)`. The normal completed-task decorator exposes the geography edition and its downloads.

The catalogue reads retained source metadata only. Original report and companion bytes are verified when the build uses them. The browser accepts selection JSON up to 8 MiB and uses the current Workspace and original upload endpoint.

The additive application component must include the preparation helper, browser module, this guide and the current Station geography provider, browser and descriptor. Preserve concurrent WBD and assessment-context improvements when composing those shared files.

## Native receiving journey

Use the current complete application and existing original Workspace containing the thirteen-entry native report edition and original 217-watershed source:

1. Select RS-21014 and SV-809 in the retained native report and download the selection JSON.
2. In Station geography, build that selection against the same report.
3. Confirm the completed study contains exactly those two station IDs and all four original assessment records. Read the publisher and geographic watershed fields separately in the existing desk.
4. Download the native study package and reopen it through the existing receiver in a second Workspace.
5. Open the restored study and inspect its selected inventory, raw native selection and source report through the retained source references.

This is the application journey for the completed original inputs. The report's existing annual-reference and utility coverage remain bound review context; the maintained geography engine supplies the new selected study's mapped watershed result.
