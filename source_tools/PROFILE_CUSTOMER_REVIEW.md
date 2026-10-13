# Profile customer review: original response to saved profile history

This extension completes a review of one exact saved scientific profile and its coefficient source. The operator captures that profile for a stated scientific purpose, uses the existing Customer reviews workflow to collect actual reviewer decisions, then explicitly applies the selected current response to the profile's existing review history. The profile definition, coefficient table and source companions retain their original bytes and identities.

## Install the current profile family

Use the maintained Profile workbench installer with the complete current family source:

    python -B "$SOURCE/install_profile_workbench.py" \
      --application "$APP" --source-root "$SOURCE"

The installer composes the original profile provider/client, the additive customer review bridge, the two guarded original review API edits, the extension descriptor and receiving command. Restart the existing operator server and reload the application so its extension registry admits the current assets/actions.

## Product workflow

1. In **Profile workbench**, select the saved profile and open **Customer review of this profile**.
2. Complete **Review title**, **Question for the reviewer** and optional **Review notes**. Choose **Capture profile for review**.
3. Choose **Open customer review**. Its original packet contains the scientific sheet, exact saved profile JSON, original coefficient CSV and companions, original source collection/manifest, and machine-readable specification.
4. The reviewer records actual decisions with the existing Customer review response template and return/import workflow. Consolidated corrections and reconciliation stay in that workflow.
5. Select the **Original response** and choose **Check returned decisions**. The panel shows the original reviewer, each mandatory artifact/scientific decision, proposed profile status, and current profile review head.
6. If the source response omitted its role, complete **Reviewer role for this scientific record**, then choose **Check role and decisions again**. This role's operator-input origin is retained separately from the unchanged original response.
7. Choose **Apply returned scientific review**. The original profile history event links to this capture, customer review, actual response and scientific purpose. The profile's ordinary manual review controls remain available.

### A concrete explanation for Tim

“We select the saved scientific profile you want reviewed, state the question, and capture its exact model settings, coefficient table and sources. Your reviewer opens the same retained packet and records decisions or consolidated corrections. When the response comes back, the workbench shows which scientific decisions were accepted and the resulting profile status. We apply that response to the exact saved profile, keeping the reviewer, original response and source table together in its history. The receiving operator can reopen the transferred project and recover those same selections and decisions.”

For the demonstration, choose an actual saved profile from the project catalog and author the question for that profile's real intended use. The separate Scientific setup workflow captures the broader grid, reporting/model areas, scenarios, observations and validation plan when that is the selected review scope.

A new profile edition has its own identity and review history. A decision recorded for one profile/table pair is bound to that pair.

## Required scientific decisions and status mapping

The capture has three mandatory primary artifacts: exact saved profile definition, original coefficient table, and readable scientific purpose/source sheet. Four mandatory requirements cover the selected models and parameters, original coefficients and units, source editions and transformations, and fitness for the stated scientific purpose.

| Actual customer response | Resulting profile status |
| --- | --- |
| ready-for-purpose, all three required primary artifacts accepted, and all four scientific requirements accepted | reviewed |
| Actual changes-requested decision, changes-requested disposition, or open correction | changes_requested |
| In-review response, or a required decision that is not accepted | working |

The original Customer reviews validator additionally requires all selected artifacts and requirements to have valid decisions before ready-for-purpose, at least one accepted artifact, and no open corrections. A not-applicable decision on a mandatory profile artifact or scientific requirement leaves this bridge's status working. Preview displays every contributing decision and its actual comment or requested change.

## Backend API

Module: model.profile_customer_review.

### catalog(workspace, profile_id=None)

Reads existing profiles and captures. The optional profile ID filters both lists. Returns:

- project
- profiles: profile_id, title, selected_models, review_state, table_sha256
- captures: capture_id, profile_id, customer_review_id, title, purpose, created_at, latest_response_id, profile_review_state, application_count

### create(workspace, selection, operation_id=None, created_at=None)

Selection fields:

| Field | Contract |
| --- | --- |
| profile_id | Existing native saved profile ID |
| title | Required text, up to 300 characters |
| purpose | Required scientific purpose, up to 20,000 characters |
| notes | Optional list of text values, each up to 20,000 characters |

Unknown fields, NUL text and invalid identities are rejected. An explicit creation timestamp requires a UTC offset. The supplied operation identity belongs to this exact request; a different request cannot reuse it.

Returns the same detail as inspect.

### inspect(workspace, capture_id)

Returns capture_id, profile_id, customer_review_id, source_collection_id, created_at, title, purpose, profile, table, capture, specification, review, latest_response_id, profile_review_state, applications, requirements, artifacts and files.

review is the original reviews.show_review packet:
review.review is the original immutable review; review.responses is its actual ordered response chain; review.latest_response_id is its current head.

files lists each generated source entry body and companion with source_id, part, path, bytes, sha256 and label. Part zero selects the primary. Paths are source view paths. Providers resolve each file through Workspace.source_file(source_collection_id, source_id) and the entry's body/companions descriptors; these paths are not Workspace-root-relative filenames.

The human sheet presents each selected model's saved parameters in readable parameter, native field, value, units, interpretation and source columns. New captures snapshot the maintained profile workbench methods and their source hashes in presentation version 2, so labels, units and references remain tied to the actual captured catalog. References and notes appear as lists; nested source declarations use labeled fields. Original declared coverage, model period, transformations, CSV cells and column order are retained.

Existing captured sheets retain their original bytes. An interrupted capture resumes the presentation and method catalog already retained in its specification; version 1 specifications use the unchanged original renderer. A newly captured review uses version 2. Reopening, exporting, applying a response and restoring a project continue to use the original retained artifacts and identities.

### preview(workspace, selection)

Selection: capture_id, response_id, optional reviewer_role.

