// MIT. Immutable recorded-activity definitions and retained closes over native runs.
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {join} from 'node:path';
import {compileAccountingPeriod} from '../reconcile.mjs';

const now=()=>new Date().toISOString();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(ok,code,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code,status});};
const label=(value,name,max=160,empty=false)=>{
  check(typeof value==='string'&&(empty||value.trim().length>0)&&value.trim().length<=max,'INVALID_FIELD','Check '+name+'.');
  return value.trim();
};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const page=query=>{
  const offset=Number(query.offset??0),limit=Number(query.limit??50);
  check(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'INVALID_PAGE','Use a nonnegative offset and up to 200 rows.');
  return {offset,limit};
};
const emptyReview=()=>({status:'open',note:'',assignee:'',actor:'',version:0,updatedAt:null});
const counts=rows=>rows.reduce((result,row)=>{result[row.review.status]++;return result;},{open:0,investigating:0,reviewed:0});

export class PeriodWorkspace{
  constructor(workspace){this.workspace=workspace;}
  view(){const state=this.workspace.state;return {definitions:state.periodDefinitions??[],selection:state.periodSelection??null,closes:state.periodCloses??[]};}
  definition(id){const record=this.workspace.state.periodDefinitions.find(item=>item.id===id);check(record,'PERIOD_NOT_FOUND','Choose a saved recorded-activity period.',404);return record;}
  selection(value=this.workspace.state.periodSelection){
    if(value===null||value===undefined)return null;
    check(value&&typeof value==='object'&&!Array.isArray(value)&&Number.isSafeInteger(value.version),'INVALID_PERIOD_SELECTION','Choose a saved period version.');
    const record=this.definition(value.id),version=record.versions.find(item=>item.version===value.version);
    check(version,'PERIOD_VERSION_NOT_FOUND','Choose an existing saved period version.',404);
    return {periodId:record.id,version:version.version,name:version.name,from:version.from,until:version.until};
  }
  async save({revision,id,expectedVersion,name,from,until,note='',select=false,actor}){
    const workspace=this.workspace;
    return workspace.serial(async()=>{
      workspace.expected(revision);actor=label(actor,'operator',1000);name=label(name,'period name');note=label(note,'period note',2000,true);
      check(typeof select==='boolean','INVALID_PERIOD_SELECTION','Choose whether to select the saved version.');
      const bounds=compileAccountingPeriod({from,until});
      let record=id?this.definition(id):null;
      if(record){
        check(expectedVersion===record.versions.at(-1).version,'STALE_PERIOD','The saved definition changed. Reload its current version before retaining your edited definition.',409);
        check(record.versions.length<1000,'PERIOD_VERSION_LIMIT','This period already retains 1,000 definitions.');
      }else{
        check(workspace.state.periodDefinitions.length<1000,'PERIOD_LIMIT','This workspace already retains 1,000 named periods.');
        record={id:randomUUID(),createdAt:now(),actor,versions:[]};workspace.state.periodDefinitions.unshift(record);
      }
      const version={version:record.versions.length+1,name,...bounds,note,actor,createdAt:now()};
      record.versions.push(version);
      if(select)workspace.state.periodSelection={id:record.id,version:version.version};
      await workspace.commit('accounting_period_saved',actor,{periodId:record.id,version:version.version,from:bounds.from,until:bounds.until,selected:select});
      return {definition:structuredClone(record),version:structuredClone(version),state:workspace.view()};
    });
  }
  async select({revision,selection,actor}){
    const workspace=this.workspace;
    return workspace.serial(async()=>{
      workspace.expected(revision);actor=label(actor,'operator',1000);
      const chosen=this.selection(selection),value=chosen?{id:chosen.periodId,version:chosen.version}:null;
      if(!same(value,workspace.state.periodSelection)){
        workspace.state.periodSelection=value;
        await workspace.commit('accounting_period_selected',actor,{selection:value});
      }
      return workspace.view();
    });
  }
  closeRow(id){const row=this.workspace.state.periodCloses.find(item=>item.id===id);check(row,'PERIOD_CLOSE_NOT_FOUND','Choose a retained period close.',404);return row;}
  async retainClose({revision,runId,name,note='',includeSources=true,actor}){
    const workspace=this.workspace;
    return workspace.serial(async()=>{
      workspace.expected(revision);actor=label(actor,'operator',1000);name=label(name,'close name');note=label(note,'close note',4000,true);
      check(typeof includeSources==='boolean','INVALID_EXPORT','Choose whether the archive includes the retained original source files.');
      const run=workspace.runRow(runId),report=await workspace.report(runId);
      check(run.period&&report.period,'PERIOD_RUN_REQUIRED','Choose a completed run captured with a saved recorded-activity period.');
      check(workspace.state.periodCloses.length<5000,'PERIOD_CLOSE_LIMIT','This workspace already retains 5,000 closes.');
      const prior=workspace.state.periodCloses.find(item=>item.period.periodId===run.period.periodId);
      const close={schema:'stellar-forge.merchant-period-close.v1',id:randomUUID(),revision:(prior?.revision??0)+1,
        previousCloseId:prior?.id??null,name,note,actor,createdAt:now(),period:structuredClone(run.period),scope:report.period};
      // The existing writer freezes the original report, sources, and reviews.
      // Open/investigating exceptions are retained, never converted or suppressed.
      const retained=await workspace.retainExport(runId,{actor,includeSources,close});
      workspace.state.periodCloses.unshift(retained.close);
      await workspace.commit('accounting_period_closed',actor,{closeId:close.id,closeRevision:close.revision,periodId:run.period.periodId,
        periodVersion:run.period.version,runId,exportId:retained.export.id,reviewCounts:retained.close.reviewCounts});
      return {...retained,state:workspace.view()};
    });
  }
  async file(id,name){
    const close=this.closeRow(id),keys={'period-close.json':'closeSha256','review-notes.json':'reviewNotesSha256'};
    const adjustment=['adjustments.json','adjustments.csv','adjustments.html'].includes(name)?close.adjustmentFiles?.[name]:null;
    const expected=adjustment?.sha256??(name==='adjustments.json'?close.adjustmentsSha256:close[keys[name]]);
    check((Object.hasOwn(keys,name)||adjustment||name==='adjustments.json')&&expected,'CLOSE_FILE_NOT_FOUND','Choose the original close metadata, frozen review notes or retained adjustments.',404);
    const path=join(this.workspace.directory,'exports',close.exportId,name),handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    let bytes;
    try{const info=await handle.stat();check(info.isFile()&&info.size>0&&info.size<=128_000_000,'CLOSE_FILE_CHANGED','The retained close file changed.',409);bytes=await handle.readFile();}
    finally{await handle.close();}
    check(hash(bytes)===expected&&(adjustment?.bytes===undefined||bytes.length===adjustment.bytes),'CLOSE_FILE_CHANGED','The retained close file changed.',409);
    return {bytes,name};
  }
  async detail(id){
    const close=structuredClone(this.closeRow(id));await this.file(id,'period-close.json');
    const snapshot=JSON.parse((await this.file(id,'review-notes.json')).bytes.toString('utf8'));
    const current=snapshot.exceptions.map(row=>({...row,review:this.workspace.state.notes[row.id]??emptyReview()}));
    return {close,run:structuredClone(this.workspace.runRow(close.runId)),reviewCounts:close.reviewCounts,currentReviewCounts:counts(current),
      changedReviews:snapshot.exceptions.filter((row,index)=>!same(row.review,current[index].review)).length,
      previousClose:close.previousCloseId?structuredClone(this.closeRow(close.previousCloseId)):null};
  }
  async notes(id,query={}){
    const {offset,limit}=page(query),snapshot=JSON.parse((await this.file(id,'review-notes.json')).bytes.toString('utf8'));
    let rows=snapshot.exceptions.map(row=>({...row,currentReview:this.workspace.state.notes[row.id]??emptyReview()}));
    if(query.status)rows=rows.filter(row=>row.review.status===query.status);
    if(query.search){const text=String(query.search).toLowerCase().slice(0,300);rows=rows.filter(row=>JSON.stringify(row).toLowerCase().includes(text));}
    return {items:rows.slice(offset,offset+limit),total:rows.length,offset,limit};
  }
}

