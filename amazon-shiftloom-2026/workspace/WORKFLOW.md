# ShiftLoom coordinator workflow

This application retains the original exports, their field mappings, explicit coordinator values, frozen coverage boards, original planner proposals and named decisions in one SQLite workspace. The browser is a local operator interface to that retained workflow.

## Open or resume a workspace

From this directory, run:

```sh
python3 app.py --db /absolute/private/path/coverage.sqlite --port 8802
```

Use Python 3.10 or later and Node 22.16 or later. Open the local address printed by the command. The source directory contains the original planner and its narrow native bridge. The selected database holds the operating data. Keep that database in a location intended for the organization's volunteer records.

The header shows the organization, current workspace revision and retained board count. **Refresh** reads the latest retained state. Each write carries the revision and the local browser session token supplied by the server. If another coordinator has advanced the workspace, the interface refreshes its current state and asks you to inspect the conflict. It does not replay the action automatically.

## 1. Establish the source scope

In **Setup**, enter the organization, a useful workspace label, the site's IANA time zone, and the first day of the seven-day planning period. Record when the source was observed using an offset-bearing timestamp, such as `2026-10-19T09:00:00-04:00`.

Select the actual expiration policy for date-only qualifications. A date can mean valid through that date or expired at its beginning; the choice is visible and retained. Full timestamps preserve their exact instant. Ambiguous or nonexistent local times around daylight-saving changes require an explicit offset in the source.

Include the assignments and context shifts needed to evaluate overlap and weekly workload. A context shift can lie outside the selected week; only assignments starting within the selected seven-day period count toward the period's weekly limit. Use the shift `target` field to keep context shifts out of the planning queue. Confirm the roster-scope declaration once those inputs are assembled and save the setup.

## 2. Retain the actual source files

In **Sources**, upload the actual UTF-8 CSV, TSV or JSON for each of the five source roles:

| Role | Required operating information |
| --- | --- |
| Volunteer roster | Exact volunteer ID, display name, active state, maximum assignments in this week |
| Shifts and reserved places | Exact shift ID, label, interval, total capacity, additional reserved places and required qualification IDs |
| Responses and assignments | Exact response ID, shift ID, volunteer ID and interpreted assignment status |
| Availability and eligibility | Volunteer and shift IDs, affirmative availability and coordinator eligibility |
| Qualifications | Volunteer ID, qualification ID and its status, with expiration and start values when present |

Choose the actual planning role and format. For JSON, select the array with a dotted root path when it is nested; top-level arrays and a `data` array work without a path. Nested object keys appear as dotted column names. The file upload sends the original bytes, retaining its byte-order mark and line endings. A pasted input is stored as the UTF-8 bytes of the pasted text. Each original file is limited to 20 MiB and each source to 100,000 rows.

The native capture route accepts the complete `getconnected.coverage-snapshot.v1` bundle described in [API.md](API.md) and [SOURCE_CONTRACT.md](SOURCE_CONTRACT.md). It preserves the native need/shift, response/user and individual-qualification associations while projecting four planning roles. The coordinator availability and eligibility role is supplied separately. Confirm each resulting role before building a board.

### Map columns and actual source tokens

Open **Field mapping and source value translations**. For each field, choose an original report column or an explicit coordinator constant. Report columns are user-selected in Get Connected, so the interface presents the headers in the actual uploaded file.

Translate source state values explicitly:

- Booleans use `true` or `false`.
- Assignment status uses `confirmed` or `excluded`.
- Qualification status uses `active`, `pending`, `inactive`, `expired`, `rejected` or `resubmit`.
- Required qualification IDs use `|` as their separator.

An empty coordinator constant for required qualification IDs means that the shift requires none. A reserved-place value of zero declares that all occupied places are represented by named assignments. Count additional team reservations separately to avoid counting the same place twice. Weekly limits, capacity and reservations use nonnegative integers.

Use a source date format only when the source does not use ISO dates/timestamps. The format follows Python `strptime`, for example `%m/%d/%Y %I:%M %p`. Review the site time zone alongside it. Saving a mapping confirms the dataset and selects that version for its role.

