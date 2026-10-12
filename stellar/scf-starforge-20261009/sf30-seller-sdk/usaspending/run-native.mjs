#!/usr/bin/env node
// MIT. Operate the complete research/receiving workflow using an actual retained public source collection.
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AwardWorkspace } from './workspace.mjs';
import { importSourceCollection, readJsonFile } from './source-import.mjs';
import { prepareMerchant, loadMerchant, adoptDelivery } from './merchant.mjs';
import { serveWorkspace } from './server.mjs';
import { workshareBrief } from './brief.mjs';
import { VERSION, COLUMNS, canonical, sha, now, requireThat, publicRow, addDecimals } from './core.mjs';
import { init as initDelivery, appendMany, scan as scanDelivery, finalize } from '../../sf100-buyer-dataset-delivery/deliver.mjs';
import { openDossierStore } from '../../sf88-operator-buyer-cli/research-dossiers/dossier.mjs';
import { receiveUSAspendingEdition, recoverUSAspendingEdition } from './dossier.mjs';

async function existing(path){try{return await readFile(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function retain(path,bytes){bytes=Buffer.from(bytes);const old=await existing(path);if(old){requireThat(sha(old)===sha(bytes),'NATIVE_OUTPUT_CONFLICT',path);return old;}await writeFile(path,bytes,{flag:'wx',mode:0o600});return bytes;}
async function retainedJson(path,make){const old=await existing(path);if(old)return JSON.parse(old.toString('utf8'));const value=await make();await retain(path,JSON.stringify(value,null,2)+'\n');return value;}
export async function runNative({sourceCollection,out,operationId,operator='Research operator',reviewFile,paymentFile,origin}){
  out=resolve(out);sourceCollection=resolve(sourceCollection);await mkdir(out,{recursive:true,mode:0o700});
  const source=await readJsonFile(sourceCollection),journalPath=join(out,'operation.json'),prior=await existing(journalPath);
  const journal=prior?JSON.parse(prior.toString('utf8')):{schema:VERSION+'.native-operation',operationId,sourceCollectionSha256:sha(source.bytes),startedAt:now(),status:'running',steps:{}};
  requireThat(journal.operationId===operationId&&journal.sourceCollectionSha256===sha(source.bytes),'NATIVE_OPERATION_INPUT_CHANGED');
  const checkpoint=async()=>{const path=journalPath+'.'+process.pid+'.next';await writeFile(path,JSON.stringify(journal,null,2)+'\n',{mode:0o600});await rename(path,journalPath);};
  await checkpoint();
  const workspace=new AwardWorkspace(join(out,'research'),{operator}),receiving=new AwardWorkspace(join(out,'receiving'),{operator});
  let server,restored;
  const step=async(name,fn)=>{if(journal.steps[name])return journal.steps[name];journal.currentStep=name;await checkpoint();const result=await fn();journal.steps[name]=result;await checkpoint();return result;};
  try{
    const imported=await step('source_collection',()=>importSourceCollection(workspace,sourceCollection));
    requireThat(imported.failures.length===0,'NATIVE_SOURCE_COLLECTION_INCOMPLETE',JSON.stringify(imported.failures));
    const editionId=imported.editionId,rows=workspace.rows(editionId);
    const sourcePacket=await step('source_edition_export',async()=>{const packet=await retainedJson(join(out,'source-edition.json'),()=>workspace.exportEdition(editionId));return {editionId,sha256:packet.sha256,rows:packet.rows.length,coverage:packet.coverage};});
    const comparison=workspace.compare(imported.searchEditionId,editionId);await retain(join(out,'search-detail-comparison.json'),JSON.stringify(comparison,null,2)+'\n');
    await step('research_findings',async()=>{
      const findings=await retainedJson(join(out,'research-findings.json'),()=>{
        const agencies={};for(const row of rows){const key=row.awarding_agency??'unreported';agencies[key]=(agencies[key]??0)+1;}
        return {schema:VERSION+'.research-findings',editionId,sourceEditionSha256:workspace.edition(editionId).sha256,
          coverage:sourcePacket.coverage,
          totals:{awards:rows.length,obligationUsd:addDecimals(rows.map(r=>r.total_obligation_usd)),exercisedUsd:addDecimals(rows.map(r=>r.exercised_usd)),potentialUsd:addDecimals(rows.map(r=>r.potential_usd)),outlaysKnown:rows.filter(r=>r.outlays_usd!==null).length,awardingAgencies:agencies},
          qualification:rows.map(r=>Object.fromEntries(['award_key','piid','recipient_name','recipient_uei','parent_recipient_name','parent_recipient_uei','awarding_agency','funding_agency','total_obligation_usd','exercised_usd','potential_usd','outlays_usd','signed_date','performance_start','performance_end','potential_end','source_url'].map(key=>[key,r[key]]))),
          workshareInputs:rows.map(r=>({award_key:r.award_key,recipient:r.recipient_name,description:r.description,naics:r.naics,psc:r.psc,set_aside:r.set_aside,subcontracting_plan:r.subcontracting_plan,source_url:r.source_url}))};
      });
      return {file:join(out,'research-findings.json'),sha256:sha(findings),awards:findings.totals.awards};
    });
    const focus=rows.find(r=>r.recipient_uei==='E9GWUWJTVME7')??rows[0];requireThat(focus,'SOURCE_AWARDS_REQUIRED');
    await step('analyst_workshare',async()=>{
      const previous=workspace.state().reviews.find(r=>r.award_key===focus.award_key);
      const previousBrief=await existing(join(out,'analyst-workshare.md'));
      if(previousBrief){requireThat(previous?.data?.sourceEditionId===editionId,'NATIVE_REVIEW_SOURCE_CHANGED');return {awardKey:focus.award_key,revision:previous.revision,status:previous.data.status};}
      const review=reviewFile?(await readJsonFile(reviewFile)).value:{status:'researching',fit:'The original '+focus.piid+' award places '+focus.recipient_name+' in this retained federal AI and IT cohort. The analyst can qualify scope using its description, recipient and parent identities, procurement fields and actual performance dates.',
        workshare:'Configure agreed agency and service cohorts, qualify prime identities and first-party capability sources, and prepare source-linked technical workshare briefs in the receiving workspace.',
        deliverables:'Saved source cohort; exact award detail records; retained analyst workshare; original dataset delivery; portable research dossier.',
        acceptance:'The receiving operator can reopen original award rows, inspect source and delivery pages, compare source editions and continue the original workshare record.',
        constraints:'The commercial owner supplies target agency/service scope and the accepted first-party capability references.',feeUsd:'',durationDays:'',primeContact:'',businessFitUrls:[],owner:operator,caseUrl:'',notes:'Prepared from the retained public award cohort during this operator run.',nextAction:'Review first-party prime capabilities and agree the configured delivery scope.',nextActionDate:''};
      const saved=workspace.saveReview({editionId,award_key:focus.award_key,expectedRevision:previous?.revision??0,review});
      await retain(join(out,'analyst-workshare.md'),workshareBrief(workspace,editionId,focus.award_key));return {awardKey:focus.award_key,revision:saved.revision,status:saved.data.status};
    });
    const selection=await step('selected_view',async()=>{const e=workspace.selectEdition(editionId,{awardKeys:rows.slice(0,Math.min(3,rows.length)).map(r=>r.award_key),name:workspace.edition(editionId).name+' · analyst selection'});const packet=workspace.exportEdition(e.id);await retain(join(out,'selected-edition.json'),JSON.stringify(packet,null,2)+'\n');return {editionId:e.id,coverage:packet.coverage};});
    const merchant=await step('merchant_package',async()=>{
      const prior=workspace.state().publications.find(p=>p.edition_id===editionId&&p.data.merchantId);
      if(prior)return {directory:prior.data.directory,merchantId:prior.data.merchantId,snapshot:prior.data.snapshot};
      const payment=paymentFile?(await readJsonFile(paymentFile,16384)).value:undefined;
      const prepared=await prepareMerchant(workspace,editionId,{...(payment?{payment,origin}:{}),defaultLimit:5,maxLimit:100});return {directory:prepared.directory,merchantId:prepared.merchantId,snapshot:prepared.snapshot};
    });
    const deliveryDirectory=join(out,'original-delivery');
    const delivery=await step('original_dataset_delivery',async()=>{
      const {dataset}=await loadMerchant(merchant.directory),pagesDir=join(out,'local-dataset-pages');await mkdir(pagesDir,{recursive:true,mode:0o700});
      const inputs=[];let cursor=null,index=0;
      do{
        const query={fields:COLUMNS.join(','),limit:'5',...(cursor?{cursor}:{})},context={query};
        const admission=dataset.admit(context);requireThat(admission===true,'NATIVE_DATASET_ADMISSION_FAILED');
        const response=dataset.handle(context);requireThat(response.status===200,'NATIVE_DATASET_READ_FAILED',response.body?.message);
        const bytes=Buffer.from(JSON.stringify(response.body)+'\n'),page=join(pagesDir,'page-'+index+'.json'),evidence=join(pagesDir,'page-'+index+'.source.json');
        await retain(page,bytes);
        await retainedJson(evidence,()=>({schema:VERSION+'.local-dataset-read',sourceKind:'local_dataset_read',operationId,sourceEditionId:editionId,sourceEditionSha256:workspace.edition(editionId).sha256,snapshot:merchant.snapshot,query,observedAt:now(),responseSha256:sha(bytes),responseBytes:bytes.length}));
        inputs.push({page,intent:'local-dataset-read-'+workspace.edition(editionId).sha256.slice(0,20)+'-p'+index,evidence,...(cursor?{cursor}:{})});
        cursor=response.body.page.nextCursor;index++;
      }while(cursor);
      if(!await existing(join(deliveryDirectory,'session.json')))await initDelivery(deliveryDirectory);
      let current=await scanDelivery(deliveryDirectory);
      for(let i=0;i<current.pages.length;i++)requireThat(current.pages[i].intent===inputs[i]?.intent,'NATIVE_DELIVERY_PREFIX_CHANGED');
      if(!current.finalized){if(current.pages.length<inputs.length)await appendMany(deliveryDirectory,inputs.slice(current.pages.length));await finalize(deliveryDirectory);}
      current=await scanDelivery(deliveryDirectory);requireThat(current.count===rows.length&&current.nextCursor===null,'NATIVE_DELIVERY_INCOMPLETE');
      return {directory:deliveryDirectory,sourceKind:'local_dataset_read',pages:current.pages.length,rows:current.count,snapshot:current.snapshot,chain:current.chain,originalOperationHandles:inputs.map(p=>p.intent)};
    });
    const adopted=await step('receiving_adoption',()=>adoptDelivery(receiving,delivery.directory));
    const receivedPacket=await retainedJson(join(out,'received-edition.json'),()=>receiving.exportEdition(adopted.editionId));
    requireThat(receivedPacket.buyerDelivery?.archives.length===delivery.pages,'NATIVE_RECEIVING_ARCHIVES_MISSING');
    const dossier=await openDossierStore(join(out,'dossiers'));
    await step('research_dossier',async()=>{
      let d=journal.dossierId?await dossier.get(journal.dossierId):await dossier.create({title:'Federal AI and IT award research',description:'Retained source qualification and technical workshare research from the original delivered award cohort.'});
      journal.dossierId=d.id;journal.questionIds??=[];await checkpoint();
      const questions=['Which prime recipients, parent identities, agencies, award values and performance dates appear in this delivered federal AI and IT cohort?',
        'Which retained descriptions, NAICS/PSC and procurement terms provide concrete inputs for a technical workshare and its receiving handover?'];
      const receipts=[];
      for(let q=0;q<questions.length;q++){
        d=await dossier.get(d.id);
        if(!journal.questionIds[q]){d=await dossier.addQuestion(d.id,{text:questions[q],expectedRevision:d.revision});journal.questionIds[q]=d.questions.at(-1).id;await checkpoint();}
        d=await dossier.get(d.id);
        const result=await receiveUSAspendingEdition(dossier,d.id,{workspace:receiving,editionId:adopted.editionId,questionId:journal.questionIds[q],expectedRevision:d.revision,includeReviews:false});
        receipts.push(result);
      }
      d=await dossier.get(d.id);
      const replay=await receiveUSAspendingEdition(dossier,d.id,{workspace:receiving,editionId:adopted.editionId,questionId:journal.questionIds[1],expectedRevision:d.revision,includeReviews:false});
      requireThat(replay.importedComponents===0&&replay.reusedComponents===receipts[1].componentCount,'NATIVE_QUESTION_REPLAY_CHANGED');

      // Keep the full acquisition beside the original received view. Both use
      // the maintained stores, and the portable project retains their distinct source identities.
      d=await dossier.get(d.id);
      const originalSource=await receiveUSAspendingEdition(dossier,d.id,{workspace,editionId,
        questionId:journal.questionIds[0],expectedRevision:d.revision,includeReviews:false,
        label:'Original award query and complete detail records'});
      const analysis=JSON.parse((await readFile(join(out,'research-findings.json'))).toString('utf8'));
      const runDate=journal.startedAt.slice(0,10);
      const differentAmounts=rows.filter(r=>r.total_obligation_usd!==null&&r.exercised_usd!==null&&r.total_obligation_usd!==r.exercised_usd);
      const differentParents=rows.filter(r=>r.recipient_uei&&r.parent_recipient_uei&&r.recipient_uei!==r.parent_recipient_uei);
      const elapsedPeriods=rows.filter(r=>r.performance_end&&r.performance_end.slice(0,10)<runDate);
      const absentAgencies=rows.filter(r=>!r.awarding_agency);
      const qualificationRows=[...new Map([...differentAmounts,...differentParents,...elapsedPeriods,...absentAgencies].map(r=>[r.award_key,r])).values()];
      const priorityUEIs=['YUZFZ7G7J7D3','E9GWUWJTVME7','R4G3B4GVMF79','Q4LLTZ956H64'];
      const serviceRows=rows.filter(r=>priorityUEIs.includes(r.recipient_uei));
      if(!serviceRows.length)serviceRows.push(...rows.slice(0,3));

      const findings=[
        {questionId:journal.questionIds[0],title:'Captured cohort and reported award values',selected:rows,
          text:'This original retained source collection contains '+rows.length+' unique awards. Reported total obligations sum to USD '+analysis.totals.obligationUsd+
            '; base and exercised options sum to USD '+analysis.totals.exercisedUsd+'; base and all options sum to USD '+analysis.totals.potentialUsd+
            '. These are separate source measures. '+analysis.totals.outlaysKnown+' of '+rows.length+' rows have a reported total-outlay value. Awarding-agency counts: '+
            Object.entries(analysis.totals.awardingAgencies).map(([agency,count])=>agency+' '+count).join('; ')+
            '. The retained full query and detail packet supplies the source facts; the separately retained original delivery supplies the receiving view and its exact page archives.'},
        {questionId:journal.questionIds[0],title:'Entity, amount, agency and performance-date qualification',selected:qualificationRows.length?qualificationRows:rows,
          text:'Qualification uses the original detail fields as observed in this collection. '+
            (differentAmounts.length?differentAmounts.map(r=>r.recipient_name+' / '+r.piid+': obligation USD '+r.total_obligation_usd+', exercised USD '+r.exercised_usd+', all options USD '+r.potential_usd).join('; '):'The reported obligation and exercised values match for rows containing both fields.')+'\n\n'+
            (differentParents.length?differentParents.map(r=>r.recipient_name+' / '+r.piid+': recipient UEI '+r.recipient_uei+'; separate parent UEI '+r.parent_recipient_uei).join('; '):'The returned recipient and parent UEIs match where both are reported.')+'\n\n'+
            (elapsedPeriods.length?elapsedPeriods.map(r=>r.recipient_name+' / '+r.piid+' has a reported current performance end '+r.performance_end+' before this operation date '+runDate+'; retain its separate signed and potential-end dates when assessing timing.').join('\n'):'Reported current performance-end dates have been retained for timing review.')+'\n\n'+
            (absentAgencies.length?absentAgencies.map(r=>r.recipient_name+' / '+r.piid+' has no returned awarding agency; its separately returned funding agency is '+(r.funding_agency??'unreported')+'.').join('\n'):'Each captured detail supplies an awarding agency.')+
            '\n\nThe complete raw records preserve the API total-outlay and account-outlay fields independently; missing total outlays remain unknown.'},
        {questionId:journal.questionIds[1],title:'Source-linked inputs for technical delivery workshares',selected:serviceRows,
          text:serviceRows.map(r=>r.recipient_name+' / '+r.piid+'\n'+r.description+'\nRecipient UEI '+(r.recipient_uei??'unreported')+
            '; NAICS '+(r.naics??'unreported')+'; PSC '+(r.psc??'unreported')+'; set-aside '+(r.set_aside??'unreported')+
            '; reported current performance '+(r.performance_start??'unreported')+' to '+(r.performance_end??'unreported')+'.').join('\n\n')+
            '\n\nAnalyst assessment: these retained descriptions identify concrete service areas for a proposed implementation workshare. The receiving research operator can attach first-party capability sources to the same question, select evidence, define the agreed deliverables and acceptance criteria, and retain subsequent decisions in the existing project.'},
      ];
      for(const finding of findings){
        d=await dossier.get(d.id);
        const sourceIds=finding.selected.map(row=>{
          const source=d.sources.find(item=>item.url===row.source_url&&item.citations.some(c=>c.questionId===finding.questionId));
          requireThat(source,'NATIVE_FINDING_SOURCE_MISSING',row.award_key);return source.id;
        });
        const prior=d.findings.filter(item=>item.questionId===finding.questionId&&item.title===finding.title);
        requireThat(prior.length<=1,'NATIVE_FINDING_IDENTITY_CONFLICT');
        if(prior.length){requireThat(prior[0].text===finding.text&&canonical([...prior[0].sourceIds].sort())===canonical([...sourceIds].sort()),'NATIVE_FINDING_CHANGED');continue;}
        for(const sourceId of sourceIds){
          d=await dossier.get(d.id);
          const current=d.sources.find(item=>item.id===sourceId);
          const note='Retained original award evidence for the cohort qualification and technical workshare findings.';
          if(!current.selected||current.classification!=='supports'||current.note!==note)
            d=await dossier.selectEvidence(d.id,{sourceId,selected:true,note,classification:'supports',expectedRevision:d.revision});
        }
        d=await dossier.get(d.id);
        d=await dossier.addFinding(d.id,{questionId:finding.questionId,title:finding.title,text:finding.text,sourceIds,expectedRevision:d.revision});
      }
      d=await dossier.get(d.id);
      const savedPortable=await existing(join(out,'research-dossier.json'));
      const json=savedPortable?{body:savedPortable}:await dossier.exportDossier(d.id,{format:'json'});
      const portable=JSON.parse(json.body.toString('utf8'));
      requireThat(portable.versions.at(-1)?.state.id===d.id&&portable.versions.at(-1)?.state.revision===d.revision,'NATIVE_DOSSIER_EXPORT_REVISION_CHANGED');
      const recovered=receipts.map((r,index)=>recoverUSAspendingEdition(portable,r.sourceSignature,{questionId:journal.questionIds[index]}));
      for(let index=0;index<recovered.length;index++)requireThat(recovered[index].sha256===receipts[index].firstPacketSha256,'NATIVE_PORTABLE_EDITION_CHANGED');
      const recoveredSource=recoverUSAspendingEdition(portable,originalSource.sourceSignature,{questionId:journal.questionIds[0]});
      requireThat(recoveredSource.sha256===originalSource.firstPacketSha256&&recoveredSource.details.length===originalSource.detailCount&&
        recoveredSource.sourcePages.length===originalSource.sourcePageCount,'NATIVE_PORTABLE_ORIGINAL_SOURCE_CHANGED');
      await retain(join(out,'research-dossier.json'),json.body);
      await retainedJson(join(out,'recovered-original-source.json'),()=>recoveredSource);
      for(const format of ['md','html']){
        const destination=join(out,'research-dossier.'+format);
        if(!await existing(destination)){const artifact=await dossier.exportDossier(d.id,{format});await retain(destination,artifact.body);}
      }
      const recipientStore=await openDossierStore(join(out,'reopened-dossiers')),reopened=await recipientStore.reopen(portable);
      requireThat(reopened.findings.length===d.findings.length&&reopened.questions.length===d.questions.length,'NATIVE_DOSSIER_REOPEN_CHANGED');
      return {dossierId:d.id,questionIds:journal.questionIds,receipts,replay,originalSource,findings:d.findings.map(f=>({id:f.id,questionId:f.questionId,title:f.title,sources:f.sourceIds.length})),
        portableSha256:sha(json.body),reopenedDossierId:reopened.id,sourceRows:recovered[0].rows.length,nativeArchives:recovered[0].buyerDelivery.archives.length,
        originalSourcePages:recoveredSource.sourcePages.length,originalDetails:recoveredSource.details.length};
    });
    await step('workspace_recovery',async()=>{
      const packet=await retainedJson(join(out,'award-workspace.json'),()=>workspace.exportPacket());
      restored=new AwardWorkspace(join(out,'reopened-research'),{operator});const prior=restored.state();
      if(!prior.editions.length)restored.restorePacket(packet);
      requireThat(canonical(restored.rows(editionId).map(publicRow))===canonical(rows.map(publicRow)),'NATIVE_WORKSPACE_RECOVERY_CHANGED');
      const value={editions:restored.state().editions.length,rows:restored.rows(editionId).length,backupSha256:packet.sha256};restored.close();restored=null;return value;
    });
    await step('operator_http',async()=>{
      server=await serveWorkspace(workspace,{port:0});const headers={'x-research-token':new URL(server.url).hash.slice(1)};
      const html=await fetch(server.origin+'/'),api=await fetch(server.origin+'/api/rows?edition='+encodeURIComponent(editionId),{headers}),body=await api.json();
      requireThat(html.status===200&&(await html.text()).includes('Federal Award Research')&&api.status===200&&body.total===rows.length,'NATIVE_OPERATOR_HTTP_FAILED');
      return {htmlStatus:html.status,apiStatus:api.status,rows:body.total};
    });
    journal.status='complete';journal.completedAt=now();delete journal.currentStep;await checkpoint();
    return {operationId,status:journal.status,out,sourceEdition:sourcePacket,selectedView:selection,merchant,delivery,adopted,dossier:journal.steps.research_dossier,operatorHttp:journal.steps.operator_http};
  }catch(error){journal.status='interrupted';journal.error={code:error.code??'NATIVE_OPERATION_FAILED',message:error.message,at:now()};await checkpoint();throw error;}
  finally{if(server)await server.close();else workspace.close();receiving.close();restored?.close();}
}
export async function main(args=process.argv.slice(2)){
  const options={};
  for(let i=0;i<args.length;i+=2){requireThat(['--source-collection','--out','--operation-id','--operator','--review','--payment','--origin'].includes(args[i])&&args[i+1]&&!Object.hasOwn(options,args[i]),'NATIVE_ARGUMENT_INVALID');options[args[i]]=args[i+1];}
  requireThat(options['--source-collection']&&options['--out']&&options['--operation-id'],'NATIVE_ARGUMENT_REQUIRED','Use --source-collection FILE --out PRIVATE_DIRECTORY --operation-id ORIGINAL_OPERATION_ID');
  const result=await runNative({sourceCollection:options['--source-collection'],out:options['--out'],operationId:options['--operation-id'],operator:options['--operator'],reviewFile:options['--review'],paymentFile:options['--payment'],origin:options['--origin']});process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'NATIVE_OPERATION_FAILED',message:error.message})+'\n');process.exitCode=1;});
