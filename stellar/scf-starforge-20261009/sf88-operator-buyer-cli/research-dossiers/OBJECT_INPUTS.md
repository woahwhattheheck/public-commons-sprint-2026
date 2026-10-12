# Use an acquired Object Buyer file in Research

The existing Research Pipelines pane can receive a completed original Object Buyer file, preserve its exact acquisition identity, and prepare that reviewed file for the original managed processing workflow. The Object Buyer provides a direct link into that same Research listener. File delivery, purchase accounting and provider processing keep their existing owners and records.

## Launch the existing applications

Select the original Object Buyer state on the Research host. Keep the Research connection file private.

~~~sh
starforge research-workspace \
  --dir /private/research \
  --pipeline-source /private/pipeline-source.json \
  --object-state /private/object-buyer \
  --connection-file /private/research-connection.json
~~~

The pipeline source is the existing managed Pipelines account/profile configuration described in [UNSTRUCTURED_PIPELINES.md](./UNSTRUCTURED_PIPELINES.md). Its original limits, provider status and explicit submission controls remain in effect. The selected Object state is the same directory used by buyer-object-workspace.

Connect Object Buyer to the original listener:

~~~sh
starforge buyer-object-workspace \
  --state /private/object-buyer \
  --research-connection-file /private/research-connection.json \
  --research-directory /private/research
~~~

The existing applications can also be launched directly through object-workspace/server.mjs and research-dossiers/server.mjs with the same flags. The Research host owns its listener, configured account and processing operations. Closing the Object Buyer or the Research client detaches that client; it does not stop Research.

## Complete the customer workflow

1. Select a completed assembled file in Object Buyer and choose **Use in Research**. Open the returned private Research link. The original session is selected in the **Document pipelines** tab.
2. Select a research dossier, or create one and add its question. The **Use a completed Object Buyer file** section also lists the launcher-selected saved acquisitions.
3. Choose **Review exact delivered file**. Research reopens the existing original Object acquisition through its native Node API. It checks the saved session, configuration, snapshot, complete assembly size and SHA-256, then streams a verified private copy into Research.
4. Inspect the captured file and original acquisition reference. Choose the existing processing profile, the research question and a job label. **Save processing preparation** binds that exact captured review into the original immutable Pipeline preparation.
5. Review the original plan's files, provider account and processing profile. **Submit reviewed job** is the existing explicit provider submission. Its status, lost-response reconciliation, cancellation and output retention use the same managed operation.
6. Retain the advertised provider output, inspect its original elements, then **Receive reviewed edition** into the question. The retained edition and full portable dossier preserve the acquired input reference. Reopen them through the existing Research receiving/export commands.

Review and preparation do not acquire another object or request another payment. They do not submit provider work. Original settlement and financial evidence remain in the Object Buyer's existing accounting history.

## Continue from the original command line

The maintained research-client uses the private connection file and exact original Research directory on every call:

~~~sh
starforge research-client object-inputs \
  --connection-file /private/research-connection.json \
  --directory /private/research --id DOSSIER_ID

starforge research-client object-review \
  --connection-file /private/research-connection.json \
  --directory /private/research --id DOSSIER_ID --input review-request.json

starforge research-client object-prepare \
  --connection-file /private/research-connection.json \
  --directory /private/research --id DOSSIER_ID --input preparation-request.json

starforge research-client pipeline-review \
  --connection-file /private/research-connection.json \
  --directory /private/research --id DOSSIER_ID --operation ORIGINAL_OPERATION_ID
~~~

A review request selects a session name and the UUID returned by object-inputs. Reuse the exact requestId to recover a lost reply:

~~~json
{
  "requestId": "customer-document-review-001",
  "session": "events",
  "expectedSessionId": "UUID_RETURNED_BY_ORIGINAL_INVENTORY"
}
~~~

A preparation request uses the captured review's ID/hash and the current original dossier revision:

~~~json
{
  "requestId": "customer-document-preparation-001",
  "profileId": "EXISTING_PROFILE_ID",
  "questionId": "EXISTING_QUESTION_ID",
  "label": "Review the acquired source document",
  "expectedRevision": 2,
  "reviewId": "REVIEW_ID_RETURNED_BY_OBJECT_REVIEW",
  "expectedReviewSha256": "SHA256_RETURNED_BY_OBJECT_REVIEW"
}
~~~

Use object-reviews for retained review history and pipeline-list for the original preparation and operation history. Later acquisition pages use the snapshot and nextAfter returned by page one. Review pages use their returned nextAfter. The original Object command can print the same private Research link:

~~~sh
starforge buyer-object research-open \
  --state /private/object-buyer --session events \
  --research-connection-file /private/research-connection.json \
  --research-directory /private/research
~~~

## Receiving and restart behavior

The original file review has one immutable request ID. Its first native observation and prepared identity are published atomically together, before the verified file copy is finalized. A restart reuses that observation, so later inspection timestamps cannot replace the original capture. A finished private copy can complete its pending review even if the earlier Object download has subsequently disappeared.

Each review preserves its dossier, source workspace, session UUID, source intent, configuration digest, snapshot, delivery mode, exact bytes and SHA-256, and the original chunk manifest digest. A managed processing input adds that validated reference to its existing sourceRef field. The portable Research edition carries the same reference beside the original provider input metadata; the existing output parser and dossier projection remain unchanged.

A lost preparation reply resolves the original operation by requestId before looking at the current source or dossier revision. It never creates a replacement provider job. The browser retains unresolved review/preparation requests in its existing local browser context and can read the server's completed review history after reopening.

The receiving copy belongs to Research. Once a review is complete, preparing it does not require the source download to remain available. It verifies the captured bytes again before giving them to the original managed operation. Removing or changing a captured file therefore prevents a new preparation; an already prepared operation retains its own original input.

Native Object files can be whole or assembled from chunks. Empty objects remain valid original acquisitions, but the managed processing API requires a nonempty input. Its existing maximum input size and configured profile limits apply. The page shows those unavailable inputs without attempting acquisition, assembly or processing.

## Original interfaces

The existing private Research server adds:

| Method and route | Result |
| --- | --- |
| GET /api/dossiers/ID/pipelines/objects | Saved native session inventory |
| GET /api/dossiers/ID/pipelines/object-reviews | Captured review history |
| POST /api/dossiers/ID/pipelines/objects/review | Verified private input review |
| POST /api/dossiers/ID/pipelines/objects/prepare | Original managed preparation |

All routes retain the original bearer token, loopback host/origin and workspace/instance guards. The browser supplies only saved IDs, review digests and original dossier/profile fields. Local source paths are selected by the launcher.

ResearchWorkspaceClient exposes objectInputs, objectReviews, reviewObjectInput, prepareObjectPipeline, pipelineOperations and pipelineOperation using the same connection and request lifecycle. The Object workspace adds POST /api/research/open for its selected session/revision; it validates the configured original Research identity and returns the private link.

The capture service closes its owned file work when the Research server closes. Its streamed reads and verified file copy observe cancellation; an accepted original preparation retains its normal immutable recovery records.
