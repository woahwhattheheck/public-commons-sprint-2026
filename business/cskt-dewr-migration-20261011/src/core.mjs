import { randomUUID } from 'node:crypto';
import { Problem, digest, now, pack, unpack, requireRole } from './store.mjs';

export const SCHEMA='cskt.migration.release.v1';
export const kinds=['page','project','document','news','notice','media'];
export const dispositions=['retain','revise','consolidate','archive','remove'];
const text = (value,max=500,required=false) => { if(typeof value!=='string' || value.length>max || (required&&!value.trim())) throw new Problem(400,'Enter a text value'+(required?' with content':'')+' of at most '+max+' characters.'); return value.trim(); };
export const plain = value => String(value || '').replace(/<[^>]*>/g,' ').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const cp=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n); return cp>0&&cp<=0x10ffff ? String.fromCodePoint(cp):' ';}).replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,x)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[x])).replace(/\s+/g,' ').trim();
export const field = value => typeof value==='string' ? value : value?.raw ?? value?.rendered ?? '';
export function publicUrl(value) { let u; try {u=new URL(value);} catch {throw new Problem(400,'Use a complete HTTPS source URL.');} if(u.protocol!=='https:'||u.username||u.password) throw new Problem(400,'Use a complete HTTPS source URL.'); return u.href; }
export function routePath(value) {
  const path=text(value,800,true); let decoded; try {decoded=decodeURIComponent(path);} catch {throw new Problem(400,'The destination path contains invalid URL encoding.');}
  if(!path.startsWith('/') || path.startsWith('//') || /[?#\\\s\u0000-\u001f]/.test(path) || /[\\\u0000-\u001f]/.test(decoded) || decoded.split('/').some(x=>x==='.'||x==='..') || /%2f/i.test(path)) throw new Problem(400,'Use an absolute local destination path without a query, fragment or traversal.');
  return path;
}
export function sourceLocalPath(kind,raw,origin='https://csktwatercompact.com') {
  const candidate=kind==='media'?raw.source_url:raw.link;
  if(candidate){const url=new URL(publicUrl(candidate));if(url.origin===origin)return routePath(url.pathname);}
  if(kind==='media'){
    const relative=raw.media_details?.file;
    if(typeof relative==='string'&&relative&&!relative.startsWith('/')&&!relative.split('/').some(part=>!part||part==='.'||part==='..')&&!/[\\\u0000-\u001f]/.test(relative))return routePath('/wp-content/uploads/'+relative.split('/').map(encodeURIComponent).join('/'));
  }
  return null;
}
function initialDraft(kind,raw,id,origin,asset) {
  const title=plain(field(raw.title)) || raw.slug || 'Source '+raw.id;
  const media=kind==='media', document=media&&String(raw.mime_type).startsWith('application/');
  const fileEvidence=asset?.status===200&&!asset.error&&!asset.providerError&&/^[a-f0-9]{64}$/i.test(asset.sha256||'')&&Number.isSafeInteger(asset.bytes)&&asset.bytes>=0?{sha256:asset.sha256.toLowerCase(),bytes:asset.bytes}:{};
  const selectedUrl=fileEvidence.sha256?publicUrl(asset.finalUrl||asset.url):media?publicUrl(raw.source_url):null;
  const selectedMime=fileEvidence.sha256&&typeof asset.contentType==='string'?asset.contentType.split(';')[0].trim():raw.mime_type;
  return {title,kind:document?'document':media?'media':kind==='post'?'news':'page',category:document?'Documents':'General',route:sourceLocalPath(kind,raw,origin)||'/media/'+raw.id+'/',contentHtml:media?field(raw.description):field(raw.content),summary:plain(field(raw.excerpt)||field(raw.caption)),disposition:'retain',canonicalId:'',parentId:raw.parent?'page:'+raw.parent:'',document:media?{sourceUrl:selectedUrl,sourceMediaId:raw.id,mimeType:selectedMime||'application/octet-stream',altText:raw.alt_text||'',versionLabel:String(raw.date_gmt||raw.date||'').slice(0,10)||'Original',downloadName:decodeURIComponent(new URL(selectedUrl).pathname.split('/').pop()),familyId:id,description:plain(field(raw.description)),...fileEvidence}:null,gis:[],notice:null};
}
export function validateDraft(value,workspace,id) {
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Problem(400,'A complete draft is required.');
  const body={title:text(value.title,500,true),kind:value.kind,category:text(value.category||'General',160,true),route:routePath(value.route),contentHtml:typeof value.contentHtml==='string'?value.contentHtml:'',summary:text(value.summary||'',10000),disposition:value.disposition,canonicalId:text(value.canonicalId||'',160),parentId:text(value.parentId||'',160),document:null,gis:[],notice:null};
  if(!kinds.includes(body.kind)||!dispositions.includes(body.disposition)) throw new Problem(400,'Choose a supported content kind and disposition.');
  if(body.contentHtml.length>4*1024*1024) throw new Problem(400,'This content revision exceeds the 4 MiB limit.');
  if(body.disposition==='consolidate') { if(!body.canonicalId||body.canonicalId===id) throw new Problem(400,'Choose a different existing destination item for consolidation.'); workspace.current(body.canonicalId); }
  if(body.parentId) {if(body.parentId===id) throw new Problem(400,'An item cannot be its own parent.');workspace.current(body.parentId);}
  if(value.document) {
    body.document={sourceUrl:publicUrl(value.document.sourceUrl),sourceMediaId:Number(value.document.sourceMediaId)||null,mimeType:text(value.document.mimeType||'application/octet-stream',150,true),altText:text(value.document.altText||'',3000),versionLabel:text(value.document.versionLabel||'Original',160,true),downloadName:text(value.document.downloadName||'document',300,true),familyId:text(value.document.familyId||id,160,true),description:text(value.document.description||'',10000)};
    if(/[\/\\\x00-\x1f]/.test(body.document.downloadName)) throw new Problem(400,'The download name must be a single filename.');
    if(value.document.sha256!==undefined&&value.document.sha256!==''){if(typeof value.document.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(value.document.sha256))throw new Problem(400,'Use the SHA-256 of the exact retained file.');body.document.sha256=value.document.sha256.toLowerCase();}
    if(value.document.bytes!==undefined){if(!Number.isSafeInteger(value.document.bytes)||value.document.bytes<0)throw new Problem(400,'Use the exact nonnegative file byte count.');body.document.bytes=value.document.bytes;}
  }
  if(['document','media'].includes(body.kind)&&!body.document) throw new Problem(400,'Document and media records require the original file metadata.');
  if(!Array.isArray(value.gis||[]) || (value.gis||[]).length>30) throw new Problem(400,'Use at most 30 original GIS resources per page.');
  body.gis=(value.gis||[]).map(g=>{
    const url=publicUrl(g.url),u=new URL(url);
    if(!/(^|\.)(arcgis\.com|arcg\.is)$/.test(u.hostname)) throw new Problem(400,'GIS embeds must use an original ArcGIS host.');
    if(!/^[a-f0-9]{32}$/i.test(g.itemId||'')) throw new Problem(400,'Use the original 32-character ArcGIS item ID.');
    return {itemId:g.itemId.toLowerCase(),url,title:text(g.title,500,true),description:text(g.description||'',10000),fallbackHtml:typeof g.fallbackHtml==='string'?g.fallbackHtml:''};
  });
  if(body.kind==='notice') {
    const n=value.notice||{};
    if(!['meeting','emergency','news','general'].includes(n.type)) throw new Problem(400,'Choose a notice type.');
    const date=(v)=>{if(!v)return '';if(typeof v!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v)))throw new Problem(400,'Use timestamps with an explicit UTC offset.');return new Date(v).toISOString();};
    body.notice={type:n.type,startsAt:date(n.startsAt),endsAt:date(n.endsAt),location:text(n.location||'',1000)};
    if(body.notice.startsAt&&body.notice.endsAt&&body.notice.startsAt>=body.notice.endsAt)throw new Problem(400,'The notice end must follow its start.');
  }
  return body;
}
export function importCorpus(workspace,actor,corpus) {
  requireRole(actor,'admin');
  if(!corpus||!Array.isArray(corpus.pages)||!Array.isArray(corpus.media)||!Array.isArray(corpus.posts))throw new Problem(400,'Use the retained public WordPress corpus with pages, posts and media arrays.');
  const origin=new URL(publicUrl(corpus.site?.url||corpus.origin)).origin;
  if(origin!=='https://csktwatercompact.com')throw new Problem(400,'This project expects the original CSKT DEWR source origin.');
  const sha=digest(corpus),old=workspace.db.prepare('SELECT id FROM captures WHERE sha=?').get(sha);
  if(old)return {captureId:old.id,unchanged:true,added:0,changed:0};
  const id=randomUUID(),capturedAt=corpus.capturedAt||now(),metadata={...corpus,pages:undefined,posts:undefined,media:undefined};
  if(!Number.isFinite(Date.parse(capturedAt)))throw new Problem(400,'A source capture timestamp is required.');
  workspace.db.prepare('INSERT INTO captures VALUES(?,?,?,?,?,?,?)').run(id,sha,origin,capturedAt,now(),actor.id,pack(metadata));
  let added=0,changed=0,unchanged=0,missing=0,returned=0;const seen=new Set();
  const assets=new Map((corpus.assets||[]).filter(row=>Number.isSafeInteger(row.mediaId)).map(row=>[row.mediaId,row]));
  for(const [kind,objects]of[['page',corpus.pages],['post',corpus.posts],['media',corpus.media]])for(const raw of objects){
    if(!raw||!Number.isSafeInteger(raw.id)||raw.id<=0)throw new Problem(400,'Every original WordPress resource requires its numeric ID.');
    const itemId=kind+':'+raw.id;if(seen.has(itemId))throw new Problem(400,'Duplicate original WordPress identity: '+itemId);seen.add(itemId);
    const url=publicUrl(kind==='media'?raw.source_url:raw.link),sourceSha=digest(raw);
    if(kind!=='media'&&new URL(url).origin!==origin)throw new Problem(400,'A source page points outside the captured site.');
    const previous=workspace.db.prepare('SELECT sha,present,capture_id,presence_capture_id FROM source_heads WHERE id=?').get(itemId);
    workspace.db.prepare('INSERT OR IGNORE INTO source_versions VALUES(?,?)').run(sourceSha,pack(raw));
    workspace.db.prepare('INSERT INTO capture_items VALUES(?,?,?)').run(id,itemId,sourceSha);
    workspace.db.prepare('INSERT INTO source_heads(id,kind,wp_id,url,sha,capture_id,modified_gmt,present,presence_capture_id) VALUES(?,?,?,?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,sha=excluded.sha,capture_id=excluded.capture_id,modified_gmt=excluded.modified_gmt,present=1,presence_capture_id=excluded.presence_capture_id').run(itemId,kind,raw.id,url,sourceSha,id,raw.modified_gmt||raw.modified||null,previous?.present===1?(previous.presence_capture_id||previous.capture_id):id);
    if(!previous){workspace.newRevision(actor,itemId,sourceSha,initialDraft(kind,raw,itemId,origin,assets.get(raw.id)),'Imported the original published WordPress record.');added++;}
    else if(previous.sha!==sourceSha||previous.present===0){changed++;if(previous.present===0)returned++;workspace.event(actor,previous.present===0?'source.returned':'source.changed',itemId,{previousSha256:previous.sha,currentSha256:sourceSha,captureId:id});}
    else unchanged++;
  }
  for(const previous of workspace.db.prepare('SELECT id,sha,capture_id FROM source_heads WHERE present=1').all())if(!seen.has(previous.id)){
    workspace.db.prepare('UPDATE source_heads SET present=0,presence_capture_id=?,capture_id=? WHERE id=?').run(id,id,previous.id);missing++;
    workspace.event(actor,'source.absent',previous.id,{captureId:id,previousCaptureId:previous.capture_id,retainedSha256:previous.sha});
  }
  workspace.setMeta('latestCaptureId',id);
  if(corpus.gis)workspace.setMeta('gis',corpus.gis);
  workspace.event(actor,'source.imported',id,{sha256:sha,counts:{pages:corpus.pages.length,posts:corpus.posts.length,media:corpus.media.length},added,changed,unchanged,missing,returned});
  return {captureId:id,sha256:sha,added,changed,unchanged,missing,returned,total:seen.size};
}
export function saveDraft(workspace,actor,id,draft,note) {
  requireRole(actor,'admin','reviewer','editor');
  const current=workspace.current(id),source=workspace.source(id),body=validateDraft(draft,workspace,id);
  if(current.sourceMissing&&current.sourceChanged&&draft.acknowledgeSourceMissing!==true)throw new Problem(409,'Acknowledge the source removal before saving the chosen content disposition.','source_missing_acknowledgment',{captureId:source.presence_capture_id});
  const revisionId=workspace.newRevision(actor,id,source.sha,body,text(note,4000,true));
  if(current.sourceMissing&&current.sourceChanged)workspace.event(actor,'source.absence_acknowledged',id,{revisionId,captureId:source.presence_capture_id,sourceSha256:source.sha,disposition:body.disposition,note});
  workspace.event(actor,'draft.saved',id,{revisionId,previousRevisionId:current.revisionId,sourceSha256:source.sha});
  return {item:workspace.current(id)};
}
export function reviewItem(workspace,actor,id,decision,note) {
  const item=workspace.current(id);note=text(note,4000,true);
  if(decision==='submit'){requireRole(actor,'admin','reviewer','editor');if(!['DRAFT','CHANGES_REQUESTED'].includes(item.stage))throw new Problem(409,'This revision is already submitted or approved.');}
  else {requireRole(actor,'admin','reviewer');if(!['approve','changes'].includes(decision))throw new Problem(400,'Choose submit, approve or changes.');if(item.stage!=='IN_REVIEW')throw new Problem(409,'Submit the current content revision for review first.');}
  if(item.sourceChanged)throw new Problem(409,'The published source has changed. Save a new draft against the current source before review.','source_changed');
  if(decision==='approve'){
    validateDraft(item.draft,workspace,id);
    for(const gis of item.draft.gis)if(!plain(gis.fallbackHtml))throw new Problem(400,'Add the GIS text equivalent before approving its page.');
  }
  const stage={submit:'IN_REVIEW',approve:'APPROVED',changes:'CHANGES_REQUESTED'}[decision],reviewId=randomUUID();
  workspace.db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?)').run(reviewId,id,item.revisionId,decision,actor.id,now(),note);
  workspace.db.prepare('UPDATE items SET stage=?,updated_at=? WHERE id=?').run(stage,now(),id);
  workspace.event(actor,'review.'+decision,id,{reviewId,revisionId:item.revisionId,note});
  return {item:workspace.current(id),reviewId};
}
export function itemDetail(workspace,id) {
  const item=workspace.current(id),source=workspace.source(id);
  const revisions=workspace.db.prepare('SELECT * FROM revisions WHERE item_id=? ORDER BY number DESC').all(id).map(row=>({id:row.id,number:row.number,sourceSha256:row.source_sha,sourceBinding:row.source_binding,actor:row.actor,createdAt:row.created_at,note:row.note,draft:unpack(row.body)}));
  const reviews=workspace.db.prepare('SELECT * FROM reviews WHERE item_id=? ORDER BY created_at DESC').all(id);
  const sourceVersions=workspace.db.prepare('SELECT c.id,c.captured_at,c.origin,ci.sha FROM capture_items ci JOIN captures c ON c.id=ci.capture_id WHERE ci.source_id=? ORDER BY c.imported_at DESC').all(id);
  return {...item,original:source.original,originalSha256:source.sha,revisions,reviews,sourceVersions};
}
export function createRelease(workspace,actor,{itemIds,label,note}) {
  requireRole(actor,'admin','reviewer');text(label,200,true);text(note,4000,true);
  if(!Array.isArray(itemIds)||!itemIds.length||new Set(itemIds).size!==itemIds.length)throw new Problem(400,'Select at least one distinct reviewed item.');
  const selected=itemIds.map(id=>workspace.current(id));
  const bad=selected.filter(x=>x.stage!=='APPROVED'||x.sourceChanged);if(bad.length)throw new Problem(409,'Every included item needs approval of its current source and draft.','release_review_required',{itemIds:bad.map(x=>x.id)});
  const selectedMap=new Map(selected.map(x=>[x.id,x])),routes=new Map(),redirects=[];
  const resolveTarget=(item,trail=new Set())=>{if(trail.has(item.id))throw new Problem(400,'Consolidation contains a cycle.');trail.add(item.id);if(item.draft.disposition!=='consolidate')return item;if(!selectedMap.has(item.draft.canonicalId))throw new Problem(400,'Include the reviewed consolidation destination in this release.');return resolveTarget(selectedMap.get(item.draft.canonicalId),trail);};
  for(const item of selected){
    const body=validateDraft(item.draft,workspace,item.id),target=resolveTarget(item);
    if(target.draft.disposition==='remove'&&body.disposition==='consolidate')throw new Problem(400,'A consolidation target cannot be removed.');
    if(!['remove','consolidate'].includes(body.disposition)){
      if(routes.has(body.route))throw new Problem(400,'Two included items claim the same destination path.','route_collision',{route:body.route,itemIds:[routes.get(body.route),item.id]});
      routes.set(body.route,item.id);
    }
    const sourcePath=sourceLocalPath(item.source.kind,workspace.source(item.id).original);
    if(sourcePath&&body.disposition==='remove')redirects.push({sourcePath,targetPath:null,status:410,itemId:item.id});
    else if(sourcePath&&sourcePath!==target.draft.route)redirects.push({sourcePath,targetPath:target.draft.route,status:301,itemId:item.id});
  }
  const redirectMap=new Map(redirects.map(x=>[x.sourcePath,x]));
  for(const redirect of redirects){
    if(routes.has(redirect.sourcePath))throw new Problem(400,'A redirect would shadow a retained destination path.','redirect_collision',{path:redirect.sourcePath});
    let cursor=redirect;const seen=new Set();while(cursor?.status===301){if(seen.has(cursor.sourcePath))throw new Problem(400,'The reviewed redirect map contains a cycle.');seen.add(cursor.sourcePath);cursor=redirectMap.get(cursor.targetPath);}
  }
  const captureId=workspace.meta('latestCaptureId'),capture=workspace.db.prepare('SELECT * FROM captures WHERE id=?').get(captureId),time=now(),id=randomUUID();
  const items=selected.map(item=>{
    const review=workspace.db.prepare("SELECT * FROM reviews WHERE revision_id=? AND decision='approve' ORDER BY created_at DESC LIMIT 1").get(item.revisionId);
    return {id:item.id,source:item.source,revisionId:item.revisionId,review:{reviewer:review.actor,reviewedAt:review.created_at,note:review.note},...item.draft};
  });
  const all=workspace.allItems(),manifest={schema:SCHEMA,id,label,note,createdAt:time,createdBy:actor.id,sourceCapture:{id:capture.id,sha256:capture.sha,origin:capture.origin,capturedAt:capture.captured_at},items,redirects,coverage:{captured:all.length,approved:all.filter(x=>x.stage==='APPROVED'&&!x.sourceChanged).length,included:items.length,kinds:Object.fromEntries(kinds.map(kind=>[kind,items.filter(x=>x.kind===kind).length]))}};
  const bytes=JSON.stringify(manifest,null,2)+'\n',sha=digest(bytes);
  workspace.db.prepare('INSERT INTO releases VALUES(?,?,?,?,?,?)').run(id,sha,pack(manifest),actor.id,time,label);
  workspace.event(actor,'release.created',id,{sha256:sha,note,coverage:manifest.coverage});
  return {release:{id,sha256:sha,label,createdAt:time,coverage:manifest.coverage}};
}
export function workspaceState(workspace,actor) {
  const items=workspace.allItems(),captures=workspace.db.prepare('SELECT id,sha,origin,captured_at,imported_at,actor,metadata FROM captures ORDER BY imported_at DESC').all().map(x=>({...x,metadata:unpack(x.metadata)}));
  return {revision:workspace.revision(),user:{id:actor.id,name:actor.name,role:actor.role},csrf:actor.csrf,summary:{items:items.length,stages:Object.fromEntries(['DRAFT','IN_REVIEW','APPROVED','CHANGES_REQUESTED'].map(stage=>[stage,items.filter(x=>x.stage===stage).length])),sourceChanged:items.filter(x=>x.sourceChanged).length,kinds:Object.fromEntries(kinds.map(kind=>[kind,items.filter(x=>x.draft.kind===kind).length]))},captures,gis:workspace.meta('gis',{items:[]}),releases:workspace.listReleases(),destination:workspace.meta('destination',null),deployments:workspace.db.prepare('SELECT * FROM deployments ORDER BY started_at DESC LIMIT 60').all().map(row=>({...row,result:unpack(row.result)}))};
}
