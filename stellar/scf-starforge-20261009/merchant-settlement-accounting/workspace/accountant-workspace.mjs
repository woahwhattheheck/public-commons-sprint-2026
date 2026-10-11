// MIT. Accountant handoffs consume the original retained accounting workspace.
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createHandoff,importReturn,inspectHandoff,renderCsv,renderHtml,validateHandoff,validateRevision} from '../accountant/engine.mjs';
import {renderAdjustmentCsv,renderAdjustmentHtml} from '../adjustments.mjs';
import {freezeAccountantAdjustments} from '../accountant/adjustments.mjs';

export const ACCOUNTANT_CSV_BYTES=64*1024*1024;
export const ACCOUNTANT_REQUEST_BYTES=Math.ceil(ACCOUNTANT_CSV_BYTES*4/3)+500_000;
const FILE_LIMIT=256*1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const check=(ok,code,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code,status});};
const copy=value=>structuredClone(value);
const id=value=>{check(typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value),'INVALID_ACCOUNTANT_ID','Choose an existing accountant handoff or return.');return value;};
const label=(value,name,max=160)=>{check(typeof value==='string'&&value.trim().length>0&&value.trim().length<=max,'INVALID_FIELD','Check '+name+'.');return value.trim();};
const page=query=>{const offset=Number(query.offset??0),limit=Number(query.limit??50);check(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=200,'INVALID_PAGE','Choose a nonnegative offset and up to 200 records.');return {offset,limit};};
const records=workspace=>workspace.state.accountantHandoffs??[];
const bytesFromBase64=value=>{
  check(typeof value==='string'&&value.length<=Math.ceil(ACCOUNTANT_CSV_BYTES*4/3)+4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),'INVALID_RETURN_FILE','Choose a CSV file up to 64 MiB.');
  const bytes=Buffer.from(value,'base64');
  check(bytes.length>0&&bytes.length<=ACCOUNTANT_CSV_BYTES&&bytes.toString('base64')===value,'INVALID_RETURN_FILE','Choose a nonempty CSV file up to 64 MiB.');return bytes;
};
async function readExact(path,expected,{max=FILE_LIMIT}={}){
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const info=await file.stat();check(info.isFile()&&info.size<=max,'ACCOUNTANT_FILE_CHANGED','A retained handoff file is not a regular file within its supported size.',409);
    const bytes=await file.readFile();check((expected.bytes===undefined||bytes.length===expected.bytes)&&hash(bytes)===expected.sha256,'ACCOUNTANT_FILE_CHANGED','The retained handoff file changed.',409);return bytes;
  }finally{await file.close();}
}
async function privateDirectory(path,{create=false}={}){
  if(create)await mkdir(path,{mode:0o700});
  const info=await lstat(path);check(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077),'PRIVATE_DIRECTORY_REQUIRED','Use the original private accountant workspace directory.');
}
async function syncDirectory(path){const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}
async function writeFile(directory,name,bytes){
  bytes=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  const file=await open(join(directory,name),'wx',0o600);
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  return {name,bytes:bytes.length,sha256:hash(bytes)};
}
async function writePacket(directory,files,archiveNames){
  const retained=[];
  for(const [name,bytes] of Object.entries(files))retained.push(await writeFile(directory,name,bytes));
  const packetManifest={schema:'stellar-forge.accountant-packet.v1',files:retained.filter(file=>archiveNames.includes(file.name))};
  retained.push(await writeFile(directory,'packet-manifest.json',json(packetManifest)));
  const archive=await open(join(directory,'accountant-handoff.tar'),'wx',0o600);
  try{
    await new Promise((resolve,reject)=>{
      const process=spawn('tar',['-cf','-','-C',directory,'--',...archiveNames,'packet-manifest.json'],{stdio:['ignore',archive.fd,'pipe']});
      let message='';process.stderr.on('data',chunk=>{if(message.length<2000)message+=chunk;});process.once('error',reject);
      process.once('exit',code=>code===0?resolve():reject(new Error('The accountant archive could not be completed: '+message)));
    });
    await archive.sync();
  }finally{await archive.close();}
  const file=await open(join(directory,'accountant-handoff.tar'),'r');
  try{const bytes=await file.readFile();retained.push({name:'accountant-handoff.tar',bytes:bytes.length,sha256:hash(bytes)});}finally{await file.close();}
  await syncDirectory(directory);return retained;
}

