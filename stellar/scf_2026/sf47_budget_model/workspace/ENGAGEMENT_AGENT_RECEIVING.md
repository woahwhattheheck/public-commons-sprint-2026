# Contributor Engagements — same-case SDK and MCP receiving

This is the operator and integration guide for `engagement-agent-receiving.mjs`. The companion receives the case that the original Python Contributor Engagements course has already completed. It uses the maintained `GrantWorkspaceClient`, `MerchantGrantWorkspaces`, original managed-launch binding, and original retained-file reader. It creates private observation files and native input-transfer caches. The existing native host remains owned by its original operator.

The Python course invokes this companion after it saves `NATIVE_COMPLETE` and before it packages the final delivery. The whole native case, its book, saved Forecast, saved Portfolio, receiving review, request IDs, original source attachments and event history remain selected. The companion starts no host, opens no SQLite database and runs no financial engine of its own.

## The complete receiving course

One original host is borrowed through the SDK and the MCP provider with `allowStart:false`. The companion inspects both bindings and requires them to resolve the same actual native listener and complete selected source.

It receives the full case and all engagement summaries, reopens the selected book and all three saved model/review objects, reads a native successor seed without saving it, and requests complete book, Forecast and Portfolio previews using the original accepted selections. The previews are retained in full. Current preview source versions are separate from the earlier preview hash that authorized an already accepted command.

For every prepare or receiving command that this native course actually accepted, the companion reuses the exact original request ID, expected version, actor, note, document, selections and preview/reference hashes. It compares the entire returned result with the original saved response. The native request table returns the prior accepted result before version validation, so these are original request replays.

The supported ACTUAL mode can select a pre-existing book by review ID. In that mode the frozen native journal has an `actual-book-reopen` read and may have no accepted prepare request. The companion verifies that exact immutable book and reports `VERIFIED_EXISTING_BOOK`; it omits both prepare replays. It still replays the original accepted receiving request through both interfaces. ACTUAL document mode and WALKTHROUGH mode report `REPLAYED_ACCEPTED_PREPARE` and retain both original commands. An earlier WALKTHROUGH proposed book remains in the original history and list.

The MCP path transfers the complete retained original prepare and receiving request files through the existing begin/chunk/commit input API. In existing-book mode it transfers the complete original book response instead of inventing a prepare request. The provider checks the entire transferred file SHA before selecting its document or normalized selection with the original JSON-pointer API. Command identity remains separate from that referenced data.

The course then receives each interface's complete native engagement case ZIP, every original source attachment, and the full event history. It checks native snapshot/row pages against the complete JSON file rather than treating the provider's presentation fields as the whole response.

The MCP ZIP is deliberately read only partway before closing its actual provider. The companion saves and synchronizes that byte prefix, retains the same snapshot ID and full file SHA, waits for the original reader/client owners to close, and constructs a new provider on the same private export directory. It resumes the saved snapshot at the exact durable offset without reusing the old process-local read ID. Full prefix and final file hashes must match. A process interruption at that boundary resumes the same retained snapshot and checkpoint.

At the end, a fresh case read must retain the complete original program, records, sources, planning selection and version. The final host inspection must still identify the original listener used by that connection. All provider, client, file-reader and file-handle owners drain before the closed observation is published.

## Source and runtime selection

The selected repository root contains both:

- `stellar/scf_2026/sf47_budget_model/`, including the original `budget.py`, workspace engines, launch files and Python receiving course.
- `stellar-forge/mcp-merchant-operator/`, including the current provider, catalogue, shared reader, reader contracts and host-file helpers.

Keep the complete current source selected by the original runtime launchers, including their external repository paths. The final preparer includes the original BOOT_FILES closure, native receiving support, current client/types/guide, all five MCP modules, and these three companion leaves:

1. `stellar/scf_2026/sf47_budget_model/workspace/engagement-agent-receiving.mjs`
2. `stellar/scf_2026/sf47_budget_model/workspace/ENGAGEMENT_AGENT_RECEIVING.md`
3. `stellar/scf_2026/sf47_budget_model/workspace/engagement-agent-receiving.example.json`

The agent manifest is a complete JSON file with this header and a full ordered file array:

