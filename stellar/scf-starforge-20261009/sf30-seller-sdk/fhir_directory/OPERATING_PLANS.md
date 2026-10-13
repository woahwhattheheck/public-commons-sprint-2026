# Directory operating procedures

Operating Plans turns a selected Directory edition and its reviewed native records into a complete, editable procedure for the next operator. It uses the existing [OperatingPlan model](../../distribution/discovery/operating-plan.mjs): the plan ID, creation time, origin, every saved revision, registration snapshots and exact prefix-history rules retain their original meaning.

The procedure records what the selected native workspace contains, who owns the next work, what inputs are needed and which result would complete each step. Preparing, saving, copying or receiving a procedure does not run its commands, poll a provider, reserve a service or send a message. Actual native records support recorded observations; human review and future work remain explicit steps.

## Use the operator

Open **Operating Plans** in the existing Human Services Directory application. The same section is available through the standalone native operator and the managed Applications entry.

1. Select the exact original edition and any relevant source, comparison, mapping, preview, conversion, service selection, referral join, handoff, receiving review or conformance records. Set the customer, period, receiving owner and an explicit output directory.
2. Prepare the complete preview. Inspect its full procedure, source basis and native observations. A preview is a saved immutable preparation record; it is not the current saved procedure head.
3. Accept that exact preview. The native operation checks the original selected records and current command registrations and saves the unchanged prepared document. The accepted request retains its selected preview ID.
4. Open a saved revision to edit its title, owners, steps, inputs, expected results, due dates, recorded results and command arguments. Add an actual registered command or a manual step, and change the step order. Save to append one revision.
5. Download the full JSON history, Markdown or HTML. Receive the full JSON into another original procedure, or receive the complete Directory workspace to retain both the history and its native source basis.

The editor stores working inputs in this browser session and offers a complete working-draft download, including unfinished continuation and argument JSON text. An invalid hidden step remains a save error instead of silently reverting to its earlier valid text. Storage failure is shown in the editor; keep the downloaded draft when the browser cannot persist it. A working draft is separate from a saved native revision. Opening an older revision retains that revision's content while using the latest saved revision as the draft's base. Leaving or reloading does not silently save a native revision.

### Receiving and copies

**Receive full history** uses the original OperatingPlan prefix rule. Matching identity and a matching shared revision prefix can add the incoming later revisions. An older or identical complete history reuses the current longer history. Divergent saved histories are rejected; a receive does not merge or discard conflicting revisions.

**Copy complete history** requires an explicit new plan ID. It preserves the entire original history and the original creation time and records the original plan in the copy's origin. An optional changed title is another actual saved revision. It does not replace an existing independently saved plan with that ID.

The two reopening routes are:

- The editor's saved-history selector opens any original saved revision without changing native history. A later explicit save creates the new head.
- The SDK/CLI document, draft, input and basis reads return the full selected original record. A historical draft's content comes from the selected revision; its base revision remains the latest revision of that stored full history.

## Stored source and transactions

There is one additive immutable Directory collection, **operatingPlans**. Each record has stage **prepared** or **saved**, the original plan ID, the full-history revision count, the native workspace UUID, actor, note and request hash.

| Retained item | Meaning |
| --- | --- |
| document | Complete original OperatingPlan JSON, including every revision |
| basis | Exact selected Directory records, original workspace path and UUID, full-body hashes, observations and retained files |
| catalog | The actual original command catalogue used when the history was prepared or received |
| input | The complete normalized request accepted by this record |
| preparedFromId | The exact reviewed preview accepted when the first saved history was created |
| predecessorRecordId | The previous saved native record for this same plan |
| originRecordId | The original native record used for an explicit copy |

Preparation and acceptance retain separate complete inputs. The preparation input does not contain an accepted preview ID. The accepted create input includes its original optional previewRecordId, and its request hash describes those exact accepted fields. Receiving validates that relationship, as well as the unchanged prepared document, basis and catalogue.

Only **saved** records participate in the per-plan head chain. Saving and receiving check the selected current head inside the original SQLite transaction. A stale draft or conflicting head remains a conflict. A replay of an already saved identical request returns the original record. It does not manufacture a new revision or observation time.

