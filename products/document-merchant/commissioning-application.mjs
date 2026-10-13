// MIT. Commission and run the existing Document merchant through its original Applications lifetime.
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,digest,plain} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/config.mjs';
import {readServiceFile} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/managed/selection.mjs';
import {jobServiceAnnouncement} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/managed/service.mjs';
import {absolute} from '../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs';
import {reviewDocumentCommissioning,prepareDocumentCommissioning,inspectDocumentCommissioning,
  openCommissionedDocumentService} from './commissioning.mjs';
import {readDocumentServiceSources,assertDocumentServiceSource,readDocumentServiceSelection,
  readDocumentServiceLaunch} from './launch.mjs';
import {documentError} from './contracts.mjs';

export const DOCUMENT_COMMISSIONING_APPLICATION_SCHEMA='stellar-forge.document-commissioning-application.v1';
const ROOT=dirname(fileURLToPath(import.meta.url));
const HASH=/^[a-f0-9]{64}$/;
function need(value,code){if(!value)throw documentError(code);}
function json(bytes){
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{need(false,'DOCUMENT_COMMISSION_APPLICATION_OPTIONS_INVALID');}
  need(plain(value),'DOCUMENT_COMMISSION_APPLICATION_OPTIONS_INVALID');return value;
}

/** Pure selection: complete account/settings and original product/runtime source; no mutable job state. */
export async function readDocumentCommissioningApplicationSelection({optionsFile}={}){
  optionsFile=absolute(optionsFile);
  const configuration=await readServiceFile(optionsFile,65536,{privateFile:true});
  const review=await reviewDocumentCommissioning(json(configuration.bytes));
  const selected={schema:DOCUMENT_COMMISSIONING_APPLICATION_SCHEMA,sourceDirectory:ROOT,
    optionsFile:configuration.pin,review,merchantState:join(review.paths.merchant,'merchant-state'),
    sourceFiles:await readDocumentServiceSources()};
  return {...selected,selectionSha256:digest(canonical(selected))};
}
export function assertDocumentCommissioningApplicationSelection(value,expectedSelection){
  need(plain(value)&&value.schema===DOCUMENT_COMMISSIONING_APPLICATION_SCHEMA&&HASH.test(value.selectionSha256??''),
    'DOCUMENT_COMMISSION_APPLICATION_SELECTION_INVALID');
  const {selectionSha256,...selected}=value;
  need(digest(canonical(selected))===selectionSha256&&
    (expectedSelection===undefined||expectedSelection===selectionSha256),'DOCUMENT_COMMISSION_APPLICATION_SELECTION_CHANGED');
  return value;
}

/** First Start prepares the exact reviewed installation; every Start owns the same native service. */
export async function openDocumentCommissioningApplication({optionsFile,expectedSelection,
  launchSourceDirectory=ROOT,launchFile=null}={},{environment=process.env,signal}={}){
  signal?.throwIfAborted();await assertDocumentServiceSource(launchSourceDirectory);
  const selected=assertDocumentCommissioningApplicationSelection(
    await readDocumentCommissioningApplicationSelection({optionsFile}),expectedSelection);
  signal?.throwIfAborted();
  await prepareDocumentCommissioning(selected.review.options,{expectedSelection:selected.review.selectionSha256});
  signal?.throwIfAborted();
  assertDocumentCommissioningApplicationSelection(
    await readDocumentCommissioningApplicationSelection({optionsFile}),selected.selectionSha256);
  const opened=await openCommissionedDocumentService({directory:selected.review.options.directory,
    expectedSelection:selected.review.selectionSha256},{environment,signal,launchFile,launchSourceDirectory});
  return {...opened,applicationSelection:selected};
}

/** Bind the original managed launch to the same retained account, source and product selection. */
export async function readDocumentCommissioningApplicationLaunch({optionsFile,expectedSelection,file,expected={},signal}={}){
  const selected=assertDocumentCommissioningApplicationSelection(
    await readDocumentCommissioningApplicationSelection({optionsFile}),expectedSelection);
  const commissioning=await inspectDocumentCommissioning(selected.review.options.directory);
  need(commissioning.selectionSha256===selected.review.selectionSha256,'DOCUMENT_COMMISSION_APPLICATION_SELECTION_CHANGED');
  const serviceSelection=await readDocumentServiceSelection(commissioning.serviceOptions);
  const received=await readDocumentServiceLaunch({options:commissioning.serviceOptions,file,
    expectedSelection:serviceSelection.selectionSha256,expected,signal});
  need(received.launch.directory===selected.merchantState,'DOCUMENT_COMMISSION_APPLICATION_LAUNCH_CHANGED');
  return {...received,applicationSelection:selected,commissioning};
}

/** One original foreground owner, one startup line, original service then facilitator drain. */
export async function runDocumentCommissioningApplication(options,{print=value=>console.log(value),
  environment=process.env,signal}={}){
  const stop=new AbortController(),combined=signal?AbortSignal.any([signal,stop.signal]):stop.signal;
  const interrupt=()=>stop.abort(documentError('DOCUMENT_COMMISSION_STOPPED'));
  process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  let opened;
  try{
    opened=await openDocumentCommissioningApplication(options,{environment,signal:combined});
    combined.throwIfAborted();
    print(JSON.stringify({...jobServiceAnnouncement(opened.launch,options.launchFile??null),
      documentCommissioningSha256:opened.applicationSelection.selectionSha256}));
    return await opened.closed;
  }catch(error){if(combined.aborted&&(error===combined.reason||error?.name==='AbortError'))return;throw error;}
  finally{process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);await opened?.close();}
}
