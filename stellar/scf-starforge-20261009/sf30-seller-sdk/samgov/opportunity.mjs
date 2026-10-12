// MIT. SAM notice sources enter the ORIGINAL opportunity/dossier workspace.
import { join,resolve } from 'node:path';
import { privateDirectory,readJson,writeJson,jsonBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { openOpportunityStore } from '../../partners/lgndx-opportunity-operations/model.mjs';
import { MAX_SOURCE_BYTES as OPPORTUNITY_SOURCE_LIMIT } from '../../partners/lgndx-opportunity-operations/sources.mjs';
import {noticeSourceIds} from './notice-document.mjs';
import { SOURCE_BASIS,sha,canonical,copy,plain,text,integer,identifier,requireThat,
  SamError,now,reviewDeadline,sourceBuffer } from './core.mjs';

const SCHEMA='stellar-forge.samgov-opportunity-bridge.v1';
function sourcePayload(source,role,replacesSourceId){
  return {role,title:('SAM '+source.kind+': '+source.filename).slice(0,240),
    url:source.url,capturedAt:source.capturedAt,filename:source.filename,
    mediaType:source.mediaType.slice(0,160),
    sourceTerms:'Retained original SAM.gov notice observation. Original GSA and issuing-agency source terms apply.',
    contentBase64:source.contentBase64,...(replacesSourceId?{replacesSourceId}:{})};
}
export async function prepareSamOpportunity({
  directory,journalDirectory,operator,requestId,workspaceId,sourceRevision,selection,edition,
  notice,sources,projectId,expectedProjectRevision,title,documentKind='other',deadline,
}={}){
  directory=resolve(text(directory,'Original opportunity workspace',4000));
  journalDirectory=await privateDirectory(resolve(text(journalDirectory,'Bridge journal directory',4000)));
  text(operator,'Original operator',240);text(requestId,'Request ID',200);
  identifier(workspaceId,'SAM workspace ID');integer(sourceRevision,'Source workspace revision',1,Number.MAX_SAFE_INTEGER);
  requireThat(plain(selection) && plain(edition) && plain(notice) && Array.isArray(sources) &&
    selection.editionId===edition.id && selection.noticeIds.includes(notice.noticeId),
    'OPPORTUNITY_NOTICE_SELECTION_CHANGED');
  requireThat(['rfi','sources_sought','solicitation','other'].includes(documentKind),'DOCUMENT_KIND_INVALID');
  const selectedDeadline=reviewDeadline(deadline);
  const availableSources=new Map();
  for(const source of sources){
    const bytes=sourceBuffer(source);
    requireThat(sha(bytes)===source.sha256 && bytes.length===source.bytes,'OPPORTUNITY_SOURCE_CHANGED');
    requireThat(bytes.length>0 && bytes.length<=OPPORTUNITY_SOURCE_LIMIT,'OPPORTUNITY_SOURCE_CAPACITY',
      'The original opportunity dossier accepts a source file up to 24 MiB; retain this complete file in SAM and select a supported source document.',413);
    requireThat(!availableSources.has(source.id),'OPPORTUNITY_SOURCE_DUPLICATE');
    availableSources.set(source.id,source);
  }
  const requestedIds=noticeSourceIds(notice,{successfulResourcesOnly:true});
  requireThat(new Set(requestedIds).size===availableSources.size &&
    requestedIds.every(id=>availableSources.has(id)),'OPPORTUNITY_SOURCE_SET_CHANGED');
  const normalizedTitle=text(title??notice.title??notice.solicitationNumber??notice.noticeId,'Opportunity title',500);
  const originalInput={workspaceId,requestId,selectionId:selection.id,selectionRevision:selection.revision,
    editionId:edition.id,editionSha256:edition.sha256,noticeId:notice.noticeId,recordSha256:notice.recordSha256,
    sources:sources.map(source=>({id:source.id,sha256:source.sha256,bytes:source.bytes})),
    projectId:projectId??null,expectedProjectRevision:expectedProjectRevision??null,
    title:normalizedTitle,documentKind,deadline:selectedDeadline};
  const requestSha256=sha(originalInput),bridgeId='bridge_'+sha({workspaceId,requestId}),
    journalPath=join(journalDirectory,bridgeId+'.json');
  let journal;
  try{
    journal=await readJson(journalPath,32*1024*1024);
    requireThat(journal.schema===SCHEMA && journal.requestSha256===requestSha256 &&
      journal.operator===operator,'OPPORTUNITY_BRIDGE_CHANGED',
      'Resume the same original selection, operator and project input for this bridge request.',409);
  }catch(error){if(error.code!=='ENOENT')throw error;
    journal={schema:SCHEMA,id:bridgeId,requestSha256,operator,sourceRevision,createdAt:now(),
      input:originalInput,projectId:projectId??null,steps:[],sourceBindings:[],pending:null,completedAt:null,result:null};
    await writeJson(journalPath,journal,{exclusive:true});
  }
  const store=await openOpportunityStore({directory,operator});
  let current;
  async function save(){await writeJson(journalPath,journal);}
  async function step(name,action,buildPayload,identify){
    const done=journal.steps.find(item=>item.name===name);
    if(done){current=await store.get(journal.projectId);return done;}
    if(journal.pending)requireThat(journal.pending.name===name && journal.pending.action===action,
      'OPPORTUNITY_BRIDGE_PENDING_CHANGED');
    else{
      const payload=await buildPayload();
      payload.requestId='sam-bridge-'+sha({bridgeId,name});
      journal.pending={name,action,payload,preparedAt:now()};await save();
    }
    // The exact original expectedRevision and requestId survive an uncertain
    // return. Original model replay owns deduplication and source retention.
    const original=journal.pending;
    current=await store.dispatch(action,copy(original.payload));
    requireThat(plain(current) && typeof current.id==='string' && Number.isSafeInteger(current.revision),
      'OPPORTUNITY_RESPONSE_INVALID');
    if(journal.projectId)requireThat(current.id===journal.projectId,'OPPORTUNITY_PROJECT_CHANGED');
    journal.projectId=current.id;
    const result={name,action,projectId:current.id,revision:current.revision,
      requestId:original.payload.requestId,completedAt:now(),...(identify?identify(current):{})};
    journal.steps.push(result);journal.pending=null;await save();return result;
  }
  function matchingSource(view,source){
    return view.sources.find(item=>item.sha256===source.sha256 && item.bytes===source.bytes &&
      item.url===source.url && item.filename===source.filename);
  }
  try{
    if(journal.completedAt){
      current=await store.get(journal.projectId);
      for(const binding of journal.sourceBindings)requireThat(current.sources.some(source=>
        source.id===binding.opportunitySourceId && source.sha256===binding.sha256),
        'OPPORTUNITY_RETAINED_SOURCE_CHANGED');
      return {...copy(journal.result),currentProjectRevision:current.revision};
    }
    if(journal.projectId){
      current=await store.get(journal.projectId);
      if(journal.steps.length===0 && !journal.pending){
        integer(expectedProjectRevision,'Expected project revision',1,Number.MAX_SAFE_INTEGER);
        requireThat(current.revision===expectedProjectRevision,'PROJECT_REVISION_CONFLICT',
          'Read the current original opportunity revision before adding this notice.',409,
          {revision:current.revision});
      }
      requireThat(!current.opportunity.reference || current.opportunity.reference===notice.solicitationNumber ||
        current.opportunity.url===notice.uiUrl,'OPPORTUNITY_NOTICE_MISMATCH',
        'The selected existing project has a different original opportunity reference.',409);
    }else{
      await step('create','create',async()=>({title:normalizedTitle,
        description:'Operating project for retained SAM notice '+notice.noticeId+'.',
        opportunity:{title:normalizedTitle,buyer:(notice.fullParentPathName??'').slice(0,500),
          reference:(notice.solicitationNumber??notice.noticeId).slice(0,240),url:notice.uiUrl,
          documentKind,stage:'research',dueAt:selectedDeadline?.at??'',
          timeZone:selectedDeadline?.timeZone??'',notes:'Original SAM notice: '+notice.noticeId+
            '. Raw response deadline: '+(notice.responseDeadLine??'not supplied')+
            '. Source basis: '+(edition.sourceBasis??SOURCE_BASIS)+'.'}}));
    }
    for(const source of sources){
      const name='source-'+source.id;
      let completed=journal.steps.find(item=>item.name===name);
      if(!completed){
        const existing=matchingSource(current,source);
        if(existing && !journal.pending){
          completed={name,action:'reuse_original_source',projectId:current.id,revision:current.revision,
            sourceId:existing.id,sha256:source.sha256,completedAt:now()};
          journal.steps.push(completed);await save();
        }else{
          completed=await step(name,'retain_source',async()=>{
            const previous=current.sources.filter(item=>item.url===source.url && item.filename===source.filename).at(-1);
            return {id:current.id,expectedRevision:current.revision,
              ...sourcePayload(source,previous?'amendment':'solicitation',previous?.id)};
          },view=>{
            const retained=matchingSource(view,source);
            requireThat(retained,'OPPORTUNITY_SOURCE_RECEIVE_INCOMPLETE');
            return {sourceId:retained.id,sha256:source.sha256};
          });
        }
      }
      if(!journal.sourceBindings.some(binding=>binding.sourceId===source.id)){
        journal.sourceBindings.push({sourceId:source.id,opportunitySourceId:completed.sourceId,
          sha256:source.sha256,bytes:source.bytes,kind:source.kind,url:source.url});
        await save();
      }
    }
    const observation={schema:'stellar-forge.samgov-selected-notice.v1',sourceBasis:edition.sourceBasis??SOURCE_BASIS,
      workspaceId,sourceRevision:journal.sourceRevision,selection:copy(selection),edition:copy(edition),
      notice:copy(notice),sources:sources.map(source=>{const item=copy(source);delete item.contentBase64;delete item.contentText;return item;}),
      sourceBindings:copy(journal.sourceBindings),deadlineReview:selectedDeadline,bridgeId};
    const observationBytes=jsonBytes(observation),observationSha256=sha(observationBytes);
    const observationSource={kind:'selected_notice',filename:'sam-'+notice.noticeId+'-observation.json',
      url:notice.uiUrl,capturedAt:notice.source.capturedAt,mediaType:'application/json',
      contentBase64:observationBytes.toString('base64'),sha256:observationSha256,bytes:observationBytes.length};
    const observationStep=await step('selected-notice','retain_source',async()=>{
      const previous=current.sources.filter(source=>source.url===notice.uiUrl &&
        source.filename===observationSource.filename).at(-1);
      return {id:current.id,expectedRevision:current.revision,
        ...sourcePayload(observationSource,previous?'amendment':'other',previous?.id)};
    },view=>{
      const retained=matchingSource(view,observationSource);
      requireThat(retained,'OPPORTUNITY_NOTICE_RECEIVE_INCOMPLETE');
      return {sourceId:retained.id,sha256:observationSha256};
    });
    await step('update-opportunity','update',async()=>{
      const note='SAM observation '+edition.id+' / '+notice.noticeId+
        '\nOriginal response deadline: '+(notice.responseDeadLine??'not supplied')+
        '\nRetained notice SHA-256: '+notice.recordSha256+
        '\n'+(selectedDeadline?'Reviewed deadline: '+selectedDeadline.at+' ('+selectedDeadline.timeZone+'); '+selectedDeadline.reason:
          'The source deadline remains separate from any existing reviewed project deadline.');
      const notes=(current.opportunity.notes?current.opportunity.notes+'\n\n':'')+note;
      text(notes,'Opportunity notes',50000,true);
      return {id:current.id,expectedRevision:current.revision,opportunity:{
        title:normalizedTitle,buyer:(notice.fullParentPathName??'').slice(0,500),
        reference:(notice.solicitationNumber??notice.noticeId).slice(0,240),url:notice.uiUrl,documentKind,
        stage:current.opportunity.stage,
        dueAt:selectedDeadline?.at??current.opportunity.dueAt,
        timeZone:selectedDeadline?.timeZone??current.opportunity.timeZone,notes}};
    });
    journal.completedAt=now();
    journal.result={bridgeId,projectId:current.id,revision:current.revision,
      sourceRevision:journal.sourceRevision,selectionId:selection.id,editionId:edition.id,noticeId:notice.noticeId,
      sourceBindings:copy(journal.sourceBindings),observationSourceId:observationStep.sourceId,
      observationSha256,completedAt:journal.completedAt};
    await save();return copy(journal.result);
  }finally{await store.close();}
}

