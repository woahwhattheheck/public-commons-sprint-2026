# Issuer correspondence receiving

This component receives an original email or text file into the existing SCF Grant Operations workflow. The operator opens the complete source, reviews its message fields and MIME parts, selects the original and any useful attachments, and saves them through the existing source store. The award-terms editor then records the actual correspondence stage and any explicit issuer terms.

## Receive an original

For email, export the provider's complete RFC822 message as an .eml file. A Gmail API raw response is base64url-encoded RFC822; decode that response directly. Preserve the provider's message identity, mailbox, original filename, retrieval time, and source URL in the private operating case. An exported text message is also accepted, with its original bytes retained.

Run the inspector beside this module:

    python3 -B issuer_correspondence.py inspect original.eml

For a text file with an explicit charset:

    python3 -B issuer_correspondence.py inspect correspondence.txt --media-type "text/plain; charset=utf-8"

The report contains the original byte count and SHA256, decoded display metadata, ordered header occurrences, the MIME tree, every text part, and every attachment. MIME paths are stable within the original: the root is 1, its first child is 1.1, and a nested message can have a child such as 1.2.1. Duplicate filenames and Content-IDs remain separate parts.

Dates retain their original header text. The optional dateUtc display is populated only when that header has an explicit usable timezone. Native source observation time is a separate operator or receiver timestamp.

## Review before receiving

Read the plain-text and HTML source projections as text. The host should put their content in textContent or an escaped text element. HTML email can reference remote resources, and the original source does not need to be rendered to retain it.

The inspector displays parser, transfer-encoding and charset issues beside the affected part. Original message bytes always remain the source. A MIME attachment can carry a decodedWithRecovery flag when the standard parser recovered damaged base64 or when its original wire range could not be aligned. Unsupported transfer encodings leave the original email available as the receiving choice.

A nested message/rfc822 part is retained as the original encapsulated message bytes. A multipart attachment is retained as its complete original MIME entity. All original header occurrences remain available; repeated headers, filenames and source text do not collapse into a single inferred identity.

The source projection never selects a grant stage, track, round, amount, payment date or deadline. The award-terms editor presents those separately against the selected original plan. For the current SCF programme, preserve the selected Open Track and record the original interest acknowledgment at its actual stage. Future invitation, decision and award documents enter through the same original-source workflow.

## Save native sources

Python API:

    inspection = inspect_correspondence(raw, original_filename, "message/rfc822")
    choices = source_candidates(
        raw, inspection,
        observed_at="2026-10-12T23:00:00Z",
        source_url="https://provider.example/original-message",
    )

Each available choice has path, key, filename, nativeFilename, mediaType, byte count, SHA256 and data. The data object is the existing source.add payload:

    {
      "filename": "...",
      "mediaType": "message/rfc822",
      "kind": "grant",
      "sourceUrl": "https://provider.example/original-message",
      "observedAt": "2026-10-12T23:00:00Z",
      "contentBase64": "..."
    }

The operator selects paths explicitly, usually original plus the issuer's attached decision or terms document. The original filename is preserved in the inspection. A filename containing directory separators or control characters receives a plain native filename. Distinct MIME paths retain distinct selection keys even when their filenames or bytes match.

prepare_source_commands produces the exact sequence of original Operations.command bodies:

    prepared = prepare_source_commands(
        raw, inspection, ["original", "1.2"],
        expected_version=current_version,
        actor=operator_name,
        request_prefix=retained_request_prefix,
        observed_at=received_at,
        source_url=original_url,
    )
    for item in prepared["commands"]:
        result = operations.command(program_id, item["body"])

Use the reviewed current version and retain the complete prepared sequence before dispatch. A request key combines the retained prefix, original-message identity, MIME path and content identity. A retry uses the same body and request ID. The native Workspace transaction reconciles an original request before checking the current version, so a completed source command can be replayed after subsequent commands.

If another operator edits the case before a new command is received, reopen the current case and reconcile the already saved source IDs. Create a new reviewed sequence only for the unsaved choices. The existing Operations source bounds remain 8 MiB per nonempty source and 24 MiB or 200 files for the complete case. source_candidates displays whether each individual file fits; the current case enforces its remaining capacity when saving.

The receiving editor should retain the correspondence inspection as original-case metadata alongside the saved source IDs, then bind the chosen source edition to the award-terms review. Actual issuer terms are applied through the original plan/amendment workflow implemented by award_terms.py.

## Complete portable receiving bundle

    python3 -B issuer_correspondence.py bundle original.eml \
      --directory received-correspondence \
      --source-url "https://provider.example/original-message" \
      --observed-at "2026-10-12T23:00:00Z" \
      --zip received-correspondence.zip

The bundle contains the exact original file, full inspection, decoded text bytes, original attachment bytes, native source choices, and a complete file manifest. Generated member paths depend on the MIME path, so sender-supplied filenames never control filesystem paths.

The directory is immutable after publication. Repeating the same input and observation metadata reopens and checks the existing result; changed inputs require a new receiving directory. The verify action checks every manifested file and rejects missing, changed or extra files:

    python3 -B issuer_correspondence.py verify received-correspondence

The complete native receiving programme is operate_correspondence_intake.py. It accepts a private case-input file that names actual original message files and provider observations. It runs receiving, source-command preparation, same-body replay comparison, bundle creation, ZIP extraction and full reopening. Its result reports the observed original and attachment counts and saved file identities.

## Source and integration

The implementation uses Python's standard email parser with policy.default explicitly. Raw MIME boundary ranges are located without changing the original line endings. The entire original RFC822 file remains available even when a damaged message cannot be projected cleanly.

Python documentation:

- https://docs.python.org/3.12/library/email.parser.html
- https://docs.python.org/3.12/library/email.message.html
- https://docs.python.org/3.12/library/email.errors.html

Public repository files contain the receiver, its operating programme, and this guide. Actual mailbox exports and native source-choice bodies belong to the private grant case. The full original-message download can contain routing, provider identifiers and subscription links, so the application's source detail should present them only within the existing case access.
