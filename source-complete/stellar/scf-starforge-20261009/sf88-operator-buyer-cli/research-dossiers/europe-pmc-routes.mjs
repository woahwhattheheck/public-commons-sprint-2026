// MIT. The Europe PMC workbench shares the original authenticated Research listener.
import {join,resolve} from 'node:path';
import {privateDirectory,readJson,readBytes,writeJson,writeBytes,exists} from '../node/store.mjs';
import {withPrivateLock} from '../../sf30-seller-sdk/routescan/quota.mjs';
import {openEuropePmcWorkspace,restoreEuropePmcWorkspace} from './europe-pmc-workspace.mjs';
import {need,object,canonical,sha256,jsonBytes} from '../../sf30-seller-sdk/europe-pmc/source.mjs';

const RESTORE_LIMIT=128*1024*1024, IMPORT_BODY_LIMIT=48*1024*1024, CONTROL_LIMIT=4*1024*1024;
const identity=value=>sha256(Buffer.from(canonical(value)));
const requestId=value=>{need(typeof value==='string'&&/^[A-Za-z0-9._:-]{8,160}$/.test(value),'EUROPE_PMC_REQUEST_ID_REQUIRED');return value;};
const actor=value=>{need(typeof value==='string'&&value.trim()&&value.length<=200,'EUROPE_PMC_ACTOR_REQUIRED');return value;};
const selectedName=value=>{need(typeof value==='string'&&/^(?:original|received-[a-f0-9]{64})$/.test(value),'EUROPE_PMC_SELECTED_LIBRARY_INVALID');return value;};
async function exact(path,bytes) {
  try{await writeBytes(path,bytes,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;need((await readBytes(path,bytes.length)).equals(bytes),'EUROPE_PMC_RECEIVING_FILE_CHANGED');}
}
export async function openEuropePmcController({directory,dossiers,fetchImpl=globalThis.fetch,rateDirectory=null,requestIntervalMs=1000}={}) {
  directory=await privateDirectory(resolve(directory));
  const libraries=await privateDirectory(join(directory,'libraries')),receiving=await privateDirectory(join(directory,'receiving'));
  const providerRate=rateDirectory?resolve(rateDirectory):join(directory,'provider-rate'),pointer=join(directory,'selected.json');
  if(!await exists(pointer))await withPrivateLock(directory,'selection.lock',async()=>{
    if(!await exists(pointer))await writeJson(pointer,{schema:'stellar-forge.europe-pmc-selection.v1',library:'original'},{exclusive:true});
  });
  const loadSelection=async()=>{const value=await readJson(pointer,32768);need(value.schema==='stellar-forge.europe-pmc-selection.v1','EUROPE_PMC_SELECTION_CHANGED');
    selectedName(value.library);return value;};
  let selected=await loadSelection(),workspace=await openEuropePmcWorkspace({directory:join(libraries,selected.library),dossiers,fetchImpl,
    rateDirectory:providerRate,requestIntervalMs}),closed=false,serial=Promise.resolve();
  const pending=new Set();
  function invoke(work) {need(!closed,'EUROPE_PMC_WORKSPACE_CLOSED');const promise=Promise.resolve().then(work);
    pending.add(promise);promise.finally(()=>pending.delete(promise)).catch(()=>{});return promise;}
  async function restore({requestId:originalRequest,actor:operator,bytes,expectedSha256}) {
    requestId(originalRequest);actor(operator);
    need(bytes instanceof Uint8Array&&bytes.length<=RESTORE_LIMIT&&typeof expectedSha256==='string'&&/^[a-f0-9]{64}$/.test(expectedSha256),
      'EUROPE_PMC_RESTORE_INPUT_INVALID');
    const data=Buffer.from(bytes);need(sha256(data)===expectedSha256,'EUROPE_PMC_RESTORE_INPUT_CHANGED');
    const input={requestId:originalRequest,actor:operator,sha256:expectedSha256,bytes:data.length},
      fingerprint=identity(input),name=identity(originalRequest),path=await privateDirectory(join(receiving,name));
    const perform=()=>withPrivateLock(directory,'selection.lock',async()=>{
      let prepared;
      if(await exists(join(path,'request.json'))) {
        prepared=await readJson(join(path,'request.json'),32768);need(prepared.fingerprint===fingerprint,'EUROPE_PMC_REQUEST_ID_REUSED');
      } else {prepared={input,fingerprint,createdAt:new Date().toISOString()};await exact(join(path,'request.json'),jsonBytes(prepared));}
      const library='received-'+name,receiptPath=join(path,'receipt.json');
      if(await exists(receiptPath)) {
        const receipt=await readJson(receiptPath,32768);need(receipt.fingerprint===fingerprint,'EUROPE_PMC_RECEIVING_RECEIPT_CHANGED');
        return {receipt,selected:await loadSelection(),workspace:await workspace.list()};
      }
      const restored=await restoreEuropePmcWorkspace({bytes:data,directory:join(libraries,library)});
      const current=await loadSelection();
      if(current.library!==library) {
        const next=await openEuropePmcWorkspace({directory:join(libraries,library),dossiers,fetchImpl,rateDirectory:providerRate,requestIntervalMs});
        const old=workspace;
        try {
          await old.close();
          await writeJson(pointer,{schema:'stellar-forge.europe-pmc-selection.v1',library,requestId:originalRequest,
            fingerprint,archiveSha256:expectedSha256,selectedAt:prepared.createdAt});
          workspace=next;selected=await loadSelection();
        } catch(error) {
          await next.close().catch(()=>{});
          workspace=await openEuropePmcWorkspace({directory:join(libraries,current.library),dossiers,fetchImpl,rateDirectory:providerRate,requestIntervalMs});
          selected=current;throw error;
        }
      } else if(selected.library!==library) {
        await workspace.close();
        workspace=await openEuropePmcWorkspace({directory:join(libraries,library),dossiers,fetchImpl,rateDirectory:providerRate,requestIntervalMs});
        selected=current;
      }
      const receipt={schema:'stellar-forge.europe-pmc-selected-receiving.v1',requestId:originalRequest,fingerprint,actor:operator,
        archiveSha256:expectedSha256,archiveBytes:data.length,library,workspaceId:restored.workspaceId,
        revision:restored.revision,members:restored.members,receivedAt:prepared.createdAt};
      await exact(receiptPath,jsonBytes(receipt));return {receipt,selected,workspace:await workspace.list()};
    });
    const result=serial.then(perform);serial=result.catch(()=>{});return result;
  }
  return {
    selection(){return {...selected};},
    call(method,...args) {const target=workspace;return invoke(()=>{need(typeof target[method]==='function'&&method!=='close','EUROPE_PMC_METHOD_INVALID');return target[method](...args);});},
    restore:input=>invoke(()=>restore(input)),
    async status(){return invoke(async()=>({configured:true,selection:selected,workspaceId:(await workspace.list({limit:1})).id,
      api:'stellar-forge.europe-pmc-workspace-api.v1',queryLanguage:'Europe PMC',pageFormat:'core/json',requestIntervalMs,
      sourceKinds:['http-response','retained-document']}));},
    async close(){if(closed)return;closed=true;await Promise.allSettled([...pending]);await serial;await workspace.close();},
  };
}
function number(value,fallback) {
  if(value===null)return fallback;need(/^[0-9]+$/.test(value),'EUROPE_PMC_PAGE_INVALID');const parsed=Number(value);
  need(Number.isSafeInteger(parsed),'EUROPE_PMC_PAGE_INVALID');return parsed;
}
function decoded(value) {try{return decodeURIComponent(value);}catch{throw Object.assign(new Error('Invalid path'),{code:'EUROPE_PMC_ID_INVALID'});}}
async function originalBody(req,limit) {
  const declared=req.headers['content-length'];if(declared!==undefined)need(/^[0-9]+$/.test(declared)&&Number(declared)<=limit,'UPLOAD_SIZE_LIMIT');
  const chunks=[];let length=0;
  for await(const chunk of req){length+=chunk.length;need(length<=limit,'UPLOAD_SIZE_LIMIT');chunks.push(chunk);}
  need(declared===undefined||Number(declared)===length,'EUROPE_PMC_UPLOAD_INCOMPLETE');return Buffer.concat(chunks,length);
}
export async function handleEuropePmcRoute({req,res,url,send,readJson,controller}) {
  if(!url.pathname.startsWith('/api/europe-pmc'))return false;
  const path=url.pathname.slice('/api/europe-pmc'.length),query=url.searchParams;
  need(!req.headers['x-europe-pmc-selection']||req.headers['x-europe-pmc-selection']===controller.selection().library,'EUROPE_PMC_SELECTION_CHANGED');
  const page={offset:number(query.get('offset'),0),limit:number(query.get('limit'),30)};
  const sendFile=async selected=>send(200,selected.bytes,selected.type,selected.filename);
  if(req.method==='GET') {
    if(path===''){send(200,{...await controller.call('list',page),selection:controller.selection()});return true;}
    if(path==='/status'){send(200,await controller.status());return true;}
    if(path==='/history'){send(200,await controller.call('history'));return true;}
    if(path==='/comparison') {
      send(200,await controller.call('comparison',{before:query.get('before'),after:query.get('after'),...page,status:query.get('status')??'all'}));return true;
    }
    let match=path.match(/^\/queries\/([^/]+)$/);
    if(match){send(200,await controller.call('query',decoded(match[1])));return true;}
    match=path.match(/^\/operations\/([^/]+)(?:\/(records|source|chain|files\/(?:edition|ris|csv|review)))?$/);
    if(match) {
      const operationId=decoded(match[1]),action=match[2];
      if(!action){send(200,await controller.call('inspect',operationId));return true;}
      if(action==='chain'){send(200,await controller.call('chain',operationId));return true;}
      if(action==='records'){send(200,await controller.call('records',operationId,{...page,search:query.get('search')??'',key:query.get('key')}));return true;}
      if(action==='source') {
        const selected=await controller.call('sourceFile',operationId,{index:number(query.get('index'),0),descriptor:query.get('descriptor')==='true',boundary:query.get('boundary')==='true'});
        if(query.get('descriptor')==='true')send(200,selected);else await sendFile(selected);return true;
      }
      await sendFile(await controller.call('operationFile',operationId,action.split('/')[1]));return true;
    }
    match=path.match(/^\/exports\/([^/]+)$/);
    if(match){const exported=await controller.call('readExport',{requestId:decoded(match[1])});
      send(200,exported.bytes,'application/gzip',exported.receipt.filename);return true;}
  }
  if(req.method==='POST') {
    if(path==='/restore') {
      need((req.headers['content-type']??'').split(';')[0].trim()==='application/octet-stream','EUROPE_PMC_BINARY_ARCHIVE_REQUIRED');
      const bytes=await originalBody(req,RESTORE_LIMIT);
      send(200,await controller.restore({requestId:query.get('requestId'),actor:query.get('actor'),
        expectedSha256:query.get('sha256'),bytes}));return true;
    }
    const data=await readJson(req,/\/import$/.test(path)?IMPORT_BODY_LIMIT:CONTROL_LIMIT);
    if(path==='/queries'){send(200,await controller.call('saveQuery',data));return true;}
    if(path==='/operations'){send(201,await controller.call('prepare',data));return true;}
    if(path==='/reviews'){send(200,await controller.call('reviewRecord',data));return true;}
    if(path==='/exports'){send(200,await controller.call('exportWorkspace',data));return true;}
    const match=path.match(/^\/operations\/([^/]+)\/(start|stop|seal|continue|import|receive)$/);
    if(match) {
      const operationId=decoded(match[1]),action=match[2],method={start:'start',stop:'stop',seal:'seal',continue:'continueSearch',import:'importDocuments',receive:'receive'}[action];
      send(200,await controller.call(method,operationId,data));return true;
    }
  }
  send(404,{error:'EUROPE_PMC_ROUTE_NOT_FOUND'});return true;
}
