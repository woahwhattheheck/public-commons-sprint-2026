// MIT. Installed commands for the original eoAPI customer operator.
import {resolve} from 'node:path';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {readJson,need} from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {openEoapiRuntime} from './runtime.mjs';
import {createEoapiController} from './controller.mjs';
import {startStacServer} from '../server.mjs';
import {openEoapiDelivery} from './delivery.mjs';

export const EOAPI_HELP='Customer imagery onboarding\n\n'+
  '  eoapi-init --workspace DIR [--endpoint URL] [--title TEXT]\n'+
  '  eoapi-serve --workspace DIR [--port 0] [--source-config PRIVATE_JSON] [--transport JSON]\n'+
  '  eoapi-state --workspace DIR\n'+
  '  eoapi-policy-save --workspace DIR --input POLICY_JSON\n'+
  '  eoapi-policy-review --workspace DIR [--expected-revision NUMBER]\n'+
  '  eoapi-policy-approve --workspace DIR --review ID --reviewer NAME\n'+
  '  eoapi-policy-import --workspace DIR --input PACKAGE_JSON\n'+
  '  eoapi-policy-export --workspace DIR [--approval ID] [--out DIR]\n'+
  '  eoapi-source-discover --workspace DIR --operation-id ID [--approval ID] [--target upstream|deployment]\n'+
  '  eoapi-source-review --workspace DIR --reviewer NAME [--approval ID] [--edition ID] [--target upstream|deployment]\n'+
  '  eoapi-bind --workspace DIR --source-review ID --edition ID --operation-id ID\n'+
  '  eoapi-capture --workspace DIR --source-review ID --input QUERY_JSON --operation-id ID\n'+
  '  eoapi-assets --workspace DIR --edition ID --operation-id ID [--max-bytes NUMBER]\n'+
  '  eoapi-delivery-review --workspace DIR --edition ID --reviewer NAME --operation-id ID\n'+
  '  eoapi-delivery-approve --workspace DIR --review ID --reviewer NAME\n'+
  '  eoapi-merchant-stage --workspace DIR --delivery-approval ID --operation-id ID --origin URL --payment JSON\n'+
  '  eoapi-delivery-export --workspace DIR --delivery-approval ID --directory ORIGINAL_CUSTOMER_DIR --out DIR\n'+
  '  eoapi-delivery-open --directory DIR [--expected-manifest-sha256 SHA256]\n'+
  '  eoapi-operation --workspace DIR --operation-id ID\n'+
  '  eoapi-resume --workspace DIR --operation-id ID\n\n'+
  'Source discovery, captures and selected-file acquisition use the same original operation ID on retry.\n'+
  'The existing merchant/customer commands receive the approved edition through the original Buyer.\n';
