# Carry complete output into an operating procedure

Use **Use in operating procedure** in an Application, Runtime operation or retained npm-attempt output search. The selection keeps its original file generation, fixed end, exact literal query and context size. It does not follow later appends.

Operating procedures reopens that selection and retains its full descriptor in the current procedure window. Create a named procedure, or choose a saved step and record an attributed observation. The existing procedure writer reads every selected byte through the original guarded output reader, computes every overlapping literal match, and carries two original files on that step:

- The complete original output bytes, with a distinct file identity and SHA-256.
- The original Runtime capture, extended with the exact source selection, byte count, SHA-256, query and a compact index of all match and context offsets.

A capture does not assess the result. The recording operator supplies the assessment, explanation and owner through the existing procedure controls. Remove the output from the next capture when a later observation only needs the saved operating records; the earlier full output remains in revision history.

## Read, hand over and receive

Open **Read complete retained output** below the capture. Match pages, original byte navigation, complete raw download and the complete match-index download use the carried original. They do not contact or launch the original worker.

The readable procedure HTML includes the same independent output reader. Its output frames are sandboxed, with scripts and downloads enabled only for those self-contained readers. Original plan and returned-work frames retain their existing sandbox. The complete procedure JSON contains the full editable plan, every source file and all original request and return history.

Receive that JSON through **Receive an existing procedure** in another Runtime workspace. Receiving verifies the complete carried bytes and recomputes the complete match index. The original source workspace remains identified; the receiving workspace appends its own request. Record the receiving observation there, then return the complete Operating Plan for the original explicit return comparison. Conflicting work, assessments and files use the existing grouped returned-work decisions.

## Complete files and capacity

The original Operating Plan limits remain: each carried file is at most 24 MiB, and the complete plan including all saved revisions is at most 32 MiB. Base64 and successive original revisions also consume that plan capacity. A source or result index that cannot fit is refused in full before the procedure write. Keep the complete native output/download and the retained request; use an appropriate smaller complete source, or the existing archive transfer for larger logs. No source bytes or match rows are silently discarded.

A file replacement, truncation or changed original selection refuses capture. Appends beyond the fixed end are not included. Once captured, its retained SHA-256 binds every original byte; all later reads, receiving and writes verify the complete index against those bytes. This preserves the original reader's live-source guarantees: its generation plus head/tail guard is not a transactional snapshot of unrelated writes to the middle of a live file.

## Command line

Use the existing original output page/search commands to obtain a complete fixed-end selection token. Add the following optional field to the existing procedure create or record request's selection. The original request ID, procedure SHA guard and request replay remain unchanged.

~~~json
{
  "runtimeIds": [],
  "operationIds": [],
  "archiveIds": [],
  "backupOperationIds": [],
  "output": {
    "kind": "runtime",
    "input": {"operationId": "THE-ORIGINAL-OPERATION-UUID"},
    "selection": "THE-ORIGINAL-FIXED-END-SELECTION",
    "query": "exact useful original text",
    "contextBytes": 96
  }
}
~~~

For an npm attempt use kind runtime and input {runtimeId, logFile}, with the exact retained attempt filename. For an Application use kind application and input {applicationId, operationId}. No filesystem path is accepted as an output source.

~~~sh
node runtime-workspace/cli.mjs procedure-create --workspace /private/original --request /private/create.json
node runtime-workspace/cli.mjs procedure-record --workspace /private/original --request /private/observation.json
node runtime-workspace/cli.mjs procedure-export --workspace /private/original --procedure-id UUID --format json --output /private/complete-procedure.json
node runtime-workspace/cli.mjs procedure-export --workspace /private/original --procedure-id UUID --format output-html --capture-id UUID --output /private/output-review.html
node runtime-workspace/cli.mjs procedure-export --workspace /private/original --procedure-id UUID --format output-json --capture-id UUID --output /private/output-review.json
node runtime-workspace/cli.mjs procedure-export --workspace /private/original --procedure-id UUID --format output-index --capture-id UUID --output /private/output-matches.jsonl
~~~

Output JSON contains the full original raw file and complete capture. The compact JSONL index refers to the carried raw file by its source identity, byte length and SHA-256; context offsets are zero-based bytes with exclusive ends. It ends with a complete count. Preserve it together with the raw output or full output JSON.

Every export uses the existing no-overwrite publication. A replay uses the same original request, even if its output source subsequently changes. A different query or selection requires a distinct request.

## Browser continuation

Retained output choices have their own immutable entries in the existing procedure browser store. The active choice is scoped to the original workspace and procedure window. **Reopen retained output selections** exposes earlier choices. Changing a choice never modifies a pending native request: continue or explicitly retain that exact request through the existing request controls.

When browser storage fails, no capture is dispatched through this choice handoff. The original output/search downloads remain available. A failed or uncertain native write leaves its complete original request in the existing procedure journal for replay.

## Native receiving

The additive manual course is receiving/OUTPUT_PROCEDURES_RECEIVE.mjs. Join it to an existing equipped Runtime receiving session with its actual original output selector, writer and independent receiving workspace. It runs the existing complete-output search journey, captures through the browser, verifies the carried raw and full index, opens the receiving workspace, saves an attributed receiving observation, returns that original plan, exports through the maintained CLI command and reopens every carried source.

The course also operates actual desktop and narrow evidence controls, downloads the complete raw output and match index, and saves the original rendered screenshots and readable HTML. Inspect those actual outgoing artifacts before reporting rendered acceptance. This is an operator receiving course, not a default test or CI task.
