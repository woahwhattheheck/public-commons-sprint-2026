# Company return packages in the native receiving desk

The Company return package tab opens the complete company-only return produced by the maintained reporting editor and hands its verified observations to the existing Installation receiving workflow. It retains the exact ZIP and returned JSON as ordinary native Sources. The existing receiving report, owner KEEP/APPLY review, staged document and Installation save remain separate explicit actions.

This is part of the original SF47 Operations application. It creates no second Workspace, custom transaction system, approval engine or background business worker. The selected case and its original request ledger own every mutation.

## Open and inspect

Open the current managed Grant application, select its original Operations case and open Receiving returns → Company return package. Select the complete Installation_Return_<UUID>.zip produced by the company editor.

The read-only inspection verifies the complete ZIP roster, each member's byte count and SHA-256, the whole original company report, its original source closure, the exact returned JSON, any corrected predecessor and the independently regenerated comparison. It compares the report's complete Installation document with the selected native saved ID, revision and SHA. A case imported through the normal complete-case importer may use the same retained Installation baseline; the report's original case identity remains provenance.

Every original check and its proposed observation remain available in the comparison. The displayed package manifest includes every member. Opening a package does not approve observations, change Installation stage, record delivery, alter commercial terms or approve payment.

Use the named original package hash supplied through the intended delivery channel when independently receiving files with the portable CLI. The browser computes the selected file's hash and binds every subsequent request to those exact bytes. Hashes identify bytes; the customer proposal itself does not authenticate a native approval.

A package must fit the existing 8 MiB native source limit. The original case also retains its existing 24 MiB / 200-source limits. The desk does not remove files, truncate a package or increase those limits. A larger delivery remains available through the existing selected native case export and portable company receiver.

## Retain exact original sources

Enter a reason and select “Retain originals and verify linked inputs.” The desk uses two ordinary source.add commands:

1. the complete original return ZIP, with a deterministic filename based on its original return UUID;
2. the unchanged RETURN.json bytes from that package, using the original submission adapter's filename, media type and provenance.

Before each command, the browser retains the complete exact request body, request ID, actor, note, selected case version and bytes in its private IndexedDB store. A storage failure prevents dispatch. The original Operations command ledger decides replay and commit. The second command is prepared only after the first has a valid retained receipt.

A lost HTTP response keeps the same original request pending. “Recover original source request” submits that exact body to the original ledger before choosing a later phase. It does not replace the expected version, request ID or note. A definite native rejection remains visible with its original body. Resolve the cause, then explicitly inspect a separate intake when a new selection is intended.

Typing an intake note queues ordered, revision-checked browser writes. Moving to another Receiving tab lets those owned writes finish before the desk closes its database; reopening waits for them. The receiving session keeps a recovery copy until the exact note write succeeds. If browser storage or another tab prevents the write, the text and failure remain visible. Refresh retained work, compare the current note, then explicitly save your retained text or download the complete intake draft. Notes already frozen inside native source requests remain unchanged.

An accepted native response is retained before linked-input readback. If local receipt publication is interrupted, the stored pending request remains recoverable through the same ledger. A newer browser tab cannot overwrite another tab's intake: every IndexedDB update compares the original local revision in one transaction. On conflict, refresh retained work and reopen the original record.

The native linked-input read checks the retained ZIP and JSON bytes again. It appends the actual returned JSON source ID to each observation's sourceIds while preserving all original source/work/purchase/outcome links. It then invokes the original native receiving normalizer, including the current source records and original definition roster. The full linked inputs and native preview are retained in the private intake draft.

The source JSON remains unchanged. Added native evidence links are a separately visible transformation, recorded in the linked inputs and sourceLinkPolicy.

## Open the existing receiving draft

“Open as receiving draft” performs a fresh read-only linked check against the current case, then opens the full native inputs in Record receiving. It preserves the prior local receiver draft in the existing previousDrafts roster. If an original receiving request or accepted result is pending, finish that request first.

Review the report name, recipient, actual environment, notes and every observation. Use the existing Preview and named Save controls to record the receiving return. All existing validation remains active. Proposed ACCEPTED or NOT_APPLICABLE states are not silently manufactured by this intake.

Then use Review a return to choose the saved native return. Select explicit KEEP or APPLY choices for every original check, preview the current native definition and source basis, and stage only the selected review. Preview and explicitly save the resulting Installation document. Read both the original and successor editions. The original PLANNED case examples retain their original edition; a saved successor is a separately named native revision, not a rewrite of the earlier row.

The new tab never automatically records a receiving review, selects APPLY, stages owner choices or saves an Installation. These actions remain visible in the existing native desk.

## Cold reopen and independently received cases

The normal complete-case export includes all native Sources. Thus the exact company return ZIP and JSON travel with the original Installation editions, recorded reviews and request history.

After importing that complete native case through the existing native importer:

1. Open the received case's Receiving returns → Company return package tab.
2. Choose the exact retained ZIP under “Package already retained in this case.”
3. Inspect it. The original native source download must match its stored SHA and full bytes.
4. Select the exact-byte matching returned JSON source offered by the inspection.
5. Verify linked inputs. This path reuses those retained originals; it need not admit duplicate source files.
6. Explicitly open the resulting receiving draft or reopen the already saved native review through Saved reports.

The received case has its own native case identity. The desk does not replay an old case's browser request against a new case or remap captured request IDs. The historical company/report binding remains unchanged, and the native baseline document must still match in full.

The private IndexedDB intake store belongs to the current browser. Save an unfinished note explicitly with “Save intake note.” Use “Download complete intake draft” before moving browsers; it includes the complete original package, inspection, source selections, original request bodies and captured results. No server credential or bearer token is included. Portable draft download omits only the recomputable linked native preview, while keeping the complete original package, inspection, both frozen requests and their original results. Reopen revalidates those bytes and rebuilds linked inputs. Download and reopen share the same 128 MiB transport bound; an oversized draft is refused before emitting a file, without truncation.

