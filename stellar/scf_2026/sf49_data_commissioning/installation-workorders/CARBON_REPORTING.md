# Carbon reporting customer installations

The maintained **stellarcarbon** and **cfce-givecredit** profiles carry each complete reporting product into the original Grant Operations Customer installations workflow. They use the same preparation core, original Workshare seed, native preview/save, complete export and receiving driver as CoCart and Blockscout.

The customer's original commercial case supplies its scope, fee, milestones, phase owners, review allowance and acceptance steps. The selected technical profile supplies the complete reporting task, original source meaning, operating sequence and editable handover. Both remain in the same installation document.

## Select the actual reporting product

| Profile | Complete customer operation | Source and operator |
| --- | --- | --- |
| stellarcarbon | Receive original contributions and retirements; assign named customers/projects; issue historical/current and consolidated statements; correct and receive the whole workspace | [Stellarcarbon operator](../../../../products/stellarcarbon-statements/README.md), maintained command `starforge stellarcarbon-statements` |
| cfce-givecredit | Receive original registry/receipt/ledger/carbon editions; associate real payments, provider funding and sinking transactions; issue donor/initiative and consolidated statements; correct and receive the whole workspace | [GiveCredit operator](../../../../products/cfce-givecredit-statements/README.md), maintained command `starforge givecredit-statements` |

The files `stellarcarbon.json` and `cfce-givecredit.json` retain the complete maintained task, source, receiving, implementation and source-map fields. Both are included by the existing Grant Operations distribution component.

## 1. Receive the complete original commercial work

Use the existing operating case and its latest original version. Attach the original complete commissioning inputs and matching receiving packet to Sources. Continue the current native Workshare instead of introducing another company case.

