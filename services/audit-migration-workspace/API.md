# Audit Source Workspace — complete engine API

This is a neutral audit migration model. No role or target column is asserted to be an IRIS tenant field. All original files, ordered CSV cells, mappings, scope editions, reviewed corrections, target templates, outputs and returned data remain in the same complete workspace.

## Source and operation contract

All mutations take (workspace,input), where input contains operationId, expectedRevision, at (original ISO timestamp), actor and the fields below. They return {workspace,receipt,replayed}. Exact repeated operation IDs return the original receipt against the current descendant; changed original input rejects. Each mutation validates complete prior ancestry. validateWorkspace reconstructs every original effect.

createWorkspace({id,title,createdAt}) returns the initial workspace.
metadata() returns role names, reserved report labels, limits and reference purposes.
LIMITS are validation ceilings, not measured throughput: 32MiB per CSV/file, 128MiB complete portable JSON, 100000 rows/512 columns per CSV, 256 files/128 source tables/10000 operations.
All opaque source IDs and field values remain exact strings. System operation IDs are stable identifiers; record identities are serialized [namespace,role,[opaque key parts]] arrays.

importFile(ws,{...operation,fileId?,filename,mimeType,purpose,sourceUrl?,representation?,base64})
- representation: original (default), authored-transcription or authored-example.
- fileId may bind the actual source document identifier; otherwise it is derived from complete original metadata and byte identity.
- receipt.result: fileId,bytes,sha256,retained.
- Full bytes remain in ws.files[].base64, including zero-byte files.

importCsv(ws,{...operation,filename,fileId?,purpose?,sourceUrl?,representation?,side,role,text})
- side is source, target or reference. role is one of universe/plans/engagements/controls/tests/findings/actions/documents/principals/access_rules/history/relations.
- UTF-8 BOM, duplicate headers, original quoting and all raw bytes survive.
- receipt.result: sourceId,fileId,rowCount,retained.

sourceRows(ws,sourceId) returns {source,headers,rows:[{id,record,cells,correctionIds?}]}.
Rows are effective current values; original complete bytes remain in source.fileId.
A missing cell position is null when compared, while an existing empty cell is "".

saveCorrection(ws,{...operation,sourceId,rowId,column,expectedValue,value,reason})
- column is zero-based; replacement value is an exact string.
- expectedValue is exact current string or null for the next absent trailing position.
- Append missing positions sequentially. No inferred fill or silent deletion.
- receipt.result contains correctionId and original before/replacement values.

## Explicit mapping and scope

saveMapping(ws,{...operation,sourceId,namespace,keyColumns,fields,references,note})
- keyColumns: nonempty distinct original numeric column indexes.
- fields: named selectors, each exactly {column:index} or {constant:exactText}.
- references: [{id,relation,purpose,targetRole,targetNamespace,key:[selector,...],required:boolean}].
- purpose: principal, protected, subject, from, to, attachment or other.
- Role and side derive from the source, not a guessed column label.
- Required connected purposes: access_rules principal+protected; history subject; relations from+to. ACL principal reference explicitly targets principals.
- receipt.result.mappingId selects this immutable mapping edition.

saveSelection(ws,{...operation,mappingIds,fileIds,roles,declaredAcyclicRelations,permissionBasis,historyBasis,evidenceBasis,note})
- one exact mapping per source; all mappings share the same side.
- roles contains all twelve names: {status:included|not-supplied|not-applicable,reason}.
- each basis: {status:unconfirmed|source-declared,sourceFileIds:[...],note}.
- source-declared needs actual retained and selected original basis files.
- fileIds includes selected binary evidence and policy originals; mapped CSV files are included automatically.
- evidenceBasis optionally adds externalReferences:[{namespace,parts:[exactDocumentKeyParts],reason,locator}]. It requires source-declared status and retained basis files, and each declaration must match a selected document identity. An explicitly external-only document is visibly qualified and never represented as copied bytes. Where an actual selected file exists its expected identity still must match.
- declaredAcyclicRelations contains only labels whose source contract forbids cycles.
- receipt.result: selectionId,basisSha256,side.
- Selection freezes its actual mapping/correction/file identities. Later selected-source corrections or mapping editions stale it; its old projection remains unchanged.

analyse(ws,{selectionId}) returns complete:
{schema,workspaceId,revision,selectionId,basisSha256,currentBasisSha256,stale,structurallyReady,ready,semanticAcceptance,roles,records,graph,documents,permissions,history,coverage,issues,summary}.
- roles[role]: {declaration,mappingIds,rows,coverage,counts}.
- records: {key,identity:{namespace,role,parts},fields,references,witnesses,variantCount,valid}.
- witnesses include sourceId,fileId,rowId,record,mappingId,headers,originalCells,effectiveCells,correctionIds.
- Complete unequal raw row variants conflict even when mapped fields happen to match.
- graph contains declared edges and actual cycles only for acyclic labels.
- documents bind file_id to an actual selected full file; supplied byte_length/SHA are compared exactly.
- Source permissions remain declarations, not application authorization. No implicit allow, inheritance, assurance rating, version or event generation.
- summary: errors,warnings,rows,records,documents,relationships.
- ready means structurally coherent and current, not vendor/semantic acceptance.
- Missing roles and unconfirmed coverage remain explicit.

