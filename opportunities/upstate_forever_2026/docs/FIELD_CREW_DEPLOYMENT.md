# Prepare a complete field crew packet

In **Implementation & fieldwork → Field records**, save or reopen the intended native plan revision. Choose **Prepare or reopen crew packet**. Filter by planned day, original crew, observer or visit status, then select the actual visits to include. Selections remain selected across filters. Every visit keeps its original ID, including multiple visits at the same site on the same day.

**Review crew packet** shows the exact original revision, groups, station geometry, protocol count, dated calendar events, original attachments and preparation notes. **Create reviewed packet** retains the complete package through the existing native task queue. Its original queued request survives a lost response or browser restart. A saved packet reopens from this same plan after Workspace transfer.

## What a crew receives

The complete ZIP contains:

- **crew-packet.html**: a printable day/crew/observer overview and a full sheet for every selected original visit. Sheets include recorded site coordinates or search-area role, original protocol fields, local calendar values, sample and activity IDs, methods, custody references, notes and available field-entry space.
- **field-workbench.html**: the complete maintained offline Implementation editor, built from the exact installed source edition.
- **original-plan.json**: the complete editable saved plan, including every original result, source snapshot and additional record field. **original-revision.json** preserves the exact native revision/event record.
- **selected-records.json** and complete selected visits, sites, monitoring plans, activities and observations CSVs. JSON retains original strings and nulls; formula-shaped string cells in CSV receive a leading apostrophe so ordinary spreadsheet software displays them as text.
- **sites.geojson**: one original site feature with its selected visit IDs. Exported points use declared or natively transformed WGS84 longitude/latitude. Sites without a usable declared transformation have null geometry and preserve their original coordinates, datum and search-area/source role in properties.
- **coordinate-inventory.json**: each original site's coordinate declaration, derived WGS84 point or explicit unavailability, actual native operation, accuracy, runtime versions and grid metadata. It is bound into the reviewed packet identity.
- **visits.ics**: one date event for every selected visit with a planned date. The original visit identity is stable across packets. Cancelled visits retain cancelled status. Undated visits remain in the printed packet and original records.
- Every available original local attachment, its original reference and file identity, the complete source register in the plan, preparation notes, and a packet index.

Open or unzip the complete ZIP before following the relative HTML links.

## Dates, crews and station locations

The native Monitoring bridge puts its scheduled crew in **original_calendar.crew**. The visit's **observer** is a separate field, initially blank until assigned or recorded. Both are presented independently.

The original local start/finish values remain printed and retained in full. Generic Implementation visits do not carry a planned time-zone contract. Calendar events therefore use **VALUE=DATE**, preserving the original planned day. They are transparent all-day entries; importing them does not reserve a full day as busy. The calendar uses CRLF lines, UTF-8-aware 75-octet folding and escaped text under [RFC5545 §§3.1,3.3.11,3.6.1](https://www.rfc-editor.org/rfc/rfc5545).

A source catchment search area stays a search area. Original sampled stations, updated collection locations and historical visit records remain separately identified.

### Declared source datum and exported coordinates

The native site fields latitude, longitude and coordinate_reference_system retain the original saved values. The supported explicit geographic declarations are EPSG:4326 (WGS84), EPSG:4269 (NAD83), EPSG:4267 (NAD27) and EPSG:4258 (ETRS89), matching the maintained site intake. Coordinate ranges do not establish a datum. Untagged historical sites stay unstated, including records whose original coordinates look plausible on a map.

The preview and printable sheet show original latitude/longitude and declared CRS separately from the exported WGS84 location. Original EPSG:4326 degrees are copied without a datum conversion. Other supported declarations use the installed pyproj/PROJ native runtime with explicit longitude/latitude axis handling, a point-local area of interest and ballpark transformations disabled. The first available applicable operation that successfully returns a finite WGS84 point is retained with its definition, declared accuracy, geographic applicability, runtime versions and known grid metadata.

A selected available operation can leave the numeric values unchanged; its original datum and actual transformation metadata still distinguish that result from relabeling. If a preferred known operation is unavailable, the packet records that fact and the selected available operation's declared accuracy. It does not claim survey accuracy, invent a grid, or assign a new accuracy to the original observation. The preparation notes expose unavailable/unsupported transformations. A missing native transformation runtime leaves that site's exported geometry empty while keeping the complete crew packet and original coordinates usable.

GeoJSON uses longitude, latitude in WGS84 under [RFC7946 §4](https://www.rfc-editor.org/rfc/rfc7946.html#section-4). The calendar GEO value uses the same derived point in latitude;longitude order under [RFC5545 §3.8.1.6](https://www.rfc-editor.org/rfc/rfc5545#section-3.8.1.6). This implementation explicitly uses WGS84 for both exports. Their axis orders differ; both are recorded in coordinate-inventory.json. The [official pyproj Transformer documentation](https://pyproj4.github.io/pyproj/stable/api/transformer.html) describes the native axis, operation selection and ballpark controls.

The mapped_sites count now means actual available WGS84 export points. original_coordinate_sites counts retained coordinate-bearing sites; unmapped_coordinate_sites identifies coordinates that cannot supply a declared export point; transformed_sites counts successful native datum transformations. No original site or plan revision is edited by packet preparation.

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


## Coordinate edition and reopening

The coordinate-aware producer is field-crew-packet/2-declared-coordinates. Its actual coordinate inventory is part of the existing packet identity, alongside the original saved revision, selected visits, source attachments and authored offline application. A changed native transform result, declaration, runtime inventory or source edition requires a new preview. The complete coordinate inventory travels in packet-index.json, the retained result identity and the full ZIP.

Previously completed packets continue to reopen through their original retained identity and file hashes; this successor does not rewrite them or silently claim corrected geometry for an older package. Prepare a new packet from the exact saved revision to obtain the explicit coordinate treatment. Current native receiving should use the already-retained original WQP NAD83 sites and confirm the actual available operation and outputs in this inventory, rather than a fabricated coordinate fixture.
