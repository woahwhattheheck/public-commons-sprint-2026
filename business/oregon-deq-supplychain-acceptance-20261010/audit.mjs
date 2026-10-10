// MIT. Offline evidence-shape QA for a potential Oregon DEQ mapping-platform subcontract.
// Checks source-record structure only. Never retrieves, authenticates, or invents supply-chain facts.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const SCHEMA='oregon-deq.trace-evidence.v1';
export const RISK_CATEGORIES=Object.freeze([
  'labor','human_rights','environmental_justice','hazardous_substances','environmental_impacts'
]);
const STAGES=new Set(['extraction','processing','manufacturing','distribution','oregon-market']);
const CATEGORIES=new Set(RISK_CATEGORIES);
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const fail=(message)=>{throw new TypeError(message);};
const object=(x)=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const nonempty=(v)=>typeof v==='string'&&v.trim().length>0&&v.length<=256;
const timestamp=(v,label)=>{
  if(typeof v!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?Z$/.test(v)||
     !Number.isFinite(Date.parse(v)))fail(label+' must be an ISO-8601 UTC instant');
  return Date.parse(v);
};
function records(items,label,max){
  if(!Array.isArray(items)||items.length>max)fail(label+' must be array (max '+max+')');
  const ids=new Set();
  for(const row of items){
    if(!object(row)||!nonempty(row.id)||ids.has(row.id))fail(label+' contains invalid or repeated record id');
    ids.add(row.id);
  }
  return ids;
}
function evidencePresent(items,asOf,maxAgeMs){
  if(!Array.isArray(items)||items.length===0)return false;
  return items.some(record=>{
    if(!object(record)||!nonempty(record.source)||typeof record.observedAt!=='string')return false;
    let ms;
    try{ms=timestamp(record.observedAt,'evidence.observedAt');}catch{return false;}
    return ms<=asOf&&asOf-ms<=maxAgeMs;
  });
}
function reversePath(target,productId,links,nodes,documentedOnly,asOf,maxAgeMs){
  const parents=new Map();
  for(const l of links){
    if(l.productId!==productId||documentedOnly&&!evidencePresent(l.evidence,asOf,maxAgeMs))continue;
    if(!parents.has(l.to))parents.set(l.to,[]);
    parents.get(l.to).push(l);
  }
  const queue=[{at:target,nodeIds:[target],edgeIds:[]}],seen=new Set([target]);
  for(let i=0;i<queue.length;i++){
    const state=queue[i];
    if(nodes.get(state.at)?.stage==='extraction')return {nodes:state.nodeIds.reverse(),edges:state.edgeIds.reverse()};
    for(const e of parents.get(state.at)||[]){
      if(!seen.has(e.from)){
        seen.add(e.from);
        queue.push({at:e.from,nodeIds:[...state.nodeIds,e.from],edgeIds:[...state.edgeIds,e.id]});
      }
    }
  }
  return null;
}

