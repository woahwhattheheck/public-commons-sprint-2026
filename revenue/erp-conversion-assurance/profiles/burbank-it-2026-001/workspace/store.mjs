// MIT. Compact append-only project journal, signed projections, immutable assets and trial snapshots.
import {mkdir,readFile,readdir,open,rename,link,unlink,lstat,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {constants} from 'node:fs';
import {acquireStateLease} from '../../../../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {ID,SHA,SECTIONS,requireValue,text,normalizeRecord,summarize} from './schema.mjs';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value)+'\n');
const clone=value=>structuredClone(value);
export async function privateDirectory(path) {
  await mkdir(path,{recursive:true,mode:0o700});const s=await lstat(path);
  requireValue(s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o077)===0&&s.uid===process.getuid(),'Use a private directory owned by the current user.');
}
export async function privateRead(path,maximum=24*1024*1024) {
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {const s=await handle.stat();requireValue(s.isFile()&&s.uid===process.getuid()&&(s.mode&0o077)===0&&s.size<=maximum,'The private file metadata changed.');return await handle.readFile();}
  finally {await handle.close();}
}
export async function atomic(path,bytes,createOnly=false) {
  const temporary=path+'.'+randomUUID()+'.tmp',handle=await open(temporary,'wx',0o600);
  try {await handle.writeFile(bytes);await handle.sync();}finally {await handle.close();}
  try {if(createOnly){await link(temporary,path);await unlink(temporary);}else await rename(temporary,path);}
  catch(error){await unlink(temporary).catch(()=>{});throw error;}
  const parent=await open(resolve(path,'..'),'r');try{await parent.sync();}finally{await parent.close();}
}
const initial=(id,metadata,catalog)=>({schema:'erp-burbank.project.v1',id,revision:0,catalogSha256:catalog.catalogSha256,
  metadata:{name:text(metadata.name??id,300),organization:text(metadata.organization??'',300),owner:text(metadata.owner??'',200),
    description:text(metadata.description??''),mode:metadata.mode==='Practice'?'Practice':'Project',notes:''},
  ...Object.fromEntries(SECTIONS.map(x=>[x,{}])),assets:{},reviews:[],handoffs:[],createdAt:new Date().toISOString(),updatedAt:''});
