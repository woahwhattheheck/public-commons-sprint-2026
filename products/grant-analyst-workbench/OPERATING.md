# Grant Analyst Workbench

Grant Analyst Workbench installs the existing grant-analysis, Learning and commissioned-study application as a managed customer workspace. The customer uses the original browser, authenticated HTTP and CLI. A customer agent uses the same native operations through Merchant, with complete retained requests, responses and files. No replacement analysis engine is introduced.

The public product contains reusable adapters, command declarations and operating guidance. Original application, examples, commissioning material and customer data are supplied privately under an exact external source authority. Source composition does not establish a completed analysis, commissioned study, native receiving run or customer acceptance. Keep each actual operation and its observed status.

## 1. Select the complete customer operation

Agree the question, accountable reviewer, source populations and periods, actual issuer roster where commissioned, expected outputs and recipient. Identify which original workflow is being continued:

- Source review retains whole360Giving JSON packages, an explicit codebook, reviewed grant decisions, exact amounts by currency and complete edition comparisons.
- Learning retains the full reviewed report behind a finding, selected grant references, named actions, due dates, criteria and every later action/review revision.
- A commissioned study retains question editions, an explicit issuer roster, separate social investments, evidence and attachment histories, contrary evidence, reviewed answers and immutable report releases.

These workflows share one original saved workspace when they belong to that workspace. Independent completed customer workspaces stay separate. Do not combine unrelated IDs or invent a commissioning roster from sample data. Original native/source/rendering operations remain with their existing owners.

Source packages retain original string identifiers and numeric tokens. The native Python engine parses numbers as Decimal, retains complete source bytes and computes exact totals. Grant commitments and social-investment principal are separate categories; amounts in different currencies are not summed into one total. Unknown amounts and unresolved roster IDs remain visible. Chat projections aid navigation; the full retained bytes are authoritative.

## 2. Receive the private source and prepare it locally

The selected source root contains application/ with the complete original application and public UI, together with receive_commission.py, commission-template.json and COMMISSIONED_RECEIVING.md at its root. The external authority lists every selected member; its literal bytes and SHA are supplied separately. No private source body is embedded in the public package.

~~~json
{
  "schema": "stellar-forge.grant-analyst-workbench-source.v1",
  "files": [
    {"path":"application/analyst.py","bytes":12345,"sha256":"<actual-full-SHA256>"}
  ]
}
~~~

That row explains the format. A usable authority contains the complete selected inventory, including original application SOURCE_FILES and all three commissioning leaves. Never substitute the example for a complete authority. Retain every original file with its actual bytes/SHA; do not rewrite scripts, examples, manifests or vendor policies. Runtime/operation receipts belong outside immutable source.

~~~sh
node products/grant-analyst-workbench/prepare.mjs prepare \
  --directory /srv/private/grant-preparation \
  --python /usr/bin/python3 \
  --source /srv/private/original-grant-source \
  --source-manifest /srv/private/original-grant-source.json \
  --source-manifest-sha256 ACTUAL_MANIFEST_SHA256
~~~

Preparation validates full source, selected interpreter and isolated original imports, then creates an independent receiving copy through complete private source transfer. It does not initialize a grant workspace or create findings. Use returned primary/receiving applicationDirectory, sourceManifestFile, sourceManifestSha256 and python exactly. Do not copy an older source-host Python path to another machine. PREPARING.md gives exact result schemas, receipts, inspect/export/receive flags and recovery.

Public adapters use Node24 or newer. The original application uses selected CPython3.10 or newer and its actual standard-library imports. Browser dependencies and native programmes remain with their original selected owner.

The complete source-transfer ZIP moves authorized application/commission source. The native analyst operating ZIP contains workspace, sources, reports and the original exporter’s executable inventory. Preserve both complete files; they serve different purposes.

## 3. Review and start the original managed application

Keep workspace, private control configuration, source and Merchant agent exports in separate directories. Existing original workspace directories must be owned and ordinary. The bridge preserves original per-request .lock and a separate grant-analyst-operator.lock for its lifetime. Holding .lock continuously would prevent the unchanged engine from operating.