The basis freezes the chosen edition and exact immutable native record bodies. It verifies mapping/preview/conversion, selected service, referral and handoff relationships instead of joining unrelated IDs. Actual source absences, findings, schedule decisions and capacity interpretations remain visible in the retained native observations.

The archive receiver explicitly admits the complete original Directory collection set, the complete Conformance successor set, or the complete Operating Plans successor set. It does not accept arbitrary missing collections. Every procedure's four files is included in reachability, verified and reopened through the unchanged original model. Receiver-local **receives** records keep the existing Directory semantics and are not copied as producer history.

## Native CLI and HTTP

Use the installed **human-services-directory** command or the repository CLI:

~~~bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/cli.mjs operating-plan-catalog \
  --workspace /absolute/private/directory-workspace

node stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/cli.mjs operating-plan-preview \
  --workspace /absolute/private/directory-workspace --input /absolute/private/procedure.json
~~~

After reviewing the returned complete preview, add its exact record ID as **previewRecordId** in the accepted create input and run **operating-plan-create**. Keep that complete input file. The command never chooses an alternative preview after a conflict.

| Operation | Native command | HTTP |
| --- | --- | --- |
| Current original command catalogue | operating-plan-catalog | GET /api/directory/operating-plans/catalog |
| Complete saved history | operating-plan-document --id ID | GET /api/directory/operatingPlans/ID/document |
| Working historical or latest draft | operating-plan-draft --id ID [--revision N] | GET /api/directory/operatingPlans/ID/draft?revision=N |
| Complete accepted original input | operating-plan-input --id ID | GET /api/directory/operatingPlans/ID/input |
| Complete selected native basis | operating-plan-basis --id ID | GET /api/directory/operatingPlans/ID/basis |
| Prepare a registered or manual step | operating-plan-step --input FILE | POST /api/directory/operating-plans/step |
| Prepare a complete preview | operating-plan-preview --input FILE | POST /api/directory/operating-plans/preview |
| Accept a selected complete preview | operating-plan-create --input FILE | POST /api/directory/operating-plans/create |
| Save a reviewed draft revision | operating-plan-save --input FILE | POST /api/directory/operating-plans/save |
| Receive the complete original history | operating-plan-receive --input FILE | POST /api/directory/operating-plans/receive |
| Copy the complete original history | operating-plan-copy --input FILE | POST /api/directory/operating-plans/copy |
| Compare actual current registrations | operating-plan-compare --input FILE | POST /api/directory/operating-plans/compare |
| Retain JSON, Markdown or HTML | operating-plan-export --input FILE | POST /api/directory/operating-plans/export |

Every command also selects **--workspace ABS**. The generic paged collection remains **GET /api/directory/operatingPlans?offset=0&limit=50**; generic record reads use **GET /api/directory/operatingPlans/ID**. Native exports use the existing **exports** collection and **GET /api/directory/exports/ID/file**. The complete JSON document always contains all saved revisions; a selected revision affects readable Markdown and HTML rendering.

The [complete input catalogue](directory-operating-plans-schema.json) is authoritative. The native request and connected action validators use these same schemas.

### A source-bound preparation

The complete native operating driver writes **OPERATING_PLAN_INPUT.json** with all actual record IDs from its selected completed Directory result. This shorter example shows the required fields and one explicit edition; use real saved IDs from your own workspace.

~~~json
{
  "id": "directory-receiving-procedure",
  "title": "Directory source and receiving procedure",
  "customer": "Selected receiving team",
  "purpose": "Review a complete source edition and hand over its retained decisions.",
  "period": "The selected edition and its agreed review period",
  "owner": "Responsible operator",
  "receiving": "Named receiving owner",
  "notes": "Keep actual unresolved findings and future work explicit.",
  "savedAt": "2026-10-13T00:00:00.000Z",
  "basis": {
    "editionId": "051341f80c33dd88d93b8d6f841a02d44a79cf4e588938f4caa5ddba29f86670"
  },
  "outputDirectory": "/absolute/private/procedure-exports",
  "recorded": true,
  "continuations": [],
  "actor": "Responsible operator",
  "note": "Prepared from the exact selected original edition."
}
~~~

