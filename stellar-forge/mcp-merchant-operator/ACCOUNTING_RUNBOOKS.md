# Installed client runbooks

Client runbooks turn a client's instructions, actual close files and preparer
work into a repeatable reviewed period. The original accounting workspace owns
the procedure editions, work notes, correction rounds, review decisions and
portable handover. Periods select actual client files or one exact accountant
handoff/return already retained in the workspace.

The browser, native CLI, merchant MCP tools and typed client operate on that
same saved state. Applications opens the existing accounting command at the
client-runbooks desk. The original writer lease and maintenance controller
handle admission, draining, backup and reopening.

## Open and configure

Select **Client runbooks** in Applications and choose the initialized private
accounting workspace. The launcher binds its original workspace ID, source
configuration and selected port, then opens **/runbooks.html**.

The native CLI is included in the installed merchant distribution:

~~~sh
starforge merchant-accounting-workspace runbooks status \
  --workspace /private/accounting
starforge merchant-accounting-workspace runbooks status \
  --url http://127.0.0.1:8446
~~~

Use the path while its browser/MCP owner is stopped, or the URL of its running
original browser. [RUNBOOKS.md](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/RUNBOOKS.md)
documents the native inputs, complete browser/CLI workflow and packet format.

For merchant MCP, add **runbookInputs** inside the existing accounting workspace
definition. The following is the accounting section of the existing host
configuration; retain its other providers and access settings.

~~~json
{
  "accounting": {
    "workspaces": {
      "client_close": {
        "directory": "/private/accounting",
        "outboxDir": "/private/merchant/outbox",
        "proofDir": "/private/merchant/proofs",
        "termsFile": "/private/merchant/terms.json",
        "runbookInputs": {
          "close_file": "/private/client/october-close.csv",
          "procedure_notes": "/private/client/close-instructions.md",
          "incoming_packet": "/private/client/received-client-close.json"
        }
      }
    }
  }
}
~~~

Use the initialized workspace's original outbox, proofs and terms.
**merchant_accounting_sources** lists its configured aliases. Open the selected
alias once with **merchant_accounting_open**. Paths stay in host configuration;
the operation tools select aliases.

## Operation tools and complete reading

The tool prefix is **merchant_accounting_runbooks_**.

| Tool suffix | Work |
| --- | --- |
| status | Counts and pages of client books, periods, retained files or received packets. |
| sources | Actual handoff headers, one handoff's exact return revisions, period closes or retained client files. |
| book | A selected immutable procedure edition, all edition headers, complete steps and resources. |
| cycle | A frozen period, current work, source-file metadata, submissions, one submission's full work, reviews and history. |
| operation | The original committed action, target, request digest and result for a UUID. |
| prepare | The complete original request and current workspace/revision, with actual file bytes pinned by alias. |
| execute | The unchanged request through the original writer; a matching saved result is recovered first. |
| reconcile | The matching committed result or NOT_FOUND while preserving that same request. |

Paged views return at most50 full records and stop before the next complete row
would exceed a512KiB serialized items target. A larger single row is returned
whole. Continue from the actual nextOffset, which counts the rows returned;
null means the selection is complete. Long instructions, resource notes and
review text remain complete within their native field limits. The typed
client's allStatus, allSources, allBook and allCycle read every page while pinning
workspace ID, revision and total. A concurrent edit requires reopening the
current observation.

The existing **merchant_accounting_file** tool carries exact bytes with
**kind:"runbooks"**. A period selects its cycleId and **file:"packet"**, **"print"**
or **"tasks.csv"**. A retained upload selects its fileId and **file:"original"**.
The original file reader preserves all selectors, read ID, size and SHA256 for
each chunk. Its existing receiver streams into a private temporary file, verifies
the complete digest and creates the destination after completion.

## Prepare and recover requests

Prepare accepts an action and native input. Input contains actor and that
action's fields; preparation supplies workspaceId, requestId and revision.
Work, submit and review also select cycleId. Attach and receive select one
configured file:

~~~json
{
  "workspace": "client_close",
  "action": "attach",
  "input": {"actor":"Close preparer","type":"text/csv"},
  "file": {"source":"close_file","name":"october-close.csv"}
}
~~~

Save the entire returned **prepared** value before execute. It retains the
action, target period, native input, stable request UUID and native digest.
A selected file carries its configured alias, original name, actual size and
SHA256. A second digest binds the complete prepared wire value.

The native digest is SHA256 of canonical ordinary JSON **{kind,target,input}**,
with recursively sorted object keys, unchanged array order and no trailing
newline. The host expands the pinned original file into the native input before
execution and checks this exact digest. Input files are retained once; their
base64 content is neither copied into every operation receipt nor repeated in
large MCP requests.

After an interrupted response, reconcile the complete saved request. A committed
result remains recoverable when its former input alias is unavailable.
NOT_FOUND keeps the same request for exact execution: an earlier transport call
might still arrive. A changed request using the same UUID conflicts.
An explicit native **applied:false** validation response allows correction and
a newly prepared request. Storage and transport failures are reconciled using
the existing request.

MCP host requests use schema **stellar-forge.accounting-runbook-host-request.v1**.
The native CLI's portable request includes the full file content and uses
**stellar-forge.accounting-runbook-request.v1**. Both execute the same native
digest and journal. Keep each complete representation with its original
interface.

## Installed typed client

~~~js
import {readFile,writeFile} from 'node:fs/promises';
import {connectAccountingRunbooksClient}
  from '@tokenjunkielabs/starforge-merchant/merchant/accounting-runbooks';

