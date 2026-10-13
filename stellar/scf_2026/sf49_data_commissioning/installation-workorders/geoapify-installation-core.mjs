// MIT. Complete retained Geoapify source joins the original Customer Installation factory.
import {createHash} from 'node:crypto';
import {prepareInstallation,renderWorkorder} from './prepare-core.mjs';
export const GEOAPIFY_INSTALLATION_SCHEMA='stellar-forge.geoapify-customer-installation.v1';
export const GEOAPIFY_INSTALLATION_PROFILE='geoapify-customer';
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const need=(ok,message)=>{if(!ok)throw new Error(message);};
export const parse=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export const identity=(name,bytes)=>({name,bytes:bytes.length,sha256:hash(bytes)});
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const ordinary=name=>typeof name==='string'&&name.length>0&&name.length<=1024&&!/^[\\/]|[\\:\x00-\x1f]/.test(name)&&name.split('/').every(p=>p&&p!=='.'&&p!=='..');
const fileList=(files,label)=>{
  need(Array.isArray(files)&&files.length<=10000&&new Set(files.map(f=>f?.name)).size===files.length,'Retain distinct complete '+label+' files.');
  for(const f of files)need(f&&ordinary(f.name)&&Number.isSafeInteger(f.bytes)&&f.bytes>=0&&hex(f.sha256),'Retain exact original '+label+' file identities.');
};
export function composeGeoapifyInstallation(seed,profile,bindings,source,{attachments=[]}={}){
  need(profile?.id===GEOAPIFY_INSTALLATION_PROFILE&&bindings?.profile===profile.id&&source?.schema===GEOAPIFY_INSTALLATION_SCHEMA+'.source',
    'Use the complete Geoapify customer profile and selected original source.');
  need(typeof source.workspaceId==='string'&&source.workspaceId.length>0&&Number.isSafeInteger(source.workspaceRevision)&&source.workspaceRevision>=0,
    'Retain the original workspace identity and revision.');
  need(source.archive?.name==='starforge-geoapify.json.gz'&&Number.isSafeInteger(source.archive.bytes)&&source.archive.bytes>0&&hex(source.archive.sha256),
    'Retain the complete original Geoapify archive identity.');
  need(typeof source.edition?.id==='string'&&source.edition.id.length>0&&hex(source.intake?.intake?.sha256),
    'Select the original frozen edition and its retained intake.');
  fileList(source.files,'selected edition');fileList(attachments,'additional working');
  const required=['dataset.csv','dataset.json','dataset.geojson','address-review.json','review.html','basis.json'];
  need(required.every(name=>source.files.some(f=>f.name===name)),'Carry every original selected dataset, basis, review and report file.');
  const chosen=clone(bindings);chosen.source??={};chosen.receiving??={};
  const reference='Original Geoapify workspace '+source.workspaceId+' revision '+source.workspaceRevision+
    '; frozen edition '+source.edition.id+'; edition intake SHA-256 '+source.intake.intake.sha256+
    '; complete archive SHA-256 '+source.archive.sha256+'.';
  if(!chosen.source.reference)chosen.source.reference=reference;
  if(!chosen.receiving.application)chosen.receiving.application=profile.receiving.application+
    ' Full workspace: source/starforge-geoapify.json.gz. Exact selected frozen files: delivery/files/.';
  const prepared=prepareInstallation(seed,profile,chosen);
  need(typeof bindings.workshareCaseId==='string'&&bindings.workshareCaseId.length>0&&prepared.document.workshare?.caseId===bindings.workshareCaseId,
    'Receive the complete original customer Workshare through installation-workshare-seed first.');
  const annex={...clone(source),installationSelection:clone(prepared.source),workshareCaseId:bindings.workshareCaseId,
    originalInputs:{seed:'source/seed.json',bindings:'source/bindings.json',profile:'source/profile.json'},attachments:clone(attachments)};
  const cell=v=>String(v??'').replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
  const table=rows=>['| Original file | Bytes | SHA-256 |','| --- | ---: | --- |',...rows.map(x=>'| '+cell(x.name)+' | '+x.bytes+' | '+x.sha256+' |')].join('\n');
  const markdown='# Complete Geoapify customer Installation\n\n'+reference+'\n\n'+
    'Original commercial Workshare: '+cell(bindings.workshareCaseId)+'\n\n'+
    'Open the selected complete dataset and review under delivery/files/. The full workspace archive retains every original source, request, provider response, comparison, decision, unfinished source form and dataset edition. Restore it through the maintained Geoapify receiver into an empty private workspace.\n\n'+
    'The selected edition uses intake '+source.intake.intake.sha256+'. The archived active intake is '+cell(source.activeIntakeSha256)+
    ' and active frozen edition is '+cell(source.activeEditionId)+'. Keep these original selections distinct when continuing work.\n\n'+
    table(source.files)+'\n\n## Selected additional working files\n\n'+(attachments.length?table(attachments):'No additional working files selected.')+'\n\n'+
    'Additional files retain their explicit operator-supplied role. The existing Workshare carries commercial terms and the Installation retains its original funded assignments, phase checks and native acceptance history.\n\n'+
    'Open GEOAPIFY_CUSTOMER_SOURCE.json for the complete original source selection and file identities; WORKORDER.md for the whole task and responsibilities; and installation-input.json in Customer installations → Load input file → Preview. Save through the original native writer and preserve the original request and returned result.\n\n'+
    'Before customer presentation, open and use the exact desktop/narrow product, complete selected datasets, every report and additional attachment, the restored Geoapify workspace and the independently reopened Installation case. View actual rendered output and repair concrete defects in that same edition.\n';
  return {prepared,derivedBindings:chosen,source:annex,sourceMarkdown:markdown,workorder:renderWorkorder(prepared)};
}
