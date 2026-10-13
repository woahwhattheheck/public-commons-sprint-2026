# SCF customer installation reporting and receiving

The reporting companion turns the completed three-customer SCF operating selection into three complete company-specific reporting packages. It carries each original saved installation, its Workshare, recorded checks, and the three complete customer source files into a readable report, editable JSON, CSV tables and an independently verifiable handover.

The original complete programme remains the implementation workspace. Its installation editions and checks supply the facts shown in the reports.

## Select the original operated programme

Select the complete original operator archive and its independently supplied SHA-256 from the intended internal delivery. Retain its original case, plan, version, saved Installation editions, complete customer Workshare sources and full operating/browser receipts.

The application code ships no company case, private archive locator, customer fee, recorded business result or source correspondence. Those values come from the operator's selected native archive and remain bound to its exact original bytes. A report preserves the selected stage and observations; it does not establish implementation acceptance or payment.

Keep the original complete archive privately with its actual request/receipt and source lineage. Use the current native SF47 Workspace and Operations application to continue the implementation. This companion reads the completed operator outputs and opens no new workspace or case.

## Why the reporting companion exists

The maintained native installation handover deliberately includes the wider internal case, grant history and source population. Those full exports remain the complete operating and recovery route.

A company reporting recipient instead receives its selected full installation input, that company's complete native Workshare selection, all original customer files and every recorded installation check. The companion does not copy the full internal programme, unrelated Workshare inventory entries, other company files, this internal multi-company guide or the native SQLite database into a company package. Each packaged guide is generated from that customer's own exact binding.

The reporting edition retains the wider programme's original IDs and SHA-256 references so an internal operator can trace it back to the full original archive. These references are provenance, not a claim that a company report replaces the native operating case.

The three original selected customer files can contain that company's full correspondence and commercial terms. Review the selected company's original files before externally delivering its report. The companion prepares complete local packages and does not send them.

## Requirements

Use Python 3.11 or later on Linux. The entire companion uses Python's standard library. Keep **customer_reporting.py** and this internal **OPERATING.md** together. Each generated package contains the complete receiver source and a generated receiving guide limited to its own customer selection.

The report generator uses no browser, network call, external service, dependency installation or business-database write. Obtain the exact existing original ZIP through its ordinary saved-file download, verify its identity, then run the local operation.

## Export all three actual reports

Choose a private output directory for the one original reporting operation:

~~~bash
python3 customer_reporting.py export \
  --archive /absolute/Complete_Operator_Archive.zip \
  --sha256 EXACT_ORIGINAL_ARCHIVE_SHA256 \
  --archive-root EXACT_OPERATOR_DIRECTORY_IN_ZIP \
  --operation-id ORIGINAL_REPORTING_OPERATION \
  --output /absolute/scf-customer-reporting
~~~

