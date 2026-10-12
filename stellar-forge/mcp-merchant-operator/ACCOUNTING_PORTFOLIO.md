# Installed client portfolio

A client portfolio operates a firm's recurring closes while each client retains
its own original accounting workspace. The coordinator holds firm standards,
named staff capacity, immutable commissioning editions, calendars and prepared
client requests. Client files, procedure editions, period work, returned
corrections, reviewer decisions and assignment handovers remain in the client's
original RunbookWorkspace.

The native browser and CLI, merchant MCP tools, typed client and managed
Applications use that same state and its original writer leases. A portable
portfolio includes separately identified native client packets. Receiving a
portfolio preserves its source; explicit local client receiving and adoption
establish the destination workspaces for the next period.

## Configure the existing host

Retain the existing host configuration and its other providers. Add the
coordinator's portfolioClients mapping under accounting.workspaces. Every
target names another declared, initialized accounting workspace.

~~~json
{
  "accounting": {
    "workspaces": {
      "firm": {
        "directory": "/private/close/firm",
        "outboxDir": "/private/close/firm-source/outbox",
        "proofDir": "/private/close/firm-source/proofs",
        "termsFile": "/private/close/firm-source/terms.json",
        "portfolioClients": {
          "alpha": "alpha_close",
          "bravo": "bravo_close",
          "charlie": "charlie_close"
        },
        "portfolioInputs": {
          "incoming_portfolio": "/private/receiving/portfolio.json"
        }
      },
      "alpha_close": {
        "directory": "/private/close/alpha",
        "outboxDir": "/private/close/alpha-source/outbox",
        "proofDir": "/private/close/alpha-source/proofs",
        "termsFile": "/private/close/alpha-source/terms.json",
        "runbookInputs": {
          "close_file": "/private/alpha/october-close.csv",
          "incoming_period": "/private/receiving/alpha-period.json"
        }
      },
      "bravo_close": {
        "directory": "/private/close/bravo",
        "outboxDir": "/private/close/bravo-source/outbox",
        "proofDir": "/private/close/bravo-source/proofs",
        "termsFile": "/private/close/bravo-source/terms.json"
      },
      "charlie_close": {
        "directory": "/private/close/charlie",
        "outboxDir": "/private/close/charlie-source/outbox",
        "proofDir": "/private/close/charlie-source/proofs",
        "termsFile": "/private/close/charlie-source/terms.json"
      }
    }
  }
}
~~~

Use the actual initialized directories and their original source configuration.
The coordinator and client identities must be distinct. A coordinator can
declare up to 15 client aliases; the original accounting configuration supports
up to 16 workspaces. MCP aliases use lowercase letters, numbers, underscores
and hyphens, up to 64 characters. Nested coordinator declarations must be
acyclic. A client alias cannot select its own coordinator, and two aliases in
one coordinator cannot select the same target workspace.

The host returns these aliases through merchant_accounting_sources. Tool
requests contain aliases and original IDs. Files arrive through the existing
runbookInputs or portfolioInputs reader; an agent does not supply a host path
in an operation request.

Use the existing recovery object on each workspace when its maintenance state,
backup root or passphrase environment is configured. The portfolio borrows
the original client sessions through their maintenance admission. It retains
each borrowed owner until accepted work has drained and its final owner closes.
An explicitly opened client remains open for its own caller. A failed shutdown
retains the same runtime and lease for the next close attempt.

## One original application

Select **Client portfolio** in Applications. Choose the existing host JSON
configuration and its coordinator alias. The launcher reviews the original
coordinator and all configured client identities and source bindings, then
retains the configuration SHA256 with the original managed command.

The application reserves the complete selected workspace set through the
existing Applications resource locks and retained run records. A separate
Runbooks or Cryptoworth application selecting one of those workspaces uses the
same resource key. A pending or running original application must be continued
or stopped before that workspace is selected by another application.

The original accounting server opens **/portfolio.html**. Each client opens
the same Runbooks desk under **/portfolio/clients/ALIAS/runbooks.html** through
the coordinator's existing child admission. Its files, API calls, preparation
and review actions go to that exact client workspace.

