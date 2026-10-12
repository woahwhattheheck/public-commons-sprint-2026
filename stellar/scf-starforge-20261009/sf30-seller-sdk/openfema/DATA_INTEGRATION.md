# Reviewed project data exchange

Use **Data integration** in the original OpenFEMA workspace to prepare a complete project file for an existing programme system, receive the customer's own CSV, review differences and retain the next delivery. The feature uses the existing source editions, portfolio versions, review records, original operation IDs and full workspace archive.

## Start with the original programme

Open the installed workspace, import or capture the complete official source cohort, and save a portfolio. Select that portfolio and its current version in the header. Existing source capture, all six portfolio tables, analyst review, merchant publication and receiving remain available.

The destination is a reviewed file schema. A programme may supply a CSV header, JSON schema, data dictionary or other complete field specification. Receive that original text into the mapping editor and map exact target column names to the available source paths. The file is retained inside the mapping. The built-in 31-column neutral staging format is ready for an analyst to inspect and adapt.

The mapping includes these decisions:

| Mapping field | Operator decision |
| --- | --- |
| target.name, target.reference | Name the actual destination and its source specification. |
| target.kind | Keep staging for the supplied neutral format; use customer_supplied for an actual provided destination schema. |
| target.evidence | Retain the complete original schema filename and UTF-8 content. |
| columns[].column | Use the exact target column name. |
| columns[].source | Choose a listed original field, or null for a customer-owned column. |
| columns[].required | Mark destination-required cells explicitly. Missing values appear in delivery issues. |
| customerKeyColumn | Select the customer identifier column if the destination has one. |

Each writable analyst field maps to one destination column, so receiving cannot choose between conflicting aliases. Repeated read-only source projections remain available.

Every mapping requires one original GM project ID column and one disaster-number column. Their combined identity drives receiving. A source field's value type follows the published field: source IDs and dates stay text, money stays exact decimal USD, and source/reference fields remain attached. Review status, disposition, priority, owner, due date and note belong to the analyst.

## Save and review the mapping

Save a mapping version, then record a named field review and its conventions. The review binds the exact mapping hash. Editing a saved mapping creates another immutable version linked to the previous one; previous reviews remain with their original mapping.

Mapping drafts are retained in this browser. The saved mapping, complete destination schema and field review live in the original workspace. The operator screen lists every mapping and exposes all available field definitions.

## Export the selected source version

Choose a reviewed mapping and an exact saved portfolio version. Save the complete delivery ZIP:

- projects-target.csv: every selected project in the reviewed target columns.
- delivery.json: original portfolio/source identity, mapping and field review, counts, issues and source reference for every exported row.
- portfolio.json: the complete native six-table portfolio with original records.
- mapping.json, mapping-review.json and TARGET_SCHEMA.txt: exact destination contract and review.
- report.html: a complete readable project register.
- START_HERE.txt: receiving instructions.

Excluded projects remain in the project file and are marked separately from included totals. Conflicting source identities and required missing cells appear as issues. The exact project cost, federal obligations, total obligations and mitigation amounts remain four separate measures.

A source edition with no funded projects produces a header-only target CSV and a report retaining its declaration/applicant context. Public Assistance Funded Projects Details describes obligated worksheets; a zero count in that dataset does not describe the full pre-obligation project pipeline.

## Receive the customer's file

Choose the original delivery used to prepare the customer file, then select the complete UTF-8 CSV. Receiving retains its original name, bytes, hash, columns and every row. Quoted commas, quoted newlines, CRLF or LF, and a UTF-8 BOM are accepted. The file can contain extra destination columns. Up to 16 MiB and 250,000 rows are received in one operation.

The result separates:

| Result | Meaning and action |
| --- | --- |
| MATCHED | The mapped source and analyst cells agree with the selected delivery. |
| REVIEW_CHANGES | Valid analyst-field differences can be selected for a new portfolio version. |
| SOURCE_DIFFERENCES | Customer source-field cells differ. Inspect original and supplied values side by side. |
| REVIEW_INPUT_INVALID | The original cells are retained; correct the invalid analyst value and receive a new file. |
| UNLINKED_CUSTOMER | A customer record lacks both original source identifiers. Preserve it in its programme workflow. |
| DUPLICATE_CUSTOMER_ID | Multiple rows use the same disaster/project identity. Resolve the customer identity before importing decisions. |
| NOT_OBSERVED_IN_SOURCE_EDITION | The customer identity is absent from this source edition and portfolio selection. |
| SOURCE_ONLY | The selected source project has no corresponding row in the customer file. |

Open **Review receiving** for paginated access to every row, its exact source references, original/customer values and review proposal. The ZIP contains the original CSV, complete reconciliation JSON/HTML, mapping and original portfolio. A customer project awaiting obligation remains visible in that received file even when the obligated-project source has zero rows.

