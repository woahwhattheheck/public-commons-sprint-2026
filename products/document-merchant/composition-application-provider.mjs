// MIT. Saved document production in the original Applications customer lifetime.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup}
  from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs';
import {absolute,plain,need,digest,json,canonical}
  from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import {inspectMerchantRuntime} from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';

export const DOCUMENT_COMPOSITION_APPLICATION_ID='document-composition';
const SOURCE='products/document-merchant';
const SELECTION='stellar-forge.document-composition-service-selection.v1';
const STARTUP='stellar-forge.document-composition-service-launch.v1';
const HASH=/^[a-f0-9]{64}$/;
const TEXT_OPTIONS=Object.freeze([
  ['workspaceOptionsFile','--workspace-options'],['sourceRoot','--source-root'],
  ['provider','--provider'],['merchantOrigin','--merchant-origin'],['intakeKeyEnvironment','--intake-key-env']
]);
const NUMBERS=Object.freeze([
  ['deadlineMs','--deadline-ms',300000,1000,3600000],
  ['pollMs','--poll-ms',1500,250,30000],['port','--port',0,0,65535]
]);
const LINKS=Object.freeze([
  ['documents','Document production','documentUrl'],['request','Request a job','customerUrl'],
  ['checkout','Checkout and approval','checkoutUrl'],['jobs','Purchased jobs','jobsUrl'],
  ['library','Resource library','libraryUrl'],['collections','Collections','collectionsUrl'],
  ['resolutions','Job resolutions','resolutionUrl']
]);
export function documentCompositionApplication({common,field}){
  return {
    id:DOCUMENT_COMPOSITION_APPLICATION_ID,command:'document-merchant',title:'Document production',
    terminal:false,requiredSource:SOURCE+'/composition-service.mjs',
    description:'Turn CSV or JSON records and templates into saved document batches, review the original quote, receive whole PDFs and export complete customer Collections in the same Jobs workspace.',
    fields:[
      field('workspaceOptionsFile','Private customer options JSON','path',true,
        'Select the existing complete customer JSON, including directory and checkout.operatorWorkspace or checkout.operatorProfile.'),
      field('sourceRoot','Saved composition directory','path',false,
        'Defaults to artifacts/document-compositions in the selected customer. Custom paths stay inside that customer’s original file roots.'),
      field('provider','Default document provider','text',false,'mintpdf (default), snaplab or pdfmint.'),
      field('merchantOrigin','Default merchant HTTPS origin','text',false,
        'The actual document merchant origin. It can also be selected for each source configuration in the browser.'),
      field('intakeKeyEnvironment','Private intake environment name','text',false,
        'Optional name of the original intake key; its value stays in the private process environment.'),
      field('deadlineMs','Receiving wait in milliseconds','text',false,'1000–3600000; default 300000.'),
      field('pollMs','Receiving poll in milliseconds','text',false,'250–30000; default 1500.'),
      ...common
    ]
  };
}
export function validateDocumentCompositionApplicationSettings(settings){
  need(typeof settings.workspaceOptionsFile==='string'&&settings.workspaceOptionsFile.length>0,
    'APPLICATION_DOCUMENT_COMPOSITION_CUSTOMER_REQUIRED');
  absolute(settings.workspaceOptionsFile);
  if(settings.sourceRoot)absolute(settings.sourceRoot);
  need(['mintpdf','snaplab','pdfmint'].includes(settings.provider??'mintpdf'),
    'APPLICATION_DOCUMENT_COMPOSITION_PROVIDER_INVALID');
  if(settings.merchantOrigin){
    let url;try{url=new URL(settings.merchantOrigin);}catch{need(false,'APPLICATION_DOCUMENT_COMPOSITION_ORIGIN_INVALID');}
    need(url.protocol==='https:'&&url.origin===settings.merchantOrigin&&!url.username&&!url.password,
      'APPLICATION_DOCUMENT_COMPOSITION_ORIGIN_INVALID');
  }
  if(settings.intakeKeyEnvironment)need(/^[A-Z][A-Z0-9_]{2,63}$/.test(settings.intakeKeyEnvironment),
    'APPLICATION_DOCUMENT_COMPOSITION_ENVIRONMENT_INVALID');
  for(const [name,,fallback,min,max]of NUMBERS){
    const raw=settings[name]??fallback;
    need(typeof raw==='number'||typeof raw==='string'&&/^(?:0|[1-9][0-9]*)$/.test(raw),
      'APPLICATION_DOCUMENT_COMPOSITION_NUMBER_INVALID');
    const value=Number(raw);
    need(Number.isSafeInteger(value)&&value>=min&&value<=max,
      'APPLICATION_DOCUMENT_COMPOSITION_NUMBER_INVALID');
  }
}
async function reader(directory){
  directory=absolute(directory);
  const original=await import(pathToFileURL(join(directory,'composition-service.mjs')).href);
  need(original.DOCUMENT_COMPOSITION_SERVICE_SELECTION_SCHEMA===SELECTION&&
    original.DOCUMENT_COMPOSITION_SERVICE_LAUNCH_SCHEMA===STARTUP&&
    ['readDocumentCompositionServiceSelection','assertDocumentCompositionServiceSelection',
      'assertDocumentCompositionServiceSource','readDocumentCompositionServiceLaunch',
      'openDocumentCompositionService'].every(name=>typeof original[name]==='function'),
    'APPLICATION_DOCUMENT_COMPOSITION_SOURCE_REQUIRED');
  return original;
}
function serviceOptions(settings){
  validateDocumentCompositionApplicationSettings(settings);
  return {
    workspaceOptionsFile:settings.workspaceOptionsFile,
    sourceRoot:settings.sourceRoot||null,provider:settings.provider??'mintpdf',
    merchantOrigin:settings.merchantOrigin||null,intakeKeyEnvironment:settings.intakeKeyEnvironment||null,
    ...Object.fromEntries(NUMBERS.map(([name,,fallback])=>[name,Number(settings[name]??fallback)]))
  };
}
export async function prepareDocumentCompositionApplication(settings,{inputPath,runtimeDirectory}){
  const options=serviceOptions(settings);
  const runtime=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false,source:false});
  const sourceDirectory=join(runtime.sourceRoot,SOURCE),original=await reader(sourceDirectory);
  const selected=original.assertDocumentCompositionServiceSelection(
    await original.readDocumentCompositionServiceSelection(options));
  need(selected.sourceDirectory===sourceDirectory,'APPLICATION_DOCUMENT_COMPOSITION_SOURCE_CHANGED');
  const state=await inputPath(selected.customer.directory,'directory',true,true),inputs=[state];
  for(const file of [...selected.configurationFiles,...selected.sourceFiles,...selected.nativeFiles]){
    if(inputs.some(item=>item.path===file.path))continue;
    const current=await inputPath(file.path,'file');
    need(current.bytes===file.bytes&&current.sha256===file.sha256,
      'APPLICATION_DOCUMENT_COMPOSITION_SOURCE_CHANGED','Review the current selected source and customer configuration.');
    inputs.push(current);
  }
  if(selected.customer.operatorSelection.kind==='workspace')
    inputs.push(await inputPath(selected.customer.operatorSelection.directory,'directory',false,true));
  const args=['compose','serve','--managed-source',sourceDirectory,
    '--expected-selection',selected.selectionSha256];
  for(const [name,flag]of TEXT_OPTIONS)if(selected.options[name]!==null)args.push(flag,selected.options[name]);
  for(const [name,flag]of NUMBERS)args.push(flag,String(selected.options[name]));
  return {
    args,inputs,createDirectories:[],
    // This is the original Applications hash, including its canonical JSON encoding.
    resourceKey:digest(json(canonical({family:'job-checkout',directory:selected.customer.directory}))),
    documentComposition:{
      schema:SELECTION,directory:selected.customer.directory,
      sourceDirectory,sourceRoot:selected.sourceRoot,
      selectionSha256:selected.selectionSha256,
      runtimeDirectory:selected.customer.runtimeDirectory,
      operatorSelection:selected.customer.operatorSelection,
      provider:selected.options.provider,merchantOrigin:selected.options.merchantOrigin
    }
  };
}

