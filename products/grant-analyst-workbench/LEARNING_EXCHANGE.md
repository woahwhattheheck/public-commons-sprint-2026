# Offline Learning reviews and returns

The installed Grant Analyst can issue a complete Learning review for a colleague to work on without a connection to the original workspace. The colleague saves a draft, returns a complete decision file, and the live operator compares that return with the current original workspace before applying it.

The native Learning engine, original grant sources, action histories, report snapshots and request writer remain the selected original application. The installed extension adds a portable review format, an offline page, an authenticated console entry and an atomic context check around the original writer. It does not edit the privately supplied original application files.

## Choose the work

| Mode | What the colleague reviews | What the original writer saves |
| --- | --- | --- |
| Individual action | One selected original action with the complete cycle, finding, action histories, earlier reviews, codebooks and original source context | One new revision of that action through `cycle-action` |
| Complete cycle review | Every original action, the selected later source edition and grant references, full current report and comparison with the baseline | One complete `cycle-review`, its full report snapshot and one new revision of every action |

For a complete review, the selected source references must already have current original grant decisions under the selected codebook. The operator chooses those references in the live workspace before issuing the review. A colleague cannot silently switch the grant edition, omit an action or replace the issued evidence inside an offline draft.

The issuer records a named recipient, issuing operator and concrete instructions. Names are declared attribution. SHA256 identifies retained content; it is not a signature or proof that a named person approved the decision.

## Issue the complete packet

Open the existing private installed console using its current private connection. Use the Learning exchange entry alongside the original Learning controls. Select the cycle and mode. For an action select the existing action; for a complete review select the original source edition and the exact grant identifiers.

The host captures the complete context while holding the original workspace lock. The context includes:

- The full original cycle, baseline finding report, every action revision and all earlier cycle reviews.
- The selected codebook and every other original codebook referenced by those snapshots.
- The complete original UTF-8 source text and its original byte/SHA256 identity for every edition referenced by the cycle and the selected review.
- For a complete review, the full current report, native later snapshot and complete source comparison.
- The exact selected workspace, cycle, mode, action or source/references, with native cycle/codebook/snapshot digests.

Review that selection and the instructions, then download the complete packet or self-contained offline HTML. The packet retains the literal host response text. Original decimal spellings and source bytes are preserved; the offline page displays the native report's exact decimal strings and offers each source's literal text for inspection and download.

The packet is private working material when its underlying sources, notes or evidence are private. Supply it through the existing authorized recipient channel. Do not place a private packet, source edition, draft or native workspace in a public repository.

## Work offline

Open the issued HTML in a normal browser. It contains the complete generic source and issued context; it makes no network requests.

The assignment, finding and review question identify the work. The context selector opens the full baseline report, the selected later report and comparison where applicable, earlier reviews, each complete codebook, literal original sources and complete issued context. Report tables page through all rows. Full JSON/literal sections and their downloads remain complete regardless of the visible table page.

For each selected action, retain or deliberately revise its title, responsible owner, due date, success criteria and status. Record a nonempty rationale and evidence/source reference. A complete cycle review additionally requires the interpretation, evidence limitations and a stable new review identifier. Every original action must receive a decision.

The editor saves complete draft revisions in browser storage after edits. Each revision binds its predecessor, editor, time and complete decision. Incomplete draft text may be saved; producing a return requires complete valid native fields. The history selector shows earlier saved revisions without replacing the current decision.

Use **Save draft file** to carry the complete draft to another device. Use **Save offline HTML** to carry the whole working page with its current draft and retained exchange history. Downloaded files, rather than browser storage alone, provide portable custody.

If browser storage is unavailable, the page keeps the current draft in memory and lets you download it. If another tab changes the saved record, its compare-and-save check refuses to overwrite that record. Export the open work, then deliberately choose which branch to continue. When an opened file and a local record have different histories, both full drafts are preserved in the exchange before the chosen draft replaces the current view.

The live source workspace is never mutated by opening an offline file, changing a draft or creating a return.

## Return and compare

Use **Create return file** after completing the decision. The file contains the full issued packet and draft history, the exact submitted decision, submission time and declared reviewer. Send that complete file to the original operator.

In the live console, open the return and inspect the issued/current/returned comparison. The operator must see:

1. The same original workspace, cycle and action or complete-review source selection.
2. Every returned action decision beside the issued and current values.
3. Any changed cycle history, selected codebook or later report snapshot.
4. The actual interpretation and limitations for a complete review.
5. The complete source and draft/rebase history retained with the return.

A matching preview can prepare the original native action. It does not itself save a decision. The live operator explicitly applies the prepared request.

The original browser request mechanism saves one immutable operation and request ID before dispatch. The full body contains the selected native fields plus the exchange guard, packet identity and return identity. The original native request fingerprint includes that full body.

Inside the same original mutation lock, the installed guard compares the current cycle, selected codebook and, for a complete review, a newly recomputed native snapshot. It also checks the action/mode/source/reference selection. It then forwards the original native body to the unchanged Learning implementation. A change between preview and application is rejected by this check or the original expected-revision check.

## Resolve a changed workspace

A stale return remains usable evidence. It is never silently overwritten or automatically applied.

Refresh the same selected context. For every field changed on the host since issue where the returned value differs from the current value, choose **current** or **returned** explicitly. Review the complete current evidence, acknowledge that context and record a nonempty reason for the rebase.

