# Stove survey-to-handover workspace

**Needs expert review.** This offline operating application carries an enquiry through a preserved survey, explicitly accepted quotation, confirmed attendance, field observations, supplied documents, recorded payments and a later linked service visit. It records the responsible operator’s evidence. It does not decide technical compliance, issue or authenticate certificates, transact payments, send messages or establish receiving by the commercial StovePilot service.

## Open the complete application

Open `index.html` in a current browser. It contains the exact dependency-free core, complete interface, six-source catalogue and worked-programme builder. Use a new workspace for actual work. The complete six-company demonstration contains fictional customer references, addresses, observations, payment references and attendance; it is never evidence of an actual installation or customer relationship.

The interface saves a complete working JSON. Keep that full file for independent reopening: readable CSV and reports are human-facing views, not replacements for original attachments, mappings, survey editions, accepted quotations or retained history. Original files use exact bytes and an 8 MiB per-file limit. The full workspace limit is 64 MiB, including histories and embedded originals.

## Operate the whole flow

1. Keep customer and property references separate. Identify the appliance and retain original enquiry photographs or documents.
2. Record an actual survey with explicit measurement strings, units and sources. Review and finalize the edition. Amend it through a new linked survey, preserving the earlier original.
3. Enter quote lines, currency, explicit tax/discount/deposit, issue and expiry dates, scope and written exceptions. Review the quote before issue and record the actual customer decision separately.
4. Create the job from the accepted scope, configure its required checks and document entries, and request attendance. Confirm only after reviewing job and crew conflicts. A changed confirmed slot becomes a new request.
5. Start actual attendance and append field observations. Later results preserve earlier findings. Finish or abort with actual times, retain unresolved findings and scope additional work separately.
6. Record supplied documents and external payment references. Review the complete handover; commit an immutable edition only when its configured checks, documents, attendance and blocking findings permit it.
7. Select the next service date and basis explicitly. A later concern changes current readiness without rewriting a completed handover. A follow-up job retains the original appliance and preceding scope.

`GUIDE.md` explains every interface section and source distinction. `API.md` is the complete shared interface. `source-refresh.json` and `source-catalogue.json` retain the original first-party URLs and six company-specific workflows. They are reference context, not live prices, employee availability, technical rules or access to a company's customer systems.

## Command-line operation

Node.js 20 or later is sufficient; there are no third-party dependencies, network calls or installation steps.

```sh
node operate.mjs example --output /absolute/private/stove-example
node operate.mjs new --output /absolute/private/new-workspace.json
node operate.mjs receive --input /absolute/private/received-workspace.json --output /absolute/private/reopened-workspace.json
node operate.mjs review --workspace /absolute/private/workspace.json --kind handover --input /absolute/private/handover-input.json --output /absolute/private/handover-review.json
node operate.mjs apply --workspace /absolute/private/workspace.json --command /absolute/private/actual-command.json --output /absolute/private/next-workspace.json
node operate.mjs report --workspace /absolute/private/workspace.json --output /absolute/private/readable-report
```

Each mutation input carries the exact `expectedRevision`; a reviewed command also names its exact review hash. Save the complete returned workspace only after success. All CLI outputs use new files exclusively, so selecting an existing output path fails instead of overwriting accepted source. `attachment` and `handover` export the exact selected original file or frozen completed edition by `--id`.

`examples/` contains the operated full workspace, complete original operations, original CSV/evidence files, walkthrough, readable register and each preserved handover. `operation-result.json` records source-level execution. No graphical browser result is implied by this file.

## Receiving and source integrity

The complete JSON is pinned to the exact catalogue identity and retains its full audited record history. Receiving checks every original attachment hash, record/history linkage, references and frozen snapshots before accepting it. Quote, survey, visit and handover snapshots remain unchanged when current site information or later findings change. Original CSV headers, full file bytes, explicit row decisions and linked target IDs remain in the working file.

Calendar appointments retain an explicit IANA timezone and UTC instants. The daily view includes overnight attendance and clips confirmed crew minutes to the selected local day, including clock changes. A requested date does not consume confirmed crew capacity.

The human-facing reports show selected source scope, current checklist/document state and historical outcomes. They do not turn a supplied certificate into a verified certificate. Retain real original documents and the responsible operator’s reference.

## Current verification and limits

The complete source programme has been operated across all six workflows and independently reopened from its full working JSON. Focused actual continuations cover later handover correction, unchanged older completed HTML, exact repeated commits, service close/reopen, complete 40-row original CSV receiving, a full 8 MiB original and overnight clock-change capacity. Browser pixels and the real outgoing attachments still require the existing equipped receiving course; see `RECEIVING.md` and `AGENTS.md`.

This contribution is reusable public source with fictional operating examples. Private customer correspondence, original prospect records and live credentials are excluded. Existing customer editions, original sends and native packages remain in their original secure receiving surfaces.

## License

MIT; see `LICENSE`. First-party pages remain attributable to their publishers. The catalogue records sourced workflow facts and URLs.
