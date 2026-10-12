# Airport assessment and implementation workbench

This local application connects an airport's source records, readiness workpapers, delivery alternatives, reviewed decisions and implementation roadmap. It preserves the inputs behind a decision so an operator can see what changed, revise the plan and hand over editable workpapers with their original sources.

The interface implements the interactive-tool direction in [ACRP 03-88, *Guide to Establishing Artificial Intelligence Adoption at Airports*](https://rip.trb.org/View/2772553). Its generic assessment and planning functions support both strategy/governance and organizational readiness/implementation. It does not promote a commercial AI vendor. Practical airport expertise, research participation, assessment judgments and procurement authority belong to the participating research and airport teams.

## Start the application

Use Python 3.10 or later. The runtime uses Python's standard library and the included original source parser; no database server, cloud account or hosted model credential is required.

From the project directory:

```sh
python operator/server.py --workspace ./airport-workspace --demo --port 8771
```

Open `http://127.0.0.1:8771`. The application creates `airport-workspace/projects.sqlite3` and its SQLite journal beside it. Keep that directory on storage with room for the original source files and project backups. Start the same command again to reopen saved work; loading an existing example leaves its saved edits intact.

The separately named authored planning example exercises comparison, capacity, measurement and retained-decision workflows:

```sh
python operator/server.py --workspace ./airport-workspace --authored-demo --port 8771
```

The server binds to loopback and checks the local request origin. It is intended for a trusted local operator. A production multi-user deployment needs its own authenticated access, authorization, retention and backup arrangement; the local actor field records the supplied operator label.

## Follow one complete assessment

1. **Establish the airport and its authority.** Retain the actual airport identity, source period, owner, operator and relevant approval roles. City, county and authority arrangements remain distinct records. Published ownership alone does not establish who can approve a particular deployment.
2. **Attach the originals.** Save the workbook, CSV, JSON, PDF or other supporting publication with its source URL, period, rights and limitations. The source register keeps its original filename, byte length and SHA-256. Metadata can be edited; a different original is attached as a distinct source version.
3. **Inspect and map the data.** Preview the exact table, columns, types, original coordinates and quality findings. Select the FAA enplanement mapping or explicitly map fields for another workpaper collection. Choose the source rows to adopt, including an intentional replacement decision when their IDs already exist.
4. **Describe the use case and readiness.** Record the problem, current workflow, objective, scope, cohort and responsible role. Capture evidence for leadership, business ownership, workforce, change, data, integration, runtime, procurement and maintenance. Missing evidence remains visible in the guided input list.
5. **Compare equivalent alternatives.** Define build, buy, partner or process-only scope, responsibilities, integration, support and exit arrangements. Enter source-backed or explicitly authored cost assumptions, currency and time horizon. An operator preference model states its criteria, weights, direction and scoring scale; missing scores remain incomplete intervals rather than silently becoming zero.
6. **Record the actual decision.** Save investigate, pilot, adopt, defer or decline with a rationale, conditions and next review. The application retains the complete reviewed material and its digest. Later source, cost, risk or outcome edits leave the earlier decision available and show its changed-input status. A subsequent review creates a new decision.
7. **Plan implementation and maintenance.** Link work packages to the use case and decision. Set owners, dates, predecessors, period-specific staff demands, acceptance criteria and maintenance/exit responsibilities. Shared capacity is checked across the saved project; missing availability, conflicting dates and dependency cycles remain visible.
8. **Measure and hand over.** Define the unit, eligible population, cohort, time window, exclusions and failure criterion before comparing results. Export an editable project, airport or use-case handover. Separately save a complete private continuation archive to reopen the working project with its original source bytes and revision history.

## What the examples contain

The public example retains the actual FAA calendar-year 2025 enplanement workbook and first-party DEN, SYR and HPN governance pages. It seeds three airports and four distinct owner/operator records, together with explicitly authored planning templates. It does not supply airport staffing levels, AI budgets, system inventories or operating results.

The packaged original FAA workbook contains 1,676 airport rows, six publisher footer rows and one blank source row. The source parser retains all of these. FAA service-level codes identify the airport rows: a nonempty location-ID cell alone is insufficient because publisher footer counts occupy that column too. The footer labelled `None Count` contains 1,160, while 1,274 airport rows contain the literal hub value `None`; the importer preserves both published values and surfaces the distinction.

Traffic values are revenue passenger enplanements for the stated calendar year. They are not total arriving-plus-departing passengers, staff workload, AI readiness or a projected benefit. The published change ratio stays a ratio in the source records. [FAA's passenger data](https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger) and [airport category definitions](https://www.faa.gov/airports/planning_capacity/categories) remain in the source package.

The separate authored example contains declared preference weights, dollar-denominated calculator inputs, a shared staff pool, example observations and successive planning decisions. Its costs, rates, time savings and capacity are teaching inputs authored for the demonstrator. The example's name, workpaper basis fields and source notes retain that distinction.

`demo/sources/source_manifest.json` identifies sixteen public original or derived reference files with hashes and acquisition/source relationships. The application also retains the manifest itself, making seventeen attached reference originals. It loads only this explicit public manifest. Sales research and private coordination files are outside the demonstration package.

## Import semantics

The intake layer reuses the original NEKCV CSV/JSON/XLSX parser. Duplicate or blank headers receive distinct column keys; the original labels remain available. CSV physical coordinates, JSON record pointers and XLSX sheet/cell coordinates accompany the parsed values. Source identity includes the raw bytes, filename, format and parsing choices.

An import preview returns the full table profile and a page of source records. An adoption request binds the exact source version, normalized parser identity, mapping specification and staged-record hash to that preview. It then applies the explicit source-row selection in one project transaction. A changed source, mapping or project revision requires reconciliation before adoption.

Mapped values remain source cell values. Nested JSON conversion occurs only when the mapping explicitly requests `decode: "json"`; this is also the route for an explicit boolean cell when mapping a CSV into a boolean field. Counts and decimal fields are validated by the destination schema. No airport-name matching, implicit clock conversion or silent deduplication occurs.

An import that encounters an existing workpaper ID defaults to a conflict. Intentional replacement requires `conflict_policy: "replace"` and the exact current record revision for every colliding ID. Unselected rows, FAA publisher footers, blanks and unresolved source findings remain in the import receipt. They are not relabelled as successfully adopted airport records.

## Calculations and interpretation

| Workpaper | Behavior |
|---|---|
| Cost comparison | Exact decimal quantities and rates; one-time and recurring periods; explicit shared allocations; currency, horizon and discount-basis differences remain visible. |
| Preference model | Operator-defined scale, direction and weights; partial scoring retains score bounds and weight coverage. A score is a stated preference model, not an objective airport maturity grade. |
| Benefit scenario | Explicit volume, effort, improvement, adoption and review-time assumptions. Saved operational observations remain a separate collection. |
| Readiness | Nine evidence-bearing capability domains; duplicate domain records and missing inputs are shown for review. |
| Capacity and roadmap | Period-specific available, committed and proposed quantities; missing bindings, oversubscription, date order and prerequisite cycles remain visible. |
| Outcomes | Count, mean or rate within explicit phase/cohort/window; failed, missing and excluded rows stay distinguishable; before/after comparisons require an explicit comparison definition. |
| Decision currency | Original reviewed snapshot hash is compared with the current material. Previous and later decisions remain separate records. |

These calculations support the research and airport team's judgment. They do not confer procurement approval, establish a regulatory conclusion or transform authored examples into observed airport outcomes.

## Handover and recovery

Recipient handovers contain a printable `report.html`, `handover.json`, all selected workpapers as JSON and spreadsheet-safe CSV, the field dictionary, computed results and a manifest. JSON preserves original types and nulls; CSV protects spreadsheet formula-like text and is a presentation convenience.

Choose `project`, `airport` or `use_case` as the recipient scope. Airport and use-case bundles omit unrelated airport records. Shared cost records retain selected allocations; outside-scope roadmap prerequisites retain timing impacts without copying unrelated records. Shared capacity shows the selected scope's demand and aggregate commitments elsewhere in the same project. Free-text workpapers still need the operator's ordinary recipient review.

Original attachments require explicit source IDs for recipient exports. A source file may contain rows for more than one airport; selecting a scoped report does not filter the bytes inside a chosen original workbook. The default recipient bundle includes no original attachments. Complete historical decision snapshots, imported source cell payloads and the private event/request history remain in the private continuation archive.

```sh
python operator/server.py --workspace ./airport-workspace \
  --export acrp-public-example --audience airport --airport-id faa-DEN \
  --output ./den-assessment.zip

python operator/server.py --workspace ./airport-workspace \
  --export acrp-authored-planning-example --audience private_restore \
  --output ./airport-continuation.zip

python operator/server.py --workspace ./recovered-airport-workspace \
  --restore ./airport-continuation.zip --port 8771
```

A private archive includes all retained original bytes, complete state, import receipts, reviewed snapshots, the event hash chain and saved request results. Restore validates the exact file inventory and hashes, complete revision chain, final state binding and request-event correspondence before one atomic database write. An identical restore is idempotent. A project ID containing different current work is retained; restore the archive into a separate workspace directory to preserve both branches.

The local limits are 32 MiB per original file, 128 MiB of unique project originals, 48 MiB of saved project state, 100,000 records per collection, and 192 MiB/4,096 files per expanded archive. Large operational histories should use an explicitly documented cohort or extract. No input is silently truncated to fit these limits; normal UI record previews and page sizes are labelled separately.

## Developer interface

`GET /api/catalog` returns the engine's complete collection/field schema, input choices, source contract and application limits. A project retains the original flat eighteen domain collections plus its workspace revision, original-file inventory and import history.

| Route | Purpose |
|---|---|
| `GET /api/projects` | List saved projects and collection counts. |
| `POST /api/projects` | Create `{title, actor?, id?}`. |
| `POST /api/demo` | Load `{kind: "public"}` or `{kind: "authored"}` once. |
| `GET /api/projects/:id` | Current project with labelled record/calculation previews. |
| `GET /api/projects/:id/records/:collection?offset=0&limit=100` | Page through the complete collection. Optional `airport_id` or `use_case_id` selects a scoped workpaper projection. |
| `GET /api/projects/:id/records/:collection/:record_id` | Read a complete original record, including a retained decision snapshot. |
| `GET /api/projects/:id/history` | Page through revision events. |
| `GET /api/projects/:id/files/:file_id` | Download the exact retained original. |
| `POST /api/projects/:id/intake/preview` | Inspect the retained source and explicit proposed mapping. |
| `POST /api/projects/:id/operations` | Apply a revision-bound, idempotent edit. |
| `GET /api/projects/:id/imports/:import_id` | Read the full source-row adoption receipt. |
| `GET /api/projects/:id/projection`, `/analysis`, `/report`, `/export` | JSON workpapers, calculations, printable report or ZIP with explicit scope. |
| `POST /api/restore` | Restore `{content_base64: "..."}` from a complete private ZIP. |

Every mutation uses this envelope:

```json
{
  "operation": "record.save",
  "payload": {"collection": "use_cases", "record": {}},
  "expected_revision": 3,
  "request_id": "unique-stable-request-id",
  "actor": "Named operator"
}
```

Supply a complete record matching the catalog, with its existing ID for an edit. The server advances the record revision. Other operations are `record.delete`, `project.rename` (`{title}`), `source.add`, `records.import` and `decision.record`. Prior decisions are retained; a new review uses `decision.record` and creates another snapshot rather than overwriting history.

`source.add` accepts `{filename, content_base64, media_type?, metadata}`. `metadata` supplies the source record's title, kind, URL, period, rights and notes. Its returned source ID is the input to preview:

```json
{
  "specification": {
    "source_id": "source-id-from-the-attachment",
    "parse_options": {},
    "mapper": "faa",
    "calendar_year": 2025
  },
  "offset": 0,
  "limit": 100
}
```

For a general mapped import, select `mapper: "fields"`, exact `table_id`, destination `collection`, field-to-column `mapping`, optional explicit `constants` and `key_field`. An inspection-only request uses `mapper: "inspect"`. Adopt through `records.import` with the same `specification`, returned `preview_digest`, and either `all_rows: true` or the selected original zero-based `row_indices`.

The same request ID and unchanged action envelope return the original saved result, even after later revisions. Reusing that ID for different input returns HTTP 409. A stale `expected_revision` also returns 409 with the current revision; none of the submitted action is partially saved. Original file writes, state, event and request result share one SQLite transaction.

## Implementation status

The domain engine's retained original-source journey covers the actual FAA workbook and explicitly authored cost, readiness, capacity and measurement cases. The native application journey on October 11, 2026 additionally exercised both example loaders, original XLSX preview and selected-row adoption, explicit collision replacement, CSV mapping into observations, request replay, stale revision handling, a new reviewed decision, an airport-scoped recipient export, complete private export, fresh-database restore and continued editing. Original source bytes and calculated workpapers survived that continuation.

The application does not imply completed airport interviews, an awarded research agreement or deployed airport AI. The [ACRP implementation memorandum template](https://onlinepubs.trb.org/onlinepubs/acrp/ACRP_Implementation_TechMemo_Template_2019.pdf) and original project statement remain available as source references for the research team's subsequent guide and handover work.
