# Supplier workshares in the original Installation desk

Receive a complete supplier proposal as an original Workshare, prepare its useful
customer task, and continue that same Installation through review, operation and
whole-case receiving. The catalogue and order programmes share the original
Operations writer, source records, phase acceptance, effort allocation and
commercial history.

Start from the customer's complete source packet. The preparation command retains
the original bytes and constructs the two formats already read by
`operations_workshare_installations.py`. It calls the original
`workshare_intake.load_workshares(..., require_proposed_usd=False)` before publishing
anything. EUR and other quoted currencies keep their original amount, status,
milestone labels and triggers.

## Choose the customer programme

| Profile | Complete useful workflow | Actual commissioning selections |
| --- | --- | --- |
| `supplier-catalogues` | Retain full supplier editions, reuse the mapping, review corrections, operate the selected PIM import, deliver each full current recipient catalogue, receive and reopen the complete customer workspace | Original feed bounds and editions; full/delta/base semantics; one documented customer import contract; recipient BMEcat/ETIM rules; named source, recipient and receiving owners |
| `supplier-orders` | Retain original orders and revisions, select the customer profile, operate complete confirmation/dispatch/invoice drafts, explicitly send the reviewed documents, preserve provider responses, receive and return an editable customer workspace | Supplier/entity/currency; actual source family/schema/corpus; profile and mapping; declared HTTPS channels; exact acknowledgment/recovery contract; partner and customer acceptance owners |

The catalogue programme is useful beside an existing PIM. It does not supply a
proprietary import schema or choose undocumented request paths. A contract for an
initial full edition and two supplied revisions includes all three selected
customer imports and all three complete current recipient catalogues. Apply an
explicit delta to its original base before preparing the next full catalogue.
For an agreed BMEcat full-catalogue boundary, every edition is a complete
`T_NEW_CATALOG`.

The order programme is useful beside an existing ERP, integration suite, BIS or
procurement application. The retained customer profile selects openTRANS 1.0
meaning and review rules. A different source family still needs its actual
supplied contract and selected adapter. Preserve the original Workshare if it
includes one ORDERS05-family XML or cXML OrderRequest adapter; select the real
version, extensions, full/change/cancellation examples and return boundary at
commissioning. A profile declaration does not implement that adapter.

Use the [material catalogue operator guide](../../../../products/material-catalog/OPERATING.md)
and [supplier order customer guide](../../../scf-starforge-20261009/sf30-seller-sdk/supplier-orders/GUIDE.md)
for the daily product workflow. The [supplier installation and source selection](../../../scf-starforge-20261009/distribution/selections/SUPPLIER_ORDERS.md)
and [complete supplier CLI/MCP reference](../../../../stellar-forge/mcp-merchant-operator/SUPPLIER_ORDERS.md)
name the maintained installed entry points. Select the actual delivered release
and receiving result in the original case.

## 1. Retain complete original source

Prepare a private source directory with the complete original JSON packet for
each selected commercial case. It must contain:

- `prepared_case.id`: the original customer case;
- `workshare_input.source.case_id`: that same case;
- `workshare_input.source`: the complete original source/partner/opportunity;
- `workshare_input.plan`: the whole `dealscout.workshare-plan.v1` plan.

The whole packet, including its original correspondence, scope, preparation notes
and source material, is retained. Add the original editable Workshare, mapping
contract, acceptance guide and any other selected documents as complete files.
Retain their actual filename, bytes, SHA-256, source URL and observation time.
Text or Markdown sources keep their actual media type.

A complete multi-company source collection is an internal operating-case input.
The native Installation export contains the **whole selected Operations case**.
Choose that original case and its receiving operator accordingly; deliver a
customer-facing business package through the supplier/catalogue product's own
selected-customer export route.

## 2. Select original effort and source identities

Write one `SOURCE_SELECTION.json` with schema
`stellar-forge.installation-source-selection.v1`. Keep its operation ID and
request prefix stable through an interrupted preparation. Use a new output
directory for a deliberate changed source selection.

~~~json
{
  "schema": "stellar-forge.installation-source-selection.v1",
  "operationId": "original-supplier-installation-operation",
  "requestPrefix": "original-supplier-installation",
  "receivingName": "Selected supplier workshare receiving",
  "sourceUrl": "https://example.invalid/original-authorized-source-selection",
  "observedAt": "2026-10-12T00:00:00Z",
  "cases": [
    {
      "caseId": "original-commercial-case",
      "profile": "supplier-orders",
      "packet": {
        "path": "supplier/original-packet.json",
        "filename": "supplier-original-packet.json",
        "bytes": 12345,
        "sha256": "<complete original 64-character SHA-256>",
        "sourceUrl": "https://example.invalid/original-packet",
        "observedAt": "2026-10-12T00:00:00Z",
        "mediaType": "application/json"
      },
      "planSha256": "<original selected canonical plan SHA-256>",
      "productionEffort": [
        {
          "phaseId": "original-phase",
          "hours": "16",
          "sourceFile": "supplier-editable-workshare.json",
          "sourcePointer": "/phases/0/hours",
          "unit": "hours",
          "basis": "The original editable phase and its title map to this exact native phase."
        }
      ],
      "effortTotal": {
        "hours": "16",
        "sourceFile": "supplier-editable-workshare.json",
        "sourcePointer": "/commercial/hours",
        "unit": "hours"
      },
      "files": [
        {
          "path": "supplier/editable-workshare.json",
          "filename": "supplier-editable-workshare.json",
          "bytes": 4567,
          "sha256": "<complete original 64-character SHA-256>",
          "sourceUrl": "https://example.invalid/original-editable-workshare",
          "observedAt": "2026-10-12T00:00:00Z",
          "mediaType": "application/json"
        }
      ]
    }
  ]
}
~~~

