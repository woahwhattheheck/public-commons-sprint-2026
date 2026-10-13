# NDTMS source projection — operator and receiving guide

Edition: 2026-10-13. This guide belongs to the complete NDTMS continuation of the existing source, migration, actual-return and portable workspace application.

## What the application does

The application retains the complete original 290-column CSV, its source edition, every reviewed source-cell correction and each immutable analysis. It projects six populations: clients, episodes, interventions, SIR, TOP/YPOR and CIR. Every projected entity retains the complete original row witnesses and hashes. Conflicting repeated values remain visible; a conflicting projection cannot be published as a completed source.

Native clients use their exact agency and client ID. A client who has consented and non-consented episodes has two generated client privacy partitions, identified by NDTMS_CONSENT_SCOPE. Those partitions do not mean two people. A no-consent partition retains only the permitted identity/consent projection; it does not borrow protected attributes from the consented partition. The supplier mapping must explicitly bind the generated parent relationship.

Structural readiness means the implemented source checks pass. The analysis's **Actual structural coverage** names the implemented checks and the clinical, code-list, trigger, historic completeness, population and supplier acceptance checks that remain separate. Selecting a cohort declares the supplied population; it does not implement all cohort-specific clinical rules.

The six-table source continues through the application's existing explicit mapping, approvals, assessment, release, actual target return, baseline, delta, stale-write refusal, recovery and whole-workspace delivery. A supplier's real load route and returned record/identifier/change contract are agreed from its actual interface. The authored local receiving course exercises the application's own local target; it does not supply a vendor schema or authorize an external clinical load.

## Start with the original complete source

The source overlay is applied to the exact accepted complete application, in a separate directory. It verifies every original application member, each changed-file preimage, all complete postimages and the generated APPLICATION.json. It leaves the original application and workspace in place.

From the directory containing the maintained composer:

```sh
python3 compose_ndtms_application.py \
  --source /absolute/accepted-application \
  --overlay /absolute/ndtms-application-overlay.json \
  --out /absolute/composed-application
```

Use the actual supplied overlay filename. Retain the composition JSON, original application manifest and overlay. A repeat accepts the already composed output only after a full byte comparison. If the original application has advanced, reconcile the actual new source with the owner before selecting a different preimage.

To create a genuinely new blank workspace, run once from the composed application:

```sh
python3 cli.py --workspace /absolute/private-workspace init --name "NDTMS source workspace"
python3 operator/server.py --workspace /absolute/private-workspace
```

For an existing project, reuse its actual workspace directory and omit init. The operator prints its own loopback session URL; open that exact URL, including its session fragment. Keep the current session private. A received portable application starts from its own application directory and actual received workspace.

## Import and declare the source

1. Open **Sources** and import the complete authorised original CSV using the existing source-edition form. Keep its original filename and provenance. The public blank template has all 290 ordered headers and no patient rows.
2. Open **NDTMS**. The public catalogue is searchable by entity/field and supplies its exact original source references, field order and source definitions. Download its full JSON or blank CSV when needed.
3. Expand **Analyse an original source selection**. Select the actual retained **Original source edition** and **Original 290-column CSV table**.
4. Choose **Declared cohort** and **Extract scope**. Record the actual population, source authority, published cohort and previous-submission context in the source-scope note. Enter an exact agency code if the file is restricted to it. Leave the agency blank only for the explicitly described multi-agency population.
5. Enter extraction dates as supplied. A reporting period or changed-only extract does not establish complete clinical history. Never infer that absent people or records were deleted.
6. A changed-since-prior-submission extract requires **Prior submission source**: select a separately retained original edition, its actual submission reference and the attestation/context. Its source identity is frozen in the analysis. This is an operator source reference; statutory acceptance is still separately qualified.
7. Select **Analyse this retained source**. The operation uses the original workspace request ID, expected revision and actor journal. It retains its exact source/selection binding and complete output artifacts.

The exact selected profile is ndtms-cds-r-technical-v1.3-20261013. Its source catalogue is derived from the published CDS-R Technical Definitions v1.3 and retains all 290 fields. The current public definitions, reference data and relevant clinical owner remain the authority for their respective clinical meanings.

## Review every finding and correct an original cell

Choose a **Retained analysis**. The counts distinguish original rows, native clients, privacy partitions, consented/non-consented witnesses, conflicts and the six projected populations.

**Every source finding** links the actual original record ordinal, including rows that could not form a projection. Select **Record N** to open that exact source row. Use the existing reviewed-correction dialog to retain the original cell, replacement, actor and reason. The correction is an attributed overlay; the original file and prior analyses remain available.

Run a successor analysis on that same source selection. The earlier finding and all prior values remain in the earlier retained analysis. Inspect the successor's coverage and full report before publication.

