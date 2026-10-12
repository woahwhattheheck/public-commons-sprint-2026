# Municipal service follow-through

This workspace carries original service requests through related work, assigned actions, review and delivery. It keeps the source files, field meanings and saved operating editions together so another operator can continue the work from a complete handover.

The desk is useful when the service-request system and work-order system have different identifiers, status values, update schedules or coordinate declarations. Operators select those meanings explicitly, retain the complete original records, and review the action before it enters a dispatch.

## Start the local desk

The application is installed as **open311-follow-through**. Its merchant provider is **open311-follow-through-workspaces**.

The source command line is at:

    stellar/scf-starforge-20261009/sf30-seller-sdk/open311/follow-through/cli.mjs

Initialize the intended local directory:

    node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/follow-through/cli.mjs init --workspace /absolute/path/to/service-follow-through

The result identifies the workspace and its directory binding. Start the local browser server with the returned identity and binding:

    node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/follow-through/cli.mjs serve --workspace /absolute/path/to/service-follow-through --expected-workspace-id WORKSPACE_ID --expected-binding-sha256 BINDING_SHA256 --host 127.0.0.1 --port 0

Use the local address printed by the server. The browser opens the existing directory; restarting the server continues the same saved desk. The command line and application provider operate the same workspace files. The runtime must support the installed application's native SQLite module.

A second operator can initialize another directory, start its server and use **Open a handover** to receive a complete exported workspace.

## 1. Receive the original sources

Open **Original sources**, select **Service requests** or **Work orders**, then choose the complete UTF-8 JSON, GeoJSON, ArcGIS response or CSV file. An original ArcGIS layer-metadata file can accompany the data.

Give the source a readable name, a stable source-series name and its observation time. Keep the original URL when available. Source series distinguish repeated captures of the same service from another city, system or purpose. The observation time describes the source capture; the operating assessment time is chosen separately.

Inspection displays the actual source fields, declared coordinate system, record count and source coverage before import. A retained source package can contain multiple original captures. Select the feature responses that belong in this source edition. The complete package remains attached.

The desk retains an original service error response as a source error with its original body and selection. Choose a successful data source when building an operating edition. A request-only edition is available while the work-order source is being prepared.

The original-file download returns the complete retained source. Searching and paging the source table changes the display selection; it does not alter the saved file.

## 2. Save the field and link mapping

Open **Field and link mappings** and choose the source files that provide the field lists. These choices help edit the mapping. Each operating edition separately records its exact request and work-order data files.

Choose:

| Mapping | Meaning |
| --- | --- |
| Request identity | One or more original fields that identify a service request. |
| Order identity | One or more original fields that identify a work order; it can remain empty until an order source is selected. |
| Other references | Original identifiers retained alongside the primary identity. |
| Title, description and status | Literal original fields displayed in the operating desk. |
| Work-order requirement | The original field and exact typed values meaning that work is needed or is not needed. Other values remain unknown. |
| Dates | Original fields with an explicit interpretation: UTC epoch milliseconds, an ISO time with an offset, or a literal source value. |
| Coordinates | The original declaration or a named interpretation supported by source references. |
| Cost fields | Original fields, readable labels and declared units. A missing unit remains unspecified. |
| Relationship rules | Exact pairs of request and order fields whose common meaning has been selected by the operator. |
| Status meanings | Exact original typed values that mean active or closed for each source role. |
| Follow-through rules | The issue checks to run and any selected age threshold. |

Typed value lists use JSON. The values `1` and `"1"` retain their different meanings. An empty status list leaves that status meaning unclassified.

### Distinct request and order identities

An identifier from one system does not automatically identify a work order in another system. For example, the original Manatee QAlert layer publishes QSCEND_ID and CW_REQUEST, and its separate WorkOrderView declares WORKORDERID. The desk retains each field under its declared identity.

