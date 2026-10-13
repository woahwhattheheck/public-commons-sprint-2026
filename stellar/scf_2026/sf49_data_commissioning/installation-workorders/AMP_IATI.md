# AMP country-programme Customer Installation

Use the maintained **AMP commissioning** application and the existing **Customer Installation** desk to carry one original country programme from source intake to independent operation. The installed profile is `amp-iati`. The original Workshare supplies the commercial scope, phase identities, dependencies, effort, fee, payment milestones, review rounds and correction terms. This profile supplies the complete technical programme.

The implementation joins the existing IATI source engine, AMP destination contract, native operation journal and portable receiver. Customer Installation preserves the original funded plan, actual deployments, commercial assignment, payment authority and observed acceptance. A programme edition and an Installation revision retain their own native identities.

## Select the installed programme

From the selected installed source:

```sh
node stellar/scf_2026/sf49_data_commissioning/installation-workorders/prepare.mjs profiles
```

The shared `profiles.mjs` loader discovers complete maintained profile JSON files. Both the preparer and receiver use it. The Python `sources` entrypoint now reads the same installed `ID.json` source, validates its complete profile shape and records its actual bytes/SHA-256; adding a profile therefore reaches the whole intake and receiving flow.

Use the existing Operations case and its current plan. The customer's original Workshare is attached in full, together with its matching case packet and original source files. The source-selection input identifies that commercial case and the canonical Workshare plan hash. Original commercial phase names remain the native acceptance-phase source.

## Complete source intake

Retain these inputs as whole original files:

- Every selected IATI publisher XML edition, with the actual acquisition URL/time, complete bytes/SHA-256 and explicit country/programme/activity selection.
- The actual existing AMP connection, workspace and installed version; full configured-field and possible-value responses, session/layout and complete selected projects.
- The complete reviewed mappings, original source-row decisions and source/native identity correspondence.
- The actual following publisher edition and fresh installed capture, with its reviewed complete source changes.
- The original Workshare, all delivery phases/dependencies, quoted effort and payment terms; the matching prepared case and full source/receiving package.
- The native programme output and complete portable archive, editable reports, runtime source and upstream notices.
- The actual Operations source IDs, current grant plan, merchant/customer deployments, payment selection and named operator/host.

Publisher references, activity IDs and financial source keys remain source identities. Select AMP organisation, currency, classification, project, funding and transaction IDs from the actual installed capture. Preserve parent/child relationships and the full original project preimage. The source-owned programme retains JSON number precision and original amount text.

Keep commitment, disbursement, expenditure and planning-budget groups separate. Each record retains its currency, transaction date, value date, financial type/adjustment meaning and period coverage. Repeated equal amounts can be separate original transactions. The complete source review accounts for included, excluded and unresolved rows.

The original Haiti example is `iati/examples/amp-haiti/PROGRAMME.md`. It retains the exact parent and child activity selection from the full FCDO publication, four transactions and five budget periods. Its complete publisher gzip expands to the unchanged 8,496,890-byte XML with SHA-256 `98a6bad80d60aa8deaa35fe1a593313515649a9fae7456895d1bfed4ac4a756d`. The two activity IDs are `GB-GOV-1-400503` and `GB-GOV-1-400503-401`; they declare HT at 100%. The programme guide preserves separate GBP 5,000,000 commitment and disbursement groups, five budgets totaling GBP 4,999,996, and the original GBP 4 comparison. Use the actual installed programme selection when commissioning a customer.

## Prepare the original Workshare source

The complete selection uses schema `stellar-forge.installation-source-selection.v1`. Each case selects:

| Field | Original value to retain |
| --- | --- |
| `caseId` | Original commercial case ID |
| `profile` | `amp-iati` |
| `packet` | Full prepared case and `workshare_input` source/plan |
| `planSha256` | SHA-256 of the complete original plan in sorted canonical JSON |
| `productionEffort` | Every original phase, its exact source JSON Pointer, declared hours/minutes and mapping basis |
| `effortTotal` | Original quoted total and exact source pointer |
| `files` | Full original source descriptors: path, receiving filename, bytes, SHA-256, source URL/time and media type |
| `bindings` | Explicit existing native source, merchant/customer, payment and receiving selections |

Select effort from the original Workshare or an attached original scope JSON. The preparer checks each value, maps each original phase once and verifies that the phase sum equals the original total. It loads both full Workshare/packet objects through the maintained SF47 intake. It retains the original request and creates the complete source outputs under one private source-preparation lease.

```sh
node stellar/scf_2026/sf49_data_commissioning/installation-workorders/prepare.mjs sources \
  --selection /absolute/AMP_SOURCE_SELECTION.json \
  --source-root /absolute/original-amp-files \
  --out /absolute/private/amp-installation-inputs
```

The installed command `starforge grant-installation-workorder sources` wraps the same entrypoint. Keep the complete original selection when continuing. Prepared outputs retain the established names `Supplier_Workshare_Commissioning.json`, `Supplier_Complete_Receiving_Packets.json`, `SUPPLIER_RECEIVING.json` and `SOURCE_PREPARATION.json`, together with every selected original file. The report records the exact installed profile and original Workshare reader used.

