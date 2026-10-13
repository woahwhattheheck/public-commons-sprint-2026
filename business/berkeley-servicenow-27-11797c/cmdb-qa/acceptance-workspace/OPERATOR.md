# CMDB acceptance workspace

## Open and continue work

Open **Open_CMDB_Workspace.html** in a current browser. The complete application is inside that file, including its operating source and this guide. The workspace runs locally and does not call a ServiceNow instance or send your exports to a server. The **Operating guide** link in the footer opens this complete guide before or after you create a workspace.

Enter the name of the **Operating person** before making changes. Use **New workspace** to name the customer, the CMDB class or agreed scope, and the responsible operating owner. The authored worked example can be opened separately to learn the workflow; its asset names, people, references and decisions are fictional.

The browser saves each completed operation in IndexedDB. **Save private workspace** writes the complete editable JSON package for another machine or a later session. **Open saved workspace** verifies the original file identities and recomputes each saved comparison before opening a received copy. Original workspace identity and operation history remain inside that copy.

Browser storage belongs to this browser profile and origin. Keep the downloaded private workspace and complete handover with your approved working files. A downloaded workspace contains the complete original CSV exports and review notes; handle it with the same access controls as the source exports. There is no built-in account or encryption service.

## 1. Receive the full exports

In **Receive exports**, select Source for the baseline and Target for the received migration or upgrade export. Add a short, meaningful edition name and a receiving note. Choose the actual UTF-8 CSV file. The original text, file name, length and SHA-256 are retained with your name and the receipt time.

Keep all original editions. When a file is corrected, import it as a new edition and select the preceding export as its correction parent. This makes the correction chain visible without replacing the delivered file. The worked example retains a target containing a duplicated stable key, the first valid target, and the corrected target as separate exports.

The original CSV parser handles quoted fields, embedded line breaks and a UTF-8 byte-order mark. Each export is limited to 16 MiB and the original parser's 100,000-record limit. Empty, duplicated or missing mapped keys and invalid rows need correction before comparison. A structurally invalid received CSV can still be retained as an input edition with its parse error.

Select the customer-approved scope before exporting from the source system. A file pair should describe one agreed CMDB class or coherent scope and a documented extraction time. Record filters, exclusions and extraction responsibilities in the receiving note or your acceptance reference.

## 2. Map the stable key and compared fields

Open **Map fields**. Select the retained source and target editions. Map one stable key and each field that belongs in the acceptance scope. A mapping row contains the canonical name used by the report, the source column and the corresponding target column.

Use a key that identifies the same configuration item in both exports, such as an agreed retained sys_id or migration mapping key. Display names are suitable only if the customer has explicitly established their uniqueness and stability. The workspace does not infer record matches.

Mappings compare exact CSV strings. They do not trim values, merge equivalent spellings, treat blank as null, resolve display names or normalize dates. If the receiving agreement requires a transformation, make it explicit in the upstream export and retain that transformed file as its own documented edition.

Use the mapping preview to inspect missing columns, blank or duplicate stable keys and row counts. Correct the supplied export or the explicit mapping, then save the mapping as a new edition. Saved comparisons retain the mapping edition they actually used.

## 3. Compare and resolve exceptions

In **Compare & review**, choose the complete source, target and mapping editions. Give the comparison a readable name. A comparison invokes the original CMDB comparator on the explicitly mapped columns and retains its complete audit.

Every finding begins open. Assign an owner and record the action required. Available dispositions are:

- **Open**: the difference has not yet been resolved.
- **Assigned**: a named owner is responsible for review.
- **Correction required**: a source or target correction is needed.
- **Accepted change**: the named receiving owner accepts the specific difference, with a decision note and an approval or evidence reference.

You can select multiple findings with the same disposition, owner and evidence. Use the detail view to inspect the original source and target values. The exported exception CSV contains value hashes alongside the finding, owner and review history fields; the private editable workspace retains the complete raw inputs.

When a corrected target arrives, import it as a new edition and create a new comparison linked to the preceding comparison. **Carry accepted decisions only with the same baseline, field mapping and identical findings** copies only accepted reviews whose entire original finding is unchanged. It requires the same original baseline and complete canonical field/key mapping. If either changes, turn off carry and review the resulting findings anew. Changed values and newly detected differences require a new review. The comparison lineage separately shows findings absent from the corrected comparison.

A disappearing difference is a result of the new compared inputs. It does not by itself establish that every upstream correction was authorized. The retained edition chain and receiving reference explain the correction.

## 4. Record the receiving decision and deliver the package

In **Acceptance & handover**, choose the comparison and enter the named receiving reviewer, the customer authority or acceptance reference, and the decision note.

- **Accepted** requires every current finding to be marked Accepted change.
- **Review required** preserves the outstanding work while recording the current receiving position.
- **Rejected** records the rejection and its reason without removing the compared exports.