Use Applications provider grant-analyst-workbench with a private reviewed launch file:

~~~json
{
  "schema": "stellar-forge.grant-analyst-workbench-launch.v1",
  "directory": "/srv/private/grant-customer/workspace",
  "applicationDirectory": "/srv/private/grant-preparation/primary/source",
  "sourceManifestFile": "/srv/private/grant-preparation/.preparation/SOURCE.json",
  "sourceManifestSha256": "ACTUAL_MANIFEST_SHA256",
  "connectionFile": "/srv/private/grant-control/connection.json",
  "python": "/usr/bin/python3",
  "actor": "grant-operator",
  "workspaceName": "Customer grant study"
}
~~~

Replace example source paths with actual preparation descriptors. workspaceName is for deliberate initialization of a new workspace. Existing work selects its actual original directory and identity. Registering an Application does not migrate data or require duplicate initialization.

The bridge invokes unchanged serve and its original generated Bearer token. The private connection binds workspaceId/name, launch identity, full source authority, interpreter and loopback listener. Token/control paths remain private. actor labels the host operation; it does not create a native access-control role.

Use Review/Save/Start against actual source, interpreter and command. The UI exposes source review, Learning and commissioned studies. Stop waits for listener/handlers and original owner closure. It preserves workspace, requests and history. Reopen that same workspace rather than a replacement operation.

## 4. Review complete grant sources

Import the whole publisher JSON as bytes with actual dataset key, name and source URL. Native import retains the full original package and returns a content-derived edition ID. Reimporting identical dataset/bytes reuses that edition; changed bytes create a distinct edition.

Save the real study question and explicit category IDs, labels and definitions. Review original grant IDs against the current codebook. Each decision records include/exclude, a category when included, reason, source reference and reviewer. The adapter does not assert automatic classification.

Read the complete native report. Original report pages use offset, limit up to200, matched and nextOffset. Installed report defaults to the full report bridge; paged:true selects native paging/search. Reports retain unreviewed or stale-review states and exact amounts by currency. Export JSON and CSV; original CSV protects formula-like spreadsheet cells while preserving textual meaning.

Compare editions of the same dataset by original grant ID. Retain complete added/removed/changed/unchanged populations and both original records. Changed codebooks/sources can require fresh review; preserve historical decisions.

## 5. Continue Learning decisions

A Learning finding references distinct original grants with current reviews under the selected codebook. A cycle retains the full report snapshot, SHA/bytes and references. Later source changes never rewrite that baseline.

Assign actions with title, owner, YYYY-MM-DD date and review criteria. Each action revision uses expectedRevision and explicit OPEN, IN_PROGRESS, COMPLETED or WITHDRAWN status, plus reviewer, rationale and evidence.

A cycle review selects a later reviewed source/report, compares the original baseline and covers every original action exactly once. Interpretation and evidence limitations remain explicit. Findings, action decisions and evidence of progress are distinct. Technical receiving notes must preserve actual customer findings/status and be clearly labelled.

Export full Learning JSON, actions CSV and Markdown. Complete handover retains every baseline, action revision, review, source comparison and original request. A standalone report is not the full editable workspace.

## 6. Operate a commissioned study

Create an explicit question matrix with stable IDs, full wording and required evidence. Subsequent question editions are revision-bound and retain reasons/reviewers.

Save the actual issuer roster with selected source editions and exact grant IDs. Absent IDs remain AWAITING_SOURCE. If a grant appears in several selected editions, select its exact edition; the native engine rejects ambiguity. Social investments use a separate register: stable ID, instrument, principal as exact non-negative decimal text or null, currency, title, source reference and note. Award and principal totals remain separate.

Evidence kinds are public-source, document, interview-note, workshop-note and analysis-note. Preserve full deidentified note, source/page reference, reviewer, reason and actual scope subjects. Subject IDs must belong to the roster. Public evidence requires an approved public citation; other evidence stays internal.

