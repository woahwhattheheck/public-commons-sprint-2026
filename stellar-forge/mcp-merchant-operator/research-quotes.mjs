// MIT. Operate native quotations and retain their complete files on one Research attachment.
import {exact,failure} from './host-files.mjs';
import {readResearchHostFile} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/workspace-files.mjs';
import {parseJson,digest} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/store.mjs';
import {QUOTE_REQUEST_LIMIT} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/customer-quotes/contracts.mjs';
export {RESEARCH_QUOTE_PREFIX} from './catalog/research-quotes.mjs';

const selected=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
function original(ok,message){
 if(!ok)throw failure('INVALID_PARAMS',message);
}
async function requestBody(args,{source}={},inputKey='input',sourceKey='source'){
 original((args[inputKey]!==undefined)!==(args[sourceKey]!==undefined),
  'Select exactly one complete native input or host-declared quote-input source.');
 if(args[inputKey]!==undefined)return structuredClone(args[inputKey]);
 original(typeof source==='function','Use a host-declared original quotation input.');
 const value=source(args[sourceKey],['quote-input']);
 return parseJson(await readResearchHostFile(value.file,QUOTE_REQUEST_LIMIT,{sha256:value.sha256}));
}
export async function callResearchQuotes(client,name,args,context={}){
 const api=client.customerQuotes();
 if(name==='merchant_research_quote_configuration'){
  exact(args,['workspace'],['workspace']);return api.configuration();
 }
 if(name==='merchant_research_quote_cases'){
  const fields=['q','status','dueOn','offset','limit'];
  exact(args,['workspace',...fields],['workspace']);return api.listCases(selected(args,fields));
 }
 if(name==='merchant_research_quote_case'){
  exact(args,['workspace','caseId','revision'],['workspace','caseId']);
  return api.readCase(args.caseId,selected(args,['revision']));
 }
 if(name==='merchant_research_quote_operations'){
  const fields=['offset','limit','snapshot','dossierId','kind'];
  exact(args,['workspace',...fields],['workspace']);return api.list(selected(args,fields));
 }
 if(name==='merchant_research_quote_operation'||name==='merchant_research_quote_files'){
  exact(args,['workspace','id'],['workspace','id']);
  return name.endsWith('_files')?api.files(args.id):api.operation(args.id);
 }
 if(name==='merchant_research_quote_case_action'||name==='merchant_research_quote_pricing'){
  const caseAction=name.endsWith('_case_action'),owner=caseAction?'caseId':'profile';
  exact(args,['workspace',owner,'action','input','source'],['workspace',owner,'action']);
  const input=await requestBody(args,context);
  return caseAction?api.caseAction(args.caseId,args.action,input):api.pricing(args.profile,args.action,input);
 }
 if(name==='merchant_research_quote_file_info'){
  exact(args,['workspace','kind','id','fileName','input','source'],['workspace','kind','id']);
  if(args.kind==='OPERATION'){
   original(typeof args.fileName==='string'&&args.input===undefined&&args.source===undefined,
    'Select the exact original operation file name.');
   return api.fileInfo(args.id,args.fileName);
  }
  original(['CASE','TARIFF'].includes(args.kind)&&args.fileName===undefined,
   'Select the original case or tariff download with its complete native input.');
  const input=await requestBody(args,context);
  return args.kind==='CASE'?api.caseFileInfo(args.id,input):api.tariffFileInfo(args.id,input);
 }
 const mutations={
  merchant_research_quote_case_create:'createCase',
  merchant_research_quote_prepare:'prepare',
  merchant_research_quote_response_prepare:'prepareResponse',
  merchant_research_quote_apply:'apply',
  merchant_research_quote_publication_prepare:'preparePublication',
  merchant_research_quote_publication_enroll:'enrollPublication',
  merchant_research_quote_report_prepare:'prepareReport',
 };
 const method=mutations[name];
 if(method){
  exact(args,['workspace','input','source'],['workspace']);
  return api[method](await requestBody(args,context));
 }
 throw failure('TOOL_NOT_FOUND','Unknown original customer quotation operation.');
}
export async function exportResearchQuotes(client,args,{file,download,source}={}){
 original(typeof download==='function','Use the original Research file receiver.');
 const api=client.customerQuotes(),options={file,expectedSha256:args.expectedSha256,expectedBytes:args.quoteExpectedBytes};
 if(args.kind==='quote-operation-file'){
  exact(args,['workspace','kind','quoteOperationId','quoteFileName','quoteExpectedBytes','expectedSha256'],
   ['workspace','kind','quoteOperationId','quoteFileName','quoteExpectedBytes','expectedSha256']);
  const result=await download(()=>api.download(args.quoteOperationId,args.quoteFileName,options));
  return {result,selection:{quoteOperationId:args.quoteOperationId,quoteFileName:args.quoteFileName,quoteExpectedBytes:args.quoteExpectedBytes}};
 }
 original(['quote-case-file','quote-tariff-file'].includes(args.kind),'Select an original quotation file kind.');
 exact(args,['workspace','kind','quoteCaseId','quoteInput','quoteInputSource','quoteExpectedBytes','expectedSha256'],
  ['workspace','kind','quoteCaseId','expectedSha256']);
 const input=await requestBody(args,{source},'quoteInput','quoteInputSource');
 const result=await download(()=>args.kind==='quote-case-file'?api.downloadCase(args.quoteCaseId,input,options):
  api.downloadTariff(args.quoteCaseId,input,options));
 return {result,selection:{quoteCaseId:args.quoteCaseId,quoteInputSha256:digest(Buffer.from(JSON.stringify(input))),
  ...(args.quoteInputSource?{quoteInputSource:args.quoteInputSource}:{}),
  ...(args.quoteExpectedBytes===undefined?{}:{quoteExpectedBytes:args.quoteExpectedBytes}),
  ...(result.metadata?.case?{case:result.metadata.case}:{})}};
}