Receive its complete original `installation-workshare-seed` response using the [existing Workshare-to-Installation commands](README.md#1-receive-the-original-commercial-case). Keep the full response envelope and the native source IDs, selected plan, Workshare case, phase checks and current installation selection.

For an existing saved installation, use its current native draft and original source-refresh path. The preparation command below starts a new PLANNED installation from a fresh seed. Its native acceptance criteria and observed work continue under the original case.

## 2. Prepare the selected full customer workorder

Run the installed command from the maintained Grant Operations source:

~~~sh
starforge grant-installation-workorder template \
  --profile stellarcarbon \
  --seed /absolute/private/original-seed.json \
  --out /absolute/private/stellarcarbon-bindings

starforge grant-installation-workorder prepare \
  --profile stellarcarbon \
  --seed /absolute/private/original-seed.json \
  --bindings /absolute/private/stellarcarbon-bindings/bindings.json \
  --out /absolute/private/stellarcarbon-installation
~~~

Use `--profile cfce-givecredit` and its own original seed/output directories for the GiveCredit installation. In a source checkout, use `node prepare.mjs` from this directory in place of `starforge grant-installation-workorder`.

Complete each binding from the actual selected project:

| Binding | Stellarcarbon | CFCE / GiveCredit |
| --- | --- | --- |
| source.reference | Selected complete backup or actual official API acquisition, network, reporting periods and original source edition | Actual registry source/export, organization, Stellar deployment/contract, native ledger bounds and selected carbon edition |
| source.authority | Source reuse and customer mapping authority, with the reporting owner | Registry/access and reporting authority, original deployment/provider owner and donor-data receiving authority |
| source.sourceIds | Original complete backup/API files and commissioning source attachments | Original registry, receipt, ledger/XDR and carbon sources plus commissioning attachments |
| task | Actual customer/project groups, periods and required consolidated outputs | Actual organization, initiative/donor groups, period basis and required consolidated outputs |
| payment | The selected service's actual commercial/payment terms and any separately commissioned native paid-resource configuration | The selected service's actual commercial/payment terms and any separately commissioned native paid-resource configuration |
| receiving | Actual private host/directories, staff receiver, complete runtime/source, original accounting workspace where included | Actual private host/directories, staff receiver, original SDK/source and retained access references |
| merchantDeploymentId / buyerDeploymentIds | Original participating deployment IDs when commissioning a native paid report resource | Original participating deployment IDs when commissioning a native paid report resource |

The native planned stage supports customer selections as they are made. Keep the original quote's price and fee milestones in the Workshare; the preparation preserves its entire commercial binding. Selected atomic payment values remain exact strings. An underlying CARBON amount or donation payment remains a source measure.

The output directory contains:

- **installation-input.json** — the complete native editable Installation document.
- **installation-preview-input.json** — its exact original-case preview envelope.
- **WORKORDER.md** — the complete task, source contract, commercial terms, original phase criteria, receiving and implementation sequence.
- **preparation.json** — original input identities, retained profile/source map and remaining actual selections.

The original preparation core preserves the seed's full Workshare, commercial terms, funded assignments, acceptance checks, workflow periods and coordination. Customer edits are limited to the declared source/task/payment/receiving and original deployment fields.

## 3. Save, export and receive through the original application

Open **Grant planning and delivery → Customer installations → Load input file** in the existing case. Load the complete installation input, preview it against the original current case and save the reviewed edition. The existing [native CLI sequence](README.md#4-preview-save-and-reopen-the-same-native-installation) provides the same operation.

The full receiving driver also accepts either carbon profile. Its existing input schema remains `stellar-forge.installation-workshare-receiving.v1`. Each customer entry selects its original Workshare case, `profile: "stellarcarbon"` or `profile: "cfce-givecredit"`, original plan/source binding, complete commissioning files and actual customer bindings.

~~~sh
starforge grant-installation-receive \
  --operations-cli /absolute/source/workspace/cli.py \
  --workspace /absolute/private/original-grant \
  --case ORIGINAL_CASE_ID --plan ORIGINAL_PLAN_ID \
  --inputs /absolute/private/original-carbon-receiving.json \
  --source-root /absolute/private/original-carbon-files \
  --out /absolute/private/carbon-installation-delivery \
  --receiving-workspace /absolute/private/received-grant \
  --actor "Original recording operator" \
  --receiving-actor "Named receiving operator"
~~~

Use the actual existing IDs and complete retained file descriptors produced by the commercial intake. The driver retains those original source bytes, obtains a fresh case version for each mutation, reuses an existing installation for that Workshare, previews and saves through the original Python application, exports the complete case and reopens each selected installation in the independent receiving case. Its existing operation journal handles interrupted source intake and saves.

The [Grant Operations operating guide](../../../../products/grant-operations/OPERATING.md) describes the retained case, plan, funding, Sources, Workshare and Installation lifecycle.

## 4. Operate the complete reporting installation

### Stellarcarbon

Receive the selected original backup or acquire the complete official API selection. Keep the source network and actual available-table coverage. Create the actual customers and their project groups; inspect the original contribution and save a transaction, recipient or funder assignment. Prepare all commissioned historical and current periods plus the consolidated view.

Every statement delivers **statement.html**, **statement.json**, **contributions.csv**, **allocations.csv** and **retirements.csv**. Contribution periods use creation dates. Their allocations include all linked certificates known in the source edition, including later retirements. The separately dated register selects certificate dates. Customer projects retain their own identities alongside source VCS projects.

When accounting is included, select the original Merchant customer, save the statement and use its explicit service-fee draft/recovery action. The original Invoices/receipts and calendar payment plans continue that invoice.

Export the entire staff workspace, receive it in a separate private directory, reopen it and continue an actual mapping correction or later statement. The staff handover contains all customers; customer delivery uses the selected statement files.

### CFCE / GiveCredit

Receive the actual complete registry, ledger and carbon editions. Source lists retain their full pagination and relationship closure. Inspect Donation UUIDs, the receipt's original payment hash, separately minted receipt identity, original token transfers and source-dated provider/vendor configuration.

Save explicit original payment associations, inspect the provider pool and select the agreed funding method for each complete payout. The allocation uses actual source-dated provider capacity and native transaction order. Associate the actual payout with original carbon source, freezing the chosen allocation revision. Prepare the agreed donor/initiative and consolidated reports using an explicit registry-created or payment-ledger-close period.

Every statement delivers **statement.html**, **statement.json**, **donations.csv**, **payments.csv**, **payout-funding.csv**, **carbon-contributions.csv**, **carbon-allocations.csv**, **retirement-register.csv** and **receipt-records.csv**. Separate contribution and certificate-allocation files let the receiver aggregate quantities without duplicating a contribution.

Capture the next source edition, compare original records, carry unchanged payment assignments and review changed associations. A carbon association adopts a later funding revision only through its explicit saved update. Earlier statement versions keep their original source and decisions.

Receive the whole editable staff workspace into a second private directory, reopen it, continue an actual association or reporting period and return the updated complete handover.

## 5. Keep the service and grant measurements useful

A reporting installation has its original implementation fee, agreed operating periods and optional recurring service. Its customer Workshare records those quantities and actual acceptance. The natural recurring unit may be monthly. A report file, receipt NFT, source API request or underlying donation is a different record from a completed service purchase.

For a separately selected grant cohort installation, record its actual independent operators, approved merchant unit, payment/complete-output relationship and recurring-use calendar in the same native case. Use the pinned plan's original funded packages and record prospective engineering once. Existing software provides the starting installation and source semantics; the original selected workorder and grant case identify the remaining commissioned and funded work.

## Maintained source selection

The profile source maps retain the complete original product guides by Git blob. The existing `distribution/contributions/grant-workspace.json` includes this whole directory, so both JSON profiles, preparation/receiving commands and this guide travel in the selected Grant Operations source. Their full data contracts continue through the original preparation core and the original native Installation implementation.
