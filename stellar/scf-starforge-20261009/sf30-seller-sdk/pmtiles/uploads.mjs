// MIT. Streaming browser source intake with retained original body and completion replay.
import {open,link,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {privateDirectory,readJson,exists,syncDirectory} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {need,identifier,text,rights,digest,timestamp,clone} from './model.mjs';
import {retainJson,fileDescriptor,MAX_RESOURCE_BYTES,MAX_METADATA_BYTES} from './files.mjs';
import {withNativeLease} from './native.mjs';

export function browserUploads(workspace){
  const directory=id=>join(workspace.directory,'captures','browser-'+identifier(id));
  const scoped=(id,work)=>withNativeLease(join(workspace.directory,'locks'),'workspace-files',
    ()=>withNativeLease(join(workspace.directory,'locks'),'upload-'+digest(id).slice(0,32),work),{shared:true});
  async function prepare(input){
    identifier(input.requestId);need(input.expectedWorkspaceId===workspace.state().id,'PMTILES_WORKSPACE_ID_CHANGED');
    need(['pmtiles','style','sprite-json','sprite-png','glyph','document'].includes(input.kind),'PMTILES_RESOURCE_KIND_INVALID');
    const selected={schema:'starforge.pmtiles-browser-upload.v1',requestId:input.requestId,workspaceId:input.expectedWorkspaceId,
      name:text(input.name,240),kind:input.kind,rights:rights(input.rights),file:{name:text(input.file?.name,240),
        bytes:input.file?.bytes,lastModified:input.file?.lastModified??null}};
    need(Number.isSafeInteger(selected.file.bytes)&&selected.file.bytes>0&&selected.file.bytes<=MAX_RESOURCE_BYTES&&
      (selected.file.lastModified===null||Number.isSafeInteger(selected.file.lastModified)),'PMTILES_UPLOAD_FILE_INVALID');
    return scoped(input.requestId,async()=>{
      const root=directory(input.requestId);await privateDirectory(root);
      await retainJson(join(root,'request.json'),selected);return status(input.requestId);
    });
  }
  async function status(id){
    const root=directory(id),request=await readJson(join(root,'request.json'),MAX_METADATA_BYTES);
    need(request.workspaceId===workspace.state().id,'PMTILES_WORKSPACE_ID_CHANGED');
    const completed=await readJson(join(root,'body.json'),MAX_METADATA_BYTES).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    const importRequestId='upload-import-'+digest(id).slice(0,32),operation=workspace.getRequest(importRequestId);
    return {id,request,body:completed,importRequestId,operation};
  }
  async function receive(id,body,{signal,contentLength}={}){
    return scoped(id,async()=>{
      const saved=await status(id),root=directory(id),expected=saved.request.file.bytes;
      if(contentLength!==undefined)need(String(contentLength)===String(expected),'PMTILES_UPLOAD_LENGTH_CHANGED');
      const attempt=join(root,'attempt-'+randomUUID()+'.bin'),file=await open(attempt,'wx',0o600);
      const h=createHash('sha256');let bytes=0;
      try{
        for await(const part of body){signal?.throwIfAborted();const chunk=Buffer.from(part);bytes+=chunk.length;
          need(bytes<=expected,'PMTILES_UPLOAD_LENGTH_CHANGED');h.update(chunk);await file.writeFile(chunk);}
        need(bytes===expected,'PMTILES_UPLOAD_INCOMPLETE');await file.sync();
      }finally{await file.close();}
      const actual={bytes,sha256:h.digest('hex')};
      if(saved.body)need(saved.body.bytes===actual.bytes&&saved.body.sha256===actual.sha256,'PMTILES_UPLOAD_BODY_CHANGED');
      const target=join(root,'source.bin');
      try{await link(attempt,target);}catch(error){if(error.code!=='EEXIST')throw error;const before=await fileDescriptor(target,{signal});
        need(before.bytes===actual.bytes&&before.sha256===actual.sha256,'PMTILES_UPLOAD_BODY_CHANGED');}
      await syncDirectory(root);
      const complete=saved.body??{schema:'starforge.pmtiles-browser-body.v1',requestSha256:digest(saved.request),...actual,completedAt:timestamp()};
      await retainJson(join(root,'body.json'),complete);
      await unlink(attempt);return status(id);
    });
  }
  async function finish(id,options){
    const saved=await status(id);need(saved.body&&saved.body.requestSha256===digest(saved.request),'PMTILES_UPLOAD_BODY_REQUIRED');
    const resource=await workspace.importLocal({requestId:saved.importRequestId,expectedWorkspaceId:saved.request.workspaceId,
      name:saved.request.name,kind:saved.request.kind,rights:saved.request.rights,
      path:join(directory(id),'source.bin'),expected:{bytes:saved.body.bytes,sha256:saved.body.sha256}},options);
    return {uploadId:id,resource};
  }
  return Object.freeze({prepare,status,receive,finish});
}
