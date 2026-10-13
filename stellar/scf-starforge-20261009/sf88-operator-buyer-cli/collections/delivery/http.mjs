// MIT. Routes behind the original Collections bearer/host/origin checks.
import { join } from 'node:path';
import { openCustomerDelivery } from './model.mjs';
import { openUploads, UPLOAD_BATCH_CHUNKS } from './uploads.mjs';
import { need } from './format.mjs';
export function customerDeliveryRoutes({getCollections,receivingDirectory,mutate,jsonBody,downloadFile}){
 let binding=null,selectedCollections=null,model=null,uploads=null,opening=Promise.resolve();
 async function controller(){
  const collections=getCollections(),directory=join(collections?.directory??receivingDirectory,'customer-delivery');
  const current=opening.then(async()=>{
   if(binding!==directory||selectedCollections!==collections){
    await model?.close();
    const next=await openCustomerDelivery({collections,directory});
    try{const nextUploads=await openUploads(join(directory,'uploads'));model=next;uploads=nextUploads;binding=directory;selectedCollections=collections;}
    catch(error){await next.close();throw error;}
   }
   return model;
  });
  opening=current.catch(()=>{});return current;
 }
 const fields=(value,names)=>{need(value&&Object.keys(value).every(k=>names.includes(k)),'CUSTOMER_DELIVERY_FIELDS');return value;};
 const project=value=>{if(value?.request){const {sourceRoot,sourceManifest,packetDirectory,...safe}=value.request;return{...value,request:safe};}return value;};
 const download=async(response,file)=>downloadFile(response,{...file,name:file.filename??file.name??'customer-delivery.ndjson'});
 async function route({request,response,url,send}){
  if(!url.pathname.startsWith('/api/customer-delivery/'))return false;
  const desk=await controller(),path=url.pathname.slice('/api/customer-delivery/'.length);
  const progressOptions=url.searchParams.get('progress')==='compact'?{includeParts:false}:{};
  if(path==='status'&&request.method==='GET'){send({schema:'stellar-forge.sf88.customer-delivery-status.v1',scope:binding,canPrepare:Boolean(getCollections()),canPrepareTask:true,uploadBatchChunks:UPLOAD_BATCH_CHUNKS,...(await desk.list())});return true;}
  if(['task-inspect','task-preview','task-prepare'].includes(path)&&request.method==='POST'){
   const input=fields(await jsonBody(request),path==='task-inspect'?['packetDirectory','expectedTaskSha256']:['kind','id','packetDirectory','expectedTaskSha256','title','note','intentIds','sourceRoot','sourceManifest',...(path==='task-prepare'?['expectedPreviewSha256']:[])]);
   const method={'task-inspect':'inspectTask','task-preview':'previewTask','task-prepare':'prepareTask'}[path];
   send(project(await mutate(()=>desk[method](input))),path==='task-prepare'?201:200);return true;
  }
  if(['preview','prepare'].includes(path)&&request.method==='POST'){
   const input=fields(await jsonBody(request),['id','collectionId','expectedManifestSha256','title','note','intentIds','sourceRoot','sourceManifest','maxVerifyBytes','allowIncomplete',...(path==='prepare'?['expectedPreviewSha256']:[])]);
   send(project(await mutate(()=>desk[path](input))),path==='prepare'?201:200);return true;
  }
  let match=/^deliveries\/([A-Za-z0-9._-]{1,100})(?:\/(file))?$/.exec(path);
  if(match&&request.method==='GET'){if(match[2])await download(response,await desk.download(match[1]));else send(project(await desk.inspect(match[1])));return true;}
  if(path==='uploads'&&request.method==='POST'){const input=fields(await jsonBody(request),['sha256','bytes','filename']);send(await mutate(()=>uploads.start(input,progressOptions)),201);return true;}
  match=/^uploads\/([a-f0-9]{64})(?:\/(chunk|chunks|finish|receive))?$/.exec(path);
  if(match){
   if(request.method==='GET'&&!match[2]){send(await uploads.inspect(match[1],progressOptions));return true;}
   need(request.method==='POST','CUSTOMER_DELIVERY_METHOD_REQUIRED');const input=await jsonBody(request,match[2]==='chunks'?2*1024*1024:undefined);
   if(match[2]==='chunk')send(await mutate(()=>uploads.chunk(match[1],fields(input,['offset','base64','sha256']),progressOptions)));
   else if(match[2]==='chunks'){fields(input,['chunks']);need(Array.isArray(input.chunks),'CUSTOMER_DELIVERY_UPLOAD_BATCH');for(const part of input.chunks)fields(part,['offset','base64','sha256']);send(await mutate(()=>uploads.chunks(match[1],input,progressOptions)));}
   else if(match[2]==='finish'){fields(input,[]);const {file,...safe}=await mutate(()=>uploads.finish(match[1],progressOptions));send(safe);}
   else if(match[2]==='receive'){fields(input,[]);const result=await mutate(async()=>{const complete=await uploads.finish(match[1],{includeParts:false});return desk.receive({file:complete.file,expectedSha256:match[1]});});const {directory,...safe}=result;send(safe,201);}
   else need(false,'CUSTOMER_DELIVERY_ROUTE_NOT_FOUND');
   return true;
  }
  if(path==='received'&&request.method==='GET'){send(await desk.listReceived());return true;}
  match=/^received\/([a-f0-9]{64})(?:\/(member|file))?$/.exec(path);
  if(match&&request.method==='GET'&&!match[2]){send(await desk.received(match[1]));return true;}
  if(match?.[2]==='file'&&request.method==='GET'){await download(response,await desk.receivedPackage(match[1]));return true;}
  if(match?.[2]==='member'&&request.method==='POST'){const input=fields(await jsonBody(request),['path']);await download(response,await desk.member(match[1],input.path));return true;}
  need(false,'CUSTOMER_DELIVERY_ROUTE_NOT_FOUND');
 }
 return{route,async close(){await opening;await model?.close();}};
}
