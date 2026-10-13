// MIT. Complete native OpenFEMA delivery joins the original Customer Installation factory.
import {createHash} from 'node:crypto';
import {inspectWorkspaceArchive} from '../../../scf-starforge-20261009/sf30-seller-sdk/openfema/exports.mjs';
import {readZip} from '../../../scf-starforge-20261009/sf30-seller-sdk/openfema/zip.mjs';
import {projectDelivery} from '../../../scf-starforge-20261009/sf30-seller-sdk/openfema/delivery.mjs';
import {prepareInstallation,renderWorkorder} from './prepare-core.mjs';
export const OPENFEMA_INSTALLATION_SCHEMA='stellar-forge.openfema-customer-installation.v1';
export const OPENFEMA_INSTALLATION_PROFILE='openfema-customer';
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const need=(ok,message)=>{if(!ok)throw new Error(message);};
export const parse=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export const identity=(name,bytes)=>({name,bytes:bytes.length,sha256:hash(bytes)});
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function inspectOpenFemaInstallationSource(archive,{deliveryId,expectedArchiveSha256}={}){
  need(hex(expectedArchiveSha256)&&hash(archive)===expectedArchiveSha256,'Select the complete original workspace archive and its exact SHA-256.');
  need(typeof deliveryId==='string'&&deliveryId.length>0,'Select the original native project delivery ID.');
  const opened=inspectWorkspaceArchive(archive),state=opened.state;
  const delivery=state.projectDeliveries?.find(row=>row.id===deliveryId);
  need(delivery,'The selected project delivery is absent from this complete original workspace.');
  const object=(sha,bytes)=>{
    need(hex(sha),'Retain the original native object SHA-256.');
    const body=opened.entries.get('workspace/objects/'+sha);
    need(body&&hash(body)===sha&&(bytes===undefined||body.length===bytes),'An original selected native object differs from its recorded identity.');
    return body;
  };
  const docRaw=object(delivery.documentSha256,delivery.documentBytes),document=parse(docRaw);
  const exported=state.exports?.find(row=>row.id===delivery.export?.id);
  need(exported&&same(exported,delivery.export)&&exported.kind==='project-delivery'&&exported.format==='zip',
    'Retain the selected original native project-delivery export.');
  const zip=object(exported.sha256,exported.bytes),files=readZip(zip);
  const required=name=>{const body=files.get(name);need(body!==undefined,'The complete original customer delivery lacks '+name);return body;};
  const manifest=parse(required('delivery.json')),portfolio=parse(required('portfolio.json'));
  const mapping=parse(required('mapping.json')),mappingReview=parse(required('mapping-review.json'));
  need(same(manifest,document.manifest)&&same(portfolio,document.portfolio)&&
    required('projects-target.csv').equals(Buffer.from(document.targetCsv))&&same(mapping,manifest.mapping),
    'Retain the complete native delivery object, original projection and customer source.');
  const version=state.portfolioVersions?.find(row=>row.id===delivery.versionId);
  const review=state.deliveryMappingReviews?.find(row=>row.id===delivery.mappingReviewId);
  const mapRecord=state.deliveryMappings?.find(row=>row.id===delivery.mappingId);
  need(version&&same(version,manifest.version)&&review&&same(review,mappingReview)&&mapRecord&&
    same(parse(object(mapRecord.objectSha256)),mapping)&&
    delivery.mappingSha256===manifest.mappingSha256&&mapRecord.mappingSha256===manifest.mappingSha256&&
    delivery.editionId===manifest.editionId&&delivery.portfolioId===version.portfolioId,
    'Keep the original selected portfolio, mapping and reviewed source editions.');
  need(same(parse(object(version.sha256,version.bytes)),portfolio),
    'Retain the complete source portfolio object selected by the original native version.');
  let customerReconciliation=null;
  if(delivery.customerReconciliationId){
    const record=state.deliveryReconciliations?.find(row=>row.id===delivery.customerReconciliationId);
    need(record,'Retain the selected original customer reconciliation.');
    customerReconciliation=parse(object(record.documentSha256,record.documentBytes));
    const customer=parse(object(record.customerFileObjectSha256));
    need(same(parse(required('customer-reconciliation.json')),customerReconciliation)&&
      required('customer-original.csv').equals(Buffer.from(customer.content)),
      'Keep the complete original customer return and native reconciliation.');
  }
  const rebuilt=projectDelivery({portfolio,version,mapping,mappingReview,customerReconciliation,createdAt:manifest.createdAt});
  need(same(rebuilt,document),'The selected source, mapping or full target projection differs from its native delivery.');
  for(const name of ['report.html','TARGET_SCHEMA.txt','START_HERE.txt'])required(name);
  need(required('TARGET_SCHEMA.txt').equals(Buffer.from(mapping.target.evidence.content)),'Keep the full selected customer target definition.');
  const availability=files.has('recipient-availability.json')?parse(files.get('recipient-availability.json')):null;
  const source={
    schema:OPENFEMA_INSTALLATION_SCHEMA+'.source',
    workspaceId:state.workspaceId,workspaceRevision:state.revision,
    archive:{name:'OpenFEMA_Complete_Workspace.zip',bytes:archive.length,sha256:expectedArchiveSha256,manifestSha256:opened.manifestSha256,files:opened.manifest.files.length},
    delivery:clone(delivery),version:clone(version),source:{editionId:manifest.editionId,sha256:manifest.sourceSha256,scope:clone(portfolio.sourceScope)},
    mappingReview:clone(mappingReview),summary:clone(manifest.summary),recipient:availability,
    files:[...files].map(([name,bytes])=>identity(name,bytes)),customerArchive:identity('OpenFEMA_Project_Delivery.zip',zip)
  };
  return {source,files,customerArchive:zip,workspaceArchive:archive};
}
export function composeOpenFemaInstallation(seed,profile,bindings,source,{attachments=[]}={}){
  need(profile?.id===OPENFEMA_INSTALLATION_PROFILE&&bindings?.profile===profile.id&&source?.schema===OPENFEMA_INSTALLATION_SCHEMA+'.source',
    'Use the complete OpenFEMA customer profile and original selected source.');
  const chosen=clone(bindings);chosen.source??={};chosen.receiving??={};
  const reference='Original OpenFEMA workspace '+source.workspaceId+' revision '+source.workspaceRevision+
    '; project delivery '+source.delivery.id+'; portfolio version '+source.version.id+
    '; source edition '+source.source.editionId+'; complete archive SHA-256 '+source.archive.sha256+'.';
  if(!chosen.source.reference)chosen.source.reference=reference;
  if(!chosen.receiving.application)chosen.receiving.application=profile.receiving.application+
    ' Full original workspace in source/OpenFEMA_Complete_Workspace.zip; exact selected customer output in delivery/.';
  const prepared=prepareInstallation(seed,profile,chosen);
  need(typeof bindings.workshareCaseId==='string'&&bindings.workshareCaseId.length>0&&prepared.document.workshare?.caseId===bindings.workshareCaseId,
    'Receive the complete original customer Workshare through installation-workshare-seed first.');
  const annex={...clone(source),installationSelection:clone(prepared.source),workshareCaseId:bindings.workshareCaseId,
    originalInputs:{seed:'source/seed.json',bindings:'source/bindings.json',profile:'source/profile.json'},
    attachments:clone(attachments)};
  const cell=v=>String(v).replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
  const table=rows=>['| Original file | Bytes | SHA-256 |','| --- | ---: | --- |',...rows.map(x=>'| '+cell(x.name)+' | '+x.bytes+' | '+x.sha256+' |')].join('\n');
  const markdown='# Complete Public Assistance customer Installation\n\n'+reference+'\n\n'+
    'Original commercial Workshare: '+bindings.workshareCaseId+'\n\n'+
    'Open the complete customer output under delivery/. The exact native workspace ZIP includes every original source response, retained customer input, mapped delivery and native operation. '+
    'Restore it through the maintained openfema restore command into a distinct private directory. Retained delivery revision and later workspace revision remain separate.\n\n'+
    table(source.files)+'\n\n## Selected additional working files\n\n'+(attachments.length?table(attachments):'No additional working files selected.')+'\n\n'+
    'Additional files are retained as explicit operator-supplied preparation. They do not replace the archived native result, approve a customer decision or establish a payment. '+
    'The Installation input keeps the existing commercial phases, funded assignment and OPEN checks. Record actual acceptance through the original case after independent receiving.\n\n'+
    'Open OPENFEMA_CUSTOMER_SOURCE.json for the full source/delivery/mapping/attachment identities, WORKORDER.md for the complete task and selected responsibilities, '+
    'and installation-input.json in Customer installations → Load input file → Preview. Save through that original native writer and preserve its exact request.\n';
  return {prepared,derivedBindings:chosen,source:annex,sourceMarkdown:markdown,workorder:renderWorkorder(prepared)};
}