Close the coordinator and any explicitly opened client MCP sessions before
starting the managed application. Stop its original managed run before opening
those directories in another stopped-owner CLI or MCP process. On reopen,
Applications preserves its existing application/run identity, original command,
reviewed configuration and full workspace selection.

## Native CLI and source exports

The existing installed command forwards portfolio operations:

~~~sh
starforge merchant-accounting-workspace portfolio inspect \
  --config /private/operator.json --coordinator firm

starforge merchant-accounting-workspace portfolio status \
  --config /private/operator.json --coordinator firm

starforge merchant-accounting-workspace portfolio live \
  --url http://127.0.0.1:8446
~~~

Use the original running browser's URL, or the configuration and coordinator
while those original owners are stopped. The CLI closes the workspaces it
opened after its exact command finishes.

The original operator sequence is:

~~~sh
starforge merchant-accounting-workspace portfolio preview \
  --url http://127.0.0.1:8446 \
  --input /private/calendar-input.json --out /private/calendar-preview.json

starforge merchant-accounting-workspace portfolio prepare \
  --url http://127.0.0.1:8446 --action schedule \
  --input /private/reviewed-calendar.json --out /private/saved-calendar-request.json

starforge merchant-accounting-workspace portfolio execute \
  --url http://127.0.0.1:8446 --prepared /private/saved-calendar-request.json

starforge merchant-accounting-workspace portfolio reconcile \
  --url http://127.0.0.1:8446 --prepared /private/saved-calendar-request.json
~~~

For a child action, native CLI preparation uses **--action prepare-command**.
The agent-client action is **command**; both call the same original
PortfolioWorkspace.prepare method and record portfolio_command_prepared.

~~~sh
starforge merchant-accounting-workspace portfolio command \
  --url http://127.0.0.1:8446 --id ORIGINAL_COMMAND_UUID

starforge merchant-accounting-workspace portfolio execute-command \
  --url http://127.0.0.1:8446 --id ORIGINAL_COMMAND_UUID --sha COMPLETE_COMMAND_SHA256

starforge merchant-accounting-workspace portfolio result \
  --url http://127.0.0.1:8446 --id ORIGINAL_COMMAND_UUID
~~~

The installed package exports are:

| Export | Original entry point |
| --- | --- |
| @tokenjunkielabs/starforge-merchant/merchant/accounting-portfolio | Typed merchant client and prepared-request validation. |
| .../accounting-portfolio/operations | Native portfolioMain CLI. |
| .../accounting-portfolio/workspace | Original PortfolioWorkspace. |
| .../accounting-portfolio/connections | Original configuration inspector and admitted native client pool. |
| .../accounting-runbooks | Original per-client procedures, work, review and assignment client. |

## Agent tools and complete observations

All coordinator tool names begin with **merchant_accounting_portfolio_**.

| Suffix | Work |
| --- | --- |
| status | Firm standards and counts; complete pages of firm editions, staff, clients, calendars, commands, captures and received portfolios. |
| source | One configured client's actual books, periods, files, accountant handoffs, selected returns and closes. |
| live | Actual current commissioned client identity, procedure edition and period state. |
| client | Current commission and all retained commissioning editions. |
| plan | Frozen calendar rows, staff, allocations, daily capacity, conflicts and explicit handling notes. |
| command | The complete original saved client command and native request. |
| result | The selected client's actual saved result for that command UUID. |
| received | Received source metadata and complete separate client-packet identities. |
| operation | A committed coordinator request and original native digest. |
| preview | Complete calendar allocation against selected sources and named capacity. |
| prepare | A complete original coordinator request, without committing it. |
| execute / reconcile | Commit or recover that exact saved coordinator request. |
| execute_command | Execute or recover the retained child request under its original writer. |

Pages contain at most 50 whole rows, with a 512 KiB serialized-items target.
An individual larger row stays complete. Continue from the actual nextOffset;
null means all records in that selection have been read.

Coordinator pages can pin workspaceId and expectedRevision. Source pages also
pin clientWorkspaceId and expectedClientRevision; source and live pages expose
observationSha256 for the whole joined observation. The typed all* methods
carry those original bindings automatically and reject a changed observation.
A new page sequence can then select the actual current state.

