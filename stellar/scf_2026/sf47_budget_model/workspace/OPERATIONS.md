# SF47 delivery and cash operations

This desk extends the original SF47 planning workspace. Open **Delivery operations** in the existing browser or use the existing CLI's `operations` command. It uses the same workspace directory, SQLite connection, process lease, private access link and retained request receipts. No additional service or database is needed.

## Working from a saved plan

Open a case from a saved planning revision. The case retains the exact scenario, staffing/payment plan, native calculation, source file identity and saved report. Later forecasts do not rewrite that selected revision. The browser lists every operations case in the workspace, including received cases whose planner history was imported under a new native plan ID. Each case displays its own pinned plan.

Choose **Operations** for observations from actual work and original sources. Choose **Walkthrough** for fictional internal demonstrations. A walkthrough banner remains visible in the browser, report and complete export. Forecast contributions, capital and conditional grant payments never populate recorded work or cash automatically.

The recording operator is retained in every mutation. Each command uses an explicit case version and stable request ID. Reuse the identical request to recover an uncertain response; read the case before composing a different action. A conflict preserves the accepted change.

## Complete working cycle

1. Add the accountable contributors or suppliers and retain their original work, invoice, agreement or source documents.
2. Record completed work against an original work-package ID, or explicitly leave it unplanned. Submit and accept the work internally. Reopening preserves the former values and review reason.
3. Record invoices with individual lines and links to the contributor's completed work. Review, dispute or reopen them. Amounts remain liabilities until an observed payment is allocated.
4. Record actual cash with its original reference, currency/asset, network, date and optional tranche. A non-USD amount needs a separately retained USD valuation to enter USD totals. Exact asset quantities remain visible even when unvalued. Testnet observations remain outside real cash totals.
5. Allocate actual outflows across retained invoices. Partial payments, open balances, overpayments and refunds are shown separately. Cash observations are immutable; void an incorrect observation and enter its correction with the original history intact.
6. Record issuer acknowledgements, invitations, submissions and award agreements at the stage their source supports. An award agreement and a grant receipt are separate records.
7. Track merchant/buyer deployments, accountable operators, source releases, native endpoints, delivery work packages and receiving-operator handovers. Retain original purchase transaction, intent, request, operation, reservation, merchant event, terms, output and timing identifiers when available.
8. Record recovery as a later observation of the same purchase. Settlement and output completion are independent. Cancelled attempts retain the original attempted denominator. Original missing intent or timing joins remain visible; a captured summary does not invent them.
9. Compare the pinned plan with recorded hours, accepted work, invoice liabilities, paid allocations, actual cash and delivery outcomes. Freeze a review, close that exact business snapshot, or reopen it with a reason.
10. Export a complete operations ZIP. Receive it through **Import complete case** or the CLI to retain the original planner history, selected revision, exact attachments, records, events and frozen reviews. Reopening uses the original lifecycle.

An internal work review, recorded outcome or case close does not create an issuer award, an external acceptance, a paid invoice or an executed customer agreement.

## Original source intake

The optional original-source importer accepts a private `scf.operations.source-intake.v1` packet. It verifies the exact embedded source bytes and their identities, then records the packet and both original documents in one original workspace transaction.

The currently supported intake is the original pre-award case: an issuer interest acknowledgement and the seven retained team-operated Stellar testnet purchases. It retains the supplied source stage and exact atomic amounts. It creates no award, grant receipt or customer cash record. Original transaction references are reused; no payment is executed.

The private packet is an operator input. It is not bundled in the public source distribution. Do not add a live operating case or its attachments to the public repository.

## Existing CLI

Run commands from the original `sf47_budget_model` directory. Use the established launcher/distribution alias when installed; these examples show the same Python entry point. Do not run a second workspace owner while its server holds the original process lease.

