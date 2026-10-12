# Client portfolio operations

The client portfolio joins firm standards, staff capacity, separately held client runbooks, close calendars and complete handovers. The coordinator holds the client relationships and prepared commands. Each client’s original accounting workspace continues to hold its procedures, source files, preparation, reviews and operation results.

Open **Client portfolio** in the installed Applications panel, or start the original native host. The browser desk is at `/portfolio.html`. Each **Open client desk** link opens the same Runbooks interface mounted at `/portfolio/clients/CLIENT_ALIAS/runbooks.html`.

## Select the original workspaces

The host reads the existing `accounting.workspaces` configuration. Add a `portfolioClients` map to the coordinator entry; each value names another workspace already in the same configuration. A coordinator can select up to 15 distinct client workspaces. The complete accounting configuration supports up to 16 workspace aliases. Select original merchant accounting workspaces with client Runbooks for the coordinator and each portfolio client. The same host configuration can retain other buyer workspace aliases for their issued-period operations.

This is an illustrative configuration with host paths to replace with the already-initialized original workspaces and their actual source directories:

```json
{
  "accounting": {
    "workspaces": {
      "firm": {
        "label": "Firm operations",
        "directory": "/private/firm",
        "outboxDir": "/private/firm-outbox",
        "proofDir": "/private/firm-proof",
        "termsFile": "/private/firm-terms.json",
        "portfolioClients": {
          "client-a": "accounting-a",
          "client-b": "accounting-b",
          "client-c": "accounting-c"
        }
      },
      "accounting-a": {
        "directory": "/private/client-a",
        "outboxDir": "/private/client-a-outbox",
        "proofDir": "/private/client-a-proof",
        "termsFile": "/private/client-a-terms.json"
      },
      "accounting-b": {
        "directory": "/private/client-b",
        "outboxDir": "/private/client-b-outbox",
        "proofDir": "/private/client-b-proof",
        "termsFile": "/private/client-b-terms.json"
      },
      "accounting-c": {
        "directory": "/private/client-c",
        "outboxDir": "/private/client-c-outbox",
        "proofDir": "/private/client-c-proof",
        "termsFile": "/private/client-c-terms.json"
      }
    }
  }
}
```

Reopen an existing host with:

```sh
merchant-accounting-workspace \
  --portfolio-config /private/operator.json \
  --portfolio-workspace firm \
  --desk client-portfolio
```

The source command is `node workspace/server.mjs` with the same flags. The native command requires the existing Node runtime and original accounting workspace dependencies. Initialize each accounting workspace through its existing native setup before selecting it.

The read-only `portfolio inspect` command reports the complete selected configuration:

```sh
merchant-accounting-workspace portfolio inspect \
  --config /private/operator.json --coordinator firm
```

Applications retains the exact selection digest and all coordinator/client workspace resources. Native launch rechecks `--expected-portfolio-sha256` and each original workspace/source binding after acquiring the original writer. Aliases cannot select the same directory, return to their own coordinator, or point at an undeclared workspace.

An optional `recovery` object on each existing workspace keeps its original `stateRoot`, `backupRoot`, `passEnv` and `startPaused` settings. The portfolio uses those same maintenance admissions. A paused client remains visible as unavailable until its original maintenance is resumed.

## Commission the firm and each client

First save the firm’s name, close standard, reporting format and cadence, and escalation instructions. Declare the actual people by stable ID and name. Capacity uses whole minutes per day, working weekday numbers (Sunday 0 through Saturday 6), holiday dates, and explicit time-off intervals. Saving a change retains another firm edition.

Prepare the client’s procedure edition and files in its original Runbooks desk. Client-specific instructions and resources stay there. A procedure edition can contain up to 100 tasks, with the original uploaded supporting files, complete notes and HTTPS references.

Return to the portfolio and select a configured client alias. The source panel reads the actual client workspace ID and revision, its saved runbooks and editions, existing periods, files and accountant handoffs.

Save a client commission with:

- Client name and exact runbook/edition.
- Named preparer, a different backup, and reviewer.
- Delivery scope, source gaps, reporting and escalation instructions.
- Readiness note and the operator’s current discovery, ready or active status.

Each commission is an immutable retained edition. Revising it compares the previous selected edition. The client identity, original workspace, source observation, procedure digest and firm edition remain available in that history.