Use the exact archive directory containing **operation-selection.json**, **complete-operator-result.json** and **original/**. If they are at the ZIP root, omit **--archive-root**. This is an explicit member selection; the programme does not guess among historical or copied operator directories.

The input identity is the whole ZIP SHA-256. The source root must contain the following original outputs from open_programme.py and operator-browser.mjs:

| Original member | Binding used |
|---|---|
| operation-selection.json | Original case/version/plan/planning SHA, commissioning manifest, all three installation IDs/revisions/plan SHAs |
| complete-operator-result.json | Complete original browser result and original case/version |
| original/browser-result.json | Original completion, cold reopen, all 15 actual downloads, complete customer/source roster |
| original/complete-original-programme.json | Full native case and version, inspected internally |
| original/CASE_ID-saved-edition.json | Exact saved row identity and its complete preview.document |
| original/COMPANY-complete-saved-input.json | Exact editable input download; must equal the entire saved native document |
| original/COMPANY-original-workshare.json | The full native Workshare inventory, from which only the exact original company case is selected |
| original/COMPANY-ROLE-original.json | Each complete original customer file; every byte count and SHA must match both source and download receipts |

The generator checks every source binding before reporting. The original stage and all check states remain exactly as saved. Every original check record is carried in full, including unknown future fields. The full selected Workshare and complete original customer inputs retain the five-phase details and original effort/commercial distinctions.

### Complete output

The output contains **selection.json**, **complete-result.json**, an operation lock and three ZIPs:

- Company_A_Customer_Installation_Report_r1.zip
- Company_B_Customer_Installation_Report_r1.zip
- Company_C_Customer_Installation_Report_r1.zip

Each package also has its own **.sha256** sidecar and **.receipt.json**, carrying only that selected customer's package identity and provenance. Deliver the selected report ZIP with its own receipt. The full internal result supplies all three package byte counts, SHA-256 values, manifest hashes, installation IDs/revisions, recorded stages and source/check counts. Generated ZIPs use sorted members and a fixed ZIP timestamp. Repeating the same selected input/source/output produces the same package bytes.

The first selection binds the exact original archive, explicit member root, operation ID, receiver source and guide bytes. Keep those inputs and reuse the same output after interruption. Published files are create-only and must match existing complete bytes. An acquired OS file lock protects one output lifetime. The generator reopens and verifies all completed packages before returning success.

For a later actual native installation edition, retain its completed operator archive and select a new reporting output directory and operation ID. The earlier complete reporting edition stays available for comparison.

## Contents of each company package

| File | Purpose |
|---|---|
| REPORT.html | Standalone readable company report with recorded stage/checks, full installation, selected Workshare and expandable complete original files |
| REPORT.md | Full portable text report, preserving every check record and the full installation/Workshare |
| reporting.json | Structured reporting edition and exact original bindings |
| installation-input.json | Original full editable native input download, unchanged bytes |
| workshare-selection.json | Complete selected original Workshare case, serialized without other inventory cases |
| original-files/ROLE.json | Every one of the company's three original source files, unchanged bytes |
| tables/checks.csv | Every original check with ID, recorded state, operator/time/note and complete check JSON |
| tables/source-files.csv | Complete original source identity, role, bytes and SHA-256 roster |
| tables/commercial-selection.csv | Actual selected commercial object, hours, phase count and saved stage |
| manifest.json | Exact package closure, source and native identity bindings, every member byte count and SHA-256 |
| software/customer_reporting.py | Complete local reporting/receiving/comparison programme |
| software/OPERATING.md | Complete receiving/comparison guide generated solely from this customer's original binding |

Open **REPORT.html** after receiving. It runs without JavaScript or a server and fits desktop or narrow screens. Every customer-authored value is HTML-escaped. All full source records remain available as files and readable JSON. CSV cells that could execute as spreadsheet formulae are prefixed for display; the underlying original JSON bytes remain unchanged.

The recorded proposed fee is not a payment receipt. Recorded hours retain their original source's meaning. A report receiver's successful byte verification is not implementation acceptance. The full source correspondence and original phase criteria explain the actual business state.

## Independently receive a company package

Use the exact package SHA returned in complete-result.json:

~~~bash
python3 software/customer_reporting.py receive \
  --archive /absolute/Company_A_Customer_Installation_Report_r1.zip \
  --sha256 EXACT_RETURNED_PACKAGE_SHA256 \
  --output /absolute/received-iem-report
~~~

The receiver validates the complete ZIP population, duplicate/path/link safety, member sizes/hashes and all report/source bindings. It reconstructs the report and CSV/HTML/text views from the original input and selected source and compares their complete bytes. It then retains:

- original-report.zip — exact received package;
- selection.json — the original receiving identity;
- package/ — the complete received source, documents, tables and manifest;
- complete-result.json — actual archive/manifest/report identity, source/check counts and recorded stage.

Every written file is reopened and compared. Reusing the exact received output returns the same result after verifying all original bytes. A changed archive or member does not overwrite an existing selection. There is no business-database import in this reporting receiver: continuing the actual installation uses the original SCF application and full native handover.

## Compare later complete reporting editions

Receive and keep both selected report ZIPs, then:

~~~bash
python3 software/customer_reporting.py compare \
  --before /absolute/Company_A_Customer_Installation_Report_r1.zip \
  --before-sha256 EXACT_EARLIER_SHA256 \
  --after /absolute/Company_A_Customer_Installation_Report_r2.zip \
  --after-sha256 EXACT_LATER_SHA256 \
  --output /absolute/company-report-comparison
~~~

Both packages must identify the same original commercial case and installation. The complete comparison includes:

- installation field additions, removals and changed full values;
- all check changes keyed by original check ID;
- full selected Workshare changes;
- original customer source additions/removals and changed byte identities.

Checks retain stable original identities. Arrays without a declared native identity retain their complete before/after values rather than being assigned invented keys. Each difference has a content-derived ID and its full original value. Both complete input ZIPs remain in the comparison output. No row cap or truncated value is applied.

comparison.json and differences.csv are complete. READ_COMPARISON.md explains the retained selection. Apply implementation observations, acceptance decisions or commercial changes only through the existing original SCF operating controls; the reporting comparison is the complete review material for that work.

## Identity, recovery and provenance

The package binds the native installation's own SHA separately from the SHA of its saved-row JSON bytes. The original editable input is compared to the full preview.document; its unchanged downloaded bytes are retained in the report.

All original customer source files must match both the native originalFiles roster and the actual browser download receipt. The companion uses the exact selected Workshare case and preserves the full native selection object. It does not use a reconstructed fee/phase/effort model.

The report manifest identifies the full original operator archive, source case/version, plan/planning digest, commissioning manifest, full operator selection, browser result, original saved row, original Workshare inventory and observed browser completion. The internal programme and source archive remain the authority for independent cross-checking of those original receipts.

The companion rejects an archive whose explicit operator root is incomplete. Obtain the complete existing source package rather than synthesizing missing receipts, replacing original IDs or creating an empty workspace.

## Source ownership

These two reporting files are complementary to the maintained native application, customer operator and accepted-quotation Installation programme. They belong under:

    stellar/scf_2026/sf47_budget_model/workspace/company_returns/

The original grant budget, customer Workshares, sales correspondence and installed implementation states remain with their existing owners. The report packages are complete selected source snapshots for those continuing relationships.