The application records a named receiving decision. It does not issue a cryptographic signature or establish that the person entered has contractual authority. Agree the actual sign-off role and retain its approval reference in the customer's normal process.

Changing an exception review after a receiving decision makes that decision historical. The workspace displays the comparison as needing a current decision until a reviewer records the updated position. Earlier receiving decisions remain in History.

Download the readable HTML report for a human review, the exception CSV for the worklist, and the original audit JSON for the technical record. **Download complete handover** writes one ZIP containing:

- The complete editable workspace JSON.
- A self-contained copy of the application with that workspace included.
- Every retained original export at its original text content.
- The selected comparison's audit, exception CSV and readable receiving report.
- This guide and the complete application source, including the original comparator.
- A member inventory with file lengths and hashes.

The ZIP and workspace JSON contain the original customer data. Share them only with the authorized receiving team. The readable report contains customer names, record keys and decision notes, so review those fields before sending it outside that team.

## History and interrupted work

History retains each successful operation, the performing person, time, action, revision and result. Corrections, reviews and acceptance decisions append to the record.

An interrupted save can leave **Continue saved operation** available. It uses the same operation identity and body; a completed operation returns its original result without replacing later work. A changed body with the same identity is rejected. If another browser tab has advanced the workspace, reopen the saved current workspace before making a new change.

## Worked example

The included hardware example is an authored operating demonstration, not a City of Berkeley or Alcor export. It receives six original assets and a target with a duplicated key. The duplicate is retained and corrected. The first comparison has four findings, including two critical differences: a lost owning team and an omitted laptop.

The owner approves a relocation and a new asset, requests correction of the two critical differences, and records Review required. A corrected target restores the owner and the missing asset. The next comparison carries only the two identical accepted changes and records a named Accepted decision. The complete package is reopened and its original first import can be replayed while preserving the final revision.

## Source and integration

The application retains the original comparator from public-commons-sprint-2026 PR481 unchanged as `cmdb-qa/cmdb_qa.mjs`. The browser adapter uses the same parser, validation, comparison and exception CSV bodies with a browser-compatible SHA-256 binding. The operating core adds original-file retention, explicit mappings, review decisions, correction lineage and complete receiving around that comparator.

The source distribution also includes the headless operating interface and a complete native receiving example. Use the source README for command syntax and the exact run result delivered with your edition.

## Browsers with local storage disabled

When this browser cannot open its local working database, a permanent Temporary session message appears. The same original imports, mapping, comparison, review and acceptance controls remain available in memory. Session edition means the work is held only in the open view. Download the complete private workspace or handover before closing or reloading. Open the downloaded JSON in this application to continue, or open the complete handover HTML in a normal browser. Earlier browser-saved work is left intact. A save failure after browser storage has opened remains an error; it does not silently switch the existing workspace to temporary memory.


## Preserve unfinished intake, mapping and review work

Each entered intake, field mapping, new comparison, exception review and receiving decision stays with its exact saved workspace edition while this application remains open. Changing views, filters, finding pages or saved workspace copies retains these groups. The Unfinished work panel lists the groups for the selected workspace and counts groups held with other copies.

Use **Download all unfinished work** before closing or reloading. This recovery JSON contains the complete saved workspace, each original edition needed by an unfinished group, every entered field, selected findings and the complete selected CSV bytes. **Save this group** makes an independently usable copy of one group and its original edition. Blank and invalid form text stays available for correction. These values become recorded operations only when you save the corresponding form normally.

**Open unfinished work** receives the file into a separate workspace copy after checking its complete identities. Choose **Continue** for a group on the current edition. If another operation has since changed the workspace, **Open original edition** creates a separate copy of that group's original saved edition. The later workspace and its complete history remain available in the selector. Review and intentionally re-enter changes on a later edition if that is the intended receiving target; the application never silently applies an earlier draft to a newer comparison.

Saving an intake, mapping, comparison, review or acceptance clears only that successfully recorded group. Other unfinished groups stay with their original editions. **Discard group** removes only the selected unfinished values after confirmation. The complete handover ZIP includes UNFINISHED-WORK.json whenever the selected workspace has unfinished groups; its workspace.json continues to represent the recorded operating history.

The selected CSV remains available after leaving and returning to Intake. Its filename is shown below the file control. Receiving a file captures the selected side, label, correction relationship and note before reading its bytes. Controls pause for that operation, and the original workspace edition is checked again before saving. A read or save failure leaves the unfinished group available.

Unfinished groups are held in this session until their explicit recovery download. Browser storage continues to save recorded operations; it does not secretly persist incomplete forms. In temporary browser mode, also save the private workspace or complete handover before leaving. Recovery files are private operating records containing the original exports and entered notes. Transfer them through the same authorized channel as the complete workspace.

Complete recovery files are limited to 256 MiB and each original CSV to 16 MiB. If a combined recovery is too large, save each listed group separately. Every such file includes its necessary original workspace edition, so it can be received independently.
