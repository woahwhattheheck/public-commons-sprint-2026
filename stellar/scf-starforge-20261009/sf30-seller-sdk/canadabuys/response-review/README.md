# CanadaBuys complete supplier response review

This application turns the existing source-bound response master into a complete supplier working copy and brings reviewed changes back into the same native bidder desk. It preserves the original notice row, authored scope, workshare, every answer and annex, original supporting files, named editions and the complete returned file.

The browser opens at `/response-review/`. It is linked from the bidder desk. The supplier receives one complete standalone HTML editor and returns its complete working JSON. The standalone copy includes the original HTML, CSS, application, model and selected native response; it runs without a service or external network request.

## Operating course

1. In the original workspace, select the complete response-master JSON and its saved workshare. Save one native response record. The native writer binds the master's entire original row to its actual source entry.
2. Download the complete standalone editor for an explicit saved response revision. Open it locally and inspect the full original source and scope.
3. Enter the reviewer identity separately from the proposed respondent identity. Edit answers, annexes and comments, attach complete supporting files and select each answer's actual evidence. Text or evidence changes reset that entry's old review.
4. Download/reopen an unfinished draft as needed. Save an attributed edition to return a named complete content snapshot. The working file retains all earlier complete editions and attachments.
5. In the original host, open the saved response and compare the returned file. Every changed field has baseline, current and returned values. Choose Current or Returned for each proposed/conflicting field. Review and acknowledge any current source or saved workshare change.
6. Save the reviewed choice. One original SQLite transaction retains the full returned file as evidence and saves the next edition of the original response record. The native result names both records. Reopen that exact saved response revision and retain the complete result.

The supplied APM2 response master covers twelve answers and three annexes containing twenty-one sections. Its proposed CAD 7,200 scope is response engineering. The partner response uses self-attributed supplier reviews and the separately selected native qualification and bid decision.

## Original writer and recovery

The implementation uses the existing `CanadaBuysWorkspace.bidderDesk` writer, its `_command`, `_prepare` and `_save` methods, original evidence bodies and immutable record history. It introduces no alternate database, second command ledger or independent customer state.

Each mutation carries `workspaceId`, the reviewed `expectedRevision` and a stable `commandId`. The full original input is fingerprinted by the same bidder command mechanism. A lost reply is resumed with the exact saved input. A completed command returns its original saved result; reusing the command ID with different input is rejected. The native revision guard and comparison digest are checked inside the same writer transaction that saves the return.

The review digest binds the complete incoming transfer, current native response edition, full current source/workshare context and every comparison row. A source or workshare edit after comparison requires another comparison. A change relative to the last adopted context requires a written acknowledgement. Historical masters require an explicit `allowHistoricalSource:true` preparation choice.

The three-way choice operates on editable fields. Supplier review attribution is retained only when the complete selected tuple—response text, evidence IDs, state, reviewer and time—matches an actual current or returned reviewed entry. A mixed tuple becomes Unreviewed. The exact supplier-returned statements remain preserved in the original returned file.

Source and metadata limits are explicit: 8 MiB per supporting file, 16 MiB complete attachments, 64 MiB complete input. The operation rejects excess size instead of dropping a file or a response section.

## Native API

All HTTP operations use the existing loopback host and same-origin write protection. Complete API errors retain `{error:{code,message,details}}`.

| Method and route | Complete operation |
| --- | --- |
| GET /api/response-review/status | Workspace identity/revision, response and workshare summaries |
| POST /api/response-review/prepare | Bind a complete master and workshare; save original native response |
| GET /api/response-review/records/:id?revision=N | Read exact saved metadata and full response document |
| GET /api/response-review/records/:id/export?revision=N | Export the complete original baseline plus editable working content |
| GET /api/response-review/records/:id/editor?revision=N | Download the full standalone editor |
| GET /api/response-review/records/:id/markdown?revision=N | Download the complete readable response |
| POST /api/response-review/compare | Read baseline/current/returned values and current source/workshare differences |
| POST /api/response-review/apply | Atomically retain original returned bytes and the selected response revision |

