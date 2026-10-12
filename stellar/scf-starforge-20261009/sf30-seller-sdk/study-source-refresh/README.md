# Study Source Refresh Workspace

A complete local operator application for turning retained Census ACS, BLS LAUS/QCEW and HUD income-limit releases into a selected, mapped and reviewed study edition.

The application uses the installed original provider readers. It retains their input files, HTTP receipts, native projection rows and source definitions. A frozen portfolio selects geographies and measures; a frozen mapping defines receiving columns, keys, types, nulls and explicit unit conversions. The operator compares editions, resolves the full review queue and exports a package that another workspace can reopen without retrieving the sources again.

## Start the operator

Use the maintained public application checkout with Python 3.12+ and Node 22+ and its existing provider dependencies. The interface uses the browser already installed on the operator's computer.

~~~sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/study-source-refresh/cli.py \
  --workspace /private/study-refresh init

python3 stellar/scf-starforge-20261009/sf30-seller-sdk/study-source-refresh/cli.py \
  --workspace /private/study-refresh serve --open
~~~

The host listens on loopback. Its private connection.json contains the current address and operator token. The open option passes the token to the browser fragment; the page removes the fragment after opening. The host prints the connection-file path and address.

The industrial interface has seven areas: Workspace, Sources, Portfolio, Export mapping, Editions, Comparison & review, and Delivery & reopen. CLI and HTTP use the same application operations.

## Complete operator flow

1. **Import or receive sources.** Select an existing original provider source.json. The bridge verifies and copies the complete original inventory, produces observations using that provider's original reader, and reopens its portable declaration. Repeating the same import reuses its content identity. Sources also accepts a completed original SF88 acquisition: source_files restores a complete ACS/BLS capture through its original receiver; an observation receipt must match the complete retained native projection.

2. **Select the portfolio.** Browse actual geographies from the retained source editions. Add the required geography definitions, then supply the receiving identifier. Select measures or explicitly retain all measures for those geographies. Freeze the portfolio. A definition from another source edition appears separately even if its identifier looks the same.

3. **Map the export.** Choose the receiving column names, original fields, types, null rules and composite key. Supply the source unit for each selected ACS measure. BLS and HUD retain their original units. A conversion records its source unit, output unit, positive decimal factor and optional decimal places. Original values remain unchanged in the canonical observation. Freeze the mapping.

4. **Freeze an edition.** Select the source inventories, portfolio revision and mapping revision. The resulting edition contains the full selected universe and records excluded scope, absent selections, unresolved units and duplicate export keys. A correction produces another immutable portfolio, mapping or edition.

5. **Compare and review.** Choose a baseline and candidate, or begin with an initial candidate. Same-period comparison keys include the native reference period. Successive-release comparison requires a note explaining the intended comparison. Inspect added, removed, changed, unchanged, incomparable and ambiguous records. Read the original native row or download its source member. Review a selected page or the complete chosen class. Exclusions require an explanation; an accepted incomparable record also requires an explanation and retains a null delta. Mapping errors need a corrected revision or an explicit exclusion.

6. **Deliver and reopen.** Once all reviews are resolved and the selected scope is complete, create the retained package. Download its ZIP or consume the directory. The receiving operator can import the package into the open workspace, or use the receive command to create a separate workspace. Every source member and the saved review identity is checked.

## What the original meaning retains

| Family | Native measure and period | Geography and other dimensions | Values and flags |
| --- | --- | --- | --- |
| ACS | Original estimate variable; release year and five-year reference window | Original GEO_ID, summary level, table, universe and label hierarchy | Exact estimate/MOE tokens, nullable numeric values, separate estimate and MOE statuses, confidence level and original year-specific Jam bound workbook/cell |
| LAUS | Original measure code and series; monthly or M13 annual period | Native county/area definition, seasonal flag and residence basis | Exact token, original footnotes, annual coverage months and excluded months |
| QCEW | Original metric and its monthly/quarterly reference period | County, ownership, industry, aggregation, size and employment-location basis | Exact token and original disclosure group/code; suppressed numbers remain null |
| HUD | Published income-limit category and family size; fiscal year and effective date | Original locality, county and HUD income-limit area membership | Original workbook token/cell and published annual USD amount |

The source_definition_edition geography label records the definition edition available in the retained source. It does not assert a geometry-file vintage that the source did not provide. An optional comparison group is an operator-supplied equivalence statement, with a required crosswalk explanation. Its source identifiers, definition editions and note remain in the portfolio and packet.

The comparison also checks geography basis, comparison group, dimensions, units, conversion rules and the original measure definition. A change in these meanings produces an incomparable record and a null delta. LAUS residence measures and QCEW employment-location measures keep distinct source families. HUD area changes remain visible; the workspace performs no geographic aggregation.

Successive ACS editions contain different, overlapping reference windows. The retained difference describes the selected published values. It does not perform a significance test or treat the two releases as independent samples.

### Numeric and export contract

