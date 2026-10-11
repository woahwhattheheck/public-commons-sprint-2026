# Burbank ERP delivery workspace

A local project operator for Burbank IT-2026-001, built into the maintained ERP
conversion service. It joins proposal responses, interface plans, delivery phases,
24-month staffing, five-year fees, original files, conversion trials and receiving
reviews in one private workspace. The shared service remains responsible for
immutable input bundles, comparison jobs, correction ancestry and replay exports.

The interface uses grayscale tables and forms. It runs on Linux with Node.js 22 or
newer, Python 3, `flock` and `tar`; there are no npm dependencies. Python supports
native workbook editing and authenticated archive restore. Optional extraction of
RFP pages also uses `pdftotext`.

## Start a workspace

From this profile directory, acquire the public worksheet catalogs into a private
source directory:

```sh
node adapters/materialize-reference.mjs \
  --reference /absolute/private/burbank-reference

node workspace/cli.mjs serve \
  --directory /absolute/private/burbank-service \
  --reference /absolute/private/burbank-reference --port 8786
```

The materializer retrieves the original public previews using the locations in
[the acquisition manifest](adapters/source-acquisition.json). It retains native
worksheet values, source rows, preview locations and byte hashes, and writes seven
JSON catalogs plus `SOURCE_PINS.json`. The [adapter guide](adapters/README.md)
explains cached/offline acquisition, optional original-PDF extraction and Oracle
and GIS capture.

Open the private URL printed by `serve`. The original host binds to `127.0.0.1`,
uses a new access token for each launch and enforces its existing same-origin
request controls. Use a local browser or an authenticated loopback tunnel to the
chosen machine. Keep the printed access URL within that operator session.

The first launch verifies and retains the catalog under the private service
folder. Later launches use those exact retained files, including after restore:

```sh
node workspace/cli.mjs serve \
  --directory /absolute/private/burbank-service --port 8786
```

A refreshed public preview cannot silently replace the source of an existing
project. The original catalog contains 977 numbered requirements, six System
continuation rows and 23 interface entries. A changed source census requires an
explicit source update. For a new procurement revision, materialize to another
reference directory and initialize a separate workspace.

Select **Burbank project**, enter the operator's name, and create a project with a
stable ID, respondent organization, delivery owner and scope. **Practice** mode
labels local exercises; **Project** mode labels actual project planning. Several
projects can use the same retained source catalog. All changes use the revision
shown in the browser; a competing edit asks the operator to reload current work.

## Work across the whole delivery

| Section | Operator workflow |
| --- | --- |
| Overview | Maintain organization, owner, scope and working notes; inspect response, interface and review progress. |
| Requirements | Search the full source, filter by worksheet/owner/response, select every matching row, assign work in bulk, and edit exact native responses, modules, phases, comments, support files and review decisions. |
| Interfaces | Plan each original interface using the native E–L headers and choices, name delivery owners, retain source files and link receiving reviews to original comparison reports. |
| Delivery | Plan the ten staffing phases and readiness milestones, including dependencies, owner, date, outcome and supporting original files. |
| Staffing & fees | Allocate Offeror and City staff across 24 months; plan Included/Optional software, five annual fees, services and other costs; edit the eight native price-summary notes. |
| Trials & reviews | Bind a stable trial family and iteration to the project revision and native requirement/interface IDs, then use the original intake, comparison, correction and review workflow. |
| Files & export | Retain original attachments; import response cells; export all native response rows, original workbook overlays, project history and a complete private handoff. |

Money and staffing hours use exact decimal arithmetic. A blank amount remains
unknown and is counted separately from an entered zero. Included and Optional
prices have separate summaries. The original resource labels, including
`Accounting / GL`, `Grants / Projects`, `AP` and `AR`, remain unchanged so native
workbook resource summaries can match them.

### Native response meaning