Under **Projected entities and complete lineage**, select the entity and open **Inspect entity & witnesses**. The dialog shows the exact native key, consent partition, every complete projected variant, original row IDs/ordinals, raw and effective hashes and correction IDs. Equal repeated witnesses can support one entity. Different repeated values remain explicit conflicts.

A source correction is an engineering operation. Clinical meaning and the authority to change the real source remain with the responsible clinical/data owner.

## Publish and bind the actual receiving contract

**Publish complete six-entity source** is enabled only for a structurally ready retained analysis. It creates a real new original source edition, containing exactly six CSV tables. The complete source evidence and original flat input are retained as supporting non-CSV members, so the import does not accidentally interpret them as extra clinical tables.

Publication opens the existing **Mapping contracts** editor. Bind each source table to the actual supplier-provided target fields, exact identities and parent relationships. The generated client privacy partition must be explicitly handled. Do not turn an absent supplier version/change field into an invented column. Agree the real returned records and outcomes, available IDs/change indicators and independent-change comparison before rehearsal.

Continue the application's original workflow:

- Review and explicitly approve the complete mapping.
- Assess all selected source rows and resolve findings.
- Prepare a retained release for the agreed receiving route.
- Import complete actual returned files and compare every selected row/cell/identity.
- Establish a baseline from the actual return where appropriate.
- Prepare later deltas against the retained baseline and reject stale target state.
- Retain every receipt, failed request, complete response and recovery operation.
- Export the full editable workspace and complete application, then receive and reopen them independently.

The authored native course uses an explicitly selected owned local target to operate these transitions. Its target-only note field, IDs, versions and returned contracts are demonstration data, not a clinical supplier's promised format.

## Keep unfinished input and recover competing tabs

The analysis form has its own complete browser input draft, separate from the committed workspace. It retains unfinished dates, notes, cohort and prior-source selection.

**Download current input draft** saves all of that form input. **Open selected input draft** validates the whole portable file and workspace identity, downloads the current and incoming versions, asks for an explicit replacement and saves the selected incoming input.

Browser persistence uses a revision comparison inside one IndexedDB transaction. When two tabs edit the same saved draft, the second writer keeps its current writing and the earlier saved record. Use **Download both & open saved** or **Download both & use current** after reviewing the complete recovery download. Neither branch is silently overwritten.

If an input changes while an asynchronous saved/file read is pending, the application retains and downloads the differing versions and asks you to choose again from the current writing. A storage failure retains the current tab's input and its recovery controls.

The portable input limit is 8 MiB. This sidecar is not the committed workspace database. Save it alongside the complete workspace backup when unfinished writing is part of the handover. On another browser or receiving listener, open the same input draft through the actual controls.

## Full portable delivery and independent reopening

In **Full portable delivery**, use **Freeze complete workspace & application**. Download its **Complete ZIP** from the resulting retained backup row. The complete archive has the original workspace, object bytes, operation history, application source and manifest.

Use **Receive into a fresh owned directory** with that exact ZIP and a new owned destination. The resulting original receipt contains the actual destination, archive hash/size, original workspace identity, current workspace identity and complete application identity.

The received application is in destination/application and its workspace in destination/workspace. Start that application's operator with the received workspace. Verify the same retained analyses, original corrections, mapping and history; reopen the complete input sidecar if required. Further legitimate recipient edits belong to the received workspace and are preserved when the original archive is reconciled again.

An archive from a different source or a changed original file is not silently substituted into an existing receiving operation.

## One executable native operating course

Run the maintained native programme from the composed application. It owns only its own child processes through the original Programme lifecycle, including the existing parent-death and cancellation behavior.

Core source/target/recovery course:

```sh
python3 native/ndtms_receiving.py \
  --work /absolute/original-programme-directory \
  --operation-id ORIGINAL_OPERATION
```

Full source plus desktop/mobile browser and independent receiving course:

```sh
python3 native/ndtms_receiving.py \
  --work /absolute/original-programme-directory \
  --operation-id ORIGINAL_OPERATION \
  --node /absolute/node \
  --playwright /absolute/playwright-entry-module.mjs \
  --chromium /absolute/chromium \
  --attachments /absolute/selected-attachments.json
```

For the actual outgoing blank application ZIP, extract its complete members into a new directory and run that extracted application's same native course. Add --application-archive /absolute/selected-application.zip. That exact ZIP must also appear in the attachment manifest. Its APPLICATION.json and every complete inventory member must match the executing application; the archive has those files at its root, without a wrapper directory or extra members. This uses one course over the actual outgoing source, including its complete independent receiver.

The three runtime flags are supplied together. Playwright is the actual entry module file, not a node_modules directory. The optional attachments argument requires that runtime.

The selected attachment manifest is a plain JSON array of up to 64 exact entries:

```json
[
  {
    "path": "/absolute/original-attachment.html",
    "bytes": 12345,
    "sha256": "the actual complete 64-character lowercase SHA-256"
  }
]
```

The example size/hash are placeholders, not an accepted source selection. Generate the actual manifest from the frozen complete files. The programme copies the original manifest and every complete selected file into its own browser-inputs before browser dispatch, and binds the runtime and selection to the original operation. Rerun the same command, directory, operation and original input selection after interruption. Reconcile actual existing output instead of inventing a new run ID.

Without the browser runtime the result is CORE_COMPLETE. The complete browser invocation returns schema nelc.ndtms-complete-receiving/v1, state RECEIVING_COMPLETE, the frozen native result, sourceBrowser, receivedBrowser, exact input selection, original archive replay and current workspace heads.

### What the real native course operates

The source fixture is explicitly authored fictional data: eight 290-column flat rows, two native clients, three consent privacy partitions, three episodes and four child records, resulting in ten normalized rows. It includes a repeated CMSID conflict at original CSV record 7. The course retains the blocked analysis, reviews that cell to the authored original, publishes the successor and operates the real local target load, return, baseline, delta, stale refusal, rollback and complete independent archive receive.

The source browser then imports that exact authored CSV as its own named browser edition and operates:

- The actual complete profile and blank-template downloads.
- The original blocked finding, record-7 correction and successor analysis.
- Every consent partition and complete witness detail.
- The full report opened at 1440-pixel and 390-pixel widths and print output.
- Six-table publication into the original mapping editor, explicit approval and complete ten-row assessment.
- Mobile navigation and visible input controls.
- A real two-tab draft conflict retaining both complete branches.
- Portable input download, explicit reopen and cold browser reload.
- The actual complete workspace ZIP and independent receiving operation.
- Every selected HTML outgoing attachment at desktop/mobile widths and print output.

The received browser opens the actual directory returned by the source's original receiving receipt. It verifies the retained analysis, correction and six-table mapping, restores the input sidecar through the UI, cold-reopens it and captures desktop/mobile/history views.

The addon uses caller-owned page/context; it does not launch or close another controller's browser. The original native/browser.mjs owns the browser and request capture. Every workspace task is retained before dispatch and reconciled by its original request ID. The installed APPLICATION.json, every application member and selected attachment are checked before and after the course, including completed replay.

Each fresh resumed browser context restores the actual complete input sidecar. All before/incoming recovery files have immutable content-derived names and remain in the journal. An existing recovery filename is reused only for exactly matching bytes. Earlier competing writing and original backups remain preserved.

### Finish the actual visual inspection

The producer opens the actual returned screenshots and exact files, checks the desktop and 390-pixel layouts, readable labels and controls, full report/print output and every outgoing attachment. Record the specific original result and attachment identities that were personally viewed. Images existing on disk and a source-level review alone do not complete this step.

The maintained callback opens HTML attachments. For other selected formats, the equipped producer must also open the actual file using its appropriate viewer or the application: the complete ZIP through its original receiver, the full reference JSON through the relevant application/input controls, and CSV through a real readable table view. Preserve those actual file identities with the same receiving record.

## Original CLI and paging contract

The companion CLI reads the same installed catalogue and original workspace:

```sh
python3 ndtms_cli.py profile
python3 ndtms_cli.py blank
python3 ndtms_cli.py --workspace /absolute/private-workspace status ORIGINAL_REQUEST_ID
```

For analyse/publish, supply the complete data JSON, original request ID, exact expected revision, actor ID/name and --save-request path. The CLI stores the full request before invoking the original mutation; it refuses a differing existing request file.

Analysis data contains editionId, tableId, profileId, cohort and scope. Scope has kind, from/to (ISO date or null), agency, note and, when changed-only, priorSubmission with editionId/reference/note. Publish data is simply the exact analysisId.

Read-only pages ndtms-findings, ndtms-rows and ndtms-lineage use the original page envelope, selected workspace revision, offset and limit. Findings retain direct original sourceRows references even for malformed records. A conflicted projected row has values:null; complete variants remain in lineage.

## Primary definition sources

The public index is https://www.ndtms.net/ResourcesAndTraining/Documentation . The installed profile retains exact source URLs and field locators for the published CDS-R material.

- Technical Definitions CDS-R v1.3: the original ordered 290-field catalogue.
- CSV File Format Specification CDS-R v1.0: the flat-file/entity representation.
- Community Adult Business Definitions CDS-R v1.4: adult business meanings and consent context.
- Reference Data CDS-R v1.4: original reference codes.
- Geographic Information v15.1: geographic definitions.

Retain actual later public definitions as a new reviewed source edition rather than silently rewriting a frozen analysis. For another cohort, statutory extract or supplier interface, the responsible owner confirms the actual applicable definitions and receiving contract.
