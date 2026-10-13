# Saved comparison → customer review → engineering handback

The Scenario workbench now captures an exact saved comparison as an ordinary source edition and opens the original Customer reviews workflow. The capture includes the saved physical results, incomplete cases, costs, objectives, budget choices and the full editable archive. Customer decisions and engineering responses continue in the original review and handback modules.

**Needs expert review:** interpret physical model quantities, paired spatial support, incomplete results and cost assumptions for the stated decision purpose.

## Review the edition the customer will see

Open **Scenario workbench** and select the intended saved edition. Inspect its report, original experiment, selected models, paired support and unfinished cases. If costs or selected outcomes need to change, use **Save new edition** and wait for that saved edition to appear before capturing its review.

The **Review this saved edition** section uses the saved record. An unsaved planning draft remains a separate browser draft. Enter a review title, the actual decision purpose and any notes. Choose **Create customer review**.

The original queue captures the edition and returns its exact:

- comparison record ID and plan SHA256;
- original scientific Workspace UUID and experiment ID;
- ordinary source collection ID;
- original Customer review ID;
- immutable comparison capture ID.

The task offers **Open customer review**, and the workbench lists that review beside the exact comparison. The retained review title, purpose and response count are visible in **Comparison reviews**. A partial comparison remains partial; its actual incomplete records and per-model availability are preserved.

The review draft stays available if the queued capture fails. Recover a request whose queue receipt was interrupted through the existing **Recover original request** control. An unchanged request retains its operation identity. Replaying an interrupted task reuses its original capture time, source collection and deterministic review.

## What the review contains

The source's primary document is `specification.json`. Its companions include:

| Retained member | Purpose |
|---|---|
| `index.html` | Readable capture guide, exact scientific identities, review questions and links |
| `edition/record.json` | Exact original saved edition record |
| `edition/comparison/reports/index.html` | Original complete offline comparison report |
| Other original report files | Full comparisons, parameter effects, unfinished cases, saved cost/objective/budget choices and ranking where present |
| `edition/comparison/plan.json`, `state.json`, `eco13-context.json` | Original receiving plan, retained native state and portable edition context |
| `editable-comparison.zip` | Complete editable comparison with retained original native files |

The review creates six requirements covering decision purpose, source science, spatial support and incomplete outcomes, costs and chosen objectives, actual findings and changes, and reopening. The customer can record decisions or questions against the actual files or these requirements. The engineer does not acquire a customer decision by creating the review.

The saved original source Workspace identity is retained even when the comparison was received into a different working project. The original review itself belongs to the current receiving project's actual UUID. This distinguishes where the science originated from where the review is being conducted.

## Export, receive and reopen

Use the existing Customer reviews **Export review** action. The offline review desk contains the entire comparison source and its companions. Extract the whole review ZIP before using its relative file links. Its `index.html` opens the original customer desk; open the captured source guide to reach the complete comparison report and editable archive.

A recipient can inspect the review and report independently from that extracted desk. To edit the captured comparison, download `editable-comparison.zip` and use **Scenario workbench → Receive archive**. This creates a new received comparison record while preserving its original science and saved planning choices.

In the original or fully restored Workspace, use **Reopen editable comparison** beside the retained comparison review. The original queue verifies that the selected source collection belongs to that exact review, resolves its captured archive and receives it through the same maintained comparison receiver. This avoids a manual download and upload and creates an independent received edition. The original review remains tied to its original saved edition.

To resume the same customer response history or engineering handback on a second machine, transfer the complete original Workspace and installed application. The normal source collection, original review, comparison capture records and complete comparison editions travel with that project. The workbench's existing portable verification hook now also validates the captured comparison source and its original review binding.

An offline review archive can be inspected without a Workspace. Joining a returned review or engineering handback to a live project follows the original same-project and original-source checks; restore the matching original Workspace first.

## Address changes with a real revised comparison

Receive the customer's actual response in Customer reviews. Preserve its original response identity and unresolved requests.

1. In Scenario workbench, reopen the exact captured comparison if necessary.
2. Save a revised planning edition, or receive the actual revised scientific experiment results.
3. Create a separate Customer review for that actual revised edition, stating its decision purpose and revision context.
4. Open the original review's **Engineering handbacks** tab.
5. Create an engineering response from the selected original customer response. Assign the requests, record dispositions and explanatory notes, and select the actual revised comparison review.
6. Map addressed items to the revised review's real replacement artifacts or requirements. A planning response can retain unfinished assignments. A ready handback requires the original model's completed engineering fields and the actual revised selection.
7. Export the complete engineering handback. It includes the original and revised review desks, complete comparison captures and every earlier engineering edition's referenced replacement generation.

A new engineering edition leaves the original customer response unchanged. Subsequent customer decisions remain the customer's separate original review response.

## Source-native command line

Run from the installed original application root, using its existing scientific Python environment:

```sh
python -B -m model.comparison_review --workspace /absolute/project create \
  --selection /absolute/comparison-review-selection.json
```

The selection uses actual saved identifiers:

```json
{
  "schema": "upstate.comparison-review-selection/v1",
  "record_id": "REPLACE_WITH_THE_COMPLETE_SAVED_COMPARISON_ID",
  "title": "Upper watershed alternatives: selected planning edition",
  "purpose": "Review the saved alternatives and cost assumptions for the stated watershed decision.",
  "notes": ["Record actual open questions in the original customer response."]
}
```

The identifier placeholder must be replaced with the actual 64-character saved comparison ID. The command prints the retained review, source collection and capture IDs. An explicit `--operation-id` can retain a caller's original 64-character operation identity. Without one, the exact selected project and review fields define the stable capture operation.

Inspect the same native records:

```sh
python -B -m model.comparison_review --workspace /absolute/project list
python -B -m model.comparison_review --workspace /absolute/project show ACTUAL_CAPTURE_ID
python -B -m model.comparison_review --workspace /absolute/project archive \
  --review-id ACTUAL_REVIEW_ID --source-collection-id ACTUAL_SOURCE_COLLECTION_ID
```

The last command returns the verified `archive_path` and original archive descriptor. Use that path with the existing workbench receiver or the operator's retained-review reopening action. Export customer desks and engineering handbacks through the original `model.review_cli`; see `model/REVIEW_HANDBACK.md` and `operator/CUSTOMER_REVIEW_HANDBACK.md`.

## Original operator contracts

| Operation | Original endpoint/action and selected fields |
|---|---|
| Catalogue | `GET /api/eco13/catalog`; `comparison_reviews` contains actual retained review summaries |
| Exact edition | `GET /api/eco13/record?record_id=...`; `customer_reviews` selects captures of that exact record |
| Create review | Queued `eco13.review.create`: `record_id`, `title`, `purpose`, optional `notes` |
| Reopen captured comparison | Queued `eco13.review.receive`: `review_id`, `source_collection_id`, optional `title` |
| Existing review navigation | Original `review-open` action and task `_review.review_id` |
| Original portable verification | Existing ECO13 `verify_workspace`, extended with `model.comparison_review.verify_all` |

No native model is launched by review capture, review export or reopening. The source capture verifies the selected edition before and after making its copy, imports all members through ordinary Workspace source storage, and uses the original review constructor. Its operation lock and original Workspace lock retain coherent generations; recovery removes only its interrupted private capture candidates.

After the complete source collection, original review and capture record are committed and verified, the operation removes its private capture staging copy under the Workspace lock. The complete original bytes remain in ordinary source object storage and its verified views. A completed retry can finish that cleanup without creating a second review.
