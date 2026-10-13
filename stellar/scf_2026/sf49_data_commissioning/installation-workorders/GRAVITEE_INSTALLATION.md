# Gravitee commissioning in the original customer Installation

This programme brings the complete original API workspace into the existing Grant Operations customer Installation. It retains the customer's whole commercial Workshare, source and API cohort, native responses, receiving host and actual acceptance. The existing Gravitee application and the original Installation remain the two operating applications.

## Complete installed product

The gravitee-installation source selection combines the existing gravitee-commissioning and grant-workspace contributions with this source preparation and receiving command. It includes the complete dynamically discovered workorder profile and guide. The focused gravitee-merchant selection remains available for an API operator who already has Grant Operations separately.

| Maintained component | Role |
| --- | --- |
| products/gravitee-merchant | Original source intake, mappings, native Management API requests, complete response/journal history and receiving |
| Gravitee commissioning in Applications | Original provider opens an initialized private workspace and validates its identity, software and actual loopback session |
| Grant Operations → Customer installations | Original Workshare seed, deployment/source/payment selections, acceptance steps, guarded preview/save and full-case receiving |
| gravitee-commissioning.json | Complete useful task, source meaning, operating steps and independent handover |
| gravitee-installation-core.mjs | Full original source package and exact selected cohort bound to original case attachments and commercial seed |
| gravitee-installation.mjs | Complete local-file inspection, templates and immutable prepared output |
| gravitee-installation-receiving.mjs | Actual complete API workspace plus saved Installation export, independent import and cold reopen |

The working API workspace, installed source/runtime and saved Installation have distinct identities. Preserve all three. Customer source, native responses and professional terms remain in their original private operating files. This public profile supplies reusable engineering instructions.

## 1. Install and open both maintained applications

Build from the full reviewed source commit with the maintained distribution builder:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --ref FULL_ORIGINAL_COMMIT \
  --selection gravitee-installation --out /absolute/gravitee-installation-release
~~~

The same output directory preserves the original build:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --out /absolute/gravitee-installation-release --status

node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --out /absolute/gravitee-installation-release --resume
~~~

The package receipt identifies the selected commit, complete source, dependency profile and archive. Receive/install through the existing Runtime Workspace **Source & profile** workflow. Review the actual installed manifest and Applications catalogue. The original runtime transfer carries dependency locks and parts; a Gravitee handover carries populated application records and source. Select both for handover.

Applications requires an initialized private Gravitee directory. For a new workspace:

~~~sh
starforge gravitee-workspace init --directory /absolute/private/gravitee \
  --connection /absolute/private/connection.json
~~~

The same command is available as node products/gravitee-merchant/cli.mjs init in the complete selected source. Receiving a prior package is the alternative to creating an empty workspace:

~~~sh
starforge gravitee-workspace inspect --input /absolute/private/Gravitee_Complete_Original_Handover.json
starforge gravitee-workspace receive --input /absolute/private/Gravitee_Complete_Original_Handover.json \
  --destination /absolute/private/received-gravitee
~~~

The received live workspace is received-gravitee/workspace; complete editable source is received-gravitee/source. Open **Applications → Gravitee commissioning**, select that actual workspace, review source inputs and start it. The original provider verifies the workspace and directory identities, declared source and actual served page. Retain its resulting private session through normal stop/reopen. Open the existing Grant Operations application and original case separately.

Select the actual Management API v2 base URL, organisation and environment. The default bundled contract is APIM4.12.21; a different installed contract must come from its actual complete OpenAPI source. Gateway addresses are separate. Bearer authentication names auth.tokenEnv; basic authentication names usernameEnv and passwordEnv. The receiving host supplies the values through its own environment. The workorder records configuration references and accountable operators.

## 2. Establish the whole useful API cohort

Receive all agreed OpenAPI/Swagger definitions, RAML/includes, original Gravitee definitions, transformation source and documentation. Read the entire source and preserve its paths and dialect. A transformation file needs its actual supported gateway implementation, companion service or upstream disposition.

Capture the current native API population before changing it. Retain complete API definitions/exports, all plan statuses and resource pages, documentation, members, metadata, events and current deployment. Keep partial-resource errors linked to the original responses.

Review the native draft body, paths, upstream, authentication, policies and each source behavior. Save its exact edition and mapping review hash. This preparation can select draft heads before the first native commission and later select the resulting commissioning heads. Preparing an Installation requires no production mutation.