## Import selected analyst decisions

Select the valid review rows to apply, enter the receiving analyst and reason, and save. The operation creates one new native portfolio version for the selected batch. Source fields remain attached to the original source rows.

The current portfolio must use the receiving's original source edition. Each selected project's current analyst fields must still match the baseline exported to the customer; a concurrent review requires receiving against the current version. Other projects' decisions are carried forward. The saved review records name the original customer file hash, row number and receiving decision.

Choose the resulting version for the next project delivery. Optionally choose a prior customer reconciliation using the same mapping to carry customer-owned cells into the new source projection. Unique source-linked customer values carry forward; duplicated/unlinked customer records and extra columns remain in the complete original customer file included in that ZIP.

## Compare editions and reopen

Save a comparison between two retained deliveries. The complete report separates newly observed projects, projects not observed in the later selection, changed official fields and changed analyst decisions. Source/criteria scope changes and mapping changes remain explicit. Financial deltas retain all four amount measures and missing-value counts.

The **Handover** workspace ZIP includes the original source responses, mappings, destination schemas, customer inputs, deliveries, comparisons, operations and review history. Restore it into a new private directory with the existing restore command, then open that workspace.

An interrupted browser receiving reopens the same operation ID. Large original files are stored as immutable workspace objects; if a request has not reached the workspace, the retained browser identity lets the operator select the same local file and continue. This uses the original operation deduplication and workspace revision controls.

## CLI workflow

Use these commands from the installed merchant distribution. Run them while the private workspace is owned by that CLI session; the browser uses the already running workspace API.

~~~sh
openfema mapping-save --workspace PRIVATE_DIR --mapping mapping.json
openfema mapping-review --workspace PRIVATE_DIR --mapping-id MAPPING_ID --reviewer "Programme analyst" --note "Reviewed original schema and source field conventions."
openfema project-delivery --workspace PRIVATE_DIR --mapping-id MAPPING_ID --version VERSION_ID --out first-delivery.zip
openfema reconcile-projects --workspace PRIVATE_DIR --delivery DELIVERY_ID --customer-file customer.csv --out receiving.zip
openfema apply-project-review --workspace PRIVATE_DIR --reconciliation RECONCILIATION_ID --version CURRENT_VERSION_ID --rows 2,17 --reviewer "Programme analyst" --note "Apply selected analyst decisions."
openfema project-delivery --workspace PRIVATE_DIR --mapping-id MAPPING_ID --version NEW_VERSION_ID --customer-base RECONCILIATION_ID --out next-delivery.zip
openfema compare-deliveries --workspace PRIVATE_DIR --before FIRST_DELIVERY_ID --after NEXT_DELIVERY_ID --out comparison.zip
openfema backup --workspace PRIVATE_DIR --out complete-workspace.zip
openfema restore --archive complete-workspace.zip --workspace NEW_ABSOLUTE_PRIVATE_DIRECTORY
~~~

Every command prints the exact saved native IDs. Supply --operation-id ORIGINAL_ID to reopen the same inputs after interruption. All actions also remain available through openfema action --request ACTION_JSON and POST /api/action with the displayed revision.

## Use the original merchant tools

The same saved mapping and project exchange are available through the original merchant Apps and typed MCP client. A host declares the complete mapping and customer CSV files with their SHA-256 identities; each small action selects the declared alias. `openfema-merchant-exchange` completes the mapping review, full delivery, customer receiving, selected analyst decisions, comparison and original workspace archive in one resumable receiving directory. See [MCP.md](MCP.md#complete-mapped-project-exchange) for the complete host configuration and command. The archive remains in the merchant’s existing private customer-exports directory and can be downloaded again after its browser session or merchant restarts.

## Recorded-source commissioning

The original [DR4724 example](examples/recorded-dr4724/README.md) contains 195 actual published obligated projects, 43 applicants and two declaration areas. It supplies a complete populated source for mapping, receiving and analyst handover. The original dataset pages and numeric lexemes rebuild its entire portfolio exactly.

A later or different cohort must be acquired and retained as its own source edition. Original connector captures may explicitly record requestedAt and uploadReceivedAt as null when those intermediate clocks were not observed; downloadReceivedAt remains an actual required observation, known clocks remain ordered, and all source URLs, original bytes, digests and attachment identities are verified.

The original [commissioning guide](COMMISSIONING.md) covers source capture, native publication and buyer receiving. The data-exchange workflow adds the existing-programme field mapping and recurring source reconciliation. The source is FEMA OpenFEMA operational data; its metadata accompanies every edition and explains its reporting purpose.