```sh
python3 workspace/cli.py operations --workspace /private/scf-workspace list

python3 workspace/cli.py operations --workspace /private/scf-workspace create \
  --plan PLAN_ID --selected-revision 5 --expected-content-sha256 PLAN_SHA256 \
  --name "Delivery operations" --mode OPERATIONS \
  --actor "Recording operator" --request-id open-delivery-001

python3 workspace/cli.py operations --workspace /private/scf-workspace command \
  --case CASE_ID --expected-version 2 --action work.save \
  --data /private/completed-work.json --actor "Recording operator" \
  --request-id completed-work-001

python3 workspace/cli.py operations --workspace /private/scf-workspace intake \
  --plan PLAN_ID --selected-revision 5 --expected-content-sha256 PLAN_SHA256 \
  --name "Original pre-award operating record" --actor "Receiving operator" \
  --request-id original-source-intake-001 --file /private/original-source-intake.json

python3 workspace/cli.py operations --workspace /private/scf-workspace export \
  --case CASE_ID --expected-version 24 --output /private/delivery-operations.zip

python3 workspace/cli.py operations --workspace /private/scf-workspace import \
  --file /private/delivery-operations.zip --name "Received delivery operations" \
  --actor "Receiving operator" --request-id receive-delivery-001
```

Commands also include `show`, `report`, paginated `history`, `attach`, exact `source` download and frozen `review`. Output files are written privately to new filenames; an existing destination is not silently replaced. Complete exports contain no workspace access key.

The original planning export remains available in the top bar as **Export planning workspace**. The operations **Export complete case** includes that native planning ZIP plus the full operations record.

## One joined receiving walkthrough

`operations_walkthrough.py` attaches to an already-running original server. It starts no listener, imports no alternate application and makes no external payment. The original planner/browser owner can run it against its retained workspace:

```sh
python3 workspace/operations_walkthrough.py \
  --url http://127.0.0.1:PORT \
  --access-key-file /private/scf-workspace/access.key \
  --plan ORIGINAL_PLAN_ID \
  --output /private/scf-operations-receiving \
  --source-intake /private/original-source-intake.json
```

The optional source input creates a separate real-source case. The fictional workflow copies the saved plan, retains work and an invoice, resolves a dispute, records partial payments and a clearly fictional receipt, follows an original purchase through partial output and recovery, preserves a cancelled attempt, and freezes/closes/reopens a review. It exports and receives the complete case, checks exact retained attachments and records, and verifies that rejected import requests cannot create extra original plans.

The private checkpoint retains each exact request before sending it. Reuse the same output directory, selected plan and source packet to resume after an interrupted response. It does not replay accepted workflow mutations. The resulting archive and report are private walkthrough artifacts, separate from the public source.

The source handoff does not by itself claim this receiving walkthrough has run. Its result file is written only after the actual original API operations complete.

## Browser receiving and presentation

After native receiving, open **Delivery operations** in the same original desktop/mobile browser. Select the original source case for the interest acknowledgement, zero recorded grant/customer cash, seven team-operated testnet purchase observations and exact source downloads. Select the separately named walkthrough case for supplier work, invoice allocation, recovery and close/reopen controls.

A short presentation may show the original source case's plan/actual summary and deployment/purchase table. Keep its pre-award stage and team-operated testnet labels visible. Demonstrate fictional payment or award behavior only with the walkthrough banner visible.

## Storage and recovery boundaries

New tables use the `ops_` prefix. Existing planner tables and `budget.py` are unchanged. Source attachments are exact bytes, at most 8 MiB each and 24 MiB/200 files per case; complete received bundles are at most 32 MiB. Source files are forced downloads rather than executable inline pages.

Archive receiving validates the operations source set and history, then checks its selected immutable revision against the nested original planning history before a native plan is created. The existing request receipt is checked before the original importer mutates. The original planner owns its complete archive validation and source-byte restoration. A receiving plan gets a new ID; retained business records and original history remain intact.

Aggregate export holds the original mutex and one SQLite read snapshot, borrowing a transaction when one is already active. The original OS lease still governs the single workspace owner. Backup/export, source intake and case reopening use this existing product's lifecycle.
