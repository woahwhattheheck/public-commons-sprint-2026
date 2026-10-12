# NYC Survey Workplan

A complete local workplan for NYC DOHMH **Master Contractors for Agency Survey Work**, EPIN **81627P0002**. It connects the original 36-item ceiling schedule, the 19-line official price scenario, later assignment pricing, and proposal preparation references.

The application starts with every rate blank. Proposed rates, staff references and preparation decisions come from the operator. A workplan is an editable preparation artifact attached to the existing opportunity; creating or reopening it does not create a new commercial contact, award or invoice.

## Run it

Use Node.js 18 or later. There are no packages to install and no build step.

```sh
node cli.cjs serve
```

Open the loopback URL printed by the command. To prepare a file first and reopen that exact workplan:

```sh
node cli.cjs init --out workplan.json --id nyc-81627p0002-proposal
node cli.cjs serve --workplan workplan.json
```

The browser saves edits in its local storage. **Save JSON** downloads the current workplan. **Export complete bundle** downloads its state, calculations, standalone application and complete source. Browser edits do not silently rewrite the file passed to the local server; save the edited JSON or bundle.

A received bundle's `standalone.html` can also open directly in a modern browser. It embeds the full application and starting workplan. ZIP creation uses the browser's SHA-256 capability; when that capability is unavailable for local files, use the loopback server.

## Use the complete workplan

1. **Rates:** enter the proposed Attachment C ceiling for every item. Unknown values remain blank. An intentionally free item needs an explicit zero. Each row carries its original part, item and physical PDF page.
2. **Official scenario:** review the fixed Attachment D quantities. The application applies the same ceiling rates, calculates each extension and checks the two recorded PASSPort price values against the total.
3. **Assignment:** describe a later agency project, add deliverables, enter quantities and choose optional rates below the schedule ceilings. Record experience, staffing and timing in the same workplan.
4. **Preparation:** record the six required document references and the related questionnaire work. A reviewed item needs a reference. The conditional subcontractor item can be marked not applicable; the six required documents cannot.
5. **Handover:** export the whole bundle, verify it, receive it into a new directory and reopen the same workplan.

The evaluation fields are operator-entered planning scores. They are separate from an agency's actual evaluation. A complete scenario can be calculated while some unused schedule rates remain blank; overall preparation still requires all 36 rates.

## Calculation behavior

Rates use decimal strings with up to six decimal places. Quantities support up to four decimal places; non-hour units require whole quantities. Financial extensions use scaled integers rather than floating-point multiplication. Each extended line is rounded to cents, half upward, and those cents are summed. **This is the application's stated calculation convention; the original RFP does not specify that rounding rule.** Confirm it with the prime before final transcription.

The fixed scenario retains all 19 original rows. Its email quantity includes invitations and reminders. CATI uses the original scenario's explicit attempt count. The source does not state a CAPI approach denominator; the application leaves it unspecified. The scenario is an agency-provided pricing exercise, and carries no assertion of actual fieldwork.

An assignment rate cannot exceed its corresponding ceiling. Translation can apply the allowed 1,000-word minimum for each distinct order and language; the actual and billed quantities remain visible. Keep the entire order on one row when using a minimum. A split order should be consolidated before pricing so a minimum is not charged repeatedly.

Part 4 hourly work requires a description of the distinct ad hoc scope. A row marked as already covered by a project deliverable is rejected as a duplicate labor charge. The application cannot infer actual scope overlap from prose; the prime reviews the deliverable boundary.

Reimbursables record an at-cost basis, description, written approval reference and original receipt reference. A proposed expense can be included in the proposed assignment total while its receiving references are still pending. Its reimbursement readiness remains separate. Travel, postage and messenger categories are rejected.

Incomplete prices remain incomplete. A partial subtotal is explicitly identified and is never exported as a complete scenario or assignment total. A zero denominator produces no fabricated price ratio. The calculation uses the original 63-point technical threshold and the ten-point price formula.