The published acceptance workbook uses **Y, Y-WC, N and I**. Y and Y-WC describe
included fixed-fee commitments; Y-WC and I require written explanations. Its
requirement phases **1, 2 and X** remain within the fixed-fee proposal. These are
separate from the delivery/staffing phase list 1–10.

The source discrepancy between the RFP narrative's Y-ND and the workbook's Y-WC
remains visible. The published acceptance attachment also has an internal title
that differs from its document-index attachment number. The software preserves
the original cells and identities. It does not turn a passing comparison into a
vendor's proposal response.

The profile records the original RFP deadline as **November 12, 2026 at 4:00 p.m.
Pacific**, page 44. The City's current purchasing notices and addenda remain the
submission authority. Delivery planning includes the original page 69–70 support
requirements: at least 12 months of hypercare, quarterly update regression and UAT
at least 30 days before go-live.

## Capture, compare, correct and review

The maintained conversion operator supplies nine Burbank cohort templates: ledger,
payroll, vendors, payables, employees, assets, budget, receipts and GIS assets.
Select the cohort and then use the Burbank **Trials & reviews** section to choose a
trial family, iteration, kind and original requirement/interface references.

1. Open the original **Intake & mapping** view. Select actual source and target CSV
   files, define the relevant keys, amount/group/attribute fields and approved
   crosswalks, and review the declared population and mapping.
2. Stage the input bundle. The service retains the exact source, target and mapping
   bytes. The Burbank extension attaches a small reference to the full immutable
   project snapshot, keeping the catalog outside the shared mapping-size limit.
3. Execute a stable job ID and inspect the original report. Record the reviewer,
   decision and receiving observations against that exact report.
4. For a correction, use the original linked-correction control, retain the
   appropriate source, select the corrected target and document the change. Run a
   new job ID. Both the earlier result and corrected result remain available.
5. In the Burbank requirement/interface detail, load original reports and record
   the receiving decision. The server checks that the report belongs to this
   project and that its SHA matches the original completed run.

Opening an old bundle displays the project revision used for that trial. Select
**Load current project** to edit current planning. Editing a later project cannot
relabel an earlier comparison. Use the original recovery controls to resume an
interrupted run; do not create another job merely to hide the interrupted one.

### Source adapters

The [adapter guide](adapters/README.md) includes runnable CLI and API examples.

- **City ArcGIS:** capture an explicit layer and selection; retain native schema,
  ID census, pages and geometry; verify every returned ID batch; resume retained
  pages after interruption; project scalar CSV and exact JSONL for the operator.
- **Oracle EBS 12.2:** inspect the actual selected tenant WADL, select an advertised
  GET resource and its native record contract, and capture its declared paging
  response with original byte retention. Credentials come from named environment
  variables. A configured deployment endpoint is required.
- **GL_INTERFACE:** map original rows to the native column contract using approved
  ledger/chart/lookup configuration, retain exact values and source rows, and
  produce the native-column CSV, JSONL and complete issue counts for the selected
  loader. The existing comparison engine handles conversion reconciliation.

The City GIS population used during the implemented journey contained 2,742
pavement features across 14 pages and 84 scalar columns. Start/end ID consistency
is recorded; it does not establish that every attribute came from a transactional
snapshot. Native Oracle capture and target ERP imports require their actual
configured tenant connections.

## Original workbook response exports

Upload the issuer's original XLSX files under **Files & export** and select their
correct template kind: requirements, interfaces, staffing or price. Original
uploads are stored by SHA. Requirements and Interfaces response imports validate
all source cells before importing their respondent fields. Staffing and fee
planning use the workspace forms.

Workbook export overlays only the native respondent cells. It preserves the
original workbook ZIP members, namespaced XML, formulas, formatting and source
cells, and requests recalculation when reopened in the selected spreadsheet
application. The original formulas are not calculated by this local service.
The price overlay uses the actual Other Fees **C** cost column despite a conflicting
instruction label, and includes all eight editable Summary notes.