Keep connection, environment and API identity together. A staging and production API with the same name remain distinct. Use the original complete request preparation before dispatch. The existing sequence preserves stable children for API/plan creation, publication, review, start, deployment and complete receiving.

Read full native responses. REQUEST_ACCEPTED is the deployment-request state; gateway status/body/timing and the real business-transaction client establish separate behavior. COMMISSIONED_WITH_DIFFERENCES, incomplete capture and unresolved transformations remain visible source outcomes. Attributed acceptance belongs to the original Installation checks.

## 3. Receive the commercial case and full native source

Continue an existing customer Installation through its saved draft. For a new Installation attach the complete original Workshare commissioning file and matching packet to the existing case, then use its original installation-workshare-seed route. The general [workorder guide](README.md) gives the native commands and full source-selection flags.

Export the complete API handover from the original Gravitee application with its full software source included. This Installation workflow requires includeSoftware:true, the original source-files manifest and every declared software member. Its request UUID and returned object reference identify that operation. The CLI export convenience creates a new UUID and writes a new file exclusively. After lost output, inspect the original saved file or handover reference; replay the same exportHandover request through the existing action interface where needed. Preserve the original export after an output-name collision.

Attach that exact complete JSON to Grant Operations. Retain attachment ID and raw-file SHA256. The native package's canonical SHA and the raw JSON-file SHA have different roles.

After the attachments are present, obtain a current complete case and matching Workshare seed:

~~~sh
python3 workspace/cli.py operations --workspace "$SCF_WORKSPACE" show --case "$SCF_CASE"
~~~

Save the full response as Original_Operations_Case.json and the matching full seed as Original_Workshare_Seed.json. Use the existing output option where available or shell redirection to a new private file. The seed retains original case/plan/revision/source hashes, commercial phases, checks, funding, deployments and payment choices.

## 4. Select and attach the exact whole cohort

~~~sh
starforge gravitee-installation template \
  --packet /absolute/private/Gravitee_Complete_Original_Handover.json \
  --case /absolute/private/Original_Operations_Case.json \
  --seed /absolute/private/Original_Workshare_Seed.json \
  --out /absolute/private/gravitee-template
~~~

This emits full original inputs, source report, Selected_Gravitee_Cohort.json, bindings.json and receiving receipt. Use a separate directory for every template or prepared edition.

Copy the selected cohort file into a working directory, then edit every original draft and commissioning head:

- Retain its exact kind, ID, revision and SHA.
- Choose inclusion explicitly and preserve all excluded rows with a reason.
- Choose the actual staging, production or other role for every included row. An unfinished draft can be other with its planned useful purpose.
- Supply each row's complete purpose or exclusion reason.
- Keep handover.sourceId as the exact complete original case attachment.

The full package remains whole when a draft is excluded. The compiler reads exact member bytes, validates draft→source, and retains connection, native children and complete observation.

**Attach the entire edited Selected_Gravitee_Cohort.json to the same original Operations case as a second source.** Save its actual source ID and raw-file SHA. This makes the precise include/exclude/stage/purpose selection part of the saved Installation and its portable export. Merely retaining a local selected-cohort report does not bind the original case.

Attaching the cohort changes the case version. Obtain a fresh complete case and matching Workshare seed. Generate fresh bindings from that seed through the existing preparer:

~~~sh
starforge grant-installation-workorder template --profile gravitee-commissioning \
  --seed /absolute/private/current/Original_Workshare_Seed.json \
  --out /absolute/private/current/gravitee-bindings
~~~

Retain the already attached full cohort file unchanged. In fresh bindings choose original merchant and buyer deployment IDs, source authority, receiving host/engineer, approved payment network/asset/recipient, atomic price/count/budget and facilitators. Blank technical instructions are not actual customer selections.

## 5. Prepare and save the complete Installation

~~~sh
starforge gravitee-installation prepare \
  --packet /absolute/private/Gravitee_Complete_Original_Handover.json \
  --case /absolute/private/current/Original_Operations_Case.json \
  --seed /absolute/private/current/Original_Workshare_Seed.json \
  --bindings /absolute/private/current/gravitee-bindings/bindings.json \
  --selection /absolute/private/selected/Selected_Gravitee_Cohort.json \
  --cohort-source ORIGINAL_ATTACHED_COHORT_SOURCE_ID \
  --out /absolute/private/gravitee-prepared
~~~

Source-checkout callers can use node stellar/scf_2026/sf49_data_commissioning/installation-workorders/gravitee-installation.mjs with the same arguments.

