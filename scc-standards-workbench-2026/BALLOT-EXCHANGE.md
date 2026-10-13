# Member ballot exchange

Member ballot receiving extends the existing workbench from individual frozen
member packets through original and corrected returns into the same recorded
votes, authority decisions and bilingual publication.

## Complete operator workflow

1. Finish the paired draft and freeze its edition. Retain the applicable procedure
   and actual membership records in People & procedures.
2. Open the ballot in Ballots & decisions. Select its exact frozen edition,
   procedure, dates and eligible roster. Existing procedure fields determine the
   calculation.
3. Open Member ballot receiving. Choose the ballot and eligible member. Write
   English and French instructions and the actual return route; freeze the packet.
4. Download the complete member ZIP. Its standalone HTML embeds the whole selected
   bilingual edition, original worked cases, member application and style. The
   packet contains only this member's frozen roster entry.
5. The member reads the edition, enters the declared name, response, reasons and
   UTC vote date, then confirms the complete response and downloads its JSON.
   A saved draft file can be reopened in another browser.
6. Select the actual returned JSON in the secretariat desk and inspect it. Preview
   checks its complete packet, ballot, edition and person bindings, declaration
   date, correction chain, source identity and current recorded vote.
7. Retain the original file. Receipt alone does not alter the vote. Verify its
   original sender using the committee's established process and record how that
   verification was performed.
8. Explicitly adopt the selected return. An existing vote for this person and
   ballot retains its original ID; previous content stays in development history.
   The current project revision and exact prior vote digest guard the adoption.
9. A correction starts by opening the member's exact previous exported JSON and
   choosing Prepare correction from this return. It retains the response ID,
   advances one revision and records the preceding normalized content digest.
   Receive the predecessor first, then its correction. Review both declarations
   before adopting the corrected edition.
10. Review negative-resolution and notification work on the newly adopted vote.
    Adoption clears those fields so the preceding response's resolution cannot
    silently become the resolution of a changed response.
11. Record the actual authority decision and independent procedural review through
    the existing Ballots & decisions controls. Continue in Publication &
    maintenance with the exact edition and actual authority records.
12. Download the private decision handover and complete editable workspace ZIP.
    Restore the latter into a fresh workspace and reopen the original project,
    member returns, vote identities and authority decisions.

The private decision handover contains member identities, original returned files,
corrections, before/after adoption snapshots, original calculation, closures,
procedural reviews and publication records. Public distribution uses the existing
public edition export. The complete private workspace retains every source file
and committed operation for independent editable continuation.

## Member use in either language

The offline page has four steps: Instructions, Bilingual edition, My response and
Review & return. The language selector switches its interface and selected
document language. Full original records remain inspectable where additional
source detail is supplied.

The vote date is explicitly UTC and must fall within the recorded ballot period.
Yes, no, abstain and an explicitly blank response remain distinct choices.
The selected procedure determines whether missing justification excludes a
negative or abstention; preview explains that original procedure consequence.

Once downloaded, a returned edition remains intact. Repeating its download keeps
the same content and identity. Prepare correction creates the next explicit
edition. Opening the exact original response on another device supports the same
correction workflow. A readable HTML copy accompanies each downloaded return.

A declared name is not sender authentication. The secretariat separately records
its actual verification before adoption. A member return does not record the
committee authority's final decision.

## Durable work and restart

Before sending any write, the desk retains the complete original request and
uploaded file in this browser's IndexedDB. A lost response leaves Recover
original request available. The server checks that same request ID and payload
before the current revision, so an already committed operation returns its
original saved result.

A rejected revision guard preserves the input. Review current revision after
rejected request displays the current saved state; inspect the original file and
vote again before submitting the intended action. Leaving the desk or switching
projects cannot move an old upload, request or result into another project.

Browser draft storage belongs to its origin. Save portable member drafts and
retain the actual source files. Restart the operator server with its same
workspace and port to reopen the original browser origin's pending requests.
All committed operations, original files and immutable exchange records are
independently preserved in the complete private workspace archive.

Closed ballots retain their original votes and authority closure. Later files
can remain original evidence, while adoption on that closed ballot is rejected.
A subsequent ballot uses the existing explicit successor workflow.

## Complete retained records

| Collection | Retained content |
| --- | --- |
| ballot_packets | Selected member, exact ballot contract and public projection of the frozen bilingual edition |
| ballot_returns | Original file identity, complete member declaration and preceding correction relationship |
| ballot_adoptions | Verified return, exact before/after original vote and explicit verification note |

These collections are optional for existing workspaces and immutable once added.
The next operation on an older workspace records their empty addition in its
history. Ordinary record save/remove cannot rewrite them.

Writes use the existing SQLite transaction, original project revision guard,
request ID and hash-linked event. Exact original files and source rows are kept
in the same transaction. Duplicate normalized content preserves the original
return and current vote while retaining any additional original file
representation. The module sends no external message.

Full restore checks the original file bytes and SHA-256; exact frozen member,
ballot and edition; the complete return chain; and each adoption's original
vote identity, before/after revision and source list. Original ballot, closure,
procedural and publication validation continues to apply.

## API and command-line receiving

Use the existing /api/projects/PROJECT prefix.

GET /ballot-exchange/status returns the complete ballot/member context, including
retained packets, full returns, adoptions and current vote digests. Optional
ballot_id selects one complete ballot.

POST /ballot-exchange/preview accepts packet_id, filename and content_base64.
It returns the original file SHA-256, canonical response SHA-256, predecessor or
duplicate, declared response, original-procedure observations, current vote and
project revision. Preview does not write.

POST /operations keeps the original envelope: operation, payload,
expected_revision, request_id, actor. New payloads are:

    ballot.packet:
      ballot_id, person_id, title,
      instructions_en, instructions_fr, reply_route_en, reply_route_fr
      optional explicit id

    ballot.receive:
      packet_id, filename, content_base64, receipt_note

    ballot.adopt:
      return_id, expected_vote_sha256, verification_note
      optional explicit id

An empty expected_vote_sha256 means no prior vote. Otherwise use the exact digest
returned by preview or status.

Additional complete exports:

    GET /export?audience=ballot_member&packet_id=PACKET
    GET /export?audience=ballot_decision&ballot_id=BALLOT

The command-line equivalents are --audience ballot_member --packet-id PACKET
and --audience ballot_decision --ballot-id BALLOT. Existing private_restore
remains the full editable transfer.

A UTF-8 member return uses schema standards-member-ballot-return/v1 and exactly
these fields: project_id, packet_id, packet_sha256, ballot_id, ballot_sha256,
edition_id, edition_sha256, person_id, response_id, response_revision,
previous_response_sha256, choice, justification, cast_at, declared_name, language.
The first revision requires an empty string for previous_response_sha256.
Corrections use the predecessor's canonical SHA-256; original file formatting
and its separate file SHA remain retained. Return input is limited to 2 MiB.

## Whole receiving and rendered product

[BALLOT-RECEIVING.md](BALLOT-RECEIVING.md) supplies the complete native/browser
programme, original operation identity, actual runtime configuration, source
continuation and independent receiving commands. Preserve the accepted original
consultation case and outputs.

Before presenting an outgoing version, open and operate that exact application
and look at the actual desktop and narrow-screen output. The complete standing
owner instruction is carried in BALLOT-RECEIVING.md. Inspect populated, empty,
loading and error states, English and French content, every important control,
all downloaded packet/return/readable/publication/decision files and the reopened
editable workspace. Fix clipped, unstyled or unreadable output in the plain
industrial layout. Capturing screenshots without viewing them is incomplete
receiving. Retain actual output and visual observations with the same case.


<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->

