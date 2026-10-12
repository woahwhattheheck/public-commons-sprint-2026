# Geographic handoff workspace

This workspace carries complete municipal case sources through GIS editing, review and a saved dispatch. Open its saved directory through the installed **Open311 geographic handoff** Application. Each source import, analyst return, decision and dispatch becomes a saved edition.

## Bring the original source

In **Original sources**, choose the complete JSON export from an Open311 collection or the full Open311 reporting workspace. A reporting workspace carries the report and its original collection sources. When it contains several reports, select the intended report before importing.

The source inspection shows the selected source type, size and row count. Give the edition a useful name and choose **Import source edition**. The saved source panel retains the original uploaded file, the selected report identity, publisher attribution and the collection's coverage. **Download original source** returns the uploaded bytes.

Collections selected by created date and collections selected by updated date keep their original selection. Cases appearing in more than one imported source remain connected to their original observations.

## Create an analyst's working edition

In **Analyst packages**, name the handoff and choose its source editions. An optional selection narrows it by source text, native status, service code or valid point location. An initial assignment can include a team, asset, work order, priority, due date, action and note.

Choose **Create saved handoff**. The saved edition offers:

| Download | Purpose |
| --- | --- |
| GeoPackage | A complete geographic editing file for a GIS application such as QGIS. |
| GeoJSON | WGS84 point features and the source/assignment attributes. |
| CSV | A tabular operating file retaining the stable case identity and source version. |
| Editable JSON | The original structured analyst return format. |
| Report | A complete readable handoff report with source coverage. |

Use the stable case key and retained source columns already in the file. A GeoPackage's integer feature ID is local to that file; the case key connects edits to the original source.

Rows without a valid point remain part of the handoff and exports. Coordinates use longitude followed by latitude. The original source record, including any separately supplied projected coordinates, remains attached to the row.

## Inspect geography and cases

**Map and cases** shows the selected handoff edition. Search locates cases by the server's case text selection, and **Previous** / **Next** move through the complete matching population.

The coordinate overview plots locations on the current page against their retained longitude and latitude. Select a point or case ID to open its description, original source status notes, original and current geometry, source observation history, assignment and report context.

Case selections remain selected across pages of the same handoff. **Clear selection** clears the current set. Every handoff export contains the complete saved handoff; search and pagination control the working view.

## Receive an analyst's edits

The analyst can propose a point location and changes to these assignment fields:

| Field | Intended content |
| --- | --- |
| Assigned team | The team that should handle the case. |
| Asset ID | The receiving system's asset reference. |
| Work order ID | The receiving system's work order reference. |
| Priority | The operator's priority label. |
| Action | `review`, `dispatch`, `defer` or `dismiss`. |
| Due date | A calendar date in `YYYY-MM-DD` form. |
| Analyst note | The context accompanying the proposed action. |

In **Returned edits**, select the exact handoff edition the analyst received. Enter the analyst and return names, choose the complete returned GeoPackage, GeoJSON, CSV or editable JSON file, and choose **Receive proposed edits**.

The workspace retains the entire uploaded file and separates proposed edits from file conflicts. A changed original source column, unknown/duplicate case key or invalid coordinate remains available for correction. Rows absent from the return stay in the original handoff. **Download original returned file** recovers the complete received file.

Browser intake accepts files up to 64 MiB. The installed command line supports the larger operating intake documented in the product guide.

## Review against the current source

For each proposed case change, the review shows the original baseline and analyst value. Choose **Accept proposal**, **Reject proposal** or **Leave pending**. A proposal groups that case's changed fields; its saved original baseline travels with it.

Choose the current target handoff edition from the same series, enter the reviewer and review note, then choose **Save reviewed edition**. The system checks the original source version and the current values of the proposed fields before accepting the change. A concurrent source or field change returns the specific conflict for review.

The decision creates a new immutable handoff edition. Rejected proposals and earlier files remain in history. Unselected proposals remain available for later review. Saved accepted and rejected proposals show their reviewer and time. **Accept remaining proposals** selects only the proposals that still await a decision. The original uploaded file is available alongside every saved return.

For a fresh source period or an updated source capture, import the complete new source and use **Continue with new sources** from the earlier handoff. The successor keeps the same series and identifies changed original case versions for a fresh review.

## Prepare reviewed dispatch

In **Reviewed dispatch**, choose a reviewed handoff, name the package and identify the receiving team or system. The default selection includes the rows with an accepted analyst decision setting the action to `dispatch`. A selected-case package uses the explicit selections from that exact handoff.

An optional destination column mapping uses the product's known field names. Original case identity and source-version columns remain part of the output. The product's command-line guide documents the canonical field names and complete mapping format.

Choose **Prepare saved dispatch**. Download GeoPackage, GeoJSON, CSV, structured JSON or the readable report. Each export contains the complete saved dispatch, its source coverage and retained decision links.

## Transfer the complete workspace

**Save workspace** downloads the full editable geographic workspace. It includes every original collection/report file, handoff edition, analyst upload, proposal, review decision, dispatch and saved action.

The receiving operator opens an empty initialized GIS workspace through Applications or the installed command line. In **Open a handover**, choose the complete geographic workspace JSON and select **Receive and open original workspace**. Receiving preserves the original workspace identity and its source and review history. The saved directory can be reopened for continued work.

Use the complete workspace with the destination's dispatch exports when handing over operations. A specific GeoPackage or CSV is useful for field work; the workspace retains the complete editable history.

## Recover an interrupted action

A mutation carries one saved request identity and the workspace edition it was based on. When a connection interrupts the response, the browser retains the original request and offers **Find saved result**. This reads the saved native operation.

If the native workspace has no saved result, **Resume original action** sends that same request identity and exact original input. A saved success is recovered without creating another source, return or decision. If another operator has advanced the selected edition, refresh and review the new current state before issuing a new action.

The browser retains available form drafts and pending proposal choices in its local storage, bound to the selected saved directory. A receiving action keeps that same recovery binding when it adopts the incoming workspace identity. The workspace database and complete handover retain the actual saved source and operating history.
