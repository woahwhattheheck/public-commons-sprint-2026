# Cryptoworth receiving in the merchant accounting workspace

This desk takes an original merchant accountant handoff through an actual
Cryptoworth template, source selection, native receiving comparison, accountant
return and portable handover. It runs inside the existing accounting workspace
and retains its selected report, native input manifest, original transfer proofs
and adjustment companions.

Open **Cryptoworth** from the accounting workspace navigation, or open
/cryptoworth.html at the owner's printed local URL. The command line is
merchant-accounting-workspace cryptoworth; node workspace/server.mjs cryptoworth
uses the same implementation. Run either command with --help for every route.

## Start with the actual provider files

Download the CSV template from the selected manual connection in Cryptoworth:
**Transactions → arrow beside Calculate → Import → Choose a source**. The selected
connection supplies the original template. Keep its exact headers, order,
delimiter, optional columns and date requirements.

The maintained provider guide documents seven required roles:

| Role | Documented template label | Selection |
| --- | --- | --- |
| Date | Date Time (UTC) | Actual original column and explicit date interpretation |
| Asset | Crypto Id | Chain-specific native Crypto ID |
| Direction | Type | RECEIVE for verified merchant receipts; SEND for verified refund cash |
| First quantity | Amount One | Exact native atomic amount rendered at the chosen asset scale |
| First asset type | Amount One_Type | Actual value accepted by the selected provider template |
| Second quantity | Amount Two | Equal transfer quantity in the selected asset |
| Second asset type | Amount Two_Type | Equal transfer asset type |

The template inspector suggests these mappings only when the actual supplied
header matches. Map every remaining column explicitly to a supported role or a
literal constant, including empty optional cells. Receiver-generated row and
ledger IDs stay in provider columns supplied as explicit constants; the separate
source index retains every original source ID.

Get Crypto IDs from **User options → Asset Search**, selecting the actual chain
and asset. A ticker does not determine the chain-specific receiving ID. Bind
each ID to the source network, original asset digest, accepted amount type and
actual decimal scale.

The mapping includes the receiving entity, selected manual connection and
original merchant account. Names help the operator; the exact IDs and native
account bind the operation. Each saved profile is immutable. Download its retained
template and use it as the next mapping edition when the provider template,
connection, date convention or asset mapping changes.

Sources:

