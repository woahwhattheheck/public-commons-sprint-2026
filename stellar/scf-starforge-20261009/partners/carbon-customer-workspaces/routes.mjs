// MIT. Strict original API route selection; no agent-supplied URL or host path.
import {ACTIONS,VIEWS,IMPORTS,STATEMENT_FILES} from './catalog.mjs';
import {need,exact,plain,operationId} from './files.mjs';
const encoded=value=>{need(typeof value==='string'&&value.length>0&&value.length<=1000,'CARBON_SOURCE_ID','Choose an original source identity.');return encodeURIComponent(value);};
function query(values){const out=new URLSearchParams();for(const[k,v]of Object.entries(values))if(v!==undefined&&v!==null)out.set(k,String(v));return out.size?'?'+out:'';}
export function viewRoute(kind,view,input={}){
 const spec=VIEWS[view];need(spec&&(!spec.kind||spec.kind===kind),'CARBON_VIEW','Choose a view supported by this original application.');
 exact(input,spec.keys,spec.required);const q={...input};
 for(const[k,v]of Object.entries(q)){if(['offset','limit','version'].includes(k))need(Number.isSafeInteger(v)&&v>=(k==='offset'?0:1)&&(k!=='limit'||v<=500),'CARBON_PAGE','Choose the original page offset and limit from 1 to 500.');
  else need(typeof v==='string'&&v.length>0&&v.length<=1000,'CARBON_QUERY','Use original source strings for '+k+'.');}
 if(view==='state')return 'state';
 if(view==='edition')return 'editions/'+encoded(q.editionId);
 if(view==='table'){const path='editions/'+encoded(q.editionId)+'/tables/'+encoded(q.table);delete q.editionId;delete q.table;return path+query(q);}
 if(view==='statement'){const path='statements/'+encoded(q.id);delete q.id;return path+query(q);}
 if(view==='contribution'){const path='contributions/'+encoded(q.hash);delete q.hash;return path+query(q);}
 if(view==='retirement'){const path='retirements/'+encoded(q.certificateId);delete q.certificateId;return path+query(q);}
 if(view==='donation'){const path='donations/'+encoded(q.id);delete q.id;return path+query(q);}
 if(view==='transfer'){const path='transfers/'+encoded(q.key);delete q.key;return path+query(q);}
 return view+query(q);
}
export function mutation(kind,action,value,options){
 need(ACTIONS[kind]?.includes(action)&&plain(value),'CARBON_ACTION','Choose a complete original action supported by this workspace.');
 operationId(options.requestId);need(Number.isSafeInteger(options.revision)&&options.revision>=0,'CARBON_REVISION','Use the observed current workspace revision.');
 need(typeof options.actor==='string'&&options.actor.trim()&&options.actor.length<=300,'CARBON_ACTOR','Name the operator.');
 const fields={value,requestId:options.requestId,revision:options.revision,actor:options.actor};
 if(action==='invoice'){need(typeof value.statementId==='string','CARBON_STATEMENT_ID','Select the original saved statement.');fields.value={...value};delete fields.value.statementId;return {route:'statements/'+encoded(value.statementId)+'/invoice',fields};}
 return {route:'operations/'+action,fields};
}
export function importRequest(kind,input){
 need(IMPORTS[kind].includes(input.format),'CARBON_IMPORT_FORMAT','Choose the original source format for this workspace.');
 const fields={requestId:input.requestId,revision:input.revision,actor:input.actor,label:input.label};
 need(typeof fields.label==='string'&&fields.label.trim()&&fields.label.length<=300,'CARBON_SOURCE_LABEL','Name the complete source edition.');
 mutation(kind,'settings',{name:'validate options'},fields);
 if(input.metadata!==undefined)fields.metadata=input.metadata;
 if(input.network!==undefined)fields.network=input.network;
 if(input.format==='retained')return {route:'import',fields:{...fields,retained:true}};
 if(input.format==='carbon-retained')return {route:'import',fields:{...fields,carbonRetained:true}};
 const member={source:'source','backup-files':'files','registry-files':'registryFiles','carbon-source':'carbonSource'}[input.format];
 return {route:'import',fields,member};
}
export function exportRoute(kind,input){
 if(input.kind==='handover')return 'handover';
 if(input.kind==='source')return 'editions/'+encoded(input.editionId)+'/source';
 if(input.kind==='source-file'){
  if(kind==='stellarcarbon')return 'editions/'+encoded(input.editionId)+'/source/'+encoded(input.name);
  need(Number.isSafeInteger(input.fileIndex)&&input.fileIndex>=0,'CARBON_FILE_INDEX','Choose the original edition file index.');
  return 'editions/'+encoded(input.editionId)+'/files/'+input.fileIndex;
 }
 if(input.kind==='comparison'){encoded(input.beforeId);encoded(input.afterId);return 'compare'+query({beforeId:input.beforeId,afterId:input.afterId,format:'csv'});}
 need(input.kind==='statement'&&STATEMENT_FILES[kind].includes(input.name)&&Number.isSafeInteger(input.version)&&input.version>0,'CARBON_STATEMENT_FILE','Choose a saved statement version and complete export filename.');
 return 'statements/'+encoded(input.statementId)+'/files/'+encoded(input.name)+query({version:input.version});
}
export function captureRoute(kind,sourceKind,command){
 need(kind==='stellarcarbon'?sourceKind==='api':['registry','ledger'].includes(sourceKind),'CARBON_CAPTURE_KIND','Choose the original source acquisition kind.');
 need(['start','status','stop'].includes(command),'CARBON_CAPTURE_COMMAND','Choose start, status or stop.');
 need(!(kind==='stellarcarbon'&&command==='stop'),'CARBON_CAPTURE_STOP','The original Stellarcarbon API retains capture on its owning service; close an owned instance to stop it, or use its Applications owner.');
 return 'capture'+(kind==='givecredit'?'/'+sourceKind:'')+(command==='stop'?'/stop':'');
}