saveReview(ws,{...operation,selectionId,decision:accepted|needs-work,note})
- accepted requires current structurally ready selection.
- Saves the entire original report with all findings/witnesses; result.reviewId.

## Actual supplied target route

saveContract(ws,{...operation,selectionId,title,authority,sourceFileIds,crosswalks,tables,note})
- authority: supplier-provided or authored-example; it is an attributed declaration.
- All original workbook/dictionary/route files are retained. The mapped operator interface is explicit CSV; arbitrary XLSX/ODF/SQL is retained, not parsed into guessed records.
- crosswalks: [{id,fileId,sourceRole,sourceNamespace,sourceKeyColumns:[indexes],targetColumns:[indexes]}].
- Each crosswalk file is original full CSV. Conflicting rows for one original key block preparation.
- tables: [{id,mappingId,templateFileId,keyColumns:[indexes],columns:{0:selector,...},referenceBindings:[{referenceId,columns:[indexes],targetTableId}]}].
- Exact ordered headers come from the selected complete CSV template; any sample rows remain original input rather than being silently submitted.
- Every selected mapping, including a header-only included source, requires at least one target table. Partial target contracts reject with TARGET_COVERAGE_INCOMPLETE; no included source silently disappears.
- Every destination column is explicit, including {constant:""} for an intentional blank.
- Selector alternatives:
  {field:"mappedField"}; {column:originalIndex}; {keyIndex:index}; {constant:"text"};
  {referenceId:"ref",keyIndex:index};
  {crosswalkId:"x",index:crosswalkOutputIndex};
  {referenceId:"ref",crosswalkId:"x",index:crosswalkOutputIndex}.
- Every selected nonempty relationship requires a target binding and its resulting foreign key is checked against the exact referenced record's prepared target key.
- receipt.result.contractId.

assessContract(ws,{contractId}) returns {schema,workspaceId,revision,contractId,selectionId,basisSha256,stale,ready,authority,analysis,crosswalks,tables,issues,summary}.
Each table has id,mappingId,headers,keyColumns,rows,text,bytes,sha256.
Each row has rowId,sourceKey,sourceIdentity,witnesses,key,cells.
This full preview is available even when preparation is blocked.

prepareTarget(ws,{...operation,contractId,reviewId,note})
- Requires accepted original review for the contract's same selection and a currently ready complete target assessment.
- Saves exact original assessment, every CSV byte and original row binding.
- receipt.result: preparationId,contractId,outputSha256,tables,rows.
- This creates a file package; it never dispatches a vendor write.

recordReturn(ws,{...operation,preparationId,tables,submissionReference,note})
- tables: [{tableId,fileId,columns:{0:returnedColumnOrNull,...}}].
- Complete actual returned CSV files are imported first.
- Every expected column has an explicit actual returned index or null; every key column must have an actual index.
- Omitted expected tables stay visibly unreported. A null/missing comparison column is unconfirmed.
- Native outcomes/version fields only exist if actually supplied; no receipt is treated as data readback.
- ws.returns[].comparison: {schema,preparationId,preparedSha256,tables,unreported,issues,ready,nativeAcceptance,permissionEnforcement,summary}.
- Tables preserve original headers, every returned row and extra cell, full per-cell comparisons and MATCH/CHANGED/MISSING/UNEXPECTED/AMBIGUOUS/UNCONFIRMED states.
- receipt.result: returnId,preparationId,ready,summary.
- Later source edits cannot change earlier prepared CSVs or an actual return's historical meaning.

## Complete reading, saving and exit

inspectWorkspace(ws) gives full metadata/lists/operations and preparation/review/return summaries without duplicating full binary bodies.
exportWorkspace(ws) returns complete sealed UTF-8 JSON text.
importWorkspace(text) verifies complete file identities and every original operation/effect before returning ws.
renderReport(ws,{selectionId?,preparationId?,returnId?}) returns a full plain industrial HTML report, including every original/effective source row, finding, graph/document binding and complete original history. An explicit return/preparation pair must share the exact preparation identity; a common source selection is insufficient. Prepared rows and every expected/actual returned cell render as readable full HTML tables.
buildHandover(ws) returns {schema,workspaceId,revision,files,manifest}.
files entries are {path,type,text?,base64?,bytes,sha256}, with exactly one content representation. Complete original filenames and metadata remain in MANIFEST.json; safe member aliases are derived from full identities. Historical prepared outputs are retained verbatim. The browser packaging layer adds exact Working_Recovery.json (workspace plus unfinished drafts/selection/copyId), complete source and working HTML.

Dependencies: only ./sha256.mjs, exporting sha256Utf8 and sha256Bytes. Helpers parseCsv,encodeCsv,encodeBase64,decodeBase64,utf8Bytes,utf8Text are exported. Base64 is canonical standard padded encoding; bytes are never truncated.

Actual source-level receiving exercise has already imported all twelve explicitly authored roles, complete 256-byte binary evidence, real declared references and policy source, reviewed/frozen thirteen records, prepared twelve authored templates and compared twelve actual returned CSVs. All thirteen rows matched; complete portable reopen and 69-member whole exit matched. This is source execution, not an actual browser/producer visual receipt. The outgoing version must still be opened, operated and personally viewed at desktop/mobile, including all attachments and reopened files.
