// MIT. Typed Timescale operations over the existing merchant MCP/file transport.
import { openMerchantFileClient, createRetainedDownload } from './retained-download.mjs';
import { downloadTimescaleExport, inspectTimescaleExport } from './timescale-workspace-download.mjs';
import { failure, identifier, plain } from './host-files.mjs';
import { UUID, HASH } from './catalog/timescale-workspace.mjs';
import { REMEDIATION_MANIFEST, REMEDIATION_MANIFEST_BYTES, REMEDIATION_REPORT_BYTES,
  parseRemediationManifest, remediationReportId } from './timescale-remediation-contract.mjs';

export const TIMESCALE_CLIENT_METHODS=Object.freeze({
  status:'status',open:'open',close:'close',capture:'capture',edition:'edition',compare:'compare',review:'review',
  refresh:'refresh',verify:'verify',job:'job',publication:'publication',operation:'operation',plan:'plan',
  record:'record',file:'file','file-release':'file_release',browser:'browser',export:'export',
  'export-manifest':'export_manifest','export-file':'export_file','export-file-release':'export_file_release',
  'remediation-list':'remediation_list','remediation-sources':'remediation_sources','remediation-item':'remediation_item',
  'remediation-context':'remediation_context','remediation-command':'remediation_command',
  'remediation-report':'remediation_report','report-manifest':'remediation_report_manifest',
  'report-file':'remediation_report_file','report-file-release':'remediation_report_file_release'
});
const safeInteger=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const active=new Set(['RUNNING','DISPATCHING']);
function selected(options){
  identifier(options.workspace,'Timescale workspace alias');
  if(typeof options.workspaceId!=='string'||!UUID.test(options.workspaceId))
    throw failure('TIMESCALE_CLIENT_BINDING','Use the original persistent Timescale workspace UUID.');
  return Object.freeze({workspace:options.workspace,workspaceId:options.workspaceId});
}
function reportReceiver(scope){
  return createRetainedDownload({manifestName:REMEDIATION_MANIFEST,maximumBytes:REMEDIATION_REPORT_BYTES,
    maximumManifestBytes:REMEDIATION_MANIFEST_BYTES,maximumCheckpointBytes:262144,
    stateSchema:'stellar-forge.timescale-remediation-download-state.v1',
    resultSchema:'stellar-forge.timescale-remediation-download-result.v1',
    toolPrefix:'merchant_timescale_remediation_report',errorPrefix:'TIMESCALE_REPORT',
    clientName:'starforge-timescale-remediation-receiving',validateExportId:remediationReportId,
    parseManifest(bytes,id){
      const value=parseRemediationManifest(bytes,id);
      if(value.workspaceId!==scope.workspaceId)throw failure('TIMESCALE_REPORT_BINDING_CHANGED','The retained report belongs to another original workspace.');
      return value;
    },
    describe:value=>({workspaceId:value.workspaceId,workItemId:value.workItemId,itemRevision:value.itemRevision,itemDigest:value.itemDigest})
  });
}
function delay(ms,signal){
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(done,ms);
    function done(){signal?.removeEventListener('abort',aborted);resolve();}
    function aborted(){clearTimeout(timer);signal?.removeEventListener('abort',aborted);reject(signal.reason??new Error('Aborted'));}
    signal?.addEventListener('abort',aborted,{once:true});
    if(signal?.aborted)aborted();
  });
}
/**
 * Uses one original HTTP client. Construction does not open the publisher or
 * repeat a native source operation. All mutating inputs come from the caller.
 */
