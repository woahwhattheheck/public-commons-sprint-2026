// MIT. Borrow the original GridFabric operator through its complete native contract.
import {GridFabricClientError,validateGridFabricOperation,gridFabricOperations,gridFabricFileId,SHA256,plain,need} from './contract.mjs';

const failure=(code,message,details={})=>new GridFabricClientError(code,message,details);
const named=value=>value.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase());
function binding(value,expected={}) {
  need(plain(value)&&typeof value.workspace_id==='string'&&value.workspace_id&&
    typeof value.workspace_directory==='string'&&value.workspace_directory&&SHA256.test(value.source_sha256??''),
    'GRIDFABRIC_BINDING_INVALID','The original operator must identify its workspace, directory and complete native source.');
  for(const name of ['workspace_id','workspace_directory','source_sha256'])
    need(expected[name]===undefined||expected[name]===value[name],'GRIDFABRIC_BINDING_CHANGED',
      'The selected operator differs from the original workspace or source.',{expected,observed:value});
  return Object.freeze({...value});
}
function response(reply,identity,operation) {
  need(plain(reply)&&plain(reply.value)&&typeof reply.raw_text==='string'&&
    reply.workspace_id===identity.workspace_id,'GRIDFABRIC_RESPONSE_INVALID',
    'Retain the complete original workspace-bound native response.',{operation});
  return reply;
}
function annotate(error,details) {
  Object.assign(error,details);
  error.details={...(plain(error.details)?error.details:{}),...details};
  return error;
}

/** The transport owns authenticated HTTP requests; the existing operator owns SQLite, callbacks and dispatch. */
export async function createGridFabricClient({transport,expectedWorkspaceId,expectedWorkspace,expectedSourceSha256}={}) {
  need(transport&&['inspect','read','dispatch','close'].every(name=>typeof transport[name]==='function'),
    'GRIDFABRIC_TRANSPORT_REQUIRED','Choose the original native GridFabric transport.');
  let identity=binding(await transport.inspect(),{workspace_id:expectedWorkspaceId,
    workspace_directory:expectedWorkspace,source_sha256:expectedSourceSha256});
  let closing=false,reopening=null,closePromise=null;const pending=new Set();
  const own=fn=>{
    if(closing)return Promise.reject(failure('GRIDFABRIC_CLIENT_CLOSING','This operator borrower is closing.'));
    if(reopening)return Promise.reject(failure('GRIDFABRIC_CLIENT_REOPENING','This borrower is reattaching to the same operator.'));
    const promise=Promise.resolve().then(fn);pending.add(promise);return promise.finally(()=>pending.delete(promise));
  };
  const callRaw=(operation,payload={},options={})=>own(async()=>{
    const {definition}=validateGridFabricOperation(operation,payload);
    try {
      return response(await transport[definition.mutating?'dispatch':'read'](operation,payload,options),identity,operation);
    }catch(caught) {
      const error=caught instanceof Error?caught:failure('GRIDFABRIC_TRANSPORT_ERROR',String(caught));
      if(definition.mutating)annotate(error,{request_id:payload.request_id,native_operation:operation,
        recovery:operation==='export'?{operation:'exports',payload:{},export_id:payload.request_id}:
          {operation:'operation',payload:{request_id:payload.request_id}},
        ...(error.accepted===false?{}:{uncertain:true})});
      throw error;
    }
  });
  const call=async(operation,payload={},options={})=>(await callRaw(operation,payload,options)).value;
  const fileInfo=(fileId,options={})=>own(async()=>{
    const selected=gridFabricFileId(fileId);
    need(typeof transport.fileInfo==='function','GRIDFABRIC_FILE_TRANSPORT','Use the original native file interface.');
    const info=await transport.fileInfo(selected.fileId,options);
    need(plain(info)&&info.file_id===selected.fileId&&info.native_file_id===selected.id&&info.kind===selected.kind&&
      info.workspace_id===identity.workspace_id&&typeof info.name==='string'&&info.name&&typeof info.content_type==='string'&&
      Number.isSafeInteger(info.bytes)&&info.bytes>=0&&SHA256.test(info.sha256??''),
      'GRIDFABRIC_FILE_IDENTITY','Keep the original complete file identity.');
    return Object.freeze({...info});
  });
  const readFile=(fileId,{offset=0,limit=196608,expectedSha256,signal}={})=>own(async()=>{
    const selected=gridFabricFileId(fileId);
    need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=196608&&
      SHA256.test(expectedSha256??'')&&typeof transport.readFile==='function',
      'GRIDFABRIC_FILE_INPUT','Repeat the original file SHA256 and exact byte range.');
    const bytes=await transport.readFile(selected.fileId,{offset,limit,expectedSha256,signal});
    need(bytes instanceof Uint8Array&&bytes.length<=limit,'GRIDFABRIC_FILE_RESPONSE','Keep the complete selected original byte range.');
    return bytes;
  });
  const transfer=(method,input)=>own(async()=>{
    need(typeof transport[method]==='function','GRIDFABRIC_FILE_TRANSPORT','Use the original native '+method+' interface.');
    return transport[method](input);
  });
  const client={
    get identity(){return identity;},
    get endpoint(){return 'gridfabric-native:'+JSON.stringify([identity.workspace_id,identity.workspace_directory]);},
    call,callRaw,fileInfo,readFile,
    uploadFile:input=>transfer('uploadFile',input),uploadText:input=>transfer('uploadText',input),
    receiveArchive:input=>transfer('receiveArchive',input),
    recover:(requestId,options={})=>call('operation',{request_id:requestId},options),
    async *pages(collection,options={}) {
      const {host=false,signal,...input}=options;let offset=input.offset??0;
      while(true) {
        const page=await call(host?'host_page':'page',{...input,collection,offset},{signal});
        need(page.collection===collection&&page.offset===offset&&Array.isArray(page.rows)&&
          Number.isSafeInteger(page.total)&&page.total>=0&&
          (page.next_offset===null||Number.isSafeInteger(page.next_offset)&&page.next_offset>offset),
          'GRIDFABRIC_PAGE_RESPONSE','The original page must retain its collection, rows and advancing continuation.');
        yield page;if(page.next_offset===null)return;offset=page.next_offset;
      }
    },
    async *rows(collection,options={}){for await(const page of client.pages(collection,options))yield* page.rows;},
    async reopen() {
      need(!closing,'GRIDFABRIC_CLIENT_CLOSING','This operator borrower is closing.');
      if(!reopening)reopening=(async()=>{
        await Promise.allSettled([...pending]);
        need(typeof transport.reopen==='function','GRIDFABRIC_REOPEN_UNAVAILABLE','This transport cannot reattach.');
        identity=binding(await transport.reopen(),identity);return identity;
      })().finally(()=>{reopening=null;});
      return reopening;
    },
    close() {
      closing=true;
      if(!closePromise)closePromise=(async()=>{
        if(reopening)await reopening.catch(()=>{});
        await Promise.allSettled([...pending]);await transport.close();
      })().catch(error=>{closePromise=null;throw error;});
      return closePromise;
    }
  };
  for(const operation of Object.keys(gridFabricOperations))
    client[named(operation)]=(payload={},options={})=>call(operation,payload,options);
  return Object.freeze(client);
}
