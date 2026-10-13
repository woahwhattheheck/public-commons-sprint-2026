# Grant reporting procedures and complete receiving

Grant reporting captures the original Budget performance report and its complete case archive, then carries them with a saved customer operating procedure. The procedure covers the pinned budget and source tables, issuer terms, contributor work and invoices, cash reconciliation, funding and capacity, customer installations, outcomes, the issued reporting edition and its receiver.

The installed command is **starforge grant-reporting**. Open **Command finder → Operating plans** to edit its procedure, record findings and retain saved revisions. Both capabilities are included in the **grant-operations** source selection.

## Capture an actual reporting period

Prepare a reporting profile using the original host paths and named operators:

~~~json
{
  "schema": "stellar-forge.grant-reporting-profile.v1",
  "title": "October grant delivery and cash review",
  "customer": "Original customer or grant programme",
  "owner": "Reporting operator",
  "receiving": "Receiving operator, destination and the useful work to continue",
  "workspaceDirectory": "/srv/grant-operations/private/grant",
  "workingDirectory": "/srv/grant-operations/private/october-report",
  "pythonExecutable": "/usr/bin/python3",
  "command": ["starforge"],
  "dueDate": "2026-11-02",
  "notes": "The actual reporting scope and source cutoff."
}
~~~

These are example locations and names. Use the actual original workspace; retain the case ID from its native list or saved Application. Create the working directory for subsequent operator exports. The command array keeps the executable and each argument separate, including paths containing spaces. An installed dispatcher invoked through Node can be recorded as its complete argument prefix.

~~~sh
starforge grant-reporting capture \
  --profile /absolute/reporting-profile.json \
  --case ORIGINAL_CASE_ID \
  --start-date 2026-10-01 --end-date 2026-10-31 \
  --out /absolute/october-reporting.json
~~~

The end date is explicit. Omitting the start date captures all dates through that end. Both native reporting boundaries are inclusive. The original client borrows the running Grant Application. Add **--allow-start** when the selected original native service should be started if it is not running; its client closes the service it owns when capture finishes.

Capture performs the original native performance read, then exports that exact case version and report identity. A changed case returns the original native conflict instead of combining two editions. All Decimal amounts, native asset quantities, original rows and case history come from that native service.

The result is one complete JSON handover containing the native report bytes, original performance ZIP, reporting profile, catalog source identity and full editable operating plan. The initial capture step records that completed read/export; the remaining review work begins in Planned state.

## Perform the whole reporting procedure

Unpack the complete handover:

~~~sh
starforge grant-reporting unpack \
  --bundle /absolute/october-reporting.json \
  --directory /absolute/october-reporting
~~~

Open **operating-plan.html** for the readable procedure. Start Command finder at the same local address used for the operator's saved plans:

~~~sh
starforge discover serve --host 127.0.0.1 --port 8846
~~~

Open **Operating plans** and import **operating-plan.json**. Use the same browser profile, host spelling and port on subsequent visits. Browser drafts and saved history belong to that origin.

Each step contains the work, its inputs, expected result, owner, due date and original selected registration. Native command steps contain separate, shell-quoted arguments with the actual case, plan, period and host paths. Manual review steps open the original Grant Operations controls and record their useful results in the procedure.

Complete the reviews in operating order:

1. Confirm the captured customer, case mode, pinned budget and inclusive reporting dates.
2. Read the original planning/source-table baseline and issuer correspondence.
3. Finish the applicable work/invoice reviews and source-account reconciliation.
4. Explain the complete budget performance views and resolve useful follow-through.
5. Review original funding assignments, remaining capacity, customer installations and outcomes.
6. Freeze the selected report edition and save the procedure's findings.
7. Deliver and receive the complete original case, Application and operating procedure.

When an operation changes the native case, capture its new period report before issuing the reporting package. Continue the **same** edited procedure by passing its complete exported JSON:

~~~sh
starforge grant-reporting capture \
  --profile /absolute/reporting-profile.json \
  --case ORIGINAL_CASE_ID \
  --start-date 2026-10-01 --end-date 2026-10-31 \
  --plan /absolute/current-edited-operating-plan.json \
  --out /absolute/october-reporting-revised.json
~~~

A fresh native capture appends a revision to that same plan. Every earlier revision, custom step and saved step order remains. Built-in review steps keep their recorded status when the native report is unchanged. A changed report resets those review states for the new source edition while retaining the old results in history. Edited step titles, instructions, expected results, owners and due dates remain in the procedure.

A procedure-only edit can be added to its original period handover with **pack**:

~~~sh
starforge grant-reporting pack \
  --bundle /absolute/october-reporting.json \
  --plan /absolute/current-edited-operating-plan.json \
  --out /absolute/october-reporting-reviewed.json
~~~

