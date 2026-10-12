# Opportunity operations workspace

A complete operating workspace for carrying a funded company or community opportunity from its original sources through capabilities, requirement responses, teaming, deadlines, source revisions and a receiving handoff.

The application combines a private browser workspace, a command-line operator, a typed JavaScript model and a portable project package. It uses the maintained SF88 research dossier to retain source editions and the original USAspending bridge to receive existing award research. The full project history travels with its sources and named review packages.

The interface uses a white and gray industrial layout. Every tab supports the work it displays: original files, capabilities and past performance, requirement answers, coverage decisions, team scope, a dependent delivery plan, Q&A, source changes and complete exports.

## Open the complete MCC working record

Requirements: Node.js 24 or later, a writable local working directory, and a current browser. The operator has no additional npm dependency. The original award-directory feature also uses Node's built-in SQLite implementation.

From this directory:

~~~sh
node cli.mjs seed --workspace /absolute/path/opportunity-workspace --operator "Capture lead"
node cli.mjs serve --workspace /absolute/path/opportunity-workspace --operator "Capture lead"
~~~

The first command retains the seven original source payloads and creates all 34 actionable requirement items from the 15 MCC RFI groups. It also installs the source rules, three draft company capabilities and the two precise source-review questions. Its response includes the project ID and the durable intake journal.

The second command prints the private loopback URL. Open that full URL in the browser. Its fragment token gives access to the operating directory for that running server. The page removes the fragment after opening and keeps the token in that browser session. Closing the server revokes that server's URL. Restarting uses the same retained project directory and issues a new URL.

The installed source distribution exposes the same CLI through:

~~~sh
starforge opportunity seed --workspace /absolute/path/opportunity-workspace --operator "Capture lead"
starforge opportunity serve --workspace /absolute/path/opportunity-workspace --operator "Capture lead"
~~~

A new project starts from **New project** in the browser or a **create** action. A receiving operator starts with **Receive package** or the receive command below.

## The included opportunity and company sources

The working source set covers LGNDX's published company and community-pipeline products, the original funded-prime discovery capture, and MCC's Software Development Recompete, reference **95332427K0001**.

| Source group | Retained material | Operating use |
| --- | --- | --- |
| Company | LGNDX company, IX and Apollo EVO published statements with source URLs | Draft capabilities and an existing community-pipeline integration target |
| Funded-prime research | Original capture record and complete 28-row search response | Funding and company research with its original capture identity |
| MCC opportunity | Notice record and government-authored RFI, PWS and industry-day text | Numbered requirements, response rules, source questions and deadlines |
| Operator integration | An explicitly authored receiving exchange and later revision | Implementation mapping, handoff instructions and source-change review |

The company's published product describes integration with existing community tools, pipelines and vendor lists. The offered implementation maps one agreed native exchange after receiving the customer's actual schema, export or receiving format.

The MCC working record preserves the issued answer-or-N/A instruction, 20-page overall limit excluding cover and contents, and the one-page capability statement about similar Federal or multilateral IT support. The AI experience question separately requires operationally deployed work and accepts experience with any organization. The source retains the issued deadline text alongside its explicit interpreted timezone.

Sources:

- [LGNDX IX](https://ix.lgndx.com/)
- [Apollo EVO](https://lgndx.com/product/apollo-evo)
- [Official MCC SAM record](https://sam.gov/workspace/contract/opp/ec4254f4fdf24f8998bd4e10d5b58050/view)
- [Government-authored RFI text](https://govtribe.com/file/government-file/request-for-information-rfi-final-dot-docx)
- [Government-authored PWS text](https://govtribe.com/file/government-file/performance-work-statement-pws-final-dot-docx)
- [Complete source manifest](references/source-manifest.json)

The **Sources** tab shows each retained file's exact byte count, SHA-256, role, URL and capture time. The source viewer opens the complete retained text; **Download original source** returns its bytes. The text copies include original carrier line locators. Subsequent original attachments can be retained alongside them or linked as a new source edition.

## Operate the project

### 1. Retain sources and current company facts

Open **Sources → Retain source**. Select the complete original file or paste its complete text. Record the original filename, media type, URL, capture time and source role. A file may contain up to 24 MiB.

Use **Company** for company publications, **Past performance** for delivered-work evidence, **Solicitation** for issued requirements, **Amendment** for issued changes, **Question response** for official answers and **Partner** for team material. An authored implementation exchange or review memo belongs under **Other**.

**Import award edition** accepts a complete original USAspending edition packet. It preserves the original rows, complete source pages, record occurrences and retained edition identity. A configured original award directory can supply an existing edition by its ID through the command/API action.

Source intake does not overwrite a retained edition. **Retain changed edition** joins the new bytes to the earlier source and opens a source-change record. Existing responses retain their earlier evidence until an operator reviews the change.

### 2. Build capabilities and past performance

Open **Capabilities**. Each record includes its description, owner, tags, review status, delivery state and source references.

Use the two record kinds for distinct material:

- **Capability** describes a current service or operating ability.
- **Past performance** records relevant delivered work and its supporting source.

The delivery field distinguishes unspecified, deployed, pilot and proposed work. For each selected source, enter a precise locator and, when useful, a short supporting excerpt. Reviewing a company description records the evidence actually available for that description. Review the particular requirement separately before marking its coverage supported.

The included three company records begin as draft capabilities. Their source describes the published product; the responding company's operating decisions are then recorded in the workspace.

### 3. Work the whole requirements matrix

Open **Requirements**. Search by number, title, issued text, owner or response. The initial MCC matrix preserves all 34 items and their original numbering.

Each item has:

- The exact issued text and its source locator.
- A response disposition: unanswered, answer or not applicable.
- An owner and work status.
- An evidence rule, including deployed-only experience where the source requires it.
- A separate coverage decision, response draft and review note.

**Edit requirement** changes the work record and answer disposition. **Review coverage** links the capability versions, proposed or confirmed team records, direct source references, the response and the review decision.

Coverage choices are unreviewed, supported, partial, gap, team required and exception. A supported decision needs a source-backed review. A deployed-only requirement additionally needs a reviewed capability marked deployed with retained evidence. A gap can still contain a useful proposed response, a precise owner and the work needed to close it.

This separates company publications, requirement wording and a reviewer's actual coverage decision while keeping them together in the same operating record. Changed capabilities and source editions identify the affected reviews.

### 4. Assign team scope and the dependent plan

Open **Team & plan**. Team records carry the proposed role, exact scope, linked requirements and capabilities, evidence, owner and the current considering/contacted/confirmed/declined disposition.

The milestone plan records an owner, explicit timestamp and timezone, predecessor milestones and affected requirements. A completed milestone's predecessors must be complete. Dependency cycles are rejected. An operator can revise the planned sequence before completing the work.

Use distinct milestones for source intake, company review, response drafting, team inputs, final review and receiving. Keep the solicitation's issued deadline visible in the project metadata and record the internal working milestones explicitly.

### 5. Resolve questions

Open **Q&A**. Keep each question with its source references, affected requirements, owner and deadline. Record the submitted wording and then the exact answer or interpretation. The question status distinguishes open, submitted, answered and parked items.

The included source questions concern the original event/deadline timezone strings and the RFI/PWS deliverable cross-reference. They are retained as explicit working questions, ready for the pursuing company to resolve in its actual response process.

### 6. Review source changes

Retain a new edition from an existing source's action. Open **Changes & history** to see the previous and later source identities and the records affected by that source.

Record the decision, explanation and additional affected records. Update any answer, capability, team input or plan item that needs the new source. A reviewed change remains in history alongside both original editions.

The revision comparison shows actual changes to project metadata, response rules and each collection. Opening a previous revision is read-only. **Return to current project** reopens the live operating record.

### 7. Freeze a receiving handoff

Open **Packages → Create named package edition**. Give the edition a useful title, disposition and receiving instructions.

A named edition retains the exact reviewed source revision, project state, source dossier and rendered handoff files. Subsequent edits create new project revisions. Re-exporting that named edition returns the same selected files.

Each complete package includes:

| File | Receiving purpose |
| --- | --- |
| handoff.html | Readable full operating handoff and response matrix |
| handoff.md | Editable text handoff |
| requirements.csv | Numbered requirements, responses, coverage, review and sources |
| capabilities.csv | Company capabilities and past performance |
| teaming.csv | Team decisions and assigned scope |
| milestones.csv | Owners, deadlines and dependencies |
| questions.csv | Questions, answers and source references |
| Portable JSON | Complete version history, source dossier, named snapshots and all receiving files |

The response exports carry the recorded drafts and dispositions. The package also carries source-review and readiness information so the receiving operator can see the actual remaining work. A named disposition is the operator's recorded decision.

## Command-line operating work

### Inspect current and historical work

~~~sh
node cli.mjs list --workspace /absolute/path/opportunity-workspace
node cli.mjs show --workspace /absolute/path/opportunity-workspace --id opp_ID
node cli.mjs show --workspace /absolute/path/opportunity-workspace --id opp_ID --revision 12
node cli.mjs compare --workspace /absolute/path/opportunity-workspace --id opp_ID --before 12 --after 24
~~~

### Apply one exact operating action

Write the complete intended engine payload to a JSON file, including its current expectedRevision and a stable requestId:

~~~json
{
  "id": "opp_ID",
  "expectedRevision": 12,
  "requestId": "company-review-20261012",
  "capabilityId": "cap_ID",
  "status": "reviewed",
  "owner": "Capture lead"
}
~~~

Then apply it:

~~~sh
node cli.mjs action --workspace /absolute/path/opportunity-workspace --operator "Capture lead" --action save_capability --input company-review.json
~~~

The existing record's other fields are preserved by the partial record update. If the project changed after preparing the input, read the current project and review the intended edit. After an uncertain return, replay the same prepared action with its original request ID and payload. The engine recognizes that exact action across process reopen.

Supported mutation actions are create, update, retain_source, import_award_edition, save_capability, save_requirement, save_coverage, save_team, save_milestone, save_question, review_change and create_package.

The typed fields and response objects are in [model.d.mts](model.d.mts).

### Export complete files

~~~sh
node cli.mjs export --workspace /absolute/path/opportunity-workspace --id opp_ID --out opportunity-package.json
node cli.mjs export --workspace /absolute/path/opportunity-workspace --id opp_ID --package pkg_ID --format html --out review-handoff.html
node cli.mjs export --workspace /absolute/path/opportunity-workspace --id opp_ID --revision 24 --format requirements --out requirements-r24.csv
node cli.mjs source --workspace /absolute/path/opportunity-workspace --id opp_ID --source src_SHA256 --out original-source.txt
~~~

The export response gives the exact path, byte count and SHA-256. Use a new output name, or pass **--force** when intentionally replacing an earlier local export.

Portable is the default export format. Other formats are html, markdown (or md), requirements, capabilities, teaming, milestones and questions.

### Receive and reopen

~~~sh
node cli.mjs receive --workspace /absolute/path/receiving-workspace --operator "Receiving lead" --input opportunity-package.json
node cli.mjs serve --workspace /absolute/path/receiving-workspace --operator "Receiving lead"
~~~

A fresh receiver restores the complete project, source versions and named handoffs. Receiving the same package again is idempotent. A later packet from the same history advances the receiver. Divergent work retains distinct histories for an explicit operating decision.

The exact original source files and all earlier named handoffs remain available after receiving and reopening. Use the project revision and package ID when selecting a historical handoff.

### Resume source intake

Run the original seed command with the same workspace, seed file and operator label. Its intake journal contains each exact prepared action before dispatch, the project ID, source bindings and completed steps. It resumes a pending call and skips completed steps.

The journal lives at:

~~~text
<workspace>/intake/seed-<original-seed-SHA256>.json
~~~

The seed validates every embedded original source's byte count and SHA-256 before making changes. Keep the original seed with the operating kit.

## JavaScript integration

~~~js
import {openOpportunityStore} from './model.mjs';
import {startOpportunityWorkspace} from './server.mjs';

const store = await openOpportunityStore({
  directory: '/absolute/path/opportunity-workspace',
  operator: 'Capture lead'
});

const projects = await store.list();
const project = await store.get(projects[0].id);

const updated = await store.dispatch('save_question', {
  id: project.id,
  expectedRevision: project.revision,
  requestId: 'receiving-question-001',
  text: 'Which existing receiving export should this handoff map to?',
  owner: 'Integration lead',
  status: 'open',
  evidence: []
});

const packet = await store.exportPackage(updated.id);
await store.close();

const server = await startOpportunityWorkspace({
  directory: '/absolute/path/opportunity-workspace',
  operator: 'Capture lead'
});
console.log(server.url);
// At the end of the operator session:
await server.close();
~~~

The server can borrow an already-open store by passing **store**. Its close method drains owned HTTP work and leaves a borrowed store with its caller. A server that opened its own store closes it when the session ends.

The HTTP API uses the same original facade:

| Route | Operation |
| --- | --- |
| GET /api/projects | List projects |
| POST /api/projects | Create a project |
| GET /api/projects/:id | Open current or selected revision |
| POST /api/dispatch | Apply an exact named action and payload |
| GET /api/projects/:id/export | Download selected format/revision/package |
| POST /api/receive | Receive a complete portable packet |

The browser and API use the launch token as a Bearer credential. The server binds to 127.0.0.1 and checks its own Host and Origin. Static assets are local and the page uses a restrictive content policy. It sends source and operating data only through the caller's own local operator service.

## Complete receiving operation

[receive.mjs](receive.mjs) runs the whole retained-source/operator/response/receiving journey in an operation directory. It keeps its prepared steps and results in one journal, preserving the source identity across reopen.

~~~sh
node receive.mjs --directory /absolute/path/lgndx-receiving --operator "Integration receiver"
~~~

When the existing environment has Playwright and Chromium, add the explicit existing module and browser paths:

~~~sh
node receive.mjs --directory /absolute/path/lgndx-receiving --operator "Integration receiver" --playwright /absolute/path/node_modules/playwright/index.mjs --browser /absolute/path/chrome
~~~

The operation exercises the original complete seed; real local HTTP source and decision actions; all requirement dispositions and coverage records; team, milestones and Q&A; an explicitly authored integration-source revision; named exports; current/historical comparison; fresh receiving; idempotent receive; close and reopen. Browser receiving opens the actual desktop and mobile interface and its source, working matrix and package controls.

For a temporary native execution environment, add **--checkpoint /absolute/path/native-state.tar.gz**. After each completed stage, the operation archives its retained state outside the working directory using the system tar command. Restore that archive into the same operating directory before continuing the original command.

The resulting native operation journal identifies the actual source and state paths, prepared calls, export hashes and receiving revisions. Its output directory contains the receiving packet and human-readable handoffs ready to reopen with the same product.

## Source layout

- **model.mjs / model.d.mts** — Versioned project and decision facade.
- **sources.mjs** — Original retained documents, evidence bindings and USAspending edition bridge.
- **package.mjs** — Named snapshots, readable handoffs and full portable receive.
- **server.mjs / server.d.mts** — Private local HTTP operator and downloads.
- **cli.mjs / cli.d.mts** — Direct and installed commands, durable original-source intake.
- **web/** — Complete browser operator.
- **references/** — Exact source manifest, original public source copies and working seed.
- **receive.mjs** — Whole native receiving operation.

The maintained research dossier and USAspending modules remain in their original repository locations. The source kit includes that exact required closure. Application state belongs in the selected operating directory, separate from the source checkout.
