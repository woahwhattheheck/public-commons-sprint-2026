// MIT. One continuation of the original Service adjustment receiving operation.
// The caller supplies existing buyer/accounting owners and original case store.
import {constants} from 'node:fs';
import {open,lstat,mkdir,realpath} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {parseWorkspace,workspaceDraft,serializeWorkspace} from './workspace-file.mjs';
import {retainCaseArtifact} from './case-store.mjs';
import {
  readServiceBuyerHandovers,inspectServiceBuyerWorkspace,prepareServiceBuyerIntent,
  executeServiceBuyerIntent,retainServiceBuyerMaterial,previewServiceBuyerAccountantReturn
} from './service-buyer-handover.mjs';
import {readServiceAdjustments} from './service-adjustments.mjs';
import {serviceCanonical} from './service-commitments.mjs';
import {receiveBuyerExpenseProject} from '../../../stellar-forge/mcp-merchant-operator/buyer-expense-client.mjs';

const SCHEMA='stellar-forge.service-buyer-receiving.v1';
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const same=(a,b)=>serviceCanonical(a)===serviceCanonical(b);
const fail=(message,code='SERVICE_BUYER_RECEIVING')=>Object.assign(new Error(message),{code});
const need=(v,message,code)=>{if(!v)throw fail(message,code);};
const copy=v=>structuredClone(v),decoder=new TextDecoder('utf-8',{fatal:true});
const MAX=64*1024*1024;
const uuid=(key)=>{
  const b=createHash('sha256').update(key).digest();b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
  const s=b.subarray(0,16).toString('hex');
  return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20,32);
};
function date(s){
  const parsed=typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)?new Date(s+'T00:00:00Z'):null;
  need(parsed&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===s,
    'Select an explicit operator recognition date.');return s;
}
async function privateDir(path){
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'Select the owned private receiving directory.');
  await mkdir(path,{recursive:true,mode:0o700});const st=await lstat(path);
  need(st.isDirectory()&&!st.isSymbolicLink()&&!(st.mode&0o077)&&(!process.getuid||st.uid===process.getuid()),
    'Use the original owner-private receiving directory.');return realpath(path);
}
async function readFile(path){
  const f=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{const before=await f.stat({bigint:true});
    need(before.isFile()&&before.size<=BigInt(MAX)&&!(Number(before.mode)&0o077)&&(!process.getuid||Number(before.uid)===process.getuid()),
      'Read the retained private source file.');
    const raw=await f.readFile(),after=await f.stat({bigint:true});
    need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeNs===after.mtimeNs&&
      before.ctimeNs===after.ctimeNs&&BigInt(raw.length)===after.size,'The original receiving file changed while being read.');return raw;
  }finally{await f.close();}
}
async function optional(path){try{return await readFile(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function keep(path,raw){
  const old=await optional(path);if(old){need(old.equals(raw),'An original receiving filename already retains different bytes.');return old;}
  await retainCaseArtifact(path,raw);return raw;
}
async function keepJSON(path,value){return JSON.parse(decoder.decode(await keep(path,json(value))));}
function descriptor(name,type,raw){return {name,type,bytes:raw.length,sha256:hash(raw),base64:raw.toString('base64')};}
function buffer(file){
  const raw=Buffer.from(file.base64,'base64');
  need(raw.toString('base64')===file.base64&&raw.length===file.bytes&&hash(raw)===file.sha256,'An original native file differs from its descriptor.');return raw;
}
function selectionValue(value){
  need(value&&typeof value==='object'&&['operational','development'].includes(value.dataContext),
    'Use the receiving operation\'s explicit native data context.');
  date(value.recognitionDate);
  need(value.period&&typeof value.period.name==='string'&&value.period.name.trim()&&
    value.period.from_day<=value.recognitionDate&&value.period.through_day>=value.recognitionDate,
    'The operator-selected period must include the selected recognition date.');
  date(value.period.from_day);date(value.period.through_day);
  need(value.center&&typeof value.center.code==='string'&&value.center.code&&typeof value.center.name==='string'&&value.center.name,
    'Select the original cost center or its explicit receiving code and name.');
  if(value.dispositions!==undefined)need(Array.isArray(value.dispositions),'Retain explicit native issue decisions.');
  return copy(value);
}
function parseCsv(raw){
  const text=decoder.decode(raw).replace(/^\ufeff/,'');const rows=[];let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"'){quoted=false;closed=true;}else cell+=c;continue;}
    if(c==='"'){need(cell===''&&!closed,'The native CSV has an invalid quoted field.');quoted=true;continue;}
    if(c===','){row.push(cell);cell='';closed=false;continue;}
    if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';closed=false;continue;}
    need(!closed,'The native CSV has content after a closed quoted field.');cell+=c;
  }
  need(!quoted,'The native CSV ended inside a quoted field.');
  if(cell!==''||row.length||closed){row.push(cell);rows.push(row);}
  need(rows.length>=2&&rows.every(r=>r.length===rows[0].length),'Use the complete original accountant CSV.');
  return rows;
}
function csvWithNote(original,note){
  const rows=parseCsv(original),column=rows[0].indexOf('externalNote');
  need(column>=0,'The original accountant file has no editable externalNote column.');
  const changed=rows.map((row,i)=>i?[...row.slice(0,column),note,...row.slice(column+1)]:row);
  const quote=s=>/[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;
  const raw=Buffer.from(changed.map(r=>r.map(quote).join(',')).join('\r\n')+'\r\n');
  const parsed=parseCsv(raw);
  need(parsed.every((row,i)=>row.every((cell,j)=>i>0&&j===column?cell===note:cell===rows[i][j])),
    'The source receiving edit changed a protected accountant field.');return raw;
}
function runPython(python,script,args){
  need(typeof python==='string'&&(python==='python3'||isAbsolute(python))&&!python.includes('\0'),'Select the original Python interpreter.');
  return new Promise((resolveRun,reject)=>{
    const child=spawn(python,['-B','-c',script,...args],{shell:false,stdio:['ignore','pipe','pipe'],
      env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    const stdout=[],stderr=[];let bytes=0,errors=0,overflow=false;
    child.stdout.on('data',b=>{bytes+=b.length;if(bytes<=MAX)stdout.push(b);else{overflow=true;child.kill('SIGTERM');}});
    child.stderr.on('data',b=>{errors+=b.length;if(errors<=1024*1024)stderr.push(b);});
    child.once('error',reject);
    child.once('close',(code,signal)=>{
      if(code!==0||overflow){reject(Object.assign(fail('The original received buyer source did not complete its reopen.','SERVICE_BUYER_REOPEN_FAILED'),
        {exitCode:code,signal,stderr:Buffer.concat(stderr).toString('utf8')}));return;}
      try{resolveRun(JSON.parse(decoder.decode(Buffer.concat(stdout))));}catch(e){reject(e);}
    });
  });
}
const REOPEN_PY=String.raw`
import hashlib,json,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve()
selection=json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
source=root/"app"/"sf36-spend-governor"/"expense-workspace"
if not (source/"store.py").is_file():
    raise RuntimeError("The complete project has no original native Store source")
sys.path.insert(0,str(source))
from store import Store
s=Store(root/"project",node_executable=sys.argv[3])
try:
    state=s.state()
    if state["id"]!=selection["workspaceId"] or state["revision"]!=selection["revision"]:
        raise RuntimeError("The received original buyer identity or revision changed")
    requests={ident:s.inspect_request(ident) for ident in selection["requestIds"]}
    credits={ident:s.credit(ident) for ident in selection["creditIds"]}
    packet=s.refund_packet(selection["packetId"])
    source_bytes=s.accountant_source(selection["closeId"])
    returns={ident:{"record":s.accountant_return(ident),
        "sha256":hashlib.sha256(s.accountant_original(ident)).hexdigest()}
        for ident in selection["returnIds"]}
    print(json.dumps({"state":state,"requests":requests,"credits":credits,"packet":packet,
        "sourceSha256":hashlib.sha256(source_bytes).hexdigest(),"returns":returns},ensure_ascii=True))
finally:
    s.close()
`;

/** Bind to the actual existing owners and the ordinary case read/save methods.
 * Selection fields are the operator's explicit dates/classifications, not
 * generated settlement facts. No original buyer/accounting directory is opened. */
export function createServiceBuyerReceiving({
  buyer,accounting,buyerId,accountingId,readCase,saveCase,selection,actor,
  python='python3',node=process.execPath,simulateLostBuyerReply=true
}){
  need(buyer&&accounting&&typeof buyer.withServiceBuyerWorkspace==='function'&&
    typeof accounting.withServiceAccountant==='function'&&typeof readCase==='function'&&typeof saveCase==='function',
    'Bind the original configured buyer/accounting owners and case callbacks.');
  need(typeof buyerId==='string'&&typeof accountingId==='string'&&typeof actor==='string'&&actor.trim(),
    'Use the original host aliases and named receiving operator.');
  const decisions=selectionValue(selection);
  return async function buyerReceive(input){
    need(input&&typeof input==='object'&&typeof input.caseId==='string'&&typeof input.outcomeId==='string',
      'Select the existing saved Service capture.');
    const directory=await privateDir(join(await privateDir(input.directory),'buyer-receiving'));
    const artifacts=[],steps=[];
    const key='SCF-SERVICE-ADJUSTMENT-HANDOVER-24EA-20261012/'+input.caseId+'/'+input.outcomeId+'/'+buyerId+'/'+accountingId;
    const phaseId=phase=>uuid(key+'/'+phase);
    async function writeArtifact(name,type,raw,subdirectory=directory){
      need(typeof name==='string'&&name.length>0&&name!=='.'&&name!=='..'&&!/[\/\\\0]/.test(name),
        'Retain each original artifact under its native filename.');
      need(subdirectory===directory||subdirectory.startsWith(directory+'/'),'Keep the selected receiving artifacts in their original operation.');
      const path=join(subdirectory,name);await keep(path,raw);
      const result={name,path,type,bytes:raw.length,sha256:hash(raw)};
      if(!artifacts.some(a=>a.path===path))artifacts.push(result);return result;
    }
    async function current(){
      const saved=await readCase(input.caseId),workspace=await parseWorkspace(saved.workspaceText);
      need(saved.id===input.caseId,'The original case reader returned another case.');
      const context={caseId:saved.id,caseRevision:saved.revision,workspaceSha256:hash(Buffer.from(saved.workspaceText)),
        service:workspace.service,commissioning:workspace.commissioning};
      return {saved,workspace,context,view:await readServiceBuyerHandovers(context)};
    }
    const first=await current(),native=await readServiceAdjustments(first.context),capture=native.outcomes.find(v=>v.id===input.outcomeId);
    need(capture?.action==='capture'&&capture.proposalId===input.proposalId&&same(capture.result.buyer,input.capture)&&
      same(capture.result.buyer.receipt.expected_job??null,input.expectedJob??null),'The receiving callback differs from the saved original capture.');
    const rawNative=await readFile(input.nativeFilePath);
    need(rawNative.length===capture.result.export.bytes&&hash(rawNative)===capture.result.export.sha256&&
      rawNative.toString('base64')===capture.result.buyer.files[0].base64,'The original adjustment JSON bytes changed.');
    if(input.capturePath){
      const retainedCapture=JSON.parse(decoder.decode(await readFile(input.capturePath)));
      need(same(retainedCapture,input.capture),'The retained buyer-source descriptor differs from the saved original capture.');
    }
    need(capture.result.buyer.purchase&&capture.result.buyer.credits.length>0,
      'This complete expense/credit receiving phase requires the selected original verified purchase and return. Reference-only captures remain reference-only.');
    await writeArtifact('original-merchant-adjustments.json','application/json',rawNative);
    const scope={schema:SCHEMA,caseId:input.caseId,captureId:input.outcomeId,captureSha256:capture.sha256,
      buyerId,accountingId,actor,selection:decisions};
    await keepJSON(join(directory,'receiving-selection.json'),scope);
    if(input.sourceCommit){
      need(/^[a-f0-9]{40}$/.test(input.sourceCommit),'Retain the exact original source commit.');
      await writeArtifact('source-'+input.sourceCommit+'.json','application/json',
        json({schema:SCHEMA,sourceCommit:input.sourceCommit,caseId:input.caseId,captureSha256:capture.sha256}));
    }
    const resultPath=join(directory,'service-buyer-receiving-result.json'),completedBytes=await optional(resultPath);
    if(completedBytes){
      const completed=JSON.parse(decoder.decode(completedBytes));
      need(completed.schema===SCHEMA&&completed.case.id===input.caseId&&completed.capture.id===capture.id&&
        completed.capture.sha256===capture.sha256&&completed.buyer.alias===buyerId&&completed.accountant.alias===accountingId,
        'The completed original receiving result belongs to another selection.');
      for(const artifact of completed.artifacts){
        need(typeof artifact.path==='string'&&artifact.path.startsWith(directory+'/')&&resolve(artifact.path)===artifact.path,
          'The retained result points outside this original receiving directory.');
        const raw=await readFile(artifact.path);
        need(raw.length===artifact.bytes&&hash(raw)===artifact.sha256,'A completed original receiving artifact changed.');
      }
      const state=await current(),materials=new Map([...state.view.intents,...state.view.outcomes].map(v=>[v.id,v]));
      for(const step of completed.steps){
        const intent=materials.get(step.intentId),outcome=materials.get(step.outcomeId);
        need(intent&&outcome&&outcome.intentId===intent.id&&outcome.sha256===step.sha256&&intent.capture.id===capture.id,
          'The original case no longer retains this completed receiving phase.');
      }
      // Return the immutable completed edition. Later case/buyer work is allowed
      // and must never cause this same operation to issue another native action.
      return completed;
    }
    const lostPath=join(directory,'lost-buyer-response.json');
    let lost=await optional(lostPath);
    const admittedBuyer={withServiceBuyerWorkspace:(name,callback)=>buyer.withServiceBuyerWorkspace(name,s=>callback(Object.freeze({
      workspaceId:s.workspaceId,read:p=>s.read(p),bytes:p=>s.bytes(p),
      mutate:async(path,envelope)=>{
        const result=await s.mutate(path,envelope);
        if(simulateLostBuyerReply&&!lost&&path.endsWith('/decision')&&envelope.payload?.decision==='ACCEPT'){
          lost=json({schema:SCHEMA,path,requestId:envelope.request_id,observedRevision:result.revision});
          await keep(lostPath,lost);
          throw Object.assign(new Error('The original native buyer accepted the request before this intentionally lost receiving response.'),{code:'RECEIVING_RESPONSE_LOST'});
        }
        return result;
      }
    })))};
    async function saveMaterial(material,phase){
      for(let attempt=0;attempt<8;attempt++){
        const state=await current(),prior=[...state.view.intents,...state.view.outcomes].find(v=>v.id===material.id);
        if(prior){need(same(prior,material),'The original case has different bytes for this receiving material.');return state;}
        const next=await retainServiceBuyerMaterial(state.context,{requestId:'service-buyer-'+phaseId('case-'+phase),
          expectedRevision:state.view.revision,material});
        const workspaceText=await serializeWorkspace(workspaceDraft(state.workspace,{commissioning:next.commissioning}),{now:state.workspace.savedAt});
        try{
          await saveCase({id:state.saved.id,expectedRevision:state.saved.revision,workspaceText,
            supportText:state.saved.supportText,metadata:state.saved.metadata});
        }catch(error){
          const observed=await current(),found=[...observed.view.intents,...observed.view.outcomes].find(v=>v.id===material.id);
          if(found){need(same(found,material),'The accepted original case result changed.');return observed;}
          if(!['CASE_CONFLICT','CASE_REVISION_CONFLICT','COMMISSIONING_CONFLICT'].includes(error.code))throw error;
          continue;
        }
        const observed=await current(),found=[...observed.view.intents,...observed.view.outcomes].find(v=>v.id===material.id);
        need(found&&same(found,material),'The saved original case did not reopen its exact buyer material.');return observed;
      }
      throw fail('The original case kept changing. Its accepted native buyer operation remains retained for the same-case continuation.','SERVICE_BUYER_CASE_BUSY');
    }
    async function perform(phase,action,getInput){
      let state=await current(),intent=state.view.intents.find(v=>v.id===phaseId(phase));
      if(intent)need(intent.action===action&&intent.capture.id===capture.id&&intent.buyer.alias===buyerId,
        'The original phase ID selects another buyer decision.');
      else{
        // A crash can occur after native preparation is durable but before its
        // case append. Reuse that exact prepared input and observed revision.
        const prepared=await optional(join(directory,'service-buyer',input.caseId,phaseId(phase),'prepared-intent.json'));
        const payload=prepared?JSON.parse(decoder.decode(prepared)).input:await getInput();
        intent=await prepareServiceBuyerIntent(admittedBuyer,state.context,{id:phaseId(phase),captureOutcomeId:capture.id,
          buyerWorkspace:buyerId,action,actor,input:payload},{directory,accounting});
      }
      await saveMaterial(intent,phase+'-intent');state=await current();
      let outcome=state.view.outcomes.find(v=>v.intentId===intent.id);
      if(!outcome)outcome=await executeServiceBuyerIntent(admittedBuyer,{context:state.context,intentId:intent.id,directory,accounting});
      // The exact original execution is intentionally recovered before the case
      // outcome is saved; native request IDs and accepted revisions stay fixed.
      const replay=await executeServiceBuyerIntent(admittedBuyer,{context:state.context,intentId:intent.id,directory,accounting});
      need(same(replay,outcome),'Recovery changed the complete original buyer result.');
      const saved=await saveMaterial(outcome,phase+'-outcome');
      await writeArtifact(phase+'.json','application/json',json(outcome));
      if(!steps.some(v=>v.phase===phase))steps.push({phase,intentId:intent.id,outcomeId:outcome.id,action,
        requestId:intent.request?.body?.request_id??null,revision:outcome.result.response?.revision??null,
        recordId:outcome.result.response?.result?.id??outcome.result.record?.id??outcome.result.closeId??null,
        caseRevision:saved.saved.revision,sha256:outcome.sha256});
      return outcome;
    }
    const captureResult=await perform('capture','adjustment_capture',async()=>({
      name:'Service capture '+capture.proposalId,provenance:'Original saved Service case '+input.caseId+' / capture '+capture.id+
        ' / source '+capture.result.export.sha256,dataContext:decisions.dataContext}));
    const packetId=captureResult.result.response.result.id;
    const inspect=async extra=>inspectServiceBuyerWorkspace(admittedBuyer,(await current()).context,
      {captureOutcomeId:capture.id,buyerWorkspace:buyerId,packetId,...extra});
    let view=await inspect();
    need(view.buyer.dataContext===decisions.dataContext,'The original buyer context differs from this selected receiving operation.');
    let reviewResult=null;
    const previousReview=(await current()).view.intents.find(v=>v.id===phaseId('receipt-review'));
    if(previousReview||view.packet.status==='PENDING'){
      reviewResult=await perform('receipt-review','refund_review',async()=>{
        const selected=await inspect(),matches=selected.packet.matching_purchases;
        let purchase_item_id=decisions.purchaseItemId;
        if(purchase_item_id)need(matches.some(v=>v.id===purchase_item_id),'The selected existing purchase does not match the original receipt.');
        else if(matches.length===1)purchase_item_id=matches[0].id;
        else need(matches.length===0,'Choose the matching original purchase explicitly before receiving this capture.');
        return {id:packetId,payload:{decision:'ACCEPT',operator:actor,
          reason:'Receive the retained native purchase and verified return; preserve every original adjustment status and source identity.',
          ...(purchase_item_id?{purchase_item_id}:{register_original_purchase:true})}};
      });
    }
    view=await inspect();
    need(view.packet.status==='ACCEPTED'&&view.packet.item_id,'The original buyer receipt has no accepted purchase binding.');
    const purchaseItemId=view.packet.item_id;
    let center=view.centers.find(v=>decisions.center.id?v.id===decisions.center.id:v.code===decisions.center.code);
    const centerIntent=(await current()).view.intents.find(v=>v.id===phaseId('center'));
    if(centerIntent||!center){
      const result=await perform('center','center_save',async()=>({payload:copy(decisions.center)}));
      center=(await inspect()).centers.find(v=>v.id===result.result.response.result.id);
    }
    need(center&&center.active!==false&&center.code===decisions.center.code&&center.name===decisions.center.name,
      'The selected original cost center changed from the receiving decision.');
    let period=view.periods.find(v=>decisions.period.id?v.id===decisions.period.id:
      v.name===decisions.period.name&&v.from_day===decisions.period.from_day&&v.through_day===decisions.period.through_day);
    const periodIntent=(await current()).view.intents.find(v=>v.id===phaseId('period'));
    if(periodIntent||!period){
      const result=await perform('period','period_save',async()=>({payload:copy(decisions.period)}));
      period=(await inspect()).periods.find(v=>v.id===result.result.response.result.id);
    }
    need(period&&period.from_day===decisions.period.from_day&&period.through_day===decisions.period.through_day,
      'The original period differs from the selected operator dates.');
    const periodId=period.id,priorClose=(await current()).view.intents.find(v=>v.id===phaseId('period-close'));
    if(period.state==='CLOSED'&&!priorClose){
      need(decisions.reopenReason,'An existing closed period needs the operator\'s explicit original reopen reason.');
      await perform('period-reopen','period_reopen',async()=>({id:periodId,operator:actor,reason:decisions.reopenReason}));
    }
    view=await inspect({itemId:purchaseItemId,periodId});
    const purchaseIntent=(await current()).view.intents.find(v=>v.id===phaseId('purchase-coding'));
    if(purchaseIntent||view.item.status!=='CODED'){
      await perform('purchase-coding','coding_save',async()=>{
        const selected=await inspect({itemId:purchaseItemId});
        const allocations=decisions.purchaseAllocations??[{center_id:center.id,amount:capture.result.buyer.purchase.amount,
          project:decisions.project??'',account_code:decisions.accountCode??'',memo:'Original Service receiving purchase'}];
        return {id:purchaseItemId,packetId,payload:{basis:selected.item.basis,recognition_date:decisions.recognitionDate,
          operator:actor,memo:'Original verified native purchase; values retain native atomic units.',allocations}};
      });
    }
    const creditResults=[];
    for(const original of capture.result.buyer.credits){
      view=await inspect();
      const selected=view.credits.find(c=>c.native.adjustment_id===original.adjustment_id);
      need(selected&&same(selected.native,original),'The selected native verified credit is absent or changed.');
      const phase='credit-'+uuid(original.adjustment_id),prior=(await current()).view.intents.find(v=>v.id===phaseId(phase));
      if(prior||selected.status!=='CODED'){
        await perform(phase,'credit_coding_save',async()=>{
          const detail=await inspect({creditId:selected.id,itemId:purchaseItemId}),purchase=detail.credit.purchase_item;
          const dimensions=purchase.coding?.allocations;
          need(Array.isArray(dimensions)&&dimensions.length,'Code the original purchase before its return.');
          let allocations=decisions.creditAllocations?.[original.adjustment_id];
          if(!allocations){
            need(dimensions.length===1,'Supply explicit return allocations for the multiple original purchase dimensions.');
            allocations=[{center_id:dimensions[0].center_id,amount:original.amount,
              project:dimensions[0].project??'',account_code:dimensions[0].account_code??'',
              memo:'Original verified Service return'}];
          }
          return {id:selected.id,packetId,payload:{basis:detail.credit.basis,recognition_date:decisions.recognitionDate,
            operator:actor,memo:'Retained native reverse transfer; original purchase allocation remains bound.',allocations}};
        });
      }
      const full=await inspect({creditId:selected.id});
      need(full.credit.status==='CODED'&&full.credit.coding?.id,'The original verified credit needs current retained coding before closing.');
      creditResults.push({id:selected.id,adjustmentId:original.adjustment_id,codingId:full.credit.coding.id});
    }
    for(let index=0;index<(decisions.dispositions??[]).length;index++)
      await perform('disposition-'+index,'disposition',async()=>({periodId,payload:copy(decisions.dispositions[index])}));
    const reviewed=await perform('period-review','period_review',async()=>{
      const selected=await inspect({periodId}),reportBytes=json(selected.report);
      await writeArtifact('period-before-review-'+hash(reportBytes)+'.json','application/json',reportBytes);
      need(selected.report.ready,'The original period has unresolved issues. Retain its exact report and continue its existing explicit decisions.');
      return {id:periodId,reviewer:actor,role:'Native Service buyer receiving',
        notes:'Reviewed original purchase, verified credits, exact allocations and retained merchant adjustment outcomes.'};
    });
    const reviewId=reviewed.result.response.result.id;
    const closed=await perform('period-close','period_close',async()=>({id:periodId,reviewId}));
    const closeId=closed.result.response.result.id;
    const delivery=await perform('delivery','delivery',async()=>({closeId}));
    const handoff=await perform('accountant-create','accountant_create',async()=>({
      deliveryOutcomeId:delivery.id,accountingWorkspace:accountingId,name:'Service buyer period '+periodId}));
    const handoffId=handoff.result.record.id;
    const returnedDirectory=await privateDir(join(directory,'accountant-return'));
    const returnId=phaseId('accountant-return'),returnRequestPath=join(returnedDirectory,'original-request.json');
    const nativeReturn=await accounting.withServiceAccountant(accountingId,async a=>{
      need(a.workspaceId===handoff.result.accountant.workspaceId&&a.sourcesSha256===handoff.result.accountant.sourcesSha256,
        'The original accountant alias changed before the same handback.');
      const initial=await a.accountant.file(handoffId,'accountant.csv',{revisionId:'initial'});
      const originalCsv=Buffer.from(initial.bytes),note=decisions.accountantNote??
        'Service receiving retained the original expense and credit source. This operation does not claim external ledger posting.';
      const csv=csvWithNote(originalCsv,note);
      await writeArtifact('original-accountant.csv','text/csv',originalCsv,returnedDirectory);
      await writeArtifact('returned-accountant.csv','text/csv',csv,returnedDirectory);
      let detail=await a.accountant.detail(handoffId),record=detail.record;
      let saved=record.revisions.find(v=>v.id===returnId);
      if(!saved){
        let requestBytes=await optional(returnRequestPath),request;
        if(requestBytes)request=JSON.parse(decoder.decode(requestBytes));
        else{
          need(record.revisions.length===0,'Continue the actual existing accountant return history before adding this receiving note.');
          const chosen={id:returnId,name:'Service source receiving note',actor,csvBase64:csv.toString('base64'),
            expectedParentId:null,createdAt:new Date().toISOString()};
          const preview=await a.accountant.preview(handoffId,chosen);
          request={...chosen,revision:preview.workspaceRevision,previewSha256:preview.revision.integrity.sha256};
          await keepJSON(returnRequestPath,request);
        }
        need(request.id===returnId&&request.csvBase64===csv.toString('base64'),'The original accountant return request differs.');
        await a.accountant.apply(handoffId,copy(request));
        const replay=await a.accountant.apply(handoffId,copy(request));
        need(replay.savedReturn.id===returnId&&replay.savedReturn.importSha256===hash(csv),
          'The original accountant return replay changed its saved identity.');
        detail=await a.accountant.detail(handoffId,{revisionId:returnId});record=detail.record;
        saved=record.revisions.find(v=>v.id===returnId);
      }
      need(saved&&saved.importSha256===hash(csv),'The original accountant return ID names another submitted file.');
      const files=[];
      for(const selected of saved.files){
        const file=await a.accountant.file(handoffId,selected.name,{revisionId:returnId}),raw=Buffer.from(file.bytes);
        need(raw.length===selected.bytes&&hash(raw)===selected.sha256,'A saved original accountant handback file changed.');
        await writeArtifact(selected.name,file.type,raw,returnedDirectory);files.push(descriptor(selected.name,file.type,raw));
      }
      const packet=files.find(v=>v.name==='buyer-return.json');
      need(packet,'The original accountant return has no native buyer-return packet.');
      return {record:copy(saved),packet,files:files.map(({base64,...v})=>v)};
    });
    const acceptedReturn=await perform('accountant-return-save','accountant_return_save',async()=>{
      const preview=await previewServiceBuyerAccountantReturn(admittedBuyer,(await current()).context,{
        captureOutcomeId:capture.id,buyerWorkspace:buyerId,closeId,file:nativeReturn.packet});
      need(preview.preview.other_handoffs.length===0,
        'Another original accountant handoff overlaps these issued rows. Continue its explicit supersession decision in the buyer workspace.');
      return {closeId,file:nativeReturn.packet,previewSha256:preview.preview.preview_sha256,operator:actor,
        name:'Received native Service accountant note',reason:'Retain the accountant source review without changing issued amounts.',
        supersedes:[]};
    });
    const buyerReturnId=acceptedReturn.result.response.result.id;
    const originalReturn=await buyer.withServiceBuyerWorkspace(buyerId,s=>s.bytes('/api/accountant-returns/'+buyerReturnId+'/original'));
    need(Buffer.from(originalReturn).equals(buffer(nativeReturn.packet)),'The buyer did not retain the exact original accountant packet.');
    await writeArtifact('accepted-buyer-return.json','application/json',Buffer.from(originalReturn));
    const complete=await perform('complete-delivery','delivery',async()=>({closeId}));
    for(const [prefix,outcome]of [['issued',delivery],['complete',complete],['accountant',handoff]]){
      const where=await privateDir(join(directory,prefix));
      for(const file of outcome.result.files)await writeArtifact(file.name,file.type,buffer(file),where);
    }
    const final=await current();
    const expectedRequests={};
    const ownIntentIds=new Set(steps.map(v=>v.intentId));
    for(const intent of final.view.intents.filter(v=>ownIntentIds.has(v.id)&&v.request?.body?.request_id)){
      const outcome=final.view.outcomes.find(v=>v.intentId===intent.id);
      need(outcome&&outcome.result.response.revision<=complete.result.revision,
        'The original receiving request does not belong to this selected complete-project revision.');
      expectedRequests[intent.request.body.request_id]=outcome.result;
    }
    const project=complete.result.files.find(v=>v.name==='buyer-expense-complete-project.zip');
    const projectPath=join(directory,'complete',project.name),receiveDirectory=join(directory,'received-buyer-project');
    const receiveReceiptPath=join(directory,'buyer-native-receive.json'),priorReceive=await optional(receiveReceiptPath);
    const received=priorReceive?JSON.parse(decoder.decode(priorReceive)):
      await receiveBuyerExpenseProject({archive:projectPath,directory:receiveDirectory,expectedSha256:project.sha256,python});
    need(received.state==='RECEIVED'&&received.archive_sha256===project.sha256,
      'The original receiving receipt does not identify this complete project.');
    await keepJSON(receiveReceiptPath,received);
    const reopenSelection={workspaceId:complete.buyer.workspaceId,revision:complete.result.revision,
      requestIds:Object.keys(expectedRequests),creditIds:creditResults.map(v=>v.id),packetId,closeId,returnIds:[buyerReturnId]};
    const reopenInputPath=join(directory,'buyer-reopen-selection.json');await keepJSON(reopenInputPath,reopenSelection);
    const reopened=await runPython(python,REOPEN_PY,[receiveDirectory,reopenInputPath,node]);
    need(same(reopened.requests,expectedRequests)&&reopened.packet.manifest_sha256===capture.result.buyer.manifest_sha256&&
      reopened.sourceSha256===complete.result.files.find(v=>v.name==='issued-buyer-accountant-source.json').sha256&&
      reopened.returns[buyerReturnId]?.sha256===nativeReturn.packet.sha256,
      'The original received buyer source, requests, receipt or accountant return changed.');
    for(const selected of creditResults){
      const retained=reopened.credits[selected.id],original=capture.result.buyer.credits.find(v=>v.adjustment_id===selected.adjustmentId);
      need(retained&&same(retained.native,original)&&retained.item_id===purchaseItemId&&
        retained.coding_history.some(v=>v.id===selected.codingId),
        'The complete original credit, purchase or selected coding history changed after native receiving.');
    }
    // The buyer can continue after export. Compare the received immutable edition
    // with its selected revision, rather than requiring the live workspace to stop.
    need(reopened.state.id===complete.buyer.workspaceId&&reopened.state.revision===complete.result.revision,
      'The received original buyer identity or selected revision changed.');
    await writeArtifact('buyer-native-reopen.json','application/json',json(reopened));
    await writeArtifact('buyer-native-receive.json','application/json',json(received));
    if(lost)await writeArtifact('lost-buyer-response.json','application/json',lost);
    const reopenedCase=await current();
    const retainedMaterials=new Map([...reopenedCase.view.intents,...reopenedCase.view.outcomes].map(v=>[v.id,v]));
    need([...final.view.intents,...final.view.outcomes].every(v=>retainedMaterials.has(v.id)&&same(retainedMaterials.get(v.id),v)),
      'The original Service case lost an accepted buyer material while receiving.');
    const result={schema:SCHEMA,case:{id:reopenedCase.saved.id,revision:reopenedCase.saved.revision,workspaceSha256:reopenedCase.context.workspaceSha256},
      capture:{id:capture.id,sha256:capture.sha256,sourceSha256:capture.result.export.sha256,
        eventId:capture.result.buyer.source_identity.event_id,manifestSha256:capture.result.buyer.manifest_sha256},
      buyer:{alias:buyerId,workspaceId:reopened.state.id,revision:reopened.state.revision},packetId,purchaseItemId,credits:creditResults,
      period:{id:periodId,closeId,reviewId},accountant:{alias:accountingId,workspaceId:handoff.result.accountant.workspaceId,
        handoffId,returnId,buyerReturnId},steps,artifacts,received:{directory:receiveDirectory,result:received},
      originalAdjustmentStatuses:copy(capture.result.buyer.adjustments)};
    await keepJSON(resultPath,result);
    return result;
  };
}