export function auditTrace(data,{maxAgeDays=180}={}){
  if(!object(data)||data.schema!==SCHEMA)fail('Expected '+SCHEMA);
  if(!Number.isSafeInteger(maxAgeDays)||maxAgeDays<1||maxAgeDays>7300)fail('maxAgeDays 1..7300 required');
  const asOf=timestamp(data.asOf,'asOf');
  const productIds=records(data.products,'products',100);
  const nodeIds=records(data.nodes,'nodes',20000);
  records(data.links,'links',100000);
  if(!Array.isArray(data.risks)||data.risks.length>100000)fail('risks must be an array (max 100000)');
  const nodes=new Map(data.nodes.map(n=>[n.id,n]));
  for(const n of data.nodes){if(!STAGES.has(n.stage))fail('Unrecognized node stage: '+n.id);}
  for(const p of data.products){
    if(!nonempty(p.name)||!nodeIds.has(p.destinationNode)||nodes.get(p.destinationNode).stage!=='oregon-market')
      fail('Product must identify an Oregon-market destination node: '+p.id);
  }
  for(const e of data.links){
    if(!productIds.has(e.productId)||!nodeIds.has(e.from)||!nodeIds.has(e.to)||e.from===e.to)
      fail('Link has unrecognized product/endpoints or self-loop: '+e.id);
    if(!Array.isArray(e.evidence))fail('Link evidence array missing: '+e.id);
  }
  const risks=new Map();
  for(const r of data.risks){
    if(!object(r)||!nodeIds.has(r.nodeId)||!CATEGORIES.has(r.category)||
       !['risk_found','reviewed_clear','unknown'].includes(r.disposition)||!Array.isArray(r.evidence))
      fail('Risk entry lacks node/category/disposition/evidence array');
    const key=r.nodeId+'\0'+r.category;
    if(risks.has(key))fail('Duplicate node/category risk assessment: '+key.replace('\0','/'));
    risks.set(key,r);
  }
  const maxAgeMs=maxAgeDays*86400000;
  const results=[];
  for(const product of data.products){
    const documented=reversePath(product.destinationNode,product.id,data.links,nodes,true,asOf,maxAgeMs);
    const graph=documented||reversePath(product.destinationNode,product.id,data.links,nodes,false,asOf,maxAgeMs);
    const pathStatus=documented?'DOCUMENTED_PATH':graph?'UNDOCUMENTED_PATH':'NO_SOURCE_PATH';
    const missingRisk=[];
    let totalRiskCells=0,coveredRiskCells=0;
    if(graph){
      for(const nodeId of graph.nodes)for(const category of RISK_CATEGORIES){
        totalRiskCells++;
        const r=risks.get(nodeId+'\0'+category);
        if(r&&r.disposition!=='unknown'&&evidencePresent(r.evidence,asOf,maxAgeMs))coveredRiskCells++;
        else missingRisk.push({nodeId,category});
      }
    }
    results.push({productId:product.id,name:product.name,pathStatus,
      sourceToMarketNodes:graph?.nodes??[],sourceToMarketEdges:graph?.edges??[],
      riskPairsWithRecentRecords:coveredRiskCells,requiredRiskPairsOnSelectedPath:totalRiskCells,
      missingRiskRecords:missingRisk,
      acceptance:pathStatus==='DOCUMENTED_PATH'&&missingRisk.length===0?'PASS_EVIDENCE_SHAPE':'REVIEW_REQUIRED'});
  }
  const passed=results.filter(x=>x.acceptance==='PASS_EVIDENCE_SHAPE').length;
  return {schema:'oregon-deq.trace-qa.report.v1',asOf:data.asOf,maxAgeDays,
    scope:'Offline structural evidence audit, not supplier verification, chain-of-custody authentication, RFP compliance, or risk certification',
    summary:{products:data.products.length,accepted:passed,reviewRequired:results.length-passed,
      documentedPaths:results.filter(x=>x.pathStatus==='DOCUMENTED_PATH').length,
      undocumentedPaths:results.filter(x=>x.pathStatus==='UNDOCUMENTED_PATH').length,
      absentSourcePaths:results.filter(x=>x.pathStatus==='NO_SOURCE_PATH').length},
    products:results,decision:passed===results.length&&results.length>0?'PASS_EVIDENCE_SHAPE':'REVIEW_REQUIRED'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const path=process.argv[2];
  const ageArg=process.argv.find(x=>x.startsWith('--max-age-days='));
  if(!path||process.argv.some((x,i)=>i>2&&x!==ageArg)){
    process.stderr.write('Usage: node audit.mjs <prime-export.json> [--max-age-days=180]\n');
    process.exitCode=2;
  }else{
    try{
      const raw=await readFile(path);
      const data=JSON.parse(raw.toString('utf8'));
      const maxAgeDays=ageArg===undefined?180:Number(ageArg.split('=')[1]);
      const report=auditTrace(data,{maxAgeDays});
      report.inputSha256=createHash('sha256').update(raw).digest('hex');
      process.stdout.write(JSON.stringify(report,null,2)+'\n');
      if(report.decision!=='PASS_EVIDENCE_SHAPE')process.exitCode=1;
    }catch(e){process.stderr.write('INVALID_INPUT: '+String(e.message||e)+'\n');process.exitCode=2;}
  }
}