This is a field example. Replace every identity, byte count, digest, URL, time and
phase with the actual source. Include every original phase and its effort;
the example's single phase does not replace a multi-phase commercial plan.

`sourcePointer` is a JSON Pointer to the actual numeric source value.
`sourceFile` names one of this customer's declared complete files. If omitted,
the pointer resolves inside the original Workshare plan. `unit` is `hours` or
`minutes`; selected `hours` is an explicit decimal string equal to that original
value after the declared conversion. Every phase occurs once, every effort source
occurs once, and their total must equal `effortTotal`. The full original file and
mapping explanation remain in the derived commissioning source.

For a plan with `planned_effort.allocations`, point directly to each original
`/planned_effort/allocations/N/hours` and its original total. For an editable
source with `commercial.phase_hours`, retain that whole file and explain the
phase-order mapping. Do not infer planned effort from quoted rates, prose,
elapsed time or the current fee.

The plan digest uses the original Python canonical JSON convention:
UTF-8, sorted object keys, compact separators, original Unicode, finite JSON.
The command verifies it with the maintained native reader. The original raw
packet remains a separate exact file even though a grouped packet necessarily
has its own encoding and digest.

The optional `bindings` object uses the existing receiving contract. It may
select `merchantDeploymentId`, `buyerDeploymentIds`, `task`, `source`,
`payment` and `receiving`. Supply actual customer choices. A proposal can retain
pending deployment, source-access, endpoint and payment selections in a
`PLANNED` Installation.

## Explicit phase-ID correction

An original receiver can identify an invalid phase identifier before any save.
When its source owner has selected a correction, keep the complete original
packet and record the precise change in this optional case field:

~~~json
{
  "phaseIdAmendment": {
    "mapping": {"p1": "phase-1", "p2": "phase-2"},
    "reason": "The retained original preview rejected these identifiers before apply; the source owner selected only this ID/dependency correction.",
    "sourceUrl": "https://example.invalid/original-correction-decision",
    "selectedFilename": "supplier-selected-packet.json"
  }
}
~~~

The helper changes only the selected plan's phase IDs and references in
`depends_on`. It requires distinct final IDs, records each exact changed path
and verifies that reversing the change reproduces the entire original packet.
It retains the unmodified original and the complete selected packet separately.
The latter includes `installation_phase_id_amendment` with the original file
identity, mapping, paths and decision. `planSha256` must identify the selected
plan after that explicit correction.

This mechanism does not correct terms, dates, effort, scope, source identities,
correspondence or acceptance. A broader actual change needs the owner's complete
new original source and a distinct deliberate receiving selection.

## 3. Prepare the accepted native input

The installed entry point is:

~~~sh
starforge grant-installation-workorder sources \
  --selection /private/supplier-source/SOURCE_SELECTION.json \
  --source-root /private/supplier-source \
  --out /private/supplier-installation-input
~~~

Direct source use runs the same command:

~~~sh
node stellar/scf_2026/sf49_data_commissioning/installation-workorders/prepare.mjs sources \
  --selection /private/supplier-source/SOURCE_SELECTION.json \
  --source-root /private/supplier-source \
  --out /private/supplier-installation-input \
  --python python3
~~~

The command needs Node, Python 3 and the adjacent original SF47 source selected
by the Grant Operations distribution. It creates a private directory, holds its
source-preparation lease and publishes files without replacing an existing
different output. The receiver's original bound is 8 MiB per complete input;
the source selection accepts at most 64 MiB of original files. No file is
truncated to fit.

| Output | Contents |
| --- | --- |
| `SOURCE_SELECTION.json` | Exact complete original selection bytes |
| Each selected original file | Exact original source bytes, under its declared receiving filename |
| Each explicitly amended packet | Complete selected packet plus original identity and exact phase amendment |
| `Supplier_Workshare_Commissioning.json` | Original complete Workshare source/plan, phase effort mapping and original file identities for all selected cases |
| `Supplier_Complete_Receiving_Packets.json` | Every complete selected original packet, including its original correspondence and scope |
| `SUPPLIER_RECEIVING.json` | Existing native receiving schema, one selected profile/case/plan and complete file set per customer |
| `SOURCE_PREPARATION.json` | Source module identity, original commercial/schedule/phase summaries, native reader results and all output byte/hash receipts |