Reopening that draft requires the same case identity and independently re-inspects its full package. Captured command results are provenance: retained original requests are reconciled with the native ledger before use. If that intake ID already exists locally, importing an older file selects the current local record without replacing later work. A restored native case with a new case ID should reopen the original retained ZIP and JSON through its own case instead.

The downloaded intake draft is internal operating material. Distribute the company-only report/editor/return package to the intended company; keep the wider native case, intake drafts and owner review outputs with the operator.

## HTTP contract

All routes use the existing authenticated same-origin Operations service. There are two new read-only POSTs:

POST /api/operations/<case-id>/installation-company-return-inspect

    {
      "expectedVersion": 51,
      "archiveSha256": "EXACT_LOWERCASE_SHA256",
      "archiveBase64": "COMPLETE_ORIGINAL_ZIP_BASE64"
    }

Alternatively, select an actual existing native source by replacing archiveBase64 with archiveSourceId. Exactly one selector is required.

POST /api/operations/<case-id>/installation-company-return-linked

    {
      "expectedVersion": 53,
      "archiveSha256": "EXACT_LOWERCASE_SHA256",
      "archiveSourceId": "source_ACTUAL32HEXIDENTITY",
      "returnSourceId": "source_ACTUAL32HEXIDENTITY"
    }

Both return schema stellar-forge.sf47-company-return-intake.v1, caseId, the original native source/version selection, full package binding/member inventory, exact baseline reference, complete check definitions, inputs, full comparison and the unchanged returnedSource payload. Inspection also exposes retainedArchive and returnedSourceCandidates. Linked validation additionally exposes retainedSources and nativePreview.

No mutation is performed by either route. The existing POST command route accepts each original source.add command. Retain the full body before dispatch and replay that exact original body on an uncertain result:

    {
      "expectedVersion": 51,
      "requestId": "ORIGINAL_REQUEST_UUID",
      "actor": "Actual recording operator",
      "note": "Actual reason for retaining this source",
      "action": "source.add",
      "data": {
        "filename": "Installation_Return_ORIGINAL_UUID.zip",
        "mediaType": "application/zip",
        "kind": "other",
        "sourceUrl": "",
        "contentBase64": "EXACT_COMPLETE_ZIP_BASE64"
      }
    }

Use the returnedSource object unchanged for the second command. Link only actual native source IDs returned by the original ledger or selected from verified retained Sources. Never accept an arbitrary command or destination URL from an uploaded customer package.

The browser receives the trusted current API/save functions and recording actor from the existing application. Attached software is verified as a package member but never executed during intake.

## CLI and borrowed Operations API

The existing workspace CLI registers two read-only commands. Keep the original global workspace/scenario arguments required by the installed release:

    python /ABS/SOURCE/cli.py operations --workspace /ABS/WORKSPACE \
      installation-company-return-inspect --case ORIGINAL_CASE_ID \
      --expected-version CURRENT_CASE_VERSION \
      --archive /ABS/Installation_Return_UUID.zip \
      --sha256 EXACT_PACKAGE_SHA256 --output /ABS/inspection.json

For a source already retained in a cold received case, use --archive-source ACTUAL_SOURCE_ID instead of --archive.

    python /ABS/SOURCE/cli.py operations --workspace /ABS/WORKSPACE \
      installation-company-return-linked --case ORIGINAL_CASE_ID \
      --expected-version CURRENT_CASE_VERSION \
      --archive-source ACTUAL_PACKAGE_SOURCE_ID \
      --return-source ACTUAL_JSON_SOURCE_ID \
      --sha256 EXACT_PACKAGE_SHA256 --output /ABS/linked-inputs.json

These commands open no second business engine and make no source.add mutation. Existing automation may borrow its current Operations owner:

    inspection = ops.inspect_company_return(case_id, inspection_body)
    linked = ops.linked_company_return(case_id, linked_body)

Use the existing native command/preview/save interfaces for every deliberate mutation. The original CLI's output publication rules still apply; stdout is available when --output is omitted.

The complete company_returns/ directory also preserves the portable author/pack/receive/submission CLI. It contains the exact customer reporting reader and complete generic reporting/return operating guides. The original private three-company fixture guide remains in its internal source delivery; customer identities and terms are supplied only by selected native data. Only the two Python import headers support both native package imports and standalone copied software; all original model/validation behavior is retained.

    python /ABS/SOURCE/company_returns/customer_return.py receive \
      --archive /ABS/Installation_Return_UUID.zip \
      --sha256 EXACT_PACKAGE_SHA256 --output /ABS/PRIVATE_RECEIVER

This verifies and independently re-renders the complete company-only proposal. It neither opens the Operations case nor approves observations.

## Installed source closure

The managed application's original BOOT_FILES selection includes the native adapter, CLI adapter, browser desk, stylesheet, this guide and every company_returns/ source member. Both the original and managed execution copies therefore bind the same complete dependency closure. The HTTP static registry exposes only the desk, stylesheet and guide. Customer ZIP software is not served as executable code.

Original source: Commons merged PR37014 at ea3a4d40664f4681a5d3e6974dc6768d46bf98a3, business/scf_public_assistance_installations_20261012/reporting/. The reporting reader is SHA-256 774d943c0481e13b0221c3dd684853a26d61b01aa7765aae3658b0e33322556b. The native integration uses the current Merchant workspace's original Installation/return/HTTP/request-ledger source, preserving other active source registrations.

Publishing this source does not claim a company returned a file, a native request committed or an Installation was accepted. Those outcomes require their actual native receipts and independently read back editions.
