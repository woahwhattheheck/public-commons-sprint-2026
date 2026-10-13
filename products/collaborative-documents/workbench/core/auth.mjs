import { readFileSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createHmac } from 'node:crypto';
import { atomicBytes, text, id, array, object, requireValue, constantEqual, identity, now } from './common.mjs';

export function permissions(actor){
  const roles=actor?.roles??[];
  return {operate:roles.includes('operator'),read:roles.some(r=>['operator','editor','viewer'].includes(r)),edit:roles.includes('editor')||roles.includes('operator')};
}
export function documentAccess(project,document,actor){
  if(!actor||!permissions(actor).read)return 'none';
  if(!actor.tenantIds.includes(document.tenantId)&&!actor.tenantIds.includes('*'))return 'none';
  const grants=project.grants.filter(g=>g.enabled&&g.actorId===actor.id&&g.tenantId===document.tenantId&&(!g.documentIds.length||g.documentIds.includes(document.id)));
  if(permissions(actor).edit&&grants.some(g=>g.access==='write'))return 'write';
  return grants.some(g=>['read','write'].includes(g.access))?'read':'none';
}
export function requireOperator(actor){requireValue(permissions(actor).operate,'OPERATOR_REQUIRED','The current host actor does not have operator permission.',403);}
function checkedActor(value){
  object(value,'verified actor');id(value.id,'actor.id');text(value.name,'actor.name',{min:1,max:200});
  array(value.roles,'actor.roles',{max:3});requireValue(value.roles.every(r=>['operator','editor','viewer'].includes(r)),'AUTH_CONTRACT','The host actor has an unsupported role.',401);
  array(value.tenantIds,'actor.tenantIds',{max:10000});for(const t of value.tenantIds)if(t!=='*')id(t,'tenantId');
  return {id:value.id,name:value.name,roles:[...new Set(value.roles)],tenantIds:[...new Set(value.tenantIds)]};
}
export class Auth {
  constructor({directory,authFile,contextForRequest}){
    this.authFile=authFile;this.contextForRequest=contextForRequest;this.sessions=new Map();
    requireValue(authFile||typeof contextForRequest==='function','AUTH_REQUIRED','Supply the original host authentication callback or private auth file.');
    const path=join(directory,'local-session-secret');
    if(!existsSync(path))atomicBytes(path,randomBytes(32),{immutable:true});
    this.secret=readFileSync(path);requireValue(this.secret.length===32,'AUTH_SECRET','The local session secret has an invalid length.',409);
  }
  config(){
    if(!this.authFile)return null;
    const stat=lstatSync(this.authFile);requireValue(stat.isFile()&&!stat.isSymbolicLink()&&!(stat.mode&0o077)&&(typeof process.getuid!=='function'||stat.uid===process.getuid()),'AUTH_FILE_PRIVATE','Use the owned private authentication file with mode0600.',401);
    const value=JSON.parse(readFileSync(this.authFile,'utf8'));requireValue(value.schema==='tjlabs.tiptap-auth.v1','AUTH_CONTRACT','Unexpected private authentication schema.',401);
    array(value.actors,'actors',{max:1000});
    const ids=new Set();for(const a of value.actors){checkedActor(a);text(a.token,'actor.token',{min:24,max:1024});requireValue(!ids.has(a.id),'AUTH_CONTRACT','Duplicate actor identity in private auth file.',401);ids.add(a.id);}
    return value;
  }
  async actor(request){
    if(this.contextForRequest)return checkedActor(await this.contextForRequest(request));
    const header=request.headers?.get?request.headers.get('authorization'):request.headers?.authorization;
    requireValue(typeof header==='string'&&header.startsWith('Bearer '),'UNAUTHENTICATED','Supply the installation bearer token.',401);
    const token=header.slice(7),matches=this.config().actors.filter(a=>constantEqual(a.token,token));
    requireValue(matches.length===1,'UNAUTHENTICATED','The installation token is not recognized.',401);return checkedActor(matches[0]);
  }
  issue(project,document,actor,deploymentId,request){
    const access=documentAccess(project,document,actor);requireValue(access!=='none','DOCUMENT_FORBIDDEN','The current actor has no grant for this tenant/document.',403);
    const seconds=project.settings.sessionTtlSeconds,nonce=randomBytes(18).toString('base64url');
    const payload={v:1,projectId:project.id,documentId:document.id,documentName:document.documentName,epochId:document.epochId,actorId:actor.id,deploymentId,exp:Date.now()+seconds*1000,nonce};
    const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url'),signature=createHmac('sha256',this.secret).update(encoded).digest('base64url');
    requireValue(!this.contextForRequest||request,'HOST_SESSION_REQUEST','The original host authentication request is required for current-session revalidation.',401);
    this.sessions.set(nonce,{actor,request,expires:payload.exp});this.prune();
    return {token:encoded+'.'+signature,expiresAt:new Date(payload.exp).toISOString(),access};
  }
  prune(){for(const [nonce,item] of this.sessions)if(item.expires<Date.now())this.sessions.delete(nonce);}
  async verify(token,documentName,readProject){
    text(token,'provider token',{min:20,max:8192});const parts=token.split('.');requireValue(parts.length===2,'UNAUTHENTICATED','Malformed native provider token.',401);
    const signature=createHmac('sha256',this.secret).update(parts[0]).digest('base64url');requireValue(constantEqual(parts[1],signature),'UNAUTHENTICATED','Native provider token does not belong to this host.',401);
    const payload=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    requireValue(payload.v===1&&payload.exp>Date.now()&&payload.documentName===documentName,'SESSION_EXPIRED','Native provider session expired or names another document.',401);
    const session=this.sessions.get(payload.nonce);requireValue(session&&session.expires===payload.exp,'SESSION_EXPIRED','This native provider session is no longer active.',401);
    const fresh=this.config()?.actors.find(a=>a.id===payload.actorId);
    const actor=this.authFile?(fresh?checkedActor(fresh):null):checkedActor(await this.contextForRequest(session.request));
    requireValue(actor,'SESSION_REVOKED','The original host actor is no longer available.',403);
    const project=readProject(payload.projectId),document=project.documents.find(d=>d.id===payload.documentId);
    requireValue(document&&document.epochId===payload.epochId&&document.documentName===documentName,'DOCUMENT_EPOCH_CHANGED','This token belongs to a retained earlier document epoch.',403);
    const access=documentAccess(project,document,actor);requireValue(access!=='none','SESSION_REVOKED','The original tenant/document grant is no longer available.',403);
    return {projectId:project.id,documentId:document.id,epochId:document.epochId,documentName,actorId:actor.id,actor,access,deploymentId:payload.deploymentId,expiresAt:payload.exp};
  }
}
