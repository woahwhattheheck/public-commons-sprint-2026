# Apex FY27 public-safety source intake

This package turns the Town's original pay tables and authorized-position inventory into usable inputs for the staff-market-workbench classification extension. It also supplies an employee CSV adapter, explicit public planning cohorts, and a complete RFP delivery workshare.

## What the source establishes

The June 23, 2026 council attachments contain 318 pay-table rows across the Town. The public-safety portion has 47 original pay titles and 27 distinct published grades. The authorized-position inventory contains 38 Police and Fire & Rescue groups, totaling 275 FTE. All original salary ranges expressly use a full-time, 1.0-FTE basis.

The RFP's physical page 6 has 19 covered-position bullets. Those map to 26 pay-table rows and 19 authorized groups totaling 238 FTE: 118 Fire & Rescue and 120 Police. The RFP narrative separately describes 121 sworn police and 112 fire personnel. The scope crosswalk keeps both populations visible.

| Source concept | Representation |
| --- | --- |
| Published Minimum Salary | Grade min; original annual dollar amount |
| Published Market Salary | Grade reference, labeled **Published Market Salary** |
| Published Max Salary | Grade max; original annual dollar amount |
| Arithmetic midpoint | Separately calculated in the source-row export |
| Published hourly amounts | Retained original cells; never used to infer annual employee hours |
| FY27 effective timing | First full pay period in July 2026; calendar date remains blank |
| Authorized group with multiple grades | One original FTE total plus permitted role IDs |
| Actual employee pay | A private employee_rates roster with explicit source mapping |
| Public authorized-position model | A planning_cohort roster with allocation and rate assumptions retained |

For example, F100 has a published minimum of $56,238.00, Market Salary of $68,899.58 and maximum of $87,152.83. Its arithmetic midpoint is $71,695.42. The method preserves the published market value and its label.

### Scope details that affect the calculation

The 86-officer group spans P200–P203. The 54-person firefighter group spans F100, F102 and F103. The 24-captain group spans F107 and F108. The 10-person telecommunicator group spans M06 and M07. Each group supplies one total; the public record does not split its occupants across those levels.

Police Chief and Police Sergeant appear in the authorized inventory but are absent from the RFP's printed covered-position list. Emergency Management Coordinator appears in the Fire & Rescue pay table and under Administration in the authorization. Police Senior Program Support Specialist has a “PT 30” pay-title annotation but an authorization of 1 FT / 1 FTE. These differences remain in the scope and mapping files for the consulting team's study census.

The 2026 Fire study's Appendix B is retained in fire-study-grade-history.json. It explains historical grade changes already reflected in the FY27 source. A new study method and its professional classification decisions receive their own retained editions.

The adoption folder connects the June 23 council decisions with the August 11 approval of those minutes. The June PDF's embedded font is damaged; the retained review transcription includes the exact original spans and reversible character mapping. Physical page 7 records approval of CN19 and CN20. Page 3 records the 4–0 consent vote, with Gray absent and only CN26 removed. The readable August 11 actions, page 8, records approval of the June 23 minutes as submitted. Original PDF identities and URLs remain attached to that source chain.

## Files

| File or directory | Purpose |
| --- | --- |
| sources/ | Six original Town PDFs, extracted text, original retrieval metadata and SHA-256 values |
| intake.py | Original-table compiler, authorized-group allocation and employee CSV normalization |
| rfp-position-scope.json | Editable exact mapping from each printed RFP position item |
| compiled/method.json | 27 published grades for the native classification method |
| compiled/roles.json | All 47 public-safety source roles |
| compiled/roles-rfp-listed.json | The 26 pay-table rows mapped to the RFP position list |
| compiled/jobs-source-import.json | Original workbench Jobs import containing all six PDFs and complete source/mapping context |
| compiled/authorized-position-groups.json | 38 intact authorized groups with source pages and permitted roles |
| compiled/allocation-template.csv | Editable allocation across career levels within each group |
| compiled/planning-*.json | Four usable public planning rosters and their exact cost summaries |
| workforce-template.csv, workforce-mapping.json | Private employee export contract and editable column mapping |
| questionnaire-template.csv, questionnaire-mapping.json | Original questionnaire response and job-content mappings |
| native_import.py | Complete source, method, role and public-cohort receiving through the native operation ledger |
| RFP_ACCEPTANCE.csv | Required deliverables, responsible party, source page and receiving result |
| MCGRATH_WORKSHARE.md | Full partner-specific implementation, schedule, commercial scope and handoff |