Canonical normalized values, margins of error, conversion factors, deltas and decimal output columns use decimal strings. Conversion uses decimal arithmetic, and optional rounding uses round half to even. A non-reported native status keeps its null numeric value. Raw tokens and status objects remain available even when a mapped row is excluded.

CSV uses UTF-8 with a header, the exact frozen column order and CRLF record endings. Null cells are empty; the mapping declares whether null is allowed. JSONL retains JSON nulls, structured JSON columns and decimal strings. CSV text remains exact, so spreadsheet imports should use the declared schema rather than automatic formula/type interpretation.

An empty measure selection means all native measures for the selected geography definitions. All out-of-portfolio rows are counted separately. Missing selected families, unresolved selected geographies/vintages, missing selected measures and an empty selection are retained scope issues. Export key collisions identify every affected row.

## CLI workflow

Commands below operate the same persisted workspace as the browser. Replace paths and IDs with the actual imported objects.

~~~sh
python3 cli.py --workspace /private/study-refresh import-source \
  --provider acs --source /private/census/source.json

python3 cli.py --workspace /private/study-refresh catalog --limit 100

python3 cli.py mapping-template > /private/draft-mapping.json

python3 cli.py --workspace /private/study-refresh portfolio \
  --file /private/portfolio.json
python3 cli.py --workspace /private/study-refresh mapping \
  --file /private/mapping.json

python3 cli.py --workspace /private/study-refresh freeze \
  --sources SOURCE_ID --portfolio PORTFOLIO_ID --mapping MAPPING_ID \
  --label "Selected published release"

python3 cli.py --workspace /private/study-refresh compare \
  --baseline BASELINE_EDITION_ID --candidate CANDIDATE_EDITION_ID \
  --mode successive_release --note "The selected release windows and source geography equivalence were reviewed."

python3 cli.py --workspace /private/study-refresh review \
  --comparison COMPARISON_ID --kind changed --action accept \
  --operator "Study operator" --note "Reviewed original values and periods." \
  --expected-version 0

python3 cli.py --workspace /private/study-refresh export \
  --comparison COMPARISON_ID --expected-version REVIEW_VERSION \
  --operator "Study operator" --label "Retained study source delivery"

python3 cli.py verify /private/study-refresh/deliveries/OPERATION_ID
python3 cli.py receive /private/study-refresh/deliveries/OPERATION_ID \
  --out /private/received-study
python3 cli.py --workspace /private/received-study serve --open
~~~

The review command also accepts --keys-file with an explicit array of immutable comparison keys. --kind selects the whole named class from that exact comparison. The expected review version prevents an older screen or CLI invocation from overwriting intervening decisions.

examples/draft.py creates unfrozen portfolio and mapping files from actual retained source identities. It requires the selected geography IDs, measure IDs and an explicit unit. Review those drafts and receiving identifiers before freezing them.

## Original acquired-source receiving

The existing native buyer session continues to own page attempts, reservations, payment accounting and recovery. These receiving operations inspect and deliver an existing session; they do not run a page, sign a transaction or create a second acquisition ledger.

~~~sh
python3 cli.py --workspace /private/study-refresh receive-source-files \
  --provider acs --checkout /path/to/public-application \
  --session /private/original-sf88-session --capture-id CAPTURE_SHA256

python3 cli.py --workspace /private/study-refresh receive-observations \
  --source-id RETAINED_SOURCE_ID --projection limits \
  --checkout /path/to/public-application --session /private/original-hud-session
~~~

For ACS/BLS source_files, the original provider consumer checks every acquired chunk, the manifest hash, release identity and complete member inventory before the original provider is opened. For an observation delivery, typed acquired rows must match the complete retained selected projection as a multiset. Configure the original provider selection to the actual purchased projection; partial or different selections produce a concrete mismatch.

The workspace retains the original delivery manifest and native result with all output byte identities. Its acquisition record states the original native and payment statuses. The original finalized delivery and buyer session remain at their existing native locations; the full restored public source bytes travel with the study packet.

## Complete delivery and receiving contract

Each packet has a content-addressed manifest and includes:

| Member | Contents |
| --- | --- |
| source-manifest.json | Exact source identities, native provider descriptors and original acquisition bindings |
| originals/SOURCE_ID/ | Every captured source member and receipt, original input declaration, portable declaration, native projection JSONL and descriptor |
| acquisitions/ | Original received buyer delivery manifests, native result metadata and verified output identities |
| portfolio.json, mapping.json | The exact candidate's frozen selection and receiving contract |
| editions.json | Candidate and baseline source/revision references and complete selection reconciliation |
| observations/ | All canonical selected candidate and baseline observations, including excluded mapped rows |
| release-comparison/ | Full change records, both original observation references, reasons and null/computed deltas |
| review-decisions.json | Exact comparison, review version, operator decisions and explicit unchanged policy |
| mapped-export/ | Approved JSONL and CSV rows in the frozen schema |
| acceptance.json | Operator export review, complete row reconciliation, null/decimal semantics and explicit exclusions |
| workspace.sqlite3 | A source-scoped snapshot sufficient to reopen the original review workflow |
| OPERATE.md | Receiving and refresh instructions |