Document changes are deliberate: keep preserves the prior attachment, replace retains full new bytes, remove records removal. Historical attachments remain readable by evidence ID and number. The evidence_document tool binds a declared complete file’s actual name/MIME/SHA/bytes and invokes original replacement; note-only editing does not silently replace a document.

Each answer chooses ANSWERED, PARTIAL or OPEN, with summary, limitations, supporting and contrary evidence/interpretation. Context binds question, scope and evidence hashes. Relevant later change produces REVIEW_REQUIRED. Review every current question and refresh affected answers before release; explicitly open questions remain open when evidence does not support a conclusion.

Internal and external releases are different products. Internal releases retain roster, evidence/context and reviewers. External release requires separately authored public text for every question, explicit anonymisation confirmation, disclosure note and selected citations from already public evidence. The adapter neither infers publication permission nor automatically redacts private notes.

Release IDs are immutable. Download selected release JSON, Markdown and CSV through original readers. Keep the full private working handover private even when one external report is approved.

## 7. Register the customer agent

Create a private host alias file outside each workspace. Inputs are immutable full files with actual bytes/SHA. Receiving destinations are separately declared; remote tools cannot choose arbitrary paths.

~~~json
{
  "schema": "stellar-forge.grant-analyst-host.v1",
  "workspaces": {
    "customer": {
      "label": "Customer study",
      "directory": "/srv/private/grant-customer/workspace",
      "connectionFile": "/srv/private/grant-control/connection.json",
      "inputs": {
        "publisher": {
          "file": "/srv/private/inputs/publisher.json",
          "sha256": "ACTUAL_FULL_SOURCE_SHA256",
          "bytes": 123456,
          "filename": "publisher.json",
          "mediaType": "application/json"
        },
        "evidence": {
          "file": "/srv/private/inputs/reviewed-evidence.pdf",
          "sha256": "ACTUAL_FULL_DOCUMENT_SHA256",
          "bytes": 654321,
          "filename": "reviewed-evidence.pdf",
          "mediaType": "application/pdf"
        },
        "handover": {
          "file": "/srv/private/inputs/complete-handover.zip",
          "sha256": "ACTUAL_FULL_ARCHIVE_SHA256",
          "bytes": 2345678,
          "filename": "complete-handover.zip",
          "mediaType": "application/zip"
        }
      },
      "destinations": {
        "independent": {"directory": "/srv/private/grant-independent"}
      }
    }
  }
}
~~~

Use actual values. Capture verifies complete hash/length and file stability, then retains immutable closed bytes. Host, generated connection, launch and capability files cannot become ordinary inputs, including through another alias.

~~~js
import {initializeGrantAnalystMerchant} from './products/grant-analyst-workbench/setup.mjs';
const installed = await initializeGrantAnalystMerchant({
  directory:'/srv/private/grant-agent',
  connection:'/srv/private/grant-host.json',
  name:'Customer grant operator'
});
console.log(installed.configuration);
~~~

connection selects the alias file, not a token. Setup reuses the original release store, private exports and Merchant configuration reader. Setup may run while the application is stopped; attachment requires its actual listener. Use maintained merchant-mcp or merchant-mcp-stdio with generated configuration. No additional SDK or MCP engine is required.

### Complete22-tool catalog

