# Field-work desk

The field desk continues from an approved municipal dispatch. Supervisors plan visits and assign named crews; crews record field outcomes, notes, files, labor, materials and equipment; supervisors review the saved work and prepare destination update packages.

## Open the workspace

Use Node 22.16 or later with the complete installed product source.

```sh
node cli.mjs init --workspace /absolute/path/to/field-work
node cli.mjs serve --workspace /absolute/path/to/field-work --port 8770
```

Open the loopback URL printed by the server. The header identifies the current directory, workspace and revision. **Save workspace** downloads the complete editable handover.

## Import approved work

In **Approved source work**, choose the original dispatch JSON or a complete editable follow-through workspace. Give this source a name and use **Inspect source**. If the original workspace contains several dispatches, select the intended saved dispatch ID from the inspection, then import it.

The original JSON is retained in full. A visit refers to one row in that saved dispatch, including the original request, confirmed related orders, approved work, source geometry and mapped delivery values. The source list is searchable and paginated; it does not truncate the imported programme.

Use **Plan visit** beside the intended request. The location view plots valid WGS84 points from the current source page. Records without usable WGS84 points remain available in the table.

## Plan crews and visits

In **Crews**, save the crew name, available members, roles and contact details. Mark a crew available for assignment as appropriate.

A visit has a title, approved source row, optional crew, priority, instructions, planned start/end and due time. The field record is separate: field outcome, actual start/end, completion or exception note, field notes, resource entries and files.

Date entry uses the browser's displayed time zone. Saved date/time values identify UTC instants. Opening and saving an unchanged time preserves the original instant, including its original seconds.

Each field note has its own stable ID, author, recorded time and text. Each resource entry has a stable ID, type, name, explicit unit, exact decimal quantity, optional unit cost and currency. Decimal values allow at most 18 whole digits and 9 fractional digits. A cost requires a three-letter currency. Quantities and costs are kept by their declared unit and currency.

**Add files** retains the complete bytes in the workspace. Save the visit to include the selected file IDs in its field record. Removing a file from a visit changes that visit's references while the original saved file remains in the workspace history.

Each save creates a new visit version. The interface checks the current version before saving an open edit. If a saved browser draft belongs to an earlier version, the current version opens with a download for the earlier draft so the operator can compare the work.

## Work offline with a crew package

Select one or more visits in the visit register and choose **Create crew package**. Selection can span pages. Name the package and provide its operating instructions, then save it.

Download **Offline crew editor** and provide that complete HTML file to the crew. It opens directly in a current browser, without a field-desk server or a network connection. The package includes the selected visit versions, source records, assigned crew details and existing field file bytes.

The crew can move between visits, change the field outcome, enter actual times and completion notes, add field notes, record resources, and attach files. The editor saves its draft and file bytes in browser storage where available. The storage namespace includes the original package ID and hash. The editor reports if browser storage cannot retain a change; downloading the return preserves it in a file.

Enter a return name and the person or crew returning the work, then choose **Download crew return**. The resulting JSON includes the original package identity, each changed visit's original version, and only the changed field keys. A returned note/resource list represents that changed field in full; its stable item IDs allow the supervisor to reconcile overlapping entries. Omitted visits and fields are unchanged.

Original municipal report media remain part of the original source record. New files entered with a visit are separately recorded in the field record. The original source links can be opened explicitly when a connection is available.

## Review crew returns

In **Returned work**, import the complete returned JSON. Open it to compare each proposal against the visit sent to the crew and the current workspace version.

For each pending proposal, choose **Leave for later**, **Accept reviewed changes**, or **Reject these changes**. An accepted proposal with an overlapping field requires an explicit choice between the current and returned values. Changed source context and changed assignments have their own review acknowledgements. The interface shows the actual compared values, rather than inferring that a completed crew status changed the municipal request.

Enter the supervisor's name and review note, then save the selected decisions. Partial decisions leave the remaining proposals pending. Acceptance creates the resulting visit version and binds its supervisor approval to the exact source context and version. A later field edit or relevant source change makes that approval require a new review.

An operator can also review a saved visit directly from its detail page or select several visits and choose **Review selected visits**. The review opens the saved field record and original source work for each selected current version.

## Prepare destination updates

Select reviewed visits and choose **Prepare destination update**. Name the package, identify the reviewer and destination, and choose the destination action for each visit.

**Update field information** carries the reviewed field work. **Request destination closure** additionally requires completed field work and current supervisor approval. Destination references and item notes identify the intended customer records.

The saved package binds the destination, original source records, approved visit versions, supervisor decisions, resource quantities/costs and included files. Download its JSON, CSV, GeoJSON or report for the destination workflow. The field outcome, supervisor approval and requested destination action remain distinct values throughout.

## Save and continue a handover

**Save complete editable workspace** includes all source records and original text, crew and visit versions, attachments, saved crew packages, original returns, supervisor decisions, destination packages, and retained operations.

To continue a separate handover, initialize an empty field desk directory, open **Open a handover**, and receive the complete editable JSON. The new directory adopts the original workspace identity and history. Continue editing, assigning visits, reviewing returns and creating updates in that received workspace.

## Recover an interrupted operation

The browser retains a mutation's request ID, original body, expected revision and workspace identity before sending it. If the response is interrupted, **Recover the saved operation** remains visible.

Use **Check completion** to read the retained operation by its original request ID. **Resume saved operation** resends that same original request when no completed operation is found. A completed request returns its saved result. The pending-operation namespace follows the workspace directory, so recovery also works when receiving a handover changes the workspace UUID.

Form drafts are kept separately from submitted operations. Recovered visit or supervisor-review drafts are applied only to the version and source comparison from which they were made. Earlier drafts can be downloaded when the current work has changed.

## Access and presentation

The server listens on its exact loopback host and port. It checks the request origin and the current workspace identity for mutations. The browser assets are local; the interface and portable crew editor do not depend on a CDN.

The workspace uses a neutral industrial layout, keyboard-accessible forms, labelled tables and dialogs, responsive sections, and a print layout. Complete record details, original files and editable handovers remain available from the same operating views.