`PREPARED_SOURCE` means the original reader accepted the source construction.
It does not mean that a customer commissioned work, a case was saved, an
Installation was operated, a delivery was accepted or a payment was received.

Rerun the same command and output to reopen an interrupted preparation. All
selected input files are rechecked. A changed request or retained output is
rejected rather than substituted.

## 4. Continue the existing native Installation operation

Have the original Operations owner select the actual workspace, case, pinned
plan, actor and distinct receiving workspace. Keep their original case/plan and
any accepted current writer. The source preparation command does not open the
CaseDesk store or perform its separate correspondence/workshare adoption.

~~~sh
starforge grant-installation-receive \
  --operations-cli "$SCF_MODEL_ROOT/workspace/cli.py" \
  --workspace "$SCF_WORKSPACE" --case "$SCF_CASE" --plan "$SCF_PLAN" \
  --inputs /private/supplier-installation-input/SUPPLIER_RECEIVING.json \
  --source-root /private/supplier-installation-input \
  --out "$SCF_SUPPLIER_OUTPUT" \
  --receiving-workspace "$SCF_RECEIVING_WORKSPACE" \
  --actor "$SCF_ACTOR" --receiving-actor "$SCF_RECEIVING_ACTOR"
~~~

This is the existing complete native driver. It attaches/reopens exact sources,
obtains `installation-workshare-seed`, composes the selected task, previews and
saves through the original writer. It reuses an existing Installation by its
original commercial case. A source refresh keeps current task, deployments,
payment and observed criteria under the original refresh rules; explicit
bindings select deliberate changes.

The profile adds technical task, source, receiving, recovery and maintenance
instructions. The original importer supplies the full fee, price status,
milestone triggers, start conditions, phase owners, dependencies and acceptance
checks. Every phase stays connected to its original source. The full native
export is imported into the distinct receiving workspace and every selected
Installation edition is reopened.

The whole-case export and importer preserve the actual recorded operating case.
They do not execute the supplier PIM/ERP integration, supplier transmission or
merchant payment. Operate those selected product workflows through their
original owners and retain their actual results on the corresponding native
acceptance criteria.

## 5. Commission and operate the actual customer work

For catalogue work, agree the actual feed, source edition interpretation,
customer import contract, recipient requirements and rights before mapping.
Retain all original records and exact values. Run each complete current catalogue
and customer import, review the supplied corrections, then independently receive
and reopen the complete catalogue workspace.

For order work, agree the actual input family, customer profile, business
references, units/currency, change/cancellation semantics and return boundary.
A partner-supplied foreign schema selects its adapter scope. Configure only the
actual approved host-owned channels and credentials. Prepare and send a document
against the reviewed business revision before a later selected branch changes
that source. Record provider acceptance, rejection or uncertainty as observed.

A receiving engineer imports the full selected customer bundle, verifies its
source/profile and documents, continues a reasoned local change and preserves
that later change through reopening and an earlier-package replay. Keep the
original customer/prime relationship, platform/deployment authority and financial
posting with its stated owner.

## Professional work, payment and grant allocation

The professional Workshare fee and milestone schedule are retained quoted terms.
They remain distinct from `payment.priceAtomic`, `taskUnits`,
`taskBudgetAtomic`, network, asset, recipient and spending authority. No conversion
from EUR to an atomic payment amount is performed.

Select a merchant-paid recurring service only when the actual buyer and merchant
agree its useful task, unit price, complete-task budget and payment authority.
Use the original purchase/payment operations for any real paid execution.
A source refresh, case import or lost-response retry does not create a new
purchase or prove received cash.

The four-proposal internal cohort can preserve separate commercial allowances in
one original operating case. It does not add hours or funding to the SCF
application, change its $38,000 / 400-hour / 150-day plan, or treat all prospects
as commissioned installations. Use the native effort allocation and support
work already maintained by the Operations owner. Record real engineering effort
once against the actual work item and funding basis; keep professional
implementation, original grant development and later support distinct in those
original records.

## Completion and recovery

Retain the complete private source/preparation and receiving results. The native
`RECEIVED.json` identifies the original operating and receiving cases, the full
case archive and the selected original Installation editions. Their actual
states remain visible when reopened.

After a conflict, reread the current native case and review the refreshed input.
After an uncertain attachment/save/import, reconcile the original request and
retained source/Installation before continuing. Keep the existing receiving
checkpoint and complete ZIP. An intentional new plan/source selection uses a
new output directory with an explicit source relationship to the prior edition.

Use the original product's full source, runtime and customer-state handover for
delivery. A source archive, successful preparation, installed runtime, actual
native receiving, customer acceptance and cash receipt are separately observed
outcomes. Record each only when its original operation supplies it.
