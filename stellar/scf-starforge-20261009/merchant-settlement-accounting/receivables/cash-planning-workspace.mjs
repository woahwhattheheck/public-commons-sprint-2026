// MIT. Retained cash-plan editions share the original accounting writer and operation journal.
import {randomUUID} from 'node:crypto';
import {accountingWorkspaceBinding} from '../workspace/binding.mjs';
import {need,field,identifier,json,sha} from './core.mjs';
import {CASH_PLAN_SCHEMA,cashPlanningRows,normalizeCashPlan,projectCashPlan,cashPlanSummary,
  compareCashPlans,cashPlanFiles,cashPlanComparisonCsv} from './cash-planning.mjs';

const now=()=>new Date().toISOString();
export class CashPlanningWorkspace {
  constructor(receivables){this.receivables=receivables;this.workspace=receivables.workspace;}
  workspaceId(){return accountingWorkspaceBinding(this.workspace.directory,this.workspace.state).workspaceId;}
  guard(value){need(value?.workspaceId===this.workspaceId(),'CASH_PLAN_WORKSPACE_CHANGED',
    'Open the original accounting workspace for this retained planning request.',409);}
  row(id){
    identifier(id,'cash plan');
    const row=cashPlanningRows(this.receivables.data()).find(item=>item.id===id);
    need(row,'CASH_PLAN_NOT_FOUND','Choose an existing collection plan.',404);
    return row;
  }
  edition(row,id){
    if(id)identifier(id,'cash-plan edition');
    const edition=id?row.editions.find(item=>item.id===id):row.editions.at(-1);
    need(edition,'CASH_PLAN_EDITION_NOT_FOUND','Choose a retained plan edition.',404);
    return edition;
  }
  expected(row,value){need(value.expectedVersion===row.version,'STALE_CASH_PLAN',
    'This plan changed. Open its current edition before saving the retained assumptions.',409);}
  calculate(input){
    const plan=normalizeCashPlan(input),projection=projectCashPlan(this.receivables.data(),plan);
    const basis={workspaceId:this.workspaceId(),revision:this.workspace.state.revision,plan,projection};
    return {...basis,reviewSha256:sha(json(basis))};
  }
  result(record){
    const row=this.row(record.cashPlanId);
    return {cashPlan:cashPlanSummary(row),
      ...(record.cashPlanEditionId?{cashPlanEdition:structuredClone(this.edition(row,record.cashPlanEditionId))}:{}),
      workspaceId:this.workspaceId()};
  }
  async list(query={}){
    return this.workspace.serial(async()=>{
      need(!query.status||['ALL','ACTIVE','ARCHIVED'].includes(query.status),'INVALID_CASH_PLAN_STATUS',
        'Choose active, archived or all plans.');
      const search=String(query.search??'').trim().toLowerCase();
      const plans=cashPlanningRows(this.receivables.data()).map(cashPlanSummary)
        .filter(row=>(!query.status||query.status==='ALL'||row.status===query.status)&&
          (!search||[row.id,row.title,row.owner].some(value=>String(value).toLowerCase().includes(search))))
        .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
      return {plans,workspaceId:this.workspaceId(),revision:this.workspace.state.revision};
    });
  }
  async preview(value){
    return this.workspace.serial(async()=>{this.guard(value);return this.calculate(value.plan);});
  }
  async detail(id,query={}){
    return this.workspace.serial(async()=>{
      const row=this.row(id),edition=this.edition(row,query.editionId);
      return {cashPlan:cashPlanSummary(row),edition:structuredClone(edition),
        editions:row.editions.map(item=>({id:item.id,number:item.number,createdAt:item.createdAt,actor:item.actor,
          asOf:item.plan.asOf,through:item.plan.through,sourceRevision:item.sourceRevision,reviewSha256:item.reviewSha256})),
        history:structuredClone(row.history),workspaceId:this.workspaceId(),revision:this.workspace.state.revision};
    });
  }
  async save(value){
    this.guard(value);
    return this.receivables._mutate('cash_plan_saved',value,async(data,actor)=>{
      let row=value.id?this.row(value.id):null;
      if(row){this.expected(row,value);need(row.status==='ACTIVE','CASH_PLAN_ARCHIVED','Reopen the archived plan before saving a new edition.',409);}
      const preview=this.calculate(value.plan);
      need(value.reviewSha256===preview.reviewSha256,'CASH_PLAN_REVIEW_CHANGED',
        'The account or planning assumptions changed. Recalculate and review the complete plan before saving.',409);
      const timestamp=now();
      if(!row){
        row={schema:CASH_PLAN_SCHEMA,id:randomUUID(),version:0,status:'ACTIVE',createdAt:timestamp,updatedAt:timestamp,editions:[],history:[]};
        (data.cashPlans??=[]).push(row);
      }
      const edition={id:randomUUID(),planId:row.id,number:row.editions.length+1,createdAt:timestamp,actor,
        workspaceId:preview.workspaceId,sourceRevision:preview.revision,reviewSha256:preview.reviewSha256,
        plan:preview.plan,projection:preview.projection};
      row.editions.push(edition);row.version++;row.updatedAt=timestamp;
      row.history.push({kind:'EDITION_SAVED',at:timestamp,actor,editionId:edition.id,editionNumber:edition.number,
        note:edition.plan.note});
      return {cashPlanId:row.id,cashPlanEditionId:edition.id};
    });
  }
  async status(id,value,status){
    this.guard(value);identifier(id,'cash plan');
    need(['ACTIVE','ARCHIVED'].includes(status),'INVALID_CASH_PLAN_STATUS','Choose archive or reopen.');
    return this.receivables._mutate(status==='ARCHIVED'?'cash_plan_archived':'cash_plan_reopened',
      {...value,cashPlanId:id},async(data,actor)=>{
        const row=this.row(id);this.expected(row,value);
        need(row.status!==status,'CASH_PLAN_STATUS_CHANGED','The plan is already in this state.',409);
        const note=field(value.note,'plan status reason',1500),timestamp=now();
        row.status=status;row.version++;row.updatedAt=timestamp;
        row.history.push({kind:status==='ARCHIVED'?'ARCHIVED':'REOPENED',at:timestamp,actor,note});
        return {cashPlanId:row.id,cashPlanEditionId:row.editions.at(-1).id};
      });
  }
  async file(id,name,query={}){
    return this.workspace.serial(async()=>{
      const edition=this.edition(this.row(id),query.editionId);
      const file=cashPlanFiles(edition).find(item=>item.name===name);
      need(file,'CASH_PLAN_FILE_NOT_FOUND','Choose plan JSON, CSV, HTML or its manifest.',404);
      return file;
    });
  }
  comparison(query){
    const left=this.edition(this.row(query.leftId),query.leftEditionId);
    const right=this.edition(this.row(query.rightId),query.rightEditionId);
    return {...compareCashPlans(left,right),workspaceId:this.workspaceId(),revision:this.workspace.state.revision};
  }
  async compare(query){return this.workspace.serial(async()=>this.comparison(query));}
  async comparisonFile(name,query){
    return this.workspace.serial(async()=>{
      const comparison=this.comparison(query);
      need(['comparison.json','comparison.csv'].includes(name),'CASH_PLAN_FILE_NOT_FOUND',
        'Choose the complete comparison JSON or dated comparison CSV.',404);
      return {name,type:name.endsWith('.csv')?'text/csv; charset=utf-8':'application/json; charset=utf-8',
        bytes:Buffer.from(name.endsWith('.csv')?cashPlanComparisonCsv(comparison):json(comparison))};
    });
  }
  async operation(requestId){
    return this.workspace.serial(async()=>{
      const id=field(requestId,'request ID',160);
      const saved=this.receivables.data().requests.find(row=>row.id===id&&row.action.startsWith('cash_plan_'));
      return {workspaceId:this.workspaceId(),revision:this.workspace.state.revision,
        operation:saved?structuredClone(saved):null,...(saved?this.receivables._result(saved.result):{})};
    });
  }
}
