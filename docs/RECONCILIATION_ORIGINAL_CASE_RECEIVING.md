# Native offline-return transaction exercise

This is one receiving command for the completed original Eighteenmile plan. Run it with the current application on PYTHONPATH and the reviewed reconciliation module installed. The script uses Python's standard library and the original native ImplementationStore APIs.

The original Workspace is read only. Two TemporaryDirectory copies receive every change. The first preserves all 88 measurement definitions, samples, original source links and laboratory history while exercising a stale administrative return, one atomic apply, deliberate failure immediately before receipt writing, a later edit, and two replays. The second is explicitly a software fixture based on one real row: independent value/unit edits and a source alias to the same retained CSV require choosing the entire definition. Its altered value and unit are never imported into the original Workspace.

The receiving course pins the completed PR3580 resolver, SHA256 `00e1055832d7f4d95d7c2abf9918da7a4ae39639097336f6cba70cfdbba6f172`. The subsequent site/visit import overlay is applied after this original-resolver exercise.

From the maintained application directory:

```sh
PYTHONPATH=. /ACTUAL/EXISTING/PYTHON -B source_tools/execute_reconciliation_original_case.py \
  --workspace /ACTUAL/COMPLETED/eighteenmile-observed-workspace \
  --expected-model-sha256 00e1055832d7f4d95d7c2abf9918da7a4ae39639097336f6cba70cfdbba6f172 \
  --output /OWNED/reconciliation-original-case-result.json
```

Keep the actual interpreter and Workspace returned by the accepting owner. This is the same available stdlib receiving slot; it does not start another model run or create a source-study Workspace.

A successful command prints a JSON receipt containing the installed model hash, actual original plan revision/digest, result counts, apply/replay revisions, operation IDs, and the original member inventory hash. The receipt path must be new and outside the original Workspace. Assertions stop on a transaction or source mismatch, with the actual Python traceback available to the receiving owner. Temporary copies are removed on success or failure. The supplied source has been reviewed as source; native execution belongs to the accepting receiver.


## Public source transport

The complete executable is retained at `source_tools/execute_reconciliation_original_case.py` in this repository. Receive it from its exact published commit and verify SHA256 `21d4d801d968efe3871febcc81533dbea3946175a01729d2bcbed5df035eaaf0` (15,893 bytes). The original resolver edition required by this exercise is `model/implementation_reconciliation.py` from commit `36e30ef7b95895e741a55f51d104796913f9c5e2`, SHA256 `00e1055832d7f4d95d7c2abf9918da7a4ae39639097336f6cba70cfdbba6f172` (26,852 bytes). Receive these into a copy of the original application, run with that application's root on `PYTHONPATH`, and then apply the newer site/visit import source. The newer bulk import preserves additional history, so it follows this pinned original-resolver exercise.
