#!/usr/bin/env node
// One authorized own-record native journey on the official DSpace development test site.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const options={};for(let i=2;i<process.argv.length;i+=2){if(!process.argv[i].startsWith('--')||process.argv[i+1]===undefined)throw new Error('Each option requires a value.');options[process.argv[i].slice(2)]=process.argv[i+1];}
for(const key of ['workspace','collection','destination'])if(!options[key])throw new Error('--'+key+' is required.');
const base=(options.base||'https://sandbox.dspace.org/server').replace(/\/$/,'');
if(!['https://sandbox.dspace.org/server','https://demo.dspace.org/server'].includes(base))throw new Error('This demonstration runner only accepts an official DSpace public test site.');
const directory=path.resolve(options.workspace);fs.mkdirSync(directory,{recursive:true,mode:0o700});
const runFile=path.join(directory,'native-journey.json');
const run=fs.existsSync(runFile)?JSON.parse(fs.readFileSync(runFile)): {id:'tj-dspace-'+randomUUID(),base,collection:options.collection,destination:options.destination,started_at:new Date().toISOString(),steps:[],faults:[]};
if(run.base!==base||run.collection!==options.collection||run.destination!==options.destination)throw new Error('Resume the original target and collections.');
const persist=()=>fs.writeFileSync(runFile,JSON.stringify(run,null,2)+'\n',{mode:0o600});
persist();
const nativeFetch=globalThis.fetch.bind(globalThis);let inject;
globalThis.fetch=async(input,init)=>{
 const response=await nativeFetch(input,init),url=String(input instanceof Request?input.url:input),method=String(init?.method||'GET').toUpperCase();
 if(inject&&!inject.fired&&url===inject.url&&method==='PATCH'&&response.ok){
  inject.fired=true;const bytes=Buffer.from(await response.clone().arrayBuffer());
  run.faults.push({kind:'client-gateway-response-loss-after-actual-commit',url,original_status:response.status,original_response_sha256:createHash('sha256').update(bytes).digest('hex'),at:new Date().toISOString()});persist();
  return new Response(JSON.stringify({message:'Controlled native receiving exercise: original successful PATCH response replaced after repository commit.'}),{status:502,headers:{'content-type':'application/json'}});
 }return response;
};
const {openWorkspace}=await import('../workspace.mjs');
let workspace=await openWorkspace({directory});
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
async function action(name,verb,body){
 const input={actor:'TokenJunkie Labs own-demo repository operator',operationId:run.id+'-'+name,revision:workspace.state().revision,...body};
 const result=await workspace.dispatch(verb,input);if(!run.steps.some(s=>s.name===name)){run.steps.push({name,verb,result,at:new Date().toISOString()});persist();}return result;
}
async function reviewed(name,steps,profile){
 const p=await action(name+'-plan','prepare-plan',{name:'TokenJunkie Labs demonstration: '+name,profile_id:profile,steps});
 await action(name+'-review','review-plan',{plan_id:p.plan_id,decision:'APPROVED',note:'Apply this reviewed change only to the clearly labeled original demo record created by this journey.'});
 return p;
}
const execution=result=>workspace.read('executions',result.execution_id);
const itemStep=(cap,uuid,operations)=>({tool:'dspace_update_item_metadata',source_capture_id:cap,args:{uuid,operations}});
try{
 const profile=await action('profile','save-profile',{name:'Official DSpace own-record receiving',base_url:base,auth_env:{token:'DSPACE_TOKEN',user:'DSPACE_USER',password:'DSPACE_PASSWORD'}});
 const connected=await action('connect','connect',{profile_id:profile.profile_id});
 assert(connected.authenticated&&connected.principal?.uuid,'The original native staff account must be authenticated.');
 const title='TokenJunkie Labs DSpace MCP receiving demonstration '+run.id;
 const create=await reviewed('archive-create',[{tool:'dspace_create_item',args:{owningCollectionUuid:options.collection,metadata:{'dc.title':title,'dc.description':'Clearly labeled own demonstration record for the public DSpace test site. Original operation '+run.id+'.'}}}],profile.profile_id);
 const made=await action('archive-apply','execute-plan',{plan_id:create.plan_id});assert(made.status==='APPLIED','Original archive creation must complete before continuation.');
 let saved=execution(made),uuid=saved.steps[0].observed_subject_id;run.item_uuid=uuid;persist();
 const source=await action('own-item-source','capture',{profile_id:profile.profile_id,tool:'dspace_get_item',args:{uuid},label:'Original own demonstration record'});
 const cap=workspace.read('captures',source.capture_id),item=cap.objects.find(v=>v.type==='item'&&v.uuid===uuid);assert(item,'The complete native item must be retained.');
 const values=item.metadata['dc.title'].map(v=>({...v,value:title+' — reviewed metadata'}));
 const metadata=await reviewed('metadata-correction',[itemStep(source.capture_id,uuid,[{op:'replace',path:'/metadata/dc.title',value:values}])],profile.profile_id);
 inject={url:base+'/api/core/items/'+uuid,fired:run.faults.some(f=>f.url===base+'/api/core/items/'+uuid)};
 const edited=await action('metadata-apply','execute-plan',{plan_id:metadata.plan_id});
 if(!run.steps.some(s=>s.name==='metadata-recover'))assert(edited.status==='UNCERTAIN'&&inject.fired,'The original committed PATCH must retain an uncertain response before recovery.');
 await workspace.close();workspace=await openWorkspace({directory});
 const recovered=await action('metadata-recover','recover-execution',{execution_id:edited.execution_id});assert(recovered.status==='APPLIED','Original-target metadata readback must recover the committed change.');
 const corrected=execution(recovered).steps[0];
 const text=Buffer.from('TokenJunkie Labs own DSpace repository receiving file.\nOperation: '+run.id+'\nThis is a labeled demonstration artifact.\n','utf8');
 const asset=await action('original-file','upload-asset',{name:'TokenJunkie_DSpace_Receiving.txt',media_type:'text/plain',content_b64:text.toString('base64')});
 const upload=await reviewed('original-upload',[{tool:'dspace_upload_bitstream',source_capture_id:corrected.result_capture_id,asset_id:asset.asset_id,args:{itemUuid:uuid,bundleName:'ORIGINAL',name:'TokenJunkie DSpace receiving original',mimeType:'text/plain'}}],profile.profile_id);
 const uploaded=await action('upload-apply','execute-plan',{plan_id:upload.plan_id});assert(uploaded.status==='APPLIED','The exact native uploaded bytes must be read back.');
 const fileUuid=execution(uploaded).steps[0].observed_subject_id;run.bitstream_uuid=fileUuid;persist();
 const received=await action('original-file-receiving','capture',{profile_id:profile.profile_id,tool:'dspace_get_bitstream_content',args:{bitstreamUuid:fileUuid},label:'Exact own uploaded original file'});
 const receivedAsset=workspace.read('assets',received.asset_ids[0]);assert(receivedAsset.sha256===asset.sha256,'Downloaded original bytes must match.');
 const latest=await action('move-source','capture',{profile_id:profile.profile_id,tool:'dspace_get_item',args:{uuid},label:'Original own record before collection move'});
 const move=await reviewed('collection-move',[{tool:'dspace_move_item',source_capture_id:latest.capture_id,args:{itemUuid:uuid,targetCollectionUuid:options.destination}}],profile.profile_id);
 const moved=await action('move-apply','execute-plan',{plan_id:move.plan_id});assert(moved.status==='APPLIED','The original entity-type-checked collection move must complete.');
 const inverse=await action('move-reversal-plan','prepare-reversal',{execution_id:moved.execution_id,name:'Return the own demonstration record to its original collection'});
 await action('move-reversal-review','review-plan',{plan_id:inverse.plan_id,decision:'APPROVED',note:'Return only this own demonstration record to the retained original collection.'});
 const reversed=await action('move-reversal-apply','execute-plan',{plan_id:inverse.plan_id});assert(reversed.status==='APPLIED','The reviewed collection reversal must complete.');
 const draft=await reviewed('draft-create',[{tool:'dspace_create_workspace_item',args:{owningCollectionUuid:options.collection}}],profile.profile_id);
 const drafted=await action('draft-apply','execute-plan',{plan_id:draft.plan_id});assert(drafted.status==='APPLIED','The original ordinary workspace draft must be created.');
 const draftStep=execution(drafted).steps[0],draftObject=draftStep.after_observed,draftId=Number(draftStep.observed_subject_id);
 const section=Object.keys(draftObject.sections||{}).find(k=>{const v=draftObject.sections[k];return v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).some(f=>f.startsWith('dc.'));})||Object.keys(draftObject.sections||{}).find(k=>/traditional|describe|metadata/i.test(k));
 assert(section,'Inspect the native submission configuration to select its exact metadata section.');
 const draftEdit=await reviewed('draft-native-section',[{tool:'dspace_update_workspace_item',source_capture_id:draftStep.result_capture_id,args:{id:draftId,operations:[{op:'add',path:'/sections/'+section.replace(/~/g,'~0').replace(/\//g,'~1')+'/dc.title',value:[{value:title+' — ordinary draft',language:null,authority:null,confidence:-1}]}]}}],profile.profile_id);
 const draftUpdated=await action('draft-section-apply','execute-plan',{plan_id:draftEdit.plan_id});assert(draftUpdated.status==='APPLIED','The exact native draft section must accept the reviewed metadata.');
 run.workspace_item_id=draftId;run.submission_section=section;persist();
 const handoff=await workspace.exportFile('handoff','current'),target=path.join(directory,'DSpace_Native_Receiving.sqlite');
 if(!fs.existsSync(target))fs.copyFileSync(handoff.path,target,fs.constants.COPYFILE_EXCL);fs.rmSync(handoff.path,{force:true});
 const preview=await workspace.previewFile(target),originalState=workspace.state(),restoreDirectory=path.join(directory,'received-workspace');
 const restored=await openWorkspace({directory:restoreDirectory});
 try{
  const receipt=await restored.restoreFile({actor:'TokenJunkie Labs receiving operator',operationId:run.id+'-receive',revision:restored.state().revision,filename:path.basename(target),source_sha256:preview.sha256},target);
  assert(restored.state().plans.length===originalState.plans.length&&restored.state().executions.length===originalState.executions.length,'The complete original plan/execution history must reopen.');
  assert(restored.file('assets',asset.asset_id).bytes.equals(text),'The original received upload must reopen byte-for-byte.');
  run.receiving=receipt;
 }finally{await restored.close();}
 run.status='PASS';run.finished_at=new Date().toISOString();run.original_tools=connected.tools.map(t=>t.name);run.handoff={path:target,...preview};persist();process.stdout.write(JSON.stringify({status:run.status,item_uuid:uuid,workspace_item_id:draftId,bitstream_uuid:fileUuid,source:runFile,handoff:target,sha256:preview.sha256,bytes:preview.bytes})+'\n');
}catch(error){run.status='CONTINUATION_REQUIRED';run.error={code:error.code,message:error.message};persist();throw error;}
finally{await workspace.close();}

