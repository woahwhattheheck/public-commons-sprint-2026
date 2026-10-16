# Operating the Metadata Commissioning Desk

## 1. Select one real source and target

Name the project, source owner, reviewer and purpose. Record the actual DataHub GMS endpoint, core version, SDK version, authorized operator and selected entity population. A source export is an original document, not permission to mutate a catalog. Use the already authorized service and token in its original host environment.

The source helper takes a complete DataHub file-source JSON array containing MCE and/or UPSERT MCP records. It uses the selected SDK file reader and serialization. Keep original input bytes, original upstream or customer ownership, time of export, filters and entity counts. The helper retains the original file, byte count and SHA-256 inside the observation.

Do not silently combine multiple current editions of the same entity/aspect. The helper asks for an explicit source edition if the original includes duplicate current aspect keys. Time-series records remain retained separately. Their historical ingestion and acceptance require a separately selected native course; the current-aspect report cannot establish complete time-series history.

Install the selected SDK into the operator's existing isolated Python environment:

```sh
python3 -m venv /absolute/datahub-handover-venv
/absolute/datahub-handover-venv/bin/python -m pip install -r native/requirements.txt
/absolute/datahub-handover-venv/bin/python native/datahub_handover.py normalize \
  --source /absolute/original-source.json --output /absolute/source-observation.json \
  --label "Approved source edition one"
```

All output observation paths must be new, with their parent directory already present. Existing observations remain unchanged. Dependency installation uses the selected existing authorized environment; record the actual installed version and dependency closure.

## 2. Ingest through the original DataHub route

Use the approved original DataHub ingestion recipe and source owner for initial additions or whole-catalog loading. The desk's change-plan operator changes existing aspects on observed existing entities. It does not disguise an entity addition, deletion or history migration as an aspect correction.

A file-source reference recipe is supplied at reference/file-source-to-datahub.yml. Copy it to the operator's private directory, select the complete original file and exact GMS URL, and use environment interpolation for the existing token. Run the pinned SDK's original ingestion command: `/absolute/datahub-handover-venv/bin/datahub ingest -c /absolute/approved-ingestion.yml`. Preserve its complete stdout/stderr, recipe without credential values, exit status and original run identity. Read actual target state afterward even if the SDK command reported success.

The approved source and intended target version must be compatible with the actual selected recipe. Preserve any defaults introduced by the SDK as part of the normalized source observation. Keep the complete original input beside that interpretation.

## 3. Collect the entire selected entity population

```sh
/absolute/datahub-handover-venv/bin/python native/datahub_handover.py collect \
  --selection /absolute/source-observation.json --server https://GMS_HOST \
  --output /absolute/target-observation-before.json --label "Current target before review"
```

The helper reads every distinct URN in the selected source or change plan. It first checks the entity's real key aspect, then retains the complete entitiesV2 response and every returned aspect value. A generated entity/key representation is not used by itself to infer existence. A failed entity read is recorded with the exact entity and error; it does not become an empty successful entity.

The default environment name is DATAHUB_HANDOVER_TOKEN. A custom name can be passed with --token-env. Values are never included in requests saved by this helper. HTTPS is required except for an explicit loopback reference server. Redirects are not followed. Record the actual endpoint; a different host requires its own observation and reviewed plan.

## 4. Import and compare original editions

Start the local browser with `node serve.cjs`. Import the complete normalized source and target observation files. Select both retained editions in Overview and enter the reviewer. The current target URL is taken from the selected target observation.

Sources lists complete original downloads, entity/aspect/time-series counts and errors. Compare shows equal, different, missing and target-only current aspects. Entity existence is a separate result. An entity whose read failed stays not-observed; a successful missing key is absent.

Inspect each changed aspect's full expected and observed JSON. The exact comparison ignores object-key order. It deliberately retains distinctions such as 1 versus 1.0, string "1" versus number 1, null versus missing, array order, exponent notation and large integers. Such differences can be accepted by a named reviewer where the selected application contract makes them equivalent.

Relationships show owners, tags, glossary terms, domains, dataset and field lineage, process inputs/outputs, charts and dashboards. A reference outside the selected population is a scope question. The report does not infer that the external referenced entity is broken. Duplicate schema field paths are surfaced for review.

Record accepted, correct or investigate with a reviewer and reason. A decision belongs to the exact selected source and target originals. Importing a new readback creates a new comparison; earlier decisions remain retained without silently accepting the new observation.

## 5. Prepare a complete target-aspect change

Open an actual comparison row. The editable aspect begins with the complete observed target, so unrelated fields remain available. Make the intended correction, name its reviewer and explain the reason. Retain the proposal.

The proposal keeps its original target snapshot identity, complete before and after JSON, individual byte identities and reason. It requires an observed existing entity and existing aspect. Keep additions and full-source reloads in the selected original ingestion route.

In Changes, select one proposed edition per entity/aspect. All selected proposals must belong to the same selected target observation. Give the release a name and reviewer, then download DataHub_Change_Plan.json. The complete exported plan is also retained in the workspace notes.