Leave the relationship-rule array empty when the relationship has not been established. Operators can still search the selected original order source and confirm or reject an individual relationship. A saved decision includes both original source versions, the reviewer and the relationship note.

A configured join names its identity, readable description, request field, order field and selected normalization. **Exact** preserves the value and its type. **Trim text** or **Fold text** applies only the selected text normalization. The complete JSON editor preserves the entire mapping, including additional supported settings.

### Dates and coordinates

A literal source date is retained without turning it into a comparable timestamp. Date-based follow-through rules use only values with the selected time interpretation.

Coordinate interpretation in a field mapping applies to that entire source role. Use it when that interpretation is appropriate for the source. A per-request location choice is also available in the work editor. The original coordinates always remain attached.

The original Manatee request capture used during development declares WGS84 while its 23 returned points contain mixed projected magnitudes. Those exact original values are kept. They do not become usable geographic points merely because the response labels them as longitude and latitude.

Save a new mapping revision when field meanings change. Existing operating editions continue to identify the mapping revision they used.

## 3. Save an operating source edition

Open **Service follow-through** and expand **Save an operating source edition**. Choose the exact request source, optional work-order source, saved mapping revision and assessment time. Give the edition a readable name and a stable operating-series name.

The result is an immutable operating edition. Original fields, relationship candidates, source coverage and follow-through issues can be reopened later. Its table supports search, issue and owner filters, work-status filters and complete page navigation.

The original status remains visible alongside the assigned action. An issue flag describes the selected mapping's assessment; it does not replace the original status.

A request-only edition retains its coverage context and allows assignment and action review. A later edition can pair the requests with a work-order file.

## 4. Follow a request into its related work

Open a request to see its original identity, description, source status, dates, references and follow-through issues.

**Related work orders** shows the candidates from configured field joins and the saved individual relationship decisions. Use **Find an original work order** to search the full selected order source when an order was not selected by a join.

Choose the actual order, select **Confirm the relationship** or **Reject the relationship**, enter the reviewing person and describe the relationship. The workspace saves the exact request and order versions. Earlier decisions stay visible when the source changes.

The original request, complete order and saved history can be expanded within the request window. These views preserve the original values alongside the mapped operating fields.

## 5. Save ownership, the action and its review

The work editor saves:

- Work status, assigned person, priority and due time.
- Working notes and the next action.
- The action text to include in a dispatch.
- The selected target work orders.
- A separate draft, approved or rejected review decision.
- The reviewing person.
- The dispatch-location choice and its source references.

Work completion and action approval have separate controls. An approved dispatch action may still represent work that has yet to be completed.

Changing the source-dependent action, owner, due time or location returns the browser draft to **Draft** until the reviewer selects a new decision. The workspace also checks the original source when the action is saved. A newer source version is shown in the work context instead of silently carrying an old review forward.

For a manual dispatch location, give the reviewed longitude and latitude, a readable location name and its source references. Original source geometry stays attached to the saved action.

Browser drafts are retained by the receiving directory. Saved assignments and their full history live in the workspace itself.

## 6. Compare later source editions

Import the next complete original source capture and save a later operating edition. Open **Source changes** and choose the earlier and later editions.

The comparison distinguishes added requests, changed requests, requests not observed in the later selection and unchanged requests. Open a changed item to compare the complete original values and saved work context.

A request can be absent because the later source query selected another date range, status or page. The desk records that absence in the selected edition while retaining the earlier source, assignment and history.

Use the newer request window to review the source and save the appropriate current action.

## 7. Receive an editable review

Export **Editable review** from an operating edition. The file carries the original request versions and assignment context with the editable work and relationship choices.

When the reviewer returns the complete edited file, open **Assigned work and reviews**, select it under **Receive an editable review**, and save the return. The original returned file remains attached.

Each proposal displays the saved before-value and returned after-value. Choose **Accept change**, **Reject change** or **Decide later** for each item. Select the intended target edition, enter the reviewing person and apply the selected decisions.

