// MIT. Stream exact original Central files into the maintained merchant retained-file reader.
import {mkdir,readdir,open,lstat,unlink,link} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {acquirePrivateDirectoryWriter} from '../operations/history.mjs';
import {RetainedFileReads} from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import {odkNeed,odkDigest,odkPrivateDirectory,odkReadPrivateJson,odkWritePrivateJson,
  odkRequest,inspectCentralListener,ODK_MAX_RESPONSE_BYTES,ODK_HASH,ODK_UUID} from './connection.mjs';

export const ODK_FILE_SCHEMA='stellar-forge.odk-central-retained-file.v1';
const identity=value=>odkDigest(JSON.stringify(value));
async function folder(path){
  try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  await odkPrivateDirectory(path);return path;
}
async function optionalJson(path){
  try{return(await odkReadPrivateJson(path,128*1024)).value;}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function fileDigest(path,maximum){
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await file.stat();
    odkNeed(before.isFile()&&before.size<=maximum&&
      (process.platform==='win32'||!(before.mode&0o077)&&(!process.getuid||before.uid===process.getuid())),
    'ODK_RETAINED_FILE_INVALID','The retained download must be an owned private regular file.');
    const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let position=0;
    while(position<before.size){
      const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,before.size-position),position);
      odkNeed(bytesRead>0,'ODK_RETAINED_FILE_CHANGED','The original retained file changed.',409);
      hash.update(buffer.subarray(0,bytesRead));position+=bytesRead;
    }
    const after=await file.stat();
    odkNeed(['dev','ino','size','mtimeMs','ctimeMs'].every(key=>before[key]===after[key]),
      'ODK_RETAINED_FILE_CHANGED','The original retained file changed while it was read.',409);
    return {bytes:position,sha256:hash.digest('hex')};
  }finally{await file.close();}
}
function filename(header,fallback){
  const extended=/(?:^|;\s*)filename\*=UTF-8''([^;]+)/i.exec(header||'');
  const quoted=/(?:^|;\s*)filename="([^"]*)"/.exec(header||'');
  let name=quoted?.[1]||fallback;
  if(extended)try{name=decodeURIComponent(extended[1]);}catch{}
  odkNeed(name===basename(name)&&name.length>=1&&name.length<=240&&!/[\\/\x00-\x1f\x7f]/.test(name),
    'ODK_RETAINED_NAME_INVALID','The original file has an invalid download name.');
  return name;
}
export function centralDownloadPath(value){
  odkNeed(typeof value==='string'&&value.startsWith('/api/files/')&&value.length<=16384,
    'ODK_DOWNLOAD_SELECTION_INVALID','Use the exact relative download path from an original file descriptor.');
  let parsed;try{parsed=new URL(value,'http://127.0.0.1');}catch{}
  odkNeed(parsed&&parsed.origin==='http://127.0.0.1'&&!parsed.hash&&
    parsed.pathname+parsed.search===value,'ODK_DOWNLOAD_SELECTION_INVALID',
  'Use the exact original source or export download path.');
  const source=/^\/api\/files\/source\/([a-f0-9]{64})$/.exec(parsed.pathname);
  const exported=/^\/api\/files\/export\/([^/]+)$/.exec(parsed.pathname);
  if(source)odkNeed(!parsed.search,'ODK_DOWNLOAD_SELECTION_INVALID','Source downloads use their original content hash.');
  else{
    odkNeed(exported&&[...parsed.searchParams.keys()].length===1&&parsed.searchParams.has('path')&&
      parsed.searchParams.get('path').length>=1,'ODK_DOWNLOAD_SELECTION_INVALID',
    'An original export download requires its saved export ID and exact relative member path.');
    const id=decodeURIComponent(exported[1]);
    odkNeed(id.length>=1&&id.length<=240&&!/[\\/\x00-\x1f\x7f]/.test(id),
      'ODK_DOWNLOAD_SELECTION_INVALID','Use the original saved export ID.');
  }
  return {path:value,sourceHash:source?.[1]??null};
}
export class CentralRetainedFiles{
  #directory;#reads=new RetainedFileReads({errorPrefix:'ODK'});
  constructor(directory){this.#directory=directory;}
  get summary(){return this.#reads.summary;}
  async #root(scope){
    await odkPrivateDirectory(this.#directory);
    return folder(join(await folder(join(this.#directory,'odk')),scope.alias));
  }
  async #directoryFor(scope,fileId){
    odkNeed(/^of_[a-f0-9]{64}$/.test(fileId),'ODK_RETAINED_ID_INVALID','Choose an original retained file ID.');
    return join(await this.#root(scope),fileId);
  }
  #intent(scope,args){
    odkNeed(typeof args.requestId==='string'&&args.requestId.length>=1&&args.requestId.length<=200&&
      !/[\x00-\x1f\x7f]/.test(args.requestId),'ODK_RETAINED_REQUEST_REQUIRED','Retain a stable original file request ID.');
    const download=centralDownloadPath(args.downloadPath);
    odkNeed(ODK_HASH.test(args.expectedSha256??'')&&Number.isSafeInteger(args.expectedBytes)&&
      args.expectedBytes>=0&&args.expectedBytes<=ODK_MAX_RESPONSE_BYTES&&
      (!download.sourceHash||download.sourceHash===args.expectedSha256),
    'ODK_RETAINED_SOURCE_REQUIRED','Use the exact SHA-256 and byte count from the selected native file descriptor.');
    return {workspace:scope.alias,directory:scope.directory,requestId:args.requestId,
      downloadPath:download.path,expectedSha256:args.expectedSha256,expectedBytes:args.expectedBytes};
  }
  async #record(scope,fileId){
    const directory=await this.#directoryFor(scope,fileId),result=await optionalJson(join(directory,'file.json'));
    odkNeed(result?.schema===ODK_FILE_SCHEMA&&result.fileId===fileId&&
      result.intent?.workspace===scope.alias&&result.intent?.directory===scope.directory&&
      result.requestSha256===identity(result.intent)&&ODK_UUID.test(result.workspaceId??'')&&
      result.sha256===result.intent.expectedSha256&&ODK_HASH.test(result.sha256)&&
      Number.isSafeInteger(result.bytes)&&result.bytes===result.intent.expectedBytes&&
      result.bytes>=0&&result.bytes<=ODK_MAX_RESPONSE_BYTES&&
      typeof result.filename==='string'&&result.filename===basename(result.filename),
    'ODK_RETAINED_FILE_NOT_FOUND','Choose a completed original download for this configured workspace.',404);
    if(scope.workspaceId)odkNeed(result.workspaceId===scope.workspaceId,'ODK_RETAINED_WORKSPACE_CHANGED',
      'This retained file belongs to a different original workspace binding.',409);
    return {directory,result};
  }
  async find(scope,args){
    const intent=this.#intent(scope,args),fileId='of_'+identity({workspace:scope.alias,requestId:args.requestId});
    const directory=await this.#directoryFor(scope,fileId);
    if(!await optionalJson(join(directory,'file.json')))return null;
    const {result}=await this.#record(scope,fileId);
    odkNeed(result.requestSha256===identity(intent),'ODK_RETAINED_REQUEST_REUSED',
      'This original file request ID belongs to different selected bytes.',409);
    return {...result,reused:true};
  }
  async #download(connection,intent,directory){
    const target=join(directory,'content'),headersPath=join(directory,'response.json');
    try{
      const info=await lstat(target);
      odkNeed(info.isFile()&&!info.isSymbolicLink(),'ODK_RETAINED_FILE_INVALID','The original retained download is invalid.');
      const headers=await optionalJson(headersPath),found=await fileDigest(target,ODK_MAX_RESPONSE_BYTES);
      odkNeed(headers&&found.bytes===intent.expectedBytes&&found.sha256===intent.expectedSha256&&
        headers.bytes===found.bytes,'ODK_RETAINED_FILE_CHANGED',
      'The retained original download differs from its selected source.',409);
      return {...headers,...found};
    }catch(error){if(error.code!=='ENOENT')throw error;}
    const partial=join(directory,'download.partial');
    await unlink(partial).catch(error=>{if(error.code!=='ENOENT')throw error;});
    const transfer=await odkRequest(connection,intent.downloadPath,{
      raw:true,maximum:intent.expectedBytes,timeoutMs:300000});
    let file;
    try{
      const length=transfer.response.headers.get('content-length');
      odkNeed(length===null||/^\d+$/.test(length)&&Number(length)===intent.expectedBytes,
        'ODK_RETAINED_LENGTH_CHANGED','The native download length differs from its selected descriptor.',409);
      const metadata={filename:filename(transfer.response.headers.get('content-disposition'),'odk-'+intent.expectedSha256.slice(0,16)),
        mediaType:transfer.response.headers.get('content-type')||'application/octet-stream',
        bytes:intent.expectedBytes,capturedAt:new Date().toISOString()};
      await odkWritePrivateJson(headersPath,metadata,{replace:true});
      file=await open(partial,'wx',0o600);
      const hash=createHash('sha256');let position=0;
      if(transfer.response.body)for await(const chunk of transfer.response.body){
        odkNeed(position+chunk.length<=intent.expectedBytes,'ODK_RETAINED_LENGTH_CHANGED',
          'The native download exceeds its selected byte count.',409);
        let offset=0;
        while(offset<chunk.length){
          const written=await file.write(chunk,offset,chunk.length-offset,position+offset);
          odkNeed(written.bytesWritten>0,'ODK_RETAINED_WRITE_FAILED','The original file could not be retained.',507);
          offset+=written.bytesWritten;
        }
        position+=chunk.length;hash.update(chunk);
      }
      const sha256=hash.digest('hex');
      odkNeed(position===intent.expectedBytes&&sha256===intent.expectedSha256,
        'ODK_RETAINED_SOURCE_CHANGED','The complete native download differs from its selected original bytes.',409);
      await file.sync();await file.close();file=null;
      await link(partial,target);await unlink(partial);
      const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}
      return {...metadata,sha256};
    }finally{
      try{if(file)await file.close();}
      finally{try{await unlink(partial).catch(error=>{if(error.code!=='ENOENT')throw error;});}
        finally{await transfer.release();}}
    }
  }
  async retain(scope,connection,args){
    const prior=await this.find(scope,args);if(prior)return prior;
    const intent=this.#intent(scope,args),fileId='of_'+identity({workspace:scope.alias,requestId:args.requestId});
    const directory=await folder(await this.#directoryFor(scope,fileId));
    const lease=await acquirePrivateDirectoryWriter(directory);
    try{
      const repeated=await this.find(scope,args);if(repeated)return repeated;
      const requestSha256=identity(intent),requestPath=join(directory,'request.json');
      let prepared=await optionalJson(requestPath);
      const live=await inspectCentralListener(connection);
      if(scope.workspaceId)odkNeed(live.id===scope.workspaceId,'ODK_RETAINED_WORKSPACE_CHANGED',
        'Continue this original download in its configured workspace.',409);
      if(prepared)odkNeed(prepared.schema===ODK_FILE_SCHEMA+'.request'&&
        prepared.requestSha256===requestSha256&&identity(prepared.intent)===requestSha256&&prepared.workspaceId===live.id,
      'ODK_RETAINED_REQUEST_REUSED','This retained request belongs to another source selection or workspace.',409);
      else{
        prepared={schema:ODK_FILE_SCHEMA+'.request',intent,requestSha256,workspaceId:live.id,preparedAt:new Date().toISOString()};
        await odkWritePrivateJson(requestPath,prepared);
      }
      const received=await this.#download(connection,intent,directory);
      const result={schema:ODK_FILE_SCHEMA,fileId,intent,requestSha256,workspaceId:prepared.workspaceId,
        ...received,completedAt:new Date().toISOString()};
      await odkWritePrivateJson(join(directory,'file.json'),result);return result;
    }finally{await lease.release();}
  }
  async list(scope,offset=0,limit=50){
    odkNeed(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=1000,
      'ODK_RETAINED_PAGE_INVALID','Choose a nonnegative offset and a page size from 1 to 1000.');
    const names=(await readdir(await this.#root(scope))).filter(name=>/^of_[a-f0-9]{64}$/.test(name)).sort(),records=[];
    for(const name of names)if(await optionalJson(join(await this.#directoryFor(scope,name),'file.json')))
      records.push((await this.#record(scope,name)).result);
    return {files:records.slice(offset,offset+limit),offset,limit,total:records.length,
      nextOffset:offset+limit<records.length?offset+limit:null};
  }
  async file(scope,args){
    return this.#reads.read({scope:scope.alias,key:args.fileId,kind:'odk',directory:this.#directory,
      readId:args.readId,expectedSha256:args.expectedSha256,offset:args.offset,limit:args.limit,
      load:async()=>{
        const {directory,result}=await this.#record(scope,args.fileId);
        const readonlyFileHandle=await open(join(directory,'content'),constants.O_RDONLY|(constants.O_NOFOLLOW??0));
        return {readonlyFileHandle,bytes:result.bytes,sha256:result.sha256,name:result.filename,type:result.mediaType};
      }});
  }
  release(scope,readId){return this.#reads.release(scope.alias,readId);}
  disconnect(scope){return this.#reads.closeScope(scope.alias);}
  close(){return this.#reads.close();}
}
