# Arrangr expansion workspace

A complete operating workspace for the company-expansion and lifecycle project described in Arrangr's October 2026 founder post. Open **web/expansion.html** in a current browser. It contains its own engine and interface; no server or third-party assets are required. Start with **Demonstration**, or import actual source exports in the source panel.

The same engine is available as a Node command. Use Node 20 or later; there are no package dependencies.

```sh
node workspace.cjs demo /absolute/path/to/a-new-arrangr-edition
node workspace.cjs verify /absolute/path/to/a-new-arrangr-edition
```

The first command creates an initial and later working record, migrates the original two-user cohort into an observed organization, follows actual-shaped invitation and confirmed scheduling events, reconciles subscription snapshots and payment/refund rows, then launches a separate Node process to reopen the complete result. It saves **NATIVE_RESULT.json** only after that independent process succeeds. The directory must be new. Existing editions remain intact.

## Real source workflow

1. Establish one fixed observation time and the original source identities. Import organizations, users, events, subscription snapshots and payments in that order. Only existing rows are required; missing billing data is shown as missing.
2. Map exact source columns in the browser, preview normalized rows and review company associations. Every accepted import keeps original file text, original records, column mapping, normalized rows and before/after changes.
3. Resolve ambiguous business domains, contact preferences and company overrides. A matching business email domain is a provisional grouping, not a claim that a company endorses or administers the accounts.
4. Prepare one pilot for an eligible company. The record freezes the original member IDs, champion, baseline and observation time.
5. Use Arrangr's existing admin/invitation and scheduling surfaces. Receive later source observations; keep invitations, accepted memberships, confirmed meetings, billing and cash separate.
6. Reopen a full saved JSON file to continue the same workspace. CSV files are convenient projections; the complete JSON retains original sources and operation history.

### Command-line edition import

```sh
node workspace.cjs init actual-initial-data.json /absolute/path/to/edition-01
node workspace.cjs import /absolute/path/to/edition-01/workspace.json users actual-users.csv user-mapping.json /absolute/path/to/edition-02
node workspace.cjs action /absolute/path/to/edition-02/workspace.json prepare-pilot.json /absolute/path/to/edition-03
node workspace.cjs analyze /absolute/path/to/edition-03/workspace.json
node workspace.cjs export /absolute/path/to/edition-03/workspace.json /absolute/path/to/edition-04
```

Initial JSON contains an explicit `as_of`, optional `workspace_id` and `settings`, and a `data` object with the seven tables. See examples/initial-workspace.json for a complete demonstration.

A mapping file contains `columns` (destination field → exact source heading), `defaults`, and `mode` (`append` or `upsert`). Copy examples/users-mapping.json and bind it to the actual export. The command records the full original text and SHA-256. When an event or billing export has no source-reference column, its original file identity and record ordinal become the retained source reference. It does not manufacture event times, original IDs, permission status or monetary values.

An action includes a stable `id`, `expected_revision`, `type`, its required fields and a useful note. Repeat an identical action ID safely; a different payload under the same ID fails. Import-source IDs behave similarly.

## What the observations mean

The company queue counts product usage from the listed scheduling event types. Team activation is stricter: the pilot must have an observed original team-creation event, at least two original cohort members must accept an invitation into that same organization after creation, and those same members must subsequently have confirmed scheduling activity there. A pending invitation, suggested slot or unrelated linked-calendar appointment does not establish activation.

Recurring revenue comes from supplied subscription snapshots. Collected money comes from supplied signed payment/refund rows. Both retain their currency. The workspace does not derive a bill from public list prices or infer causal uplift from a before/after difference.

A pilot's original cohort survives a transition from domain grouping to a new team. A later move by one member into an unrelated organization is shown for association review; its whole subscription is not silently swept into the pilot. Organization billing may include seats outside the original cohort; this is stated with each result.

## Privacy and operations

Actual imported data remains in the browser session until you choose to download it. The application contains no network or external-send code. Treat downloaded full workspaces as customer data. Use the owner's approved storage and access controls. Contact actions record already-performed work and source evidence; they do not send email.

A closed pilot stays closed. Prepare a new cohort for a later experiment. File imports and workspace changes are guarded against stale asynchronous completion. Browser import/export and the command-line adapter use the same core normalization and analysis.

## Included source

- expansion-core.cjs — complete pure JavaScript engine, original cohort handling and demonstration.
- source-adapter.cjs — explicit original-column mapping and source retention.
- workspace.cjs — real file editions, SHA-256 manifest and independent process reopen.
- web/expansion.html and web/expansion.js — self-contained operator interface and maintained interface source.
- DATA_CONTRACT.md — original record identities and exact event meanings.
- OPERATOR.md — company selection, pilot operation and day-to-day workflow.
- Arrangr_Expansion_Workshare.md — proposed installed-pilot scope and commercial terms.
- SOURCE.md — original founder request and current product references.
- examples/ — fictional initial and completed working records, mapping and action.

## Execution record

The engine and source adapter were executed in the connected JavaScript runtime on 13 October 2026. The complete pilot retained two original members, two accepted invitations and two confirmed users, observed USD recurring revenue of 600→1800 minor units, and net collected money of 1800−200=1600 minor units. Full JSON reopen produced identical analysis; negative refund CSV import retained -200.

A separate scale exercise processed 20,000 users and 60,000 events across 5,000 company groups. Creation took 1308 ms and analysis 1072 ms in that runtime. These are measured demonstration timings for this source edition and environment, not customer production timings. Native file and browser execution can be run with the commands above and the original coordinated host request.
