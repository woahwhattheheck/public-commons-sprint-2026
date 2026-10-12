// MIT. Europe PMC operations through the original Research attachment and retainer.
import {need,object} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/store.mjs';

import {RESEARCH_EUROPE_PMC_PREFIX,RESEARCH_EUROPE_PMC_EXPORTS} from './catalog/research-europe-pmc.mjs';
export {RESEARCH_EUROPE_PMC_PREFIX,RESEARCH_EUROPE_PMC_EXPORTS} from './catalog/research-europe-pmc.mjs';

function id(value,code='EUROPE_PMC_ID_INVALID') {
  need(typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f\u007f/\\]/.test(value),code);
  return value;
}
function input(value={}) {
  need(object(value),'EUROPE_PMC_NATIVE_INPUT_REQUIRED');
  return value;
}
async function selected(client,args,{discover=false,parameters={}}={}) {
  need(typeof client?.europePmc==='function','EUROPE_PMC_RESEARCH_CLIENT_REQUIRED');
  const service=await client.europePmc();
  const original=await service.list(input(parameters));
  const library=id(original?.selection?.library,'EUROPE_PMC_LIBRARY_SELECTION_REQUIRED');
  if(!discover||args.library!==undefined)
    need(id(args.library,'EUROPE_PMC_LIBRARY_SELECTION_REQUIRED')===library,'EUROPE_PMC_LIBRARY_CHANGED');
  return {service,library,original};
}
function declaredSource(resolveSource,name,kinds) {
  need(typeof resolveSource==='function','RESEARCH_SOURCE_REQUIRED');
  const source=resolveSource(name,kinds);
  need(object(source)&&typeof source.file==='string'&&/^[a-f0-9]{64}$/.test(source.sha256),'RESEARCH_SOURCE_REQUIRED');
  return source;
}
function exactFields(value,allowed) {
  for(const key of Object.keys(value))need(allowed.includes(key),'EUROPE_PMC_NATIVE_INPUT_FIELD_INVALID');
  return value;
}

export async function callResearchEuropePmc(client,name,args,{source}={}) {
  need(typeof name==='string'&&name.startsWith(RESEARCH_EUROPE_PMC_PREFIX),'EUROPE_PMC_TOOL_UNKNOWN');
  need(object(args),'EUROPE_PMC_NATIVE_INPUT_REQUIRED');
  const action=name.slice(RESEARCH_EUROPE_PMC_PREFIX.length);
  const {service,original}=await selected(client,args,{
    discover:action==='list',parameters:action==='list'?args.parameters??{}:{},
  });
  const native=()=>input(args.input);
  const operation=()=>id(args.operationId);
  switch(action) {
    case 'list':return original;
    case 'status':return service.status();
    case 'history':return service.history();
    case 'query':return service.query(id(args.queryId));
    case 'save_query':return service.saveQuery(native());
    case 'prepare':return service.prepare(native());
    case 'inspect':return service.inspect(operation());
    case 'start':return service.start(operation(),native());
    case 'stop':return service.stop(operation());
    case 'seal':return service.seal(operation(),native());
    case 'continue':return service.continueSearch(operation(),native());
    case 'chain':return service.chain(operation());
    case 'records':return service.records(operation(),input(args.parameters));
    case 'source':
      need(Number.isSafeInteger(args.index)&&args.index>=0,'EUROPE_PMC_SOURCE_INDEX_INVALID');
      need(args.boundary===undefined||typeof args.boundary==='boolean','EUROPE_PMC_BOUNDARY_INVALID');
      return service.source(operation(),args.index,{boundary:args.boundary??false});
    case 'import':{
      const declared=declaredSource(source,args.source,['europe-pmc-packet']);
      const request=exactFields(native(),['expectedPlanSha256','stopReason']);
      return service.importFile(operation(),{...request,file:declared.file,sha256:declared.sha256});
    }
    case 'review':return service.review(native());
    case 'receive':return service.receive(operation(),native());
    case 'comparison':return service.comparison(input(args.parameters));
    case 'export_workspace':return service.exportWorkspace(native());
    case 'restore':{
      const declared=declaredSource(source,args.source,['europe-pmc-portable']);
      const request=exactFields(native(),['requestId','actor']);
      return service.restoreFile({...request,file:declared.file,expectedSha256:declared.sha256});
    }
    default:throw Object.assign(new Error('EUROPE_PMC_TOOL_UNKNOWN'),{code:'EUROPE_PMC_TOOL_UNKNOWN'});
  }
}

