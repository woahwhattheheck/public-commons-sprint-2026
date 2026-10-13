# Agency service configuration

A complete operating workspace for category administration, responsibility routing, original request review and implementation handover. The browser uses the same saved profiles, exact original sources and routing engine as the native command and service adapter.

## Prepare the agency profile

Open **Service configurations** and create or import the complete definition. A configuration contains the agency calendar, categories, departments, roles, groups, staff, message templates, routing rules, source mappings and rollout phases. Save a complete profile version before calculating a routing preview. The working definition can be downloaded independently at any point.

Use an explicit IANA time zone. Resolution dates use the original mapped creation instant and the chosen agency calendar. Calendar days and business days are separate choices. Business weekdays use Sunday 0 through Saturday 6; exclusions are literal YYYY-MM-DD dates. The due result is a date in the declared time zone, with its original creation instant retained.

Categories preserve exact source selectors and reference the responsible department and staff member. Location inclusion and requirement are separate settings. The Other category has its explicit display-order rule. Search keywords are separate from exact source routing. Custom intake fields retain their scope, type, original pointer, choices and optional configured default. A default value is distinguished from an observed source value.

Each staff member has one declared role and explicit group membership. Role and group permissions are represented individually. The operating handover identifies relevant vendor application-order requirements for changing an already-associated role or group, while the proposed configuration remains editable.

## Declare the original source

A source profile specifies a source format, original row-array pointer and row-relative RFC 6901 JSON pointers. Every semantic input is either a pointer into the original row or an explicitly declared literal. Source IDs, categories, status, dates, location and progress wording therefore remain traceable to the original source.

The editor accepts the declared formats:

- Open311 GeoReport v2 response arrays.
- Reviewed follow-through dispatch rows.
- Field destination-update items.
- Other explicitly mapped JSON records.

Open **Original request sources**, choose or paste the complete original JSON and select **Inspect original arrays**. Select the exact original array from the returned structure before retaining the source. The empty pointer selects a root array; /rows selects an object's rows member. The source profile's declared array pointer must equal the selected source array.

The full original file remains downloadable. Search and page through every selected original record; **Open full original** shows the complete row, its original index and JSON pointer. The table's short preview is only a display convenience.

## Route the entire register

Open **Routing and progress** and choose the saved configuration, original source and declared source profile. Save the complete routing preview. Each result carries its source identity, category, department, owner, routes, due-date calculation, public-map decision, source stage, rendered message templates and review issues.

Category selectors use exact typed source equality. An original number, string and null remain distinct. Routing conditions are explicit. Eligibility lists select the applicable categories and source profiles; conditions are combined. Multiple matching routes appear as conflicts rather than an implicit first match.

A routing condition can use a declared semantic input or custom:<field-reference>. The latter reads the selected category's custom field through its declared source pointer, which supports the original custom Location field routing workflow.

A request override changes only the fields explicitly selected in its review. **Prepare override** carries the exact source key into a new routing calculation. Choose the category, responsibility, progress stage or map setting being changed and write the reason. The original source and previous preview remain retained.

Use **Known deployed configuration** to select an exact saved profile version and record who declared it deployed, with its deployment reference. This version is retained for permission and membership migration. An externally supplied deployed definition can be imported and saved separately before selection. Leaving the baseline undeclared keeps the required migration inputs visible in the handover.

Complete preview JSON and routing CSV contain the full result population. Browser paging does not limit the saved calculation or downloads.

## Review progress wording

Template subjects and bodies are rendered from the declared original facts. The template's audience and stage are explicit. Missing selected placeholders appear as unresolved inputs in the preview.

The documented native Comcate merge names are {{issue_number}} and {{case_number}}. The remaining named placeholders are the workspace's handover renderer, with the exact supported names listed in the editor and public source contract. A citizen magic link must be explicitly supplied as a permitted HTTPS URL.

Original closure wording matters. A source can close a case after a citation, administrative disposition or other response. Preserve the actual source status and resolution wording when preparing resident progress; a closure alone does not establish completion of a physical repair.

For resident messages, supply explicit resident wording for responsibility, completion notes and progress summaries under each template. These values are optional when unused; selected placeholders without supplied wording remain unresolved in the preview. The editor retains staff-oriented source facts separately from the approved resident phrasing.

Open **Details and messages** on a routing result to inspect its full calculation and exact rendered staff and resident messages together. The configuration specifies the intended communications for implementation.

## Issue the operating handover

Prepare rollout phases for staff, commissioners or residents with the relevant categories, departments, owner, training items, intake and closure procedures, and entry and exit criteria.

Open **Implementation handovers**, choose the reviewed routing preview and provide the reviewer and notes. The saved handover binds the exact profile version and preview. It carries the configuration, original source context, complete routing results, progress wording and rollout procedure. Download its editable JSON and operating report from the saved handover.

A new profile version requires a corresponding routing preview before its handover. Earlier profiles, previews and releases remain available in their original history.

## Continue and recover

The complete workspace export includes profile versions, source originals, routing previews, releases and completed operations. Open it through **Open a handover** in a new empty workspace to continue the same editable work and retained history.

The browser keeps profile drafts while moving among sections. IndexedDB and local storage retain the newest available draft; the working-definition download also preserves unfinished JSON field text. If another operator saves a newer profile, compare the current version with the retained draft or save that draft as a separate configuration.

Before a workspace mutation is sent, the browser retains its original request ID, expected revision, workspace identity and complete body. After an interrupted response, **Check completion** looks up that same original operation. **Resume saved operation** retries the original body. The receiving operation retains its original identity across the received workspace's identity change.

## Browser/API composition

The static browser consists of index.html, app.mjs, styles.css and browser-assets.json. The local service serves the declared routes and API together.

Writes use application/json and X-Open311-Service-Configuration-Workspace, with requestId and expectedRevision. The browser uses the native profiles, sources, previews, releases and receive operations. Original arrays and full preview populations are read through paged source-rows and preview endpoints, with complete file exports alongside them.

The public SOURCE_CONTRACT.md records the primary product sources, exact supported definition vocabulary and compatibility distinctions. The native source owns the configuration validation, routing rules, due-date calculation, saved history and handover format.