/** Reconstruct only the exact reviewed argv; saved native operation arguments remain original. */
export function documentCompositionApplicationRequest(request){
  need(request.command==='document-merchant'&&Array.isArray(request.args)&&
    request.args[0]==='compose'&&request.args[1]==='serve'&&
    request.terminal!==true&&!request.pythonCommand,'APPLICATION_DOCUMENT_COMPOSITION_REQUEST_CHANGED');
  const pairs=new Map([
    ['--managed-source','sourceDirectory'],['--expected-selection','expectedSelection'],
    ...TEXT_OPTIONS.map(([name,flag])=>[flag,name]),...NUMBERS.map(([name,flag])=>[flag,name])
  ]);
  const result=Object.create(null),seen=new Set();
  need((request.args.length-2)%2===0,'APPLICATION_DOCUMENT_COMPOSITION_REQUEST_CHANGED');
  for(let index=2;index<request.args.length;index+=2){
    const flag=request.args[index],value=request.args[index+1];
    need(pairs.has(flag)&&!seen.has(flag)&&typeof value==='string'&&value.length>0&&!value.startsWith('--'),
      'APPLICATION_DOCUMENT_COMPOSITION_REQUEST_CHANGED');
    seen.add(flag);result[pairs.get(flag)]=value;
  }
  absolute(result.sourceDirectory);
  need(HASH.test(result.expectedSelection??''),'APPLICATION_DOCUMENT_COMPOSITION_REQUEST_CHANGED');
  for(const [name,flag]of NUMBERS)need(seen.has(flag),'APPLICATION_DOCUMENT_COMPOSITION_REQUEST_CHANGED');
  need(seen.has('--provider')&&seen.has('--workspace-options'),
    'APPLICATION_DOCUMENT_COMPOSITION_REQUEST_CHANGED');
  const {sourceDirectory,expectedSelection,...settings}=result;
  return {sourceDirectory,expectedSelection,options:serviceOptions(settings)};
}
export async function verifyDocumentCompositionApplicationLaunch(request){
  const requested=documentCompositionApplicationRequest(request),original=await reader(requested.sourceDirectory);
  const selected=original.assertDocumentCompositionServiceSelection(
    await original.readDocumentCompositionServiceSelection(requested.options),requested.expectedSelection);
  need(selected.sourceDirectory===requested.sourceDirectory,'APPLICATION_DOCUMENT_COMPOSITION_SOURCE_CHANGED');
  await original.assertDocumentCompositionServiceSource(join(absolute(request.releaseDirectory),'source',SOURCE));
  return selected;
}
export async function prepareDocumentCompositionApplicationChild(request,directory,originalArgs,environment){
  documentCompositionApplicationRequest(request);absolute(directory);
  need(Array.isArray(originalArgs)&&originalArgs.length>0&&originalArgs.every(value=>typeof value==='string'),
    'APPLICATION_DOCUMENT_COMPOSITION_REQUEST_CHANGED');
  return {
    executable:process.execPath,args:[...originalArgs],
    options:{cwd:request.homeDirectory,shell:false,env:environment,
      stdio:['ignore',request.applicationId?'pipe':'inherit',request.applicationId?'pipe':'inherit',3]}
  };
}
export async function documentCompositionApplicationStartup(request,text){
  if(request.command!=='document-merchant'||request.args?.[0]!=='compose'||request.args?.[1]!=='serve'||
    typeof text!=='string'||text.length>16384||!text.startsWith('{'))return null;
  let announcement;try{announcement=JSON.parse(text);}catch{return null;}
  if(!plain(announcement)||announcement.schema!==STARTUP||announcement.state!=='LISTENING')return null;
  const requested=documentCompositionApplicationRequest(request),original=await reader(requested.sourceDirectory);
  need(announcement.selectionSha256===requested.expectedSelection&&
    Number.isSafeInteger(announcement.pid)&&announcement.pid>0&&
    typeof announcement.instanceId==='string'&&typeof announcement.documentUrl==='string',
    'APPLICATION_DOCUMENT_COMPOSITION_STARTUP_CHANGED');
  const received=await original.readDocumentCompositionServiceLaunch({
    options:requested.options,expectedSelection:requested.expectedSelection,
    expected:{pid:announcement.pid,instanceId:announcement.instanceId,documentUrl:announcement.documentUrl}
  });
  const current=received.announcement;
  need(['directory','runtimeDirectory','pid','instanceId','privateLaunch','sourceRoot','selectionSha256',
    ...LINKS.map(([, ,name])=>name)].every(name=>announcement[name]===current[name])&&
    digest(json(canonical(announcement.operatorSelection)))===digest(json(canonical(current.operatorSelection))),
    'APPLICATION_DOCUMENT_COMPOSITION_STARTUP_CHANGED','Receive the current original customer launch.');
  return {
    url:received.documentUrl,
    links:LINKS.map(([id,label,name])=>({id,label,url:current[name]})),
    original:{
      schema:received.launch.schema,directory:current.directory,runtimeDirectory:current.runtimeDirectory,
      operatorSelection:current.operatorSelection,pid:current.pid,instanceId:current.instanceId,
      privateLaunch:current.privateLaunch,approvalMode:received.launch.approvalMode,
      landing:received.launch.landing,documentSelectionSha256:current.selectionSha256,
      documentSourceDirectory:received.selection.sourceDirectory,documentSourceRoot:current.sourceRoot
    }
  };
}
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:DOCUMENT_COMPOSITION_APPLICATION_ID,order:292,appendPort:false,
  catalog(context){return [documentCompositionApplication(context)];},
  validateSettings(type,settings){validateDocumentCompositionApplicationSettings(settings);},
  prepare(type,settings,context){return prepareDocumentCompositionApplication(settings,context);},
  verifyLaunch(request){return verifyDocumentCompositionApplicationLaunch(request);},
  prepareChild(request,directory,args,environment){
    return prepareDocumentCompositionApplicationChild(request,directory,args,environment);
  },
  matchRequest(request){
    return !request.pythonCommand&&request.command==='document-merchant'&&
      request.args?.[0]==='compose'&&request.args?.[1]==='serve';
  },
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{"schema":"stellar-forge.document-composition-service-launch.v1",'))return null;
      return ()=>documentCompositionApplicationStartup(request,text);
    });
  }
};