export async function openTimescaleClient(options={}){
  const scope=selected(options);
  if(options.client!==undefined&&options.url!==undefined)
    throw failure('TIMESCALE_CLIENT_BINDING','Supply the existing merchant client or its URL, not both.');
  const original=options.client??await openMerchantFileClient({...options,errorPrefix:'TIMESCALE',clientName:'starforge-timescale-client'});
  if(!original||typeof original.call!=='function'||typeof original.endpoint!=='string'||!original.endpoint)
    throw failure('TIMESCALE_CLIENT_BINDING','Use the existing merchant client and exact endpoint identity.');
  async function invoke(method,input={},callOptions={}){
    if(!Object.hasOwn(TIMESCALE_CLIENT_METHODS,method)||!plain(input))
      throw failure('TIMESCALE_CLIENT_METHOD','Choose a declared Timescale method and its complete JSON object.');
    input=structuredClone(input);
    if(input.workspace!==undefined&&input.workspace!==scope.workspace||
        input.workspaceId!==undefined&&input.workspaceId!==scope.workspaceId)
      throw failure('TIMESCALE_CLIENT_BINDING','The input belongs to another original workspace.');
    delete input.workspace;delete input.workspaceId;
    const tool='merchant_timescale_'+TIMESCALE_CLIENT_METHODS[method];
    if(method==='open'){
      if(Object.keys(input).length)throw failure('TIMESCALE_CLIENT_METHOD','Open takes no additional input.');
      // Inspect the configured identity before opening its original owner.
      await invoke('status',{},callOptions);
    }
    const value=await original.call(tool,method==='open'?{workspace:scope.workspace}:{...input,...scope},callOptions);
    if(value?.workspace!==scope.workspace||method!=='close'&&value.workspaceId!==scope.workspaceId)
      throw failure('TIMESCALE_CLIENT_BINDING_CHANGED','The original merchant returned a different workspace identity.');
    if(!['status','open','close'].includes(method)&&!plain(value.result))
      throw failure('TIMESCALE_CLIENT_RESPONSE','The original merchant response did not contain its declared result.');
    return ['status','open','close'].includes(method)?value:value.result;
  }
  const reportClient={endpoint:JSON.stringify([original.endpoint,'timescale-remediation',scope.workspace,scope.workspaceId]),
    async call(tool,args,callOptions){
      const methods={merchant_timescale_remediation_report_manifest:'report-manifest',
        merchant_timescale_remediation_report_file:'report-file',merchant_timescale_remediation_report_file_release:'report-file-release'};
      if(!Object.hasOwn(methods,tool))throw failure('TIMESCALE_CLIENT_METHOD','Use an original remediation report file operation.');
      return invoke(methods[tool],args,callOptions);
    }};
  const reportFiles=reportReceiver(scope);
  function receiving(input={}){
    if(!plain(input)||input.client!==undefined||input.url!==undefined||input.workspace!==undefined||input.workspaceId!==undefined)
      throw failure('TIMESCALE_CLIENT_BINDING','Receiving uses this client’s original endpoint and workspace.');
    return {...input,client:original,...scope};
  }
  async function wait(requestId,{intervalMs=250,timeoutMs=600000,signal=options.signal}={}){
    if(!UUID.test(requestId??'')||!safeInteger(intervalMs,25,60000)||!safeInteger(timeoutMs,1,3600000))
      throw failure('TIMESCALE_CLIENT_WAIT','Use the original request UUID and an explicit bounded observation interval.');
    const deadline=Date.now()+timeoutMs;
    for(;;){
      signal?.throwIfAborted();
      const result=await invoke('operation',{action:'inspect',requestId},{requestSignal:signal,timeoutMs:Math.max(1,deadline-Date.now())});
      if(!active.has(result.state))return result;
      if(Date.now()>=deadline)throw Object.assign(failure('TIMESCALE_CLIENT_WAIT_TIMEOUT',
        'The original request remains active. Inspect this same request; no native action was repeated.'),{requestId});
      await delay(Math.min(intervalMs,Math.max(1,deadline-Date.now())),signal);
    }
  }
  const api={endpoint:original.endpoint,...scope,call:invoke,wait};
  for(const method of ['status','open','close','capture','edition','compare','review','refresh','verify','job',
    'publication','operation','plan','record','file','browser','export'])
    api[method]=(input={},callOptions={})=>invoke(method,input,callOptions);
  api.releaseFile=(input,callOptions)=>invoke('file-release',input,callOptions);
  api.exports=Object.freeze({
    inspect:input=>inspectTimescaleExport(receiving(input)),
    download:input=>downloadTimescaleExport(receiving(input))
  });
  api.remediation=Object.freeze({
    list:(input={},callOptions)=>invoke('remediation-list',input,callOptions),
    sources:(input={},callOptions)=>invoke('remediation-sources',input,callOptions),
    item:(input,callOptions)=>invoke('remediation-item',input,callOptions),
    context:(input,callOptions)=>invoke('remediation-context',input,callOptions),
    command:(input,callOptions)=>invoke('remediation-command',input,callOptions),
    report:(input,callOptions)=>invoke('remediation-report',input,callOptions),
    inspectReport:input=>{receiving(input);return reportFiles.inspect({...input,client:reportClient});},
    downloadReport:input=>{receiving(input);return reportFiles.download({...input,client:reportClient});}
  });
  return Object.freeze(api);
}
