// MIT. Retained original pricing reports in the existing accounting workspace.
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {preparePricingReportImport,MAX_PRICING_REPORT_BYTES,MAX_ACCOUNTING_TERMS_BYTES} from '../pricing.mjs';
import {compileTerms} from '../reconcile.mjs';

export const PRICING_REQUEST_BYTES=Math.ceil(MAX_PRICING_REPORT_BYTES/3)*4+16_384;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const now=()=>new Date().toISOString();
const check=(ok,code,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code,status});};
const reviews=workspace=>workspace.state.pricingImports??[];
const label=(value,name,max=160)=>{
  check(typeof value==='string'&&value.trim().length>0&&value.trim().length<=max,'INVALID_FIELD','Check '+name+'.');
  return value.trim();
};
const parse=bytes=>JSON.parse(bytes.toString('utf8'));
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
function row(workspace,id){
  const record=reviews(workspace).find(item=>item.id===id);
  check(record,'PRICING_REVIEW_NOT_FOUND','Choose a retained pricing review.',404);return record;
}
async function read(path,max,expected){
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const info=await handle.stat();
    check(info.isFile()&&info.size>0&&info.size<=max,'INVALID_PRICING_INPUT','The retained pricing input is not a supported regular file.');
    const bytes=Buffer.alloc(info.size);let offset=0;
    while(offset<bytes.length){const result=await handle.read(bytes,offset,bytes.length-offset,offset);check(result.bytesRead>0,'PRICING_INPUT_CHANGED','The retained pricing input changed.',409);offset+=result.bytesRead;}
    const after=await handle.stat();
    check(after.size===info.size&&after.mtimeMs===info.mtimeMs&&(!expected||hash(bytes)===expected),'PRICING_INPUT_CHANGED','The retained pricing input changed. Choose its original completed version.',409);
    return bytes;
  }finally{await handle.close();}
}
async function writeNew(path,bytes){
  const handle=await open(path,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
}
async function syncDirectory(path){const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}
function originalBytes(encoded){
  check(typeof encoded==='string'&&encoded.length>0&&encoded.length<=Math.ceil(MAX_PRICING_REPORT_BYTES/3)*4&&encoded.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(encoded),
    'INVALID_PRICING_UPLOAD','Choose the original pricing report JSON up to 64 MiB.');
  const bytes=Buffer.from(encoded,'base64');
  check(bytes.length<=MAX_PRICING_REPORT_BYTES&&bytes.toString('base64')===encoded,'INVALID_PRICING_UPLOAD','The uploaded report bytes could not be read exactly.');return bytes;
}
function publicOptions(terms){
  return [...compileTerms(terms).values()].map(({price,cost,...option})=>option);
}
async function termsInput(workspace,selection){
  const record=selection==='source'?null:workspace.state.termsImports.find(item=>item.id===selection);
  check(selection==='source'||record,'TERMS_NOT_FOUND','Choose original source terms or a retained terms file.',404);
  const bytes=await read(record?join(workspace.directory,'inputs',record.id+'.terms.json'):workspace.state.sources.termsFile,MAX_ACCOUNTING_TERMS_BYTES,record?.sha256);
  const terms=parse(bytes),options=publicOptions(terms);
  return {selection,name:record?.name??'Original source terms',sha256:hash(bytes),bytes,terms,options,
    pricingReviewId:reviews(workspace).find(item=>item.termsId===selection)?.id??null};
}
export class PricingWorkspace{
  constructor(workspace){this.workspace=workspace;}
  async review({revision,name,reportBase64,accountingReference,actor}){
    const workspace=this.workspace;
    return workspace.serial(async()=>{
      workspace.expected(revision);actor=label(actor,'operator',1000);name=label(name,'pricing review name',130);
      if(accountingReference==='')accountingReference=undefined;
      const prepared=preparePricingReportImport(originalBytes(reportBase64),{accountingReference});
      const prior=reviews(workspace).find(item=>item.reportSha256===prepared.reportSha256&&item.termsSha256===prepared.termsSha256);
      if(prior){await this.file(prior.id,'report');await this.file(prior.id,'terms');return {review:structuredClone(prior),duplicate:true,state:workspace.view()};}
      check(reviews(workspace).length<2000,'PRICING_REVIEW_LIMIT','This workspace already retains 2,000 pricing reviews.');
      const id=randomUUID(),path=join(workspace.directory,'inputs',id+'.pricing-report.json');
      await writeNew(path,prepared.reportBytes);
      try{
        const terms=await workspace.retainTerms({name:name+' · accounting',bytes:prepared.termsBytes,actor});
        const record={id,name,actor,createdAt:now(),termsId:terms.id,reportSha256:prepared.reportSha256,termsSha256:prepared.termsSha256,summary:prepared.summary};
        workspace.state.pricingImports??=[];workspace.state.pricingImports.unshift(record);
        await syncDirectory(join(workspace.directory,'inputs'));
        await workspace.commit('pricing_report_reviewed',actor,{reviewId:id,termsId:terms.id,reportSha256:record.reportSha256,termsSha256:record.termsSha256});
        return {review:structuredClone(record),duplicate:false,state:workspace.view()};
      }catch(error){await rm(path,{force:true});throw error;}
    });
  }
  async detail(id){
    const workspace=this.workspace,record=structuredClone(row(workspace,id)),input=await termsInput(workspace,record.termsId);
    check(input.sha256===record.termsSha256,'PRICING_TERMS_CHANGED','The reviewed accounting terms changed.',409);
    return {review:record,selected:workspace.state.termsSelection===record.termsId,options:input.options,provenance:input.terms.pricingProvenance};
  }
  async select(id,{revision,actor}){
    const record=row(this.workspace,id);
    // The existing selector owns the CAS, action history, and future-run choice.
    await this.detail(id);
    await this.file(id,'report');
    return this.workspace.selectTerms({revision,selection:record.termsId,actor});
  }
  async compare(id,baselineSelection){
    const current=await this.detail(id),baseline=await termsInput(this.workspace,baselineSelection);
    const left=new Map(baseline.options.map(option=>[option.optionId,option]));
    const right=new Map(current.options.map(option=>[option.optionId,option]));
    const summary={added:0,removed:0,changed:0,unchanged:0},items=[];
    for(const optionId of new Set([...right.keys(),...left.keys()])){
      const before=left.get(optionId)??null,after=right.get(optionId)??null;
      const fields=before&&after?[...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>!same(before[key],after[key])):[];
      const status=!before?'added':!after?'removed':fields.length?'changed':'unchanged';summary[status]++;
      items.push({optionId,status,fields,before,after});
    }
    return {current:current.review,baseline:{selection:baseline.selection,name:baseline.name,sha256:baseline.sha256,pricingReviewId:baseline.pricingReviewId},summary,items,
      provenance:{before:baseline.terms.pricingProvenance??null,after:current.provenance}};
  }
  async file(id,name){
    const workspace=this.workspace,record=row(workspace,id);
    check(['report','terms'].includes(name),'PRICING_FILE_NOT_FOUND','Choose the original report or its reviewed accounting terms.',404);
    const report=name==='report',path=join(workspace.directory,'inputs',report?id+'.pricing-report.json':record.termsId+'.terms.json');
    const bytes=await read(path,report?MAX_PRICING_REPORT_BYTES:MAX_ACCOUNTING_TERMS_BYTES,report?record.reportSha256:record.termsSha256);
    return {bytes,name:report?'original-pricing-report-'+id+'.json':'accounting-terms-'+id+'.json'};
  }
  async capture(run,manifest,termsSha256){
    const workspace=this.workspace,record=reviews(workspace).find(item=>item.termsId===run.termsSelection);
    if(!record)return;
    check(record.termsSha256===termsSha256,'PRICING_TERMS_CHANGED','The selected terms no longer match their retained pricing review.',409);
    const file=await this.file(record.id,'report'),path='sources/pricing-report.json';
    await writeNew(join(workspace.runPath(run.id),path),file.bytes);
    manifest.files.push({source:record.name,path,bytes:file.bytes.length,sha256:record.reportSha256});
    manifest.pricing={reviewId:record.id,name:record.name,actor:record.actor,createdAt:record.createdAt,termsId:record.termsId,
      reportSha256:record.reportSha256,termsSha256:record.termsSha256,reportPath:path,summary:structuredClone(record.summary)};
  }
  async runFile(runId,name){
    const workspace=this.workspace,manifest=await workspace.inputManifest(runId);
    check(manifest.pricing,'PRICING_SOURCE_NOT_CAPTURED','This reconciliation has no original pricing-report upload in its source capture.',404);
    check(['report','terms'].includes(name),'PRICING_FILE_NOT_FOUND','Choose the original report or its reviewed accounting terms.',404);
    const report=name==='report',bytes=await read(join(workspace.runPath(runId),report?'sources/pricing-report.json':'sources/terms.json'),
      report?MAX_PRICING_REPORT_BYTES:MAX_ACCOUNTING_TERMS_BYTES,report?manifest.pricing.reportSha256:manifest.pricing.termsSha256);
    return {bytes,name:(report?'captured-pricing-report-':'captured-accounting-terms-')+runId+'.json'};
  }
}

export async function handlePricingRequest(workspace,{method,path,query,value}){
  const parts=path.split('/').filter(Boolean),pricing=workspace.pricing;
  if(path==='/api/pricing/reviews'&&method==='POST')return {value:await pricing.review(value)};
  if(parts.length>=4&&parts[0]==='api'&&parts[1]==='pricing'&&parts[2]==='reviews'){
    const id=parts[3];
    if(parts.length===4&&method==='GET')return {value:await pricing.detail(id)};
    if(parts.length===5&&parts[4]==='selection'&&method==='POST')return {value:await pricing.select(id,value)};
    if(parts.length===5&&parts[4]==='compare'&&method==='GET')return {value:await pricing.compare(id,query.baseline)};
    if(parts.length===6&&parts[4]==='download'&&method==='GET')return {file:await pricing.file(id,parts[5])};
  }
  if(parts.length===6&&parts[0]==='api'&&parts[1]==='runs'&&parts[3]==='pricing'&&parts[4]==='download'&&method==='GET')
    return {file:await pricing.runFile(parts[2],parts[5])};
  return null;
}