Read full client procedure steps, resource notes, preparation rounds, reviews
and assignment work through the original Runbooks client for that configured
client workspace. The portfolio's source and live views identify those original
records; they preserve the distinction between coordinator and child revisions.

## Commission actual client work

First save a firm edition with a named lead, a different backup, a reviewer and
their actual working calendars. Capacity is expressed in whole minutes per
calendar day, with explicit working weekdays, holidays and time off. The
allocation method schedules reviewed work within the stated date horizon;
staffing and estimates are operator inputs.

~~~js
import {connectAccountingPortfolioClient}
  from '@tokenjunkielabs/starforge-merchant/merchant/accounting-portfolio';

const portfolio = await connectAccountingPortfolioClient({
  workspace: 'firm',
  url: 'http://127.0.0.1:8765/mcp',
  tokenEnv: 'MERCHANT_OPERATOR_TOKEN'
});
await portfolio.open();

const request = await portfolio.prepare('configure', {
  actor: 'Close manager',
  expectedFirmEditionId: null,
  firm: {
    name: 'Client close practice',
    closeStandard: 'Use the approved client procedures and original close source.',
    reportingStandard: 'Preparer resolves the checklist; reviewer records the decision.',
    reportingCadence: 'A saved client period for each agreed close.',
    escalationNote: 'Record source gaps and named backup handover in the client period.'
  },
  staff: [
    {id:'lead', name:'Assigned lead', minutesPerDay:240, workingDays:[1,2,3,4,5]},
    {id:'backup', name:'Assigned backup', minutesPerDay:180, workingDays:[1,2,3,4,5]},
    {id:'reviewer', name:'Assigned reviewer', minutesPerDay:120, workingDays:[1,2,3,4,5]}
  ]
});
// Persist this complete object in the caller's original retained operation.
const configured = await portfolio.execute(request);
~~~

For each client, read source(alias), choose a real runbookId and immutable
editionId from that original client, and prepare commission with the observed
client workspace/revision. Retain the actual scope, reporting instructions,
readiness gaps and assigned people. Recommissioning names clientId and its
current expectedCommissionId; the previous edition remains retained.

A commission's state is DISCOVERY, READY or ACTIVE. These are saved operator
observations; a later live read still observes the actual original procedure and
periods. Keep the commissioned full-edition identity when creating calendars
and portable receiving.

## Two periods and reviewed capacity

A calendar input contains a label, startDate, endDate and complete client rows.
Each row has a stable id, clientId, commissionId, period label, close/review
dates, preparation/review minutes and optional backup minutes. It can select an
existing cycleId, or the actual source for a future original client period:
retained client files or an exact accountant handoff/return.

Use preview to inspect every allocation and conflict. Save schedule with the
returned previewSha256 and an explicit capacityExceptions note for each
displayed conflict. Revising an existing calendar names its latest
previousPlanId; the saved series and historical calendar remain.

A practical complete receiving operation uses three separate clients across
two periods. It selects each client's actual local close files or retained
accountant source, saves a staggered calendar, creates the first periods through
their original writers, carries one lead-to-backup handover through review,
then prepares the following periods from the prior client histories. Calendar
allocation includes current retained bookings; each subsequent preview uses
the actual complete source and current firm edition.

## Retain, execute and correct a client request

Preparing **command** saves coordinator metadata containing a separate native
child UUID. Its input selects clientId, action, clientWorkspaceId,
clientRevision and full native parameters. It may select a saved planId/rowId,
which binds the request to the planned client source and assignments.

Supported child actions are save, create, assign, work, submit and review.
The original per-client Runbooks methods remain the writers for all of them.

~~~js
const prepared = await portfolio.prepare('command', {
  actor: 'Close manager',
  clientId,
  action: 'assign',
  nativeRequestId: originalChildRequestId,
  clientWorkspaceId,
  clientRevision,
  parameters: {
    cycleId,
    expectedAssignmentSha256: observedAssignment.sha256,
    preparer: 'Assigned backup',
    note: 'Lead handed over the saved preparation, unresolved items and next deadline.'
  }
});
const saved = await portfolio.execute(prepared);
const selected = await portfolio.command(saved.commandId);
// Retain selected.command in the same caller operation before dispatch.
const result = await portfolio.executeCommand(selected.command);
~~~

