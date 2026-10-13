# Retained customer requests to complete engineering handback

The original Customer reviews workflow now keeps separately attributed
engineering editions alongside the customer's immutable response history.
Each request comes from an actual open correction, requested artifact change,
requirement change or clarification in a selected retained response.

## Native records and scope

`model/review_handback.py` owns content-addressed
`review-handbacks/<id>.json` records in the existing Workspace.
A record pins the original review and customer response, the preceding
engineering edition, its preparer, each request's assignment and treatment,
and the selected revised review and response generation. It never writes a
customer acceptance response. Historical customer generations remain selectable.

Planning editions can assign work before a revised review exists. An addressed
request requires the actual replacement artifact or requirement in its
selected revision and a written explanation. Deferred requests retain their
explanation. A ready edition requires a different saved review in the same
project, a responsible engineer for every item, and no planned items.

Concurrent engineering saves use the expected preceding edition. A repeated
identical input reuses the original saved edition. Selecting another revision
does not silently transfer evidence references to unrelated files. Source
identity, selected file hashes and the original customer response chain retain
their existing review validation.

## Original command-line workflow

Run from the original application root, using its installed Python environment:

```sh
python -B -m model.review_cli --workspace /actual/workspace handbacks --review-id ORIGINAL_REVIEW_ID
python -B -m model.review_cli --workspace /actual/workspace handback-template ORIGINAL_REVIEW_ID /actual/operation/engineering-draft.json --response-id ORIGINAL_RESPONSE_ID
python -B -m model.review_cli --workspace /actual/workspace handback-save /actual/operation/engineering-draft.json
python -B -m model.review_cli --workspace /actual/workspace handback-show HANDBACK_ID
```

The template writes the editable draft and returns the complete request list,
candidate revised reviews, and any selected revision's actual artifacts and
requirements. Edit the draft with the assigned engineers and notes, then save
the planning edition. Complete the scientific/source/map work in its original
workflow and retain a new review selecting those actual outputs.

Create the next engineering draft from the current edition and selected review:

```sh
python -B -m model.review_cli --workspace /actual/workspace handback-template ORIGINAL_REVIEW_ID /actual/operation/engineering-revision.json --handback-id CURRENT_HANDBACK_ID --revised-review-id REVISED_REVIEW_ID
python -B -m model.review_cli --workspace /actual/workspace handback-save /actual/operation/engineering-revision.json
python -B -m model.review_cli --workspace /actual/workspace handback-export READY_HANDBACK_ID /actual/operation/customer-handback --zip /actual/operation/customer-handback.zip
```

Fill the returned draft with actual selected replacement IDs and explanations,
and set its state to `ready` when it meets the handback conditions.
Every save returns the exact immutable edition ID to use in subsequent commands.

## Complete portable package

The root index presents every original request, engineering disposition,
assigned person, explanation, and links to the actual replacement files.
The CSV contains the entire selected edition; the JSON contains its complete
engineering history. Each distinct review generation referenced by that
history is exported as a complete original review desk under
`reviews/<review-id>/<response-id-or-original>/`.

This includes earlier engineering editions' replacement selections, so their
references still resolve after independent receiving. Every original file,
customer response prefix and selected requirement travels with its desk.
The revised desk exports a new customer response using its pinned predecessor,
through the unchanged original customer review flow.

The outer inventory covers every ordinary file and all nested review
inventories. Export and archive publication use private staging and fresh
destinations. Receiving verifies exact membership, member types, lengths,
hashes, response chains, review generations and engineering predecessors.
An inventory traversal error fails the operation rather than omitting a subtree.

```sh
python -B -m model.review_cli handback-inspect /actual/received/customer-handback.zip
python -B -m model.review_cli handback-receive /actual/received/customer-handback.zip /actual/operation/independent-handback
python -B -m model.review_cli --workspace /actual/restored-workspace handback-receive /actual/received/customer-handback.zip /actual/operation/joined-handback --join
```

Independent receiving opens the full desk without a scientific Workspace.
Joining requires the original restored project and retained scientific source
records. The task-owned received desk holds complete portable file copies;
the original Workspace receives its review, customer response and engineering
records. Conflicting histories remain errors, with the uploaded package
available for inspection. No native model job is launched.

## Existing authenticated operator

The original provider registers three queued actions:
`customer.review.handback.save`, `customer.review.handback.export`, and `customer.review.handback.import`.
Reads are `/api/reviews/handbacks`, `/api/reviews/handback`, and `/api/reviews/handback-template`.
The existing server only adds the selected handback/response/revision query
keys; authentication, workspace selection, task identity, uploads and file
tickets retain their original implementations.

`operator/CUSTOMER_REVIEW_HANDBACK.md` covers the integrated
browser journey. Full project backup already inventories Workspace records,
and source/application delivery inventories the added module and guide through
the existing cumulative installer.

## Scientific interpretation

Needs expert review: the scientific suitability of selected replacement outputs and any interpretation of their results should be reviewed by the responsible domain specialist.