| Tool | Actual purpose |
| --- | --- |
| `merchant_grant_analyst_connections` | List declared original analyst attachments and complete input identities without starting the application. |
| `merchant_grant_analyst_connect` | Attach to the selected original managed analyst listener; retain its native authority. |
| `merchant_grant_analyst_disconnect` | Close this attached client and its retained reads after selecting the current launch; the Applications owner controls the server. |
| `merchant_grant_analyst_info` | Retain complete managed source and original workspace identity. |
| `merchant_grant_analyst_browser` | Return the original analyst browser entry for the host operator. Its private token is never retained as an artifact. |
| `merchant_grant_analyst_state` | Retain the full original saved workspace, including all requests, audit, review, learning and study histories. |
| `merchant_grant_analyst_read` | Read an exact original analyst query, retaining its full raw response. Original report pages use limit200 and nextOffset. |
| `merchant_grant_analyst_report` | Retain the full exact-decimal original report or one explicit original paged/search view. |
| `merchant_grant_analyst_compare` | Retain the complete original grant-ID comparison of two editions from the same dataset. |
| `merchant_grant_analyst_learning` | Retain complete learning snapshots, action revisions and reviews; optional cycle selects one. |
| `merchant_grant_analyst_studies` | Retain complete commissioned-study scopes, evidence histories, current answers and immutable releases. |
| `merchant_grant_analyst_action` | Save one of the12 original analyst mutations with its exact stable native requestId and payload. Native validation and revision rules remain authoritative. |
| `merchant_grant_analyst_action_input` | Read a host-declared complete JSON mutation body, bind its full bytes and dispatch the original action with the chosen requestId. |
| `merchant_grant_analyst_import_source` | Import a complete host-declared original360Giving JSON package without parsing or normalising its numeric tokens. |
| `merchant_grant_analyst_evidence_document` | Attach complete host-declared original document bytes to one revision-bound study-evidence mutation, retaining its exact display name and MIME. |
| `merchant_grant_analyst_receive` | Receive a complete original handover into a separately declared fresh destination through the unchanged original reader; preserve uncertain acknowledgement. |
| `merchant_grant_analyst_artifact` | Retain one complete original source, report, evidence document, release or full handover as immutable bytes. Internal/external reports remain separate selections. |
| `merchant_grant_analyst_files` | Page full retained artifact descriptors belonging to this exact original workspace/source. |
| `merchant_grant_analyst_file` | Read exact retained bytes; follow the original reader readId/offset/EOF until complete. |
| `merchant_grant_analyst_file_release` | Release one selected retained range reader. |
| `merchant_grant_analyst_file_inspect` | Inspect a JSON pointer/page without losing the complete underlying file. Files larger than32MiB remain available through byte ranges. |
| `merchant_grant_analyst_requests` | Page full selected requests and all observed HTTP outcomes. HTTP_OBSERVED describes transport evidence; the original native request journal owns mutation replay. |

Import publisher with workspace customer, a stable requestId, sourceInput publisher, expectedSourceSha256 and actual dataset. Then read complete state, save real codebook/reviews through action and inspect report. action_input accepts a complete host-declared JSON body; an included requestId must equal the selected one. It never resolves sourceFile/documentFile from remote content.

The12 exact mutation names are import, codebook, review, cycle-create, cycle-action, cycle-review, study-create, study-questions, study-scope, study-evidence, study-answer and study-release. payload omits requestId, supplied separately. Original revision/field validation remains authoritative. Investment principal stays decimal text; original publisher bytes never roundtrip through an agent JSON parser.

## 8. Complete requests, artifacts and recovery

The host retains full request before dispatch, including complete input-file identity. It never edits that body to fit a newer workspace. Native requestId/action/body fingerprint owns mutation replay: an identical request returns its original result with reused:true; different input under that ID fails. Later valid edits stay intact.

All full HTTP outcomes are retained. Hash-named observation files do not imply chronology; an observed exact-request success takes precedence over failures. HTTP_OBSERVED describes transport evidence. Inspect original saved requests/audit for business interpretation. Changed/disconnected launch requires explicit reconnect; the client does not silently redirect a mutation.

Receiving uses the original fresh-directory reader and a separately retained host request. Preserve exact archive/destination after missing acknowledgement. The installed receive tool re-enters the bridge’s proved same-archive adoption contract; do not invent success, replace destination or overwrite later edits. The original CLI reader still requires a fresh destination.

Responses expose compact navigation plus fileId, bytes, SHA and fileRead. Full raw bytes always remain. Follow readId/offset/EOF through all ranges; maximum range196608 bytes. file_inspect navigates JSON pointers/pages within32MiB; larger complete state/report files remain downloadable as bytes.

