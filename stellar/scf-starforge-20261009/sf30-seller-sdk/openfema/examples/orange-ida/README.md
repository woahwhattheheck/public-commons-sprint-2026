# Orange Hurricane Ida source review

Open `workspace.html` in a current desktop browser. This complete local application links eight issued-RFP location units to five distinct FEMA projects, receives original portfolio/source files, saves review decisions and returns a complete reopenable work package.

## Included source

The issued register covers Orange RFPs 2026-FEMA-IDA-ENG-01 and -02. `source-register.json` retains the official document/bid URLs, page references, project/PW IDs, individual location identities, separate amount bases and the published schedule. `engineering-context.json` adds seven issued quantities, sixteen concrete engineering outputs, the location scope questions and the original input documents each output needs. Page references are physical PDF pages, starting at 1. The full context is received as its own immutable source edition; existing register hashes and review history remain intact.

`prepared-workspace.json` contains the actual 17-project Orange applicant portfolio selected from the complete 21-declaration, 378-applicant and 1,984-project DR 4614 cohort. All five issued parent identities match. Eight source-analyst decisions retain the original project pages and route the professional decisions to the engineering reviewer.

Project 668978 / PW 1887 contains four locations across the two packages. The location table keeps those four work units; the project table includes the parent once. The program never distributes a parent project amount among locations automatically.

## Use with the original OpenFEMA workspace

1. In the original OpenFEMA Data integration screen, save a delivery for the exact source cohort, portfolio version and reviewed mapping.
2. Extract its complete `portfolio.json`, and import that file here. Original source rows, all six native tables, source scope and selection criteria remain retained.
3. Add the complete project documents in Sources. Select the retained written basis before recording a proposed amount.
4. Inspect the issued quantities and engineering work in each location detail. Record reviewer, role, scope decision, owner and due date. New portfolio or engineering-context editions flag decisions made against a previous source.
5. Export the location register, distinct-project register and report. Save the complete workspace JSON and reopen it to continue with the same source files and decisions.

The original Data integration workflow still owns programme field mapping, customer CSV receiving, selected project-level analyst decision imports, delivery comparisons and the full native workspace archive. The Orange work-unit register adds location-level review and supporting documents. See [Data integration](../../DATA_INTEGRATION.md).

## Command line

Use Node 24 from this complete source tree.

~~~sh
node cli.mjs init --out /absolute/new-workspace.json
node cli.mjs import --workspace /absolute/new-workspace.json --portfolio /absolute/portfolio.json --out /absolute/imported-workspace.json
node cli.mjs context --workspace /absolute/imported-workspace.json --context /absolute/engineering-context.json --out /absolute/context-workspace.json
node cli.mjs inspect --workspace /absolute/imported-workspace.json
node cli.mjs review --workspace /absolute/imported-workspace.json --input /absolute/decisions.json --out /absolute/reviewed-workspace.json
node cli.mjs export --workspace /absolute/reviewed-workspace.json --out /absolute/new-handover-directory
~~~

The review input contains `decisions`, one object per selected location:
`unitId, reviewer, role, status, disposition, owner, dueDate, note, sourceIds, selectedAmountId, proposedAmount`.
Statuses are open, source_needed, engineer_review, review_recorded and completed.
Dispositions are unresolved, same_scope, changed_scope, separate_funding, completed and outside_assignment.
Proposed amounts are exact decimal USD strings; empty/null retains no proposal. A proposed amount names a retained source-document ID. An original RFP reference is selected by its amount ID and remains unchanged.

Each saved action carries an operation ID and expected workspace revision. Repeated identical operation input reopens its result. The CLI creates new output files/directories, preserving existing deliveries.

## Rebuild the standalone application

~~~sh
node build.mjs
~~~

The builder combines the original OpenFEMA decimal/portfolio helpers, this example's source/review engine, original prepared workspace and industrial browser interface. The generated HTML is complete and runs locally without a service. Browser inputs remain in the open workspace; the Save complete workspace button downloads all originals and history together.

## Source semantics

RFP reference amounts, original FEMA project measures and proposed location amounts have separate records. The four official amount measures are never added together. Financial totals use only unique, matched, included parent projects and show missing values explicitly. A project absent from the selected imported portfolio stays in the issued register with its original identity and an unmatched state.

Source-file exports retain their original bytes and filename metadata. Portfolio, context and saved-workspace text inputs use fatal UTF-8 decoding; an original BOM stays in retained file text and is removed only for JSON parsing. A file receive checks that its target workspace is still current before saving. Complete workspace reopening verifies retained content identities. An engineering review is the named person's recorded decision; the application does not replace professional engineering judgment.

Official procurement:
https://orangenj.gov/bids.aspx?bidID=98
https://orangenj.gov/bids.aspx?bidID=99


## Complete original cohort and receiving

[SOURCE.md](SOURCE.md) records the complete DR 4614 source, explicit Orange applicant selection and exact original page identities. The prepared portfolio retains all six original tables. `source-register.json` and `engineering-context.json` retain the complete issued-RFP structure; `locations.csv`, `projects.csv` and `source-review.html` are ready-to-use exports of the prepared workspace.

The complete original source importer, source-workspace reopen, Orange join, source review and CLI export/reopen were executed with Node 24.19.0 on 2026-10-12. The later-page source importer accepts either original count flag on the same exact generated cohort/order/limit/skip URL, then applies the maintained row-count, metadata, refresh and complete-byte checks.
