'use strict';
async function runAdoptionSourceChecks({adoption,admission,gateway,intent,checkpoint,hash,gitBlob,byteLength}){
 const assert=(ok,m)=>{if(!ok)throw Error(m);},clone=x=>JSON.parse(JSON.stringify(x));
 const digest=x=>hash(typeof x==='string'?x:JSON.stringify(x)),at=new Date().toISOString();
 const account={id:'123456',email:'synthetic@example.invalid',link_id:'synthetic-link'};
 const key=digest({provider:'gmail',profile_id:account.id,activity:'Mail sending'});
 const repo='woahwhattheheck/commons-ship-enforcer',coordinatorId='11111111-2222-4333-8444-555555555555';
 const authority={scope_id:'synthetic-original-fleet',accounts:[{account_key:key,profile_id:account.id}]};
 const state={schema:'commons.gmail-account-admission/v2',account_key:key,provider:'gmail',profile_id:account.id,
  activity:'Mail sending',revision:7,not_before:null,deadline_source:null,active:null,last_release:null,updated_at:at,
  automation:{schema:'commons.gmail-manual-headroom/v1',policy:{...admission.AUTOMATION_POLICY},activated_at:at,
   sent:{observed_at:at,start:new Date(Date.now()-86400001).toISOString(),end:at,pages:1,ids_sha256:digest([]),messages:[]},
   attempts:[],last_dispatch_at:null}};
 const input={prospect_org:'Synthetic source-only organisation',opportunity_id:'source-only-opportunity',touchpoint:'first-contact',to:'recipient@example.invalid',subject:'Synthetic fixture',body:'No real contact',link_id:account.link_id};
 const recipient=gateway.recipientClaimPath(input.to),fp=intent.fingerprint(input),lease='original-synthetic-lease';
 const inputSha=digest(input),opkey=digest({input_sha256:inputSha,lease}),files=new Map(),heads=new Map(),blobs=new Map(),calls=[];
 function file(repository,branch,path,content,commit){const blob=gitBlob(content);heads.set(repository+'\0'+branch,commit);files.set(repository+'\0'+commit+'\0'+path,{content,sha:blob,encoding:'utf-8'});return{repository,branch,path,commit_sha:commit,blob_sha:blob};}
 const accountSource=file(repo,'mailbox-admission/v1/'+key,'state/gmail-account.json',JSON.stringify(state,null,2)+'\n','a'.repeat(40));
 const recipientSource=file('woahwhattheheck/commons','main',recipient.path,JSON.stringify({schema:'synthetic-source-only-claim',recipient:input.to,lease})+'\n','b'.repeat(40));
 heads.set('woahwhattheheck/commons\0'+fp.branch,'c'.repeat(40));
 const payload=JSON.stringify({schema:'commons.connected-contact-checkpoint-payload/v1',runtime_input:input,journal:{input_sha256:inputSha,lease,events:[{synthetic:true}]},transports:[]});
 const chunk=gitBlob(payload);blobs.set(chunk,payload);
 const metadata={schema:'commons.connected-contact-checkpoint/v1',operation_key:opkey,input_sha256:inputSha,operation_lease:lease,state_key:'synthetic-state',revision:2,active:null,payload:{sha256:digest(payload),bytes:byteLength(payload),chunks:[{blob_sha:chunk,bytes:byteLength(payload),sha256:digest(payload)}]}};
 const metadataSource=file(repo,'contact-checkpoint/v1/'+opkey,'state/contact-checkpoint.json',JSON.stringify(metadata)+'\n','d'.repeat(40));
 let drift=false,driftCheckpoint=false,checkpointReads=0;
 const tools={
  mcp__codex_apps__github_get_repo:async args=>{calls.push(['get_repo',clone(args)]);return{structuredContent:{full_name:repo,private:true}};},
  mcp__codex_apps__github_fetch_commit:async args=>{calls.push(['fetch_commit',clone(args)]);const branch=args.commit_sha.replace(/^refs\/heads\//,'');if(branch.startsWith('contact-checkpoint/v1/'))checkpointReads++;const sha=(drift||driftCheckpoint&&branch.startsWith('contact-checkpoint/v1/')&&checkpointReads>1)?'e'.repeat(40):heads.get(args.repo_full_name+'\0'+branch);assert(sha,'unknown synthetic branch');return{structuredContent:{url:'https://github.com/'+args.repo_full_name+'/commit/'+sha,commit:{sha,repository_full_name:args.repo_full_name,url:'https://api.github.com/repos/'+args.repo_full_name+'/commits/'+sha,html_url:'https://github.com/'+args.repo_full_name+'/commit/'+sha}}};},
  mcp__codex_apps__github_fetch_file:async args=>{calls.push(['fetch_file',clone(args)]);const row=files.get(args.repository_full_name+'\0'+args.ref+'\0'+args.path);assert(row,'unknown synthetic file');return{structuredContent:clone(row)};},
  mcp__codex_apps__github_fetch_blob:async args=>{calls.push(['fetch_blob',clone(args)]);return{structuredContent:{content:blobs.get(args.blob_sha)}};}
 };
 let committed=null,receives=0,lose=true;
 const storage={kind:'commons.connected-contact-local-state/v1',coordinatorId,
  verify:async()=>({kind:'commons.connected-contact-local-state/v1',coordinator_id:coordinatorId,authority:clone(authority)}),
  receiveBatch:async request=>{receives++;if(committed){assert(JSON.stringify(request)===committed.request,'changed batch replay');return clone(committed.result);}
   const result={kind:'commons.connected-contact-local-state/v1',status:'ORIGINAL_STATE_RECEIVED',operation_id:request.operation_id,coordinator_id:coordinatorId,records:request.entries.map((e,i)=>{const sha256=digest(e.content);return{kind:'commons.connected-contact-local-snapshot/v1',coordinator_id:coordinatorId,namespace:e.namespace,key:e.key,revision:1,sha256,content:e.content,receipt:{schema:'commons.connected-contact-local-receipt/v1',coordinator_id:coordinatorId,namespace:e.namespace,key:e.key,revision:1,sha256,bytes:byteLength(e.content),previous_sha256:null,operation_id:request.operation_id+':'+i,action:'receive',created_at:at,origin:clone(e.origin)}};})};
   committed={request:JSON.stringify(request),result};if(lose){lose=false;throw Object.assign(Error('Synthetic lost return'),{code:'CONNECTION_ENDED'});}return clone(result);}
 };
 const journal=[],record=async e=>journal.push(clone(e)),options={tools,storage,modules:{admission,gateway,intent,checkpoint},sha256Utf8:s=>({sha256:digest(s),bytes:byteLength(s)}),classifyReturnedGmailRateLimit:()=>null,operationId:'synthetic-original-batch',accounts:[{account,source:accountSource}],contacts:[{reviewedInput:input,recipient:recipientSource,intent:{repository:'woahwhattheheck/commons',branch:fp.branch,ref_sha:'c'.repeat(40)}}],checkpoints:[{input_sha256:inputSha,lease}],ownerHandoff:{controllers_quiesced:true,recorded_at:at,recorded_by:'Synthetic source checker',reference:'source-only-check'},observedAt:at,record};
 const prepared=await adoption.prepareConnectedContactAdoption(options);
 assert(receives===0&&prepared.request.entries.length===4,'preparation is read-only and retains whole four-entry source');
 const intentValue=JSON.parse(prepared.request.entries.find(x=>x.namespace==='intent').content);
 assert(intentValue.original_reference.repository==='woahwhattheheck/commons'&&intentValue.original_reference.branch===fp.branch&&intentValue.original_reference.ref_sha==='c'.repeat(40),'original intent provenance matches actual factory shape');
 assert(prepared.request.entries[0].content===JSON.stringify(state,null,2)+'\n','account exact source bytes');
 const cp=prepared.request.entries.find(x=>x.namespace==='checkpoint'),value=JSON.parse(cp.content);
 assert(cp.origin.blob_sha===metadataSource.blob_sha&&value.payload_text===payload&&JSON.stringify(value.metadata)===JSON.stringify(metadata),'actual complete checkpoint preparer retains metadata and payload');
 let failed=false;try{await adoption.receivePreparedConnectedContactAdoption({prepared,storage,record});}catch(e){failed=e.code==='CONNECTION_ENDED';}
 assert(failed&&committed,'lost return occurred after one synthetic atomic batch');
 const received=await adoption.receivePreparedConnectedContactAdoption({prepared,storage,record});
 assert(received.status==='ORIGINAL_STATE_RECEIVED'&&receives===2,'same exact batch return is recovered');
 const companyOnly=await adoption.prepareConnectedContactAdoption({...options,operationId:'synthetic-company-only',accounts:[]});
 assert(companyOnly.request.entries.length===3&&!companyOnly.request.entries.some(e=>e.namespace==='account')&&receives===2,'company-only preparation leaves shared account adoption untouched');
 const altered=clone(prepared);altered.request.entries[0].content+=' ';let rejected=false;try{await adoption.receivePreparedConnectedContactAdoption({prepared:altered,storage,record});}catch{rejected=true;}
 assert(rejected&&receives===2,'modified frozen request rejected before receive');
 drift=true;let sourceChanged=false;try{await adoption.prepareConnectedContactAdoption(options);}catch{sourceChanged=true;}assert(sourceChanged&&receives===2,'advanced source rejected without receiving');
 drift=false;driftCheckpoint=true;checkpointReads=0;let checkpointChanged=false;try{await adoption.prepareConnectedContactAdoption(options);}catch{checkpointChanged=true;}
 assert(checkpointChanged&&checkpointReads===2&&receives===2,'checkpoint head is rechecked after complete original preparation');
 driftCheckpoint=false;let wrongRepo=false;const wrong=clone(options.contacts);wrong[0].recipient.repository='synthetic/wrong-source';try{await adoption.prepareConnectedContactAdoption({...options,contacts:wrong});}catch{wrongRepo=true;}assert(wrongRepo&&receives===2,'other-repository recipient cannot be imported');
 assert(calls.every(x=>['get_repo','fetch_commit','fetch_file','fetch_blob'].includes(x[0])),'only original read-only source bindings used');
 return{schema:'commons.connected-contact-adoption-source-checks/v1',sourceOnly:true,realProviderCalls:0,realStateMutations:0,
  proofs:['Exact account/recipient/intent source identity and complete original checkpoint metadata/payload received through the actual original modules.',
   'Preparation performs source reads only, retains four exact original entries, and supports company-only receiving without reimporting a shared account.',
   'Post-commit lost return replays the same whole receiving request and recovers one atomic result.',
   'Changed frozen bytes, advanced checkpoint/source heads and wrong original recipient repository reject before receiving; original intent provenance is retained.'],checkedAt:new Date().toISOString()};
}
module.exports={runAdoptionSourceChecks};
