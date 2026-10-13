# Harbour Source Workspace — frozen integration API
Prefix: services/harbour-source-workspace. Engine import: import * as E from './engine.mjs'; hash dependency: './sha256.mjs'. Pure synchronous ESM; browser and Node use identical source. WORKSPACE_SCHEMA='tjlabs.harbour-source-workspace.v1'. Full original Audit custody and operation envelope are retained, with separate19-role metadata and explicit operating/financial profiles.

All mutations accept (workspace, input) and return {workspace,receipt,replayed}. Common input: {operationId,expectedRevision,at,actor}. at is an original offset ISO timestamp, not a newly generated value on retry. Exact completed requests replay at descendants; changed original request IDs reject. Missing cell expectedValue is null; present empty is ''. All files/raw headers/unknown columns/full witnesses/history remain retained.

Existing signatures and output shapes remain the Audit implementation:
createWorkspace({id,title,createdAt}); importFile(ws,{...op,fileId?,filename,mimeType,purpose,sourceUrl?,representation?,base64}); importCsv(ws,{...op,fileId?,filename,purpose?,sourceUrl?,representation?,side,role,text});
saveCorrection(ws,{...op,sourceId,rowId,column,expectedValue,value,reason});
saveMapping(ws,{...op,sourceId,namespace,keyColumns,fields,references,note});
saveSelection(ws,{...op,mappingIds,fileIds,roles,declaredAcyclicRelations,permissionBasis,historyBasis,evidenceBasis,externalReferences?,note});
saveReview(ws,{...op,selectionId,decision:'accepted'|'needs-work',note});
saveContract(ws,{...op,selectionId,title,authority,sourceFileIds,crosswalks,tables,note});
prepareTarget(ws,{...op,contractId,reviewId,note});
recordReturn(ws,{...op,preparationId,tables,submissionReference,note});
metadata(); sourceRows(ws,sourceId); inspectWorkspace(ws); analyse(ws,{selectionId,operatingProfileId?,financialProfileId?}); assessContract(ws,{contractId}); validateWorkspace(ws); exportWorkspace(ws); importWorkspace(text); renderReport(ws,{selectionId?,preparationId?,returnId?}); buildHandover(ws)->{files:[{path,type,text|base64,bytes,sha256}],manifest,...}.
CSV/base64/strictUTF8 helpers remain parseCsv,encodeCsv,encodeBase64,decodeBase64,utf8Bytes,utf8Text. Hash module exports sha256Utf8/sha256Bytes returning {bytes,sha256}.

roles is an all19-key object: parties,vessels,places,applications,offers,agreements,visits,tariffs,charges,payments,allocations,assets,tasks,documents,principals,access_rules,relations,decisions,history. Each value {status:'included'|'not-supplied'|'not-applicable',reason}. metadata().roles supplies {name,fields}. Keys are [namespace,role,opaque parts]. Reference purposes add party,vessel,place,application,offer,agreement,charge,payment to Audit purposes. Decisions require a subject; allocations require exactly one nonempty charge and payment reference to those actual roles. Other required references are explicit mapping declarations.

Optional selection.externalReferences rows:
{namespace,role,parts,sourceFileIds,locator,reason}. Each points to exact retained selected evidence. This acknowledges an original external endpoint; it does not manufacture a record or a target key. External endpoints remain explicit findings and block any unsupported destination relation during actual target preparation. Document external-only evidence remains evidenceBasis.externalReferences as before.

## Operating profile
saveOperatingProfile(ws,{
 ...op,selectionId,title,sourceFileIds,note,
 bindings:[{
  mappingId,
  dateFields:{[actualMappedField]:'date-only'|'offset-timestamp'},
  codeMeanings:{[actualMappedField]:[{value,meaning}]},
  requiredByType:[{typeField,value,fields:[actualMappedField]}],
  dateOrders:[{earlierField,laterField}],
  dimensions:[{valueField,unitField,allowedUnits:[exactUnit]}],
  localContacts:[{whenField,whenValues:[exactCode],referenceId,consentField,consentingValues:[exactCode],evidenceReferenceId}],
  waitingDecisions:[{flagField,trueValues:[exactCode],recordedDateField,applicationReferenceId,applicationDateField}]
 }]
})
All arrays/maps required (can be empty); at least one binding. A binding selects an actual mapping in this selection. Every named field must be present in its explicit mapping. Each dateOrders field requires dateFields; dates of different formats are not compared. A waiting-date decision requires declared date formats on decision and referenced application mappings. localContacts uses the actual application record's mapped consent field and explicit party/evidence references; applicable missing consent or missing original evidence stays a finding. The operator must identify the actual policy source files (selected in this scope). No implicit date,code,deadline,eligibility or dimension unit conversion.
At creation source selection must be current. Profile retains exact original basisSha256. Later corrections/mappings make it STALE; creating a successor selection requires its own attributed profile. Flags do not issue an operational decision.

