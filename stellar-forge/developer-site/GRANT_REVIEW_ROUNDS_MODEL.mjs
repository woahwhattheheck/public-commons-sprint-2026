// MIT. Complete source-model receiving for the original SCF submission review.
import { validateDraft, validateSource, retainVersion, receiveSource, useSourceAnswer, ANSWERS,
  applicationOutput, measureText } from './dist/grant-submission-core.mjs';
import { createReviewRound, captureSubmissionDraft, readSubmissionExport, reviewRoundView,
  compareReviewDraft, applyReviewAction, exportReviewRound, importReviewRound, reviewReport,
  reviewSha256 } from './dist/grant-review-round-core.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
function need(value,message){if(!value)throw new Error(message);}
function identical(a,b){return JSON.stringify(a)===JSON.stringify(b);}
async function rejected(fn,pattern){let error=null;try{await fn();}catch(e){error=e;}need(error&&pattern.test(error.message),'The original rejection was not observed: '+pattern);return error.message;}
function sourceIdentity(source){return {bytes:source.bytes,sha256:source.sha256,gitBlob:source.gitBlob,url:source.url,receivedAt:source.receivedAt};}

/**
 * Run the complete real-source model journey without a browser, store or new native controller.
 * The caller supplies an original native draft and another fully retained source edition.
 * Every decision in this isolated exercise is explicitly an automated model observation.
 */