~~~json
{
  "schema": "stellar-forge.sf47-engagement-agent-source.v1",
  "repository": "woahwhattheheck/tjlabs-stellar-merchant-workspace",
  "revision": "<full selected 40-character Git commit SHA>",
  "pathBase": "repository",
  "productPath": "stellar/scf_2026/sf47_budget_model",
  "files": [
    {
      "path": "<canonical repository-relative original file>",
      "bytes": 123,
      "sha256": "<full lowercase SHA-256>",
      "mode": 420
    }
  ]
}
~~~

The native source manifest and agent source manifest use the same complete `files` array. Their schemas and provenance headers differ. The companion opens the original native manifest selected by the frozen journal and checks that full equality. It hashes every declared source file, verifies its mode, checks its own executing module against the selected row, and binds every path actually selected by the original launch to that same manifest. Paths containing traversal, aliases or symlinks do not qualify. Repository and revision are source provenance; the full observed bytes and modes remain authoritative.

Use the parent's already selected Node 20 or newer executable. The Python preparer records its actual binary identity and the parent verifies it before launching the child. This module uses Node standard-library APIs and the original selected repository modules; it requires no dependency installation. Keep one immutable source edition per receiving process. The parent owns any deliberate source adoption.

## Original host configuration

Use the existing private configuration schema:

~~~json
{
  "schema": "stellar-forge.sf47-workspace-connection.v1",
  "workspaces": {
    "original": {
      "directory": "/absolute/original/native-workspace",
      "scenarioFile": "/absolute/original/scenario.json",
      "pythonExecutable": "/absolute/original/python",
      "allowStart": false,
      "label": "Original Contributor Engagements workspace"
    }
  }
}
~~~

The full actual file, not this example, is passed with its exact byte count and SHA. Its original optional fields and other aliases may remain; this companion instantiates a provider containing only the selected alias. The original configuration reader resolves the actual paths and inspects native source selection.

The selected alias must explicitly contain `allowStart:false`. The original managed-launch record must already be LISTENING and match the selected source. The client follows the original private launch/access files and probes the native host through its maintained API. The companion does not invent a URL, token, PID, access file or alternate connection. It does not call the browser-link method or put an access fragment in the returned receipt.

## Parent input

The complete example file documents the input shape. It contains placeholders and is not an executable customer selection. The Python parent constructs the real input only after its native phase has completed.

~~~json
{
  "schema": "stellar-forge.sf47-engagement-agent-receiving.v1",
  "operationId": "<same original Python receiving operation>",
  "repositoryRoot": "/absolute/selected/repository",
  "sourceManifest": {
    "path": "/absolute/receiving/ENGAGEMENT_AGENT_SOURCE.json",
    "bytes": 12345,
    "sha256": "<actual full file SHA-256>"
  },
  "providerConfiguration": {
    "path": "/absolute/private/grant-workspaces.json",
    "bytes": 456,
    "sha256": "<actual full file SHA-256>"
  },
  "workspace": "original",
  "native": {
    "outcome": {
      "path": "/absolute/receiving/ENGAGEMENT_NATIVE_RECEIVING.json",
      "bytes": 1234,
      "sha256": "<actual full file SHA-256>"
    },
    "journal": {
      "path": "/absolute/receiving/ENGAGEMENT_AGENT_ORIGINAL_JOURNAL.json",
      "bytes": 56789,
      "sha256": "<actual full file SHA-256>"
    }
  },
  "outputDirectory": "/absolute/receiving/agent",
  "parentGuard": {
    "path": "/absolute/receiving/engagement-native.lock",
    "fd": 7,
    "device": "<decimal device identity>",
    "inode": "<decimal inode identity>"
  },
  "chunkBytes": 65536
}
~~~

The outcome is the original `stellar-forge.sf47-engagement-native-receiving.v1.native` object. The journal is an immutable copy made at `NATIVE_COMPLETE`, before agent artifacts are registered. Its artifact paths resolve relative to the journal's parent directory. The companion verifies every complete retained native artifact before a native call, including all selected request and response files. The live Python journal remains Python-owned.

The original native output directory must be private and owned by the current OS user. The observation output is a separate private descendant, outside the repository source. The full provider configuration and all private original data remain private files.

### Inherited guard ownership

The parent passes its already-held `engagement-native.lock` descriptor with Python `pass_fds`. It keeps its original descriptor and flock through the entire child, native ZIP validation and final packaging.