| Output | Meaning |
| --- | --- |
| installation-input.json | Complete existing native Installation document and exact original commercial/funding/check fields |
| installation-preview-input.json | Original current-version preview envelope |
| WORKORDER.md | Whole task, source, receiving, terms, implementation and every phase/check |
| Gravitee_Complete_Source_Report.json | Full file/package/member identities, complete native cohort and observations |
| Gravitee_Installation_Cohort.json | Both original attachments and selected/excluded native records, connections, source and children |
| Original_Operations_Case.json / Original_Workshare_Seed.json | Exact complete current case/seed input |
| Original_Bindings.json / Selected_Gravitee_Cohort.json | Editable original customer choices |
| Gravitee_Complete_Original_Handover.json | Complete source-bearing package, unchanged |
| preparation.json / Gravitee_Installation_Receiving.json | Complete prepared model and actual per-file identities |

Preparation verifies original packet/member hashes, both exact case attachment hashes, case version/pinned plan and every explicit native cohort choice. The maintained preparer preserves workorder, assignments, checks, workshare, workflowPeriods and coordination. Both full handover and selected cohort source IDs enter native source/receiving fields. Files are written privately under the original operation lease using immutable publication. Changed inputs use a new preparation directory.

Open **Customer installations → Load input file → Preview**, then read the original native result. Correct missing source/deployment/payment authority through the existing case and refresh inputs after version changes. Save with the original request and expected revisions. Retain and reopen actual installation ID/revision. Preparation itself supplies no accepted observations.

Operate the complete agreed native sequence. A later result gets its explicit source/selected-cohort edition. Scope changes follow the original Workshare. Record genuine check outcomes with their source, named operator and observation time. Professional fees/effort remain separate from Stellar payment selection. Retries and downloads do not create another paid task.

## 6. Independently receive the complete state

The receiving engineer needs the exact installed runtime/source selection, populated Gravitee JSON and complete saved Installation ZIP. The combined native receiving command selects an already saved edition:

~~~sh
starforge gravitee-installation-receive \
  --prepared /absolute/private/gravitee-prepared \
  --operations-cli /absolute/selected-source/stellar/scf_2026/sf47_budget_model/workspace/cli.py \
  --workspace /absolute/private/original-operations \
  --case ORIGINAL_CASE_ID --installation ORIGINAL_INSTALLATION_ID --revision ORIGINAL_REVISION \
  --receiving-workspace /absolute/private/independent-operations \
  --gravitee-destination /absolute/private/independent-gravitee \
  --out /absolute/private/gravitee-receiving \
  --actor ORIGINAL_RECEIVING_OPERATOR
~~~

Supply --python for another selected interpreter. All directories and sources belong to the actual operator/case. The independent Operations workspace is distinct from the producer. Receive its required original planning/runtime environment through the existing importer.

The command verifies every prepared byte identity, requires the actually saved complete prepared document, and checks both source attachments. It uses the original Gravitee receiving marker, opens every selected original record revision, closes and cold reopens the received workspace. It exports the actual selected Installation, imports through the original Operations request into the independent workspace, then reopens the same original Workshare, source attachments and exact installation edition. Complete phase outputs, whole handovers and the result are retained.

A lost import response reuses its deterministic original request. Completed receiving preserves later recipient edits. Subsequent customer work appends its own edition; the original handover is unchanged.

## 7. Inspect the actual outgoing experience

The native result covers source/state operation. Open the exact outgoing Applications entries at desktop and narrow phone-sized widths. Inspect the rendered images themselves. Use the original source reader/upload, mapping editor, full response/journal reader, cohort file, Installation preview/save, complete export, independent receive and cold reopen. Preserve unfinished drafts through original recovery controls.

Read the seven original Gravitee screens and the actual Customer installations screen. Check long identities, full native source, errors, tables, current versus selected editions and downloads at both widths. Save actual screenshots, open and view them, and correct displayed defects before recording rendered completion.

Live APIM changes remain in the existing actual provider operation. This preparation/independent-state command sends no provider change. Give an equipped receiver the complete exact product, private input paths and original case when local runtime admission is unavailable; keep actual receiving output with that operation.

## Grant source

The full public registration and chapter are in stellar-forge/developer-site/grant-products/gravitee-commissioning.json and grant-chapters/gravitee-commissioning.md. They select this reusable original product and Installation workflow. Customer-specific agreements and LDA internals stay in their original internal source. The current grant totals and accepted packages remain the original plan.
