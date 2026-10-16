'use strict';
/* Metadata Commissioning Desk. Exact JSON remains authoritative throughout. */
function createMetadataDesk(deps) {
  const {hash,uuid,now}=deps,copy=x=>JSON.parse(JSON.stringify(x)),SCHEMA='tjl.datahub.workspace.v1';
  const need=(yes,message)=>{if(!yes)throw Error(message);};
  const digest=s=>hash(s).sha256,stamp=()=>now();
  function parseExact(text) {
    need(typeof text==='string','JSON must be complete text.');
    let at=0,depth=0; const ws=()=>{while(/[ \t\r\n]/.test(text[at]||'\0'))at++;};
    function value(){
      ws();need(++depth<=200,'JSON nesting exceeds 200 levels.');const start=at,c=text[at];let node;
      if(c==='"'){at++;let done=false;while(at<text.length){const ch=text[at++];if(ch==='"'){done=true;break;}if(ch==='\\')at++;}
        need(done,'Unterminated JSON string.');const raw=text.slice(start,at);node={type:'string',value:JSON.parse(raw),raw};
      }else if(c==='{'||c==='['){const object=c==='{',end=object?'}':']';at++;ws();const items=[],keys=new Set();
        if(text[at]!==end){while(true){if(object){need(text[at]==='"','Expected JSON object key.');const key=value();need(!keys.has(key.value),'Duplicate JSON object key: '+key.value);keys.add(key.value);ws();need(text[at++]===':','Expected colon.');items.push([key.value,value()]);}
          else items.push(value());ws();if(text[at]===end)break;need(text[at++ ]===',','Expected comma.');ws();}}
        need(text[at++]===end,'Unterminated JSON container.');node={type:object?'object':'array',items,raw:text.slice(start,at)};
      }else{
        const rem=text.slice(at),m=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rem);
        if(m){at+=m[0].length;node={type:'number',raw:m[0]};}
        else {const t=/^(true|false|null)/.exec(rem);need(t,'Invalid JSON at character '+at);at+=t[0].length;node={type:t[0]==='null'?'null':'boolean',value:t[0]==='true',raw:t[0]};}
      }
      depth--;return node;
    }
    const n=value();ws();need(at===text.length,'Unexpected trailing JSON at character '+at);return n;
  }
  function canonical(n){
    if(typeof n==='string')n=parseExact(n);
    if(n.type==='object')return '{'+[...n.items].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
    if(n.type==='array')return '['+n.items.map(canonical).join(',')+']';
    return n.type==='string'?JSON.stringify(n.value):n.raw;
  }
  function plain(n){if(typeof n==='string')n=parseExact(n);if(n.type==='object')return Object.fromEntries(n.items.map(([k,v])=>[k,plain(v)]));if(n.type==='array')return n.items.map(plain);return n.type==='number'?n.raw:n.type==='null'?null:n.value;}
  function pair(urn,aspect){return JSON.stringify([urn,aspect]);}
  function newWorkspace(title){
    need(typeof title==='string'&&title.trim(),'Name the project.');
    return{schema:SCHEMA,id:uuid(),title,revision:0,created_at:stamp(),editorDrafts:{},selection:{source_snapshot:'',target_snapshot:'',target_url:'',source_owner:'',reviewer:'',purpose:''},snapshots:[],proposals:[],decisions:[],runs:[],notes:[],editions:[],received_originals:[]};
  }
  function validate(w){
    need(w&&w.schema===SCHEMA&&typeof w.id==='string'&&typeof w.title==='string','Open a complete metadata workspace.');
    need(Number.isSafeInteger(w.revision)&&w.revision>=0,'Invalid workspace revision.');
    for(const name of ['snapshots','proposals','decisions','runs','notes','editions','received_originals'])need(Array.isArray(w[name]),'Missing '+name+'.');
    need(w.selection&&Object.values(w.selection).every(v=>typeof v==='string'),'Selection fields must be literal text.');
    const ids=new Set();for(const s of w.snapshots){need(!ids.has(s.id),'Duplicate snapshot identity.');ids.add(s.id);validateObservation(s.observation);need(digest(s.original_text)===s.original_sha256,'Changed snapshot original: '+s.label);need(JSON.stringify(JSON.parse(s.original_text))===JSON.stringify(s.observation),'Snapshot interpretation differs from its complete original.');}
    return w;
  }
  function validateObservation(o){
    need(o&&o.schema==='tjl.datahub.observation.v1'&&Array.isArray(o.entries)&&Array.isArray(o.errors)&&Array.isArray(o.timeseries),'Select a complete SDK observation.');
    need(['source','target'].includes(o.role)&&typeof o.label==='string','Observation needs source/target role and label.');
    const urns=new Set();for(const e of o.entries){need(typeof e.urn==='string'&&e.urn.startsWith('urn:li:')&&!urns.has(e.urn),'Distinct literal DataHub URNs are required.');urns.add(e.urn);
      need(typeof e.exists==='boolean'&&e.aspects&&typeof e.aspects==='object'&&!Array.isArray(e.aspects),'Observation must contain existence and complete selected aspects.');
      for(const [name,text]of Object.entries(e.aspects)){need(/^[A-Za-z][A-Za-z0-9]*$/.test(name),'Invalid aspect name.');need(parseExact(text).type==='object','Aspect must be a JSON object.');}
    }
    return o;
  }
  function importObservation(w,text,label){
    validate(w);const o=validateObservation(JSON.parse(text)),s={id:uuid(),label:label||o.label,received_at:stamp(),original_text:text,original_sha256:digest(text),observation:copy(o)};
    w.snapshots.push(s);w.selection[o.role+'_snapshot']=s.id;w.revision++;return s;
  }
  function snapshot(w,id){const s=w.snapshots.find(s=>s.id===id);need(s,'Choose a retained snapshot.');return s;}
  function aspectMap(s){const m=new Map();for(const e of s.observation.entries)for(const[a,text]of Object.entries(e.aspects))m.set(pair(e.urn,a),{urn:e.urn,aspect:a,text,canonical:canonical(text),exists:e.exists});return m;}
  function compare(w,sourceId=w.selection.source_snapshot,targetId=w.selection.target_snapshot){
    validate(w);const source=snapshot(w,sourceId),target=snapshot(w,targetId),a=aspectMap(source),b=aspectMap(target),rows=[];
    for(const key of [...new Set([...a.keys(),...b.keys()])].sort()){const x=a.get(key),y=b.get(key),[urn,aspect]=JSON.parse(key);const state=!x?'target-only':!y?'missing':x.canonical===y.canonical?'equal':'different';
      rows.push({key,urn,aspect,state,source_text:x?.text??null,target_text:y?.text??null,source_sha256:x?digest(x.text):null,target_sha256:y?digest(y.text):null});
    }
    const expected=new Set(source.observation.entries.map(e=>e.urn)),seen=new Map(target.observation.entries.map(e=>[e.urn,e]));
    const entities=[...expected].sort().map(urn=>({urn,exists:seen.get(urn)?.exists??false,state:!seen.has(urn)?'not-observed':seen.get(urn).exists?'present':'absent'}));
    const id=digest(JSON.stringify({source:source.original_sha256,target:target.original_sha256}));
    const counts=Object.fromEntries(['equal','different','missing','target-only'].map(state=>[state,rows.filter(r=>r.state===state).length]));
    return{id,source_id:source.id,target_id:target.id,source_label:source.label,target_label:target.label,entities,rows,counts,errors:[...source.observation.errors,...target.observation.errors],timeseries_source_count:source.observation.timeseries.length,timeseries_target_count:target.observation.timeseries.length};
  }
  function decision(w,comparisonId,key,outcome,reviewer,reason){
    const c=compare(w);need(c.id===comparisonId,'The selected comparison changed.');need(c.rows.some(r=>r.key===key),'Choose an actual aspect comparison.');
    need(['accepted','correct','investigate'].includes(outcome),'Choose accepted, correct or investigate.');need(reviewer.trim()&&reason.trim(),'Name the reviewer and explain the decision.');
    const d={id:uuid(),at:stamp(),comparison_id:c.id,key,outcome,reviewer,reason};w.decisions.push(d);w.revision++;return d;
  }
  function currentDecisions(w,c){const m=new Map();for(const d of w.decisions)if(d.comparison_id===c.id)m.set(d.key,d);return m;}
  function propose(w,urn,aspect,text,reviewer,reason){
    need(reviewer.trim()&&reason.trim(),'Name the proposed change owner and reason.');need(parseExact(text).type==='object','Write a complete aspect JSON object.');
    const target=snapshot(w,w.selection.target_snapshot),entry=target.observation.entries.find(e=>e.urn===urn);need(entry,'Read this target entity before proposing a change.');
    need(entry.exists,'The selected target entity must exist.');const base=entry.aspects[aspect]??null;
    need(base!==null,'This handover edition changes existing aspects; commission additions in a separate complete source ingestion.');
    need(canonical(base)!==canonical(text),'The proposed aspect equals the observed target.');
    const p={id:uuid(),at:stamp(),urn,aspect,base_snapshot_id:target.id,base_original_sha256:target.original_sha256,before_json:base,before_sha256:digest(base),after_json:text,after_sha256:digest(text),reviewer,reason};
    w.proposals.push(p);w.revision++;return p;
  }
  function proposalPacket(w,ids,label,reviewer){
    validate(w);need(label.trim()&&reviewer.trim(),'Name this release and reviewer.');need(Array.isArray(ids)&&ids.length,'Select proposed changes.');
    const proposals=ids.map(id=>{const p=w.proposals.find(p=>p.id===id);need(p,'Unknown proposal.');return p;});const keys=new Set(),target=snapshot(w,w.selection.target_snapshot);
    for(const p of proposals){const key=pair(p.urn,p.aspect);need(!keys.has(key),'Select only one proposed edition for each aspect.');keys.add(key);
      need(p.base_snapshot_id===target.id,'Proposal belongs to a different target observation. Select and review it explicitly.');need(digest(p.before_json)===p.before_sha256&&digest(p.after_json)===p.after_sha256,'Proposal source changed.');}
    need(w.selection.target_url.trim(),'Record the exact target GMS URL.');need(w.selection.target_url.replace(/\/$/,'')===String(target.observation.target_url||'').replace(/\/$/,''),'Select the exact GMS URL from the retained target observation.');
    const payload={schema:'tjl.datahub.change-plan.v1',id:uuid(),label,created_at:stamp(),workspace_id:w.id,workspace_revision:w.revision,target_url:w.selection.target_url,reviewer,base_observation_sha256:target.original_sha256,changes:copy(proposals)};
    payload.plan_sha256=digest(JSON.stringify(payload));return payload;
  }
  function receiveRun(w,text){
    const r=JSON.parse(text);need(r&&r.schema==='tjl.datahub.run.v1'&&typeof r.id==='string'&&Array.isArray(r.events),'Select a complete native run.');
    w.runs.push({id:uuid(),received_at:stamp(),original_sha256:digest(text),original_text:text,run:copy(r)});w.revision++;return r;
  }
  function edition(w,label){
    validate(w);need(label.trim(),'Name the edition.');const state=copy(w);delete state.editions;delete state.received_originals;
    w.editions.push({id:uuid(),at:stamp(),label,revision:w.revision,workspace:state});w.revision++;return w;
  }
  function restoreEdition(w,id){
    validate(w);const e=w.editions.find(e=>e.id===id);need(e,'Choose a retained named edition.');
    const prior=JSON.stringify(w),restored=copy(e.workspace);
    restored.editions=copy(w.editions);restored.received_originals=copy(w.received_originals);
    restored.received_originals.push({at:stamp(),label:'Complete working project before restoring '+e.label,text:prior,sha256:digest(prior)});
    restored.revision=w.revision+1;return validate(restored);
  }
  function proposeRevert(w,proposalId,reviewer,reason){
    const prior=w.proposals.find(p=>p.id===proposalId);need(prior,'Choose an original proposed change.');
    const target=snapshot(w,w.selection.target_snapshot),e=target.observation.entries.find(e=>e.urn===prior.urn);
    need(e?.exists&&e.aspects[prior.aspect]!==undefined,'Collect the existing target again before preparing a revert.');
    need(target.id!==prior.base_snapshot_id,'A revert requires a fresh target observation.');
    need(canonical(e.aspects[prior.aspect])===canonical(prior.after_json),'The fresh target differs from the original change. Review its complete values before proposing a correction.');
    const p=propose(w,prior.urn,prior.aspect,prior.before_json,reviewer,reason);p.reverts_proposal_id=prior.id;return p;
  }
  function receiveWorkspace(current,text){
    const packet=JSON.parse(text),next=validate(copy(packet.working||packet));const originalCurrent=JSON.stringify(current);
    next.received_originals.push({at:stamp(),label:'Incoming complete workspace',text,sha256:digest(text)});
    if(current)next.received_originals.push({at:stamp(),label:'Previous workspace before explicit replacement',text:originalCurrent,sha256:digest(originalCurrent)});
    next.revision++;return{working:next,rawDraft:typeof packet.rawDraft==='string'?packet.rawDraft:''};
  }
  function relationships(s){
    const edges=[],issues=[];const entities=new Set(s.observation.entries.filter(e=>e.exists).map(e=>e.urn));
    const add=(from,to,kind,detail='')=>{if(typeof to==='string'&&to.startsWith('urn:li:'))edges.push({from,to,kind,detail,in_selected_population:entities.has(to)});};
    for(const e of s.observation.entries){for(const [name,text]of Object.entries(e.aspects)){const x=plain(text);
      if(name==='ownership')for(const o of x.owners||[])add(e.urn,o.owner,'owner',o.type||'');
      if(name==='globalTags')for(const t of x.tags||[])add(e.urn,t.tag,'tag');
      if(name==='glossaryTerms')for(const t of x.terms||[])add(e.urn,t.urn,'glossary term');
      if(name==='domains')for(const d of x.domains||[])add(e.urn,d,'domain');
      if(name==='upstreamLineage'){for(const l of x.upstreams||[])add(e.urn,l.dataset,'upstream',l.type||'');for(const l of x.fineGrainedLineages||[])for(const up of l.upstreams||[])for(const down of l.downstreams||[])add(down,up,'field lineage',l.transformOperation||'');}
      if(name==='dataJobInputOutput'){for(const a of x.inputDatasets||[])add(e.urn,a,'input dataset');for(const a of x.outputDatasets||[])add(e.urn,a,'output dataset');for(const a of x.inputDatajobs||[])add(e.urn,a,'input job');}
      if(name==='dashboardInfo')for(const a of x.charts||[])add(e.urn,a,'chart');
      if(name==='chartInfo')for(const a of x.inputs||[])add(e.urn,a,'chart input');
      if(name==='schemaMetadata'){const seen=new Set();for(const field of x.fields||[]){if(seen.has(field.fieldPath))issues.push({urn:e.urn,aspect:name,problem:'Duplicate field path',value:field.fieldPath});seen.add(field.fieldPath);}}
    }}
    return{edges,issues};
  }
  function csv(rows,keys){keys=keys||[...new Set(rows.flatMap(x=>Object.keys(x)))];const cell=v=>{let s=v==null?'':typeof v==='object'?JSON.stringify(v):String(v);if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};return[keys,...rows.map(r=>keys.map(k=>r[k]??''))].map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';}
  function report(w){
    const c=compare(w),d=currentDecisions(w,c),open=c.rows.filter(r=>r.state!=='equal'&&d.get(r.key)?.outcome!=='accepted');
    return{schema:'tjl.datahub.report.v1',workspace_id:w.id,title:w.title,revision:w.revision,prepared_at:stamp(),comparison:c,decisions:[...d.values()],unresolved:open.length,unobserved_entities:c.entities.filter(x=>x.state!=='present').length,relationships:relationships(snapshot(w,c.source_id)),notes:copy(w.notes),runs:copy(w.runs)};
  }
  return{SCHEMA,copy,parseExact,canonical,plain,pair,newWorkspace,validate,validateObservation,importObservation,snapshot,aspectMap,compare,decision,currentDecisions,propose,proposalPacket,receiveRun,edition,restoreEdition,proposeRevert,receiveWorkspace,relationships,csv,report};
}
if(typeof module!=='undefined')module.exports={createMetadataDesk};