Response IDs refer to original imported review-response records. Preview returns:

- exact capture_id, profile_id, customer_review_id and response_id
- current_response_id, response_is_latest and current_profile_review_id
- derived_status and status_explanation
- can_apply and actionable reasons
- reviewer: original name, role and organization
- reviewer_role, reviewer_role_origin and requires_reviewer_role
- checks: each mandatory artifact/requirement's actual decision, accepted flag, comment and requested change
- response: original retained response record
- already_applied: existing provenance application, when present

Only an explicitly selected latest response can be newly applied. If the authored role exists, it is preserved; a different operator-supplied replacement is rejected. When the source role is empty, explicit operator input supplies the application role without rewriting the source response.

### apply(workspace, selection, operation_id=None)

Selection adds required expected_profile_review_id to the preview selection. Its value is the original profile review head opened by the operator, including null for no prior history.

Returns application_id, capture_id, profile_id, customer_review_id, response_id, profile_review_id, application, profile_review, profile_review_state and capture (full current detail).

The ordinary profile_editions.review operation owns the actual history event. Its optional before_commit callback runs under the existing Workspace and profile history locks after committed-operation recovery and expected-head validation, before either creating or publishing a history event. The callback revalidates the selected current customer response and exact profile/table binding. Existing manual callers omit the callback and retain their existing behavior.

A response-specific lock spans the complete history-write/link operation so different tasks for the same response cannot apply duplicate events. A retained response operation index also recovers an original committed history event when a different task arrives after interruption but before the provenance link was written. If an immutable event was saved before its history head was published, recovery locates that exact native operation and resumes the original review API to publish the same event while its expected head remains current. A later manual head keeps its normal concurrency protection. A caller retrying the same operation must retain the exact original selection and expected head.

### verify_all(workspace)

Reopens each capture through the ordinary retained sources and Customer review packet; validates each application against its original response, exact profile/table identity, native event request, reviewer provenance and committed history chain. Returns capture and application inventories/counts.

## Portable source and operation layout

- profile-customer-reviews: immutable capture records
- profile-customer-review-packages: captured original source files, import manifest, human sheet, specification and stable capture journals
- profile-customer-review-applications: immutable links between actual customer responses and existing profile history events
- profile-customer-review-operations: retained application requests, response operation index and completion journals
- sources/reviews/review-responses/profile-reviews/profile-review-heads: original maintained Workspace records

The original portable Workspace backup retains these ordinary files. The installer registers verify_all with the maintained portable component validation.

Capture and source import hold the ordinary Workspace lock; the capture lock serializes its own operation. The lock is released before reviews.create_review, which owns its lock. Application similarly releases its Workspace lock before profile_editions.review. Its validation callback acquires no additional Workspace lock.

## Native receiving command

Run from the actual maintained application root. These are commands for actual retained Workspace objects.

Read the real profile inventory:

    python -B -m source_tools.receive_profile_customer_review \
      --workspace "$WORKSPACE" --catalog

Optionally filter:

    python -B -m source_tools.receive_profile_customer_review \
      --workspace "$WORKSPACE" --catalog --profile-id "$PROFILE_ID"

Write a selection JSON using an actual ID from that catalog, an authored review title/purpose, and optional notes. The selection shape is:

    {"profile_id":"ACTUAL_SAVED_PROFILE_ID","title":"Authored review title","purpose":"Actual scientific purpose","notes":[]}

Capture, export and reopen:

    python -B -m source_tools.receive_profile_customer_review \
      --workspace "$WORKSPACE" --selection "$PROFILE_REVIEW_SELECTION" \
      --output-directory "$RECEIVING"

The command retains exact original selection bytes once, their SHA-256, actual accepting hostname/interpreter/application/Workspace, capture and Customer review identities, review export, full project backup, restored Workspace and receiving.json.

After an actual customer response is returned, import and inspect it:

    python -B -m source_tools.receive_profile_customer_review \
      --workspace "$WORKSPACE" --selection "$PROFILE_REVIEW_SELECTION" \
      --output-directory "$RECEIVING" --response-file "$ACTUAL_RESPONSE"

Explicitly apply that response:

    python -B -m source_tools.receive_profile_customer_review \
      --workspace "$WORKSPACE" --selection "$PROFILE_REVIEW_SELECTION" \
      --output-directory "$RECEIVING" --response-file "$ACTUAL_RESPONSE" \
      --apply-response

An already imported response can instead be selected with --response-id. When the actual response omitted its reviewer role, include --reviewer-role with the explicit actual role. The command retains the original expected profile review head in an application request before mutation, so retries reuse the same request even after the successful history write.

The command writes immutable per-generation exports and transfers. Later actual responses can use the same receiving directory and produce a distinct generation. Each original archive is verified before reuse. After restore, the command compares exact profile, coefficient source, specification, customer response head, provenance applications and original profile review state, then runs original Customer review validation and the bridge's verification.

## Integration ownership and source pins

This module composes the original APIs inspected at:

- model/profile_editions.py: Git blob eb7f1830e4c46d30f6c36de099ee36463c211a35
- model/reviews.py: Git blob 2f336e52b5d097e11c0093ac20dcc37130798131
- model/workspace.py: maintained source at cumulative 2c1cffc67376ae1ddb09fdec9546e8316c52ebf8
- model/portable.py: current Git blob dc6db0fd42094fc21b494ad6691286a1d071f132; backup bytes/SHA and restored workspace directory verified against this API
- model/setup_review.py: merged scientific setup capture helper family, PR2996

The profile owner join adds only the optional before_commit keyword and its guarded call in the existing original lock scope. The additive operator provider, ordinary extension descriptor and Profile workbench client use this module's APIs. Root coordinates the shared owner join and installer registration; the existing customer-review UI remains the return/import/export interface.
