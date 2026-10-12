// MIT. Authenticated borrowing of the original loopback GridFabric operator.
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {Readable} from 'node:stream';
import {finished} from 'node:stream/promises';
import {GridFabricClientError,gridFabricFileId,gridFabricOperations,validateGridFabricOperation,SHA256,UUID,plain,need,exact} from './contract.mjs';
import {createGridFabricClient} from './client.mjs';

const BINDING='x-gridfabric-workspace-id';
const decode=bytes=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const failure=(code,message,details={})=>new GridFabricClientError(code,message,details);
const stamp=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs,stat.mode,stat.nlink,stat.uid].join(':');
function text(value,label) {
  need(typeof value==='string'&&value&&!/[\0\r\n]/.test(value),'GRIDFABRIC_CONNECTION_INPUT','Choose the original '+label+'.');
  return value;
}
function fileName(value) {
  text(value,'filename');
  need(!/[\\/]/.test(value)&&!['.','..'].includes(value),'GRIDFABRIC_FILE_INPUT','Use a plain original filename.');
  return value;
}
async function originalFile(path,{maximum=Number.MAX_SAFE_INTEGER,privateFile=false}={}) {
  const selected=resolve(text(path,'file'));
  const handle=await open(selected,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try {
    const info=await handle.stat({bigint:true});
    need(info.isFile()&&info.size<=BigInt(maximum),'GRIDFABRIC_FILE_INPUT','Use a complete ordinary original file within its reviewed size.');
    if(privateFile&&process.platform!=='win32')need((info.mode&0o077n)===0n&&info.nlink===1n&&
      info.uid===BigInt(process.getuid()),'GRIDFABRIC_CONNECTION_PRIVATE','Use the original private connection file.');
    const unchanged=async()=>{
      const current=await handle.stat({bigint:true}),named=await lstat(selected,{bigint:true});
      need(current.isFile()&&named.isFile()&&!named.isSymbolicLink()&&
        stamp(current)===stamp(info)&&stamp(named)===stamp(info)&&await realpath(selected)===selected,
        'GRIDFABRIC_FILE_CHANGED','The selected original file changed while it was read.');
    };
    await unchanged();return {handle,info,path:selected,unchanged};
  }catch(error){await handle.close();throw error;}
}
async function connectionRecord(path) {
  const original=await originalFile(path,{maximum:2048,privateFile:true});
  try {
    const bytes=await original.handle.readFile();await original.unchanged();
    const raw=decode(bytes);
    need(raw.endsWith('\n')&&raw.indexOf('\n')===raw.length-1&&!raw.includes('\r'),
      'GRIDFABRIC_CONNECTION_INVALID','Use the original single-line private connection URL.');
    let url;try{url=new URL(raw.slice(0,-1));}catch{throw failure('GRIDFABRIC_CONNECTION_INVALID','The original private connection URL is invalid.');}
    need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port&&
      Number(url.port)>=1&&Number(url.port)<=65535&&!url.username&&!url.password&&!url.search&&
      url.pathname==='/'&&/^#[A-Za-z0-9_-]{43}$/.test(url.hash),
      'GRIDFABRIC_CONNECTION_INVALID','Use the original IPv4 loopback operator connection.');
    return {origin:url.origin,token:url.hash.slice(1)};
  }finally{await original.handle.close();}
}
function nativeError(reply,operation) {
  let raw_text;try{raw_text=decode(reply.bytes);}catch{
    return failure('GRIDFABRIC_HTTP_RESPONSE','The original operator returned a non-UTF-8 error body.',
      {http_status:reply.status,headers:reply.headers,raw_headers:reply.raw_headers,body_base64:reply.bytes.toString('base64'),operation});
  }
  let value;try{value=JSON.parse(raw_text);}catch{}
  const native=plain(value?.error)?value.error:{};
  return failure(typeof native.code==='string'?native.code:'GRIDFABRIC_HTTP_'+reply.status,
    typeof native.message==='string'?native.message:'The original operator returned HTTP '+reply.status+'.',
    {http_status:reply.status,headers:reply.headers,raw_headers:reply.raw_headers,raw_text,native_error:native,
      ...(plain(native.details)?native.details:{}),operation});
}