const required=(flags,name)=>{need(typeof flags[name]==='string'&&flags[name].trim(),'EOAPI_FLAG_'+name.toUpperCase().replaceAll('-','_')+'_REQUIRED');return flags[name];};
const optional=(flags,name)=>flags[name]===undefined?undefined:required(flags,name);
const numeric=(flags,name,fallback)=>{if(flags[name]===undefined)return fallback;const value=Number(flags[name]);need(Number.isSafeInteger(value)&&value>=0,'EOAPI_NUMERIC_FLAG_INVALID');return value;};
const jsonFlag=(flags,name)=>readJson(resolve(required(flags,name)),16*1024*1024);
async function sourceConfiguration(path) {
  const file=await open(resolve(path),constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try {
    const info=await file.stat();
    need(info.isFile()&&info.size<=1024*1024&&(process.platform==='win32'||(!(info.mode&0o077)&&
      (!process.getuid||info.uid===process.getuid()))),'EOAPI_PRIVATE_SOURCE_CONFIGURATION_REQUIRED');
    const raw=await file.readFile();need(raw.length<=1024*1024,'EOAPI_SOURCE_CONFIGURATION_SIZE_LIMIT');return JSON.parse(raw.toString('utf8'));
  }finally{await file.close();}
}
export const EOAPI_OPERATION_ROUTES=Object.freeze({
  DISCOVER:'/source/discover',BIND_EDITION:'/editions/bind',CAPTURE:'/editions/capture',
  ACQUIRE_SELECTED:'/assets/acquire',PREPARE_DELIVERY:'/delivery/review',STAGE_MERCHANT:'/merchant/stage'
});
export async function runEoapiCommand({command,flags={}}={}) {
  if(command==='eoapi-help')return {result:{help:EOAPI_HELP}};
  if(command==='eoapi-delivery-open') {
    const value=await openEoapiDelivery(resolve(required(flags,'directory')),
      {expectedManifestSha256:optional(flags,'expected-manifest-sha256')});
    return {result:{directory:value.directory,manifest:value.manifest,manifestFile:value.manifestFile,
      summary:value.portable.manifest.summary,members:value.delivery.members(),approval:value.context.approval}};
  }
  const runtime=await openEoapiRuntime({directory:resolve(required(flags,'workspace')),
    endpoint:optional(flags,'endpoint'),title:optional(flags,'title'),
    policyDirectory:flags['policy-workspace']?resolve(required(flags,'policy-workspace')):undefined,
    outputDirectory:flags['output-directory']?resolve(required(flags,'output-directory')):undefined,
    transport:flags.transport?await jsonFlag(flags,'transport'):undefined,
    sourceConfiguration:flags['source-config']?await sourceConfiguration(required(flags,'source-config')):undefined,
    create:command==='eoapi-init'});
  let keep=false,processing;
  try {
    const controller=createEoapiController({runtime}),operationId=optional(flags,'operation-id');
    if(command==='eoapi-serve') {
      if(flags['processing-workspace']||flags['processing-config']) {
        const {createProcessingController}=await import('../processing/workspace.mjs');
        processing=await createProcessingController({stacWorkspace:runtime.workspace,
          directory:resolve(required(flags,'processing-workspace')),
          ...(flags['processing-config']?{config:await jsonFlag(flags,'processing-config')}:{})});
      }
      const server=await startStacServer({workspace:runtime.workspace,eoapi:controller,processing,port:numeric(flags,'port',0),
        maxRequestBytes:numeric(flags,'max-request-bytes',128*1024*1024)});
      keep=true;return {result:{url:server.url,directory:runtime.workspace.directory},
        close:async()=>{await server.close();await processing?.close?.();await runtime.close();}};
    }
    if(command==='eoapi-init'||command==='eoapi-state')return {result:await runtime.getState()};
    if(command==='eoapi-operation')return {result:await runtime.onboarding.getOperation(required(flags,'operation-id'))};
    let path,body={};
    const expectedRevision=numeric(flags,'expected-revision',undefined);
    const reviewer=()=>required(flags,'reviewer');
    switch(command) {
      case 'eoapi-policy-save':path='/policy/draft';body={policy:await jsonFlag(flags,'input'),expectedRevision};break;
      case 'eoapi-policy-review':path='/policy/review';body={expectedRevision};break;
      case 'eoapi-policy-approve':path='/policy/approve';body={reviewId:required(flags,'review'),reviewer:reviewer(),expectedRevision};break;
      case 'eoapi-policy-import':path='/policy/import';body={package:await jsonFlag(flags,'input'),expectedRevision};break;
      case 'eoapi-policy-export':path='/policy/export';body={approvalId:optional(flags,'approval'),directory:flags.out?resolve(required(flags,'out')):undefined};break;
      case 'eoapi-source-discover':path='/source/discover';body={approvalId:optional(flags,'approval'),operationId:required(flags,'operation-id'),target:optional(flags,'target')??'deployment'};break;
      case 'eoapi-source-review':path='/source/review';body={approvalId:optional(flags,'approval'),editionId:optional(flags,'edition'),reviewer:reviewer(),expectedRevision,target:optional(flags,'target')??'deployment'};break;
      case 'eoapi-bind':path='/editions/bind';body={sourceReviewId:required(flags,'source-review'),editionId:required(flags,'edition'),operationId:required(flags,'operation-id')};break;
      case 'eoapi-capture':path='/editions/capture';body={sourceReviewId:required(flags,'source-review'),query:await jsonFlag(flags,'input'),operationId:required(flags,'operation-id')};break;
      case 'eoapi-assets':path='/assets/acquire';body={editionId:required(flags,'edition'),operationId:required(flags,'operation-id'),maxBytes:numeric(flags,'max-bytes',16*1024*1024)};break;
      case 'eoapi-delivery-review':path='/delivery/review';body={editionId:required(flags,'edition'),reviewer:reviewer(),operationId:required(flags,'operation-id')};break;
      case 'eoapi-delivery-approve':path='/delivery/approve';body={reviewId:required(flags,'review'),reviewer:reviewer(),expectedRevision};break;
      case 'eoapi-merchant-stage':path='/merchant/stage';body={deliveryApprovalId:required(flags,'delivery-approval'),operationId:required(flags,'operation-id'),origin:required(flags,'origin'),payment:await jsonFlag(flags,'payment'),path:optional(flags,'path')??'/stac'};break;
      case 'eoapi-delivery-export':path='/delivery/export';body={deliveryApprovalId:required(flags,'delivery-approval'),customerDirectory:resolve(required(flags,'directory')),directory:resolve(required(flags,'out'))};break;
      case 'eoapi-resume':{
        const record=await runtime.onboarding.getOperation(required(flags,'operation-id'));
        path=EOAPI_OPERATION_ROUTES[record.kind];need(path,'EOAPI_OPERATION_CANNOT_RESUME');
        body={...record.input,operationId:record.id};break;
      }
      default:need(false,'EOAPI_COMMAND_UNKNOWN');
    }
    const result=await controller.dispatch({method:'POST',path,body});
    return {result,exitCode:['PARTIAL','INTERRUPTED'].includes(result?.status)?2:0};
  }finally{if(!keep){await processing?.close?.();await runtime.close();}}
}
