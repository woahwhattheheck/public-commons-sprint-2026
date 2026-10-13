// MIT. Complete collaborator returns for the existing companion reading workspace.
export function createCompanionReturnModel({editions}) {
  if(!editions?.reopen)throw new Error('Use the maintained companion edition model.');
  const SCHEMA='stellar-forge.companion-reading-return.v1',COPIES='collaborator_copies',RETURNS='collaborator_returns';
  const clone=v=>JSON.parse(JSON.stringify(v));
  const need=(v,m)=>{if(!v)throw new Error(m);};
  const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
  const bytes=s=>new TextEncoder().encode(s);
  const hash=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(typeof v==='string'?v:stable(v)))),b=>b.toString(16).padStart(2,'0')).join('');
  const same=(a,b)=>stable(a)===stable(b);
  const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
  const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
  const snapshot=w=>{const n=clone(w);delete n[COPIES];return n;};
  const entries=w=>w[RETURNS]||[];
  const pools=w=>w[COPIES]||[];
  const noteBinding=n=>{const v=clone(n);delete v.versions;return v;};
  const draftKey=d=>JSON.stringify([d.edition_id,d.chapter_id,d.note_id]);
  function union(left,right,key,label){
    const rows=left.map(clone),map=new Map(rows.map(r=>[r[key],r]));
    for(const row of right){const prior=map.get(row[key]);if(prior)need(same(prior,row),'Conflicting immutable '+label+' identity.');else{const v=clone(row);rows.push(v);map.set(v[key],v);}}
    return rows;
  }
  function plan(local,incoming,id,localSha,incomingSha){
    need(local.id===incoming.id&&local.created_at===incoming.created_at,'Receive a collaborator copy of this same original reading workspace.');
    const sourceRows=incoming.editions.map(e=>{
      const prior=local.editions.find(x=>x.id===e.id);
      if(prior)for(const field of ['markdown','indexText','sha256','bytes','index_sha256','index_bytes'])need(same(prior[field],e[field]),'An existing source edition has different original files.');
      return{id:e.id,kind:prior?'retained':'added',local:prior||null,incoming:e};
    });
    const notes=incoming.notes.map(n=>{
      const prior=local.notes.find(x=>x.id===n.id);
      if(!prior)return{id:n.id,kind:'added',common_versions:0,conflict_key:null,local:null,incoming:n};
      let common=0;while(common<prior.versions.length&&common<n.versions.length&&same(prior.versions[common],n.versions[common]))common++;
      const bound=same(noteBinding(prior),noteBinding(n));
      const kind=!bound?'diverged':common===prior.versions.length?(common===n.versions.length?'same':'incoming-ahead'):common===n.versions.length?'local-ahead':'diverged';
      return{id:n.id,kind,common_versions:bound?common:0,conflict_key:kind==='diverged'?'note:'+n.id:null,local:prior,incoming:n};
    });
    for(const n of local.notes)if(!incoming.notes.some(x=>x.id===n.id))notes.push({id:n.id,kind:'local-only',common_versions:0,conflict_key:null,local:n,incoming:null});
    const a=new Map((local.drafts||[]).map(d=>[draftKey(d),d])),b=new Map((incoming.drafts||[]).map(d=>[draftKey(d),d]));
    const drafts=[...new Set([...a.keys(),...b.keys()])].map(key=>{const l=a.get(key)||null,r=b.get(key)||null,kind=!l?'added':!r?'local-only':same(l,r)?'same':'conflict';return{key,kind,conflict_key:kind==='conflict'?'draft:'+key:null,local:l,incoming:r};});
    return{schema:SCHEMA,review_id:id,workspace_id:local.id,local_sha256:localSha,incoming_sha256:incomingSha,local:clone(local),incoming:clone(incoming),editions:sourceRows,notes,drafts};
  }
  async function identifiedPlan(local,incoming){
    const [a,b]=await Promise.all([hash(snapshot(local)),hash(snapshot(incoming))]);
    const id='return-'+await hash({schema:SCHEMA,workspace_id:local.id,local_sha256:a,incoming_sha256:b});
    return plan(local,incoming,id,a,b);
  }
  function validateDecisions(review,actor,choices,at){
    need(typeof actor==='string'&&actor.trim()&&actor.length<=200,'Name the operator receiving this reading work.');
    need(typeof at==='string'&&Number.isFinite(Date.parse(at)),'Retain the original return decision time.');
    need(plain(choices),'Retain explicit return choices.');
    const expected=new Map();
    review.notes.filter(x=>x.conflict_key).forEach(x=>expected.set(x.conflict_key,['local','incoming','both']));
    review.drafts.filter(x=>x.conflict_key).forEach(x=>expected.set(x.conflict_key,['local','incoming']));
    need(Object.keys(choices).length===expected.size,'Choose each conflict exactly once.');
    for(const [key,allowed] of expected)need(allowed.includes(choices[key]),'Choose the working result for '+key+'.');
    for(const key of Object.keys(choices))need(expected.has(key),'A return choice is not part of this exact review.');
  }
  async function merge(review,{actor,choices,at}){
    validateDecisions(review,actor,choices,at);
    const local=review.local,incoming=review.incoming,n=snapshot(local);
    n[RETURNS]=union(entries(local),entries(incoming),'id','return');
    // Preserve the local edition metadata. Both independently captured rows remain in their complete snapshots.
    for(const row of review.editions)if(row.kind==='added')n.editions.push(clone(row.incoming));
    const remap=new Map();
    for(const row of review.notes)if(row.kind==='diverged'&&choices[row.conflict_key]==='both'){
      const id='returned-note-'+await hash(review.review_id+':'+row.id);
      need(!n.notes.some(x=>x.id===id)&&!incoming.notes.some(x=>x.id===id),'The returned-note identity already exists.');
      remap.set(row.id,id);
    }
    const incomingNote=note=>{const value=clone(note);if(remap.has(note.id)){value.id=remap.get(note.id);value.returned_from={return_id:review.review_id,note_id:note.id};}if(value.parent_id&&remap.has(value.parent_id))value.parent_id=remap.get(value.parent_id);return value;};
    for(const row of review.notes){
      if(row.kind==='added'){n.notes.push(incomingNote(row.incoming));continue;}
      if(row.kind==='incoming-ahead'||(row.kind==='diverged'&&choices[row.conflict_key]==='incoming')){
        const i=n.notes.findIndex(x=>x.id===row.id);n.notes[i]=incomingNote(row.incoming);
      }else if(row.kind==='diverged'&&choices[row.conflict_key]==='both')n.notes.push(incomingNote(row.incoming));
    }
    // Working draft choices never erase the unselected full branch snapshot.
    n.drafts=(local.drafts||[]).map(clone);
    for(const row of review.drafts){
      if(!row.incoming)continue;
      const incomingDraft=clone(row.incoming);
      if(remap.has(incomingDraft.note_id))incomingDraft.note_id=remap.get(incomingDraft.note_id);
      if(row.kind==='same'||(row.kind==='conflict'&&choices[row.conflict_key]==='local'))continue;
      const originalIndex=n.drafts.findIndex(d=>draftKey(d)===row.key);
      if(row.kind==='conflict'&&originalIndex>=0)n.drafts.splice(originalIndex,1);
      const key=draftKey(incomingDraft),index=n.drafts.findIndex(d=>draftKey(d)===key);
      if(index<0)n.drafts.push(incomingDraft);
      else need(same(n.drafts[index],incomingDraft),'A remapped incoming working draft conflicts with an existing draft.');
    }
    // Source selection, navigation, title and other local working fields remain local.
    n.revision=local.revision+1;n.updated_at=at;
    n.history.push({revision:n.revision,at,action:'Collaborator reading return '+review.review_id+' received by '+actor.trim()});
    await editions.reopen(JSON.stringify(n));
    return n;
  }
  async function validate(raw){
    const w=await editions.reopen(raw),nodes=pools(w),receipts=entries(w);
    need(Array.isArray(nodes)&&Array.isArray(receipts),'Retain complete collaborator return snapshots and receipts.');
    const map=new Map(),validated=new Map();
    for(const row of nodes){
      need(plain(row)&&sha(row.sha256)&&plain(row.workspace)&&!Object.hasOwn(row.workspace,COPIES),'Retain a complete flat return snapshot.');
      need(!map.has(row.sha256),'A collaborator snapshot identity is repeated.');
      need(await hash(row.workspace)===row.sha256,'A retained collaborator snapshot changed.');
      need(row.workspace.id===w.id&&row.workspace.created_at===w.created_at,'A collaborator snapshot belongs to another reading workspace.');
      await editions.reopen(JSON.stringify(row.workspace));
      need(Array.isArray(entries(row.workspace)),'Retain snapshot return receipts.');
      map.set(row.sha256,row.workspace);
    }
    const visiting=new Set(),used=new Set();
    async function checkReceipt(r){
      need(plain(r)&&r.schema===SCHEMA&&typeof r.id==='string'&&r.workspace_id===w.id,'Retain the original collaborator return receipt.');
      for(const key of ['local_sha256','incoming_sha256','result_sha256'])need(sha(r[key])&&map.has(r[key]),'A complete collaborator branch snapshot is missing.');
      if(validated.has(r.id)){need(same(validated.get(r.id),r),'Conflicting original return receipt.');return;}
      need(!visiting.has(r.id),'Collaborator return history contains a cycle.');visiting.add(r.id);
      for(const key of ['local_sha256','incoming_sha256','result_sha256']){
        used.add(r[key]);const body=map.get(r[key]);const ids=new Set();
        for(const previous of entries(body)){need(!ids.has(previous.id),'A return receipt is repeated within its original snapshot.');ids.add(previous.id);await checkReceipt(previous);}
      }
      const local=map.get(r.local_sha256),incoming=map.get(r.incoming_sha256);
      const expected=await identifiedPlan(local,incoming);
      need(r.id===expected.review_id,'The retained return identity differs from its original complete branches.');
      const result=await merge(expected,r);
      need(await hash(result)===r.result_sha256&&same(result,map.get(r.result_sha256)),'A retained return result does not match its complete reviewed branches and choices.');
      visiting.delete(r.id);validated.set(r.id,r);
    }
    const ids=new Set();
    for(const r of receipts){need(!ids.has(r.id),'A collaborator return is repeated.');ids.add(r.id);await checkReceipt(r);}
    need(used.size===map.size,'A collaborator snapshot has no retained return receipt.');
    return w;
  }
  async function reviewReturn(local,incoming){
    const [a,b]=await Promise.all([validate(JSON.stringify(local)),validate(typeof incoming==='string'?incoming:JSON.stringify(incoming))]);
    return identifiedPlan(a,b);
  }
  async function applyReturn(local,review,{actor,choices}={}){
    need(review?.schema===SCHEMA,'Prepare the complete collaborator return review first.');
    const current=await validate(JSON.stringify(local));
    const fresh=await reviewReturn(review.local,review.incoming);
    need(same(fresh,review),'The return review changed; review both complete branches again.');
    const prior=entries(current).find(r=>r.id===fresh.review_id);
    if(prior){
      need(prior.actor===actor?.trim()&&same(prior.choices,choices),'This return already has its original operator and choices.');
      return{workspace:current,already_applied:true,receipt:clone(prior)};
    }
    need(await hash(snapshot(current))===fresh.local_sha256,'Reading work changed after review. Compare the same returned copy with the current workspace.');
    const at=new Date().toISOString(),result=await merge(fresh,{actor,choices,at});
    const resultSha=await hash(result),receipt={schema:SCHEMA,id:fresh.review_id,workspace_id:current.id,local_sha256:fresh.local_sha256,incoming_sha256:fresh.incoming_sha256,result_sha256:resultSha,actor:actor.trim(),at,choices:clone(choices)};
    let copies=union(pools(current),pools(fresh.incoming),'sha256','snapshot');
    for(const [sha256,workspace] of [[fresh.local_sha256,snapshot(current)],[fresh.incoming_sha256,snapshot(fresh.incoming)],[resultSha,result]])copies=union(copies,[{sha256,workspace}],'sha256','snapshot');
    const workspace={...result,[RETURNS]:[...entries(result),receipt],[COPIES]:copies};
    const complete=JSON.stringify(workspace);
    need(bytes(complete).length<=editions.maxBytes,'The full return exceeds 64 MiB. Preserve both complete workspaces and continue in a separate reading workspace.');
    await validate(complete);
    return{workspace,already_applied:false,receipt};
  }
  function returnCopies(workspace){
    const labels=new Map();
    for(const r of entries(workspace))for(const [key,label] of [['local_sha256','Before return'],['incoming_sha256','Incoming return'],['result_sha256','Applied result']])if(!labels.has(r[key]))labels.set(r[key],label+' · '+r.actor+' · '+r.at);
    return pools(workspace).map(row=>({sha256:row.sha256,label:labels.get(row.sha256)||'Earlier retained return branch',workspace_id:row.workspace.id,revision:row.workspace.revision,updated_at:row.workspace.updated_at,editions:row.workspace.editions.length,notes:row.workspace.notes.length,drafts:(row.workspace.drafts||[]).length}));
  }
  async function openReturnCopy(workspace,identity){
    const w=await validate(JSON.stringify(workspace)),map=new Map(pools(w).map(x=>[x.sha256,x])),selected=map.get(identity);
    need(selected,'Choose an original retained return snapshot.');
    const selectedIds=new Set();
    const walk=body=>{for(const r of entries(body))for(const key of ['local_sha256','incoming_sha256','result_sha256'])if(!selectedIds.has(r[key])){selectedIds.add(r[key]);walk(map.get(r[key]).workspace);}};
    walk(selected.workspace);const result=clone(selected.workspace);
    if(selectedIds.size)result[COPIES]=pools(w).filter(x=>selectedIds.has(x.sha256)).map(clone);
    return validate(JSON.stringify(result));
  }
  return Object.freeze({...editions,reopen:validate,reviewReturn,applyReturn,returnCopies,openReturnCopy});
}
