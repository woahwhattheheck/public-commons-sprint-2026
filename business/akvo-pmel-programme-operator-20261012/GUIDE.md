# PMEL programme operator

This application runs a complete agreed activity inventory through the original IATI Results and publishing engines. It retains the original input, saves reviewed reporting editions, compares those editions, creates the native reports and editable project packets, and delivers a complete source directory that a receiving team can open independently.

The staff application and commissioning document remain the existing native application. This command line operates the same Results definitions, project identities and revisions. It adds no results parser, performance calculation engine, publisher service or separate programme database.

## Runtime and directories

Use the complete selected original IATI source. Python 3.11 or later is required; the original XML parser requires Expat 2.6 or later. Original publishing XSD validation also needs the existing lxml/libxml2 dependency. Node is needed for the original JavaScript client, merchant and native dataset paths. The Python programme and receiving commands use the standard library and the selected original Python engines.

Keep three separate locations: the selected software source, the private native workspace, and the complete output directory. The receiving workspace is a fourth independent location. Absolute paths are required for these directories. Create private parent directories with mode 0700 before starting. Customer data belongs in the authorised private receiving route.

The original runtime selection is explicit. A source carrier from one commit is not silently treated as a later Results/organisation composition. `runtime-selection.json` names the source selection and every complete file by relative path, byte count and SHA256. It uses schema `tjlabs.pmel.runtime-selection.v1`, an `iatiPath` relative to the selected source root, a `selection` object retaining the actual repositories/commits/composition, and a `files` array of `{path, bytes, sha256, role?}`.

## Initialise the original workspace

```bash
python3 programme.py \
  --iati /srv/pmel-source/stellar/scf-starforge-20261009/sf30-seller-sdk/iati \
  --workspace /srv/pmel-private/programme \
  init
```

The command creates the original IATI workspace and returns its native Results inventory. It does not contact a publisher or remote service.

## Inspect real inputs and prepare the plan

Retain the actual complete source file and its provenance. The provenance JSON should state the source URL or authorised delivery route, retrieval date, representation, owner and coverage. Attach the original acquisition/provenance package when one exists; an intermediary activity representation keeps that exact identity and is not renamed as a publisher-wide export.

Pass one `--activity` for every activity in the agreed complete inventory. Use actual IATI identifiers, including a programme parent only when it is part of the selected native source. The name and programme ID identify the agreed work; they do not infer a hierarchy from similar titles.

```bash
python3 programme.py \
  --iati /srv/pmel-source/stellar/scf-starforge-20261009/sf30-seller-sdk/iati \
  --workspace /srv/pmel-private/programme \
  inspect \
  --source /srv/pmel-inputs/original.iati \
  --programme-id ACTUAL-PROGRAMME-ID \
  --name 'Agreed programme name' \
  --activity ACTUAL-IATI-ACTIVITY-ID \
  --provenance /srv/pmel-inputs/provenance.json \
  --out /srv/pmel-private/intake
```

This retains the original source through `Workspace.add_source`, projects its actual Results records and writes three complete files: `source-projection.json`, `native-preview.json` and `programme-plan.json`. The preview contains original activities, results, indicators, baselines, periods, target/actual records, dimensions, findings and native keys. It creates no reporting edition.

Review the native preview and edit the prepared plan. Keep the original activity, result, indicator, period, target, actual and baseline keys. The plan is a real operation input; it is not an example populated with invented observations.

## Programme plan contract

The plan has schema `tjlabs.pmel.programme-plan.v1` and these fields:

| Field | Meaning |
|---|---|
| `operationId` | Stable original operation identity, at most 90 ASCII characters. Keep it unchanged when continuing an interrupted run. |
| `programme` | Actual `id`, `name`, complete `activityIds`, and optional `notes`/`inventorySource`. |
| `sources` | Complete original source files, each with `alias`, `path`, `bytes`, `sha256`, `provenance`, and optional `label`. Relative source paths resolve against the plan file's directory. |
| `attachments` | Optional complete supporting files, each with `alias`, `path`, `bytes`, `sha256`, and optional `label`. The handover retains the complete files. |
| `publisherSteps` | Optional original publisher create/correct/candidate operations. |
| `editions` | Ordered native Results definitions and original source references. |
| `comparisons` | Explicit pairs of saved reporting editions, with any reviewed cross-source indicator pairing. |