`workspace.mjs` exports the same domain actions. `client.mjs` exports `CanadaBuysResponseReviewClient`, using the existing strict UTF-8, size, abort and HTTP-error transport. Adjacent declarations describe complete request and result types. The original installed package exports `./seller/canadabuys/response-review` and `./seller/canadabuys/response-review/client`.

### Preparation input

```js
{
  workspaceId, expectedRevision, commandId,
  master: completeOriginalResponseMaster,
  workshareId, title
}
```

### Comparison and application

```js
const compared = await review.compare({recordId, transfer});
const input = {
  workspaceId: compared.workspace.id,
  expectedRevision: compared.workspace.revision,
  commandId: originalSavedCommandId,
  recordId,
  transfer,
  reviewSha256: compared.comparison.reviewSha256,
  choices: explicitCurrentOrReturnedByFieldPath,
  acknowledgement: {source: reviewedSourceChange, workshare: reviewedScopeChange},
  reviewer: operatorName,
  note: receivingNote
};
const result = await review.apply(input);
```

Field paths use RFC 6901 escaping for original row identities. They identify complete answer/annex fields, not JSON array offsets. States are `UNCHANGED`, `RETURN_ONLY`, `CURRENT_ONLY`, `SAME` and `CONFLICT`. `RETURN_ONLY` and `CONFLICT` require explicit choices. The four supplier review states are `UNREVIEWED`, `PROPOSED`, `CONFIRMED`, `NEEDS_WORK`.

## Original command line

Use the already installed `canadabuys` command and original workspace:

```sh
canadabuys response-review-status --workspace "$workspace"
canadabuys response-review-prepare --workspace "$workspace" --file prepare.json --out prepared.json
canadabuys response-review-record --workspace "$workspace" --record-id "$record" --revision 1 --out original-response.json
canadabuys response-review-export --workspace "$workspace" --record-id "$record" --revision 1 --out working.json
canadabuys response-review-editor --workspace "$workspace" --record-id "$record" --revision 1 --out supplier-editor.html
canadabuys response-review-compare --workspace "$workspace" --file compare.json --out comparison.json
canadabuys response-review-apply --workspace "$workspace" --file exact-apply.json --out saved.json
canadabuys response-review-markdown --workspace "$workspace" --record-id "$record" --revision 2 --out response.md
```

Prepare/apply input JSON contains the complete original command and expected revision. The CLI leaves those inputs intact. Outputs use exclusive new files. Reuse the original input after an ambiguous result; use a new output filename when retaining a replay result.

## Whole workspace delivery

The response record, complete returned evidence and all saved editions travel through the original bidder package. The original receiver validates response-specific command results against their exact evidence bodies and immutable original baseline/previous edition. Export follows response-return references when a selected decision or profile reaches a response indirectly. Ordinary bidder records and commands preserve their existing contracts.

The file `model.cjs` is shared unchanged by native code and the browser, which receives it through `model.js`. Keep all response-review source/assets and the original bidder writer in the same source edition. The native distribution includes this source family and its explicit API exports.

## Continue the original customer

`OPERATING_JOURNEY.mjs` operates the full hosted preparation, standalone editor, original attachments, unfinished download/reopen, named return, explicit receiving and saved-edition reopen. It receives the existing live browser page, existing original server and saved customer identity. See `UI_GUIDE.md` for full inputs, recovery and reviewer attribution. It preserves caller-owned browser/server state and closes only its own recipient page.

This operation extends the existing saved APM2 customer. Source publication and an in-memory original-content check are separate from the actual native browser result. The producing worker opens the exact delivered edition, views every resulting screen and applicable attachment, fixes observed issues, and returns its retained same-customer result.

## Rendered product inspection — owner instruction, 2026-10-13

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949