The native templates have finite input areas: 30 staffing rows for each side,
27 software rows, 27 service rows and 15 other-fee rows. The project can plan more
rows; CSV and JSON exports retain them all. An XLSX overlay reports an exceeded
original template capacity instead of silently omitting planned work. Expand the
approved original template deliberately before producing a larger native response.

Public previews supply original cell values, but they do not contain the issuer's
XLSX formulas and formatting. The distributable includes the original-cell adapter;
execution against the four issuer XLSX files awaits those original file bytes.
No original-template export is represented as completed in the recorded journey.

## Transfer a project and restart the operation

**Download complete project handoff** produces one private tar.gz containing the
project snapshot/history, original catalog, uploaded files, full response exports,
every completed comparison replay and earlier project plans used by those trials.
`MANIFEST.json` lists exact member sizes and hashes. Replay packages contain the
original service identity key: this is a private operational transfer.

Pending job identities appear in the project handoff. A complete operational
restart, including pending input bytes and the original service identity, uses the
encrypted backup. Stop the Burbank host, let its original worker finish and stop
any other process writing that service directory before backup. The command takes
the host, queue, runtime and project leases while archiving.

Set a passphrase of at least 16 characters in the named environment variable. For
an interactive Bash terminal, enter it without echo:

```sh
read -r -s -p 'Backup passphrase: ' BURBANK_BACKUP_PASSPHRASE
export BURBANK_BACKUP_PASSPHRASE

node workspace/cli.mjs backup \
  --directory /absolute/private/burbank-service \
  --output /absolute/private/backups/burbank-2026-11-01.burbank \
  --passphrase-env BURBANK_BACKUP_PASSPHRASE

node workspace/cli.mjs restore \
  --directory /absolute/private/burbank-restored \
  --input /absolute/private/backups/burbank-2026-11-01.burbank \
  --passphrase-env BURBANK_BACKUP_PASSPHRASE

unset BURBANK_BACKUP_PASSPHRASE
node workspace/cli.mjs serve \
  --directory /absolute/private/burbank-restored --port 8786
```

The output parent directory must exist and the backup filename must be new.
Restore requires a new destination directory. AES-256-GCM authenticates the whole
archive before extraction, with a scrypt-derived key; restore then validates the
original service and project signatures before publishing the destination.

## Completed operation and integration

The completed local browser journey used the original 2,742 City GIS records and
one deliberately changed local target attribute. It retained the first failed
report and review, ran the linked correction to a clean report, recorded the
receiving decision and downloaded the whole project handoff. It also assigned
380 Finance requirements in one operation, planned delivery phases and both sides'
24-month staffing, and retained the native capture as an original interface asset.

The encrypted backup restored all 77 retained members, original inputs, both
report identities, reviews, assets and project revision 14. A cold browser reopened
the restored workspace independently of the original reference directory and
showed the corrected report and review. The desktop and 390-pixel mobile views
had no page errors or outer horizontal overflow. All 25 project-handoff members
matched their manifest hashes. These are retained local project results, not a
City ERP deployment or proposal submission.

This profile adds no workflow, separate payment engine or second reconciliation
service. It uses the existing
[operator](../../scap-workspace/README.md),
[reconciliation service](../../service/README.md) and shared process lease helper.
The released package contains application code and source-retrieval locations;
acquired documents and operational data are inputs to each private workspace.

## Source locations

- [City Purchasing and PlanetBids](https://www.burbankca.gov/web/financial-services/purchasing)
- [Original IT-2026-001 RFP](https://media.governmentnavigator.com/media/bid/1791505728_RFP_IT-2026-01_ERP_Software_and_Services.pdf)
- [Published attachment index](https://craxy.ai/find-rfps/cmuzd85nn00gmzr09q8d4cq4c)
- [City pavement layer](https://mobilegis.burbankca.gov/burgis/rest/services/Planning/Core_Transportation/MapServer/4)
- [Oracle and Esri primary technical references](adapters/README.md#primary-technical-references)