export async function exportResearchEuropePmc(client,args,{file,download}={}) {
  need(object(args)&&Object.hasOwn(RESEARCH_EUROPE_PMC_EXPORTS,args.kind),'EUROPE_PMC_EXPORT_KIND_INVALID');
  need(typeof file==='string'&&typeof download==='function','EUROPE_PMC_EXPORT_RETAINER_REQUIRED');
  const common=['workspace','library','kind','expectedSha256'];
  exactFields(args,args.kind==='europe-pmc-workspace'?[...common,'requestId']:
    args.kind==='europe-pmc-source'?[...common,'operationId','index','boundary']:[...common,'operationId']);
  if(args.expectedSha256!==undefined)need(/^[a-f0-9]{64}$/.test(args.expectedSha256),'EUROPE_PMC_EXPORT_DIGEST_INVALID');
  const {service,library}=await selected(client,args);
  let result,selection;
  if(args.kind==='europe-pmc-workspace') {
    const requestId=id(args.requestId);
    result=await download(()=>service.downloadWorkspace({requestId,file,
      ...(args.expectedSha256?{expectedSha256:args.expectedSha256}:{})}));
    selection={library,requestId,kind:args.kind};
  } else {
    const operationId=id(args.operationId);
    const original=await service.inspect(operationId);
    need(original?.plan?.id===operationId&&/^[a-f0-9]{64}$/.test(original.plan.sha256),
      'EUROPE_PMC_OPERATION_SELECTION_CHANGED');
    selection={library,operationId,kind:args.kind,planSha256:original.plan.sha256,
      editionSha256:original.operation.editionSha256,editionBytes:original.operation.editionBytes,
      phase:original.operation.phase,coverage:original.operation.coverage,
      query:original.plan.payload.query,pagination:original.plan.payload.pagination,
      label:original.plan.payload.label};
    if(args.kind==='europe-pmc-source') {
      need(Number.isSafeInteger(args.index)&&args.index>=0,'EUROPE_PMC_SOURCE_INDEX_INVALID');
      need(args.boundary===undefined||typeof args.boundary==='boolean','EUROPE_PMC_BOUNDARY_INVALID');
      const descriptor=await service.source(operationId,args.index,{boundary:args.boundary??false});
      need(typeof descriptor.documentId==='string'&&/^[a-f0-9]{64}$/.test(descriptor.bodySha256)&&
        Number.isSafeInteger(descriptor.bodyBytes)&&descriptor.bodyBytes>=0,
        'EUROPE_PMC_SOURCE_DESCRIPTOR_REQUIRED');
      result=await download(async()=>{
        let exported;
        try{exported=await service.exportSource(operationId,{file,index:args.index,boundary:args.boundary??false,
          expectedSha256:descriptor.bodySha256});}
        catch(error){
          if(error.code==='RESEARCH_EXPORTED_FILE_CHANGED'&&error.destinationPublished===true)
            error.expectedSha256=descriptor.bodySha256;
          throw error;
        }
        if(exported.bytes!==descriptor.bodyBytes||
          args.expectedSha256!==undefined&&exported.sha256!==args.expectedSha256)
          throw Object.assign(new Error('RESEARCH_EXPORTED_FILE_CHANGED'),{
            code:'RESEARCH_EXPORTED_FILE_CHANGED',destinationPublished:true,file:exported,
            expectedSha256:args.expectedSha256??descriptor.bodySha256,expectedBytes:descriptor.bodyBytes,
          });
        return exported;
      });
      Object.assign(selection,{index:args.index,boundary:args.boundary??false,
        documentId:descriptor.documentId,bodySha256:descriptor.bodySha256,bodyBytes:descriptor.bodyBytes,
        sourceMatchesDescriptor:result.sha256===descriptor.bodySha256&&result.bytes===descriptor.bodyBytes});
    } else {
      const format=args.kind.slice('europe-pmc-'.length);
      result=await download(()=>service.exportEdition(operationId,{file,format,
        ...(args.expectedSha256?{expectedSha256:args.expectedSha256}:{})}));
    }
  }
  return {result,selection};
}
