// MIT. Complete native programme receiving on the original selected SDK owners.
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'FLOWABLE_PROGRAMME_RECEIVING'});};
function uuid(value){const a=sha(value).slice(0,32).split('');a[12]='4';a[16]=(8+(parseInt(a[16],16)&3)).toString(16);const s=a.join('');return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20);}
const canonical=value=>JSON.stringify(value&&typeof value==='object'?(Array.isArray(value)?value.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))]))):value);
/**
 * Join an existing native receiving programme. Both clients already select their original workspace UUIDs.
 * state is the caller's retained checkpoint; retain(state) must atomically save it before returning.
 * reviewOperation is an optional read-only domain check before dispatch and for every confirmed result.
 * A failed check preserves the same saved request; it never authorizes a replacement mutation.
 * The original native owner chooses the complete source, engine scope and receiving archive path.
 */
export async function receiveFlowableProgramme({client,receiver,programmeInput,archivePath,state,retain,signal,reviewOperation}){
 need(client&&receiver&&typeof retain==='function'&&state&&typeof state==='object'&&typeof archivePath==='string','Supply the existing two client owners and original durable checkpoint.');
 need(reviewOperation===undefined||typeof reviewOperation==='function','The optional native operation review must be callable.');
 const reviewed=new Set();
 async function review(step,operation,phase){
  if(!reviewOperation)return;
  const identity=phase+'\n'+operation.id+'\n'+operation.revision+'\n'+operation.sha256;
  if(reviewed.has(identity))return;
  await reviewOperation({step,operation,phase});reviewed.add(identity);
 }
 const producer=await client.view(),destination=await receiver.view();
 need(producer.workspaceId!==destination.workspaceId,'Independent receiving needs another original workspace.');
 const identity={producer:producer.workspaceId,receiver:destination.workspaceId,programmeInputSha256:sha(canonical(programmeInput)),archivePath};
 if(state.identity)need(canonical(state.identity)===canonical(identity),'Resume the exact original source, owners and output path.');
 else{state.identity=identity;state.inputs={};state.results={};await retain(state);}
 async function frozen(label,value){
  if(Object.hasOwn(state.inputs,label))return state.inputs[label];
  state.inputs[label]=value;await retain(state);return value;
 }
 const request=(label,args)=>frozen(label,{requestId:uuid(programmeInput.requestId+'\n'+label),...args});
 async function receive(label,fn){
  signal?.throwIfAborted();if(Object.hasOwn(state.results,label))return state.results[label];
  state.phase=label;await retain(state);const result=await fn();state.results[label]=result;await retain(state);return result;
 }
 const programme=await receive('programme',()=>client.call('saveProgramme',programmeInput));
 for(;;){
  signal?.throwIfAborted();const current=await client.call('readProgramme',{id:programme.id});
  // Recheck saved confirmed outcomes on every resumed lifetime before progressing or exporting.
  if(reviewOperation)for(const saved of current.progress.rows.filter(item=>item.state==='CONFIRMED')){
   const identity='confirmed\n'+saved.record.id+'\n'+saved.record.revision+'\n'+saved.record.sha256;
   if(!reviewed.has(identity))await review(saved,await client.call('getRecord',{kind:saved.kind,id:saved.record.id}),'confirmed');
  }
  const row=current.progress.rows.find(item=>item.state!=='CONFIRMED');if(!row)break;
  need(row.waitingFor.length===0,'The original dependency needs its saved outcome: '+row.waitingFor.join(', '));
  let operation;
  if(!row.selected){
   const input=await request('prepare:'+row.key+':0',{id:programme.id,expectedRevision:current.record.revision,stepKey:row.key});
   operation=(await client.call('prepareProgrammeStep',input)).operation;
  }else if(!row.record){
   operation=(await client.call('prepareProgrammeStep',row.selected.command)).operation;
  }else operation=await client.call('getRecord',{kind:row.kind,id:row.record.id});
  if(['PREPARING','INTERRUPTED','PREPARE_FAILED'].includes(operation.value.phase)&&!operation.value.dispatchedAt){
   operation=(await client.call('prepareProgrammeStep',row.selected?.command??
    state.inputs['prepare:'+row.key+':0'])).operation;
  }
  if(operation.value.phase==='PREPARED'){
   await review(row,operation,'prepared');
   const label='dispatch:'+row.key+':'+operation.id;
   const input=await request(label,{id:operation.id,expectedRevision:operation.revision,planSha256:operation.value.planSha256});
   operation=await client.call('dispatch'+row.kind[0].toUpperCase()+row.kind.slice(1),input);
  }
  if(operation.value.dispatchedAt&&['UNKNOWN','DISPATCHED','READBACK'].includes(operation.value.state)){
   const input=await request('reconcile:'+row.key+':'+operation.id+':'+operation.revision,{kind:row.kind,id:operation.id});
   operation=await client.call('reconcileOperation',input);
  }
  state.lastOperation={step:row.key,kind:row.kind,id:operation.id,revision:operation.revision,sha256:operation.sha256,state:operation.value.state};
  await retain(state);
  need(operation.value.state==='CONFIRMED','Open the saved '+row.key+' operation in state '+operation.value.state+'. Its original native dispatch remains selected.');
 }
 const completed=await client.call('readProgramme',{id:programme.id});
 need(completed.progress.state==='COMPLETED','Complete every original native operation.');
 state.completed={record:completed.record,basisSha256:completed.basisSha256,programmeSha256:completed.programmeSha256,steps:completed.progress.total};
 await retain(state);
 const delivery=await receive('delivery',async()=>client.call('exportWorkspace',await request('delivery',{label:completed.label+' · complete native programme'})));
 need(delivery.value.state==='EXPORTED','The original complete handover must be exported.');
 const downloaded=await receive('download',()=>client.downloadDelivery({id:delivery.id,path:archivePath}));
 const inspected=await receive('inspect',async()=>receiver.inspectDeliveryFile(await request('inspect',{path:archivePath,label:completed.label+' · original programme receiving'})));
 need(inspected.value.state==='INSPECTED','Inspect the complete original source and native history.');
 const adopted=await receive('adopt',async()=>receiver.call('adoptDelivery',await request('adopt',{
  id:inspected.id,expectedRevision:inspected.revision,manifestSha256:inspected.value.manifestSha256})));
 need(adopted.value.state==='ADOPTED','Receive the complete programme through the original adopter.');
 const received=await receiver.call('readProgramme',{id:programme.id});
 need(received.progress.state==='COMPLETED'&&received.basisSha256===completed.basisSha256&&
  received.programmeSha256===completed.programmeSha256,'The independently received programme must preserve every selected native result and its complete source.');
 state.phase='COMPLETED';state.return={producer:producer.workspaceId,receiver:destination.workspaceId,programme:programme.id,
  steps:completed.progress.total,programmeSha256:completed.programmeSha256,basisSha256:completed.basisSha256,
  delivery:{id:delivery.id,revision:delivery.revision,sha256:delivery.sha256},download:downloaded,
  receiving:{id:adopted.id,revision:adopted.revision,sha256:adopted.sha256}};await retain(state);return state.return;
}
