// MIT. Original Research host owns this complete publication/receiving controller.
import {join} from 'node:path';
import {openResearchSource} from '../workspace-files.mjs';
import {readCommerceConfiguration,commerceConfigurationView} from './configuration.mjs';
import {prepareResearchPublication,enrollResearchPublication,researchPublication,researchPublicationFile} from './publication.mjs';
import {ResearchCommerceBuyer} from './buyer.mjs';
import {COMMERCE_SCHEMA,fields,identifier,need,copy,publicationRequest} from './contracts.mjs';
import {ensureCommerceRoot,commercePath,commerceInventory,customerDirectory} from './files.mjs';

export async function openResearchCustomerCommerce({directory,workspaceId,configurationFile=null,client,environment=process.env}={}){
 need(typeof client==='function'&&/^research_[a-f0-9]{64}$/.test(workspaceId??''),'RESEARCH_COMMERCE_ORIGINAL_WORKSPACE_REQUIRED');
 const root=await ensureCommerceRoot(directory),configuration=()=>readCommerceConfiguration(configurationFile),
  buyer=new ResearchCommerceBuyer({configuration,client,workspaceId}),pending=new Set(),sources=new Set(),clients=new Set(),cleanupOwners=new Set();
 let stopping=false,closing;
 function run(work){
  need(!stopping,'RESEARCH_COMMERCE_CLOSING');need(pending.size<32,'RESEARCH_COMMERCE_REQUEST_CAPACITY');
  const operation=Promise.resolve().then(work).catch(error=>{
   if(typeof error?.close==='function')cleanupOwners.add(error);
   throw error;
  });pending.add(operation);
  operation.finally(()=>pending.delete(operation)).catch(()=>{});return operation;
 }
 const path=(kind,id)=>commercePath(root,kind,id);
 async function originalClient(work){
  const original=await client();clients.add(original);let failure;
  try{return await work(original);}
  catch(error){failure=error;throw error;}
  finally{
   try{await original.close();clients.delete(original);}
   catch(error){
    if(failure)failure.researchCommerceClose=error.code??'RESEARCH_COMMERCE_RESEARCH_CLOSE_INCOMPLETE';
    else throw Object.assign(error,{outcomeUnknown:true,retainedDirectory:root});
   }
  }
 }
 async function selectedDirectory(kind,id){
  return customerDirectory(path(kind,id),{create:false});
 }
 async function selectFile({kind,id,file}){
  const directory=await selectedDirectory(kind,id);
  return kind==='publications'?researchPublicationFile(directory,file):buyer.file({directory,id,kind:file});
 }
 async function stream({kind,id,file},consume){
  need(typeof consume==='function','RESEARCH_COMMERCE_FILE_CONSUMER_REQUIRED');
  const selected=await selectFile({kind,id,file});
  const source=await openResearchSource(selected.path,selected.bytes||1,{sha256:selected.sha256});
  sources.add(source);let failure;
  try{
   need(source.bytes===selected.bytes,'RESEARCH_COMMERCE_RETAINED_FILE_CHANGED');
   return await consume({...source,name:selected.name,contentType:selected.contentType});
  }catch(error){failure=error;throw error;}
  finally{
   try{await source.close();sources.delete(source);}
   catch(error){
    if(failure)failure.researchCommerceClose=error.code??'RESEARCH_COMMERCE_SOURCE_CLOSE_INCOMPLETE';
    else throw error;
   }
  }
 }
 return {
  directory:root,workspaceId,configured:configurationFile!==null,
  configuration:()=>run(async()=>({workspaceId,...await commerceConfigurationView(await configuration(),{environment})})),
  list:(kind,query={})=>{const selected=copy(query);return run(async()=>({schema:COMMERCE_SCHEMA,workspaceId,
   ...await commerceInventory(root,kind,selected)}));},
  publication:id=>{identifier(id);return run(()=>researchPublication(path('publications',id)));},
  preparePublication:input=>{
   const selected=publicationRequest(input);
   return run(()=>originalClient(async original=>prepareResearchPublication({directory:path('publications',selected.requestId),
    client:original,configuration:await configuration(),input:selected,environment})));
  },
  enrollPublication:input=>{
   const selected=copy(input);identifier(selected?.id);
   return run(async()=>enrollResearchPublication({directory:path('publications',selected.id),
    configuration:await configuration(),input:selected,environment}));
  },
  receivePurchase:input=>{
   const selected=copy(input);identifier(selected?.requestId);
   return run(()=>buyer.receive({directory:path('purchases',selected.requestId),input:selected}));
  },
  preparePurchase:input=>{
   const selected=copy(input);identifier(selected?.id);
   return run(()=>buyer.prepare({directory:path('purchases',selected.id),input:selected}));
  },
  purchase:(id,{refresh=false}={})=>{
   identifier(id);return run(()=>buyer.inspect({directory:path('purchases',id),id,refresh}));
  },
  purchaseAction:(kind,input)=>{
   const selected=copy(input);identifier(selected?.id);
   return run(()=>buyer.action({directory:path('purchases',selected.id),kind,input:selected}));
  },
  receiveDossier:input=>{
   const selected=copy(input);identifier(selected?.id);
   return run(()=>buyer.receiveDossier({directory:path('purchases',selected.id),input:selected}));
  },
  reconcilePurchase:input=>{
   const selected=copy(input);identifier(selected?.id);
   return run(()=>buyer.reconcile({directory:path('purchases',selected.id),input:selected}));
  },
  fileInfo:selection=>{
   const selected=copy(selection);fields(selected,['kind','id','file']);identifier(selected.id);
   need(['publications','purchases'].includes(selected.kind),'RESEARCH_COMMERCE_COLLECTION_INVALID');
   return run(async()=>{const file=await selectFile(selected);
    return {schema:'sf88-research-commerce-file/v1',workspaceId,...selected,
     descriptor:{name:file.name,bytes:file.bytes,sha256:file.sha256,contentType:file.contentType}};});
  },
  streamFile:(selection,consume)=>{
   const selected=copy(selection);fields(selected,['kind','id','file']);identifier(selected.id);
   need(['publications','purchases'].includes(selected.kind),'RESEARCH_COMMERCE_COLLECTION_INVALID');
   return run(()=>stream(selected,consume));
  },
  close(){
   if(closing)return closing;stopping=true;
   return closing=(async()=>{
    // Accepted operations include complete HTTP file streams and their original closers.
    await Promise.allSettled([...pending]);
    const failures=[];
    try{await buyer.close();}catch(error){failures.push(error);}
    for(const source of [...sources])try{await source.close();sources.delete(source);}catch(error){failures.push(error);}
    for(const original of [...clients])try{await original.close();clients.delete(original);}catch(error){failures.push(error);}
    for(const owner of [...cleanupOwners])try{await owner.close();cleanupOwners.delete(owner);}catch(error){failures.push(error);}
    if(failures.length){
     const [failure,...additional]=failures;
     if(additional.length)failure.researchCommerceCloseErrors=additional;
     throw failure;
    }
   })().catch(error=>{closing=null;throw error;});
  },
 };
}