export class AccountantWorkspace{
  constructor(workspace){this.workspace=workspace;}
  row(handoffId){id(handoffId);const row=records(this.workspace).find(item=>item.id===handoffId);check(row,'ACCOUNTANT_HANDOFF_NOT_FOUND','Choose a retained accountant handoff.',404);return row;}
  directory(handoffId){return join(this.workspace.directory,'accountant',id(handoffId));}
  revisionRow(row,revisionId){
    if(revisionId===null||revisionId==='initial')return null;
    const wanted=revisionId??row.revisions.at(-1)?.id;
    if(!wanted)return null;
    id(wanted);const revision=row.revisions.find(item=>item.id===wanted);check(revision,'ACCOUNTANT_RETURN_NOT_FOUND','Choose a retained accountant return.',404);return revision;
  }
  async readHandoff(handoffId){
    const record=this.row(handoffId),file=record.files.find(item=>item.name==='handoff.json');
    const handoff=JSON.parse((await readExact(join(this.directory(handoffId),'handoff.json'),file)).toString('utf8'));
    validateHandoff(handoff);check(handoff.id===record.id,'ACCOUNTANT_HANDOFF_CHANGED','The retained handoff identity changed.',409);return handoff;
  }
  async readRevision(record,handoff,revisionId){
    const revision=this.revisionRow(record,revisionId);if(!revision)return null;
    const file=revision.files.find(item=>item.name==='return.json');
    const value=JSON.parse((await readExact(join(this.directory(record.id),'returns',revision.id,'return.json'),file)).toString('utf8'));
    validateRevision(handoff,value);return value;
  }
  view(){return {revision:this.workspace.state.revision,handoffs:copy(records(this.workspace)),closes:copy(this.workspace.periods?.view().closes??[])};}
  async source({runId,closeId=null}){
    const workspace=this.workspace;let periodCloseBytes=null,reviewNotesBytes=null,periodClose=null,adjustmentsBytes=null,adjustmentFiles=null;
    if(closeId){
      check(workspace.periods,'ACCOUNTING_PERIODS_UNAVAILABLE','Open this workspace with the maintained recorded-activity periods module.');
      const close=workspace.periods.closeRow(closeId);
      check(!runId||runId===close.runId,'ACCOUNTING_CLOSE_RUN_MISMATCH','Choose the reconciliation retained by this period close.');runId=close.runId;
      periodCloseBytes=(await workspace.periods.file(closeId,'period-close.json')).bytes;
      reviewNotesBytes=(await workspace.periods.file(closeId,'review-notes.json')).bytes;
      periodClose={id:close.id,revision:close.revision,sha256:hash(periodCloseBytes)};
      if(JSON.parse(periodCloseBytes).adjustmentsSha256){
        adjustmentFiles={};
        for(const name of ['adjustments.json','adjustments.csv','adjustments.html'])
          adjustmentFiles[name]=(await workspace.periods.file(closeId,name)).bytes;
        adjustmentsBytes=adjustmentFiles['adjustments.json'];
      }
    }
    const run=copy(workspace.runRow(runId));
    const reportBytes=await workspace.reportFile(runId,'report.json'),manifestBytes=await workspace.reportFile(runId,'manifest.json');
    const inputManifestBytes=await readExact(join(workspace.runPath(runId),'input-manifest.json'),{sha256:run.inputManifestSha256},{max:16_000_000});
    if(!closeId&&workspace.adjustments){
      const snapshot=await workspace.adjustments.snapshot(runId);adjustmentsBytes=json(snapshot);
      adjustmentFiles={'adjustments.json':adjustmentsBytes,'adjustments.csv':renderAdjustmentCsv(snapshot),'adjustments.html':renderAdjustmentHtml(snapshot)};
    }
    return {run,reportBytes,manifestBytes,inputManifestBytes,periodCloseBytes,reviewNotesBytes,adjustmentsBytes,adjustmentFiles,
      source:{runId,reportSha256:run.reportSha256,manifestSha256:run.manifestSha256,inputManifestSha256:run.inputManifestSha256,
        ...(periodClose?{periodClose}:{}),...(adjustmentsBytes?{adjustmentsSha256:hash(adjustmentsBytes)}:{})}};
  }
  async prepare({runId,closeId}){
    const source=await this.source({runId,closeId});
    const report=JSON.parse(source.reportBytes.toString('utf8'));
    const adjustments=freezeAccountantAdjustments({adjustmentsBytes:source.adjustmentsBytes,report,source:source.source,
      periodCloseDocument:source.periodCloseBytes?JSON.parse(source.periodCloseBytes):undefined});
    return {run:source.run,source:source.source,period:report.period??null,totals:report.totals,options:report.options,rowCount:report.ledger.length,
      workspaceRevision:source.source.periodClose?this.workspace.state.revision:(adjustments?.source.workspaceRevision??this.workspace.state.revision),
      ...(adjustments?{adjustments:{source:adjustments.source,summary:adjustments.summary}}:{})};
  }
  async create(value){
    const workspace=this.workspace;
    return workspace.serial(async()=>{
      const handoffId=id(value.id??randomUUID()),name=label(value.name,'handoff name'),actor=label(value.actor,'operator',1000);
      const request={runId:value.runId??null,closeId:value.closeId??null,name,actor,labels:value.labels??[]},requestSha256=hash(json(request));
      const prior=records(workspace).find(item=>item.id===handoffId);
      if(prior){check(prior.requestSha256===requestSha256,'HANDOFF_REQUEST_CONFLICT','This request ID already belongs to another handoff.',409);return {record:copy(prior),duplicate:true,state:workspace.view()};}
      workspace.expected(value.revision);check(records(workspace).length<2000,'ACCOUNTANT_HANDOFF_LIMIT','This workspace already retains 2,000 accountant handoffs.');
      const selected=await this.source(request),createdAt=new Date().toISOString();
      const handoff=createHandoff({...selected,name,actor,labels:request.labels,createdAt,id:handoffId});
      const root=join(workspace.directory,'accountant');
      try{await privateDirectory(root,{create:true});}catch(error){if(error.code!=='EEXIST')throw error;await privateDirectory(root);}
      const directory=this.directory(handoffId);await privateDirectory(directory,{create:true});
      let committed=false;
      try{
        await privateDirectory(join(directory,'returns'),{create:true});
        const files={'handoff.json':json(handoff),'accountant.csv':renderCsv(handoff),'review.html':renderHtml(handoff),'original-report.json':selected.reportBytes,'original-manifest.json':selected.manifestBytes,'input-manifest.json':selected.inputManifestBytes};
        const archiveNames=['handoff.json','accountant.csv','review.html','original-report.json','original-manifest.json','input-manifest.json'];
        if(selected.periodCloseBytes){files['period-close.json']=selected.periodCloseBytes;files['review-notes.json']=selected.reviewNotesBytes;archiveNames.push('period-close.json','review-notes.json');}
        if(selected.adjustmentFiles)for(const [filename,bytes] of Object.entries(selected.adjustmentFiles)){files[filename]=bytes;archiveNames.push(filename);}
        const savedFiles=await writePacket(directory,files,archiveNames);
        const record={id:handoffId,name,actor,createdAt,requestSha256,source:handoff.source,rowCount:handoff.rows.length,summary:handoff.summary,files:savedFiles,revisions:[]};
        workspace.state.accountantHandoffs??=[];workspace.state.accountantHandoffs.unshift(record);
        await syncDirectory(root);await workspace.commit('accountant_handoff_created',actor,{handoffId,runId:handoff.source.runId,closeId:handoff.source.periodClose?.id??null,reportSha256:handoff.source.reportSha256});committed=true;
        return {record:copy(record),duplicate:false,state:workspace.view()};
      }finally{if(!committed)await rm(directory,{recursive:true,force:true});}
    });
  }
  async detail(handoffId,{revisionId}={}){
    const record=this.row(handoffId),handoff=await this.readHandoff(handoffId),revision=await this.readRevision(record,handoff,revisionId);
    const inspected=inspectHandoff(handoff,revision);
    return {record:copy(record),handoff:inspected.handoff,source:inspected.source,summary:inspected.summary,selectedRevision:revision?{id:revision.id,actor:revision.actor,name:revision.name,createdAt:revision.createdAt,summary:revision.summary,integrity:revision.integrity}:null,issues:inspected.issues??[],labels:copy(handoff.labels)};
  }
  async rows(handoffId,query={}){
    const {offset,limit}=page(query),record=this.row(handoffId),handoff=await this.readHandoff(handoffId),revision=await this.readRevision(record,handoff,query.revisionId);
    let items=inspectHandoff(handoff,revision).rows;
    if(query.status)items=items.filter(row=>row.externalStatus===query.status);
    if(query.search){const search=String(query.search).toLowerCase().slice(0,500);items=items.filter(row=>JSON.stringify(row).toLowerCase().includes(search));}
    return {items:items.slice(offset,offset+limit),total:items.length,offset,limit,revisionId:revision?.id??null};
  }
  async preview(handoffId,value){
    const record=this.row(handoffId),handoff=await this.readHandoff(handoffId),parent=await this.readRevision(record,handoff);
    check((value.expectedParentId??null)===(parent?.id??null),'STALE_ACCOUNTANT_RETURN','A newer accountant return is saved. Reload it and preview this file against the current revision.',409);
    const csvBytes=bytesFromBase64(value.csvBase64),actor=label(value.actor,'operator',1000),name=label(value.name,'return name');
    const proposed=importReturn({handoff,csvBytes,actor,name,parentRevision:parent,createdAt:value.createdAt??new Date().toISOString(),id:id(value.id??randomUUID())});
    return {revision:proposed,workspaceRevision:this.workspace.state.revision,expectedParentId:parent?.id??null};
  }
  async apply(handoffId,value){
    const workspace=this.workspace;
    return workspace.serial(async()=>{
      const record=this.row(handoffId),returnId=id(value.id),csvBytes=bytesFromBase64(value.csvBase64),name=label(value.name,'return name'),actor=label(value.actor,'operator',1000);
      const request={id:returnId,name,actor,importSha256:hash(csvBytes),parentRevisionId:value.expectedParentId??null,previewSha256:value.previewSha256},requestSha256=hash(json(request));
      const prior=record.revisions.find(item=>item.id===returnId);
      if(prior){check(prior.requestSha256===requestSha256,'ACCOUNTANT_RETURN_REQUEST_CONFLICT','This request ID already belongs to a different accountant return.',409);return {record:copy(record),savedReturn:copy(prior),duplicate:true,state:workspace.view()};}
      workspace.expected(value.revision);check(record.revisions.length<2000,'ACCOUNTANT_RETURN_LIMIT','This handoff already retains 2,000 accountant returns.');
      const preview=await this.preview(handoffId,value),result=preview.revision;
      check(typeof value.previewSha256==='string'&&value.previewSha256===result.integrity.sha256,'ACCOUNTANT_PREVIEW_CHANGED','Preview the current returned file before saving its matched changes.',409);
      const handoff=await this.readHandoff(handoffId),directory=join(this.directory(handoffId),'returns',returnId);await privateDirectory(directory,{create:true});let committed=false;
      try{
        const files={'return.json':json(result),'returned.csv':csvBytes,'accountant.csv':renderCsv(handoff,result),'review.html':renderHtml(handoff,result),'handoff.json':json(handoff)};
        for(const filename of ['original-report.json','original-manifest.json','input-manifest.json','period-close.json','review-notes.json','adjustments.json','adjustments.csv','adjustments.html']){
          const original=record.files.find(file=>file.name===filename);if(original)files[filename]=await readExact(join(this.directory(handoffId),filename),original);
        }
        const savedFiles=await writePacket(directory,files,Object.keys(files));
        const saved={id:returnId,name,actor,createdAt:result.createdAt,requestSha256,parentRevisionId:result.parentRevisionId,importSha256:result.importSha256,summary:result.summary,integrity:result.integrity,files:savedFiles};
        record.revisions.push(saved);await syncDirectory(join(this.directory(handoffId),'returns'));
        await workspace.commit('accountant_return_imported',actor,{handoffId,returnId,parentRevisionId:result.parentRevisionId,importSha256:result.importSha256,summary:result.summary});committed=true;
        return {record:copy(record),savedReturn:copy(saved),duplicate:false,state:workspace.view()};
      }finally{if(!committed)await rm(directory,{recursive:true,force:true});}
    });
  }
  async file(handoffId,name,{revisionId}={}){
    const record=this.row(handoffId);await this.readHandoff(handoffId);
    const revision=this.revisionRow(record,revisionId),files=revision?.files??record.files;
    const file=files.find(item=>item.name===name);check(file,'ACCOUNTANT_FILE_NOT_FOUND','Choose a retained accountant handoff file.',404);
    const directory=revision?join(this.directory(handoffId),'returns',revision.id):this.directory(handoffId);
    return {bytes:await readExact(join(directory,file.name),file),name:'merchant-accountant-'+(revision?.id??handoffId)+'-'+file.name,type:({csv:'text/csv; charset=utf-8',json:'application/json; charset=utf-8',html:'text/html; charset=utf-8',tar:'application/x-tar'})[file.name.split('.').at(-1)]??'application/octet-stream'};
  }
}

export async function handleAccountantRequest(accountant,{method,path,query={},value}){
  const parts=path.split('/').filter(Boolean);if(parts[0]!=='api'||parts[1]!=='accountant')return null;
  if(parts.length===2&&method==='GET')return {value:accountant.view()};
  if(path==='/api/accountant/source'&&method==='GET')return {value:await accountant.prepare(query)};
  if(path==='/api/accountant/handoffs'&&method==='POST')return {value:await accountant.create(value)};
  if(parts[2]==='handoffs'&&parts[3]){
    const handoffId=parts[3];
    if(parts.length===4&&method==='GET')return {value:await accountant.detail(handoffId,query)};
    if(parts.length===5&&parts[4]==='rows'&&method==='GET')return {value:await accountant.rows(handoffId,query)};
    if(parts.length===5&&parts[4]==='preview'&&method==='POST')return {value:await accountant.preview(handoffId,value)};
    if(parts.length===5&&parts[4]==='returns'&&method==='POST')return {value:await accountant.apply(handoffId,value)};
    if(parts.length===6&&parts[4]==='download'&&method==='GET')return {file:await accountant.file(handoffId,parts[5],query)};
  }
  check(false,'NOT_FOUND','This accountant handoff operation was not found.',404);
}
