# Seasonal mooring service workspace

A complete offline operating companion for a marine-service team. Open **mooring-service-operations.html** to manage actual moorings and their owners, vessels, components, permits, seasonal jobs, inspections, repairs, municipal handoffs and stored gear. The same file contains the application, complete six-operator source catalogue and editable demonstration programme.

The application keeps the important distinctions in this work: a requested visit is separate from a confirmed assignment; completed field work is separate from a submitted report; and an authority response is separate from the permit record that accompanies a later job. Every completed operation retains its original source snapshot. Later edits remain visible in the full saved history.

**Needs expert review:** mooring design, component adequacy, inspection findings and municipal requirements need the actual qualified operator and relevant authority. The application organizes their original measurements, decisions and evidence. Published intervals and company descriptions remain attributed source context; inspection/service dates and required permits are entered for each actual mooring.

## Start and continue

1. Open the standalone HTML. Create an empty workspace for actual records, or load the clearly labelled demonstration programme.
2. Enter the actual owner and crew records, equipment, mooring, original vessel and coordinate information, and physical components. Choose one source operator as the operating context. A company profile never creates physical assets.
3. Enter each actual permit, jurisdiction, applicable dates and decision reference. Enter inspection and service due dates with their source. A required-permit job is reviewed against those recorded dates and the mooring identity attached to the decision.
4. Prepare a visit, choose crew/workboat/equipment and required checklist, then review and confirm the complete assignment. Start actual work using its recorded time. Keep measurements and coordinate strings in their original units and datum.
5. Save exact field files, finalize the inspection, and record linked repair parts, time and outcome. A finding that remains attention, unsafe or not assessed needs a visible completed repair or an explicit operator exception before this selected job can close. Those records never turn into an automated condition certification.
6. If a started visit must stop, record its actual stop time and reason; its partial inspection and work remain preserved. Cancel or reopen repair work with a reason while the parent visit is in progress. Complete the actual field job, then prepare a separate municipal handoff. Record an actual submission reference and authority response. If returned, create an amended successor tied to that original response; the earlier report remains intact.
7. Record installed, winter, stored or retired gear and its actual location. Keep the original component and seasonal movement history for the next programme.
8. Export the complete working JSON and reopen it to continue. Original raw CSV, field files, source mappings, snapshots and history travel together.

The operating guide describes the complete interface. API.md gives every command, field and receiving shape. RECEIVING.md carries the existing operator/browser handoff and the owner's exact rendered-product requirement.

## Original inputs and files

CSV intake requires explicit column mappings or explicit constants. Each row is separately created, linked to a preserved existing mooring, or ignored with a reason. A link attaches the original source row; it does not overwrite the saved owner, vessel or position. BOM, CRLF, quoted commas and the entire source document remain in the working export.

Evidence retains its full original bytes, MIME type, filename, byte count and SHA-256. The application supports 8 MiB per original file, 24 MiB of raw evidence and a 64 MiB complete workspace. Every mutation checks the exact full saved-work size before replacing the current state, so an oversized addition leaves the prior workspace available.

The source catalogue contains public operating facts and publisher URLs. Actual customers, contact details and private field material belong only in the operator's saved workspace. The demonstration uses invented owners, crew, assets, permit decisions, prices and sending references; all personal contact fields are blank.

## What the working files contain

| File | Use |
| --- | --- |
| mooring-service-operations.html | Complete standalone application |
| mooring-core.cjs | Dependency-free browser/CommonJS engine |
| mooring-ui.js and mooring-template.html | Full editable interface and document template |
| mooring-examples.cjs | Complete synchronous/asynchronous operating programme |
| source-catalogue.json and SOURCE-REFRESH.json | Attributed original workflow and current public-source review |
| worked-example.json | Full saved demonstration workspace |
| worked-records.csv and worked-report.html | Readable complete record exports |
| example-walkthrough.json | Navigation and meaning of the worked programme |
| OPERATING-GUIDE.md, API.md and RECEIVING.md | Use, implementation and complete receiving instructions |
| build.cjs | Rebuild the exact standalone HTML with Node built-ins |
| AGENTS.md and LICENSE | Current consumed owner instruction and MIT source terms |

## Rebuild and use the engine

No package install or network connection is needed for the build.

```sh
node build.cjs
```

The browser bundle is assembled from the exact core, examples, public source catalogue and interface. The build rejects missing or repeated template tokens and prints the resulting file identity.

```js
const C = require('./mooring-core.cjs');
const Examples = require('./mooring-examples.cjs');
const catalogue = require('./source-catalogue.json');

const result = Examples.build(C, catalogue);
const full = C.exportWorkspace(result.workspace);
const received = C.importWorkspace(full, { catalogue });
console.log(C.overview(received));
```

The complete programme contains six different operating contexts, original CSV create/link/ignore decisions, finalized inspections with original evidence, a repair with a visible reopen, stored gear, a returned authority submission and its amended successor, an unfinished job, and explicit next-season/assignment review findings. Full receiving reconstructs every retained before/after record and checks the original evidence bytes and source identity. It preserves all earlier history instead of replacing the workspace with a summary.

## Product operation and observation

The current exact source programme runs through 128 saved operations and complete export/reopen. The existing admitted browser course owns the actual rendered desktop and 390 px operation: load the full programme, inspect all populated sections and relevant empty/loading/error states, exercise the main forms and review transitions, download the exact full working files, reopen them, and view all reports and complete project/archive members. The producing worker must LOOK at the actual screens or returned images and repair material problems. AGENTS.md and RECEIVING.md contain the complete standing instruction. Use that original operation and its current source version when continuing this delivery.

## License and attribution

New reusable source and documentation are MIT licensed, copyright 2026 TokenJunkieLabs contributors. Public company and municipal facts retain their original publisher links. This independently authored operating companion supports explicit field mappings and portable files; the saved data remains under the receiving operator's control.