Artifact kinds are complete source; full report JSON/CSV; Learning JSON/CSV/Markdown; study JSON; evidence document with optional historical number; selected release JSON/Markdown/CSV; and full handover. Bind expected SHA/bytes when known. Original handover includes actual export time, so independent exports need not have equal ZIP hashes. Compare decoded full native inventory at the same revision rather than equating fresh archives.

File access binds actual workspaceId, directory and full source authority. Replacing a workspace at the same path cannot expose another workspace’s files. A listener stopping after complete HTTP response does not discard those arrived bytes; later reads reauthorize current original workspace.

## 9. Independent receiving and original CLI

Installed receiving adopts actual completed Learning and, when supplied and completed, the separate commissioned-study result. Complete outer deliveries, inner native handovers, source editions and workspace IDs remain separate. An outer customer ZIP is not automatically native analyst intake; verify the exact inner archive referenced by its original result.

The course uses unchanged readers, current full source and independent workspaces. It preserves complete source/state/reviews/actions/evidence/releases/history, makes labelled technical local edits, observes exact native replay, exports onward handovers, receives independently and cold reopens. It operates actual browser and full customer-agent files. RECEIVING.md supplies exact original-result/request selectors and continuation. It invents no issuer roster, finding, interview or external report.

~~~sh
node products/grant-analyst-workbench/cli.mjs \
  --configuration /srv/private/grant-control/launch.json -- state
node products/grant-analyst-workbench/cli.mjs \
  --configuration /srv/private/grant-control/launch.json -- learning
node products/grant-analyst-workbench/cli.mjs \
  --configuration /srv/private/grant-control/launch.json -- studies
~~~

Use original --help for exact mutation/export/report arguments. Retain --request and whole input. Wrapper fixes source/workspace/interpreter and awaits actual child close; managed Applications owns serve. The request lock remains per operation and the separate owner lease prevents conflicting managed writers.

## 10. Installation, recurring delivery and handover

The grant-analyst-workbench profile joins existing Workshare, Installation, assignments, payment and acceptance. Select actual customer, questions, periods/populations, reviewers, data custody, hosting, priced unit and receiving criteria. Keep integer atomic price/count/budget and network/asset/recipient. No new payment policy or grant funding amount is introduced.

A useful edition includes complete original source, explicit scope/codebook, full outputs/history, limitations, approved external reports where required and independently editable receiving. An approved distinct source period or changed commissioned scope may become a linked task. Retry, range read, reopen and copying the same result remain that task.

Keep public adapter inventory separate from privately supplied original application and customer handover. Deliver authority, actual runtime observations, complete artifacts and opening instructions through existing authorized private custody. No private case ID/pin, terms, token or correspondence belongs in public source/examples. Preserve sender/native/receiver ownership and the existing LDA reader.

Every positive/warm human contact and each subsequent outgoing message or attachment requires Bryce approval of that exact content. Internal engineering and authorized cold work continue under their existing instructions.

## 11. Actual outgoing product inspection

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949


## Complete offline Learning exchange

The installed receiving course now continues the completed Learning workspace through hosted issue, full self-contained offline draft/HTML save and reopen, complete return comparison, explicit guarded native application, imported saved-request recovery, a real conflict and explicit rebase, whole-cycle review, full native/exchange handover and independent cold reopening. Preserve the original completed donor and every earlier installed receiving result. The same Course owns the browser, Applications requests and source selection; it predeclares a fresh later receiving alias for the complete native archive without overwriting either earlier workspace.

Read [LEARNING_EXCHANGE.md](LEARNING_EXCHANGE.md) for the actual operator workflow and [LEARNING_EXCHANGE_RECEIVING.md](LEARNING_EXCHANGE_RECEIVING.md) for its complete original-owner course and interruption boundaries. The native ZIP, full exchange JSON, selected private source transfer and complete installed distribution are separate retained outputs. A native ZIP alone does not include the browser's complete exchange ledger or external generic wrapper source. Observe the actual outgoing screens, complete files and reopened artifacts before presenting a product as ready.
