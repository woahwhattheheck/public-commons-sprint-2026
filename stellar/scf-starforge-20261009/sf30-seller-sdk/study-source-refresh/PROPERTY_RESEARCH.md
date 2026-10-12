# Property research in Study Source Refresh

Property research extends the original study workspace with complete source documents, property surveys and purpose-specific comparable selections. The operator screen, CLI, original workspace lock and event history, and existing delivery/receiving engine use the same records.

## Open the application

Start the original `study_refresh.py serve` command with an absolute private workspace. Open its printed local URL, connect with its local token, and choose **Property research**.

The five screens cover the full workflow:

1. **Source intake:** load the structured survey intake, retain each cited original PDF or other source file, bind those documents, and freeze the first edition.
2. **Study & surveys:** inspect the subject, market-area boundary and source dates; search the inventory; edit a property and its complete unit schedules; freeze a revised edition with the reason for the change.
3. **Change review:** compare two editions or review the first edition. The review includes property fields, keyed unit schedules, study/source bindings and published comparable sets.
4. **Comparables:** freeze every property's decision for one stated purpose. Save a different selection for each other purpose.
5. **Delivery:** open the report and export the complete package, HTML report or schedule CSV. Use the original **Delivery & reopen** screen to receive the ZIP into a workspace.

The layout uses the existing industrial interface. Original field values, citations and source differences remain available within the editing and review flow.

## Retain the source before selecting supply

A document description uses a stable key, title, original HTTP(S) URL, publisher, page count when known, and separately recorded publication and observation dates. Retain the complete original file with that description. A document's identifier binds its source description and exact file bytes.

The intake schema is `stellar-forge.property-survey-intake.v1`. Its top-level fields are:

| Field | Content |
| --- | --- |
| `documents` | Source descriptions. Bind each cited document key to a retained original document. Uncited background descriptions can remain in the intake. |
| `study` | Stable study key and name, effective date, subject, market-area name and boundary, source citations, and analyst notes. |
| `properties` | Complete property inventory with stable keys, observation dates or original observation label, citations, unit schedules, and retained original fields. |
| `source_comparables` | The publisher's purpose, property key, selected Boolean, selection reason and citations. One property can have a separate entry for each purpose. |

Each property includes its name, address, programme, target population, original status, supply status, counts, age/renovation fields, amenities, quality and source pages. `status_kind` distinguishes operating, under construction, planned, proposed and unknown supply. The report groups those cohorts separately and calculates occupancy from explicit operating-property counts. A month-only observation remains a month label; an exact date is only entered when the source provides one.

Unit schedules have stable keys and retain bedrooms, bathrooms, counts, vacancies, floor-area ranges, rent ranges, rent basis, period, currency, published AMHI value/status, utility responsibility and citations. Decimal values remain exact strings. Missing figures remain null. A subsidized rent status is retained as source text with null numeric rent. Mixed or range year expressions remain in `original_fields` alongside any explicit normalized year.

Citations use a bound `document_key`, optional physical `pdf_page`, optional `printed_page`, and a readable `locator`. Physical page numbers are checked against a declared document page count. The full original intake bytes are retained with every frozen edition.

## Revise a survey without losing its earlier edition

Open an edition and choose a property. The form keeps the full source-backed property and unit schedules. Enter a revision reason before freezing the changed packet. The complete packet editor also supports study-area changes, multiple property edits and changes in published comparable context.

Each revision has an immutable identifier and a link to its earlier edition. Comparing editions produces added, removed, changed and unchanged rows. A study/binding change appears as a separate study row; a change in the publisher's purpose-specific selection appears as a separate comparable-context row. Original source contradictions appear with the affected property.

An analyst can explicitly choose to accept unchanged rows when creating a comparison. Their source notes remain attached. Changed and added information is reviewed with the operator's decision and note. Review writes require the currently displayed version, so a simultaneous edit prompts a reload before applying the new decision.

## Select comparables for a particular purpose

Every property receives one explicit decision:

| Decision | Result |
| --- | --- |
| Comparable | Included in this purpose's comparable set, using the selected unit schedules. |
| Context | Retained as reviewed context; selected schedules appear in the mapped export. |
| Exclude | Preserved in the complete inventory and report, with its reason, and omitted from the mapped schedule export. |