The child compares its inherited descriptor with the exact guard path/device/inode. It retains that descriptor until its owned clients, readers, output handles and result publication finish. It closes the child descriptor once and never invokes `flock(LOCK_UN)`, unlinks the guard, or closes the parent's descriptor.

The stable observation selection excludes the inherited FD number and the per-attempt input filename. A subsequent child may receive a different FD number. The original guard path/device/inode, business/source selections and frozen input file descriptors remain bound.

Only the original parent serializes this child phase. Do not launch a second child or repurpose the shared inherited descriptor as an independent worker lease.

## Invocation and result

The original parent launches one child and waits for its actual close:

~~~text
<selected-node> <repository>/stellar/scf_2026/sf47_budget_model/workspace/engagement-agent-receiving.mjs run --input <private-attempt-input.json>
~~~

The exports are also available for an existing composed caller:

~~~js
receiveEngagementAgent(spec, {signal, onProgress})
inspectEngagementAgentObservation(spec, {signal})
runEngagementAgentCli(argv)
~~~

`receiveEngagementAgent` consumes the inherited guard descriptor. `inspectEngagementAgentObservation` is read-only and never adopts or closes that FD. Both verify the complete selected source and frozen input files. The inspection function requires an already completed result and opens no client or native connection.

The fixed result is `OUTPUT/ENGAGEMENT_AGENT_RESULT.json`:

~~~json
{
  "schema": "stellar-forge.sf47-engagement-agent-receiving.v1.result",
  "state": "COMPLETED",
  "operationId": "<original operation>",
  "selectionSha256": "<complete stable child selection SHA>",
  "outputDirectory": "/absolute/receiving/agent",
  "resultFile": "/absolute/receiving/agent/ENGAGEMENT_AGENT_RESULT.json",
  "native": "<unchanged complete original native outcome object>",
  "source": "<complete selected source provenance object>",
  "requests": ["<one or two original accepted request identity objects>"],
  "bookAdmission": {
    "mode": "REPLAYED_ACCEPTED_PREPARE",
    "originalRead": {
      "path": "responses/<original-book-read>.json",
      "bytes": 1234,
      "sha256": "<original native book response SHA>"
    },
    "requestId": "<original accepted prepare ID>"
  },
  "exports": [
    {
      "path": "/absolute/receiving/agent/responses/sdk-complete-export.zip",
      "bytes": 12345,
      "sha256": "<this complete original SDK ZIP SHA>",
      "transport": "SDK"
    },
    {
      "path": "/absolute/receiving/agent/downloads/mcp-complete-export.zip",
      "bytes": 12346,
      "sha256": "<this complete original MCP ZIP SHA>",
      "transport": "MCP",
      "snapshotId": "<original retained snapshot ID>"
    }
  ],
  "observation": {
    "path": "ENGAGEMENT_AGENT_OBSERVATION.json",
    "bytes": 23456,
    "sha256": "<complete drained observation SHA>"
  },
  "files": [
    {
      "path": "<output-relative file>",
      "bytes": 123,
      "sha256": "<complete file SHA>",
      "mode": 384
    }
  ],
  "custody": "<complete actual close and original guard receipt>"
}
~~~

The strings standing in for objects and the sample byte counts above are explanatory placeholders. The actual result contains full objects and exact file identities. In `VERIFIED_EXISTING_BOOK` mode, `bookAdmission` has no invented prepare request ID. Its original book-read descriptor and immutable book remain present.

All `files[].path` values are canonical relative paths beneath `outputDirectory`. The complete file inventory includes the final child journal, closed observation, retained native response packets, exact input copies, downloaded files, provider snapshot manifests and complete original transfer cache. It excludes only the result file itself, avoiding a self-referential hash.

Each `exports[].path` is absolute. The parent requires exactly one SDK and one MCP export, verifies each file's own complete bytes/SHA, then runs the unchanged Python `read_archive` and `planning_archive` validators after the child has closed. The ZIPs can have different native export timestamps and therefore different byte hashes. Preserve each original ZIP unchanged; compare the complete native case documents with only the native `exportedAt` excluded, and preserve the original planning source/revisions. No second import is performed by the companion.

The result may exist just before the child descriptor has closed. The parent accepts the phase only after actual child close and its own file/ZIP verification. A result file alone is not a process-completion receipt.

## Durable files and recovery

The companion keeps these original owners separate:

| File or directory | Retained role |
| --- | --- |
| `SELECTION.json` | Exact immutable business, source, input and guard selection |
| `inputs/` | Full source manifests, provider configuration, frozen native outcome/journal and original book/command response bytes |
| `JOURNAL.json` | The companion's original step intents, response bindings, durable download pages, attempts and errors |
| `responses/*.packet` | Atomic native SDK response header plus complete unchanged response body |
| `responses/*.json`, `*.zip`, `*.bin` | Exact SDK response body in its ordinary format |
| `observations/` | Full original provider envelopes, selected paged-row results and host observations |
| `downloads/` | Complete MCP JSON, export and source bytes; an unfinished file keeps its own durable prefix |
| `provider/` | The unchanged provider's private native snapshot/input-transfer state |
| `ENGAGEMENT_AGENT_OBSERVATION.json` | Complete closed course and immutable-file inventory after all actual owners drain |
| `ENGAGEMENT_AGENT_RESULT.json` | Completed result and complete final file manifest |

An SDK response is first published as one atomic packet containing metadata and full bytes. If the raw-body file or subsequent step receipt fails to publish, reentry reconstructs those local files from the exact packet rather than requesting another export with a new timestamp.

Every step intent is saved before dispatch. A returned original result is retained even if a stop arrives while the request is in flight. If response publication succeeds but the journal save is interrupted, the same phase adopts that existing exact response. Native writes can only be the original accepted request replays described above.

Every accepted MCP byte page is written completely, file-synchronized, and recorded in the original journal before the next page. On reentry, the companion hashes the original saved page sequence and the whole durable prefix. It discards only uncommitted bytes beyond that saved offset in its own partial file. A changed or absent committed prefix is an error. The original saved snapshot and full-file SHA are never replaced to work around such an error.

Once `ENGAGEMENT_AGENT_OBSERVATION.json` exists, reentry validates its complete immutable files and the unchanged request/download basis. It finishes result publication locally before any client import, native API call or new attempt. Once the result exists, the local inspector additionally verifies every final file/member/mode and all returned export/source/request bindings. Later edits or extra files are reported rather than absorbed into a new manifest.

An interruption before the closed marker keeps the original journal. Resume the same original input selection and output directory after the parent has reaped the prior child. The companion verifies a fresh existing-host binding, reuses completed steps and original request IDs, and continues unfinished reads. It does not create another host or case.

The CLI retains both signal handlers and stdout/stderr error handlers through owner drain and queued output. A stop freezes further work and waits for already accepted native calls. The SDK's original bounded HTTP deadline remains in force. Failed closes retry the same actual client/provider/FileHandle objects at a paced interval; the original first cleanup diagnostic is preserved. The child has no SIGKILL timer for an external host. The parent likewise must retain the original child through actual close.

## Explicit continuation after a connection-admission failure

The maintained client's `open()` and `inspect()` responses report host ownership in `connection`. The MCP provider forwards that same response. This companion requires `connection === "BORROWED_ORIGINAL_SERVICE"` from each interface and checks that their original listener identities match. The provider-reopen receipt retains the observed connection value in its own `state` field.

An already selected receiving source edition remains immutable. If the original course has completed but its companion stopped during connection admission, the parent can select a complete corrected Python caller and Node companion through the explicit `agentExecutionContinuation` contract. This narrow continuation is admitted only when the retained predecessor agent journal is `INTERRUPTED`, all prior attempts are interrupted, and both its steps and downloads are empty. It preserves the complete native case and the original native and agent source manifests. It does not replace a completed agent observation or absorb an unrelated source change.

The Python parent passes the optional keyword `agent_execution_continuation` to `receive(config, *, host_url=None, receiving_url=None, agent_execution_continuation=None)`. It passes the corresponding `agentExecutionContinuation` field to Node:

~~~json
{
  "agentExecutionContinuation": {
    "path": "/absolute/private/execution-continuation.json",
    "bytes": 12345,
    "sha256": "<exact complete sidecar SHA-256>"
  }
}
~~~

These paths and counts illustrate the shape. The original parent constructs the actual sidecar from retained files and reviewed complete postimages. The sidecar schema is `stellar-forge.sf47-engagement-agent-execution-continuation.v1`. It has exactly these top-level fields:

| Field | Required retained value |
| --- | --- |
| `schema` | The execution-continuation schema above |
| `operationId` | The same original native receiving operation |
| `reason` | A nonempty explanation of this concrete source correction |
| `original` | The complete predecessor selection and file identities described below |
| `corrections` | Exactly the selected `python` and `node` prior/current file pairs |

`original` contains `sourceManifest`, `agentSourceManifest`, `nativeSelectionSha256`, `agentSelectionSha256`, `native`, and `agentJournal`. Each manifest or journal reference contains the original absolute `path`, full `bytes`, and `sha256`. `native` retains the exact original outcome and frozen native journal descriptors. The native selection digest uses canonical JSON without a final newline; the Node selection digest uses canonical JSON followed by a newline. `agentJournal` identifies the actual interrupted `agent/JOURNAL.json` before this continuation was admitted.

Each correction is `{prior, current}`. Both file descriptors contain `path`, `bytes`, `sha256`, and numeric permission `mode`. The prior descriptors must match the exact Python and Node rows in the original complete source manifest, including their original absolute repository paths. Current descriptors identify two complete reviewed execution files outside the original repository source directory. The parent verifies that it is executing the selected current Python file; Node verifies its actual `import.meta.url` against the current Node file. Both validate the complete selected correction bytes and modes. Every original manifest member is still read and checked unchanged.

The sidecar is an additional execution record. It is excluded from the frozen native input and Node `SELECTION.json`; those original values and their hashes remain unchanged. Before another connection is opened, Node preserves two exact files:

~~~text
agent/execution-continuations/<sidecar SHA>/execution-continuation.json
agent/execution-continuations/<sidecar SHA>/prior-agent-journal.json
~~~

The first is the complete selected sidecar. The second is the complete original interrupted agent journal, including its failed attempt. Both are published under the existing inherited parent guard and synchronized before the continuing journal is saved. The live Node journal records `executionContinuation: {reference, document}`, with the exact external sidecar descriptor and its full parsed document. A retry after partial publication verifies the same existing bytes; a later retry reads the retained predecessor journal instead of expecting the now-progressed live journal to have its old hash.

If initial admission fails before these records and the adopted journal are durable, the general interruption handler leaves the original journal unchanged. The first error still reaches the parent. Once admission succeeds, ordinary step and attempt recording continues under the same guard.

The corrected observation, drained marker, result, and frozen `journalBasis` retain that same `executionContinuation` object. It is absent during ordinary source execution. Local completed-result inspection requires the same continuation reference and full correction files, and verifies the exact retained predecessor and sidecar along with the ordinary complete output inventory.

The parent keeps its original guard, provider configuration, source directory, native outcome, frozen original request journal, and stable agent phase selection. Its next child input and attempt explicitly name this continuation. The native business course remains completed; the existing agent course resumes against that same case. The original accepted command IDs and returned native results remain the only admitted writes.

The complete local `Contributor_Engagements_Complete_Receiving.zip` includes both corrected execution files under `source/execution-continuations/<sidecar SHA>/`, alongside the unchanged original source selection. Its source receipt records the correction files separately with their full bytes, SHA-256 and permission modes. The normal complete ZIP verification checks every correction member and rejects a collision with an original member. The saved private outer case excludes repository-backed source copies and this source-containing local ZIP; it retains the execution-selection records and an explicit repository, commit and blob receipt for reacquiring the same complete sources.

## Explicit bounds and receiving evidence

The input uses the original 65,536-byte transfer/file-read page size or a smaller selected byte-read limit. Source selection is bounded at 16,384 files and 512 MiB; native frozen artifacts at 1 GiB; original SDK/MCP responses at their maintained 64 MiB limit; individual retained files at 256 MiB; and the complete private observation at 2 GiB. JSON parsing is strict UTF-8, rejects duplicate keys and non-finite numbers, and has explicit depth/value bounds. Original native request files must retain an exact JSON representation that the maintained JavaScript client can replay without changing values or request hashes. There is no source, row or attachment truncation to fit a bound.

Preserve the complete source in its repository and the complete source inventory/commit references in the private receiving package. Private inputs, requests, outcomes and native outputs belong to the same original private case. No customer credential or private receiving data belongs in the public source repository.

This contribution provides a source-native receiving implementation. A source parse or review is not an executed customer result. Record actual child exit, full result/ZIP validations and final original destination receipt when the original parent runs and delivers this same operation.
