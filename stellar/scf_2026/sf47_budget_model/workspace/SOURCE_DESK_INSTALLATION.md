# Installing the complete Source Desk

Source Desk is the source preparation workspace inside the existing Grant Operations Installation view. Operators receive a customer's complete retained work, select the original roles and phases, prepare an installation, and carry its outputs into that same Operations case. The desktop view, native Python client, Node entry point, saved work and restored installation use the same source and business implementations.

This guide covers the installed application source. The complete operating guide is [INSTALLATION_SOURCE_DESK.md](INSTALLATION_SOURCE_DESK.md); [customer programmes](../../sf49_data_commissioning/installation-workorders/CUSTOMER_PROGRAMMES.md) and [recurring customer preparation](../../sf49_data_commissioning/installation-workorders/RECURRING_CUSTOMERS.md) describe the original customer workflows.

## What belongs in an installation

The Python `managed_launch.py` and Node `launch.mjs` select the same ordered `BOOT_FILES`. A reviewed launch hashes every selected complete file. `staff_installation.py` starts its source collection with that list, follows the original module dependencies and writes the complete selected source into the workspace backup. Restore preserves that source and its original manifest. A changed source selection requires a fresh ordinary launch review.

Source Desk also opens files whose names are selected at runtime. A static module import walk alone cannot infer the whole installed profile catalogue or the original handover helper selected by source kind. Both entry points therefore name the complete current Source Desk runtime, clients, operating instructions and customer profiles explicitly.

| Source group | Installed purpose |
| --- | --- |
| `operations_installation_sources.py` and its existing browser, CSS, hash and collection modules | Existing source drafts, original file uploads, revision-aware working copies, preparation and Installation attachment. |
| `source-inputs.py`, `handover-inputs.py` and the existing `workshare_intake.py` | Complete source-file and saved Delivery handover intake through the original Workshare implementation. |
| `prepare-core.mjs` and `profiles.mjs` | Original binding templates, phase mapping, complete workorder preparation and installed profile discovery. |
| `customer-programme-core.mjs`, `commercial-workshare-core.mjs`, `recurring-core.mjs` | Whole useful-task calendars, actual original commercial terms, task budgets and changes joined to the selected Installation. |
| `operations_installation_commissioning.py`, its browser module, and `operations_installation_commissioning_archive.py` | Original merchant capture and ordinary USTAR receiving, exact archive members, original project and Installation phase attachment. |
| `installation_source_desk_client.py` and the existing Python/Node Source Desk commands | Native prepared operations, request reconciliation and complete retained-output downloads in the same existing workspace. |
| `receive.mjs`, `recurring.mjs` and their complete instructions | Native source-owned preparation and receiving workflows using the original Operations source, case, plan and bindings. |

The catalogue at the selected source edition contains 28 complete JSON profiles. The launch inventory now includes the seven previously omitted profiles: Amberdata spot research, Rumble Fish Prices, commissioning collections, education quality review, mobility source review, procurement agency work, and public-information publication. It preserves the 21 preceding profiles and their original identities. A future profile addition must join both launch lists when it becomes part of the managed installation.

A profile's `sourceFiles` describes the actual product inputs the customer work requires. The profile does not itself contain those products, a provider account or customer data. Receive the selected product's complete source and actual customer documents through their original distribution and source roles.

## Receive and prepare one original customer job

Open **Installations → Source preparation** in the existing Operations case. Start or reopen its source draft. Receive all complete original documents and their source references, then choose the source kind that matches the retained work.

For a saved Delivery handover, receive the complete `dealscout.delivery-handover.v1` snapshot and the original documents it names. Select the existing case, Workshare, scope, board, plan and phase identities from that source. The handover reader verifies those relationships and each original phase before the native Workshare loader accepts them. Source-selected effort comes from the actual phase fields; the preparation records each selected source pointer. The case can retain up to 20 whole customer handovers in a draft.

For a complete receiving packet, keep the original commissioning source, receiving packet, manifest and full document set together. For a merchant commissioning archive, inspect the complete native USTAR first; select its actual capture, project, Installation and reviewed phase mapping. Archive receiving retains the original archive and the complete accepted members.

**Prepare source** freezes the complete selected mapping, actual input identities, original profile and helper identities, and native outputs in the existing draft. Reopening a preparation uses its saved `SOURCE_SELECTION.json`. An editable draft may subsequently change while that earlier preparation keeps its original meaning.

Review the complete customer bindings before attachment. Payer, merchant, buyer and receiving operator retain their distinct roles from the source. The selected Installation seed supplies the original case, plan, source and phase IDs. The prepared work uses those identities throughout the ordinary Workshare and Installation writers.

## Complete customer programmes

The optional programme section receives the original commercial source and an explicit useful-task calendar. Review complete tasks, dates, participants, source windows and task budgets. A closed source window can cross a weekend; the programme retains the actual interval needed for the next useful review.

Download the complete programme files with the workorder. The programme engine keeps original commercial terms and native source bindings, then joins its calendar, commissioning and workflow periods to the selected Installation. Its change preview compares the original selected programme, the proposed change and the current saved Installation so an operator can resolve actual conflicting fields.

Keep the useful customer output distinct from its transports. Paging a result, saving another file format or reopening an acquired edition preserves that same task. Actual later source editions or separately requested work produce the next task. The original purchase and payment records remain the authority for paid activity.

