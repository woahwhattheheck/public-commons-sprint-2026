# Sampling working copies and exact saved designs

TokenJunkieLabs. This chapter extends the installed Sampling priorities workflow. Original observations, proposal calculations, Monitoring solver, saved plans and field calendars remain authoritative.

## Complete operator course

Open Sampling priorities and choose the original observed context. Open a saved proposal and, when present, choose one of its saved native designs. The exact original configuration and request are retained; opening the design runs no calculation.

Edit recommendation targets, rationale, explicit costs, calendar, budget and advanced configuration. An unfinished JSON field, empty rationale, zero and unknown/null values can be saved in a working file. The exact authored working state is distinct from a validated proposal and a calculated design.

Save the working copy through the existing operator queue. A revision points to its exact immutable parent and preserves the original input JSON, source binding, operator identity and request history. A changed observed context begins a new family. Retrying the same original operation recovers its immutable result; reusing that operation with different input is rejected.

Opening a downloaded JSON first previews its source bindings. The current Workspace must contain the same project and exact observed context, proposal and selected design. Their original model inspectors validate them; scientific results in an uploaded file are never accepted as replacements. The operator explicitly chooses when to adopt the draft.

The difference review compares authored inputs with the selected original proposal and design. It does not estimate a scientific outcome. Submit the original Prepare proposal and Design actions to calculate changed inputs. The existing original solver and all source/cost/calendar validation remain in force.

A pending or retained request carries its original workspace identity and exact payload. A matching workspace label alone cannot establish that a queue survived restoration. Opening, previewing, saving and exporting never dispatch a retained request. The existing operator must find and verify the actual original task before recovery; a foreign or missing task remains retained for explicit reconciliation. Later edits remain separate from an earlier outstanding request.

## Exact file contract

The editable file has schema `upstate.sampling-working-copy/v1` and these complete fields:

- `project_id`, `workspace_key`: original project and operator workspace identity.
- `context_id`, `context_digest`: exact retained observed context.
- `recommendation_id`, `recommendation_digest`, `design_id`, `design_digest`: selected original records or null pairs.
- `draft`, `design_draft`: complete current form state, including advanced JSON text and optional assembled authored configuration.
- `pending_request`, `retained_requests`: exact original kind, payload, operation ID, task ID, state and retained metadata.
- `filters`, `title`, `operator`, `notes`, and optional `editor_state`: current editing/navigation state.

The limit is 8 MiB of UTF-8 JSON. Duplicate fields and nonfinite numbers are rejected. Valid source identity is required even when the authored planning fields remain incomplete. All incomplete form values are retained, not normalized into a guessed scientific selection.

Queued actions extend the existing descriptor:

- `monitoring.recommendations.working-save`: payload `{working_file,parent_id,expected_parent_digest}`. For a revision both parent fields are the exact immutable parent ID; for a new family both are null.
- `monitoring.recommendations.working-export`: payload `{working_id,format}`, where format is `bundle` or `workspace`.

Reads use the existing authenticated route with actions working-list, working-get and working-preview. POST supports a complete working-preview body without placing the file in a query string. Preview produces no queue effects.

## Native CLI on the existing application

Run from the installed application directory with its original Python environment. These commands call the same model used by the operator.

```bash
python3 -B -m model.monitoring_working_copies --workspace /actual/workspace list

python3 -B -m model.monitoring_working_copies \
  --workspace /actual/workspace --workspace-key ORIGINAL_OPERATOR_KEY \
  --output /new/review-preview.json preview --file /received/working-copy.json

python3 -B -m model.monitoring_working_copies \
  --workspace /actual/workspace --output /new/saved-working-record.json \
  save --file /received/working-copy.json --operation-id OWNED_ORIGINAL_OPERATION_ID

python3 -B -m model.monitoring_working_copies \
  --workspace /actual/workspace --output /new/revised-working-record.json \
  save --file /received/revised-working-copy.json \
  --operation-id NEW_OWNED_OPERATION_ID \
  --parent-id EXACT_PARENT_ID --expected-parent-digest EXACT_PARENT_ID

python3 -B -m model.monitoring_working_copies \
  --workspace /actual/workspace --workspace-key ORIGINAL_OPERATOR_KEY \
  get --id EXACT_WORKING_ID

python3 -B -m model.monitoring_working_copies \
  --workspace /actual/workspace export --id EXACT_WORKING_ID \
  --format bundle --export-root /outside-workspace/exports

python3 -B -m model.monitoring_working_copies \
  --workspace /actual/workspace export --id EXACT_WORKING_ID \
  --format workspace --export-root /outside-workspace/exports
```

Output JSON paths are immutable/create-only. Native queued operations retain original export receipts and file tickets. Export roots remain outside the Workspace.

## Two complete receiving forms

The working bundle contains exact working JSON, immutable working history, readable HTML, input comparison, the selected original proposal/design/configuration, observed context, original network/source members, selected native evidence and dependencies of older working revisions. All declared member identities are checked by the original streaming Monitoring packet writer. Open sampling-working-review.html, inspect the original sources and download/open working-copy.json in the same or restored project.

The complete Workspace ZIP uses the original Workspace backup. It includes the installed application and all original project records, source objects, native plans and working copies. Restore it through the original command:

```bash
python3 -B /installed/application/model/cli.py restore \
  /received/sampling-editable-workspace.zip /new/receiving-directory
```

Use the returned application and workspace paths, then list/get the exact working ID with the model CLI or original operator. Pending queue history remains explicit retained context and is not rebound to a new operator.

This feature does not extend selected-Study membership implicitly. Choose the complete Workspace export for independent editing; the source-bound bundle is the readable/source packet.

## Actual receiving and current owner controls

Continue the existing Sampling operation and source context. Preserve active native jobs, the original solver/controller, current peer components and existing browser ownership. Do not create another scientific engine or infer that a source review is an executed native result.

The actual producing/receiving owner must open the application, operate the complete saved-design → edit → save → reopen → revise → original design → comparison → export course, and personally inspect the generated HTML, downloaded JSON and complete attachments at desktop and mobile widths in its permitted browser. Restore the full Workspace to a fresh directory and repeat opening the exact saved working copy. Report actual interpreter, process/command, paths and first failure; source-only or filesystem-adapter checks must be labelled as such.

Follow CURRENT_OWNER_DIRECTION.md for the actual Upper Savannah geography, native baseline/restoration/matched-control work and explicit simulated-input labels. Saving Sampling planning drafts changes none of those scientific claims or existing owner boundaries.