Pack requires the complete original plan history. It extends that history through the original Operating Plans receiver. It keeps the same original period report and case archive. Capture again when the case itself changed.

## Receive the case, Application and procedure

Use an installed **grant-operations** runtime attached to the receiver's original Runtime workspace. Prepare the existing Grant Application bindings:

~~~json
{
  "runtimeId": "THE_ATTACHED_RUNTIME_ID",
  "label": "Received grant reporting",
  "settings": {
    "workspaceDirectory": "/srv/grant-operations/private/received-grant",
    "pythonExecutable": "/usr/bin/python3",
    "port": 8467
  },
  "caseName": "Received October grant operations",
  "actor": "Receiving operator",
  "allowStart": true
}
~~~

Prepare a receiver reporting profile with the same workspace/Python selection, the actual receiving operator, receiver working directory, executable prefix and continuation instructions. Then run:

~~~sh
starforge grant-reporting receive \
  --bundle /absolute/october-reporting-reviewed.json \
  --workspace /srv/grant-operations/private/runtime-workspace \
  --operation /srv/grant-operations/private/receiving/october-original-operation \
  --bindings /absolute/receiver-application-bindings.json \
  --profile /absolute/receiver-reporting-profile.json \
  --directory /srv/grant-operations/private/received-october-report
~~~

This command retains the complete selected inputs, then calls the original **Grant Application handoff** prepare, receive and save functions. Its existing operation owns the original native import request, local case identity, Application review and saved Application. The complete performance ZIP is received by the original case importer, which retains the source case, native report and selected dates.

Open the saved Grant Application in **Applications → Grant planning and delivery**. Open **Budget performance** for its received period. Import **received-operating-plan.json** in Operating plans.

The received procedure retains every source revision and adds the actual case/Application receiving result. Its current-case and delivery-queue commands use the receiving case, host paths and executable. The original baseline/export command slots are cleared because they describe the producing host's pinned edition. The same steps explain how to review the current received source; the next native capture supplies its current plan revision, case version and report identity.

**receiving-catalog-comparison.json** compares every retained registration with the actual receiving toolkit. Review a changed or missing registration through the selected installed source. Original registrations remain attached to the historical procedure.

## Files and interrupted work

The unpacked set contains:

| File | Useful contents |
| --- | --- |
| grant-reporting.json | Complete source packet, original native bytes and editable procedure. |
| report.json | Every native report row and the original period, case, plan and report identities. |
| performance-handover.zip | Original offline report, all CSVs and the complete native operating case. |
| operating-plan.json | Full saved procedure and all revisions for browser/CLI editing. |
| operating-plan.html | Readable current procedure with findings and selected commands. |
| operating-plan.md | The same current procedure in editable Markdown. |
| reporting-profile.json | Original host and operator settings. |
| REPORTING_FILES.json | Exact member sizes and content hashes. |
| START_HERE.txt | Opening and receiving instructions. |

After complete receiving, **received-application.json**, **received-operating-plan.json**, **received-operating-plan.html** and **receiving-catalog-comparison.json** supply the actual destination continuation.

Existing different files are preserved. Repeating unpack into its original directory continues only identical source content and finishes missing companion files. A different reporting edition uses a new directory.

An interrupted **receive** repeats the same bundle, profiles, Runtime workspace, operation and output directory. The existing Grant Application handoff recovers its retained import request and Application save. A completed catalog comparison keeps its original observation time when a repeated read finds the same toolkit. The full saved Application receipt remains in received-application.json.  Do not create a replacement receiving operation for an unknown original result.

A lost procedure draft is recovered through the existing Operating Plans browser history and JSON receiver. The original case importer owns grant records; the Operating Plans model owns procedure revisions.

The native case importer accepts complete archives up to 32 MiB. The full reporting packet is limited to 128 MiB and retains complete bytes; no report rows or source attachments are truncated.

## Public source interfaces

The pure procedure API is **@tokenjunkielabs/starforge-merchant/grant/reporting-plan**. It exports profile/source inspection, creation, refresh and original receiving continuation.

The native handover API is **@tokenjunkielabs/starforge-merchant/grant/reporting**. It exports capture using an existing GrantWorkspaceClient, complete packet inspection, procedure packing, unpacking and receiving using the original Runtime workspace model. An API caller retains ownership of its supplied client; the installed CLI closes its own client.

The model is composed from the maintained [Operating Plans implementation](../../stellar/scf-starforge-20261009/distribution/discovery/OPERATING_PLANS.md), [native Budget performance](../../stellar/scf_2026/sf47_budget_model/workspace/PERFORMANCE.md), [Grant client](../../stellar/scf_2026/sf47_budget_model/workspace/AGENT.md) and [Grant Application handoff](HANDOFF.md). Source-table, issuer, financial and customer record changes continue in their original applications.