### Complete coordinator-owned values

The row table shows the current planning values, with pagination over the retained source. **Inspect row** opens the exact original record and any explicit overrides together. Select the rows requiring a weekly limit, reservation, requirement, availability or another coordinator value. Selection can span pages of the same source.

Open **Apply coordinator values to selected rows**, check only the fields you intend to set, and enter their values. A checked field with an empty entry sets an explicit blank. Supply your name and the operational source or reason. The original file remains available through **Download exact original file**. Previously frozen boards retain their earlier source configurations; a correction becomes part of a newly built board.

## 3. Freeze and inspect a coverage board

Return to **Setup**. The five selected-source cards identify the exact versions that will be used. Enter a meaningful board label. Select an earlier board as its parent when these inputs continue an existing planning effort. **Freeze source versions and build board** records the source bytes, mappings, coordinator overrides and settings with the board.

In **Coverage**, inspect occupied places, named assignments, additional reservations and remaining gaps. Open source findings and follow their exact row references. Unresolved identities, duplicate inputs, impossible intervals, invalid capacity and missing required policies must be corrected before the original engine can propose coverage. The retained board makes those findings reviewable; correct the source or its mapping, then build a successor.

Search the roster by actual volunteer name or ID. Its inspector provides existing assignments, availability, eligibility and qualification references. Search shifts by label or exact occurrence ID. Enable context shifts when reviewing overlap outside the target queue. The exact original shift record and its source references are available beside each coverage row.

## 4. Prepare a coverage proposal

Choose **Plan coverage** on a target shift. For an unfilled shift, leave the absent volunteer empty. To replace an absence, choose the exact assigned volunteer. You can separately exclude one additional volunteer. Give the scenario a useful label.

The original planner receives this exact intent and board revision. It checks the full interval for qualification validity and availability, current overlap and workload, coordinator eligibility, and available capacity after reserved places. Its original full-coverage rule and workload/preference/name ranking remain the planning engine. A scenario that cannot be filled is retained with its candidate exclusions and explanation so the operational problem remains inspectable.

## 5. Record the coordinator's decision

In **Plans & decisions**, open the proposed additions and removals. Inspect why each candidate was chosen or excluded and the exact source evidence behind those inputs. Review earlier decisions when the scenario continues a prior board.

Choose approval or rejection, enter the coordinator's name and reason, and confirm that the selected source versions and candidate evidence have been reviewed. Approval applies the exact retained proposal to the same current board and records before/after state. A changed board revision or source selection requires current review. An old approval does not authorize a proposal on corrected inputs.

The latest applied approval can be reversed with a named reason. The reversal is retained in the board's decision history. Earlier plans remain associated with the revisions on which they were made.

To use corrected exports, retain and confirm the new sources, build a successor board, then open the earlier plan and choose **Replan this scenario after source corrections**. Select the successor. The new proposal includes the prior-plan link and earlier review, and needs a new coordinator decision.

## 6. Deliver and reopen the work

In **Handover**, select the board being transferred. Download its complete ZIP, including the selected original sources, frozen settings and mappings, original/current roster, plans, decisions, source-linked changes, review HTML and manifest.

Download the complete SQLite workspace backup to carry all retained source versions and planning history. Stop the local server before replacing its working database. To reopen a downloaded backup, run the same original command with that backup's absolute path. Confirm the organization, selected board, roster and decisions in the browser before continuing.

Use the approved roster and retained explanation to perform assignments through the organization's established Get Connected process. This workspace provides the coordinator's coverage planning and handover; the original source account remains the operational location for those assignments.

## Recover from a lost response

If the browser loses its connection while saving, refresh the retained workspace first. Inspect source versions, board history or the exact scenario before attempting another action. The application does not automatically repeat an uncertain write. If the server restarts, reload the page so it receives the new session token. Continue from the retained database and its current revision.

The native source distinctions, published API and original schema references are recorded in [SOURCE_CONTRACT.md](SOURCE_CONTRACT.md). The local request and response contract is in [API.md](API.md).