export async function runGrantReviewModel({
  draft,nextSource,operationId='SCF-SUBMISSION-REVIEW-ROUND-7108-20261012-MODEL',
  startedAt=new Date().toISOString(),
  reviewer={id:'reviewer-7108',label:'TJLabs automated source-model reviewer 7108'},
  author={id:'author-7108',label:'TJLabs automated source-model author 7108'}
}={}){
  const executedAt=new Date().toISOString();
  validateDraft(draft);validateSource(nextSource);
  need(draft.currentSource!==nextSource.sha256,'Select a distinct complete original source edition for receiving.');
  need(draft.fields.length>0,'Supply a clearly labeled receiving-example field in this isolated draft.');
  need(draft.answers.every(x=>x.text===x.baseText),'The model exercise begins with an unedited copy of its complete original source.');
  need(new Date(startedAt).toISOString()===startedAt,'Retain the actual complete exercise timestamp.');
  need(reviewer.id!==author.id&&reviewer.label!==author.label,'Retain separate named model reviewer and author identities.');
  const checks=[],originalDraft=clone(draft),at=index=>new Date(Date.parse(startedAt)+index*1000).toISOString();
  const firstCapture=await captureSubmissionDraft(originalDraft,{receivedAt:startedAt});
  let round=await createReviewRound(firstCapture,{id:operationId,reviewer,now:startedAt});
  const initialRound=clone(round),requests=[];
  async function action(name,kind,input,actor=reviewer.id){
    const request={requestId:name==='first-decision'?'first-decision':operationId+':'+name,
      expectedRevision:round.events.length,actorId:actor,kind,input,at:at(round.events.length)};
    requests.push(clone(request));round=await applyReviewAction(round,request);return round;
  }
  async function decide(name,selected,note){
    const view=await reviewRoundView(round),target=view.targets.find(x=>x.key===selected);
    need(target,'Retain the selected native review target '+selected);
    await action(name,'review',{editionId:view.selectedEdition,target:target.target,bindingSha256:target.bindingSha256,
      decision:'accepted',note,references:[]});
  }
  await decide('first-decision','answer:project','Automated source-model exercise of the exact retained project answer; not a human or issuer approval.');
  const firstDecisionRound=clone(round);
  await action('author','participant',{person:author});
  const fieldId=originalDraft.fields[0].id;
  await decide('field-decision','field:'+fieldId,'Automated receiving-example field review; this field is not claimed to be an observed issuer form.');
  let view=await reviewRoundView(round),needTarget=view.targets.find(x=>x.key==='answer:need');
  await action('need-decision','review',{editionId:view.selectedEdition,target:needTarget.target,bindingSha256:needTarget.bindingSha256,
    decision:'changes-requested',note:'Receiving exercise: add an explicit author response and retain the exact original source.',
    references:[{label:'Original selected application',url:'',note:'The complete application source is retained in this draft; this is a model receiving observation.'}]});
  const changeId=operationId+':need-change';
  await action('need-change','change',{editionId:view.selectedEdition,target:needTarget.target,bindingSha256:needTarget.bindingSha256,
    title:'Retain the revised author explanation',priority:'major',quote:needTarget.text.slice(0,180),
    note:'Receiving exercise only: revise this answer, preserve its source baseline, and reply to this same request.',
    references:[]});
  const reviewedOriginal=clone(round),reviewedOriginalExport=await exportReviewRound(round,{now:at(50)});
  let edited=retainVersion(originalDraft,'Before the isolated receiving-example author edit',at(10));
  edited.answers.find(x=>x.id==='need').text+='\n\nReceiving exercise author note: this isolated draft tests complete source retention and an explicit colleague-review response.';
  edited.receivingExtension={schema:'stellar-forge.grant-review-extension-example.v1',meaning:'An isolated extension-preservation observation, not a native planning result.',
    complete:{source:originalDraft.currentSource,values:['retained',0,false,null],details:{fieldId}}};
  validateDraft(edited);
  const editedCapture=await captureSubmissionDraft(edited,{fileName:'submission-author-revision.json',receivedAt:at(10)});
  const firstComparison=await compareReviewDraft(round,editedCapture);
  need(firstComparison.decisions.find(x=>x.decision.target.id==='project').canCarry,'The unchanged project decision must remain eligible.');
  need(firstComparison.decisions.find(x=>x.decision.target.kind==='field').canCarry,'The unchanged original field must remain eligible.');
  need(!firstComparison.decisions.find(x=>x.decision.target.id==='need').canCarry,'Changed answer text must require a new review.');
  const beforeBadCarry=JSON.stringify(round);
  checks.push({name:'changed-content-carry-rejected',message:await rejected(()=>applyReviewAction(round,{
    requestId:operationId+':rejected-changed-carry',expectedRevision:round.events.length,actorId:author.id,kind:'receive',at:at(11),
    input:{editionId:editedCapture.id,fromEdition:firstComparison.fromEdition,note:'Invalid receiving exercise input.',
      decisions:firstComparison.decisions.map(x=>({decisionId:x.decision.id,choice:'carry',note:'Attempted automatic carry.'}))}
  },editedCapture),/Changed text/)});
  need(JSON.stringify(round)===beforeBadCarry,'A rejected receive must leave the original round unchanged.');
  const receiveEdited={requestId:operationId+':receive-author-revision',expectedRevision:round.events.length,actorId:author.id,kind:'receive',
    at:at(round.events.length),input:{editionId:editedCapture.id,fromEdition:firstComparison.fromEdition,
      note:'Explicitly receive the author revision in this isolated complete model exercise.',
      decisions:firstComparison.decisions.map(x=>({decisionId:x.decision.id,choice:x.canCarry?'carry':'reopen',
        note:x.canCarry?'Explicitly carry the identical original content and context.':'The author changed this answer; record a fresh review.'}))}};
  requests.push(clone(receiveEdited));round=await applyReviewAction(round,receiveEdited,editedCapture);
  view=await reviewRoundView(round);
  need(view.decisions.length===2&&view.decisions.every(x=>x.actorId===reviewer.id&&x.carriedBy===author.id),'Carry must preserve the original reviewer and identify the selecting author.');
  need(identical(view.draft.receivingExtension,edited.receivingExtension),'Retain the whole unknown native draft extension.');
  const replay=await applyReviewAction(round,requests[0]);
  need(identical(replay,round),'The original request replay must preserve all later work.');
  checks.push({name:'same-request-preserves-later-round',originalRequestId:requests[0].requestId,laterRevision:view.revision});
  checks.push({name:'changed-request-id-rejected',message:await rejected(()=>applyReviewAction(round,{...requests[0],input:{...requests[0].input,note:'Different input'}}),/different review input/)});
  await action('author-response','respond',{changeId,editionId:view.selectedEdition,response:'addressed',
    note:'The receiving-example author revision is retained in full; the original request and quote are unchanged.',
    references:[{label:'Retained author revision',url:'',note:'The full native export is '+editedCapture.id+'.'}]},author.id);
  await decide('revised-need-decision','answer:need','Automated inspection of the explicitly selected receiving-example author revision.');
  await action('resolve-author-revision','resolve',{changeId,editionId:view.selectedEdition,status:'resolved',
    note:'The named model reviewer inspected the retained revised answer.'});
  let latest=receiveSource(edited,nextSource,at(20));
  // The original author deliberately selects the new complete source answer after native source receiving preserved the edit.
  latest=useSourceAnswer(latest,'need',nextSource,at(21));
  latest=retainVersion(latest,'Before explicitly refreshing the receiving-example field',at(22));
  const selectedField=latest.fields.find(x=>x.id===fieldId);
  selectedField.prompt='Receiving example only: review the full newly selected delivery answer and retained source edition.';
  selectedField.text=latest.answers.find(x=>x.id==='delivery').text;
  selectedField.observedAt=nextSource.receivedAt.slice(0,10);
  validateDraft(latest);
  const latestCapture=await captureSubmissionDraft(latest,{fileName:'submission-current-source-revision.json',receivedAt:at(23)});
  const sourceComparison=await compareReviewDraft(round,latestCapture);
  need(sourceComparison.decisions.some(x=>!x.canCarry),'The new original source context must reopen affected reviews.');
  const receiveLatest={requestId:operationId+':receive-current-source',expectedRevision:round.events.length,actorId:author.id,kind:'receive',
    at:at(round.events.length),input:{editionId:latestCapture.id,fromEdition:sourceComparison.fromEdition,
      note:'Explicitly select the complete later application source and revised original field context.',
      decisions:sourceComparison.decisions.map(x=>({decisionId:x.decision.id,choice:x.canCarry?'carry':'reopen',
        note:x.canCarry?'Explicitly retain the exact unchanged original target.':'The source baseline or field context changed; a new decision is required.'}))}};
  requests.push(clone(receiveLatest));round=await applyReviewAction(round,receiveLatest,latestCapture);
  view=await reviewRoundView(round);
  need(view.changes.find(x=>x.id===changeId).status==='open','A resolved change must reopen when its selected source context changes.');
  need(view.draft.id===originalDraft.id&&view.draft.fields[0].id===fieldId,'Retain original draft and field identities.');
  need(view.draft.sources.length===2&&view.draft.sources[0].markdown===originalDraft.sources[0].markdown&&view.draft.sources[1].markdown===nextSource.markdown,'Keep both full original application bodies.');
  need(identical(view.draft.receivingExtension,edited.receivingExtension),'Keep the complete extension through native source receiving and field selection.');
  checks.push({name:'native-source-field-and-extension-retained',draftId:view.draft.id,fieldId,sourceCount:view.draft.sources.length,versions:view.draft.versions.length});
  checks.push({name:'incomplete-readiness-rejected',message:await rejected(()=>applyReviewAction(round,{
    requestId:operationId+':rejected-incomplete-finish',expectedRevision:round.events.length,actorId:reviewer.id,kind:'finish',at:at(24),
    input:{editionId:view.selectedEdition,outcome:'ready-for-author-check',note:'Invalid premature completion in the model exercise.'}}),/Review every current target/)});
  await action('latest-author-response','respond',{changeId,editionId:view.selectedEdition,response:'addressed',
    note:'The complete later canonical source was explicitly received; its original answer replaced the isolated author edit.',
    references:[]},author.id);
  await action('latest-resolution','resolve',{changeId,editionId:view.selectedEdition,status:'resolved',
    note:'The model reviewer inspected the selected complete later source and its changed context.'});
  view=await reviewRoundView(round);
  for(const selected of view.targets)await decide('final-'+selected.key,selected.key,
    'Automated full-source model receiving observation for '+selected.title+'. This does not record a human or issuer approval.');
  view=await reviewRoundView(round);
  need(view.readiness.length===0,'All exact selected targets and receiving-example field checks must be complete.');
  await action('finish','finish',{editionId:view.selectedEdition,outcome:'ready-for-author-check',
    note:'The isolated source-model receiving is complete; actual applicant and issuer decisions remain with their original owners.'});
  const completed=clone(round),completedView=await reviewRoundView(completed);
  const exported=await exportReviewRound(completed,{now:at(100)});
  const received=await importReviewRound(exported),receivedAgain=await importReviewRound(exported);
  need(identical(received,completed)&&identical(receivedAgain,completed),'Independent complete receiving must preserve the entire round exactly.');
  need((await readSubmissionExport(latestCapture.exportText,{fileName:latestCapture.fileName,receivedAt:latestCapture.receivedAt})).id===latestCapture.id,
    'The exact original native draft must remain independently readable.');
  const reopened=await applyReviewAction(received,{requestId:operationId+':reopen-received',expectedRevision:received.events.length,
    actorId:author.id,kind:'reopen',input:{note:'Continue the same fully received editorial round.'},at:at(101)});
  need((await reviewRoundView(reopened)).status==='OPEN'&&reopened.id===completed.id,'Reopen the same received round and identities.');
  const tampered=JSON.parse(exported);tampered.round.events[0].input.note='Changed original reviewer note';
  tampered.sha256=await reviewSha256(JSON.stringify(tampered.round));
  checks.push({name:'recomputed-envelope-does-not-hide-changed-history',message:await rejected(()=>importReviewRound(JSON.stringify(tampered)),/event|action|digest|identity|changed|hash/i)});
  const corruptDraft=clone(originalDraft);corruptDraft.sources[0].markdown+='\nUnretained change.';
  checks.push({name:'changed-original-source-rejected',message:await rejected(()=>captureSubmissionDraft(corruptDraft,{receivedAt:at(102)}),/source|application|identity|bytes|differs|changed/i)});
  const report=await reviewReport(completed);
  need(report.includes(applicationOutput(completedView.draft,{format:completed.format,useFields:false}))&&
    report.includes(applicationOutput(completedView.draft,{format:completed.format,useFields:true})),
    'The human report must include every complete current answer and issuer field.');
  for(const capture of completed.editions)need(capture.exportText===[firstCapture,editedCapture,latestCapture].find(x=>x.id===capture.id).exportText,
    'No original received export may be rewritten.');
  const bodies=[
    ['inputs/original-draft.json',firstCapture.exportText],['inputs/author-revision.json',editedCapture.exportText],
    ['inputs/current-source-revision.json',latestCapture.exportText],['inputs/reviewed-original.json',reviewedOriginalExport],
    ['review-round.json',exported],['review-report.md',report],['received-review-round.json',await exportReviewRound(received,{now:at(100)})],
    ['reopened-review-round.json',await exportReviewRound(reopened,{now:at(103)})],
    ['original-actions.json',JSON.stringify({schema:'stellar-forge.grant-review-model-actions.v1',operationId,requests},null,2)+'\n']
  ];
  const artifacts=[];for(const [path,content]of bodies)artifacts.push({path,bytes:measureText(content).utf8Bytes,sha256:await reviewSha256(content),content});
  checks.push({name:'complete-independent-receive-repeat-reopen',roundId:completed.id,completedRevision:completed.events.length,
    reopenedRevision:reopened.events.length,originalEditions:completed.editions.length,fullAnswers:ANSWERS.length,
    fields:completedView.draft.fields.length,decisions:completedView.decisions.length,originalExportsUnchanged:true});
  const result={schema:'stellar-forge.grant-review-model-receiving.v1',state:'COMPLETE',operationId,startedAt,executedAt,completedAt:new Date().toISOString(),
    timeline:'Caller-selected deterministic editorial timeline; draft receivedAt values are fixture observations, not new provider acquisitions.',
    runtime:'Actual imported source functions; no browser, issuer submission or human approval is represented.',
    originalDraftId:originalDraft.id,reviewer,author,sourceEditions:[sourceIdentity(originalDraft.sources[0]),sourceIdentity(nextSource)],
    firstDraftSha256:firstCapture.draftSha256,firstEventSha256:firstDecisionRound.events[0].sha256,
    reviewRoundId:completed.id,reviewRevision:completed.events.length,reviewSha256:await reviewSha256(exported),
    artifactBytes:artifacts.reduce((sum,x)=>sum+x.bytes,0),files:artifacts.map(({content,...row})=>row),checks};
  return {result,artifacts,fixtures:{initialRound,reviewedOriginal,completed,firstCapture,editedCapture,latestCapture,fieldId,reviewer,author}};
}