- [Native manual import](https://help.cryptoworth.com/en/articles/10396994-how-to-bulk-import-manual-transactions)
- [Chain-specific Crypto IDs](https://help.cryptoworth.com/en/articles/10426331-how-to-find-the-crypto-id)

## Select the exact accountant source

Choose the original accountant handoff and an explicit revision: **initial** or
a retained returned revision UUID. A period-close handoff carries that closed
period's frozen adjustments even when later live refunds exist.

The source drawer contains verified merchant cash, separately verified refund
cash, and the original cancellation/pending/refund context. Gross merchant
amounts remain original. Pending refunds and cancellations retain their context
rows. Verified refunds generate separate SEND movements with the original
reverse-transfer proof.

The native movement identity is stable across handoffs and accounting periods.
Each original occurrence also has a selectionId. When several original delivery
events refer to the same cash movement, select the actual occurrence to include;
duplicate included cash remains visible as a conflict.

Each movement can be included, excluded with a reason, or attributed to an
already imported native unit with a reason and actual reference. Previously
matched native captures supply coverage automatically. The next-period plan
retains that coverage and includes only newly selected cash.

If the original verified payment proof lacks its transfer timestamp, attach the
actual native date source file, UTC transfer timestamp and source note. This
continues the existing proof while preserving its bytes. An attached source
cannot replace a different timestamp already present in the original proof.

The source index retains original event IDs, occurrence IDs, transaction hashes,
native proof identities, amounts, decisions and receiving coverage. The provider
CSV contains the actual provider columns in their original order.

## Choose the date convention explicitly

The provider's import documentation uses both a UTC column label and an account
timezone setting. The saved profile therefore requires an explicit format and
timezone rather than inferring either from a column title.

| Format | Output | Timezone |
| --- | --- | --- |
| ISO_UTC | Complete UTC ISO instant | UTC |
| UTC_SECONDS | YYYY-MM-DD HH:mm:ss | UTC |
| UTC_DATE | YYYY-MM-DD | UTC |
| ZONE_SECONDS | YYYY-MM-DD HH:mm:ss | Selected IANA timezone |
| ZONE_DATE | YYYY-MM-DD | Selected IANA timezone |

The review retains the original full UTC timestamp alongside the formatted
provider value. Date-only or second-only exports have their chosen precision.
Repeated source movements that collapse to the same received representation
remain ambiguous until a more precise actual export or identity column resolves
them.

Quantities use exact integer/decimal conversion. Source atomic strings stay
strings through rendering and comparison. Crypto IDs, ledger IDs, connection IDs
and received row IDs also remain literal text, including long integers and .0
suffixes present in native exports.

## Review and save an import plan

Preview the exact selected source, mapping edition, decisions and date evidence.
Resolve selected source issues before downloading import.csv. An exportable
plan has at least one READY row and no BLOCKED rows. Excluded, covered and context
rows remain in the companion review.

Saving retains plan.json, source.json, the original source companions,
source-index.csv, readable review.html, actual date evidence and the exact
import.csv when exportable. Reopen the same plan after the browser or owner
restarts. A changed source or workspace revision requires a new preview.

Import the exact reviewed CSV into the selected native entity and manual
connection. Retain its actual native import ID, receiving time and operational
reference.

## Capture the native result

Cryptoworth supports **Export in Input Format** under the Transactions CSV export
flow. That preserves the selected import layout. A standard selected-column
export has a different schema; choose **Mapped export** and bind its actual
columns, date convention, quantity sign and grouping explicitly.

The received file can be obtained from Transactions / Export History or
Entity History / Reports / Exports. Capture its actual native import unit and
original file bytes.

For input-format comparison, headers and order must match the retained profile.
For a mapped export, the required roles are date, Crypto ID, direction and
primary amount. Additional native transaction, ledger, row, connection and
secondary-asset fields strengthen the source match.

Standard exports may show outgoing primary amounts as negative and thousands
separators in quantities. Choose SEND_NEGATIVE for the actual primary convention
and "," as the grouping separator when present. Secondary amount sign is a
separate explicit choice. The comparator preserves the selected file's literal
identities and reports invalid signs, precision or grouping as received issues.

An IMPORT_RETURN capture belongs to the selected entity and manual connection.
A BASELINE capture can describe an existing native connection in the same entity;
it provides source-matched coverage for historical or live-feed overlap.

| Comparison state | Operator meaning |
| --- | --- |
| MATCHED | One exact original movement matches one received row |
| CHANGED | The matching native identity/date group has changed mapped values |
| MISSING | A selected movement is absent from the native file |
| UNEXPECTED | A received row has no selected source match |
| AMBIGUOUS | The actual representation cannot distinguish several source/received rows |
| DUPLICATE_RECEIVED | Received rows repeat a cash movement or native row identity |
| INVALID | A received row fails the explicit selected layout or value rules |

Save the preview to retain received.csv, capture.json, comparison.csv and the
readable review. Later native captures can update coverage for the same import
unit. A missing or changed later observation withdraws that unit's earlier
coverage for the affected movement.

Sources:

- [Native transaction export](https://help.cryptoworth.com/en/articles/13141713-how-to-export-transactions)
- [Historical and live migration boundary](https://help.cryptoworth.com/en/articles/12327176-switching-to-cryptoworth-from-another-platform)

## Return matched work to the original accountant

Select a saved native capture and the actual current accountant parent revision.
Choose Reviewed or Booked, the actual book reference when Booked, optional
account code, and the operator's note.

The return changes only the original accountant's editable external fields.
Original source columns, gross cash and all frozen refund/cancellation fields
remain protected. An original event is eligible when every selected cash
movement is matched in the capture or has active native coverage. Other event
rows retain their existing accounting values.

The desk saves the exact request and matched-return.csv before calling the
original accountant importer. The same return UUID identifies both sides:

- PREPARED retains the exact request and original preview before native apply.
- COMMITTED retains the actual original accountant return and its complete packet.
- SUPERSEDED retains an unapplied request after the original owner confirms that
  its accountant parent or active native coverage changed. Review a new UUID
  against the current source.

After an interrupted save, reopen that exact request. If the original accountant
return already exists, the desk rejoins its saved result and all original source
companions. If a prepared request still has the same source, it retries the
same original request. A concrete parent or coverage change produces SUPERSEDED;
its files and history remain available.

The returned packet includes the original selected report, manifest, input
manifest, period-close context when present, and all three adjustment companions:
adjustments.json, adjustments.csv and adjustments.html.

## Retain a completed native rollback

Use Cryptoworth's original import unit:
**Entity History → Transactions → Imports → selected import → Rollback**.

After that native operation completes, record its exact import ID, actual
completion timestamp, operator, reason and reference in the desk. The rollback
belongs to the complete entity/connection/import unit. It withdraws future
coverage from every saved capture of that same unit, while retaining their files
and the previous accountant returns.

Choose the replacement native unit and prepare a new plan/capture for subsequent
receiving. The original history remains available for review and handover.

[Original import rollback](https://help.cryptoworth.com/en/articles/10424777-how-to-roll-back-imported-transactions)

## Export and reopen the complete receiving packet

The packet includes its primary plan and all original mapping/profile/plan/capture
dependencies that justify prior receiving coverage, along with actual template,
native input/output files, date sources, accountant return stages/results and
applicable rollback history.

Inspect the packet before receiving it. The receiver verifies every included
byte/hash binding, reconstructs the source and exact import plan, recomputes
native comparisons, and regenerates the original accountant return. It then
merges immutable identities into the same original product. Existing later
captures and returned history remain retained.

The primary plan records each actual received packet SHA. Reopening an uncertain
receive checks that exact SHA; a preexisting plan ID alone does not indicate
that its later packet was received. Repeating a successfully received packet
can restore missing exact files and returns the same saved identity.

Original accountant application continues where its original handoff exists in
the receiving workspace. The included source and saved returned packets remain
readable and downloadable through the same desk.

## Command line and retained private inputs

Use --url for the existing running owner. Use --workspace for an existing stopped
accounting workspace; the command acquires and closes its original lease.
The browser, API and command line use the same controller and saved identities.

Request files use the HTTP fields. The CLI can read an actual local source
through this path form:

    {"file":{"path":"/private/provider-template.csv"}}

dateEvidence[].file accepts the same form. A saved preview contains the
normalized complete bytes, UUID, source SHA, workspace identity and destination
route. Use that exact preview file for its corresponding save command.

New CLI outputs are private and are published atomically at the requested
destination. An existing destination is accepted only when it already contains
the exact same bytes. Read-only status/rows/download operations do not launch
another native importer.

## HTTP routes

Every route is under /api/cryptoworth. Supplied workspaceId must match the actual
owner before any preview or mutation. Limits are 1–200 rows per page, 64 MiB per
actual CSV/date source and 128 MiB for a complete encoded receiving packet.

| Method | Path | Operation |
| --- | --- | --- |
| GET | / | Workspace identity, source handoffs and saved profiles/plans |
| GET | /source | Explicit handoff/revision source with offset/limit/search |
| POST | /templates/inspect | Actual template header/format inspection |
| POST | /profiles/preview | Immutable mapping preview |
| POST | /profiles | Save that exact preview |
| GET | /profiles/:id | Retained mapping and original file list |
| GET | /profiles/:id/download/:name | Actual saved template/profile bytes |
| POST | /plans/preview | Selected source/coverage/import review |
| POST | /plans | Save the exact selected plan |
| GET | /plans/:id | Plan, captures, returned history, packet receipts and files |
| GET | /plans/:id/rows | Paged source decisions |
| POST | /plans/:id/captures/preview | Actual native file comparison |
| POST | /plans/:id/captures | Save the exact capture |
| GET | /plans/:id/captures/:capture | Retained native comparison/files |
| GET | /plans/:id/captures/:capture/rows | Paged comparison rows |
| POST | /plans/:id/returns/preview | Original protected accountant return |
| POST | /plans/:id/returns | Stage, apply or recover that exact return |
| GET | /plans/:id/returns/:return | Retained prepared/superseded/completed history |
| POST | /plans/:id/rollbacks | Record completed original import-unit rollback |
| GET | /plans/:id/download/:name | Original plan/capture/return/rollback bytes |
| GET | /plans/:id/packet | Complete source and receiving packet |
| POST | /packets/inspect | Reconstructive original-source inspection |
| POST | /packets/receive | Merge exact retained identities and files |
