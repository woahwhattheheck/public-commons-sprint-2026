// MIT. Operate the APM2 response through the original saved bidder desk and receiver.
import { open, readFile, rename, unlink, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createApm2OperatingContent, APM2_NOTICE_ID } from '../../../operator/APM2_OPERATING_CONTENT.mjs';
import { canonical, failure } from '../../../core.mjs';
import { validateDeskEnvelope } from '../../../bidder-desk-workspace.mjs';
import { buildResponseMaster, renderResponseMarkdown, RESPONSE_CONTENT } from './content.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const unwrap = (value, key) => value?.[key] || value;
const json = value => JSON.stringify(value, null, 2) + '\n';
async function optionalJSON(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function atomic(path, value) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const temporary = path + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(body); await handle.sync(); await handle.close(); await rename(temporary, path);
    return {path, bytes:body.length, sha256:sha(body)};
  } catch (error) { await handle.close().catch(()=>{}); await unlink(temporary).catch(()=>{}); throw error; }
}

// Compare the complete exported snapshot with the original reviewed editions.
function validateResponseExport(pkg, {records, master, decision, workshare, workspaceId}) {
  const issues = [];
  const check = (condition, code, detail) => { if (!condition) issues.push({code,...detail}); };
  const {packageId,...packageBody} = pkg;
  check(sha(canonical(packageBody)) === packageId, 'PACKAGE_IDENTITY', {packageId});
  check(pkg.workspace?.id === workspaceId && pkg.selection?.noticeIds?.includes(master.binding.noticeId),
    'WORKSPACE_SELECTION', {workspaceId:pkg.workspace?.id,selection:pkg.selection});
  validateDeskEnvelope(pkg.bidderDesk);
  const groups = new Map(pkg.bidderDesk.records.map(group=>[group.kind+':'+group.id,group]));
  for (const [key,expected] of Object.entries(records)) {
    const group = groups.get(expected.kind+':'+expected.id), edition = group?.editions?.[expected.revision-1];
    check(group?.headRevision === expected.revision && edition?.editionSha256 === expected.editionSha256,
      'RECORD_HEAD_CHANGED', {key,expected,actualHeadRevision:group?.headRevision??null,actualEditionSha256:edition?.editionSha256??null});
  }
  const outgoingDecision = groups.get('decision:'+decision.id)?.editions?.[decision.revision-1];
  check(canonical(outgoingDecision) === canonical(decision), 'DECISION_EDITION_CHANGED', {decisionId:decision.id});
  const context = decision.context;
  check(context?.entry?.id === master.binding.entryId && context.entry.sourceId === master.binding.sourceId &&
    context.entry.rowSha256 === master.binding.rowSha256 &&
    sha(canonical(context)) === decision.contextSha256, 'SOURCE_CONTEXT_CHANGED', {binding:master.binding});
  const source = pkg.sources?.find(item=>item.id===master.binding.sourceId);
  check(source?.entryIds?.includes(master.binding.entryId) && source.sha256===context.source.sha256 &&
    source.bytes===context.source.bytes, 'SOURCE_SELECTION_CHANGED', {sourceId:master.binding.sourceId});
  const expectedHeads = new Map();
  for (const [kind,editions] of [['profile',[context.profile]],['evidence',context.evidence],['requirement',context.requirements]]) {
    for (const edition of editions) {
      const key=kind+':'+edition.id, old=expectedHeads.get(key);
      if (!old || edition.revision>old.edition.revision) expectedHeads.set(key,{kind,edition});
      const saved=groups.get(key)?.editions?.[edition.revision-1];
      check(canonical(saved)===canonical(edition),'REVIEWED_EDITION_CHANGED',{kind,id:edition.id,revision:edition.revision});
    }
  }
  for (const [key,{kind,edition}] of expectedHeads) {
    const group=groups.get(key);
    check(group?.headRevision===edition.revision,'REVIEWED_HEAD_CHANGED',
      {kind,id:edition.id,reviewedRevision:edition.revision,actualHeadRevision:group?.headRevision??null});
  }
  for (const group of pkg.bidderDesk.records) {
    const head=group.editions[group.headRevision-1];
    if (['evidence','requirement'].includes(group.kind) && head.noticeId===master.binding.noticeId)
      check(expectedHeads.has(group.kind+':'+group.id),'UNREVIEWED_RECORD_ADDED',{kind:group.kind,id:group.id,headRevision:group.headRevision});
  }
  const outgoingWorkshare=pkg.workshares?.find(item=>item.id===workshare.id);
  check(canonical(outgoingWorkshare)===canonical(workshare),'WORKSHARE_EDITION_CHANGED',
    {workshareId:workshare.id,boundRevision:workshare.revision,exportedRevision:outgoingWorkshare?.revision??null});
  return {schema:'commons.canadabuys.apm2-response-export-review.v1',packageId,
    reviewedContextSha256:decision.contextSha256,status:issues.length?'REVIEW_REQUIRED':'MATCHED',issues};
}