/** The selected host owns the original server process and connection file. This object owns HTTP requests only. */
export async function connectGridFabricOperator(options={}) {
  exact(options,['connectionFile','expectedWorkspaceId','expectedWorkspace','expectedSourceSha256','maximumResponseBytes','timeoutMs'],
    ['connectionFile']);
  const {connectionFile,expectedWorkspaceId,expectedWorkspace,expectedSourceSha256,
    maximumResponseBytes=64*1024*1024,timeoutMs=300000}=options;
  need(Number.isSafeInteger(maximumResponseBytes)&&maximumResponseBytes>=1024&&
    Number.isSafeInteger(timeoutMs)&&timeoutMs>=1,'GRIDFABRIC_CONNECTION_INPUT','Choose positive host request limits.');
  const connectionPath=resolve(text(connectionFile,'connection file'));
  const expectedDirectory=expectedWorkspace===undefined?undefined:resolve(text(expectedWorkspace,'workspace directory'));
  if(expectedWorkspaceId!==undefined)text(expectedWorkspaceId,'workspace identity');
  if(expectedSourceSha256!==undefined)need(SHA256.test(expectedSourceSha256),'GRIDFABRIC_SOURCE_INPUT','Keep the complete selected source SHA256.');
  let selected=await connectionRecord(connectionPath),identity=null,closed=false;
  const pending=new Set(),fileCache=new Map();
  async function request(path,{method='GET',body,headers={},signal,maximum=maximumResponseBytes,candidate=selected,operation}={}) {
    need(!closed,'GRIDFABRIC_CLIENT_CLOSING','This HTTP borrower is closed.');
    signal?.throwIfAborted();
    need(typeof path==='string'&&path.startsWith('/api/')&&!path.includes('#'),
      'GRIDFABRIC_HTTP_PATH','Use the original declared operator API.');
    let settle;const ownership=new Promise(resolve=>{settle=resolve;});pending.add(ownership);
    let outgoing,incoming,timer,abort,completed=false;
    try {
      const result=await new Promise((resolveResult,rejectResult)=>{
        const fail=error=>{outgoing?.destroy(error);rejectResult(error);};
        try {
          outgoing=httpRequest(new URL(path,candidate.origin),{
            method,agent:false,
            headers:{accept:'application/json',origin:candidate.origin,authorization:'Bearer '+candidate.token,...headers}
          },response=>{
            incoming=response;
            void (async()=>{
              const chunks=[];let count=0;
              for await(const chunk of response) {
                count+=chunk.length;
                need(count<=maximum,'GRIDFABRIC_RESPONSE_TOO_LARGE',
                  'The complete response exceeds the host allowance; select native pages or file ranges, or increase that allowance.',
                  {http_status:response.statusCode,headers:response.headers,maximum,received_bytes:count,operation});
                chunks.push(Buffer.from(chunk));
              }
              need(response.complete,'GRIDFABRIC_RESPONSE_INCOMPLETE','The original response ended before completion.',
                {http_status:response.statusCode,headers:response.headers,operation});
              const declared=response.headers['content-length'];
              need(declared===undefined||/^\d+$/.test(String(declared))&&Number(declared)===count,
                'GRIDFABRIC_RESPONSE_INCOMPLETE','The original response length differs from its complete body.',
                {http_status:response.statusCode,headers:response.headers,operation});
              need(!response.headers['content-encoding']||response.headers['content-encoding']==='identity',
                'GRIDFABRIC_RESPONSE_ENCODING','Use the exact original unencoded native response.');
              completed=true;
              resolveResult({status:response.statusCode,headers:{...response.headers},
                raw_headers:[...response.rawHeaders],bytes:Buffer.concat(chunks,count)});
            })().catch(fail);
          });
          outgoing.once('error',rejectResult);
          abort=()=>fail(signal?.reason instanceof Error?signal.reason:failure('GRIDFABRIC_HTTP_ABORTED','The caller interrupted its original request.'));
          signal?.addEventListener('abort',abort,{once:true});
          timer=setTimeout(()=>fail(failure('GRIDFABRIC_HTTP_TIMEOUT','The original operator request exceeded the selected timeout.',
            {timeout_ms:timeoutMs,operation})),timeoutMs);timer.unref?.();
          if(signal?.aborted){abort();return;}
          if(body instanceof Readable){body.once('error',fail);body.pipe(outgoing);}
          else outgoing.end(body);
        }catch(error){fail(error);}
      });
      if(identity&&result.headers[BINDING]!==undefined&&result.headers[BINDING]!==identity.workspace_id)
        throw failure('GRIDFABRIC_BINDING_CHANGED','The HTTP response belongs to another native workspace.',
          {http_status:result.status,headers:result.headers,operation});
      if(result.status<200||result.status>=300)throw nativeError(result,operation);
      need(typeof result.headers[BINDING]==='string'&&result.headers[BINDING]&&
        (!identity||result.headers[BINDING]===identity.workspace_id),
        'GRIDFABRIC_BINDING_CHANGED','The authenticated response must identify the original workspace.',
        {http_status:result.status,headers:result.headers,operation});
      return result;
    }catch(caught) {
      if(caught instanceof GridFabricClientError)throw caught;
      throw failure('GRIDFABRIC_HTTP_INTERRUPTED',caught instanceof Error?caught.message:String(caught),
        {operation,...(incoming?{http_status:incoming.statusCode}:{}),cause_code:caught?.code});
    }finally {
      if(timer)clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);
      if(!completed)incoming?.destroy();outgoing?.destroy();
      if(body instanceof Readable&&!body.readableEnded)body.destroy();
      pending.delete(ownership);settle();
    }
  }
  async function json(path,settings={}) {
    const reply=await request(path,settings);let raw_text,value;
    try{raw_text=decode(reply.bytes);value=JSON.parse(raw_text);}catch{
      throw failure('GRIDFABRIC_RESPONSE_INVALID','The complete original response is not UTF-8 JSON.',
        {http_status:reply.status,headers:reply.headers,raw_headers:reply.raw_headers,
          ...(raw_text===undefined?{body_base64:reply.bytes.toString('base64')}:{raw_text})});
    }
    return {value,raw_text,http_status:reply.status,headers:reply.headers,raw_headers:reply.raw_headers,
      workspace_id:reply.headers[BINDING]};
  }
  async function inspect(candidate=selected) {
    const reply=await json('/api/launch',{candidate,operation:'launch'}),launch=reply.value;
    need(plain(launch)&&launch.schema==='stellar-forge.gridfabric-launch.v1'&&launch.status==='READY'&&
      launch.origin===candidate.origin&&launch.workspace_id===reply.workspace_id&&typeof launch.workspace==='string'&&
      launch.workspace===resolve(launch.workspace)&&Number.isSafeInteger(launch.revision)&&launch.revision>=0&&
      launch.source?.schema==='stellar-forge.gridfabric-native-source.v1'&&SHA256.test(launch.source.sha256??'')&&
      Array.isArray(launch.source.modules)&&launch.source.modules.length>0&&
      digest(Buffer.from(JSON.stringify(launch.source.modules)))===launch.source.sha256,
      'GRIDFABRIC_BINDING_INVALID','The original readiness, workspace and complete native source must agree.',
      {raw_text:reply.raw_text});
    const observed={workspace_id:launch.workspace_id,workspace_directory:launch.workspace,
      source_sha256:launch.source.sha256,origin:launch.origin,native_source:launch.source,
      revision:launch.revision,raw_launch:reply.raw_text};
    for(const [name,expected]of Object.entries({workspace_id:identity?.workspace_id??expectedWorkspaceId,
      workspace_directory:identity?.workspace_directory??expectedDirectory,source_sha256:identity?.source_sha256??expectedSourceSha256}))
      need(expected===undefined||observed[name]===expected,'GRIDFABRIC_BINDING_CHANGED',
        'The selected operator belongs to a different original workspace or source.',{field:name,expected,observed:observed[name]});
    identity=Object.freeze(observed);return identity;
  }
  function query(path,payload) {
    const parameters=new URLSearchParams();
    for(const [key,value]of Object.entries(payload))parameters.set(key,String(value));
    return path+(parameters.size?'?'+parameters:'');
  }
  async function selectedFile(file,expectedBytes,expectedSha256,signal) {
    need(Number.isSafeInteger(expectedBytes)&&expectedBytes>=0&&SHA256.test(expectedSha256??''),
      'GRIDFABRIC_FILE_INPUT','Review the complete original byte count and SHA256.');
    const original=await originalFile(file,{maximum:expectedBytes});
    try {
      need(original.info.size===BigInt(expectedBytes),'GRIDFABRIC_FILE_CHANGED','The selected file length changed.');
      const hash=createHash('sha256'),buffer=Buffer.alloc(196608);let offset=0;
      while(offset<expectedBytes) {
        signal?.throwIfAborted();
        const {bytesRead}=await original.handle.read(buffer,0,Math.min(buffer.length,expectedBytes-offset),offset);
        need(bytesRead>0,'GRIDFABRIC_FILE_CHANGED','The selected original file ended early.');
        hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead;
      }
      need(hash.digest('hex')===expectedSha256,'GRIDFABRIC_FILE_CHANGED','The selected original file digest changed.');
      await original.unchanged();return original;
    }catch(error){await original.handle.close();throw error;}
  }
  function fileStream(original,bytes,signal) {
    async function* chunks() {
      const buffer=Buffer.alloc(196608);let offset=0;
      while(offset<bytes) {
        signal?.throwIfAborted();
        const {bytesRead}=await original.handle.read(buffer,0,Math.min(buffer.length,bytes-offset),offset);
        need(bytesRead>0,'GRIDFABRIC_FILE_CHANGED','The original file ended during transfer.');
        offset+=bytesRead;yield Buffer.from(buffer.subarray(0,bytesRead));
      }
      await original.unchanged();
    }
    return Readable.from(chunks());
  }
  async function sendSource({file,expectedBytes,expectedSha256,name,mimeType='application/json',signal}) {
    const original=await selectedFile(file,expectedBytes,expectedSha256,signal);let stream;
    try {
      const filename=fileName(name??basename(original.path));text(mimeType,'media type');
      stream=fileStream(original,expectedBytes,signal);
      const reply=await json('/api/upload',{method:'POST',body:stream,signal,operation:'upload',
        headers:{'content-type':mimeType,'content-length':String(expectedBytes),
          'x-gridfabric-name':encodeURIComponent(filename),'x-gridfabric-sha256':expectedSha256}});
      const result=reply.value;
      need(result?.sha256===expectedSha256&&result.bytes===expectedBytes&&result.name===filename&&result.mime_type===mimeType,
        'GRIDFABRIC_UPLOAD_IDENTITY','The original uploaded file differs from the selected bytes.',{raw_text:reply.raw_text});
      await original.unchanged();return reply;
    }catch(error) {
      const details={file_id:'file_'+expectedSha256,expected_bytes:expectedBytes,
        recovery:{operation:'file_info',file_id:'file_'+expectedSha256},...(stream?{uncertain:true}:{})};
      Object.assign(error,details);error.details={...(plain(error.details)?error.details:{}),...details};throw error;
    }finally {
      if(stream){stream.destroy();await finished(stream,{cleanup:true}).catch(()=>{});}
      await original.handle.close();
    }
  }
  const transport={
    inspect:()=>inspect(),
    read:(operation,payload,{signal}={})=>{
      const {definition}=validateGridFabricOperation(operation,payload);
      need(!definition.mutating,'GRIDFABRIC_HTTP_METHOD','Use the original native read method.');
      return json(query(definition.path,payload),{signal,operation});
    },
    dispatch:(operation,payload,{signal}={})=>{
      const {definition}=validateGridFabricOperation(operation,payload);
      need(definition.mutating,'GRIDFABRIC_HTTP_METHOD','Use the original native action method.');
      const body=Buffer.from(JSON.stringify({...payload,...(definition.action?{action:definition.action}:{})}));
      return json(definition.path,{method:'POST',body,signal,operation,
        headers:{'content-type':'application/json','content-length':String(body.length)}});
    },
    async fileInfo(fileId,{signal}={}) {
      const selected=gridFabricFileId(fileId),{value}=await json(query('/api/'+selected.kind+'-info',{id:selected.id}),{signal,operation:'file_info'});
      need(value?.schema==='stellar-forge.gridfabric-native-file.v1'&&value.workspace_id===identity.workspace_id&&
        value.file_id===selected.id&&value.kind===selected.kind&&SHA256.test(value.sha256??'')&&
        Number.isSafeInteger(value.bytes)&&value.bytes>=0&&typeof value.name==='string'&&value.name&&typeof value.mime_type==='string',
        'GRIDFABRIC_FILE_IDENTITY','The original native file metadata is incomplete or changed.');
      const info=Object.freeze({...value,file_id:selected.fileId,native_file_id:selected.id,content_type:value.mime_type});
      fileCache.set(selected.fileId,info);return info;
    },
    async readFile(fileId,{offset,limit,expectedSha256,signal}) {
      const selected=gridFabricFileId(fileId),info=fileCache.get(selected.fileId)??await transport.fileInfo(selected.fileId,{signal});
      need(info.sha256===expectedSha256&&offset<=info.bytes,'GRIDFABRIC_FILE_CHANGED','Repeat the original file digest and a valid offset.');
      const length=Math.min(limit,info.bytes-offset);
      const reply=await request(query('/api/'+selected.kind,{id:selected.id,offset,limit,expected_sha256:expectedSha256}),
        {signal,maximum:Math.max(65536,length),operation:'file_range'});
      need(reply.status===(length?206:200)&&reply.bytes.length===length&&
        reply.headers['x-content-sha256']===expectedSha256&&reply.headers.etag==='"'+expectedSha256+'"'&&
        Number(reply.headers['content-length'])===length&&Number(reply.headers['x-gridfabric-file-bytes'])===info.bytes&&
        Number(reply.headers['x-gridfabric-file-offset'])===offset&&reply.headers['x-chunk-sha256']===digest(reply.bytes)&&
        (length?reply.headers['content-range']==='bytes '+offset+'-'+(offset+length-1)+'/'+info.bytes:reply.headers['content-range']===undefined),
        'GRIDFABRIC_FILE_CHANGED','The complete original range differs from its file and chunk identities.',
        {file_id:selected.fileId,offset,expected_sha256:expectedSha256,http_status:reply.status,headers:reply.headers});
      return reply.bytes;
    },
    uploadFile:input=>sendSource(input),
    async uploadText({text:content,name='Original_Source.json',mimeType='application/json',expectedSha256,signal}={}) {
      need(typeof content==='string','GRIDFABRIC_FILE_INPUT','Supply complete original UTF-8 source text.');
      const body=Buffer.from(content,'utf8'),sha256=digest(body);fileName(name);text(mimeType,'media type');
      need(expectedSha256===undefined||expectedSha256===sha256,'GRIDFABRIC_FILE_CHANGED','The original text differs from the reviewed SHA256.');
      try {
        const reply=await json('/api/upload',{method:'POST',body,signal,operation:'upload',
          headers:{'content-type':mimeType,'content-length':String(body.length),
            'x-gridfabric-name':encodeURIComponent(name),'x-gridfabric-sha256':sha256}});
        need(reply.value?.sha256===sha256&&reply.value.bytes===body.length&&reply.value.name===name&&reply.value.mime_type===mimeType,
          'GRIDFABRIC_UPLOAD_IDENTITY','The original upload differs from the complete selected text.',{raw_text:reply.raw_text});
        return reply;
      }catch(error) {
        const details={file_id:'file_'+sha256,recovery:{operation:'file_info',file_id:'file_'+sha256},uncertain:true};
        Object.assign(error,details);error.details={...(plain(error.details)?error.details:{}),...details};throw error;
      }
    },
    async receiveArchive({file,expectedBytes,expectedSha256,name,requestId,signal}={}) {
      need(Number.isSafeInteger(expectedBytes)&&expectedBytes>0&&UUID.test(requestId??'')&&
        typeof name==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(name)&&!['.','..'].includes(name),
        'GRIDFABRIC_RECEIVING_INPUT','Select the original archive, sibling receiving name and retained request UUID.');
      const original=await selectedFile(file,expectedBytes,expectedSha256,signal);let stream;
      try {
        stream=fileStream(original,expectedBytes,signal);
        const reply=await json(query('/api/restore',{name}),{method:'POST',body:stream,signal,operation:'restore',
          headers:{'content-type':'application/gzip','content-length':String(expectedBytes),
            'x-gridfabric-sha256':expectedSha256,'x-gridfabric-request-id':requestId}});
        await original.unchanged();return reply;
      }catch(error) {
        const details={request_id:requestId,receiving:{name,archive_sha256:expectedSha256,archive_bytes:expectedBytes},
          recovery:{operation:'restore_status',payload:{name,sha256:expectedSha256}},...(stream?{uncertain:true}:{})};
        Object.assign(error,details);error.details={...(plain(error.details)?error.details:{}),...details};throw error;
      }finally {
        if(stream){stream.destroy();await finished(stream,{cleanup:true}).catch(()=>{});}
        await original.handle.close();
      }
    },
    async reopen() {
      const candidate=await connectionRecord(connectionPath),observed=await inspect(candidate);
      selected=candidate;fileCache.clear();return observed;
    },
    async close(){closed=true;await Promise.allSettled([...pending]);fileCache.clear();}
  };
  try{return await createGridFabricClient({transport,expectedWorkspaceId,expectedWorkspace:expectedDirectory,expectedSourceSha256});}
  catch(error){await transport.close();throw error;}
}
