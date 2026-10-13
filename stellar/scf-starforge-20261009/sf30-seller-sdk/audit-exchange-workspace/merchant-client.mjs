import {readFile,lstat,realpath} from "node:fs/promises";
import {resolve,dirname,basename} from "node:path";
import {privateAuditUrl} from "./connection.mjs";
import {sha256} from "./util.mjs";
export function auditHostError(message,status=400,code="AUDIT_HOST_INPUT",details){return Object.assign(new Error(message),{status,code,details});}
const need=(value,message)=>{if(!value)throw auditHostError(message);};
const alias=value=>/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
export async function readAuditWorkspaceConfiguration(filename){
  const selected=resolve(filename),info=await lstat(selected);
  need(info.isFile()&&!info.isSymbolicLink()&&info.size<=1048576,"Select the complete original ordinary workspace connection file.");
  const value=JSON.parse(await readFile(selected,"utf8"));
  need(value.schema==="commons.audit-exchange.connections.v1"&&value.workspaces&&typeof value.workspaces==="object"&&!Array.isArray(value.workspaces),"Use the native Audit Exchange connection format.");
  const workspaces={};
  for(const [name,entry] of Object.entries(value.workspaces)){
    need(alias(name)&&entry&&typeof entry.workspaceId==="string"&&entry.workspaceId&&typeof entry.instanceId==="string"&&entry.instanceId,"Each workspace alias requires its original workspace and running-instance identities.");
    const inputs={};
    for(const [input,item] of Object.entries(entry.inputs??{})){
      need(alias(input)&&item&&typeof item.path==="string"&&/^[a-f0-9]{64}$/.test(item.sha256),"Every original host input requires a named path and exact SHA-256.");
      const lexicalPath=resolve(dirname(selected),item.path),path=await realpath(lexicalPath),stat=await lstat(lexicalPath);
      need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=1073741824,"Choose an ordinary complete input within the one-GiB package capacity.");
      inputs[input]={path,lexicalPath,name:item.name??basename(path),sha256:item.sha256,bytes:stat.size,mime:item.mime??"application/octet-stream",sourceReference:item.sourceReference??""};
    }
    workspaces[name]={url:privateAuditUrl(entry.url),workspaceId:entry.workspaceId,instanceId:entry.instanceId,label:entry.label??name,inputs};
  }
  need(Object.keys(workspaces).length>0,"Configure at least one original workspace.");
  return {schema:value.schema,workspaces};
}
export async function readAuditHostInput(entry,name,expectedSha256){
  const input=entry.inputs[name];need(input,"Choose a configured original input alias.");
  if(expectedSha256!==undefined)need(expectedSha256===input.sha256,"The selected original input identity differs.");
  const actual=await lstat(input.lexicalPath);
  need(actual.isFile()&&!actual.isSymbolicLink()&&await realpath(input.lexicalPath)===input.path&&actual.size===input.bytes,"The complete original host input path changed.");
  const bytes=await readFile(input.path);need(bytes.length===input.bytes&&sha256(bytes)===input.sha256,"The full original host input bytes changed.");
  return {input,bytes};
}
