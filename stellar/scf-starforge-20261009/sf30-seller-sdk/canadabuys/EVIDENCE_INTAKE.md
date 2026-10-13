# Import and review an original document set

The Bidder Desk accepts the original solicitation, financial workbook, amendments and supplier documents together. The browser and Node command use the same saved workspace and evidence engine.

## Operator workflow

1. Open **Bidder desk → Documents & evidence → Import a document set** with the relevant retained notice selected.
2. Choose the original files and, if useful, the publisher's common event URL. **Preview files** reads the exact bytes and shows one editable row per file.
3. Review each title, document type, publisher edition, source URL and issued date. Select an earlier saved document only when the new file actually supersedes it. The filename is initially the title; the type starts as **OTHER** until chosen.
4. **Prepare intake** retains the complete request in this browser. **Download prepared intake** saves the same request, including every original file, for recovery.
5. **Save prepared documents** imports the whole set in one SQLite transaction. Open the saved originals to record the document review, extract the actual requirements and update the decision.

All newly imported documents start **UNREVIEWED**. Capturing bytes does not establish that the document was read or that a contractor satisfies its requirements. A source-list notice, an advance procurement notice and a released tender retain their own procurement stages.

Each file becomes an ordinary native evidence record with its own UUID, SHA-256, byte length, source origin, capture time and saved edition. The existing evidence download, requirement references, decision comparison, HTML/CSV/JSON reports and complete workspace receiving packages continue to use those same records.

## Recovery and concurrent edits

Preparing fixes the original notice, files, metadata and intake identity. Retrying an unchanged prepared request returns its original saved editions without appending another intake.

A changed workspace revision may require **Refresh save revision**, followed by **Save prepared documents**. This refreshes only the transaction's workspace guard; the original input identity and per-document commands stay unchanged. A completed original request still reopens its original records. A different file or metadata value under the same intake identity is rejected.

Use **Restore prepared intake** to load the downloaded JSON into the same workspace. It is bound to the original workspace ID. Receiving a normal complete workspace package on another workstation preserves its native evidence and commands; the intake JSON itself is a recovery request for its original workspace.

The browser retains one current prepared intake per workspace. **Start a new intake** releases that browser copy after confirmation. Keep its downloaded copy if a save still needs recovery. Existing saved documents are unchanged by this action.

The whole set commits together. Invalid bytes, lengths, metadata or an invalid earlier-document reference reject the set; an interrupted or failed SQLite transaction rolls back its evidence records, bodies and native commands.

## Native command

Node 24 with the existing original workspace is sufficient:

~~~sh
node evidence-intake.mjs prepare /path/to/workspace documents.json prepared-intake.json
node evidence-intake.mjs apply /path/to/workspace prepared-intake.json
~~~

The prepare command writes a new file with exclusive creation. It reads original local files and retains their exact bytes. The apply command calls workspace.bidderDesk.intakeEvidence directly.

For an explicitly refreshed transaction guard:

~~~sh
node evidence-intake.mjs refresh-revision /path/to/workspace prepared-intake.json refreshed-intake.json
node evidence-intake.mjs apply /path/to/workspace refreshed-intake.json
~~~

A manifest identifies an existing notice by noticeId or exact solicitationNumber. File paths are relative to the manifest, or absolute. Every document can supply the existing evidence metadata fields. Supplied hashes or byte lengths are checked against the actual file before preparation.

~~~json
{
  "solicitationNumber": "EV9397",
  "sourceUrl": "https://contracts.fin.gov.nt.ca/",
  "documents": [
    {
      "path": "EV9397_-_Procurement_Advisory_Services.pdf",
      "kind": "SOLICITATION",
      "version": "Record the actual publisher edition"
    },
    {
      "path": "EV9397_-_Appendix_B_-_Financial_Submission_Form.xlsx",
      "kind": "ANNEX",
      "version": "Record the actual publisher edition"
    },
    {
      "path": "EV9397-Addendum_No._1.pdf",
      "kind": "AMENDMENT",
      "version": "Addendum No. 1"
    },
    {
      "path": "EV9397-Addendum_No._2.pdf",
      "kind": "AMENDMENT",
      "version": "Addendum No. 2"
    }
  ]
}
~~~

This example names the publicly indexed document set. Download the current issuer originals and any later amendments before preparing it, then replace the publisher-edition labels with the actual editions. The command requires the actual files and retained notice. Its default capture time is when the original local bytes are copied into the intake. Supply capturedAt explicitly when retaining an earlier documented capture time.

The browser and command accept up to 100 files, 64 MiB per file and 128 MiB combined. Existing server request and evidence limits continue to apply.

## Native and HTTP interfaces

- workspace.bidderDesk.intakeEvidence(input)
- client.bidderIntakeEvidence(input)
- POST /api/bidder/evidence-intake

Required input fields are workspaceId, noticeId, expectedRevision, a stable commandId, and documents. Each document has the existing evidence metadata plus complete canonical bodyBase64 and an explicit capturedAt timestamp. Optional sha256 and bytes must match its body. Intake metadata cannot assign record IDs or revisions. Completed reviews are recorded through the existing individual-document workflow.

Optional applyRevision supplies a fresh workspace revision for an explicit retry. It is the only apply field excluded from the original intake digest. The response retains commandId, intakeSha256, noticeId, the original native evidence records, current workspace metadata and alreadyApplied.

The original bidder_commands table keeps one ordinary evidence-create result for each document. Complete package exports and receiving retain these commands and evidence editions without adding another evidence store or package format.