## Portable state and complete receiving

```sh
node cli.cjs inspect --workplan workplan.json
node cli.cjs export --workplan workplan.json --out workplan.zip
node cli.cjs verify --bundle workplan.zip
node cli.cjs receive --bundle workplan.zip --out received
node received/application/cli.cjs serve --workplan received/workplan.json
node received/application/cli.cjs export --workplan received/workplan.json --out reopened.zip
```

Export, verify and receive preserve the workplan ID, revision, dates and source edition. Exporting unchanged state with the same application produces the same bundle bytes. Actual browser edits increment the revision while retaining its identity. Opening JSON or ZIP continues that workplan; **New workplan** creates a separate identity.

Each ZIP contains:

| Member | Purpose |
| --- | --- |
| `workplan.json` | Editable original state, including all blank or entered rates |
| `rate-schedule.csv` | All 36 schedule rates and original source references |
| `official-scenario.csv` | The 19 original extensions and complete total or known subtotal |
| `assignment.csv` | Project service rows and proposed expenses |
| `preparation.csv` | Document/questionnaire states and material references |
| `calculation-report.json` | Complete computed report, errors and preparation status |
| `workplan-summary.md` | Readable costing and handover summary |
| `original-source-register.json` | Procurement edition, original URLs, dates and calculation convention |
| `standalone.html` | Offline application with the same workplan and full embedded source |
| `application/` | All nine runnable source/documentation files |
| `bundle-manifest.json` | Workplan identity, byte counts and SHA-256 for all other members |

Receiving checks ZIP paths, bounds, overlaps, CRC values, manifest membership and each member's SHA-256. It then recalculates and compares all eight state/report exports against the imported workplan. CLI receiving also requires the same trusted nine-file application closure, regenerates the standalone from that closure and workplan, and rejects extra project members. A self-consistent archive with altered calculations, source, or standalone state is rejected. Checksums detect inconsistent or corrupted content; they are not a publisher signature.

The CLI writes to a new receiving directory and preserves existing files. Files and directories are synchronized before publication is acknowledged. It produces an additional receiving record outside the original bundle. When the application has changed, use the matching reviewed application edition for complete-project receiving, or import workplan.json into the current application to continue its state. It never executes source from an imported archive during verification or receiving. Review the source before running an application obtained from an unfamiliar sender. Browser opening imports state into the current application, rather than executing scripts from the uploaded ZIP.

## Original forms and data handling

Keep the original Attachment C and D forms and complete the agency's PASSPort workflow. These CSVs and preparation references help prepare and cross-check that response; they do not replace the original documents. Check the live RFx page for later amendments and current deadlines.

The delivered starting workplan contains public procurement definitions and no respondent records. Agency data processing, approved project systems, subcontracting and newly commissioned work must follow the original contract. Pre-existing source and future commissioned deliverables should remain distinguishable in the actual engagement.

The server serves only the nine application files, binds to loopback and accepts GET/HEAD. It has no accounts, telemetry, remote APIs or payment logic. The browser uses local storage and the files you explicitly download. The original source links are ordinary external links.

## Source map

| File | Responsibility |
| --- | --- |
| `rules.js` | Original rate catalog, fixed scenario, dates and procurement references |
| `core.cjs` | State validation, exact decimal calculations, preparation and export consistency |
| `bundle.cjs` | Stored ZIP, manifest, standalone source embedding and member verification |
| `app.js` | Browser editing, autosave, receiving and export |
| `index.html` / `style.css` | Responsive grayscale interface |
| `cli.cjs` | Initialization, inspection, export, verification, receiving and local server |
| `SOURCE_NOTES.md` | Original references and interpretation boundaries |

No workflow or paid CI configuration is included. Native verification should focus on the complete export/receive/reopen operation and the material financial rules; a large generated test collection is unnecessary.