These operator labels describe the working assignment and readiness decision. Accounting judgments and the customer relationship remain with the responsible practice.

## Build the staggered close calendar

Create a calendar with a label, start date and end date, then add one row per client period. Each row selects a commissioning edition and names its period, preparer, backup, reviewer, close date, review date, planned preparation minutes, review minutes and optional backup reserve.

A row can select an existing original period. A new period can select original client files or an exact accountant handoff/revision. Capacity can be planned before the next period’s files arrive; the actual files must be selected before preparing its create-period command.

Preview uses the saved firm capacity and existing latest calendar editions. It allocates work backwards from deadlines across working calendar dates. Review has a constrained interval between the close date and review date. Actual preparation and review take precedence over backup reserve. Staff holidays and time off reduce available minutes. The ordering is deterministic; it does not promise a globally optimal schedule.

The preview reports:

- Every allocation by date, person, client row, role and minutes.
- Available, existing-booked and new-planned minutes for each day/person.
- Work that did not fit by its deadline.
- Existing bookings that exceed subsequently changed capacity.
- Original client, commissioning, procedure and existing-period identities.

When saving the preview, provide a handling note for each displayed capacity conflict. These notes preserve the operator’s actual resourcing decision. The saved calendar includes its complete preview, firm edition, original source observations, allocations and exceptions.

Revising a calendar selects its current latest edition as `previousPlanId`. The superseded edition remains retained; its replacement supplies capacity bookings for new previews. Historical periods and actual native operations remain unchanged.

## Apply work in the original clients

The portfolio prepares a complete native request before dispatch. Preparation uses the current coordinator guard and selected original client identity/revision, a retained native UUID, actual action parameters and optional saved calendar row.

| Action | Result in the original client |
| --- | --- |
| Save | A new edition of the commissioned runbook |
| Create | A new period with its exact procedures and original source |
| Assign | Responsibility/date handover with the complete prepared-work snapshot |
| Work | An actual procedure result, note and selected supporting files |
| Submit | The complete original preparation handed to review |
| Review | Original approve/return decision and explicit accepted open items |

A create-period command linked to a calendar uses that row’s frozen runbook, edition, label, people, close date and previous period. Its remaining source selection comes from the actual client. The original Runbooks controller validates all source and phase requirements at execution.

Select **Execute** for the saved command. Its source workspace and original request are compared again, and the child’s operation journal is read first. A committed original UUID returns its native result immediately.

**Read result** is read-only. It returns the committed original result or reports that the UUID is absent. Connection errors preserve their uncertainty; the saved command stays available.

### Correct an uncommitted command

If the original request was rejected before application, prepare a correction using the current command as `replacesCommandId` and the same original `nativeRequestId`. The old and corrected complete request bytes remain retained.

The correction must select the current end of its replacement chain, the same client, action and target, and an uncommitted child UUID. Once the correction is saved, a historical uncommitted request cannot dispatch through the portfolio. Coordinator execution and correction share the original coordinator serialization; there is one current chain end.

If a native result is already committed, recover that original result before preparing subsequent work. A child UUID committed with different request bytes is reported as a conflict, with its historical command still available.

## Complete a backup handover

Open the current client period and read its current assignment. The assignment observation covers the actual preparer, reviewer, due date, phase, prepared-work digest and previous handover.

Prepare an assignment command with `expectedAssignmentSha256`, the actual changed preparer/reviewer/date, and a complete handover and open-items note. A change is available during draft, changes requested or review.

The native period retains:

- The initial responsibility/date assignment.
- Every later assignment, its operator/time, and previous handover identity.
- Full before/after responsibility and due date.
- Complete work status, notes and selected supporting-file references at takeover.
- Before/after assignment digests and the corresponding original period history.

The current native period uses the receiving person and agreed date. Existing work, submissions and reviews remain intact. Subsequent work and reviews continue through the original Runbooks workflow.

Period packets carry handover snapshots and all their selected files, including files later replaced in active work. The original period print includes the full responsibility and work history.

For the running portfolio, the original Runbooks CLI can target the mounted client:

```sh
merchant-accounting-workspace runbooks cycle \
  --url http://127.0.0.1:8446 --client client-a --id PERIOD_UUID
```