export async function openProjectStore(directory,catalog) {
  const root=join(resolve(directory),'burbank');await privateDirectory(root);
  for(const name of ['projects','assets','snapshots','host'])await privateDirectory(join(root,name));
  const key=await privateRead(join(resolve(directory),'hmac.key'),1024);
  const sign=value=>createHmac('sha256',key).update(json(value)).digest('hex');
  const seal=value=>json({data:value,mac:sign(value)});
  async function unseal(path) {
    const bytes=await privateRead(path),value=JSON.parse(bytes);
    requireValue(value&&value.data&&SHA.test(value.mac??'')&&timingSafeEqual(Buffer.from(value.mac,'hex'),Buffer.from(sign(value.data),'hex')),'The retained project record changed.');
    return {value:value.data,sha256:digest(bytes)};
  }
  function projectPath(id){requireValue(typeof id==='string'&&ID.test(id),'Use a stable project ID.');return join(root,'projects',id);}
  async function locked(work) {
    let lease;try{lease=await acquireStateLease(root);}catch(error){if(error.message==='FLEET_STATE_ALREADY_OWNED')throw Object.assign(new Error('Another project edit is finishing. Retry the edit.'),{status:409});throw error;}
    try{return await work();}finally{await lease.close();}
  }
  function apply(project,operations,{actor,at}) {
    const p=clone(project);
    for(const section of SECTIONS)p[section]??={};
    for(const op of operations) {
      requireValue(op&&typeof op==='object','A project operation is required.');
      if(op.type==='metadata') {
        for(const k of ['name','organization','owner','description','notes'])if(Object.hasOwn(op.values,k))p.metadata[k]=text(op.values[k],['description','notes'].includes(k)?8000:300);
      } else if(op.type==='upsert') {
        requireValue(SECTIONS.includes(op.section),'Unknown project section.');
        const row=normalizeRecord(op.section,op.record,catalog);
        for(const hash of row.assetIds??[])requireValue(p.assets[hash],'Attach the original supporting file to this project first.');
        p[op.section][row.id]={...row,updatedAt:at,updatedBy:actor};
      } else if(op.type==='remove') {
        requireValue(SECTIONS.includes(op.section)&&ID.test(op.id),'Unknown project record.');delete p[op.section][op.id];
      } else if(op.type==='asset') {
        requireValue(SHA.test(op.asset.sha256)&&Number.isSafeInteger(op.asset.bytes),'The attachment identity is invalid.');p.assets[op.asset.sha256]=op.asset;
      } else if(op.type==='review') {
        const r=op.record;
        requireValue(ID.test(r.id??'')&&['requirements','interfaces','project'].includes(r.section),'Choose a valid review target.');
        const selection=r.ids??[];requireValue(Array.isArray(selection)&&selection.length<=1000,'Select the reviewed records.');
        if(r.section!=='project')for(const id of selection)requireValue((r.section==='requirements'?catalog.requirementIds:catalog.interfaceIds).has(id),'A reviewed source record is unknown.');
        requireValue(['Accepted','Needs correction','Reviewed'].includes(r.decision),'Choose a review decision.');
        requireValue(text(r.comment??'').length>0,'Record the reviewer rationale.');
        p.reviews.push({id:r.id,section:r.section,ids:[...new Set(selection)],decision:r.decision,comment:text(r.comment),
          reference:r.reference??null,reviewer:actor,at});
      } else if(op.type==='handoff')p.handoffs.push(op.record);
      else throw new Error('Unknown project operation.');
    }
    requireValue(Object.values(p.phases).length<=10,'The native staffing response has at most 10 phases.');
    for(const section of SECTIONS)requireValue(Object.keys(p[section]).length<=2000,'This project section exceeds 2,000 records.');
    requireValue(json(p).length<=12*1024*1024,'The project exceeds its 12 MiB control-data limit.');
    p.updatedAt=at;return p;
  }
  async function load(id) {
    const dir=projectPath(id);let project=null,last='';
    try {const sealed=await unseal(join(dir,'head.json'));project=sealed.value.project;last=sealed.value.eventSha256;}
    catch(error){if(error.code!=='ENOENT')throw error;}
    const names=(await readdir(join(dir,'events'))).filter(x=>/^\d{8}\.json$/.test(x)).sort();
    if(project) {
      requireValue(project.id===id&&project.catalogSha256===catalog.catalogSha256,'Reopen with the original project source catalog.');
      const original=await unseal(join(dir,'events',String(project.revision).padStart(8,'0')+'.json'));
      requireValue(original.sha256===last,'The projected journal identity changed.');
    }
    for(const name of names.filter(x=>Number(x.slice(0,8))>(project?.revision??0))) {
      const event=await unseal(join(dir,'events',name)),e=event.value;
      requireValue(e.projectId===id&&e.revision===(project?.revision??0)+1&&e.previous===last,'The project journal sequence changed.');
      if(e.revision===1){requireValue(!project&&e.initial,'The initial project is missing.');project=e.initial;}
      project=apply(project,e.operations,{actor:e.actor,at:e.at});project.revision=e.revision;last=event.sha256;
    }
    requireValue(project,'The project was not found.');return {project,eventSha256:last};
  }
  async function commit(id,expectedRevision,actor,operations,create=null) {
    return locked(async()=>{
      requireValue(text(actor??'',200).length>0,'Enter the operator or reviewer name.');
      requireValue(Array.isArray(operations)&&operations.length<=1200,'Use a valid batch of project edits.');
      const dir=projectPath(id);let before;
      if(create){await mkdir(dir,{mode:0o700});await privateDirectory(join(dir,'events'));before={project:initial(id,create,catalog),eventSha256:''};}
      else before=await load(id);
      requireValue(Number.isSafeInteger(expectedRevision)&&before.project.revision===expectedRevision,
        'This project changed in another view. Reload the current project before saving.');
      const at=new Date().toISOString(),project=apply(before.project,operations,{actor,at});project.revision++;
      const event={schema:'erp-burbank.project-event.v1',projectId:id,revision:project.revision,previous:before.eventSha256,
        actor:text(actor,200),at,...(create?{initial:before.project}:{}),operations};
      const bytes=seal(event),eventSha256=digest(bytes);
      await atomic(join(dir,'events',String(project.revision).padStart(8,'0')+'.json'),bytes,true);
      // The signed event is the commit point. A lost projection is replayed from it.
      await atomic(join(dir,'head.json'),seal({project,eventSha256}));return clone(project);
    });
  }
  async function get(id) {return clone((await load(id)).project);}
  async function list() {
    const result=[];for(const id of (await readdir(join(root,'projects'))).filter(x=>ID.test(x)).sort()) {
      const p=await get(id);result.push({id,name:p.metadata.name,mode:p.metadata.mode,revision:p.revision,owner:p.metadata.owner,updatedAt:p.updatedAt});
    }return result;
  }
  async function snapshot(id,expectedRevision) {
    return locked(async()=>{
      const retained=await load(id);requireValue(retained.project.revision===expectedRevision,'Reload the current project before staging this trial.');
      const value={schema:'erp-burbank.project-snapshot.v1',...retained,catalogPins:catalog.pins},bytes=seal(value),sha256=digest(bytes);
      try{await atomic(join(root,'snapshots',sha256+'.json'),bytes,true);}catch(error){if(error.code!=='EEXIST')throw error;}
      return {sha256,...value};
    });
  }
  async function getSnapshot(hash) {
    requireValue(SHA.test(hash??''),'Select an original project snapshot.');
    const r=await unseal(join(root,'snapshots',hash+'.json'));requireValue(r.sha256===hash,'The project snapshot changed.');return {sha256:hash,...clone(r.value)};
  }
  async function putAsset({projectId,revision,actor,name,kind='supporting',bytes}) {
    requireValue(Buffer.isBuffer(bytes)&&bytes.length<=25*1024*1024,'The attachment must be at most 25 MiB.');
    requireValue(['supporting','requirements-template','interfaces-template','staffing-template','price-template','native-interface'].includes(kind),'Choose a valid attachment kind.');
    const sha256=digest(bytes),path=join(root,'assets',sha256);
    try{await atomic(path,bytes,true);}catch(error){if(error.code!=='EEXIST')throw error;const retained=await privateRead(path,25*1024*1024);requireValue(digest(retained)===sha256,'The retained attachment changed.');}
    const asset={sha256,bytes:bytes.length,name:text(name,240),kind,addedBy:text(actor,200),addedAt:new Date().toISOString()};
    const project=await commit(projectId,revision,actor,[{type:'asset',asset}]);return {project,asset};
  }
  async function readAsset(projectId,hash) {
    requireValue(SHA.test(hash??''),'Choose an original attachment.');const project=await get(projectId),asset=project.assets[hash];
    requireValue(asset,'The attachment is not in this project.');const bytes=await privateRead(join(root,'assets',hash),25*1024*1024);
    requireValue(bytes.length===asset.bytes&&digest(bytes)===hash,'The retained attachment changed.');return {asset,bytes};
  }
  return {root,catalog,get,list,commit,snapshot,getSnapshot,putAsset,readAsset,
    create:({id,metadata,actor})=>commit(id,0,actor,[],metadata),
    async view(id){const project=await get(id);return {project,summary:summarize(project,catalog)};},
    async history(id){const dir=projectPath(id),names=(await readdir(join(dir,'events'))).filter(x=>/^\d{8}\.json$/.test(x)).sort();const result=[];
      for(const name of names){const r=await unseal(join(dir,'events',name));result.push({revision:r.value.revision,at:r.value.at,actor:r.value.actor,operations:r.value.operations,sha256:r.sha256});}return result;},
  };
}
