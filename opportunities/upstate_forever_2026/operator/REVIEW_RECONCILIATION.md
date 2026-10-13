# Receive and reconcile returned reviews

This extension completes the original Upper Savannah review return path. The original review importer rejects a returned response when another reviewer has already advanced its predecessor. The Returned responses desk retains that returned file in the scientific Workspace, compares its original revision with the current revision, and imports the operator's selected result through the existing review engine.

## Installation

Add these files to the existing application without replacing its host, model, map renderer, Workspace, or customer review files:

- model/review_reconciliation.py
- operator/review_reconciliation.py
- operator/web/review_reconciliation.mjs
- operator/extensions/review-reconciliation.json

Install the JSON registration last. Restart the existing operator so ExtensionRegistry reads the installed descriptor. The current ECSA R2 extension host is required. The navigation entry appears immediately after Customer reviews.

The extension uses Python's standard library, the existing model.common and model.reviews modules, the original authenticated API, its serial task queue and file tickets. The registration supplies two retained actions, four reads, its state key and the original restore callback. No additional server or package is required.

## Operator journey

1. Open Returned responses and choose the complete response JSON exported from a customer review desk. Receive and compare retains its exact original bytes in the scientific Workspace.
2. Open its comparison. Decisions changed on only one side are selected automatically. Independent changes to different fields of the same decision or correction are combined. When both reviewers change the same field, the desk shows the original, current and returned versions.
3. Resolve conflicting fields by selecting a version or editing the combined decision. Independent fields remain combined when selecting the current, returned or original conflicting values. Deleting versus changing a correction is a whole-correction choice.
4. Enter the person responsible for reconciliation. The returned file preserves its original reviewer; a combined response identifies the reconciler. Choose a final disposition when needed and record a reconciliation note.
5. Retain the response. The original import engine checks the current predecessor and appends one immutable response. Reopening or retrying the same prepared task finds that existing response instead of adding another.
6. The completed inbox item opens its retained receiving record, original returned file and selected decisions. The finished comparison closes. Reopening a completed selection returns to that record. Use the ordinary Customer reviews view to export the updated review desk, read the complete response history and continue later feedback.

If another response arrives while the comparison is open, refresh the comparison. Browser drafts retain prior choices and reuse resolutions whose conflicting values are unchanged. A prepared import keeps its original returned file and selected choices if the head changes before commit.

## Reload and Workspace receiving

The returned-response inbox and prepared/completed reconciliation records live under Workspace/review-reconciliations. The original portable Workspace implementation recursively includes these files in its backup. The same application modules and registration are carried by the original application inventory.

On restore, the registered verify_all callback opens the returned originals, selected records and original response chain. Open Returned responses in the restored operator and continue an inbox item. Browser draft choices use the logical project and returned-file identities so they can reopen against the same project; the retained Workspace contains the actual returned response even when another browser is used.

The original task queue controls stage and commit operations. A lost HTTP response can be retried with its original operation identity. The browser keeps pending task identity and does not let an older completion callback clear a newer pending request.

## Registered interfaces

| Interface | Operation |
| --- | --- |
| customer.review.response.stage | Retain the complete returned original in the Workspace inbox. |
| customer.review.response.reconcile | Import the selected current or reconciled response using the native response engine. |
| GET /api/review-reconciliation/catalog | Existing reviews, returned files and reconciliation history. |
| POST /api/review-reconciliation/preview | Exact predecessor/current/returned comparison for draft_id. |
| POST /api/review-reconciliation/validate | Resolve choices against the current comparison and native response schema. |
| GET /api/review-reconciliation/detail | Original returned response, prepared decisions and completed import. |

Commit payload identifies draft_id, review_id, plan_id, expected_response_id and choices. Each choice names current, returned, base, or edit with a complete edited value. Reconciled responses additionally require reviewer.name, with optional role and organization. A null predecessor is an explicit initial revision.

## Source composition

The original customer review source is retained in Slack Canvas F0C8GLD74CT, private component merge 0e9f1d1cf5594d6adb0a292a39994a33f0037b01. The current ECSA R2 seven-file extension host is retained in F0C8TNEPZB6. The cumulative application source is retained in F0C8JNZTURK. Preserve later compatible additions in that same original application.

The receiving owner runs the focused response-to-conflict-to-import-to-Workspace-restore journey on the integrated native source. This source delivery does not add a repository test suite.
