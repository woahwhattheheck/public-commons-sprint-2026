# Prepare a complete field crew packet

In **Implementation & fieldwork → Field records**, save or reopen the intended native plan revision. Choose **Prepare or reopen crew packet**. Filter by planned day, original crew, observer or visit status, then select the actual visits to include. Selections remain selected across filters. Every visit keeps its original ID, including multiple visits at the same site on the same day.

**Review crew packet** shows the exact original revision, groups, station geometry, protocol count, dated calendar events, original attachments and preparation notes. **Create reviewed packet** retains the complete package through the existing native task queue. Its original queued request survives a lost response or browser restart. A saved packet reopens from this same plan after Workspace transfer.

## What a crew receives

The complete ZIP contains:

- **crew-packet.html**: a printable day/crew/observer overview and a full sheet for every selected original visit. Sheets include recorded site coordinates or search-area role, original protocol fields, local calendar values, sample and activity IDs, methods, custody references, notes and available field-entry space.
- **field-workbench.html**: the complete maintained offline Implementation editor, built from the exact installed source edition.
- **original-plan.json**: the complete editable saved plan, including every original result, source snapshot and additional record field. **original-revision.json** preserves the exact native revision/event record.
- **selected-records.json** and complete selected visits, sites, monitoring plans, activities and observations CSVs. JSON retains original strings and nulls; formula-shaped string cells in CSV receive a leading apostrophe so ordinary spreadsheet software displays them as text.
- **sites.geojson**: one original site feature with its selected visit IDs. A site without recorded latitude/longitude has null geometry and retains its original search-area/source role.
- **visits.ics**: one date event for every selected visit with a planned date. The original visit identity is stable across packets. Cancelled visits retain cancelled status. Undated visits remain in the printed packet and original records.
- Every available original local attachment, its original reference and file identity, the complete source register in the plan, preparation notes, and a packet index.

Open or unzip the complete ZIP before following the relative HTML links.

## Dates, crews and station locations

The native Monitoring bridge puts its scheduled crew in **original_calendar.crew**. The visit's **observer** is a separate field, initially blank until assigned or recorded. Both are presented independently.

The original local start/finish values remain printed and retained in full. Generic Implementation visits do not carry a planned time-zone contract. Calendar events therefore use **VALUE=DATE**, preserving the original planned day. They are transparent all-day entries; importing them does not reserve a full day as busy. The calendar uses CRLF lines, UTF-8-aware 75-octet folding and escaped text under [RFC5545 §§3.1,3.3.11,3.6.1](https://www.rfc-editor.org/rfc/rfc5545).

A source catchment search area stays a search area. The packet creates a point only from the site's actual retained latitude/longitude. Original sampled stations, updated collection locations and historical visit records remain separately identified.

## Bring actual work back

1. Open **field-workbench.html**, choose **Open JSON**, and select **original-plan.json**.
2. Use the existing structured field form or record editors to capture actual visits, observer, time with time zone, original sample IDs, measurements, methods, custody and evidence.
3. Export the complete edited plan JSON and any collected evidence through the existing workbench.
4. Open the original native Workspace, import the edited plan and resolve its saved revision through the existing conflict/revision interface.
5. Review the saved revision, register observations and return completed records to the original Monitoring campaign through its existing FIELD12 return action.

The deployment package is an immutable handout. Later edits create a new saved revision and can produce a new packet. Earlier packets remain available by their original revision.

## Native command

Use the existing installed application and the actual Workspace, plan/revision and visit IDs:

    python -B -m model.field_deployment --workspace ACTUAL_WORKSPACE \
      --plan-id ORIGINAL_PLAN --revision SAVED_REVISION \
      --visit ORIGINAL_VISIT --visit ANOTHER_ORIGINAL_VISIT \
      --title "Recorded crew packet title"

The first call previews the exact operation. Repeat that same selection with **--expected-id** set to its returned **id** to retain the full packet. Reopen with **--inspect-id ORIGINAL_DEPLOYMENT_ID** and the same Workspace/plan ID.

Files live at **implementation/plans/PLAN/deployments/ID/**. Preparation holds the original per-plan lock used by Workspace capture. All source files stream in 1MiB chunks; the complete original revision, attachments and generated member identities travel with the deterministic ZIP. Replaying a completed request opens its existing immutable result. A partial request continues the same original package before its completion record is published.

## Installation and receiving

The existing Implementation installer includes the new model, provider, extension and controller plus the maintained streaming-packet dependencies. The existing offline builder composes the complete editor without requiring network assets. Whole-Workspace receiving invokes the extension's validation against the original saved revision and retained members.

The native receiving course should use its actual retained saved plan and visits: preview the full selected packet, prepare it, reopen the completed result, extract its ZIP, open the included field workbench and original plan, and repeat after the course's existing Workspace capture/restoration. Keep the original campaign/revision and source station IDs in the same receiving operation.
