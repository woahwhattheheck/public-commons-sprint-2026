# U-M source acquisition

The materializer receives the three exact public Audit Services references and the authored domain contract. It can join 7A2F's original event PDF and questionnaire catalog without changing or re-extracting that catalog. The source pins reflect observations made on October 11, 2026; they are not a publisher signature or an assertion about unseen Buyer Attachments.

From this source directory:

    python tools/materialize_reference.py --reference /private/umich-reference \
      --contract reference/audit-domain-contract.json \
      --retained /existing/umich-audit-source-2d58 \
      --notice-directory /existing/umich-audit-source-7a2f

The command names the bundled reference/audit-domain-contract.json explicitly; --contract may select another exact retained contract path. Omit --retained on a receiving machine to fetch the three public URLs. --notice-directory is optional: it uses the already acquired event PDF and event-catalog.json, not another supplier login or source-request operation. Detailed Buyer Attachments, agreements, Attachment F and selected platform schemas join separately through the original source owner.

The function materialize(reference, retained=None, notice_directory=None, contract_file=None, refresh_public=False, timeout=30) is callable from an operator. It returns the acquisition identity, state, receipt path, selected count and any source errors. The process exits 0 for a complete original selection, 2 when source acquisition or edition review remains.

Every operation writes an immutable acquisitions/<id>/ACQUISITION.json. Exact selected bytes are recorded in SOURCE_PINS.json. A retained-file operation records its materialization time and leaves retrieved_at null; it does not claim a new publisher retrieval. Actual HTTPS captures record the retrieval time, response status, media type and returned metadata. Existing source bodies are never overwritten with different bytes.

Use --refresh-public to compare a publisher's current edition. A changed public body is retained under unreviewed/<source>/<sha256>/ with its actual receipt. It is not silently assigned the reviewed domain contract, and the selected SOURCE_PINS.json stays unchanged if any required source fails its pin. An explicit source review can later publish a new contract/pin edition through the normal product workflow. A mismatch in a supplied retained file is recorded without copying that unknown file.

The public report is explicitly a Sample Report. Its illustrative High/Medium/checkmark rows are not University operational findings. Public process stages and follow-up defaults remain reviewable reference behavior. The procurement questions retain their original IDs; they are not all mandates. The sample's detailed-observation audience, optional advisory memos, successful-control rows, explicit action dates and separate auditor verification must remain distinct in receiving projections.

The materializer uses Python's standard library and copies original bytes. It does not run a PDF converter, regenerate the questionnaire, install a dependency, send correspondence, contact a protected portal, or submit a bid. Complete all subsequent platform-native operations against the selected provider's actual contract.