Aliases start with a letter and use letters, digits, full stops, underscores or hyphens, up to 48 characters. Each category has unique aliases. No source is fetched or inferred from an alias.

### Reporting editions

Every edition has `alias`, `sourceRefs` and `definition`. A reference `source:baseline` selects the original source alias `baseline`; `publisher:corrected` selects the actual retained candidate returned by the original publisher step `corrected`.

`definition` is the original native Results definition: `name`, optional `notes`, `selection`, `review`, `interpretations` and `bindings`. The programme resolves `sources` and owns `requestId`, `id` and `expectedRevision`. Those four fields do not go inside `definition`. Every edition uses the complete agreed activity inventory. The native preview is checked for missing selected activities before the save request is retained.

A new project omits `after` and `project`. A following edition of that project uses `after` with the preceding edition alias. To continue a project already in the original workspace, use `project: {id, revision}` with its actual selected edition. The operation never silently substitutes the current latest revision.

For a named review of the same source, use the same `sourceRefs`, set `after` to the earlier edition and record the actual review decision. This is a review edition of the same source. For a following publisher source, add its complete original input under a new source alias, retain its own provenance, and select that source in the later edition.

Use the native source-bound `interpretations` and `bindings` for arithmetic. The engine checks units, period dates, dimensions, baseline context and selected meaning. A missing target remains missing. `baseline-change` compares actual against the explicitly selected compatible baseline; it does not imply target attainment. Overall observations and their female/male subdivisions remain separate records. The programme does not add them into a second performance total.

The existing commissioning module can prepare the exact native definition and request used by the staff UI. Keep its complete commissioning document and review as attachments, preserving the hash in the original definition's notes. This workflow consumes that native definition unchanged except for its explicit original operation/source/revision fields.

### Source corrections

A publisher step has `alias`, `action`, `input` and the applicable source/predecessor selection. `action` is `create`, `correct` or `candidate`. The original native input supplies its actual `actor` and the fields required by the selected method.

A `create` step has `sourceRef` and native input containing the agreed publisher reference, complete `activityIds`, name, cutoff and notes. A `correct` or `candidate` step has `after` naming a preceding publisher step, or `project: {id, revision}` naming an actual existing publisher edition. A candidate step also supplies `sourceRef` for the already retained, complete publisher-supplied replacement XML.

The original structured correction engine supports its own narrative, organisation-reference and document changes. Copy the exact selectors and before-value hashes returned by the native fields view. The programme obtains and retains the original preview, binds the correction to its preview SHA and then calls the native correction method. It does not add a results-value patch API. For a publisher-supplied correction to result values, use `candidate` with the complete original corrected source; project that returned candidate into the following Results edition.

Original source revisions, finance, review and release effects remain those of the publishing engine. This command does not publish to RSR or IATI or perform a release to a remote service.

### Comparisons

Each comparison has `alias`, `before`, `after` and optional `pairs`. Before and after name saved editions of the same original Results project. Same-source indicator keys pair natively. For different original sources, each reviewed pair is `{before, after, note}` using the actual source-bound indicator keys. The native comparison retains additions, removals, original value changes and the explicit mapping basis. Similar labels are not treated as identity.

## Run the complete selected operation

```bash
python3 programme.py \
  --iati /srv/pmel-source/stellar/scf-starforge-20261009/sf30-seller-sdk/iati \
  --workspace /srv/pmel-private/programme \
  run --plan /srv/pmel-private/intake/programme-plan.json
```