The edition above belongs to the original completed Commons Directory example. The timestamp is an example input, not a new observation. The operating driver supplies its own actual retained preparation time.

## Connected SDK, MCP and CLI

The existing **human-services-directory-workspaces** provider adds thirteen Operating Plans actions: eight native POSTs and five full reopening reads. It inherits the complete original Gravity, Directory and Conformance capabilities. Tool names retain the **merchant_human_services_directory_** prefix.

| Connected action | Input key or selection |
| --- | --- |
| directory_operating_plan_step | operating_plan_step |
| directory_operating_plan_preview | operating_plan_create |
| directory_operating_plan_create | operating_plan_create |
| directory_operating_plan_save | operating_plan_save |
| directory_operating_plan_receive | operating_plan_receive |
| directory_operating_plan_copy | operating_plan_copy |
| directory_operating_plan_compare | operating_plan_compare |
| directory_operating_plan_export | operating_plan_export |
| directory_operating_catalog | workspace |
| directory_operating_document | workspace, recordId |
| directory_operating_draft | workspace, recordId, optional revision |
| directory_operating_input | workspace, recordId |
| directory_operating_basis | workspace, recordId |

The step and comparison actions are read-only native operations. Preview, create, save, receive, copy and export create their declared native records or files. Connected read/file retention keeps the established provider semantics.

The typed client exports these complete helpers:

~~~js
import {
  prepareHumanServicesDirectoryOperatingPlan,
  saveHumanServicesDirectoryOperatingPlan,
  readHumanServicesDirectoryOperatingPlan,
  downloadHumanServicesDirectoryOperatingPlan
} from './connected/client.mjs';

const prepared = await prepareHumanServicesDirectoryOperatingPlan({
  client, workspace: 'directory', input
});

// Review prepared.preview.document, basis and original native record first.
const accepted = await saveHumanServicesDirectoryOperatingPlan({
  client, workspace: 'directory', input,
  previewRecordId: prepared.preview.record.id
});

const reopened = await readHumanServicesDirectoryOperatingPlan({
  client, workspace: 'directory',
  recordId: accepted.saved.record.id, revision: 1
});

const received = await downloadHumanServicesDirectoryOperatingPlan({
  client, workspace: 'directory',
  input: {recordId: accepted.saved.record.id, format: 'json', actor: 'Receiving operator'},
  directory: '/absolute/private/downloaded-procedure'
});
~~~

The preparation helper returns the exact complete native preview. The save helper requires the caller-selected preview and retains that identity on error. It does not prepare a replacement input. The read helper receives the entire original document, draft, basis and accepted input through the existing retained range reader. The download helper exports through the original native store, receives every complete file and preserves the manifest and byte identities.

Use the usual connected **call → value → download → reopen** commands. The selected local or MCP client borrows an already running native operator; closing the client does not close an operator owned by Applications or another retained connection.

Command snapshots retain the source workspace path originally selected in their arguments. Receiving on another host does not silently rewrite them. Review the original path and current registration comparison, then save an explicitly authored revision when the receiving host needs different paths.

## Complete native operation

This driver receives the exact already completed Directory workspace into a distinct private destination. It creates and receives the procedure through the unchanged native methods. It does not rebuild the Directory source/mapping/referral example.

~~~bash
python operate_operating_plans.py \
  --receiving /absolute/private/OPERATED_HUMAN_SERVICES_DIRECTORY.json \
  --receiving-sha256 0b0e08808ae3c1c62c512271dd6269cee2219b792d63d720ef67b8411e775fe0 \
  --archive /absolute/private/Human_Services_Directory_Complete_Editable_Receiving.zip \
  --workspace /absolute/private/operating-plan-workspace \
  --out /absolute/private/operating-plan-native
~~~

Use the actual Python and Node interpreters selected by the native source. Set **SF30_DIRECTORY_NODE** if the source bridge needs an explicit Node executable. The shared original FHIR/eLTSS runtime dependencies remain part of the selected product.

The native journey covers:

1. Original complete editable receiving and verification of every original Directory record.
2. Preparation of the full source-bound procedure and acceptance of that exact preview.
3. Explicit historical draft editing, a manual receiving step, reordering and saved-head revision append.
4. Exact earlier-prefix receiving, complete customer copy and receipt of an authored longer incoming history.
5. Comparison with the actual current command catalogue.
6. Full JSON, Markdown and HTML files for both procedure histories, all native reopening inputs and retained file descriptors.
7. Authenticated HTTP reopening and complete native file receiving.
8. Export, fresh receiving and reopening of the full editable workspace, with complete original record/history verification.

The result is **OPERATED_DIRECTORY_OPERATING_PLANS.json** and the restartable journal is **OPERATING_PLANS_JOURNEY.json**. The result binds its own exact **workspacePacket**; send that selected result and packet together. The complete output directory also contains source identities, original request inputs, both histories, readable files, HTTP observations and the receiver's complete workspace.

The journal binds exact input bytes, actual source files, private roots and the original Directory UUID. Reuse the same admitted process or saved complete operation to continue. Keep the original input paths and source cut for an in-place retry. A completed journal step reuses its original result. A changed source or selected input must be retained and reviewed explicitly; it is not an automatic replay instruction.

## Full browser, SDK/MCP and customer operation

Run the complete browser/connected driver only after the native operation above has completed:

~~~bash
node operate_operating_plans_browser.mjs \
  --receiving /absolute/private/operating-plan-native/OPERATED_DIRECTORY_OPERATING_PLANS.json \
  --workspace /absolute/private/operating-plan-workspace \
  --out /absolute/private/operating-plan-clients \
  --chromium /absolute/path/to/existing/chrome-headless-shell \
  --playwright /absolute/path/to/playwright/index.mjs
~~~

It performs actual editor preparation/acceptance, registered step editing, draft download, historical revision reopening, complete copy, history receiving and all three readable/editable exports. It closes Chromium before the full SDK/MCP file work, reopens the same separately owned operator through Merchant, then opens the browser again for the complete workspace download.

The connected phase reuses the exact requests already accepted by the native driver, reads all original procedure inputs, downloads all formats and verifies full local export reopening. Original Directory record hashes are compared to the unchanged retained HTTP response bytes, using the source-defined compact sorted UTF-8 JSON plus trailing LF. JavaScript reserialization is not used to assert byte equality.

A fresh receiving workspace imports the exact browser workspace packet, verifies all original and authored procedure histories and inputs, then opens the actual customer browser at the original historical revision. The connected full workspace download is retained separately with its own manifest. The result's selected **workspacePacket** is the browser packet that was actually received and reopened.

Outputs are **OPERATED_DIRECTORY_OPERATING_PLANS_CLIENTS.json**, **OPERATING_PLANS_CLIENTS_JOURNEY.json**, complete local manifests/files, browser images and the fresh receiving workspace. Preserve the whole output together. Retried immutable reads keep their first complete transport receipts while comparing the full source values. A completed operation reuses its original result and packet.

## Limits and source meaning

| Boundary | Declared limit |
| --- | --- |
| Complete OperatingPlan document | 32 MiB |
| Native Operating Plans JSON request | 64 MiB |
| Selected native basis | 4 MiB and 1,000 retained record references |
| Selected context source IDs | 100 |
| Additional authored continuation steps at creation | 20 |
| Original OperatingPlan steps in one revision | 1,000 |
| Original step arguments | 256 strings |
| Native complete Directory archive | 2 GiB |
| Connected complete file transfer | 512 MiB |
| Connected inline CLI argument file | 4 MiB plus the existing 64 KiB envelope allowance |

Large native requests can use the native CLI and private input files. Connected complete-file downloads retain their existing limits and original manifest protocol; they do not truncate a plan or workspace to fit an inline response.

The original completed Directory example used retained publisher files, three mapped resources and twenty reviewed fields, with zero mapping errors and five warnings. It selected one service and retained its original clinical join. Those are dated local operating results, not a claim of current external service availability, customer acceptance or standards certification. The procedure preserves that distinction in its recorded observations and planned next work.

The original OperatingPlan model and declarations are adopted unchanged from their existing maintained source. The Directory adapter, store and editor add native source bindings and operating paths around that model; all revision validation, draft/save/copy/receive rules and readable rendering remain source-owned by the original module.