## Managed source identity for the typed and merchant agents

The typed `./grant/agent` entry point imports `installation-source-desk-agent.mjs` for Source Desk reads, immutable command preparation, reviewed archive intake, execution and request reconciliation. The Python and Node launch selections bind that complete module, its TypeScript declaration and [the original agent guide](INSTALLATION_SOURCE_DESK_AGENT.md), alongside the existing client. The source inventory carries their complete bytes into an installed backup.

This joins the agent implementation from PR1401 to the installed Source Desk selection from PR1402. The current selection preserves all 367 preceding entries, including the concurrent statement-setup sources, and adds those three agent files in the same order in both launchers. Changing the helper alone now changes the reviewed launch identity; the existing managed launch checks require a fresh review before that changed source can start.

Keep an already-running workspace on its selected source edition. Receive the complete successor with the ordinary installation/source-selection workflow, review its current launch selection, and restart through the existing managed entry point when ready. Retain the original workspace directory, scenario, Source Desk case and draft, preparation history, and pending operation document. Reconcile that same native request after reopening; a source update does not create another customer case or reissue the business command.

The installed backup already discovers JavaScript dependencies and retains workspace files. This addition binds the agent helper to managed launch review and makes its typed operating instructions explicit; it does not rewrite an earlier preparation's `SOURCE_SELECTION.json` or the restored installation's original manifest.

## Continue an interrupted operation

The Source Desk saves complete request identities and payloads. When a response is interrupted, select the existing pending request and reconcile its actual saved result. Its native client supports the same process.

The following commands use the existing workspace and original case. Replace each capitalized path or ID with the actual selected value; the `--out` destination must be new because the client retains complete outputs without replacing a prior result.

```sh
python3 installation-source-desk.py \
  --workspace EXISTING_WORKSPACE --scenario ORIGINAL_SCENARIO \
  --out profiles.json profiles

python3 installation-source-desk.py \
  --workspace EXISTING_WORKSPACE --scenario ORIGINAL_SCENARIO \
  --case ORIGINAL_CASE --out source-drafts.json list

python3 installation-source-desk.py \
  --workspace EXISTING_WORKSPACE --scenario ORIGINAL_SCENARIO \
  --case ORIGINAL_CASE --out draft.json read --draft ORIGINAL_DRAFT

python3 installation-source-desk.py \
  --workspace EXISTING_WORKSPACE --scenario ORIGINAL_SCENARIO \
  --case ORIGINAL_CASE --out original-request-status.json \
  status --draft ORIGINAL_DRAFT --request-id ORIGINAL_REQUEST_ID
```

For a prepared native operation, retain the complete operation document returned by `prepare-command`, `prepare-upload`, `archive-receive-prepare` or `commissioning-attach-prepare`. Execute that same document with `execute-prepared --operation ORIGINAL_OPERATION.json`. Use `reconcile-prepared` with the same document after an interrupted response. The client reopens the existing canonical workspace and carries the original request through its owner transaction.

The browser keeps unfinished working copies separate from saved revisions. It can download the complete working copy, retain original uploaded bytes, reopen another saved edition and reconcile the request that was already sent. The whole-file collection intake remains part of the same source draft.

## Export, restore and reopen

Download the complete preparation archive and every selected programme output. Export the whole workspace with the existing Staff Installation backup command when a portable installed handover is required. The manifest includes the actual selected application source, scenario, original database and whole file identities.

Restore with the maintained Staff Installation receiver into the selected receiving directory. Reopen the original case and Installation, review the same source draft and preparation, and read the complete prepared files. Review the restored source selection before starting its managed launch. The original restored data continues to own its case, request and Installation identities.

PR1402's original installed-source contribution added 20 paths to its 343-entry base: nineteen complete already-published runtime, client, profile or guide files and this installed-operation guide. Its merge also preserved four concurrent statement-setup paths, giving 367. The agent integration described above preserves that full selection and adds three agent files, giving 370 identical, ordered entries in both launchers. These counts describe the source editions; each managed launch and installation manifest retains its own exact original source hashes.

The complete source-owned 15-phase receiving programme remains `installation-source-desk-receiving.py` and its browser companion. It exercises the original source, case, full handover, programme, native outputs, browser controls and restored workspace. Use the current whole application and actual original customer source with that receiver; an installation selection change does not require another case or another customer job.

## Grant application integration

The independent product declaration is `stellar-forge/developer-site/grant-products/source-desk.json`; its chapter is `grant-chapters/source-desk.md`. The existing grant composer activates the declaration when that exact chapter H2 is present in the selected canonical manuscript. It retains all unrelated product source records and uses the complete immutable source editions linked inside the chapter.

The source preparation capability supports the existing commissioning and delivery programme. It preserves the canonical USD 38,000, 400-hour, 150-day application and its original six-package structure. The existing authoring and application owners carry the chapter into the cumulative application.

## Customer source editions

The **Customer editions** tab compares exact retained source revisions and prepared outputs, records an explicit retain/replace/remove choice for every prior source file, previews the full successor mapping and saves one editable revision through the original request journal. All new target files remain retained. Continue through the original mapping editor and native preparation after resolving the recorded findings.

See [Customer source editions](SOURCE_DESK_CUSTOMER_EDITIONS.md) for the complete operator workflow, file and mapping semantics, original-byte downloads, working-copy recovery and native integration.