The command first verifies all original source and supporting-file identities. It then retains the exact plan under the original native workspace, imports the complete sources, applies the selected publisher steps, saves the reporting editions and compares them. Its printed result gives the full result path, native project/revision/edition identities and counts from the original Results engine.

The operation directory is `programme-operations/<operation-id-SHA256>` inside the native workspace. It contains the complete original plan, exact native inputs, original previews, retained source/provenance, attachments, saved native editions and final programme result. It is a continuation record on the existing native workspace; it is not another database or substitute record of the source.

If a command is interrupted, run the same command with the same plan and operation ID. The same native inputs are recovered first; original engine replay precedes its revision check. A correction whose native save completed is continued through its retained exact request rather than previewed against a later head. An active same-operation lock prevents overlapping writers. A changed programme plan is a new operation; it does not replace the earlier operation's input.

## Build the whole handover

Use the result file returned by the successful original run, the complete selected source root, and its exact runtime manifest:

```bash
python3 programme.py \
  --iati /srv/pmel-source/stellar/scf-starforge-20261009/sf30-seller-sdk/iati \
  --workspace /srv/pmel-private/programme \
  handover \
  --result /srv/pmel-private/programme/programme-operations/ACTUAL-OPERATION-DIGEST/result.json \
  --runtime-manifest /srv/pmel-source/runtime-selection.json \
  --runtime-root /srv/pmel-source \
  --out /srv/pmel-delivery/programme-handover
```

The completed directory contains the full selected original runtime and its notices; this programme source and start script; the original programme selection and result; all complete supporting attachments; the native editable Results packet for every named reporting edition; the final native publisher packets with their correction histories; complete original HTML/JSON/CSV reports; and a plain, printable `index.html` linking the reports. `HANDOVER.json` lists every selected member's exact byte count and SHA256 and the original native edition identities.

The Results packets retain the original source and history closure. They do not contain runtime code by themselves. That is why the handover includes the full runtime separately. The builder checks that its running IATI path is the selected runtime path and reads each original edition by its recorded revision. An output from another build is never silently replaced. Preserve a completed handover and choose a new output directory for a later delivery.

The commercial package builder may wrap this complete directory through its existing receiving/archive route. Keep the source and native data parts together. The generic programme source remains reusable independently of any particular proposed fee or customer engagement.

## Receive and open independently

On the receiving Linux host, put the complete delivered directory at its final source location. Create a private receiving parent directory outside it. From the delivered directory, run:

```bash
python3 START.py --workspace /srv/received-pmel/programme
```

The start script verifies every selected source/data/report member before loading the included original runtime. It receives the native publisher and Results packets into the selected workspace, reopens every selected historical edition and rebuilds its native report, closes SQLite, then independently reopens it again. The original IATI server starts and prints its private local console URL. Use the existing source, Results, publishing and commissioning views in that application.

For an unattended receiving run, add `--receive-only`. Repeat the exact command after an interruption; the original receiving marker and native receipts identify the same operation. To deliberately receive into an existing native workspace, add `--existing-workspace`. Original native receiving preserves an existing local head, and the selected historical editions remain accessible by ID and revision. The start script does not silently adopt a different current head.

The final receiving result is saved under `programme-receiving/<handover-SHA256>/result.json` in the original receiving workspace. It includes the actual receiving workspace ID, complete packet identities, original receipt results, reopened edition identities, report hashes and native counts. The original private application can be started again with its existing CLI; the complete source and native workspace remain independently usable.

## Ownership and integration

This programme operation/receiving contribution belongs to the common Akvo delivery: 24EA owns the staff interface and the sole company/contact operation; 018A owns the commissioning-document preparation; 6966 owns the Results engine and its native receiving; A5F3 owns the organisation operator; CB2A owns adjoining financial reconciliation. Customer scope and correspondence remain in the original Sales parent. This source introduces no company case or sender.

Original source documentation remains the authority for native APIs and formats: the selected runtime's `RESULTS.md`, `PUBLISHING.md`, README and organisation guide. Preserve all licences and notices included in that source selection.