export async function handlePeriodRequest(workspace,{method,path,query={},value}){
  const parts=path.split('/').filter(Boolean);
  if(parts[0]!=='api'||parts[1]!=='periods')return null;
  const periods=workspace.periods;
  if(parts.length===2){
    if(method==='GET')return {value:structuredClone(periods.view())};
    if(method==='POST')return {value:await periods.save(value)};
  }
  if(parts.length===3&&parts[2]==='selection'&&method==='POST')return {value:await periods.select(value)};
  if(parts.length===3&&parts[2]==='closes'&&method==='POST')return {value:await periods.retainClose(value)};
  if(parts[2]==='closes'&&parts[3]&&method==='GET'){
    if(parts.length===4)return {value:await periods.detail(parts[3])};
    if(parts.length===5&&parts[4]==='notes')return {value:await periods.notes(parts[3],query)};
    if(parts.length===5&&parts[4]==='download')return {file:await workspace.archive(periods.closeRow(parts[3]).exportId),type:'application/x-tar'};
    if(parts.length===6&&parts[4]==='download')return {file:await periods.file(parts[3],parts[5]),
      type:parts[5].endsWith('.csv')?'text/csv; charset=utf-8':parts[5].endsWith('.html')?'text/html; charset=utf-8':'application/json; charset=utf-8'};
  }
  check(false,'NOT_FOUND','This recorded-activity period operation was not found.',404);
}