Only the selected decisions are saved. Remaining proposals stay open, and their browser choices survive a reload. A source or assignment that changed after the review was prepared is shown with its conflict so the operator can review the current request. Rejected decisions remain part of the history.

## 8. Save the reviewed dispatch

Open **Reviewed dispatch** and choose the source edition. Select the approved actions to deliver. Selection is explicit and remains attached to its source edition while you open requests or reload the page.

Give the dispatch a name and choose the destination columns. An empty column array uses the named standard mapping. A custom column identifies its output name, source role and original field. This supports destination layouts without renaming the retained source data.

Saving a dispatch rechecks the selected original request versions and reviewed actions. The package records the selected work, order identities, owner, due time, literal original status, action notes and geographic coverage.

Each saved package can be exported as:

| File | Use |
| --- | --- |
| Dispatch JSON | Complete structured dispatch and source context. |
| Dispatch CSV | Tabular delivery with the selected column mapping. |
| Dispatch GeoJSON | Geographic delivery for rows with a usable reviewed location. |
| Operating report | Readable review of the selected work and its source context. |

Rows without a usable geographic point retain their dispatch values and location coverage. The JSON, CSV and report keep the full selected operating work.

## 9. Hand over the complete editable workspace

Use **Save workspace** or **Open a handover → Save this workspace** to export the complete workspace after the work has been saved.

The handover carries original source files, mapping revisions, immutable operating editions, individual link decisions, assignment history, returned-review decisions and saved dispatch packages. The receiver continues from those same saved sources and choices.

Initialize a fresh local directory for a separate receiving desk, start its browser server and choose the complete workspace file under **Open a complete handover**. The receiving operation validates the file and retains its original workspace identity.

The receiving directory and original workspace identity are both visible in the handover view. Application integration uses the same source format and operation semantics.

## Interrupted saves

Before a write is sent, the browser retains the exact action input and its request identity. A dropped response leaves that saved action visible.

**Recover saved action** reads the original saved result. **Resume saved action** sends the same original input and identity when a saved result has not returned. An operation already saved by the server returns its original result.

A known validation or edition conflict is shown with the actual message. Refresh the workspace, review the current values and save the intended corrected action. The browser does not turn a connection error into a successful import or a completed dispatch.

## Source and integration notes

The application uses a local, directory-bound server and native SQLite workspace. Browser assets are bundled with the product and require no external font, map or script service. Original inputs remain complete UTF-8 text, and exported handovers preserve the full saved operating history.

Application/provider names:

- Application: **open311-follow-through**
- Provider: **open311-follow-through-workspaces**
- Configuration family: **open311FollowThroughWorkspaces**
- Client: **Open311FollowThroughMerchantClient**
- Provider class: **MerchantOpen311FollowThroughWorkspaces**

Original municipal source references used for the first operating edition:

- Manatee QAlert and WorkOrderView: https://www.mymanatee.org/gispw/rest/services/311/Qscend_Requests/MapServer
- ArcGIS map-service query semantics: https://developers.arcgis.com/rest/services-reference/enterprise/query-map-service-layer/
- ArcGIS layer metadata: https://developers.arcgis.com/rest/services-reference/enterprise/layer-table/
- Catalis Request311 integration description: https://catalisgov.com/public-works/request311/

Actual city source files are supplied to the operating program as their complete retained input package. The product source does not embed municipal customer records.

## Compare original work-order editions

In **Source changes**, select **Service requests** or **Work orders** and choose the earlier and later operating editions. Each comparison covers the complete selected entity population and pages the changed records. The work-order view opens both complete original order records, including their literal date text, recorded cost precision, and source identifier.

Some ArcGIS query layers declare a generated hash-derived object identifier. If that declaration applies to a retained source, a changed generated identifier is distinguished from a changed business field. The original source row and its exact content hash remain available in each edition. Reviewers can therefore see changes in order costs and dates without confusing a regenerated source identifier with a new municipal work order.
