// MIT. Reuse the retained commerce operator and original facilitator for a document service.
import {join,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inspectCommerceSetup} from '../../stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-setup.mjs';
import {validateProfile} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/checkout/contract.mjs';
import {operator as validateOperator} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';
import {validateConfig as validateFacilitator} from '../../stellar/scf-starforge-20261009/native-facilitator/config.mjs';
import {readServiceFile} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/managed/selection.mjs';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {absolute,ownedDirectory,ownedBytes,writeExact,encoded,parse,canonical,digest,plain,need}
  from '../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs';
import {documentSetupTemplate,normalizeDocumentSetup,prepareDocumentMerchant,inspectDocumentMerchant} from './setup.mjs';
import {openDocumentService,readDocumentServiceSelection} from './launch.mjs';

export const DOCUMENT_COMMISSIONING_SCHEMA='stellar-forge.document-commerce-commissioning.v1';
export const DOCUMENT_ACCOUNT_SOURCE_SCHEMA='stellar-forge.document-account-source.v1';
export const DOCUMENT_COMMISSIONING_REVIEW_SCHEMA='stellar-forge.document-commerce-review.v1';
const ROOT=dirname(fileURLToPath(import.meta.url));
const FRAMEWORK=join(ROOT,'../../stellar/scf-starforge-20261009');
const BUYER_RUNTIME=join(FRAMEWORK,'sf88-operator-buyer-cli');
const HASH=/^[a-f0-9]{64}$/;
const same=(a,b)=>canonical(a)===canonical(b);
const fields=new Set(['accountSourceFile','commerceDirectory','directory','intentId','provider','anonymous','customerOptionsFile',
  'customerDirectory','assemblyPaymentFile','sellerPort','customerPort','operatorPort','operationsPort']);