The original jobs-source-import.json is about 1.5 MB and stays within the native 16-MiB source import limit. Its records array contains the 47 usable Jobs records. The surrounding source bundle retains the original PDFs, exact pay cells, position inventory and scope crosswalk in the native source blob. The original raw source download and workspace backup therefore carry the underlying material with the imported jobs.

## Rebuild from the original captured source

From this directory:

~~~bash
python3 intake.py compile
~~~

The compiler verifies every source PDF's byte count and SHA-256 before using its captured text. It retains duplicate original rows in the all-Town export, including the two Powerline Arborist rows, and the original TBD Public Works entry. Neither changes the 47-row public-safety census.

The compiler checks the public-safety row counts, authorization totals, grade consistency, RFP title references and every group-to-grade relationship. A changed source edition needs a deliberate update to its manifest and source mapping.

It also generates all four public planning cohorts, so a fresh source checkout can produce the complete native input set with this one command.

## Public planning and editable allocations

The supplied envelope cohorts are directly usable in Classification → Workforce. They represent all authorized positions filled for an entire year at an explicitly selected published base rate.

| Scope | Authorized FTE | Lower annual base envelope | Upper annual base envelope |
| --- | ---: | ---: | ---: |
| All Police and Fire & Rescue authorization groups | 275 | $19,087,133.91 | $32,117,337.03 |
| Groups mapped to the RFP's printed position list | 238 | $16,283,632.12 | $27,771,971.31 |

The lower envelope assigns every combined group to its lowest permitted published minimum. The upper envelope assigns it to its highest permitted maximum. The roster retains that allocation decision for every line. Incentives, credited service and manager relationships remain blank. These amounts describe the public grade structure's full-occupancy base-pay range; the employee roster supplies actual current payroll for implementation-cost decisions.

To regenerate either cohort:

~~~bash
python3 intake.py planning \
  --scope rfp-listed --envelope lower \
  --out compiled/planning-rfp-listed-lower.json

python3 intake.py planning \
  --scope all-public-safety --envelope upper \
  --out compiled/planning-all-public-safety-upper.json
~~~

To use the Town's actual level distribution, copy compiled/allocation-template.csv into the private project workspace. Fill allocated_fte for every permitted role in each selected group, explicitly using zero for unused roles. Single-role groups arrive with their full original FTE. Every group must reconcile exactly to its authorization before the adapter produces a roster.

~~~bash
python3 intake.py planning \
  --scope rfp-listed \
  --allocation /private/project/apex-allocations.csv \
  --anchor market \
  --out /private/project/apex-market-planning.json
~~~

The market anchor uses the published Market Salary. Minimum and maximum anchors are also supported. The resulting JSON retains the complete original allocation CSV and its hash.

## Private employee intake

Use a stable employee ID from the Town's export. The tool only needs that identifier, the chosen role, FTE and pay inputs; an employee name is unnecessary for the cost calculation. Keep the private CSV and generated roster in the project workspace.

The provided mapping supports three source pay bases:

| Base basis | Normalization |
| --- | --- |
| annual_fulltime | Retain the source annual rate; multiply by FTE later in the scenario |
| annual_prorated | Divide source annual pay by FTE to recover the full-time annual rate |
| hourly | Multiply the hourly rate by explicitly supplied full-time annual hours |

For hourly exports, set an annual_hours source column or a documented constant and provide annual_hours_basis. Fire schedules and other employment arrangements can use their own explicit annual-hours records. The published table's rounded hourly/annual ratio does not supply this value.

Edit columns to point each canonical field at the actual export header. A blank mapping value means that optional field is absent. Choose a direct role_id from compiled/roles.json, or provide exact department and published title. An original HRIS title can be mapped with an explicit role_aliases entry keyed as department|title. An ambiguous or absent role stops that input row for correction.

~~~bash
python3 intake.py workforce \
  --input /private/project/apex-workforce.csv \
  --mapping /private/project/apex-workforce-mapping.json \
  --as-of 2026-10-12 \
  --name "Apex current workforce — HRIS export 2026-10-12" \
  --out /private/project/apex-workforce-normalized.json
~~~

The result contains the original CSV, full column mapping, original row numbers and conversion details. Blank incentive and credited-year fields stay blank. Input row widths, duplicate employee IDs, finite numeric values, positive FTE and exact role references are checked before output.

