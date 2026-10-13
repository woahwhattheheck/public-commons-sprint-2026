# Continue an ended receiving operation with a corrected complete source edition

Use this command after a concrete source correction has been reviewed. Keep the complete original source tree and its SOURCE_MANIFEST.json before editing the application. Preserve the same operation directory, configuration, installed runtime, Node executable, browser selection and original invocation. A source adoption does not execute a native job or an HTTP request.

Stop and close the original receiver normally, or reconcile its actual ended process. Select the exact interrupted operation.json SHA-256, previous full manifest SHA-256 and corrected full manifest SHA-256. Regenerate the corrected manifest over every editable source leaf, including this helper, the receiver and this guide. The manifest excludes only its own SOURCE_MANIFEST.json. Retain the original dlt commit and business-operation selection.

```sh
node /ABS/corrected-application/receiving/source-adoption.mjs \
  --directory /ABS/original-complete-receiving \
  --previous-source /ABS/preserved-original-application \
  --source /ABS/corrected-application \
  --from-sha256 ORIGINAL_COMPLETE_MANIFEST_SHA256 \
  --to-sha256 CORRECTED_COMPLETE_MANIFEST_SHA256 \
  --expected-operation-sha256 ORIGINAL_INTERRUPTED_OPERATION_SHA256 \
  --adoption-id runtime-archive-retention-20261013 \
  --reason 'Retain the exact external runtime archive through the existing verified copy method.'
```

The command acquires the original receiving lock, every current workspace lock, and the native binding lifetime locks. A live original consumer keeps its own lock and the adoption exits. It verifies both entire source trees and preserves their complete files under source-editions/MANIFEST_SHA/source. The original root source-manifest.json remains byte-for-byte intact.

Under source-adoptions/ADOPTION_ID, the command retains the exact intent, full before/after operation JSON, full case file identities, changed-source inventory, complete transition and completion record. The new operation retains every original phase, attempt, project, request, artifact, port, configuration and runtime selection. Only selection.sourceManifest changes; sourceAdoptions appends the explicit transition. Original requests and native outputs remain in place and must keep the same hashes throughout adoption. Literal filesystem links in retained runtime trees are recorded without following them.

If interrupted, repeat the exact adoption command with the same arguments. A prepared transition accepts only its recorded before or after state; it does not rewrite later progress. A persisted transition retains its original timestamp. The pending marker prevents receiver continuation until publication finishes. Repeating a completed current adoption verifies the same source history and returns reused:true. Preserve all partial source copies for this same continuation; do not erase the operation or clear its locks.

After completion, run the original receiving/receive.mjs invocation from the selected corrected application with its existing arguments and --resume. The receiver verifies the source-history chain, selects the current complete edition and skips every completed phase. Its final CUSTOMER_RESULT.json includes all original and adopted source files, full transition artifacts and sourceAdoptions. Existing named packages and earlier native worker selections retain their own original identities; adoption does not change them or make an incompatible worker eligible to resume.
