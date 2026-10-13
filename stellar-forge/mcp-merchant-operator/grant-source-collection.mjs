// MIT. Original collection engine and complete browser copies on the existing Grant owner.
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {InstallationSourceCollectionStore,SOURCE_COLLECTION_MAX_COPY_BYTES}
  from '../../stellar/scf_2026/sf47_budget_model/workspace/installation-source-collection-store.mjs';
import {initializeInstallationSourceCollection,openInstallationSourceCollection,performInstallationSourceCollection,
  SOURCE_COLLECTION_ACTIONS} from '../../stellar/scf_2026/sf47_budget_model/workspace/installation-source-collection-session.mjs';
const prefix='source_collection_';
export const grantSourceCollectionVerbs=new Set(['create','import','inspect','history','export','pause',
  ...Object.keys(SOURCE_COLLECTION_ACTIONS)].map(name=>prefix+name));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const decode=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
const need=(ok,message,code='GRANT_SOURCE_COLLECTION_INPUT')=>{
  if(!ok)throw Object.assign(new Error(message),{code});
};
const collectionId=value=>{
  need(typeof value==='string'&&/^collection-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value),
    'Use the same declared collection identity for this complete durable copy.');return value;
};
const selected=(args,...keys)=>Object.fromEntries(keys.filter(key=>args[key]!==undefined).map(key=>[key,args[key]]));
export async function executeGrantSourceCollectionTool(verb,args,ctx){
  need(grantSourceCollectionVerbs.has(verb),'Choose an original collection tool.');
  const action=verb.slice(prefix.length),id=collectionId(args.collectionId),key=ctx.alias+':'+id;
  const context={actor:args.actor,...selected(args,'note')};
  need(typeof context.actor==='string'&&context.actor.trim(),'Name the original recording operator.');
  const active=ctx.pending.get(key);
  const retain=async value=>{
    const bytes=Buffer.from(JSON.stringify(value)+'\n');
    return ctx.retain({value,bytes,mediaType:'application/json',filename:id+'-'+action+'.json',
      source:{workspaceDirectory:ctx.binding.directory,collectionId:id},status:200},
      {kind:'source-collection',collectionId:id,action,copyId:value.copyId,sequence:value.sequence});
  };
  if(action==='pause'){
    need(active?.agent,'This receiving collection has no active request on this host.');
    return retain(active.agent.pause());
  }
  if(action==='inspect'&&active?.agent)return retain(active.agent.inspect());
  need(!active,'This original collection has an active operation; inspect or pause it before another operation.',
    'GRANT_SOURCE_COLLECTION_BUSY');
  const operation={agent:null};ctx.pending.set(key,operation);
  try{
    const root=await ctx.directory(join(await ctx.root(),'source-collections')),directory=join(root,id);
    let session;
    if(action==='create'||action==='import'){
      let workingCopy,originalBytes;
      if(action==='import'){
        const original=await ctx.load(args.input,args.expectedInputSha256,SOURCE_COLLECTION_MAX_COPY_BYTES);
        need(original.bytes.length<=SOURCE_COLLECTION_MAX_COPY_BYTES,'Keep the complete browser copy within512 MiB.');
        originalBytes=original.bytes;workingCopy=decode(originalBytes);
      }
      if(action==='create')await ctx.client.open({expectedSelectionSha256:ctx.binding.selectionSha256});
      session=await initializeInstallationSourceCollection({directory,workspaceDirectory:ctx.binding.directory,
        client:ctx.client,context,workingCopy,originalBytes,...selected(args,'caseId','draftId','name','staffContext')});
      operation.agent=session.agent;return retain(session.agent.inspect());
    }
    if(action==='history'||action==='export'){
      const store=await new InstallationSourceCollectionStore({directory,workspaceDirectory:ctx.binding.directory}).init();
      if(action==='history')return retain(await store.history());
      const bytes=await store.export(args.sequence===undefined?{}:{sequence:args.sequence});
      return ctx.retain({bytes,mediaType:'application/json',filename:id+'-working-copy.json',status:200,
        source:{workspaceDirectory:ctx.binding.directory,collectionId:id}},
        {kind:'source-collection-working-copy',collectionId:id,sequence:args.sequence??null});
    }
    if(action!=='inspect')need(Number.isSafeInteger(args.expectedSequence)&&args.expectedSequence>=0,
      'Choose the current complete working-copy sequence before a change.');
    session=await openInstallationSourceCollection({directory,workspaceDirectory:ctx.binding.directory,
      client:ctx.client,context,...selected(args,'expectedSequence')});operation.agent=session.agent;
    if(action==='inspect')return retain(session.agent.inspect());
    let value;
    if(action==='stage'){
      need(Array.isArray(args.files)&&args.files.length>0,'Choose the complete original file selection.');
      const files=[];let total=0;
      for(const row of args.files){
        const original=await ctx.load(row.input,row.expectedInputSha256,8*1024*1024);
        const bytes=original.bytes;total+=bytes.length;
        need(bytes.length>0&&bytes.length<=8*1024*1024&&total<=64*1024*1024&&hash(bytes)===row.expectedInputSha256,
          'Keep every complete original staged file within its exact byte and SHA selection.');
        files.push({name:row.name,type:row.type,lastModified:row.lastModified??0,bytes:bytes.length,
          sha256:row.expectedInputSha256,contentBase64:bytes.toString('base64')});
      }
      value={files};
    }else if(action==='start')value=selected(args,'title','sourceUrl','observedAt');
    else if(action==='edit')value=selected(args,'rowId','field','value');
    else if(action==='use_existing')value={rowId:args.rowId,selection:args.selection};
    else if(action==='clear_existing')value={rowId:args.rowId};
    else if(action==='receive'){
      need(typeof args.expectedSignature==='string','Choose the exact original collection review signature.');
      value={expectedSignature:args.expectedSignature};
    }else if(action==='reconcile')value={retry:args.retry===true};
    else value={};
    if(['refresh','review','receive','reconcile','retire_rejected','use_existing'].includes(action))
      await ctx.client.open({expectedSelectionSha256:ctx.binding.selectionSha256});
    return retain(await performInstallationSourceCollection(session.agent,action,value));
  }finally{if(ctx.pending.get(key)===operation)ctx.pending.delete(key);}
}
