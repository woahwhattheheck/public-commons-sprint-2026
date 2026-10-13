// MIT. Complete source editions and retained reading work for the existing companion.
export function createCompanionEditionModel({parseMarkdown}) {
  const SCHEMA='stellar-forge.companion-reading-workspace.v1',MAX_BYTES=64*1024*1024;
  const clone=v=>JSON.parse(JSON.stringify(v)),need=(v,m)=>{if(!v)throw new Error(m);};
  const bytes=s=>new TextEncoder().encode(s);
  // Immutable source strings are safe cache keys; callers never contribute mutable cached state.
  // Bound this private renderer cache to two complete source editions and 32 MiB of source.
  const parsedSources=new Map();let parsedSourceBytes=0;
  const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
  function parsed(source){
    const prior=parsedSources.get(source);
    if(prior){parsedSources.delete(source);parsedSources.set(source,prior);return prior.model;}
    const model=freeze(parseMarkdown(source)),size=bytes(source).length;
    if(size<=32*1024*1024){
      while(parsedSources.size&&(parsedSources.size>=2||parsedSourceBytes+size>32*1024*1024)){
        const key=parsedSources.keys().next().value;parsedSourceBytes-=parsedSources.get(key).bytes;parsedSources.delete(key);
      }
      parsedSources.set(source,{model,bytes:size});parsedSourceBytes+=size;
    }
    return model;
  }
  const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
  const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof s==='string'?bytes(s):s)),b=>b.toString(16).padStart(2,'0')).join('');
  const text=(v,label,max=100000)=>{need(typeof v==='string'&&v.length<=max,label+' must be complete text.');return v;};
  const date=v=>{need(typeof v==='string'&&Number.isFinite(Date.parse(v)), 'Retain the original edition date.');return v;};
  const id=()=>crypto.randomUUID();
  const now=()=>new Date().toISOString();
  const getEdition=(w,key=w.selected_edition)=>{const e=w.editions.find(e=>e.id===key);need(e,'Choose a retained source edition.');return e;};
  const getChapter=(e,key)=>{const c=parsed(e.markdown).chapters.find(c=>c.id===key);need(c,'Choose a chapter from its original source edition.');return c;};
  async function capture(source,{origin='',capturedAt=now()}={}) {
    text(source?.markdown,'Companion source',16*1024*1024);text(source?.indexText,'Source index',16*1024*1024);
    const index=JSON.parse(source.indexText.replace(/^\uFEFF/,'')),selected=index.product_and_finance;
    need(index.schema==='stellar-forge.grant-reviewer-source-index.v1'&&selected,'Open the original companion and its source index together.');
    const body=bytes(source.markdown),sha=await digest(body),indexSha=await digest(source.indexText);
    need(body.length<=16*1024*1024&&bytes(source.indexText).length<=16*1024*1024,'The complete source pair exceeds its per-file allowance.');
    need(selected.bytes===body.length&&selected.sha256===sha,'The source index does not select these complete companion bytes.');
    const chapters=parsed(source.markdown).chapters;
    need(Array.isArray(index.sources)&&index.sources.every(s=>s&&typeof s.id==='string'),'Retain the complete source catalogue.');
    need(new Set(index.sources.map(s=>s.id)).size===index.sources.length,'Source catalogue identities must be unique.');
    need(chapters.length,'Open a companion with complete chapters.');
    return{id:'edition-'+await digest(sha+':'+indexSha),captured_at:date(capturedAt),origin:text(origin,'Origin',4000),sha256:sha,bytes:body.length,index_sha256:indexSha,index_bytes:bytes(source.indexText).length,markdown:source.markdown,indexText:source.indexText};
  }
  function transaction(w,action,change) {
    const n=clone(w);change(n);n.revision++;n.updated_at=now();n.history.push({revision:n.revision,at:n.updated_at,action});
    need(bytes(JSON.stringify(n)).length<=MAX_BYTES,'Save this complete workspace before beginning another workspace; its retained sources reached 64 MiB.');
    return n;
  }
  async function create(source,{title='SCF companion reading',origin='',workspaceId=id()}={}) {
    const edition=await capture(source,{origin}),at=now(),chapter=getChapter(edition,parsed(edition.markdown).chapters[0].id);
    return{schema:SCHEMA,id:workspaceId,title:text(title,'Reading workspace title',200),revision:1,created_at:at,updated_at:at,selected_edition:edition.id,editions:[edition],reading:{chapter_id:chapter.id,query:'',show_all:false},drafts:[],notes:[],history:[{revision:1,at,action:'Original complete source received'}]};
  }
  async function receive(w,source,details={}) {
    const edition=await capture(source,details),prior=w.editions.find(e=>e.id===edition.id);
    if(prior)return{workspace:w,edition_id:prior.id,already_received:true};
    return{workspace:transaction(w,'Complete source edition received',n=>n.editions.push(edition)),edition_id:edition.id,already_received:false};
  }
  async function compare(w,fromId,toId) {
    const from=getEdition(w,fromId),to=getEdition(w,toId);
    const chapterRows=e=>parsed(e.markdown).chapters.map(c=>({id:c.id,title:c.title,ordinal:c.ordinal,markdown:c.markdown,html:c.html}));
    const a=chapterRows(from),b=chapterRows(to),seen=new Set(),changes=[];
    // Repeated headings remain distinct; a reordered duplicate is shown as changed for review.
    for(const after of b){const before=a.find(c=>c.id===after.id);seen.add(after.id);const same=before&&before.markdown===after.markdown;changes.push({id:after.id,title:after.title,kind:before?(same?'unchanged':'changed'):'added',moved:!!before&&before.ordinal!==after.ordinal,before:before||null,after});}
    for(const before of a)if(!seen.has(before.id))changes.push({id:before.id,title:before.title,kind:'removed',moved:false,before,after:null});
    const oldSources=JSON.parse(from.indexText).sources,newSources=JSON.parse(to.indexText).sources,oldMap=new Map(oldSources.map(s=>[s.id,s])),newMap=new Map(newSources.map(s=>[s.id,s]));
    const sources=[...new Set([...oldMap.keys(),...newMap.keys()])].map(key=>{const before=oldMap.get(key)||null,after=newMap.get(key)||null;return{id:key,kind:!before?'added':!after?'removed':stable(before)===stable(after)?'unchanged':'changed',before,after};});
    return{from:from.id,to:to.id,chapters:changes,sources,summary:{added:changes.filter(c=>c.kind==='added').length,changed:changes.filter(c=>c.kind==='changed').length,removed:changes.filter(c=>c.kind==='removed').length,moved:changes.filter(c=>c.moved).length,source_changes:sources.filter(s=>s.kind!=='unchanged').length}};
  }
  function select(w,editionId,{chapterId='',query='',showAll=false}={}) {
    const e=getEdition(w,editionId),chapters=parsed(e.markdown).chapters;
    const selected=chapters.find(c=>c.id===chapterId)||chapters[0];
    return transaction(w,'Reading edition selected',n=>{n.selected_edition=e.id;n.reading={chapter_id:selected.id,query:text(query,'Search',500),show_all:!!showAll};});
  }
  function reading(w,{chapter_id,query,show_all}) {
    getChapter(getEdition(w),chapter_id);text(query,'Search',500);
    const next={chapter_id,query,show_all:!!show_all};if(stable(next)===stable(w.reading))return w;
    // Reading position is mutable session work; source and note history stays complete.
    return{...w,reading:next,updated_at:now()};
  }
  function note(w,{noteId='',chapterId,author,title='',body='',bookmark=false,status='open',parentId=''}={}) {
    const e=getEdition(w),c=getChapter(e,chapterId);text(author,'Author',200);need(author.trim(),'Name the reading-note author.');text(title,'Note title',500);text(body,'Note',50000);
    need(['open','resolved'].includes(status),'Choose an open or resolved note.');
    let prior=noteId?w.notes.find(n=>n.id===noteId):null;need(!noteId||prior,'Choose the original retained note.');
    if(prior)need(prior.edition_id===e.id&&prior.chapter_id===c.id,'Edit this note in its original selected source chapter.');
    if(parentId)need(w.notes.some(n=>n.id===parentId),'Keep the original note when carrying it to another edition.');
    need(title.trim()||body.trim()||bookmark,'Write a note or retain a bookmark.');
    return transaction(w,prior?'Reading note revised':'Reading note saved',n=>{
      const at=now(),version={version:(prior?.versions.length||0)+1,at,author:author.trim(),title,body,bookmark:!!bookmark,status};
      n.drafts=(n.drafts||[]).filter(d=>!(d.edition_id===e.id&&d.chapter_id===c.id&&d.note_id===(noteId||'')));
      if(prior)n.notes.find(x=>x.id===prior.id).versions.push(version);
      else n.notes.push({id:id(),edition_id:e.id,chapter_id:c.id,chapter_title:c.title,parent_id:parentId||null,versions:[version]});
    });
  }
  function draft(w,value) {
    const edition=getEdition(w,value.edition_id),chapter=getChapter(edition,value.chapter_id);
    const data={edition_id:edition.id,chapter_id:chapter.id,note_id:text(value.note_id||'','Note identity',200),author:text(value.author||'','Author',200),title:text(value.title||'','Note title',500),body:text(value.body||'','Note',50000),bookmark:!!value.bookmark,status:value.status||'open'};
    need(['open','resolved'].includes(data.status),'Choose an open or resolved note.');
    if(data.note_id)need(w.notes.some(n=>n.id===data.note_id&&n.edition_id===edition.id&&n.chapter_id===chapter.id),'Keep the draft with its original note.');
    const drafts=(w.drafts||[]).filter(d=>!(d.edition_id===data.edition_id&&d.chapter_id===data.chapter_id&&d.note_id===data.note_id));
    drafts.push(data);const next={...w,drafts,updated_at:now()};need(bytes(JSON.stringify(next)).length<=MAX_BYTES,'Download this complete workspace before adding more reading drafts.');return next;
  }
  function carry(w,noteId,{chapterId,author,body,title}={}) {
    const original=w.notes.find(n=>n.id===noteId);need(original,'Choose the complete original note.');
    const latest=original.versions.at(-1);need(original.edition_id!==w.selected_edition,'Select another source edition before carrying this note.');
    return note(w,{chapterId,author,title:title??latest.title,body:body??latest.body,bookmark:latest.bookmark,status:'open',parentId:original.id});
  }
  async function reopen(raw) {
    text(raw,'Complete reading workspace',MAX_BYTES);need(bytes(raw).length<=MAX_BYTES,'Open a complete workspace under 64 MiB.');
    const w=JSON.parse(raw);need(w?.schema===SCHEMA&&typeof w.id==='string'&&w.id.length<=200,'Open the original companion reading workspace.');
    text(w.title,'Workspace title',200);need(Number.isSafeInteger(w.revision)&&w.revision>0,'Workspace revision is invalid.');date(w.created_at);date(w.updated_at);
    need(Array.isArray(w.editions)&&w.editions.length&&Array.isArray(w.notes)&&Array.isArray(w.history),'Retain all source, note and history collections.');
    const ids=new Set();
    for(const e of w.editions){need(!ids.has(e.id),'Source edition identity is repeated.');ids.add(e.id);const observed=await capture(e,{origin:e.origin,capturedAt:e.captured_at});for(const key of ['id','sha256','bytes','index_sha256','index_bytes'])need(e[key]===observed[key],'A retained source edition does not match its complete original files.');}
    const selected=getEdition(w);getChapter(selected,w.reading?.chapter_id);text(w.reading.query,'Search',500);need(typeof w.reading.show_all==='boolean','Retain the original reading mode.');
    need(w.drafts===undefined||Array.isArray(w.drafts),'Retain complete note drafts.');
    const noteIds=new Set();
    for(const n of w.notes){need(typeof n.id==='string'&&!noteIds.has(n.id),'Reading note identity is invalid.');noteIds.add(n.id);const c=getChapter(getEdition(w,n.edition_id),n.chapter_id);need(n.chapter_title===c.title,'The note chapter differs from its source.');need(Array.isArray(n.versions)&&n.versions.length,'Retain complete note versions.');
      n.versions.forEach((v,i)=>{need(v.version===i+1,'Retain ordered note versions.');date(v.at);text(v.author,'Author',200);need(v.author.trim(),'Retain the named note author.');text(v.title,'Note title',500);text(v.body,'Note',50000);need(typeof v.bookmark==='boolean'&&['open','resolved'].includes(v.status),'Note state is invalid.');});}
    for(const n of w.notes)if(n.parent_id)need(noteIds.has(n.parent_id)&&n.parent_id!==n.id,'Retain the source note for each carried note.');
    const draftKeys=new Set();for(const d of w.drafts||[]){const key=d.edition_id+':'+d.chapter_id+':'+d.note_id;need(!draftKeys.has(key),'A reading-note draft is repeated.');draftKeys.add(key);draft(w,d);}
    let previous=0;for(const entry of w.history){need(Number.isSafeInteger(entry.revision)&&entry.revision>previous&&entry.revision<=w.revision,'Retain ordered workspace history.');previous=entry.revision;date(entry.at);text(entry.action,'History action',500);}need(previous===w.revision,'The history must reach the current revision.');
    return w;
  }
  function notesMarkdown(w) {
    const lines=['# '+w.title,'','Complete retained reading notes; source edition identities remain attached.',''];
    for(const n of w.notes){const e=getEdition(w,n.edition_id);lines.push('## '+n.chapter_title,'','Source: '+e.sha256,'','Chapter: '+n.chapter_id,'',n.parent_id?'Carried from note: '+n.parent_id:'');
      for(const v of n.versions)lines.push('### '+(v.title||'Reading note')+' — version '+v.version,'',v.author+' · '+v.at+' · '+v.status+(v.bookmark?' · bookmarked':''),'',v.body,'');}
    return lines.join('\n')+'\n';
  }
  return Object.freeze({schema:SCHEMA,maxBytes:MAX_BYTES,capture,create,receive,compare,select,reading,note,draft,carry,reopen,notesMarkdown,getEdition,getChapter});
}