After a lost reply, result(selected.command) reads the original child's request
UUID. executeCommand also recovers a committed native result first. The result
contains both the coordinator envelope and the child's native workspace,
request UUID and revision; a child mutation does not increment the coordinator
revision.

If an uncommitted child request needs a correction, prepare a new coordinator
command with replacesCommandId naming the current end of that correction
chain. Keep the same nativeRequestId, action, original client and target. Use
the actual child revision and corrected input. The coordinator checks that the
original native UUID remains absent while it saves that correction.
An uncommitted historical command with a successor stays readable and cannot
dispatch. If the original child operation already committed, recover that
original result.

An unknown outcome keeps the original request available for exact replay.
Only a native rejection explicitly reporting applied:false establishes that
the attempted mutation was not committed.

## Responsibility and review stay in the client

The Runbooks assign action pins expectedAssignmentSha256, names the responsible
operator, describes the handover and changes at least one of preparer, reviewer
or dueDate. Its original assignment digest includes the current phase and work
digest, so an intervening preparation edit requires a fresh handover review.

The period retains initialAssignments and every full handover snapshot.
The original cycle views expose current assignment identity, paged handover
headers and a selected handover's complete saved work. Original task CSV,
printable output and portable packet preserve the assignment history.

Use the existing work, submit and review actions after handover. Returning a
preparation for correction preserves its submitted work. The backup corrects
the original period and resubmits; the reviewer retains the actual decision and
any accepted exceptions. Closing and reopening the same client restores those
records and their original UUIDs.

## Complete portable receiving and the next local period

Capture selects the exact client workspace/revision and every intended cycleId
for each client. Include a period using the commissioned procedure edition.
The capture freezes firm and commissioning editions, calendars and prepared
requests, plus the complete original native packets for the selected periods.

1. Execute the prepared capture and retain its captureId and complete file SHA.
2. Download its original packet through file kind portfolio, captureId and
   file packet. The shared retained reader pins the original selection and
   complete file bytes.
3. In a separately initialized destination coordinator, prepare receive using
   its portfolioInputs alias. The complete packet bytes and SHA are bound into
   the original prepared request. A committed request reconciles even if that
   input file later changes or is absent.
4. Read all received packet identities. Download each separate original client
   packet using receivedId, source clientId, cycleId and file packet.
5. Receive each of those native packets through the destination client's
   original Runbooks receive action. The received periods preserve source
   identity and history; they remain read-only.
6. Prepare adopt in the destination coordinator, pinning receivedId,
   expectedPacketSha256 and explicit source-client to local-alias bindings.
   Each binding selects the actual local client workspace and revision.
   Optional firm adoption names the current expectedFirmEditionId.
7. Create the next local client periods from those received procedure editions
   and their actual new local close sources. Retain previousCycleId to connect
   each new period to its received history.

A portfolio packet is limited to 64 MiB with at most 256 MiB of complete
expanded client packets. Every original client packet keeps its own native
limit. Captures select up to 15 distinct clients and 100 distinct periods per
client, within the complete packet limits. Use complete separate captures when
the selected original history is larger.

Download examples use the same retained-file client:

~~~js
const identity = await portfolio.fileInfo({
  kind: 'portfolio', captureId, file: 'packet'
});
await portfolio.download(
  {kind:'portfolio', captureId, file:'packet'},
  {expectedSha256:identity.sha256, output:'/private/delivery/portfolio.json'}
);
await portfolio.closeWorkspace();
~~~

Calendar downloads select planId and file calendar.csv or print. A whole
received portfolio downloads with receivedId and file packet; its original
incoming bytes remain exact. Received client downloads additionally select
clientId and cycleId. Native CLI uses received-packet for the whole incoming
portfolio and client-packet for a selected original period. All
read chunks retain their selector, readId and expectedSha256. The SDK drains
its accepted calls and unfinished read leases before closing the original
workspace; a failed close is retryable on that same client.

## Original source

The native methods, packet reconstruction, assignment and maintenance
controllers are under
[the accounting workspace](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/).
[Installed Runbooks](ACCOUNTING_RUNBOOKS.md) describes the per-client procedures
and original files. The portfolio contribution registers this installed
surface and Applications provider in the existing distribution; it uses the
same merchant command and original package runtime.