Use its `prepare --action assign`, `execute` and `reconcile` commands for the same retained native request path.

## Capture and receive the complete portfolio

Capture selects the actual clients, current workspace observations and complete period IDs. Include a period using each client’s commissioned procedure edition. A capture contains the full firm and commissioning histories, calendar editions, prepared commands, and exact native period packets.

Each native packet retains its complete original bytes. The portfolio compresses those bytes and records their original and compressed digests and sizes. A native packet received earlier keeps its original authoring workspace and original packet identity.

A complete portable portfolio is at most 64 MiB as JSON; its native packets can expand to at most 256 MiB in aggregate, with the original 64 MiB per-period limit. Large selections can be retained as separate complete portfolio captures. Each capture records exactly which clients/periods it carries.

The receiving workflow is explicit and usable on another configured coordinator:

1. Receive the complete portfolio file. The receiver validates its firm metadata, command digests, exact compressed/original bytes, native period structures and selected files.
2. Open its retained received view. It presents the original firm/client metadata and each complete native period. Download the original complete portfolio again from this view at any time; its bytes stay exact after receiving and reopen.
3. Download each native period and receive it through the appropriate local client’s original Runbooks desk.
4. Adopt the portfolio’s selected clients into the receiving coordinator. Select fresh local client IDs, configured local aliases, and current original workspace observations.
5. Adopt the original firm edition, or map preparer/backup/reviewer IDs to the receiving firm’s declared people.
6. Prepare the next local period from the received procedure edition and actual new local source files.

Adoption verifies that every selected native period has actually been received into the selected local client workspace with the same exact packet bytes. Incoming commands and calendars remain in the retained incoming portfolio. New local commissions and fresh local commands have their own original coordinator identity.

The coordinator uses the original private runbook blob writer and operation journal. Files are complete, immutable and hash-bound. The feature adds no parallel outcome database.

## Command-line operation and original recovery

The portfolio CLI uses either the running loopback host or the stopped original configured workspaces:

```sh
merchant-accounting-workspace portfolio status \
  --url http://127.0.0.1:8446

merchant-accounting-workspace portfolio status \
  --config /private/operator.json --coordinator firm
```

Use `preview --input ... --out ...` to retain the complete calendar preview. To save any coordinator change, prepare and retain it first:

```sh
merchant-accounting-workspace portfolio prepare \
  --url http://127.0.0.1:8446 \
  --action configure --input /private/firm-input.json \
  --out /private/firm-request.json

merchant-accounting-workspace portfolio execute \
  --url http://127.0.0.1:8446 \
  --prepared /private/firm-request.json

merchant-accounting-workspace portfolio reconcile \
  --url http://127.0.0.1:8446 \
  --prepared /private/firm-request.json
```

Input JSON contains the actual operator and action fields. Prepare adds the current coordinator identity/revision and one request UUID; its native request digest is retained beside the exact input. Outputs must be new or already contain those exact bytes.

The other prepared actions are `commission`, `schedule`, `prepare-command`, `capture`, `receive` and `adopt`. A received file can be supplied with `prepare --action receive --file ...`.

Use `execute-command --id ... --sha ...` to execute a durably prepared original client request and `result --id ...` to read its original outcome. `packet`, `received-packet`, `client-packet`, `calendar` and `print` write complete retained downloads.

The standalone pool owns only clients that it opened. The installed MCP controller borrows from its existing session registry and holds each original maintenance admission until its accepted callback finishes. Explicitly opened client sessions keep their original owners. Shutdown rejects new admissions, drains accepted callbacks and retains a failed close owner for retry.

## Source map

- `portfolio-workspace.mjs`: retained firm/client/calendar/command/handover domain and HTTP routes.
- `portfolio-schedule.mjs`: calendar-day capacity allocation.
- `portfolio-connections.mjs`: read-only configuration binding and original native child ownership.
- `portfolio-cli.mjs`: original retained command and file interface.
- `public/portfolio.*`: firm operator desk.
- `runbooks-workspace.mjs`: original client operations, responsibility handovers, native packets and review.
- `runbooks-cli.mjs`: original client command/file transport and mounted-client selection.
- `server.mjs`: original accounting host, maintenance and mounted client routing.