/**
 * Both clients must refer to the original existing operator/receiving workspaces.
 * This operation writes original bidder records and never creates a second customer.
 * A complete response, draft supplier assessment, report and package are retained.
 */
export async function operateApm2BidderResponse({
  client, receivingClient, expectedWorkspaceId, expectedReceivingWorkspaceId,
  workshareId, outputDirectory, owner = 'TJLabs response engineering'
}) {
  ensure(client && receivingClient && expectedWorkspaceId && expectedReceivingWorkspaceId && workshareId && outputDirectory,
    'Supply the original two workspace bindings, saved workshare and output directory.');
  const directory = resolve(outputDirectory);
  await mkdir(directory, {recursive:true, mode:0o700});
  const previous = await optionalJSON(join(directory, 'result.json'));
  const original = {
    operation:RESPONSE_CONTENT.operation, workspaceId:expectedWorkspaceId,
    receivingWorkspaceId:expectedReceivingWorkspaceId, noticeId:APM2_NOTICE_ID, workshareId
  };
  if (previous) for (const [key,value] of Object.entries(original))
    ensure(previous.binding?.[key] === value, 'The retained response belongs to another ' + key + '.');
  const result = previous || {
    schema:'commons.canadabuys.apm2-response-operation.v1', binding:original,
    startedAt:new Date().toISOString(), commands:{}, records:{}, downloads:{}, stages:[]
  };
  result.status = 'running'; delete result.error;
  const save = async stage => {
    if (stage) result.stage = stage;
    result.updatedAt = new Date().toISOString();
    await atomic(join(directory,'result.json'),json(result));
  };
  const write = async (name, value) => {
    const file = await atomic(join(directory,name),typeof value === 'string' || Buffer.isBuffer(value) ? value : json(value));
    result.downloads[name] = file; await save(); return file;
  };
  const status = async (selected, expectedId) => {
    const state = await selected.bidderStatus();
    ensure(state.workspace?.id === expectedId, 'The original workspace binding changed.');
    return state;
  };
  const retained = async name => {
    const info = result.downloads[name];
    ensure(info?.path === join(directory,name), 'Retained artifact path changed: ' + name);
    const bytes = await readFile(info.path);
    ensure(bytes.length === info.bytes && sha(bytes) === info.sha256, 'Retained artifact bytes changed: ' + name);
    return bytes;
  };
  // Save complete mutation intent before the first request. Lost responses replay
  // the same native command fingerprint, including its exact expected revision.
  const create = async (key, kind, input) => {
    const existing = result.records[key];
    if (existing) {
      const record = unwrap(await client.bidderRecord(kind,existing.id,{revision:existing.revision}), 'record');
      ensure(record.editionSha256 === existing.editionSha256, 'The saved bidder edition changed: ' + key);
      return record;
    }
    if (!result.commands[key]) {
      const state = await status(client,original.workspaceId);
      result.commands[key] = {
        kind, input:{...input, id:kind+'-'+randomUUID(), commandId:'apm2-response/'+randomUUID()},
        expectedRevision:state.workspace.revision
      };
      await save('save-'+key);
    }
    const command = result.commands[key];
    ensure(command.kind === kind, 'The retained command kind changed.');
    const saved = await client.bidderCreate(kind,command.input,command.expectedRevision);
    const record = unwrap(saved,'record');
    ensure(record.id === command.input.id && record.revision === 1 && record.editionSha256,
      'The bidder save did not return its complete original edition.');
    result.records[key] = {kind,id:record.id,revision:record.revision,editionSha256:record.editionSha256};
    await save(); return record;
  };
  const evidence = (title,kind,body,fields={}) => ({
    noticeId:APM2_NOTICE_ID,title,kind,language:'en',version:'response-draft-1',
    localOrigin:title,bodyBase64:Buffer.from(typeof body === 'string' ? body : json(body)).toString('base64'),
    capturedAt:result.startedAt,review:{state:'REVIEWED',reviewedBy:owner,reviewedAt:result.startedAt,
      note:'Reviewed as source selection or authored engineering content; supplier commitments remain draft.'},
    ...fields
  });
  const reference = (record, section, note) => ({
    evidenceId:record.id,revision:record.revision,...(record.sha256?{sha256:record.sha256}:{}),
    pageOrSection:section,quote:'',note
  });
  try {
    await status(client,original.workspaceId); await status(receivingClient,original.receivingWorkspaceId);
    const notice = unwrap(await client.notice(APM2_NOTICE_ID),'notice');
    const workshare = unwrap(await client.workshare(workshareId),'workshare');
    ensure(workshare.noticeId === APM2_NOTICE_ID && workshare.currency === 'CAD' && workshare.feeCents === 720000,
      'Select the original APM2 engineering workshare.');
    let boundWorkshare;
    if (result.downloads['bound-workshare.json']) {
      boundWorkshare=JSON.parse((await retained('bound-workshare.json')).toString('utf8'));
      if (canonical(workshare)!==canonical(boundWorkshare)) {
        await write('changed-workshare.json',workshare);
        throw failure('APM2_REVIEW_REQUIRED','Review the changed complete workshare in the existing desk.',409,{workshareId});
      }
    } else { boundWorkshare=workshare; await write('bound-workshare.json',boundWorkshare); }
    let master;
    if (result.downloads['response-master.json']) {
      master = JSON.parse((await retained('response-master.json')).toString('utf8'));
      ensure(notice.currentEntry.id === master.binding.entryId && notice.currentEntry.rowSha256 === master.binding.rowSha256,
        'Review the changed original notice before continuing this saved response edition.');
    } else {
      master = buildResponseMaster(notice,createApm2OperatingContent(notice));
      await write('response-master.json',master);
      await write('response-master.md',renderResponseMarkdown(master));
    }
    if (!result.downloads['response-master.md']) await write('response-master.md',renderResponseMarkdown(master));
    await save('source-and-annexes');
    const source = await create('source','evidence',evidence('apm2-original-notice.json','SOLICITATION',{
      binding:master.binding,originalRow:master.originalRow
    },{
      sourceUrl:'https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv',
      language:'bilingual',pageOrSection:'Complete original 67-field notice row',
      relatedNoticeIdentifiers:[RESPONSE_CONTENT.reference,RESPONSE_CONTENT.solicitation],
      notes:'Exact retained original notice selection with its row/source identity. The RFI attachment is a separate original document.'
    }));
    const attachment = await create('attachment','evidence',{
      noticeId:APM2_NOTICE_ID,title:'Original SSC APM2 RFI attachment',kind:'SOLICITATION',
      sourceUrl:master.originalRow['attachment-piecesJointes-eng'],language:'en',accessState:'LINK_ONLY',
      relatedNoticeIdentifiers:[RESPONSE_CONTENT.reference,RESPONSE_CONTENT.solicitation],
      notes:'Existing B710/Muse/6CF6 intake owns the actual download. Append that original document here when received.',
      review:{state:'UNREVIEWED',reviewedBy:'',reviewedAt:null,note:''}
    });
    const research = {};
    for (const item of master.sources) {
      research[item.id] = await create('research-'+item.id,'evidence',evidence(
        'apm2-research-'+item.id+'.json',item.kind === 'supplier-publication'?'SUPPLIER':'OTHER',item,{
          sourceUrl:item.url,pageOrSection:item.title,
          notes:'Authored source summary retained with the original public URL and review date; this body is a research note.'
        }));
    }
    const responseDocument = await create('response-master','evidence',evidence('apm2-response-master.md','ANNEX',
      renderResponseMarkdown(master),{pageOrSection:'All twelve drafted coverage responses and three engineering annexes',
        notes:'Editable response production material. Notice-derived coverage is joined to actual issuer questions when the attachment is received.'}));
    for (const annex of master.annexes) {
      const text = ['# '+annex.title,'',...annex.sections.flatMap(section=>['## '+section.title,'',section.text,''])].join('\n');
      await write(annex.id+'.md',text);
      await create('annex-'+annex.id,'evidence',evidence('apm2-'+annex.id+'.md','ANNEX',text,{
        pageOrSection:annex.title,notes:'Proposed engineering annex for the selected supplier solution.'}));
    }
    const profile = await create('profile','profile',{
      ...master.supplierProfile,evidenceIds:['P1','P2','P3'].map(id=>research[id].id),
      qualificationClaims:[
        {id:'public-observability-services',label:'Published observability implementation and integration services',
          state:'DECLARED',evidenceIds:[research.P1.id,research.P2.id],note:'Public supplier and vendor descriptions; actual selected scope is approved by the supplier.'},
        {id:'rfi-specific-participation',label:'Participation and selected solution requirements from the original RFI',
          state:'UNKNOWN',evidenceIds:[],note:'Assess the actual issuer document and respondent-specific evidence when received.'}
      ]
    });
    await save('coverage-responses');
    for (const row of master.responses) {
      await create('requirement-'+row.id,'requirement',{
        noticeId:APM2_NOTICE_ID,kind:'INFORMATIONAL',applicability:'APPLIES',
        requirementText:row.sourceRequirement.requirement,
        sourceEvidence:[reference(source,row.sourceRequirement.source,'Original notice-derived coverage; preserve this reference when joining issuer sections.')],
        assessment:'UNKNOWN',
        supplierEvidence:row.sources.filter(id=>id.startsWith('P')).map(id=>reference(research[id],id,'Public partner selection evidence; deployment-specific commitments remain for supplier review.')),
        applicabilityBasis:'Engineering response topic derived from the retained original APM2 notice.',
        reviewedBy:owner,reviewedAt:result.startedAt,owner,
        clarificationQuestion:row.inputs.join('\n'),dueAt:null,
        notes:['Coverage ID: '+row.id,'Draft response: '+row.draft,'Deliverable: '+row.deliverable,
          'Response workshare acceptance: '+row.acceptance,
          ...(row.proposedPilotAcceptance?['Proposed platform/pilot acceptance criterion: '+row.proposedPilotAcceptance]:[]),
          'Workshare scope: '+master.workshareScope,'Technical sources: '+row.sources.join(', '),
          'Response master: '+responseDocument.id+' revision'+responseDocument.revision,
          'Actual issuer attachment: '+attachment.id,
          'Supplier approval: draft'].join('\n\n')
      });
    }
    const selection = {
      noticeId:APM2_NOTICE_ID,sourceEntryId:master.binding.entryId,
      profileId:profile.id,profileRevision:profile.revision
    };
    await save('review-source-context');
    const assessed = await client.bidderAssess(selection);
    const decision = await create('decision','decision',{
      ...selection,contextSha256:assessed.contextSha256,choice:'INVESTIGATE',owner,reviewedBy:owner,
      rationale:'Proceed with source-linked response engineering and the proposed Optimiz workshare. The original notice fits the published observability and integration services. The complete draft answers and annexes are now retained in this bidder desk. Supplier-specific product, eligibility, service and commercial commitments are reviewed against the actual issuer document and selected solution before the supplier finalizes its response.',
      conditions:'This is the internal engineering selection for the RFI response workshare. The existing sole commercial sender owns contact; a favorable human reply goes to Bryce for direct involvement.',
      unknowns:['Exact original RFI question and submission fields','Supplier legal respondent, selected product/edition and deployment','Supplier-approved product/security/service evidence and dated quote'],
      nextActions:[
        {id:'original-rfi',task:'Join the actual original RFI file and map its sections into the existing source/requirement records.',owner:'Existing B710/Muse/6CF6 intake and response engineer',status:'OPEN'},
        {id:'supplier-review',task:'Review the complete draft response and selected product responsibilities with the participating supplier.',owner:'Named supplier solution owner',status:'OPEN'},
        {id:'capacity-inputs',task:'Enter the selected actual workload and commercial inputs in the existing capacity application, then retain its complete JSON and report as annex editions.',owner:'Supplier technical and commercial owners',status:'OPEN'},
        {id:'handover',task:'Review the independently received response package, original source and workshare with the supplier solution owner.',owner:'Supplier solution owner and response engineer',status:'OPEN'}
      ]
    });
    await write('reviewed-context.json',{context:decision.context,assessment:decision.assessment,
      contextSha256:decision.contextSha256,evaluatedAt:decision.reviewedAt});
    await write('saved-decision.json',decision);
    for (const format of ['html','json','csv']) {
      const report = await client.bidderReport(decision.id,{revision:decision.revision,format});
      ensure(typeof report.body === 'string' && report.body.length, 'The original bidder report is empty.');
      await write('decision.'+format,report.body);
    }
    const comparison = await client.bidderComparison(decision.id);
    await write('comparison.json',comparison);
    ensure(comparison.changes?.changed === false, 'The source context changed during response assembly.');
    await save('export-and-receive');
    let pkg;
    if (result.downloads['response-workspace.json']) pkg = JSON.parse((await retained('response-workspace.json')).toString('utf8'));
    else {
      pkg = await client.exportPackage({scope:'selected',noticeIds:[APM2_NOTICE_ID]});
      ensure(pkg.packageId && pkg.bidderDesk, 'The complete selected package must include its original bidder records.');
      await write('response-workspace.json',pkg);
    }
    result.packageId = pkg.packageId; await save();
    const exportComparison=await client.bidderComparison(decision.id);
    await write('export-context-comparison.json',exportComparison);
    if (exportComparison.changes?.changed!==false) throw failure('APM2_REVIEW_REQUIRED',
      'The current source or supplier context changed during export; review the retained complete packet against the original decision.',409,
      {packageId:pkg.packageId,comparison:exportComparison});
    const exportReview=validateResponseExport(pkg,{records:result.records,master,decision,workshare:boundWorkshare,workspaceId:original.workspaceId});
    await write('export-review.json',exportReview);
    if (exportReview.status!=='MATCHED') throw failure('APM2_REVIEW_REQUIRED',
      'The retained exported package contains a changed selection; review its complete editions in the original bidder desk.',409,exportReview);
    let receivingRecord;
    try { receivingRecord = unwrap(await receivingClient.receiving(pkg.packageId),'receiving'); }
    catch (error) { if (error.status !== 404) throw error; }
    if (!receivingRecord) {
      if (!result.receivingIntent) {
        const state = await status(receivingClient,original.receivingWorkspaceId);
        result.receivingIntent = {packageId:pkg.packageId,expectedRevision:state.workspace.revision};
        await save();
      }
      ensure(result.receivingIntent.packageId === pkg.packageId,'The retained receiving package changed.');
      const received = await receivingClient.receivePackage(pkg,result.receivingIntent.expectedRevision);
      receivingRecord = unwrap(received,'receiving');
    }
    await write('receiving.json',receivingRecord);
    ensure(receivingRecord.packageId===pkg.packageId,'The receiving receipt belongs to another package.');
    const receivingIssues={packageId:pkg.packageId,receivingWorkspaceId:original.receivingWorkspaceId,
      bidderStatus:receivingRecord.bidderDesk?.status,
      bidderConflicts:receivingRecord.bidderDesk?.conflicts||[],
      reviewConflicts:(receivingRecord.reviewConflicts||[]).filter(item=>item.noticeId===APM2_NOTICE_ID),
      workshareConflicts:(receivingRecord.workshareConflicts||[]).filter(item=>
        pkg.workshares.some(workshare=>workshare.id===item.workshareId)),
      captureConflicts:receivingRecord.captureConflicts||[]};
    if (receivingIssues.bidderStatus!=='RECEIVED' || receivingIssues.bidderConflicts.length ||
        receivingIssues.reviewConflicts.length || receivingIssues.workshareConflicts.length || receivingIssues.captureConflicts.length) {
      await write('receiving-review.json',receivingIssues);
      throw failure('APM2_REVIEW_REQUIRED','Review the original receiving conflicts with both retained histories and this package ID.',409,receivingIssues);
    }
    for (const [key, expected] of Object.entries(result.records)) {
      const record = unwrap(await receivingClient.bidderRecord(expected.kind,expected.id,{revision:expected.revision}),'record');
      ensure(record.editionSha256 === expected.editionSha256,'Received bidder edition differs: '+key);
      if (expected.kind === 'evidence' && record.accessState === 'CAPTURED') {
        const read = await receivingClient.bidderEvidence(record.id,{revision:record.revision});
        ensure(read.body?.byteLength === record.bytes && sha(read.body) === record.sha256,'Received evidence bytes differ: '+key);
      }
    }
    const receivedWorkshare = unwrap(await receivingClient.workshare(workshareId),'workshare');
    await write('received-workshare.json',receivedWorkshare);
    if (canonical(receivedWorkshare)!==canonical(boundWorkshare)) throw failure('APM2_REVIEW_REQUIRED',
      'The receiver retains a different complete workshare edition or history; review it alongside the saved outgoing workshare.',409,
      {packageId:pkg.packageId,workshareId,boundRevision:boundWorkshare.revision,receivedRevision:receivedWorkshare.revision});
    result.status = 'completed'; result.completedAt = new Date().toISOString();
    result.summary = {requirements:master.responses.length,records:Object.keys(result.records).length,
      originalNoticeId:APM2_NOTICE_ID,decisionId:decision.id,decisionRevision:decision.revision,
      receivingWorkspaceId:original.receivingWorkspaceId,packageId:pkg.packageId,workshareId,
      completeEvidenceReadback:true};
    await save('complete'); return result;
  } catch (error) {
    result.status = error.code==='APM2_REVIEW_REQUIRED'?'review-required':'failed'; result.error = {message:error.message,code:error.code,status:error.status,details:error.details};
    await save(); error.apm2ResponseDirectory = directory; throw error;
  }
}