The snapshot includes only the selected comparison's source inventories, portfolio/mapping revisions and baseline/candidate editions. Other portfolios in the working database are not collected into that packet. Full native projections for included sources remain available for a later selection.

verify checks every listed member, the exact inventory, source identities, workspace schema and reviewed comparison, and mapped row count. receive creates a new private workspace and reopens the saved state. Repeating receive at the same destination verifies the retained receipt, every source file and every original native acquisition receipt. The UI can also import a packet into an existing workspace; a conflicting immutable record or changed review produces a conflict instead of replacing it. Received packets remain complete under received-packages and appear beside produced packages for verification and ZIP download. Their original source, acquisition and review events retain their timestamps and are deduplicated by content across repeated imports.

## CLI/API operation map

POST /api accepts an operator-authenticated JSON object with operation and arguments. The same operations are available through cli.py call OPERATION --arguments FILE.

| Operation | Arguments |
| --- | --- |
| status | Empty object |
| catalog | Optional source_ids, search, offset, limit |
| source.import | provider: acs/bls/hud, source; optional node |
| source.rows | source_id; optional geography, measure, offset, limit |
| source.receive_files | provider, checkout, session; optional expected_capture_id, node, timeout |
| source.receive_rows | source_id, projection, checkout, session; optional node, timeout |
| source.receive_scan | scan_file and either provider for source files, or source_id plus projection for observations; optional node, expected_capture_id |
| mapping.template, mapping.fields | Template name optional; fields takes an empty object |
| portfolio.freeze, mapping.freeze | value: complete explicit contract |
| edition.freeze | source_ids, portfolio_id, mapping_id, label |
| comparison.create | candidate_id; optional baseline_id, mode, note, unchanged |
| comparison.read | comparison_id; optional kind, offset, limit |
| review.keys | comparison_id; optional kind |
| review.apply | comparison_id, keys, action, operator, note, expected_version |
| observation.read | edition_id, row_id |
| export.create | comparison_id, expected_version, operator, label; optional destination |
| export.verify | directory |
| export.archive | export_id |
| package.import | package: retained package directory |

POST /upload receives a package ZIP through the same operator authentication. GET /download serves only a declared source/export member or a completed package archive. The interface and API share the same original row readers and review state.

## State and operation recovery

Sources and configuration revisions use content identities. Source import writes an isolated temporary capture and commits metadata only after the original provider has completed. If interruption leaves a fully retained source before the metadata commit, importing it again verifies and adopts that capture. A failed parse leaves existing editions intact.

Portfolio, mapping and edition corrections create new immutable identities. Comparison decisions use a retained monotonically increasing review version. A lost review reply is resolved by reading the same comparison and its decisions; a stale expected version is rejected.

Export is staged, verified and renamed into its final directory. Its operation identity binds the comparison, review version, decisions, label and operator. Reopening an existing matching destination verifies its package. The original buyer remains the owner of uncertain page/payment recovery.

The host closes its own active original-provider child groups when it shuts down. No model, phone, background scheduler, data fetcher or seller is started by the review workspace.

## Source integration

- [Original Census provider](../census-acs/README.md) and its consumer.
- [Original BLS provider](../bls-labor/README.md) and its consumer.
- [Original HUD provider](../hud-income-limits/README.md).
- Original SF88 DatasetAcquisition / DatasetDelivery and storage helpers under sf88-operator-buyer-cli/python/stellar_forge_buyer.

Private customer names, proposals, commercial terms and bespoke receiving agreements belong in the operator's private workspace. This generic application packages the selected source and receiving contract supplied by its operator.

## Selection coverage

An explicit family/measure selection applies to every selected geography definition of that family in the edition. With all measures selected, the expected set is the union of native measures in that source definition edition. The freeze result names every missing geography/measure pair; a missing value cannot disappear merely because that measure exists in another geography. Portfolios can retain both baseline and candidate geography definitions, and only definitions present in the chosen source edition are evaluated. Correct the retained source or freeze a revised explicit portfolio before exporting an incomplete selection.

## Original SF100 delivery intake

A producer with a direct SF100 data room can save the unchanged result of the original `scan(directory, {retainPayload:false})`. Receive that saved scan with `cli.py --workspace WORK receive-scan --scan-file NATIVE_SCAN.json --provider acs` (or `bls`). For an observation product, select `--source-id ID --projection observations` (or `laus`, `qcew`, `limits`). The original DatasetDelivery.from_finalized_scan verifies the real manifest, original page chain, typed output rows and retained byte identities. Its directory must be the current original data room; after moving a data room, invoke the original producer's scan at its new location. This intake retains the original result and keeps the original buyer/session accounting in its owning runtime.