## Financial profile
saveFinancialProfile(ws,{
 ...op,selectionId,title,sourceFileIds,note,
 amountBasis,signBasis,
 bindings:[{
  mappingId,amountField,currencyField,accountField,periodField,entryTypeField,
  entryTypes:[{value,signMultiplier:1|-1}]
 }],
 permittedNamespaceTriples:[{allocation,charge,payment}],
 permittedPeriodTriples:[{allocation,charge,payment}],
 coverage:[{
  namespace,account,currency,period,
  chargesComplete:boolean,paymentsComplete:boolean,
  allocationsComplete:boolean,openingItemsComplete:boolean,
  sourceFileIds,note
 }]
})
Every binding selects an actual charges/payments/allocations mapping and actual explicit mapped fields. entryTypes covers source code/sign meanings; no inferred defaults. Amounts are exact ordinary signed decimal strings. The explicit signMultiplier yields a normalized signed control amount: positive charge increases selected charge, positive payment increases selected receipt, positive allocation uses receipt against charge; negative values retain explicit credit/refund/reversal direction. Both raw and normalized amounts are reported; unknown codes or non-decimal/blank amounts remain unqualified. No currency/unit/price conversion.

Allocation comparison requires exact charge/payment relationships, same account/currency, and equal namespaces and periods OR an explicit permitted triple (all three exact strings). A triple records permission to compare, not an exchange-rate or a period roll-forward. Duplicate triples reject.
Coverage attests exact namespace/account/currency/period and source files. Per-record residuals are computed only if all four completeness flags are true for every involved comparison partition and dependent original records are valid; otherwise null/UNCONFIRMED_COVERAGE or UNCONFIRMED_DATA. Selected-record totals are always identified as selected-only; they never imply a debtor balance. Cross-partition sums are never produced.

## Analysis extensions and readiness
Workspace adds operatingProfiles[] and financialProfiles[]; inspectWorkspace returns full profile records. Profile receipts expose operatingProfileId or financialProfileId.
analyse retains exact Audit structural report fields, plus:
operating:{status:'UNCONFIRMED'|'CURRENT'|'STALE',profileId,profile,basisSha256,rows,issues,summary}
finance:{status:'UNCONFIRMED'|'CURRENT'|'STALE',profileId,profile,basisSha256,rows,totals,allocations,residuals,issues,summary}
Rows carry record key/identity, mapped complete fields and original witness bindings. Issues have stable id,severity,code,message,key/role/witnesses and exact operands when applicable.
Operating/finance findings are separate from structural issues/ready. A structurally accepted review is source preparation review only. Profile states and findings remain visible. New profiles require a fresh reviewed profile selection before a new target preparation (prior accepted review binds its profile IDs); no automatic harbour or financial acceptance. Existing prepared CSV and returned comparisons remain immutable.
Default analysis selects latest profile for that exact selection. Explicit profile IDs must belong to it. Old profiles remain in full history/export.

## UI/CLI/receiving
Reuse complete Audit recovery envelope, original browser-copy identity, per-tab unfinished writing/CAS, original filenames and full source closure. Harbour-specific recovery schema should be 'commons.harbour-source-recovery.v1'. No private case embedded in reusable source. BuildHandover includes complete operating/financial profile originals, every analysis and original files. The CLI keeps the original lease, retained input/request, create-only output and independent receive behavior and adds the two mutation names.

Blank/no-profile states remain UNCONFIRMED; public source references and authored operating examples remain explicitly separate from actual harbour records. Core limits remain32MiB/file orCSV,128MiBportable,100krows/512columns perCSV,256files/128sources/10koperations; not performance claims. Actual commissioning scope counts full history/reports/evidence.

Actual producer must open/use/view the exact outgoing application, complete reports, original inputs and every attachment at desktop/390px, operate correction/successor policy/target/actual return/export/independent reopen/unfinished-writing recovery. Source execution is not rendered receiving. Existing caller-owned browser/controller remains the only lifecycle.
