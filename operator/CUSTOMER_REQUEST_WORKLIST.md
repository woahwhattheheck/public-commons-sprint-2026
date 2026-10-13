# Current customer request worklist

Open **Customer reviews → Current requests** to work across the original review selections in the selected project. The same button inside a retained review starts with that review selected.

The worklist is derived from retained customer responses and engineering handback editions. It does not create a second task database. Each request keeps its original review, customer response and source item identifiers; a saved engineering response continues through the existing handback editor and portable handback package.

## Read the current requests

Each review contributes the requests in its latest retained customer response. Open corrections, questions and requests for change follow the same extraction rules used by the engineering handback editor. Accepted decisions and resolved corrections remain in their original response history and do not become new worklist requests.

The table shows these distinct fields:

| Field | Meaning |
| --- | --- |
| Customer disposition | The decision retained in the current customer response for its stated review selection and purpose. |
| Customer-requested assignee | The assignee written in the original request, where supplied. |
| Assigned engineer | The person or team recorded in the latest engineering handback edition for this original response. |
| Engineering disposition | No engineering edition, planned, addressed or deferred. |
| Engineering edition state | Planning or ready for customer review. |
| Selected evidence | Actual original files and requirements, followed by the replacement references selected from the revised review. |

An addressed engineering request remains visible while it is still part of the current customer response. Engineering treatment does not record customer acceptance. When a new customer response is retained, refresh to see that response's current requests and the engineering editions attached to it. Earlier response and handback generations remain accessible from the original review.

## Find and assign the work

Filter by review selection, assigned engineer, assignment state, customer-requested assignee, engineering disposition or original priority. Engineer and requested-assignee filters use exact names; their suggestions come from the retained records. Free-text search covers the complete request row, including original identifiers, engineering explanations and selected evidence.

Choose **Inspect request** to read the complete original wording, requested assignee, current engineering explanation and the original and replacement evidence. The detail includes downloads of the actual selected files and a complete request JSON document. It also links to the original review, current engineering edition and selected revised review.

Choose **Prepare engineering response** or **Revise engineering response** to open the existing editor for that exact original response. The editor includes all requests in that response, so assignments, dispositions, explanations and replacement references remain a coherent saved edition. A planning edition can retain assignments before revised work is selected. An addressed request requires an actual revised file or requirement reference. A ready edition requires the existing complete ownership and explanation checks.

Edits remain in the existing workspace-specific engineering draft while navigating between requests. Saving creates the next immutable engineering edition; returning to **Current requests** and refreshing reads the saved state. Unsaved drafts do not appear as saved assignments in exports.

## Current selection and concurrent changes

The page displays when it was read and the source snapshot identifier. Changing a filter, page or page size clears the previous table immediately. A delayed response from an earlier selection does not replace the current results. A failed request leaves an explicit retry action.

Opening a request, entering the engineering editor or exporting checks the current source snapshot again. If another operator has retained a newer customer response, review selection or engineering edition, refresh the worklist before continuing. This keeps actions attached to the original identifiers shown on screen.

Changing projects also invalidates pending worklist actions. Filters are retained separately for each selected workspace for the current browser session.

## Export the complete selection

Choose **Export all matching requests** after the current filtered selection has loaded. The generated JSON and CSV contain every matching request across all pages, together with the original review and response identifiers, engineering edition, owner, disposition, explanation and selected original and replacement evidence.

CSV text fields are escaped for safe spreadsheet display. The JSON preserves the original field values. Both documents identify the source snapshot. A changed source snapshot requires a refresh before an export is generated, so a download cannot silently mix two editions.

The export is an operating worklist. Use **Export complete handback** on a ready engineering edition to deliver the actual linked original and revised review desks, response history and complete selected files. Use the existing **Receive engineering handback** flow when importing that package.

## Restore and reopen

The underlying reviews, customer responses and handback editions travel through the existing project backup and receiving flows. Open the restored project's **Customer reviews → Current requests** to derive the worklist from those retained records. Downloads of original evidence use the restored project's ordinary source paths and file tickets.

No model execution is required to read the worklist, assign engineering work or export the selected requests. Scientific quantities, model states, source QA and customer decisions retain their original values.

## Maintained interfaces

The ordinary review provider exposes:

| Interface | Result |
| --- | --- |
| `GET /api/reviews/worklist` | A current, paged request selection and its source snapshot. |
| `GET /api/reviews/worklist-item` | One exact current request, original and replacement evidence downloads, and its complete JSON. |
| `GET /api/reviews/worklist-export` | Complete filtered CSV and JSON download tickets. |

Filters are `q`, `review_id`, `owner`, `owner_state`, `requested_assignee`, `disposition` and `priority`. Paged reads accept `offset` and `limit`; guarded item and export reads carry `snapshot_id`. An item read also requires `request_id`.

The existing `customer.review.handback.save`, export and import actions remain the only writers for engineering responses. The worklist reads each original history bank once under the original workspace lock, validates the retained response and engineering chains, and returns a coherent current source selection.