const pin=async(path,maximum=1048576,privateFile=true)=>(await readServiceFile(path,maximum,{privateFile})).pin;
function separate(a,b){const p=relative(a,b);return p!==''&&p!=='..'&&!p.startsWith('..'+sep)&&!isAbsolute(p);}
function port(value){value??=0;need(Number.isInteger(value)&&value>=0&&value<=65535,'DOCUMENT_COMMISSION_PORT_INVALID');return value;}
function input(raw){
  need(plain(raw)&&Object.keys(raw).every(key=>fields.has(key)),'DOCUMENT_COMMISSION_INPUT_REQUIRED');
  const account=raw.accountSourceFile!==undefined&&raw.accountSourceFile!==null;
  need(account?raw.commerceDirectory===undefined&&raw.intentId===undefined:raw.commerceDirectory!==undefined,
    'DOCUMENT_COMMISSION_ONE_ORIGINAL_SOURCE_REQUIRED');
  if(!account)need(typeof raw.intentId==='string'&&raw.intentId.length>0&&raw.intentId.length<=128&&
    !/[\x00-\x1f\x7f]/.test(raw.intentId),'DOCUMENT_COMMISSION_INTENT_REQUIRED');
  need(raw.anonymous===undefined||typeof raw.anonymous==='boolean','DOCUMENT_COMMISSION_ANONYMOUS_INVALID');
  const value={...(account?{accountSourceFile:absolute(raw.accountSourceFile)}:
      {commerceDirectory:absolute(raw.commerceDirectory),intentId:raw.intentId}),directory:absolute(raw.directory),provider:raw.provider??'mintpdf',anonymous:raw.anonymous??false,
    customerOptionsFile:raw.customerOptionsFile===undefined||raw.customerOptionsFile===null?null:absolute(raw.customerOptionsFile),
    customerDirectory:raw.customerDirectory===undefined||raw.customerDirectory===null?null:absolute(raw.customerDirectory),
    ...(raw.assemblyPaymentFile===undefined?{}:{assemblyPaymentFile:absolute(raw.assemblyPaymentFile)}),
    sellerPort:port(raw.sellerPort),customerPort:port(raw.customerPort),
    operatorPort:port(raw.operatorPort),operationsPort:port(raw.operationsPort)};
  need(Boolean(value.customerOptionsFile)!==Boolean(value.customerDirectory),'DOCUMENT_COMMISSION_CUSTOMER_REQUIRED');
  need((account||value.directory!==value.commerceDirectory&&!separate(value.directory,value.commerceDirectory)&&
    !separate(value.commerceDirectory,value.directory))&&value.directory!==ROOT&&!separate(value.directory,ROOT),
    'DOCUMENT_COMMISSION_DIRECTORIES_MUST_DIFFER');
  const ports=[value.sellerPort,value.customerPort,value.operatorPort,value.operationsPort].filter(Boolean);
  need(new Set(ports).size===ports.length,'DOCUMENT_COMMISSION_PORTS_MUST_DIFFER');
  return value;
}
async function selectedSource(raw){
  const options=input(raw),account=Boolean(options.accountSourceFile);
  let original,offer,payment,originalPolicy,operator,profile,profileFile,configurationFiles;
  if(account){
    const source=await readServiceFile(options.accountSourceFile,65536,{privateFile:true}),value=parse(source.bytes);
    need(plain(value)&&value.schema===DOCUMENT_ACCOUNT_SOURCE_SCHEMA&&
      Object.keys(value).every(key=>['schema','operatorProfileFile','facilitatorConfigFile','publicOrigin','payment'].includes(key)),
      'DOCUMENT_COMMISSION_ACCOUNT_SOURCE_INVALID');
    profileFile=await readServiceFile(absolute(value.operatorProfileFile),65536,{privateFile:true});
    profile=validateProfile(profileFile.bytes);validateOperator(profile.operator);
    need(typeof profile.trustedPayer==='string'&&/^[GC][A-Z2-7]{55}$/.test(profile.trustedPayer),
      'DOCUMENT_COMMISSION_ORIGINAL_PAYER_REQUIRED');
    absolute(profile.signerModule);
    originalPolicy=await readServiceFile(absolute(value.facilitatorConfigFile),1048576,{privateFile:true});
    payment=structuredClone(value.payment);
    need(plain(payment),'DOCUMENT_COMMISSION_ORIGINAL_TERMS_REQUIRED');
    operator=null;
    configurationFiles=[source.pin,profileFile.pin,originalPolicy.pin,
      await pin(profile.operator.policy,4194304,false),await pin(profile.signerModule,4194304,false)];
    // The retained mutable spending ledger is selected by its original path, never copied or reset.
    original={sourceKind:'OPERATOR_PROFILE',accountSource:source.pin,operatorProfile:profileFile.pin,
      operatorOwner:structuredClone(profile.operator),publicOrigin:value.publicOrigin,payer:profile.trustedPayer,
      asset:payment.asset,recipient:payment.payTo,sharedBudget:{
        policyFile:profile.operator.policy,ledger:profile.operator.ledger,
        actor:profile.operator.actor,service:profile.operator.service}};
    offer={intentId:null,routeId:null,acceptIndex:null};
  }else{
    original=await inspectCommerceSetup(options.commerceDirectory);
    const selected=original.selections?.filter(value=>value.intentId===options.intentId)??[];
    need(selected.length===1,'DOCUMENT_COMMISSION_INTENT_NOT_FOUND');
    offer=selected[0];payment=structuredClone(offer.originalTerms);
    const prepared=await readServiceFile(join(options.commerceDirectory,'prepared.json'),1048576,{privateFile:true});
    const preparedValue=parse(prepared.bytes),facilitatorPath=join(options.commerceDirectory,'facilitator.json');
    originalPolicy=await readServiceFile(facilitatorPath,1048576,{privateFile:true});
    const recorded=preparedValue.files.find(value=>value.path===facilitatorPath);
    need(recorded&&recorded.bytes===originalPolicy.pin.bytes&&recorded.sha256===originalPolicy.pin.sha256,
      'DOCUMENT_COMMISSION_ORIGINAL_FACILITATOR_CHANGED');
    operator=absolute(original.workspace);
    configurationFiles=[prepared.pin,originalPolicy.pin,
      await pin(join(operator,'workspace.json'),1048576,false),await pin(join(operator,'operator.json'),1048576,false)];
  }
  need(payment.scheme==='exact'&&payment.network==='stellar:testnet'&&
    payment.asset===original.asset&&payment.payTo===original.recipient&&
    payment.extra?.areFeesSponsored===true&&typeof payment.amount==='string'&&/^[1-9][0-9]*$/.test(payment.amount),
    'DOCUMENT_COMMISSION_ORIGINAL_TERMS_REQUIRED');
  const publicOrigin=new URL(original.publicOrigin);
  need(publicOrigin.protocol==='https:'&&publicOrigin.origin===original.publicOrigin&&
    !publicOrigin.username&&!publicOrigin.password,'DOCUMENT_COMMISSION_HTTPS_ORIGIN_REQUIRED');
  if(account&&profile.buyerTransport!==undefined)
    need(profile.buyerTransport.origin===original.publicOrigin,'DOCUMENT_COMMISSION_BUYER_TRANSPORT_ORIGIN_CHANGED');
  const policy=validateFacilitator(parse(originalPolicy.bytes));
  need(policy.network===payment.network&&policy.payments.assets.includes(payment.asset)&&
    policy.payments.recipients.includes(payment.payTo)&&BigInt(payment.amount)<=BigInt(policy.payments.maxAtomic)&&
    policy.payments.paymentFlows.includes(payment.extra.paymentFlow??'authorization'),
    'DOCUMENT_COMMISSION_TERMS_OUTSIDE_ORIGINAL_POLICY');
  let assemblyPayment=null;
  if(options.assemblyPaymentFile){
    need(options.provider==='pdfmint','DOCUMENT_COMMISSION_ASSEMBLY_PROVIDER_REQUIRED');
    const assembly=await readServiceFile(options.assemblyPaymentFile,65536,{privateFile:true});
    assemblyPayment=parse(assembly.bytes);
    need(plain(assemblyPayment)&&assemblyPayment.scheme===payment.scheme&&assemblyPayment.network===payment.network&&
      assemblyPayment.asset===payment.asset&&assemblyPayment.payTo===payment.payTo&&
      assemblyPayment.extra?.areFeesSponsored===true&&typeof assemblyPayment.amount==='string'&&
      /^[1-9][0-9]*$/.test(assemblyPayment.amount),'DOCUMENT_COMMISSION_ASSEMBLY_TERMS_REQUIRED');
    need(policy.payments.assets.includes(assemblyPayment.asset)&&policy.payments.recipients.includes(assemblyPayment.payTo)&&
      BigInt(assemblyPayment.amount)<=BigInt(policy.payments.maxAtomic)&&
      policy.payments.paymentFlows.includes(assemblyPayment.extra.paymentFlow??'authorization'),
      'DOCUMENT_COMMISSION_ASSEMBLY_TERMS_OUTSIDE_ORIGINAL_POLICY');
    configurationFiles.push(assembly.pin);
  }
  let customer;
  if(options.customerOptionsFile){
    const source=await readServiceFile(options.customerOptionsFile,65536,{privateFile:true});
    configurationFiles.push(source.pin);customer=parse(source.bytes);
    need(plain(customer)&&plain(customer.checkout)&&(account?
      customer.checkout.operatorProfile===profileFile.pin.path&&!customer.checkout.operatorWorkspace:
      customer.checkout.operatorWorkspace===operator&&!customer.checkout.operatorProfile),
      'DOCUMENT_COMMISSION_CUSTOMER_OPERATOR_CHANGED');
    absolute(customer.directory);
    need((customer.checkout.runtimeDirectory??BUYER_RUNTIME)===BUYER_RUNTIME,
      'DOCUMENT_COMMISSION_CUSTOMER_RUNTIME_CHANGED');
  }else{
    customer={directory:options.customerDirectory,checkout:{...(account?
      {operatorProfile:profileFile.pin.path}:{operatorWorkspace:operator}),runtimeDirectory:BUYER_RUNTIME}};
  }
  const protectedDirectories=account?[]:[options.commerceDirectory,operator];
  need(protectedDirectories.every(path=>customer.directory!==path&&
      !separate(customer.directory,path)&&!separate(path,customer.directory))&&
    customer.directory!==options.directory&&!separate(customer.directory,options.directory),
    'DOCUMENT_COMMISSION_CUSTOMER_DIRECTORY_CONFLICT');
  if(account)need(protectedDirectories.every(path=>options.directory!==path&&!separate(options.directory,path)&&
    !separate(path,options.directory)),'DOCUMENT_COMMISSION_DIRECTORIES_MUST_DIFFER');
  const request=documentSetupTemplate(options.provider,{anonymous:options.anonymous,assembly:assemblyPayment!==null});
  request.publicOrigin=original.publicOrigin;request.payment=payment;
  if(assemblyPayment!==null)request.assembly={payment:structuredClone(assemblyPayment)};
  request.serviceName='Document merchant — '+request.provider.provider;
  const normalized=normalizeDocumentSetup(request);
  const sourceFiles=[];
  for(const path of [join(ROOT,'commissioning.mjs'),join(ROOT,'commissioning-facilitator.mjs'),
    join(FRAMEWORK,'native-facilitator/runtime.mjs'),join(FRAMEWORK,'native-facilitator/config.mjs'),
    join(FRAMEWORK,'sf30-seller-sdk/native-factory.mjs'),
    join(FRAMEWORK,'sf88-operator-buyer-cli/config.mjs'),
    join(FRAMEWORK,'sf88-operator-buyer-cli/job-workspace/checkout/contract.mjs')])sourceFiles.push(await pin(path,4194304,false));
  const value={schema:DOCUMENT_COMMISSIONING_REVIEW_SCHEMA,options,
    original:{...(account?{sourceKind:original.sourceKind,accountSource:original.accountSource,
        operatorProfile:original.operatorProfile,operatorOwner:original.operatorOwner}:
        {commerceDirectory:options.commerceDirectory}),operatorWorkspace:operator,
      intentId:offer.intentId,routeId:offer.routeId,acceptIndex:offer.acceptIndex,
      originalTerms:payment,publicOrigin:original.publicOrigin,payer:original.payer,
      sharedBudget:structuredClone(original.sharedBudget),facilitator:originalPolicy.pin},
    configurationFiles,sourceFiles,request:normalized,customer,
    paths:{merchant:join(options.directory,'merchant'),factory:join(options.directory,'native-factory.mjs'),
      customerOptions:join(options.directory,'customer-options.json'),
      consumerOptions:join(options.directory,'case-document-options.json'),
      compositionOptions:join(options.directory,'composition-options.json'),
      sourceRoot:join(customer.directory,'artifacts','document-compositions')},
    environmentNames:[...new Set([...policy.signers.map(value=>value.secretEnv),
      ...(policy.feeBumpSigner?[policy.feeBumpSigner.secretEnv]:[]),
      ...(normalized.provider.keyEnvironment?[normalized.provider.keyEnvironment]:[])])].sort()};
  return {...value,selectionSha256:digest(canonical(value))};
}
/** Read only: verifies the original completed setup and one explicitly selected native offer. */
export async function reviewDocumentCommissioning(options){return selectedSource(options);}
function assertReview(value){
  need(plain(value)&&value.schema===DOCUMENT_COMMISSIONING_REVIEW_SCHEMA&&HASH.test(value.selectionSha256??''),
    'DOCUMENT_COMMISSION_REVIEW_INVALID');
  const {selectionSha256,...body}=value;
  need(digest(canonical(body))===selectionSha256,'DOCUMENT_COMMISSION_REVIEW_CHANGED');return value;
}
function generated(review){
  const selection={facilitator:review.original.facilitator,payment:review.original.originalTerms,
    ...(review.request.assembly?{assemblyPayment:review.request.assembly.payment}:{})};
  const helper=pathToFileURL(join(ROOT,'commissioning-facilitator.mjs')).href;
  const factory='// Generated from the complete original commerce facilitator and selected native terms.\n'+
    'import {createDocumentCommissioningFactory} from '+JSON.stringify(helper)+';\n'+
    'const owner=createDocumentCommissioningFactory('+canonical(selection)+');\n'+
    'export const begin=owner.begin;\nexport const nativeFactory=owner.nativeFactory;\nexport const close=owner.close;\n';
  const consumer={schema:'dealscout.document-service-options.v1',module_path:join(ROOT,'index.mjs'),
    provider:review.options.provider,merchant_origin:review.original.publicOrigin,
    customer:structuredClone(review.customer),source_root:review.paths.sourceRoot};
  const composition={workspaceOptionsFile:review.paths.customerOptions,sourceRoot:review.paths.sourceRoot,
    provider:review.options.provider,merchantOrigin:review.original.publicOrigin};
  return [
    {name:'native-factory.mjs',content:factory},
    {name:'customer-options.json',content:encoded(review.customer).toString('utf8')},
    {name:'case-document-options.json',content:encoded(consumer).toString('utf8')},
    {name:'composition-options.json',content:encoded(composition).toString('utf8')}
  ].map(file=>({...file,bytes:Buffer.byteLength(file.content),sha256:digest(file.content)}));
}
function result(review,installation){
  return {schema:DOCUMENT_COMMISSIONING_SCHEMA,directory:review.options.directory,
    selectionSha256:review.selectionSha256,original:review.original,
    installation,...(review.request.assembly?{assemblyPayment:structuredClone(review.request.assembly.payment)}:{}),
    customerOptions:review.paths.customerOptions,consumerOptions:review.paths.consumerOptions,
    compositionOptions:review.paths.compositionOptions,sourceRoot:review.paths.sourceRoot,
    nativeFactory:review.paths.factory,nativeFactoryFile:{path:review.paths.factory,
      ...Object.fromEntries(Object.entries(generated(review)[0]).filter(([key])=>['bytes','sha256'].includes(key)))},
    environmentNames:review.environmentNames,
    serviceOptions:{directory:review.paths.merchant,nativeFactoryPath:review.paths.factory,
      sellerPort:review.options.sellerPort,customerPort:review.options.customerPort,
      operatorPort:review.options.operatorPort,operationsPort:review.options.operationsPort,startWorker:true},
    routes:{origin:review.original.publicOrigin,
      seller:[...review.request.formats.map(format=>review.request.pathPrefix+'/'+format),
        ...(review.request.assembly?[review.request.pathPrefix+'/pdf-set']:[])],
      customerPrefix:'/jobs/',privateListeners:['operator','operations']},
    budgetMeaning:'The existing operator ledger, payer, single-purchase cap, daily and total allowance remain authoritative.'};
}
async function retained(directory){
  const bytes=await ownedBytes(join(absolute(directory),'commissioning.json'),8388608),value=parse(bytes);
  need(value.schema===DOCUMENT_COMMISSIONING_SCHEMA&&value.directory===directory,
    'DOCUMENT_COMMISSION_RECORD_INVALID');
  const review=assertReview(value.review);
  need(review.options.directory===directory&&same(value.files,generated(review)),
    'DOCUMENT_COMMISSION_RECORD_CHANGED');return {value,review};
}
/** Create once or complete the same interrupted setup without reinitializing the original operator. */
export async function prepareDocumentCommissioning(options,{expectedSelection}={}){
  const review=await selectedSource(options);
  if(expectedSelection!==undefined)need(expectedSelection===review.selectionSha256,'DOCUMENT_COMMISSION_REVIEW_CHANGED');
  await ownedDirectory(review.options.directory,{create:true});
  const lease=await acquireStateLease(review.options.directory);
  try{
    lease.assertHeld();
    const files=generated(review),record={schema:DOCUMENT_COMMISSIONING_SCHEMA,directory:review.options.directory,review,files};
    await writeExact(join(review.options.directory,'commissioning.json'),encoded(record));
    for(const file of files)await writeExact(join(review.options.directory,file.name),Buffer.from(file.content));
    // Existing customer options remain complete; do not create or reset its catalog here.
    const installation=await prepareDocumentMerchant({directory:review.paths.merchant,request:review.request});
    need(same(await selectedSource(options),review),'DOCUMENT_COMMISSION_REVIEW_CHANGED');
    return result(review,installation);
  }finally{await lease.close();}
}
/** Reopen the same files and installation; source changes require a newly reviewed installation. */
export async function inspectDocumentCommissioning(directory){
  directory=absolute(directory);const {value,review}=await retained(directory);
  need(same(await selectedSource(review.options),review),'DOCUMENT_COMMISSION_REVIEW_CHANGED');
  for(const file of value.files){
    const bytes=await ownedBytes(join(directory,file.name),4194304);
    need(bytes.length===file.bytes&&digest(bytes)===file.sha256,'DOCUMENT_COMMISSION_FILE_CHANGED');
  }
  const installation=await inspectDocumentMerchant(review.paths.merchant);
  need(installation.inputSha256===digest(canonical(review.request))&&
    same(installation.payment,review.request.payment)&&installation.provider.provider===review.options.provider,
    'DOCUMENT_COMMISSION_INSTALLATION_CHANGED');
  return result(review,installation);
}
/** One original Jobs service with its original native facilitator; release signer ownership last. */
export async function openCommissionedDocumentService({directory,expectedSelection}={},{
  environment=process.env,signal,launchFile=null,launchSourceDirectory=ROOT
}={}){
  signal?.throwIfAborted();
  const current=await inspectDocumentCommissioning(directory);
  if(expectedSelection!==undefined)need(current.selectionSha256===expectedSelection,'DOCUMENT_COMMISSION_REVIEW_CHANGED');
  const serviceSelection=await readDocumentServiceSelection(current.serviceOptions);
  need(serviceSelection.optionalFiles.some(file=>same(file,current.nativeFactoryFile)),
    'DOCUMENT_COMMISSION_FACTORY_CHANGED');
  const factory=await import(pathToFileURL(current.nativeFactory).href);
  need(typeof factory.begin==='function'&&typeof factory.close==='function','DOCUMENT_COMMISSION_FACTORY_INVALID');
  let service,begun=false,closing,failure=null,resolveClosed,rejectClosed;
  const closed=new Promise((resolve,reject)=>{resolveClosed=resolve;rejectClosed=reject;});closed.catch(()=>{});
  function close(){
    if(closing)return closing;
    signal?.removeEventListener('abort',onAbort);
    closing=(async()=>{
      const errors=[];
      if(failure)errors.push(failure);
      try{await service?.close();}catch(error){errors.push(error);}
      try{if(begun)await factory.close();}catch(error){errors.push(error);}
      if(errors.length)throw new AggregateError(errors,'DOCUMENT_COMMISSION_CLOSE_FAILED');
      return {state:'STOPPED',selectionSha256:current.selectionSha256};
    })();
    closing.then(resolveClosed,rejectClosed);return closing;
  }
  const onAbort=()=>{close().catch(()=>{});};
  try{
    await factory.begin({environment});begun=true;signal?.throwIfAborted();
    service=await openDocumentService(current.serviceOptions,{env:environment,signal,
      expectedSelection:serviceSelection.selectionSha256,launchFile,launchSourceDirectory});
    signal?.throwIfAborted();
    service.closed.then(()=>close().catch(()=>{}),error=>{failure=error;close().catch(()=>{});});
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted){await close();signal.throwIfAborted();}
    return {commissioning:current,service,launch:service.launch,closed,close};
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'DOCUMENT_COMMISSION_START_FAILED');}throw error;}
}