Rebase creates a new packet and draft. It retains the entire earlier return, its original packet and history, the full current context, every explicit field choice and the rebase reason. It uses the same original action identities and the current expected revisions. The earlier packet, draft and return remain intact.

A complete review keeps its original source/reference selection during rebase. Choosing another source edition or different references is a new issued review, not a silent change to an existing return. If a review identifier was already used, the rebased draft receives a new stable identifier for deliberate review.

Inspect the new draft and create/review its new return before applying it. Rebase itself performs no native mutation.

## Interrupted application and replay

Keep the original saved operation even when the HTTP acknowledgement is lost. It contains the exact return, context, request body and request ID.

Resume that same original request deliberately. The original native writer checks its saved request cache before evaluating current context or action revisions. If the exact request already completed, it returns the original result without appending another action revision or cycle review. A reused request ID with a different body is rejected.

The hosted journal retains operations before dispatch and keeps them after receipt. It stores the exact native request receipt separately. An exchange bundle includes pending/uncertain operations as well as completed receipts; importing a bundle does not dispatch them.

Do not generate a replacement request merely because an acknowledgement is missing. Do not reinterpret a changed current report as evidence that the earlier request failed.

## Complete exchange and native handover

**Export complete exchange** writes one complete JSON bundle containing the selected packets, all retained draft branches and histories, returns, immutable prepared operations and exact native receipts where available. A completed application receipt must match the retained operation, selected return, native fingerprint and complete original result.

The original native handover remains its own complete archive. It retains the original workspace, grant sources, evidence documents, request/audit history, reports and private application source according to the original handover contract. Additive browser exchange history is carried in the exchange bundle; it is not silently assumed to be part of the original fixed archive inventory.

For handover, retain both:

- The complete original native handover produced after the selected decisions.
- The complete exchange bundle and its offline HTML/JSON files, including unresolved operations and earlier returned/rebased work.

The installed receiving course records and hashes both populations, reopens the original native archive independently, imports the exchange bundle, checks actual native receipts and preserves later original edits during exact request replay. Follow `LEARNING_EXCHANGE_RECEIVING.md` for that owner-controlled course and its full output inventory.

## File limits and integrity

A complete portable JSON/HTML exchange is limited to 64 MiB. Each original source keeps its native byte/SHA256 identity and the full selected context is retained. The extension rejects an oversized complete selection; it does not truncate reports, histories or source text. Select a suitable original review scope or retain the larger native handover through the existing operator.

Drafts retain a checked chain of complete decisions. Packets, returns, bundles and embedded generic source have checked identities. A rebase lineage is bounded to twelve nested returns to keep complete validation practical; retain earlier work and issue a new review when continuing beyond that depth.

Original Python context text is opaque for identity. JavaScript parses it for display and structural joins, but does not recanonicalize it to replace native cycle, codebook or snapshot hashes. Original source text is displayed/downloaded literally, including valid UTF-8 BOMs and numeric spellings. New request bodies contain only the defined string/integer fields and use the native sorted JSON fingerprint contract.

The portable page uses local browser storage and file downloads. It contains no service credentials, private connection token or remote callback. The operator's existing authenticated console owns native writes.

## Source and programmatic interface

New generic leaves are under `products/grant-analyst-workbench/`:

| Leaf | Purpose |
| --- | --- |
| learning-exchange.mjs | Complete packet, draft, return, comparison, explicit rebase and bundle contracts |
| learning-exchange-offline.html | Fixed offline page structure |
| learning-exchange-offline.css | Plain responsive operator layout |
| learning-exchange-offline.mjs | Offline editing, recovery, full context and downloads |
| learning-exchange-render.mjs | Exact source-pinned self-contained HTML generation |
| learning-exchange-host.py | Locked native context and atomic guard |
| learning-exchange-host.mjs / .css | Authenticated hosted issuing, return review, rebase and original request continuation |
| learning-exchange-receiving.mjs / learning-exchange-browser.mjs | Complete installed receiving continuation and actual browser course |

The pure domain exports `issuePacket`, `inspectPacket`, `createDraft`, `saveDraft`, `inspectDraft`, `createReturn`, `inspectReturn`, `previewReturn`, `rebaseReturn`, `prepareApply`, `createBundle` and `inspectBundle`. The renderer exports `renderLearningReview(value,{domainSource,uiSource,css,template})`, returning complete HTML, UTF-8 bytes, SHA256 and filename.

The context endpoint is authenticated `POST /_merchant/learning-exchange/context` with the exact selection: `{mode:"action",cycle,action}` or `{mode:"review",cycle,edition,grantIds}`. The receipt endpoint is authenticated `GET /_merchant/learning-exchange/receipt?requestId=...`. Neither route starts a separate native controller.

## Ownership and receiving

Continue the selected installed Grant receiving operation and its existing equipped owner. Adopt the actual completed original Learning donor; do not rerun its original source programme. A commissioned-study successor is a separate explicitly selected completed donor and is not required for useful Learning work.

Preserve the source selection, private supplied original application, existing native request IDs, caller-owned browser/context, managed host and resource leases. A source edit or peer source review is not an actual native/browser result. When local execution is unavailable, give the exact complete version and opening steps to the existing equipped receiver, inspect its actual rendered outputs and continue useful independent engineering.

Customer contact remains with its original owner. Every subsequent positive or warm human message and attachment requires Bryce's individual green for that exact message. This instruction does not block internal source implementation or an already authorized receiving continuation.

## Required rendered-product practice

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949