const client = await connectAccountingRunbooksClient({
  workspace:'client_close',
  url:process.env.MERCHANT_MCP_URL,
  tokenEnv:'MCP_ACCESS_TOKEN'
});
await client.open();
const status = await client.status();

async function commit(action,input,selection,filename) {
  const prepared = await client.prepare(action,input,selection);
  await writeFile(filename,JSON.stringify(prepared,null,2)+'\n',{
    flag:'wx',mode:0o600
  });
  return client.execute(prepared);
}
~~~

The Runbooks HTTP connection permits up to128MiB per complete JSON-RPC response,
including the protocol's text and structured copies of a prepared request.
Other retained-file clients keep their existing2MiB default. An operator can set
maxResponseBytes to a smaller positive byte limit when their supported procedure
sizes permit it. Exceeding a transport limit keeps the saved request available
for reconciliation.

The access token stays in its environment variable. Existing in-process, stdio
or initialized HTTP consumers can use **createAccountingRunbooksClient** with
their original structured MCP call. The helper above saves each request in an
existing private operation directory before execution. If execution throws,
read that saved request and reconcile it before continuing.

### Retain files, procedures and the period

~~~js
const attachment = await commit(
  'attach',
  {actor:'Close preparer',type:'text/csv'},
  {file:{source:'close_file',name:'october-close.csv'}},
  '/private/operations/01-attach.json'
);

const procedureInput = JSON.parse(await readFile(
  '/private/client/procedures.json','utf8'
));
const book = await commit('save',procedureInput,{},
  '/private/operations/02-procedures.json');

const period = await commit('create',{
  actor:'Close manager',
  runbookId:book.runbookId,
  editionId:book.editionId,
  label:'October2026',
  preparer:'Close preparer',
  reviewer:'Close reviewer',
  dueDate:'2026-11-06',
  sourceKind:'files',
  sourceLabel:'October client close',
  sourceFileIds:[attachment.file.id]
},{},'/private/operations/03-period.json');
~~~

Procedure input supplies actor, name, client, description, resources and steps.
Each step has a stable id, title, full instructions, required flag and resource
IDs. Resources contain a complete note, an HTTPS link or a retained fileId.
Updating an existing book supplies its runbookId and current expectedEditionId.
Each saved edition is immutable; older periods retain their own instructions.

An accountant-source period instead supplies its actual handoffId and
accountantRevisionId **initial** or an exact returned revision ID. A selected
periodCloseId must already belong to that handoff.

### Preparation and review

Each work request supplies the actual stepId, status, note and supporting
fileIds. NOT_APPLICABLE and BLOCKED require a reason. Complete all required
procedures or document their open items before submitting.

~~~js
const work = JSON.parse(await readFile('/private/client/completed-work.json','utf8'));
await commit('work',work,{cycleId:period.cycleId},
  '/private/operations/04-work.json');

const handover = JSON.parse(await readFile('/private/client/handover-note.json','utf8'));
await commit('submit',handover,{cycleId:period.cycleId},
  '/private/operations/05-submit.json');

const review = JSON.parse(await readFile('/private/client/reviewer-decision.json','utf8'));
await commit('review',review,{cycleId:period.cycleId},
  '/private/operations/06-review.json');
~~~

Submit freezes that round's complete work and digest. Review uses
**decision:"RETURN"** with a correction note or **decision:"APPROVE"**.
A returned period accepts corrected work and a new submission while preserving
earlier rounds. Approval of required open items lists their procedure IDs in
acceptedExceptions and records responsibility in the review note.

~~~js
const submissions = await client.allCycle(period.cycleId,'submissions');
const firstRound = await client.allCycle(period.cycleId,'submission_work',{
  submissionId:submissions.items[0].id
});
const reviews = await client.allCycle(period.cycleId,'reviews');
~~~

### Deliver, receive and start the next period

~~~js
const selection = {kind:'runbooks',cycleId:period.cycleId,file:'packet'};
const file = await client.fileInfo(selection);
const delivered = await client.download(selection,{
  expectedSha256:file.sha256,
  output:'/private/handovers/client-close.json'
});
~~~

The receiving workspace declares the delivered file as incoming_packet. Prepare
receive with its actor and that pinned file reference. Receiving validates the
original packet, immutable procedure edition, actual work/review history,
source identities and every included file. The received period stays read-only.

Its procedures can start the next local period: use its book/edition, set
previousCycleId to the received period, and select the next actual local close
files or accountant handoff. Importing an older edition preserves any newer
edition already selected in the local book.

Print exports human-readable instructions and review; tasks.csv exports current
procedure work with spreadsheet formula protection and the original Runbook ID,
Edition ID, Period ID and Task ID columns. Use these saved identities to map
procedures into an existing checklist even when titles repeat. These files can accompany
the firm's existing close-management process.

## Ownership and sizes

Disconnect drains this client's unfinished snapshots while leaving the host's
workspace open. CloseWorkspace drains calls and owned readers before asking the
original host to close the workspace. Use the latter when this workflow owns
the open workspace and is handing it back to its browser or maintenance.

Native limits remain8MiB per retained upload,64MiB per portable period packet,
100 procedures/resources per edition, and the original32MiB workspace state.
Prepared operation receipts remain compact and each selected attachment travels
once in the complete packet.

Cryptoworth and client runbooks share the merchant-accounting Applications
resource family and original command. Startup validates the selected workspace,
source configuration, desk and local URL. The existing lease prevents a second
writer over the same workspace. The distribution contribution exports the typed
client and native operations through the maintained installer.
