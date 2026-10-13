/* Reproducible analyst preference model. No random draws or scientific model runs. */
export const FIELDS=['developed_gross_gain_ha','forest_gross_loss_ha','wetlands_gross_loss_ha'];
export const DEFAULT={scope:'all',basis:'absolute',weights:[1,1,1],topK:10,evidence:'all',query:'',onlyQueued:false};
export const STATUSES=['Unreviewed','Desktop review','Field follow-up','Keep in context','Defer'];
export function metric(row,field,basis){
 const v=Number(row[field]);
 if(!Number.isFinite(v)||v<0)throw Error('Invalid source metric '+row.huc12+' '+field);
 if(basis==='rate') {if(!(row.area_ha>0))throw Error('Invalid area');return v/row.area_ha*1000;}
 return v;
}
export function scores(rows,basis='absolute'){
 // Zero means no selected gross change. Positive midranks use the full 217-member reference.
 const out=new Map(rows.map(r=>[r.huc12,[]]));
 for(const f of FIELDS){
  const vals=rows.map(r=>({id:r.huc12,v:metric(r,f,basis)})).sort((a,b)=>a.v-b.v||a.id.localeCompare(b.id));
  for(let i=0;i<vals.length;){let j=i+1;while(j<vals.length&&vals[j].v===vals[i].v)j++;
   const pct=vals[i].v===0?0:100*((i+j-1)/2)/(Math.max(1,vals.length-1));
   for(let k=i;k<j;k++)out.get(vals[k].id).push(pct);i=j;
  }
 }
 return out;
}
export function eligible(rows,state,scopes,notes={}){
 const ids=state.scope==='all'?null:new Set(scopes[state.scope]?.ids||[]);
 const q=(state.query||'').toLowerCase().trim();
 return rows.filter(r=>(!ids||ids.has(r.huc12))&&(!q||[r.huc12,r.name,r.states,...r.draft2026_assessment_station_ids,...r.local_gauge_ids].join(' ').toLowerCase().includes(q))&&
 (!state.onlyQueued||notes[r.huc12]?.queued)&&
 (state.evidence==='all'||state.evidence==='flow'&&r.local_observed_flow_gauge_count>0||state.evidence==='assessment'&&r.draft2026_assessment_station_count>0||state.evidence==='both'&&r.local_observed_flow_gauge_count>0&&r.draft2026_assessment_station_count>0||state.evidence==='neither'&&r.local_observed_flow_gauge_count===0&&r.draft2026_assessment_station_count===0));
}
export function rank(rows,scoreMap,weights){
 const w=weights.map(Number);if(w.length!==3||w.some(x=>!Number.isFinite(x)||x<0)||w.reduce((a,b)=>a+b,0)<=0)throw Error('Set at least one positive weight.');
 const total=w.reduce((a,b)=>a+b,0);
 const result=rows.map(r=>({id:r.huc12,score:scoreMap.get(r.huc12).reduce((a,p,i)=>a+p*w[i]/total,0),components:scoreMap.get(r.huc12)})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
 let first=1;for(let i=0;i<result.length;i++){if(i===0||Math.abs(result[i].score-result[i-1].score)>1e-10)first=i+1;result[i].rank=first;result[i].order=i+1;}
 return result;
}
export function sensitivity(rows,scoreMap,topK=10){
 const acc=new Map(rows.map(r=>[r.huc12,{id:r.huc12,minRank:Infinity,maxRank:0,rankSum:0,topCount:0,scenarios:0}]));
 const scenarios=[];
 for(let a=0;a<=10;a++)for(let b=0;b<=10-a;b++){
  const weights=[a,b,10-a-b],result=rank(rows,scoreMap,weights);scenarios.push(weights);
  for(const r of result){const x=acc.get(r.id);x.minRank=Math.min(x.minRank,r.rank);x.maxRank=Math.max(x.maxRank,r.rank);x.rankSum+=r.rank;x.scenarios++;if(r.rank<=topK)x.topCount++;}
 }
 for(const x of acc.values()){x.meanRank=x.rankSum/x.scenarios;x.topShare=x.topCount/x.scenarios;delete x.rankSum;}
 return {grid:scenarios,results:[...acc.values()]};
}
export function pareto(rows,scoreMap){
 // Nondominated within the selected view, using original metric midranks.
 const front=new Set();
 for(const r of rows){const x=scoreMap.get(r.huc12);let dominated=false;
  for(const s of rows){if(s===r)continue;const y=scoreMap.get(s.huc12);if(y.every((v,i)=>v>=x[i])&&y.some((v,i)=>v>x[i])){dominated=true;break;}}
  if(!dominated)front.add(r.huc12);
 }
 return front;
}
export function view(data,state,notes={}){
 const selected=eligible(data.rows,state,data.scopes,notes),s=scores(data.rows,state.basis),ranked=rank(selected,s,state.weights),sensitivityResult=sensitivity(selected,s,state.topK),front=pareto(selected,s);
 const sm=new Map(sensitivityResult.results.map(r=>[r.id,r]));
 return {rows:ranked.map(r=>({...r,...sm.get(r.id),pareto:front.has(r.id)})),scenarios:sensitivityResult.grid,population:selected.length};
}
export function csv(records){
 if(!records.length)return '';
 const keys=Object.keys(records[0]),escape=v=>{let t=Array.isArray(v)||v&&typeof v==='object'?JSON.stringify(v):String(v??'');if(/^[=+@\-\t\r]/.test(t)&&typeof v==='string')t="'"+t;return /[",\r\n]/.test(t)?'"'+t.replaceAll('"','""')+'"':t;};
 return [keys.map(escape).join(','),...records.map(r=>keys.map(k=>escape(r[k])).join(','))].join('\r\n')+'\r\n';
}
export function exportRows(data,state,notes={}){
 const by=new Map(data.rows.map(r=>[r.huc12,r]));
 return view(data,state,notes).rows.map(v=>{const r=by.get(v.id),n=notes[v.id]||{};return {huc12:r.huc12,name:r.name,states:r.states,view_scope:state.scope,basis:state.basis,developed_weight:state.weights[0],forest_weight:state.weights[1],wetland_weight:state.weights[2],preference_score:v.score,rank:v.rank,best_grid_rank:v.minRank,worst_grid_rank:v.maxRank,top_k:state.topK,top_k_weight_choices:v.topCount,total_weight_choices:v.scenarios,nondominated:v.pareto,area_ha:r.area_ha,developed_gross_gain_ha:r.developed_gross_gain_ha,forest_gross_loss_ha:r.forest_gross_loss_ha,forest_gross_gain_ha:r.forest_gross_gain_ha,wetlands_gross_loss_ha:r.wetlands_gross_loss_ha,changed_class_percent:r.changed_class_percent,assessment_station_ids:r.draft2026_assessment_station_ids,flow_gauge_ids:r.local_observed_flow_gauge_ids,queued:!!n.queued,status:n.status||'Unreviewed',reviewer:n.reviewer||'',planned_question:n.question||'',notes:n.notes||'',reviewed_at:n.updated_at||'',source_edition:data.edition};});
}
export function restoreProject(value,data){
 if(!value||value.schema!=='upstate.watershed-review/v1')throw Error('This is not a watershed review project.');
 if(value.source_edition!==data.edition)throw Error('This project belongs to a different source edition. Keep both original editions and use the matching desk.');
 const s={...DEFAULT,...value.settings};
 if(!Object.hasOwn(data.scopes,s.scope)||!['absolute','rate'].includes(s.basis)||!['all','flow','assessment','both','neither'].includes(s.evidence))throw Error('Unknown saved selection.');
 if(!Number.isInteger(s.topK)||s.topK<1||s.topK>217||typeof s.query!=='string'||s.query.length>1000||typeof s.onlyQueued!=='boolean')throw Error('Invalid saved controls.');
 rank([],new Map(),s.weights);
 const known=new Set(data.rows.map(r=>r.huc12)),notes={};
 if(!value.notes||typeof value.notes!=='object'||Array.isArray(value.notes))throw Error('Invalid saved review records.');
 for(const [id,n] of Object.entries(value.notes)){
  if(!known.has(id)||!n||typeof n!=='object'||!STATUSES.includes(n.status)||typeof n.queued!=='boolean')throw Error('Invalid review record '+id);
  for(const k of ['reviewer','question','notes','updated_at'])if(typeof n[k]!=='string'||n[k].length>20000)throw Error('Invalid saved '+k);
  notes[id]={queued:n.queued,status:n.status,reviewer:n.reviewer,question:n.question,notes:n.notes,updated_at:n.updated_at};
 }
 return {state:s,notes,active:known.has(value.active_huc12)?value.active_huc12:null};
}