Enter the purpose, a reason for each decision and any useful assessment against the supplied selection criteria. The criteria cover target population, location, design, unit types, floor area, amenities, age/renovation, quality, parking, utilities and occupancy. They are editable for the particular analysis.

The **published selection** action copies the publisher's property-level choices and reasons into an editable draft. Review its unit checkboxes before freezing. When a property has both subsidized and nonsubsidized units, select the schedules appropriate to this comparison. The comparable-unit total is calculated from the selected schedules.

A property can be a market-rate context property and a LIHTC comparable in a different saved selection. The report keeps the original published sets alongside the analyst's frozen choices. The selected purpose does not alter observed rent basis, utility responsibility, observation date, or the other purpose's choices.

A frozen selection contains its exact review version and decisions. Later source revisions or review changes leave that earlier selection reproducible.

## Complete delivery and receiving

The original delivery schema carries `kind: "property-research"`. A package includes:

- The human-readable HTML and Markdown report and structured summary.
- The complete property inventory, published comparable context, study basis, chosen schedules, selection criteria and frozen review.
- Exact schedule JSONL and CSV with a format description.
- The complete original documents and intake packets, including the selected editions' revision ancestry.
- A consistent SQLite snapshot containing the relevant original workspace events and property records.
- The original package inventory, file identities and operating instructions.

The same original archive command makes the ZIP. Verification reads the complete declared inventory, then checks the domain records against their retained intake and documents. It reconstructs derived counts and comparison rows and binds the frozen selection to its review. Receiving imports the relevant records into the existing workspace, preserves a later local review, and reopens the received selection against its own review snapshot.

Receiving into a new workspace stages the complete database, documents and receipt before the final directory appears. Receiving the same package again reopens its existing result. The normal original ZIP upload, extraction, package retention and download routes are used.

## CLI and agent operations

The original `call` dispatcher exposes these operation names through the same workspace:

| Operation | Principal arguments |
| --- | --- |
| `property.status` | None |
| `property.document.import` | `path`, `metadata` |
| `property.document.read` | `document_id` |
| `property.study.freeze` | `value`, `document_ids` |
| `property.intake` | `path` or `packet`, `document_ids`, `operator`, `label` |
| `property.edition.read` | `edition_id`, optional `search`, `offset`, `limit` |
| `property.edition.packet` | `edition_id` |
| `property.edition.revise` | `edition_id`, `packet`, `operator`, `label`, `note`, optional new `document_ids` |
| `property.comparison.create` | `candidate_id`, optional `baseline_id`, `operator`, `label`, `note`, `unchanged` |
| `property.comparison.read` | `review_id`, optional `offset`, `limit` |
| `property.review.apply` | `review_id`, `expected_version`, `keys`, `action`, `operator`, `note` |
| `property.selection.freeze` | `review_id`, `expected_version`, `operator`, `purpose`, `label`, `items`, optional `criteria`, `note` |
| `property.selection.read` | `selection_id` |
| `property.selection.report` | `selection_id` |
| `property.selection.export` | `selection_id`, `operator`, `label`, optional `destination` |

Each `items` entry contains `property_key`, `decision`, `reason`, optional criterion `assessments`, and explicit `unit_keys` when selecting a subset of schedules. Every candidate property must be represented.

Use the original `export.archive` operation with the returned export ID; use the original `package.import`, `verify`, and `receive` interfaces for delivery. The property module does not start a second server or introduce another workspace queue.

## Data location and compatibility

The extension adds five domain tables to the original SQLite workspace: source documents, frozen studies, survey editions, versioned reviews and frozen selections. Original source, mapping, portfolio, edition, acquisition and delivery records stay in the existing tables.

Original files are stored under `property-documents/<document-id>/` and `property-intakes/<edition-id>/`, with private file permissions and immutable byte identities. Property operations use the original workspace lock, transaction, event stream and export records.

The original ACS/BLS/HUD source workflow and its package format continue through the original dispatcher. The generic product contains no customer source reports or private survey packets; those enter through the described intake workflow.
