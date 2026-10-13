// SPDX-License-Identifier: MIT
// Agent operations over the unchanged private staff-portal operator.
import {MAX_RETAINED_CHUNK_BYTES} from '../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
export const READ_ROUTES=Object.freeze({view:'/api/view',preview:'/api/preview',portal_context:'/api/portal/context',portal_view:'/api/portal/view',portal_preview:'/api/portal/preview',insights_connection:'/api/insights/connection'});
export const ARTIFACT_KINDS=['object','workspace','batch','batch_file','report','portal_batch','portal_batch_file','portal_report','delivery'];
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'},text=(maxLength,minLength=1)=>({type:'string',minLength,maxLength}),id=text(200),sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const int=(minimum=0,maximum=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum,maximum}),object={type:'object'},read={readOnly:true,idempotent:true},write={idempotent:true};
const page={offset:int(),limit:int(1,100)},file={fileId:sha,expectedSha256:sha};
const action={type:'object',additionalProperties:false,properties:{requestId:id,expectedRevision:int(),action:text(200),payload:object},required:['requestId','expectedRevision','action','payload']};
export function staffPortalTools(tool){
 const t=(suffix,description,p={},required=['workspace'],annotations=read)=>tool('merchant_staff_portal_'+suffix,description,{workspace:alias,...p},required,annotations);
 const selected={workspaceId:id};
 return [
 t('status','List host-declared staff portal installations and source input identities; never start an application.',{},[]),
 t('connect','Attach to the declared original managed portal. Keep its cookie and native connection session until explicit disconnect; never silently reauthenticate after a launch change.',{expectedLaunchId:text(200)},['workspace'],write),
 t('disconnect','Close only this client session and retained read handles; preserve the original application and every saved workspace.',{launchId:text(200)},['workspace','launchId'],write),
 t('info','Retain the complete managed source and original state handshake. Cookies, access keys, CSRF and native tokens are excluded.'),
 t('workspaces','Retain the complete original workspace registry and this session selection.'),
 t('select','Deliberately select one original or independently received workspace; original native account connection is cleared when selection changes.',selected,['workspace','workspaceId'],write),
 t('state','Retain the complete selected original public state across migration, portal, analytics and editorial domains.',selected,['workspace','workspaceId']),
 t('read','Retain a full original named read response. Native page/pageSize limits remain authoritative; view supports all original migration, insights and editorial kinds.',{...selected,route:{type:'string',enum:Object.keys(READ_ROUTES)},query:object},['workspace','workspaceId','route','query']),
 t('create','Retain and send the original workspace-create request. Its stable ID and origin workspace header survive response loss and selection changes.',{...selected,requestId:id,name:text(1000)},['workspace','workspaceId','requestId','name'],write),
 t('action','Retain and submit one complete original revision-bound mutation. Replay the exact body and actor; editorial/native authorization remains original.',{...selected,body:action},['workspace','workspaceId','body'],{idempotent:true,openWorld:true}),
 t('upload_input','Stream a complete SHA-bound host-declared source file into the original one-GiB upload route. The exact immutable input and request are retained before dispatch.',{...selected,sourceInput:alias,expectedSourceSha256:sha,requestId:id},['workspace','workspaceId','sourceInput','expectedSourceSha256','requestId'],write),
 t('receive','Receive an already uploaded original workspace ZIP and immediately select its independently restored workspace. Preserve original source/history and stable request ID; a full delivery ZIP is opened with the original delivery receiver/CLI.',{...selected,objectSha256:sha,requestId:id},['workspace','workspaceId','objectSha256','requestId'],write),
 t('operation','Read the original stored mutation/upload response for the exact selected request; this performs no business mutation.',{...selected,kind:{type:'string',enum:['mutate','upload']},request:object},['workspace','workspaceId','kind','request']),
 t('native_connection','Retain current original native account/tenant binding and cooldowns. Native tokens never leave the session.',selected,['workspace','workspaceId']),
 t('native_connect','Connect the original session using one host-declared private token input and allowed origin. This performs the original authentication read; token content is never journalled or returned.',{...selected,nativeConnection:alias},['workspace','workspaceId','nativeConnection'],{openWorld:true}),
 t('native_disconnect','Clear this session native account connection without altering retained native runs or sources.',selected,['workspace','workspaceId'],write),
 t('native_start','Retain the exact original native analytics/search start input, including its operationId and current nativeBinding. This selects an original run and never invents a completed capture.',{...selected,requestId:id,body:object},['workspace','workspaceId','requestId','body'],{idempotent:true,openWorld:true}),
 t('native_capture','Perform one explicit original provider exchange for a selected retained run. A saved uncertain attempt is never automatically repeated; inspect its original run and retained request evidence before selecting a later capture.',{...selected,requestId:id,runId:id},['workspace','workspaceId','requestId','runId'],{openWorld:true}),
 t('artifact','Retain every byte of one original object, report, workspace, batch/member or complete source delivery ZIP. Identity is the actual returned bytes; no request-ID export cache or unmeasured source digest is invented.',{...selected,kind:{type:'string',enum:ARTIFACT_KINDS},query:object,objectSha256:sha,expectedSha256:sha,expectedBytes:int(0,1073741824+48*1024*1024),filename:text(240)},['workspace','workspaceId','kind','query']),
 t('files','Page the complete retained source/response/artifact descriptors.',page),
 t('file','Read the complete selected retained file in SHA-bound pages of at most196608 bytes.',{...file,readId:text(200),offset:int(),limit:int(1,MAX_RETAINED_CHUNK_BYTES)},['workspace','fileId','expectedSha256']),
 t('file_release','Release a retained read handle without deleting its original bytes.',{readId:text(200)},['workspace','readId'],write),
 t('inspect','Read an exact retained JSON pointer or page up to50 rows. JSON inspection is32MiB; all larger files remain available through complete byte reads.',{...file,pointer:text(4000,0),offset:int(),limit:int(1,50)},['workspace','fileId','expectedSha256']),
 t('requests','Page complete durable selected requests, original HTTP outcomes and separate dispatch/recovery observations. HTTP_OBSERVED does not imply that an error had no effects.',page),
 t('browser','Return the original portal, migration, insights or editorial browser origin without access keys or session tokens.',{view:{type:'string',enum:['portal','migration','insights','editorial']}},['workspace','view'])
 ];
}
