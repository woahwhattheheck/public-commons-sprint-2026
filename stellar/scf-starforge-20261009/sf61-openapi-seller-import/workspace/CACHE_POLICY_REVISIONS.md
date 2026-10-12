# Save observed cache policy for restart

The API merchant workspace carries a reviewed operating snapshot into a new compiled merchant package. Its original source revision retains the package identity, selected route policies, operating snapshot, review identity and operator note.

## Operator workflow

1. Open the saved API package, start its original seller and open **Cache operations**.
2. Save a snapshot and review any live retention changes using the existing controls. After applying the intended changes, save a current snapshot and select it under **Saved snapshots**.
3. Under **Save policy for restart**, select the routes and a new package name. Add the operating reason, then choose **Review saved package settings**.
4. Review the before/after table and choose **Save or recover this package**. The original source revision engine and compiler produce the saved candidate.
5. Follow **Open … in the merchant workspace**. Stop the currently managed seller, then start the new package using the original challenge-preview or native facilitator controls.
6. For release deployment, use the existing revision staging workflow or the original release commands shown with the saved result.

A current API workspace snapshot carries its package ID and exact source and plan hashes. Earlier snapshots remain in history; capture a current snapshot to prepare a saved policy revision.

Every selected route already has a cache policy. The four retained settings are freshness (`ttlMs`), retained response count (`maxEntries`), total retained bytes (`maxBytes`) and largest retained response (`maxEntryBytes`). The original source stays byte-identical. The original plan and revision engines carry admission, response validation, credential references, sharing, source concurrency, transport definitions, atomic prices and unselected routes forward. Compilation checks the result against the original response limit.

## Reopen and interrupted saves

Prepared reviews are create-only private files in the package parent's `.cache-policy-reviews` directory. The browser pages those reviews and reopens their selected snapshot and candidate name after a workspace restart.

The final package records the operating decision in its existing `source-revision.json`. Repeating a review's completed save returns that same package. Before creating a new candidate, the save checks the review digest, original package and selected snapshot.

The original package writer takes its private per-name directory lease, compiles into an owned staging directory and publishes the complete directory after all package files exist. Failed construction removes its own stage. A killed process releases the kernel lease; a retry can use the same final package name. Existing packages retain their identity and contents.

## Command line

The installed command uses the same SQLite history and original revision engine:

~~~sh
starforge cache-operations policy-review \
  --state /private/merchants/catalog/cache-operations \
  --parent /private/merchants --package catalog \
  --inspection SAVED_SNAPSHOT_ID --routes catalog-read,summary-read \
  --name catalog-policy-v2 --note-file /private/retention-reason.txt
~~~

Use the returned immutable review ID and `reviewSha256` to save:

~~~sh
starforge cache-operations policy-save \
  --state /private/merchants/catalog/cache-operations \
  --parent /private/merchants \
  --id REVIEW_ID --expected-review REVIEW_SHA256
~~~

Reopen or page retained reviews:

~~~sh
starforge cache-operations policy-list \
  --state /private/merchants/catalog/cache-operations \
  --parent /private/merchants --package catalog --offset 0

starforge cache-operations policy-show \
  --state /private/merchants/catalog/cache-operations \
  --parent /private/merchants --id REVIEW_ID
~~~

Review and save use the retained observation, so the original seller can be stopped. The API workspace applies its current provider authorization checks before compiling. Provision the authorized host credential references before launching a completed package from the direct CLI.

## Receiving

Transfer the entire saved candidate directory through the existing private package handoff. Its `merchant-package.json` pins the source, plan, upstream configuration and `source-revision.json`; the latter carries the selected operating lineage. Reopen the candidate in the API workspace on the receiving host and start it with the original launcher. Configure the receiving host's credential references and release or facilitator settings as usual.

For the complete sequence of live changes, snapshots and notes, download **Complete history** from the cache workspace and import it into a new workspace on the receiving host. The saved candidate's operating decision travels with its package independently of the complete history.

## Host integration

`prepareCachePolicyRevision`, `readCachePolicyRevision`, `listCachePolicyRevisions` and `saveCachePolicyRevision` are exported from `workspace/cache-policy-revisions.mjs`. The host passes its private package parent, original cache workspace and current authorization callback.

The operating decision is attached through a trusted host callback after the original source review. JSON API callers supply a review ID and digest; the host loads the retained settings and original snapshot.
