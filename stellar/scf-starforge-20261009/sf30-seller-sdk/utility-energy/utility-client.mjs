// MIT. Complete customer/agent access to the original private utility operator.
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, open, rename, rm } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const digest=data=>createHash('sha256').update(data).digest('hex');
const fail=message=>new Error(message);
async function privateConnection(path){
  const absolute=resolve(path),info=await lstat(absolute);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>4096||
    process.platform!=='win32'&&((info.mode&0o077)!==0||info.uid!==process.getuid()))
    throw fail('Select the private one-line connection file written by the running utility operator.');
  const raw=(await readFile(absolute,'utf8')).trim(),url=new URL(raw);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||
    url.pathname!=='/'||url.search||!url.port||!/^[A-Za-z0-9_-]{40,100}$/.test(url.hash.slice(1)))
    throw fail('Use the original loopback utility connection.');
  return {origin:url.origin,token:url.hash.slice(1)};
}
export async function openUtilityWorkspace({connectionFile}={}){
  if(typeof connectionFile!=='string')throw fail('Choose the original private utility connection file.');
  const connection=await privateConnection(connectionFile);
  const fetchOriginal=async(path,{method='GET',body,headers={},timeout=180000}={})=>{
    if(!path.startsWith('/api/'))throw fail('Select an original utility API route.');
    const response=await fetch(connection.origin+path,{method,body,headers:{Authorization:'Bearer '+connection.token,...headers},
      redirect:'error',signal:AbortSignal.timeout(timeout)});
    if(!response.ok){
      const error=await response.text();
      let message=error;try{message=JSON.parse(error).error||error;}catch{}
      throw fail('Utility operator '+response.status+': '+message);
    }
    return response;
  };
  const read=async(path,query={})=>{
    const suffix=new URLSearchParams(Object.entries(query).filter(([,value])=>value!==undefined&&value!==null));
    const response=await fetchOriginal(path+(suffix.size?'?'+suffix:''));
    return response.json();
  };
  const state=()=>read('/api/state');
  const act=async(action,payload={},options={})=>{
    if(typeof action!=='string'||!object(payload))throw fail('Supply a named utility operation and object payload.');
    const revision=options.expectedRevision??(await state()).revision;
    const requestId=options.requestId??randomUUID();
    const response=await fetchOriginal('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action,payload,expected_revision:revision,request_id:requestId})});
    return response.json();
  };
  const upload=async({file,provider='auto',kind='auto',name,context={},restore=false,expectedRevision,requestId}={})=>{
    const path=resolve(file),info=await lstat(path);
    if(!info.isFile()||info.isSymbolicLink()||info.size>(restore?2*1024*1024*1024:256*1024*1024))
      throw fail('Choose an original source file within the receiving capacity.');
    const revision=expectedRevision??(await state()).revision;
    const headers={'Content-Length':String(info.size),'X-Utility-Revision':String(revision),
      'X-Utility-Request-Id':requestId??randomUUID()};
    if(!restore)Object.assign(headers,{'X-Utility-Name':encodeURIComponent(name??basename(path)),
      'X-Utility-Provider':provider,'X-Utility-Kind':kind,'X-Utility-Context':encodeURIComponent(JSON.stringify(context))});
    const handle=await open(path,'r');
    try{
      const response=await fetch(connection.origin+(restore?'/api/restore':'/api/upload'),{
        method:'POST',headers:{Authorization:'Bearer '+connection.token,...headers},
        body:handle.createReadStream({autoClose:false}),duplex:'half',redirect:'error',signal:AbortSignal.timeout(300000)});
      if(!response.ok)throw fail('Utility receiving '+response.status+': '+await response.text());
      return response.json();
    }finally{await handle.close();}
  };
  const download=async({route,query={},out,expected}={})=>{
    const destination=resolve(out),staging=join(dirname(destination),'.'+basename(destination)+'-'+randomUUID()+'.part');
    try{await lstat(destination);throw fail('Choose a new receiving filename for this original download.');}
    catch(error){if(error.code!=='ENOENT')throw error;}
    const suffix=new URLSearchParams(query),response=await fetchOriginal(route+(suffix.size?'?'+suffix:''),{timeout:300000});
    const file=await open(staging,'wx',0o600),hash=createHash('sha256');let bytes=0;
    try{
      for await(const block of response.body){
        bytes+=block.length;if(bytes>2*1024*1024*1024)throw fail('The original download exceeds 2 GiB.');
        hash.update(block);await file.writeFile(block);
      }
      const sha256=hash.digest('hex');
      if(expected&&(expected.bytes!==bytes||expected.sha256!==sha256))throw fail('Original download differs from its retained file identity.');
      await file.sync();await file.close();
      // Link publication refuses an existing file created by another receiver.
      const {link}=await import('node:fs/promises');await link(staging,destination);await rm(staging);
      return {path:destination,bytes,sha256};
    }catch(error){await file.close().catch(()=>{});await rm(staging,{force:true});throw error;}
  };
  return Object.freeze({
    origin:connection.origin,state,act,read,upload,
    restore:(file,options={})=>upload({file,restore:true,...options}),
    imports:()=>state().then(value=>value.imports),
    source:id=>read('/api/import',{id}),record:id=>read('/api/record',{id}),
    records:query=>read('/api/records',query),series:imports=>read('/api/series',{imports:imports?.join(',')}),
    preview:(selection,options)=>act('analysis.preview',selection,options),
    review:(decision,options)=>act('review.save',decision,options),
    build:(reviewId,options)=>act('edition.build',{review_id:reviewId},options),
    query:(buildId,query,options)=>act('dataset.query',{build_id:buildId,query},options),
    compare:(before,after,options)=>act('edition.compare',{before_id:before,after_id:after},options),
    changes:(id,offset=0,limit=100)=>read('/api/changes',{id,offset,limit}),
    reconcile:(reviewId,billSeries={},options)=>act('bills.reconcile',{review_id:reviewId,bill_series:billSeries},options),
    export:(reviewId,options)=>act('package.export',{review_id:reviewId},options),
    exportManifest:id=>read('/api/export',{id}),
    downloadDelivery:(id,out)=>download({route:'/api/export-zip',query:{id},out}),
    downloadWorkspace:out=>download({route:'/api/portable',out}),
    downloadFile:async(id,name,out)=>{
      const manifest=await read('/api/export',{id}),selected=manifest.files.find(item=>item.name===name);
      if(!selected)throw fail('Choose a file declared in the original customer delivery.');
      return download({route:'/api/export-file',query:{id,name},out,expected:selected});
    },
    publisherState:()=>read('/api/publisher-state'),
    operation:id=>read('/api/operation',{id})
  });
}