Inspect that file before running it. It names the exact target GMS URL, source observation SHA, workspace/revision, reviewer and complete changes. The helper verifies its original compact-plan hash and each before/after body. Changing a file after review requires a newly prepared plan.

## 6. Apply once and retain the original native directory

```sh
/absolute/datahub-handover-venv/bin/python native/datahub_handover.py apply \
  --plan /absolute/DataHub_Change_Plan.json --run-directory /absolute/metadata-run-one
```

Use one private run directory for the complete original plan. The helper takes a POSIX exclusive lock and writes run.json with the full original plan. It reads the current entity/aspect before each change. If the intended after value is already observed, it records that state without another mutation. If the current value differs from the reviewed before value, it retains that difference and does not dispatch the stale plan.

For a first unstarted matching change, it saves the exact request and dispatching state before sending the original ingestProposal request. The returned HTTP response and later target readback are separate saved events. A successful HTTP response alone is not final-aspect acceptance. Completion requires observing every intended after value.

This is a multi-aspect commissioning run, not an atomic catalog transaction. Earlier successful changes remain when a later row fails or differs. Preserve all partial progress. Read the full run before choosing any correction.

## 7. Recover the existing operation

```sh
/absolute/datahub-handover-venv/bin/python native/datahub_handover.py recover \
  --plan /absolute/DataHub_Change_Plan.json --run-directory /absolute/metadata-run-one
```

Recovery reads and classifies the same original plan and directory. It does not issue ingestProposal. An attempted change is never automatically resent merely because a response was lost. A later deliberate correction uses fresh target observations and a newly reviewed plan.

If the existing run directory is unavailable, recover that original directory from its retained complete copy before continuing the operation. Do not choose a new empty directory to erase dispatch history. Restore file ownership and permissions in the authorized host; keep the original request/response bodies and complete plan.

The helper reports each error and preserves it. A collection or operation result with unresolved errors returns a nonzero exit status. Inspect the file even when the command exits nonzero. Resolve the actual endpoint, version, permissions or current-data issue and continue the original operation.

## 8. Receive actual results and prepare a revert if needed

Import the complete native run.json in Native runs. Collect a fresh target observation using the same selected population, import it, and compare that new target against the retained expected source. Record actual review decisions against this new comparison.

To undo a selected aspect change, use Changes → Prepare revert against fresh target. First select a fresh target observation whose current aspect equals the original proposal's after value. The desk then prepares a new change whose after value is the complete original before JSON. Name the new reviewer and reason. Export and operate it as a separately reviewed plan and directory.

If the fresh current value contains intervening edits, the automatic revert preparation refuses to replace it. Inspect those exact values and author the appropriate new correction. Preserve the original run and all follow-up readbacks.

## 9. Save working state and named editions

Edits to reviews, proposals, release selection, notes and raw source are included in the working file before they are submitted. IndexedDB keeps a complete local browser copy. A save compares the stored project version and reports a concurrent-page conflict without overwriting that other copy.

Open saved projects explicitly. A portable HTML starts with its embedded source edition, not an unselected old browser copy. Handover can save and restore named editions. Restoring retains the entire previous project as an original. Opening another complete workspace also retains the incoming original and the previous complete working project.

A storage failure leaves the working document open. Download its full JSON before closing or resolving a browser conflict. The complete JSON includes valid selected work and unfinished raw text. Reopening the same downloaded file preserves both.

## 10. Export and independently receive the whole deliverable

The browser downloads complete workspace, comparison report JSON and CSV registers. For a portable editable HTML and readable report, run the original file-only CLI:

```sh
node cli.cjs export /absolute/DataHub_Workspace.json /absolute/new-datahub-delivery
```

The new directory contains the full workspace, portable editable HTML, comparison report JSON and HTML, aspect/decision/relationship CSVs and a byte/SHA manifest. Existing destinations are not overwritten. CSVs neutralize formula-like text for ordinary spreadsheet opening; the JSON preserves literal values.

Open DataHub_Editable.html in a separate browser context. Verify the selected original sources, full review notes, proposed changes, actual native runs and unfinished drafts. Make a named receiving edition, download its complete JSON and reopen it. Open every outgoing report/CSV and inspect long values, blank/zero distinctions and actual archive contents.

Keep the complete application source, native helper, original fixture/third-party notices and actual installed-version information with the handover. Preserve the previous operator's original workspace and the receiving operator's new edition. A report derived from a workspace is not a replacement for that workspace.

## Actual rendered product requirement

The producing operator must open and use the exact outgoing application and every attachment, look at the actual desktop/screenshare and narrow screens, and operate important controls. Inspect populated/empty states, pending work, failed-save recovery, downloads, named-edition restore and independent reopen. View actual screenshots where used. Fix observed clipping, unreadable layout, missing styling or broken controls in the same source. Source checks and file hashes support custody; they do not replace normal use of the delivered product.