Incentive values in this contract are **full-time annual rates**. A source holding an already-prorated incentive needs that field converted to its full-time basis before mapping it to annual_incentive_rate. The reviewed import basis should state the conversion.

## Questionnaire and job-content intake

The consulting team maps the actual export headers from its existing questionnaire process. The provided questionnaire-template.csv describes this adapter's destination contract; questionnaire-mapping.json is edited to match the actual source export.

Each response needs a stable response ID and an exact retained role mapping. Map duties, qualifications, working conditions, reporting relationships or other collected sections to labeled text fields. Multiple responses for one role stay individually identified. The adapter keeps the previous job description, attaches the new source sections and leaves the prior grade in place for the consulting team's classification review.

~~~bash
python3 intake.py questionnaire \
  --input /private/project/position-questionnaires.csv \
  --mapping /private/project/questionnaire-mapping.json \
  --base-roles compiled/roles.json \
  --as-of 2027-01-15 \
  --name "Apex questionnaire intake — January 15" \
  --out /private/project/apex-roles-with-job-content.json
~~~

Save the complete resulting JSON as a new Roles edition against the selected method. The original CSV, exact line endings, source mapping, base-role hash and response row IDs remain in the retained input. The intake summary identifies roles with and without newly supplied content so the prime can complete its study census.

## Native workbench receiving

Use the existing staff-market-workbench and its original SQLite workspace. This package supplies data and an adapter for the original classification extension.

1. In **Sources**, select **Jobs** and preview compiled/jobs-source-import.json. Use a clear source name such as “Town of Apex FY27 public-safety source” and the captured FY27 edition. Review the 47 rows, import the source, and retain its native source ID.
2. In **Classification**, save compiled/method.json. Its 27 grades use annual USD and the exact published market reference. The effective timing field contains the source's July pay-period language.
3. Review the source method with the reviewer's actual name and notes. Save compiled/roles.json against that method ID. Bind each role to the corresponding original imported Jobs record where the native receiver provides native_job_id.
4. Save the selected public planning JSON or normalized private employee JSON against that roles ID. Use the complete JSON content as the original import, so the allocation/CSV/source context survives native save, export and restore.
5. Review the original role and workforce editions in dependency order. For a new consultant study, save the revised method/roles as new editions with their professional basis and retained predecessor.
6. Calculate the placement scenario using explicit dates, grade/method selections, incentive rules and phase percentages. Review the individual exceptions and department totals, retain the exact preview, then export the accepted CSV and editable package.
7. Prepare the original workspace backup, reopen it in a fresh restore directory and check the same source IDs, method/role/roster IDs, exact original input content, reviews and accepted scenario.

The corresponding native actions are classification.save_method, classification.save_roles, classification.save_roster, classification.preview_scenario, classification.save_scenario and classification.review. Each request uses the original Workspace.mutate operation ID and expected workspace revision. The original operation ledger supports response-loss recovery with the same action and arguments.

For the complete public-source receiving through the original Python host:

~~~bash
python3 native_import.py \
  --workbench-source /path/to/staff-market-workbench \
  --workspace /private/project/apex-workspace \
  --operation-id APEX-FY27-SOURCE-RECEIVING \
  --actor "Source intake operator" \
  --reviewer "Source reviewer" \
  --review-notes "Describe the actual source and allocation review performed." \
  --out /private/project/apex-input-receiving.json
~~~

Use the create option only when intentionally creating the first Apex workspace. Reuse the same operation ID and unchanged inputs to recover an interrupted receiving. The helper retains all 47 original Jobs, binds the role documents to those native records, saves the four public planning rosters and records the supplied source review.

An accepted source edition records the review of that exact input. The consulting team's newly recommended classification and individual placement decisions carry their own review record and supporting basis.

## Source and procurement references

The exact original source URLs and hashes are in sources/source-manifest.json. Primary public references:

- [Apex RFP listing](https://apexnc.org/bids.aspx?PRINT=YES&bidID=322)
- [Complete 14-page RFP](https://apexnc.org/DocumentCenter/View/56664)
- [June 23, 2026 council agenda and attachments](https://meetings.municode.com/adaHtmlDocument/index?cc=APEXNC&ip=True&me=f78b069da4e34de28f9d58d6e1b71370)
- [Council agendas and minutes](https://www.apexnc.org/838/Agendas-Minutes)

The proposed consulting and engineering responsibilities, full acceptance matrix, delivery calendar and itemized engineering fee are in MCGRATH_WORKSHARE.md and RFP_ACCEPTANCE.csv.