Each individual receiving source is limited to 8 MiB and the selected source collection to 64 MiB by the existing source preparer. A complete original compressed publisher file can travel with its documented full expansion, as in the retained FCDO source. Larger programme output uses its existing full archive receiving route and original source references; preserve the complete byte stream and its native identity.

## Operate the complete AMP programme

Use the source-owned runner in the existing IATI application:

```sh
python3 receiving/amp.py \
  --manifest /absolute/selected-programme.json \
  --case-directory /absolute/private/original-amp-case
```

The full manifest contract is in `iati/receiving/AMP.md`; all CLI and typed request fields are in `iati/AMP.md`. Its stable operation, named actor and complete `editions` array retain source descriptors, original source review, selection, full capture/connection, reviewed mapping, whole-scope decisions and actual native submission selection.

1. Receive complete XML through the original dataset engine and save the selected financial portfolio.
2. Capture the actual installed configuration and full project records, or receive the exact original complete capture.
3. Save all source-to-native mappings, review each financial row and record the full analysis identity.
4. Prepare complete native bodies against the original destination contract, then operate the authorized original request journal.
5. Receive full returned projects and collections, retaining actual returned IDs, version and request-position correspondence.
6. Continue with the actual following edition and fresh capture, preserving prior source/history and confirmed received identities.
7. Export the whole programme, independently import it, compare/re-export, close and reopen the retained workspace.

The original runner keeps one case manifest and request journal. After interruption, read the original request/run. An already returned project ID remains the receiving target; repeated preparation of unchanged full native request bytes reuses that original operation. The native comparator traverses unchanged configured collections so child identity validation and original ordinal pairings remain available.

Enter the existing native credentials locally through the original CLI or browser. The retained programme manifests, source files and request records omit authentication secrets. An actual native capture and write retain the existing environment's authority and operator selection.

## Receive Customer Installation

Use the original active case writer and full prepared input:

```sh
node stellar/scf_2026/sf49_data_commissioning/installation-workorders/receive.mjs \
  --operations-cli /absolute/selected-sf47/workspace/cli.py \
  --workspace /absolute/original-operations-workspace \
  --case ORIGINAL_CASE_ID \
  --plan ORIGINAL_PLAN_ID \
  --inputs /absolute/private/amp-installation-inputs/SUPPLIER_RECEIVING.json \
  --source-root /absolute/private/amp-installation-inputs \
  --out /absolute/private/amp-installation-receiving \
  --receiving-workspace /absolute/private/amp-installation-reopened \
  --actor ORIGINAL_IMPLEMENTING_OPERATOR \
  --receiving-actor ORIGINAL_RECEIVING_OPERATOR
```

Use the original actual IDs and named actors. The receiver reads the current native case version, attaches full source files, obtains the original Workshare-derived seed, prepares the AMP profile with explicit bindings, previews and saves against the reviewed identity, and reads back the entire saved Installation.

The seed retains all original commercial phase checks and terms. Technical profile guidance fills the task/source/receiving sections; original funded assignments, actual payment choices, deployment IDs and existing observations retain their own native records. The professional Workshare fee remains separate from a merchant's network/asset/task-unit pricing.

For an existing Installation, use its current draft and revision. Retain already saved task/payment/deployment choices and observations while applying explicitly selected changes. Follow the current original writer when another engineering arm is operating the same case.

The complete receiver exports the original Operations case, imports it into a distinct receiving workspace and reopens the same Installation IDs, revisions and document hashes. Its retained `receiving-input.json`, `receiving-export.json` and `RECEIVED.json` recover the same original operation after interruption.

## Operator acceptance

Customer acceptance follows the original Workshare and the actual programme:

| Programme result | Retained operating material |
| --- | --- |
| Original source and complete coverage | Full publisher files, original selection, actual installed capture and complete projects |
| Full financial review | Every original row/decision, exact monetary context and readable programme findings |
| Actual native receiving | Complete original bodies, returned projects, errors/warnings, native IDs, versions and journal |
| Following edition | New original source/capture, full comparison, reviewed corrections and retained prior history |
| Independent operation | Complete portable archive, original runtime/licences, receiving/re-export and reopened programme |
| Installation handover | Original Workshare phase checks, actual observations, complete case export and reopened Installation |

Record actual observed work and acceptance through the original application. Preparation output supplies the full programme and its source; the live operator records the completed result and any attributable correction. The same customer can continue a subsequent edition through the original application and retained native operation history.

## Maintained source

The profile's eleven exact source bindings select the complete AMP guide, CLI, native client, workspace, portable receiver, destination implementation/guide/source record, whole programme runner/guide and original Haiti case. At its initial delivery, they match application merge `ae8f91441a0037efefb563ad8999389838a0a35b`.

The shared Installation model/driver remains under `stellar/scf_2026/sf49_data_commissioning/installation-workorders/`. The public profile and guide travel in that existing distribution component. Complete customer Workshares, original source/receiving packets and native operational outputs remain in their existing private company/case handover.
